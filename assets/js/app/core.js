/**
 * assets/js/app/core.js —— 存储读写、校验哈希、类型守卫与基础归一化
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → app.js
 * 挂载点：window.TSJ.appCore
 *
 * 设计约定：
 *   1. 本文件不依赖 app 层其它文件，因此永远可以最早加载（util 除外）；
 *   2. localStorage 在 file:// 下属于**共享的不透明源**，读出的内容一律视为不可信输入：
 *      先过类型守卫，再逐字段归一化（归一化函数在 app/schema.js），必要时静默回写；
 *   3. 写失败（配额不足 / 隐私模式）必须能被 UI 感知：writeJSON 返回布尔值并触发 onWriteError。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var util = TSJ.appUtil;

  /** 难度档位（顺序即展示顺序） */
  var DIFFS = ['入门', '普及', '提高', '挑战'];
  /** 难度 → CSS class */
  var DIFF_CLASS = { '入门': 'diff-ru', '普及': 'diff-pu', '提高': 'diff-ti', '挑战': 'diff-ch' };
  /** 判题模式 → 中文名 */
  var MODE_LABEL = { holdout: '留出法', rolling: '滚动回测' };

  /**
   * 当前存储格式版本；导入时 schema 高于此值一律拒绝（低版本按白名单归一化后接受）。
   * v2（2026-11）：导出/导入扩展为全量用户数据（课程进度 / 成就 / 实验室 / 工坊 /
   * 上传 CSV，见 storage.js 的 EXTRAS），旧 v1 文件（仅三键）仍可导入。
   */
  var CURRENT_SCHEMA = 2;
  /** 应用版本（CHANGELOG 顶端为准；备份文件记录它，导入旧/新备份时给出语境）。 */
  var VERSION = '3.9.1';

  /**
   * 版本比较：a 比 b 新返回 1、旧返回 -1、相同返回 0。
   * 只比数字段（'3.9.1' / '3.9' 均可），非数字段按 0 处理，长度不齐补 0 比较。
   */
  function compareVersion(a, b) {
    var pa = String(a == null ? '' : a).split('.');
    var pb = String(b == null ? '' : b).split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = Number(pa[i]) || 0;
      var nb = Number(pb[i]) || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }
  /** 单条提交记录里代码快照的截断上限（20KB） */
  var CODE_LIMIT = 20 * 1024;
  /** 提交记录保留条数 */
  var MAX_SUBMISSIONS = 120;
  /** 单条提交记录里逐测试点明细的上限 */
  var MAX_CASES = 32;
  /** 所有存储键的公共前缀：清空进度只删这个前缀的键 */
  var STORAGE_PREFIX = 'tsoj:';

  /**
   * localStorage 键名（统一 tsoj: 前缀；禁止在别处硬编码键名字面量）。
   *   progress      { [problemId]: { best, passed, attempts, lastVerdict, lastAt } }
   *   drafts        { [problemId]: code }
   *   submissions   [ { id, at, problemId, title, score, verdict, passed, metric, code, cases, degraded } ]
   *   onboarded     true / filter 难度筛选值 / schema 版本号 / edFont 编辑器字号
   */
  var STORE = {
    progress: 'tsoj:progress',
    drafts: 'tsoj:drafts',
    submissions: 'tsoj:submissions',
    onboarded: 'tsoj:onboarded',
    filter: 'tsoj:filter',
    schema: 'tsoj:schema',
    edFont: 'tsoj:edFont',
    theme: 'tsoj:theme',
    courseProgress: 'tsoj:courseProgress:v1',
    lab: 'tsoj:lab:v1',
    labDraft: 'tsoj:labDraft:v1',
    studioDraft: 'tsoj:studioDraft:v1',
    studioCsv: 'tsoj:studioCsv:v1',
    achievements: 'tsoj:achievements:v1',
    achMeta: 'tsoj:achMeta:v1',
    studioExp: 'tsoj:studioExperiments:v1'
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
  /** 写失败回调（由 app 层注册，用来弹「本地存储已满」提示）。 */
  var writeErrorHandler = null;
  /** 上次写失败的时间戳，用于给提示节流 */
  var lastWriteErrorAt = 0;

  /**
   * 注册写失败回调。
   * @param {Function} fn function(quotaExceeded:boolean, key:string)
   */
  function onWriteError(fn) {
    writeErrorHandler = typeof fn === 'function' ? fn : null;
  }

  /**
   * 判断异常是否为「配额不足」。
   * @param {*} e 捕获到的异常
   * @returns {boolean}
   */
  function isQuotaError(e) {
    if (!e) return false;
    var name = String(e.name || '');
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014;
  }

  /**
   * 读取 JSON，异常或类型不符时返回兜底值。
   *
   * 安全约定：读出的内容必须视为「不可信输入」：
   *   1. 非法 JSON → 丢弃并静默重写为兜底值；
   *   2. 类型守卫不通过 → 丢弃并静默重写为兜底值。
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

  /**
   * 写入 JSON。失败时返回 false 并通知 app 层（配额不足 → 「进度未保存」）。
   * 不抛异常：存储不可用不应打断判题主流程，内存态继续工作。
   *
   * @param {string} key 键
   * @param {*} value 值
   * @returns {boolean} 是否真的落盘
   */
  function writeJSON(key, value) {
    var text;
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false;   // 循环引用等：不写，内存态继续
    }
    try {
      global.localStorage.setItem(key, text);
      return true;
    } catch (e) {
      var now = Date.now();
      if (writeErrorHandler && now - lastWriteErrorAt > 1200) {
        lastWriteErrorAt = now;
        writeErrorHandler(isQuotaError(e), key);
      }
      return false;
    }
  }

  /* ---------- 3. 校验哈希（FNV-1a 32 位，用于导入文件的完整性校验） ---------- */
  /**
   * 计算字符串的 FNV-1a 32 位哈希，返回 8 位小写十六进制。
   * @param {string} str 输入
   * @returns {string} 形如 "1a2b3c4d"
   */
  function fnv1a(str) {
    var s = String(str == null ? '' : str);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  /* ---------- 4. 字段归一化（storage → 可信内存值的基础件） ---------- */
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

  /** 归一化指标值：有限数值保留，其余变 null（渲染时显示「—」）。 */
  function toMetric(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** 截断代码快照：超过 20KB 时硬截断（保证存储不被单条记录撑爆）。 */
  function truncateCode(v) {
    var s = toText(v);
    return s.length > CODE_LIMIT ? s.slice(0, CODE_LIMIT) : s;
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

  TSJ.appCore = {
    DIFFS: DIFFS,
    DIFF_CLASS: DIFF_CLASS,
    MODE_LABEL: MODE_LABEL,
    STORE: STORE,
    STORAGE_PREFIX: STORAGE_PREFIX,
    CURRENT_SCHEMA: CURRENT_SCHEMA,
    VERSION: VERSION,
    compareVersion: compareVersion,
    CODE_LIMIT: CODE_LIMIT,
    MAX_SUBMISSIONS: MAX_SUBMISSIONS,
    MAX_CASES: MAX_CASES,
    isPlainObject: isPlainObject,
    isArrayValue: isArrayValue,
    readJSON: readJSON,
    writeJSON: writeJSON,
    onWriteError: onWriteError,
    isQuotaError: isQuotaError,
    fnv1a: fnv1a,
    readNormalized: readNormalized,
    toScore: toScore,
    toCount: toCount,
    toTime: toTime,
    toText: toText,
    toMetric: toMetric,
    truncateCode: truncateCode,
    // util 的工具在这里再导出一份：调用点统一写 core.esc / core.$ / core.fmtTime，少一层命名空间记忆
    $: util.$,
    $$: util.$$,
    esc: util.esc,
    fmtNum: util.fmtNum,
    fmtTime: util.fmtTime,
    fmtDateStamp: util.fmtDateStamp,
    debounce: util.debounce
  };
})(typeof window !== 'undefined' ? window : this);
