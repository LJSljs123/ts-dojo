/**
 * assets/js/app/core.js —— 应用层基础件：存储读写、字段归一化、转义与格式化、防抖
 *
 * 加载顺序：core → store → ui → views → app.js（经典 script，无模块系统）
 * 挂载点：window.TSJ.appCore
 *
 * 设计约定：
 *   1. 本文件不依赖 app 层其它文件（只依赖 TSJ.findProblem），因此永远可以最先加载；
 *   2. localStorage 在 file:// 下属于**共享的不透明源**，读出的内容一律视为不可信输入：
 *      先过类型守卫，再逐字段归一化，必要时静默回写；
 *   3. 拼进 innerHTML 的文本一律走 esc()。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 难度档位（顺序即展示顺序） */
  var DIFFS = ['入门', '普及', '提高', '挑战'];
  /** 难度 → CSS class */
  var DIFF_CLASS = { '入门': 'diff-ru', '普及': 'diff-pu', '提高': 'diff-ti', '挑战': 'diff-ch' };
  /** 判题模式 → 中文名 */
  var MODE_LABEL = { holdout: '留出法', rolling: '滚动回测' };

  /**
   * localStorage 键名（统一 tsoj: 前缀；禁止在别处硬编码键名字面量）。
   *   tsoj:progress     { [problemId]: { best, passed, attempts, lastVerdict, lastAt } }
   *   tsoj:drafts       { [problemId]: code }
   *   tsoj:submissions  [ { at, problemId, title, score, verdict, passed, metric } ]
   *   tsoj:onboarded    true
   *   tsoj:filter       难度筛选值
   */
  var STORE = {
    progress: 'tsoj:progress',
    drafts: 'tsoj:drafts',
    submissions: 'tsoj:submissions',
    onboarded: 'tsoj:onboarded',
    filter: 'tsoj:filter'
  };

  /* ---------- 1. 类型守卫 ---------- */
  /** 是否为「纯对象」（非 null / 非数组 / 非函数）。 */
  function isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
  }

  /** 是否为数组（跨 realm 安全，不用 instanceof）。 */
  function isArrayValue(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  /* ---------- 2. 存储读写 ---------- */
  /**
   * 读取 JSON，异常或类型不符时返回兜底值。
   *
   * 安全约定：localStorage 在 file:// 下属于**共享的不透明源**，同目录任意本地页面都能写入，
   * 因此读出的内容必须视为「不可信输入」：
   *   1. 非法 JSON → 丢弃并静默重写为兜底值；
   *   2. 通过 guard 的类型守卫 → 不通过则丢弃并静默重写为兜底值。
   *
   * @param {string} key 键
   * @param {*} fallback 兜底值
   * @param {Function} [guard] 类型守卫，返回 false 表示数据不合法
   * @returns {*}
   */
  function readJSON(key, fallback, guard) {
    var raw;
    try {
      raw = global.localStorage.getItem(key);
    } catch (e) {
      return fallback;   // 隐私模式 / 存储被禁用：直接用默认值
    }
    if (raw === null || raw === undefined) return fallback;

    var val;
    try {
      val = JSON.parse(raw);
    } catch (e) {
      writeJSON(key, fallback);   // 非法 JSON：静默重写，避免下次再踩
      return fallback;
    }

    if (val === null || val === undefined) return fallback;

    if (typeof guard === 'function' && !guard(val)) {
      writeJSON(key, fallback);   // 类型不符（脏数据）：丢弃 + 静默重写
      return fallback;
    }
    return val;
  }

  /** 写入 JSON，静默失败（隐私模式 / 配额不足）。 */
  function writeJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 忽略：不影响主流程 */
    }
  }

  /* ---------- 3. 字段归一化（storage → 可信内存值） ---------- */
  /** 归一化分数：只接受有限数值，夹到 0..100 的整数。 */
  function toScore(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
  }

  /** 归一化计数：非负整数，非法值回退 0。 */
  function toCount(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  /** 归一化时间戳：非法值回退 0。 */
  function toTime(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  /** 归一化文本：非字符串一律变空串（防止对象 / 数组被拼进 innerHTML）。 */
  function toText(v) {
    return typeof v === 'string' ? v : '';
  }

  /** 允许出现在提交记录里的 verdict 取值 */
  var VERDICTS = ['AC', 'WA', 'RE', 'TLE'];

  /**
   * 归一化进度表：只保留「纯对象」记录，并把每个字段强制成安全类型。
   *
   * `passed` 额外做一致性校验：必须同时满足「记录里标记为 true」与「最高分达到该题通过线」。
   * 否则一条被篡改成 `{best: "<img ...>", passed: true}` 的记录会在界面上显示成
   * 「已通过 · 最高分 0」并解锁题解 —— 归一化后 best=0，passed 自然回落为 false。
   *
   * @param {*} raw readJSON 读出的原始值
   * @returns {Object} { [problemId]: { best, passed, attempts, lastVerdict, lastAt } }
   */
  function normalizeProgress(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var ids = Object.keys(raw);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var rec = raw[id];
      if (!isPlainObject(rec)) continue;
      var best = toScore(rec.best);
      var passLine = 60;
      var prob = TSJ.findProblem(id);
      if (prob && prob.passScore > 0) passLine = prob.passScore;
      out[id] = {
        best: best,
        passed: rec.passed === true && best >= passLine,
        attempts: toCount(rec.attempts),
        lastVerdict: toText(rec.lastVerdict),
        lastAt: toTime(rec.lastAt)
      };
    }
    return out;
  }

  /** 归一化草稿表：只保留字符串值（代码），其余丢弃。 */
  function normalizeDrafts(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var ids = Object.keys(raw);
    for (var i = 0; i < ids.length; i++) {
      var code = raw[ids[i]];
      if (typeof code === 'string') out[ids[i]] = code;
    }
    return out;
  }

  /** 归一化提交记录：必须是数组，逐项校验并强制类型。 */
  function normalizeSubmissions(raw) {
    var out = [];
    if (!isArrayValue(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!isPlainObject(s)) continue;
      var verdict = toText(s.verdict).toUpperCase();
      out.push({
        at: toTime(s.at),
        problemId: toText(s.problemId),
        title: toText(s.title),
        score: toScore(s.score),
        verdict: VERDICTS.indexOf(verdict) >= 0 ? verdict : 'WA',
        passed: s.passed === true,
        metric: toText(s.metric)
      });
    }
    return out;
  }

  /**
   * 读取 → 归一化 → （必要时）回写。
   *
   * 归一化过程中被丢弃的脏字段、被强转的字段，都会通过一次静默重写「落盘」，
   * 这样下一次启动就不必再处理同一份脏数据，storage 也不会长期停留在半合法状态。
   *
   * @param {string} key 键
   * @param {*} fallback 兜底值
   * @param {Function} guard 类型守卫
   * @param {Function} normalize 归一化函数
   * @returns {*}
   */
  function readNormalized(key, fallback, guard, normalize) {
    var raw = readJSON(key, fallback, guard);
    var normalized = normalize(raw);
    var before = '';
    var after = '';
    try {
      before = JSON.stringify(raw);
      after = JSON.stringify(normalized);
    } catch (e) {
      /* 循环引用等极端情况：不回写，直接用归一化结果 */
      return normalized;
    }
    if (before !== after) writeJSON(key, normalized);
    return normalized;
  }

  /* ---------- 4. 通用工具 ---------- */
  /** querySelector 简写（建议总传入 root，把查询限制在 #view 内）。 */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /** HTML 转义。 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 数字格式化（用于指标展示）。 */
  function fmtNum(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 10000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    return v.toFixed(4);
  }

  /** 时间格式化：YYYY-MM-DD HH:mm。非法时间戳返回占位符。 */
  function fmtTime(ts) {
    if (!isFinite(ts) || ts <= 0) return '—';
    var d = new Date(ts);
    /** 补零。 */
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 简单防抖。 */
  function debounce(fn, wait) {
    var timer = 0;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        timer = 0;
        fn.apply(self, args);
      }, wait);
    };
  }

  TSJ.appCore = {
    DIFFS: DIFFS,
    DIFF_CLASS: DIFF_CLASS,
    MODE_LABEL: MODE_LABEL,
    STORE: STORE,
    isPlainObject: isPlainObject,
    isArrayValue: isArrayValue,
    readJSON: readJSON,
    writeJSON: writeJSON,
    readNormalized: readNormalized,
    toScore: toScore,
    toCount: toCount,
    toTime: toTime,
    toText: toText,
    VERDICTS: VERDICTS,
    normalizeProgress: normalizeProgress,
    normalizeDrafts: normalizeDrafts,
    normalizeSubmissions: normalizeSubmissions,
    $: $,
    esc: esc,
    fmtNum: fmtNum,
    fmtTime: fmtTime,
    debounce: debounce
  };
})(typeof window !== 'undefined' ? window : this);
