/**
 * app.js —— 应用主逻辑：路由、视图渲染、判题交互、localStorage 持久化
 *
 * 依赖（按 index.html 中的加载顺序）：
 *   TSJ.datasets / TSJ.problems / TSJ.judge / TSJ.createEditor / TSJ.drawSeries
 *
 * localStorage 键名统一使用 tsoj:* 前缀：
 *   tsoj:progress     { [problemId]: { best, passed, attempts, lastVerdict, lastAt } }
 *   tsoj:drafts       { [problemId]: code }
 *   tsoj:submissions  [ { at, problemId, title, score, verdict, passed, metric } ]
 *   tsoj:onboarded    true
 *   tsoj:filter       难度筛选值
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ;
  var judge = TSJ.judge;
  var problems = TSJ.problems;

  var DIFFS = ['入门', '普及', '提高', '挑战'];
  var DIFF_CLASS = { '入门': 'diff-ru', '普及': 'diff-pu', '提高': 'diff-ti', '挑战': 'diff-ch' };
  var MODE_LABEL = { holdout: '留出法', rolling: '滚动回测' };

  var STORE = {
    progress: 'tsoj:progress',
    drafts: 'tsoj:drafts',
    submissions: 'tsoj:submissions',
    onboarded: 'tsoj:onboarded',
    filter: 'tsoj:filter'
  };

  /** 全局可变状态（不持久化部分） */
  var state = {
    progress: {},
    drafts: {},
    submissions: [],
    filter: '全部',
    editor: null,
    activeProblem: null,
    running: false,
    lastResult: null,
    refScores: null
  };

  /* ================================================================== *
   * 1. 存储
   * ================================================================== */

  /**
   * 判断是否为「纯对象」（非 null / 非数组 / 非函数）。
   * 用于 localStorage 的类型守卫：`"x"`、`[]`、`null` 都不是合法的 progress / drafts。
   * @param {*} v 任意值
   * @returns {boolean}
   */
  function isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
  }

  /**
   * 判断是否为数组（跨 realm 安全，不用 instanceof）。
   * @param {*} v 任意值
   * @returns {boolean}
   */
  function isArrayValue(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

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

  /**
   * 写入 JSON，静默失败（隐私模式 / 配额不足）。
   * @param {string} key 键
   * @param {*} value 值
   */
  function writeJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 忽略：不影响主流程 */
    }
  }

  /* ---------------- 存储字段归一化（storage → 可信内存值） ---------------- */

  /**
   * 归一化分数：只接受有限数值，夹到 0..100 的整数。
   * @param {*} v 原始值（可能来自脏 localStorage）
   * @returns {number}
   */
  function toScore(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
  }

  /**
   * 归一化计数：非负整数，非法值回退 0。
   * @param {*} v 原始值
   * @returns {number}
   */
  function toCount(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  /**
   * 归一化时间戳：非法值回退 0。
   * @param {*} v 原始值
   * @returns {number}
   */
  function toTime(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  /**
   * 归一化文本：非字符串一律变空串（防止对象 / 数组被拼进 innerHTML）。
   * @param {*} v 原始值
   * @returns {string}
   */
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

  /**
   * 归一化草稿表：只保留字符串值（代码），其余丢弃。
   * @param {*} raw readJSON 读出的原始值
   * @returns {Object} { [problemId]: code }
   */
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

  /**
   * 归一化提交记录：必须是数组，逐项校验并强制类型。
   * @param {*} raw readJSON 读出的原始值
   * @returns {Array<Object>}
   */
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

  /* ================================================================== *
   * 2. 工具
   * ================================================================== */

  /**
   * querySelector 简写。
   * @param {string} sel 选择器
   * @param {HTMLElement} [root] 根节点
   * @returns {HTMLElement|null}
   */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /**
   * HTML 转义。
   * @param {string} s 原始文本
   * @returns {string}
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 数字格式化（用于指标展示）。
   * @param {number} v 数值
   * @returns {string}
   */
  function fmtNum(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 10000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    return v.toFixed(4);
  }

  /**
   * 时间格式化：YYYY-MM-DD HH:mm。非法时间戳返回占位符。
   * @param {number} ts 时间戳
   * @returns {string}
   */
  function fmtTime(ts) {
    if (!isFinite(ts) || ts <= 0) return '—';
    var d = new Date(ts);
    /**
     * 补零。
     * @param {number} n 数字
     * @returns {string}
     */
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * 简单防抖。
   * @param {Function} fn 目标函数
   * @param {number} wait 毫秒
   * @returns {Function}
   */
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

  /* ---------------- 极简 Markdown 渲染 ---------------- */

  /**
   * 行内元素：`code` / **bold** / *italic*。
   * @param {string} s 文本
   * @returns {string} HTML
   */
  function mdInline(s) {
    var t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return t;
  }

  /**
   * 极简 Markdown 渲染：标题、无序/有序列表、代码块、引用、分隔线、段落。
   * @param {string} src Markdown 源
   * @returns {string} HTML
   */
  function md(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var listTag = null;
    var i = 0;

    /** 关闭当前打开的列表 */
    function closeList() {
      if (listTag) {
        out.push('</' + listTag + '>');
        listTag = null;
      }
    }

    /**
     * 判断一行是否开启新块。
     * @param {string} line 行文本
     * @returns {boolean}
     */
    function isBlockStart(line) {
      return /^\s*$/.test(line) ||
        /^```/.test(line) ||
        /^#{1,4}\s+/.test(line) ||
        /^---+\s*$/.test(line) ||
        /^\s*[-*]\s+/.test(line) ||
        /^\s*\d+\.\s+/.test(line) ||
        /^>\s?/.test(line);
    }

    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        closeList();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过结束围栏
        out.push('<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 空行
      if (/^\s*$/.test(line)) {
        closeList();
        i++;
        continue;
      }

      // 标题
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        closeList();
        var lv = h[1].length;
        out.push('<h' + lv + ' class="md-h">' + mdInline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 分隔线
      if (/^---+\s*$/.test(line)) {
        closeList();
        out.push('<hr class="md-hr">');
        i++;
        continue;
      }

      // 引用
      var q = /^>\s?(.*)$/.exec(line);
      if (q) {
        closeList();
        var qbuf = [q[1]];
        i++;
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<div class="md-quote">' + mdInline(qbuf.join(' ')) + '</div>');
        continue;
      }

      // 列表
      var ul = /^\s*[-*]\s+(.*)$/.exec(line);
      var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ul || ol) {
        var want = ul ? 'ul' : 'ol';
        if (listTag !== want) {
          closeList();
          out.push('<' + want + ' class="md-list">');
          listTag = want;
        }
        out.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
        i++;
        continue;
      }

      // 段落：合并连续非块起始行
      closeList();
      var pbuf = [line];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) {
        pbuf.push(lines[i]);
        i++;
      }
      out.push('<p class="md-p">' + mdInline(pbuf.join(' ')) + '</p>');
    }

    closeList();
    return out.join('\n');
  }

  /* ================================================================== *
   * 3. 派生数据
   * ================================================================== */

  /**
   * 累计等级分 = 各题历史最高分之和。
   * @returns {number}
   */
  function totalScore() {
    var sum = 0;
    for (var i = 0; i < problems.length; i++) {
      var rec = state.progress[problems[i].id];
      if (rec) sum += toScore(rec.best);
    }
    return sum;
  }

  /**
   * 由累计分推等级。
   * @param {number} score 累计分
   * @returns {number}
   */
  function levelOf(score) {
    return Math.max(1, Math.floor(score / 150) + 1);
  }

  /**
   * 某题的本地统计（无本地记录时用题目自带通过率）。
   * @param {Object} p 题目
   * @returns {{attempts: number, rate: number}}
   */
  function problemStats(p) {
    var attempts = 0;
    var passed = 0;
    for (var i = 0; i < state.submissions.length; i++) {
      if (state.submissions[i].problemId === p.id) {
        attempts++;
        if (state.submissions[i].passed) passed++;
      }
    }
    if (attempts === 0) return { attempts: 0, rate: p.passRate || 0 };
    return { attempts: attempts, rate: Math.round((passed / attempts) * 100) };
  }

  /**
   * 更新顶部等级分胶囊。
   */
  function updateScoreChip() {
    var total = totalScore();
    var lv = levelOf(total);
    var lvEl = $('#lvText');
    var ptsEl = $('#ptsText');
    if (lvEl) lvEl.textContent = 'Lv.' + lv;
    if (ptsEl) ptsEl.textContent = total + ' 分';
  }

  /**
   * 高亮当前导航项。
   * @param {string} name 路由名
   */
  function setActiveNav(name) {
    var links = document.querySelectorAll('#nav a');
    for (var i = 0; i < links.length; i++) {
      var isOn = links[i].getAttribute('data-nav') === name;
      if (isOn) links[i].classList.add('on');
      else links[i].classList.remove('on');
    }
  }

  /* ================================================================== *
   * 4. 路由
   * ================================================================== */

  /**
   * 解析 hash 并渲染对应视图。
   */
  function route() {
    var hash = global.location.hash || '#/problems';
    var path = hash.replace(/^#\/?/, '');
    var parts = path.split('/').filter(function (s) { return s.length > 0; });
    var view = parts[0] || 'problems';

    // 切换路由前销毁旧编辑器，避免悬挂的 rAF
    if (state.editor && typeof state.editor.destroy === 'function') {
      state.editor.destroy();
    }
    state.editor = null;
    state.activeProblem = null;
    state.lastResult = null;
    state.running = false;

    if (view === 'problem' && parts[1]) {
      setActiveNav('problems');
      renderProblem(parts[1]);
    } else if (view === 'submissions') {
      setActiveNav('submissions');
      renderSubmissions();
    } else if (view === 'ranking') {
      setActiveNav('ranking');
      renderRanking();
    } else if (view === 'path') {
      setActiveNav('path');
      renderPath();
    } else {
      setActiveNav('problems');
      renderProblemList();
    }

    updateScoreChip();
    global.scrollTo(0, 0);
  }

  /* ================================================================== *
   * 5. 题库页
   * ================================================================== */

  /**
   * 渲染题库列表。
   */
  function renderProblemList() {
    var html = [];
    html.push('<div class="page">');
    html.push('<div class="page-head">');
    html.push('<h1>题库</h1>');
    html.push('<p class="sub">共 ' + problems.length + ' 题 · 写一个 predict 函数，打败统计基线即可得分，通过后解锁题解</p>');
    html.push('</div>');

    html.push('<div class="filters" role="group" aria-label="按难度筛选">');
    var options = ['全部'].concat(DIFFS);
    for (var f = 0; f < options.length; f++) {
      var on = state.filter === options[f] ? ' chip-on' : '';
      html.push('<button type="button" class="chip' + on + '" data-filter="' + esc(options[f]) + '">' +
        esc(options[f]) + '</button>');
    }
    html.push('</div>');

    html.push('<div class="table-wrap"><table class="ptable"><thead><tr>');
    html.push('<th style="width:64px">编号</th><th>标题</th><th style="width:76px">难度</th>');
    html.push('<th style="width:250px">标签</th><th style="width:62px">状态</th>');
    html.push('<th class="num" style="width:72px">最高分</th><th class="num" style="width:72px">通过率</th>');
    html.push('</tr></thead><tbody>');

    var shown = 0;
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      if (state.filter !== '全部' && p.difficulty !== state.filter) continue;
      shown++;

      var rec = state.progress[p.id] || {};
      var best = toScore(rec.best);
      var stats = problemStats(p);
      var tags = '';
      for (var t = 0; t < p.tags.length; t++) {
        tags += '<span class="tag">' + esc(p.tags[t]) + '</span>';
      }

      html.push('<tr class="prow" tabindex="0" data-id="' + esc(p.id) + '">');
      html.push('<td class="idx">#' + p.index + '</td>');
      html.push('<td><a class="p-title" href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a></td>');
      html.push('<td><span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span></td>');
      html.push('<td>' + tags + '</td>');
      html.push('<td>' + (rec.passed === true
        ? '<span class="status-ok" title="已通过">✓</span>'
        : '<span class="status-no" title="未通过">—</span>') + '</td>');
      html.push('<td class="num">' + (best > 0 ? esc(best) : '—') + '</td>');
      html.push('<td class="num">' + esc(stats.rate) + '%</td>');
      html.push('</tr>');
    }

    if (shown === 0) {
      html.push('<tr><td colspan="7"><div class="empty">该难度下暂无题目</div></td></tr>');
    }

    html.push('</tbody></table></div>');
    html.push('</div>');

    var view = $('#view');
    view.innerHTML = html.join('\n');
    bindProblemList(view);
  }

  /**
   * 绑定题库页交互。
   * @param {HTMLElement} view 视图根节点
   */
  function bindProblemList(view) {
    var chips = view.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        state.filter = this.getAttribute('data-filter');
        writeJSON(STORE.filter, state.filter);
        renderProblemList();
      });
    }

    var rows = view.querySelectorAll('.prow');
    for (var r = 0; r < rows.length; r++) {
      rows[r].addEventListener('click', function (ev) {
        // 标题本身是 <a>，交给浏览器处理
        if (ev.target && ev.target.tagName === 'A') return;
        global.location.hash = '#/problem/' + this.getAttribute('data-id');
      });
      rows[r].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          global.location.hash = '#/problem/' + this.getAttribute('data-id');
        }
      });
    }
  }

  /* ================================================================== *
   * 6. 题目页
   * ================================================================== */

  /**
   * 渲染题目详情页（左题面 / 右编辑器）。
   * @param {string} id 题目 id
   */
  function renderProblem(id) {
    var p = TSJ.findProblem(id);
    var view = $('#view');

    if (!p) {
      view.innerHTML = '<div class="page"><div class="empty"><span class="empty-icon">◌</span>' +
        '找不到这道题目。<br><a href="#/problems">返回题库</a></div></div>';
      return;
    }

    var ds = TSJ.findDataset(p.dataset);
    if (!ds) {
      view.innerHTML = '<div class="page"><div class="empty">数据集缺失：' + esc(p.dataset) + '</div></div>';
      return;
    }

    state.activeProblem = p;
    var rec = state.progress[p.id] || {};
    var draft = state.drafts[p.id];
    var code = typeof draft === 'string' ? draft : p.starter;

    view.innerHTML = problemTemplate(p, ds, rec);

    // ---- 数据预览图 ----
    var canvas = $('#seriesChart', view);
    if (canvas) {
      TSJ.drawSeries(canvas, {
        values: ds.values,
        testStart: ds.values.length - p.horizon,
        height: 190
      });
    }

    // ---- 编辑器 ----
    state.editor = TSJ.createEditor($('#editorHost', view), {
      value: code,
      onChange: debounce(function (val) {
        state.drafts[p.id] = val;
        writeJSON(STORE.drafts, state.drafts);
      }, 400),
      onRun: function () { runJudge(p, ds, false); }
    });

    // ---- 工具栏 ----
    var btnReset = $('#btnReset', view);
    var btnRun = $('#btnRun', view);
    var btnSubmit = $('#btnSubmit', view);
    var btnSolution = $('#btnSolution', view);

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (!state.editor) return;
        state.editor.setValue(p.starter);
        state.drafts[p.id] = p.starter;
        writeJSON(STORE.drafts, state.drafts);
      });
    }
    if (btnRun) {
      btnRun.addEventListener('click', function () { runJudge(p, ds, false); });
    }
    if (btnSubmit) {
      btnSubmit.addEventListener('click', function () { runJudge(p, ds, true); });
    }
    if (btnSolution) {
      btnSolution.disabled = !rec.passed;
      btnSolution.addEventListener('click', function () { showSolution(p); });
    }

    bindSplitter(view);
    renderResult(null, p);
  }

  /**
   * 题目页 HTML 模板。
   * @param {Object} p 题目
   * @param {Object} ds 数据集
   * @param {Object} rec 本地进度记录
   * @returns {string} HTML
   */
  function problemTemplate(p, ds, rec) {
    var tags = '';
    for (var t = 0; t < p.tags.length; t++) tags += '<span class="tag">' + esc(p.tags[t]) + '</span>';

    var modeText = MODE_LABEL[p.mode] || p.mode;
    var modeDetail = p.mode === 'rolling'
      ? modeText + '（' + p.windows + ' 个窗口 / 步长 ' + p.originStep + '）'
      : modeText;

    var meta = [
      '<span class="meta-item">数据集 ' + esc(p.dataset) + '</span>',
      '<span class="meta-item">' + esc(modeDetail) + '</span>',
      '<span class="meta-item">步长 ' + p.horizon + '</span>',
      '<span class="meta-item">指标 ' + esc((judge.metricLabels[p.metric] || p.metric)) + '</span>',
      '<span class="meta-item">阈值 ≤ ' + p.threshold + ' × 最优基线</span>',
      '<span class="meta-item">通过线 ' + p.passScore + '</span>'
    ].join('<span class="sep">·</span>');

    var hints = '';
    for (var h = 0; h < p.hints.length; h++) {
      hints += '<li>' + mdInline(p.hints[h]) + '</li>';
    }

    // 本地进度来自 localStorage（file:// 下可被同目录页面写入），因此先归一化再转义
    var bestScore = rec ? toScore(rec.best) : 0;
    var bestBadge = bestScore > 0
      ? '<span class="meta-item" style="color:var(--accent)">历史最高 ' + esc(bestScore) + ' 分</span>'
      : '<span class="meta-item">尚未提交</span>';

    var html = [];
    html.push('<div class="problem-layout" id="problemLayout">');

    /* ---------- 左：题面 ---------- */
    html.push('<section class="pane pane-left">');
    html.push('  <div class="problem-head">');
    html.push('    <div class="crumb"><a href="#/problems">题库</a> / #' + p.index + '</div>');
    html.push('    <h1>' + esc(p.title) + '</h1>');
    html.push('    <div class="meta-row">');
    html.push('      <span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span>');
    html.push('      ' + tags);
    html.push('      <span class="sep">|</span>' + bestBadge);
    html.push('    </div>');
    html.push('    <div class="meta-row" style="margin-top:8px">' + meta + '</div>');
    html.push('  </div>');

    html.push('  <div class="md">' + md(p.statement) + '</div>');

    html.push('  <div class="chart-card">');
    html.push('    <div class="chart-title"><span>数据预览 · ' + esc(ds.name) + '（' + esc(ds.unit) + '）</span>');
    html.push('      <span>共 ' + ds.values.length + ' 点 · 周期 ' + ds.season + '</span></div>');
    html.push('    <canvas id="seriesChart" class="chart-canvas" height="190"></canvas>');
    html.push('    <div class="chart-legend">');
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:#3fb6a8"></i>历史</span>');
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:#8a97a8"></i>测试集真实值</span>');
    html.push('      <span class="legend-item"><i class="legend-dot dash" style="border-top-color:#a5b4fc"></i>你的预测</span>');
    html.push('    </div>');
    html.push('  </div>');

    html.push('  <div class="md" style="margin-top:14px">');
    html.push('    <h3 class="md-h">输入</h3><p class="md-p">' + mdInline(p.inputSpec) + '</p>');
    html.push('    <h3 class="md-h">输出</h3><p class="md-p">' + mdInline(p.outputSpec) + '</p>');
    html.push('  </div>');

    html.push('  <details class="hints"><summary>提示（共 ' + p.hints.length + ' 条，点击展开）</summary>');
    html.push('    <div class="hints-body"><ol>' + hints + '</ol></div>');
    html.push('  </details>');

    html.push('  <div id="solutionHost"></div>');
    html.push('</section>');

    /* ---------- 分隔条 ---------- */
    html.push('<div class="splitter" id="splitter" role="separator" aria-orientation="vertical" aria-label="调整左右分栏宽度" tabindex="-1"></div>');

    /* ---------- 右：编辑器 + 结果 ---------- */
    html.push('<section class="pane pane-right">');
    html.push('  <div class="editor-toolbar">');
    html.push('    <div class="tb-left"><span class="file-chip">predict.js</span>');
    html.push('      <span class="tb-hint">Ctrl / ⌘ + Enter 运行</span></div>');
    html.push('    <div class="tb-right">');
    html.push('      <button type="button" class="btn btn-ghost" id="btnReset">重置模板</button>');
    html.push('      <button type="button" class="btn btn-ghost" id="btnSolution"' + (rec && rec.passed === true ? '' : ' disabled title="通过本题后可查看题解"') + '>查看题解</button>');
    html.push('      <button type="button" class="btn" id="btnRun">运行</button>');
    html.push('      <button type="button" class="btn btn-primary" id="btnSubmit">提交判题</button>');
    html.push('    </div>');
    html.push('  </div>');
    html.push('  <div class="editor-host" id="editorHost"></div>');
    html.push('  <div class="result-panel" id="resultPanel"></div>');
    html.push('</section>');

    html.push('</div>');
    return html.join('\n');
  }

  /**
   * 绑定左右分栏拖拽。
   * @param {HTMLElement} view 视图根节点
   */
  function bindSplitter(view) {
    var layout = $('#problemLayout', view);
    var splitter = $('#splitter', view);
    if (!layout || !splitter) return;

    var dragging = false;

    splitter.addEventListener('pointerdown', function (ev) {
      dragging = true;
      try { splitter.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      document.body.classList.add('dragging');
      ev.preventDefault();
    });

    splitter.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var rect = layout.getBoundingClientRect();
      if (rect.width <= 0) return;
      var pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(28, Math.min(68, pct));
      layout.style.setProperty('--split', pct.toFixed(2) + '%');
    });

    /**
     * 结束拖拽。
     */
    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('dragging');
      if (typeof TSJ.redrawCharts === 'function') TSJ.redrawCharts();
    }

    splitter.addEventListener('pointerup', stopDrag);
    splitter.addEventListener('pointercancel', stopDrag);
    splitter.addEventListener('lostpointercapture', stopDrag);
  }

  /* ================================================================== *
   * 7. 判题
   * ================================================================== */

  /**
   * 触发判题。
   * @param {Object} p 题目
   * @param {Object} ds 数据集
   * @param {boolean} isSubmit true = 正式提交（写入记录），false = 试运行
   */
  function runJudge(p, ds, isSubmit) {
    if (state.running || !state.editor) return;

    var code = state.editor.getValue();
    state.drafts[p.id] = code;
    writeJSON(STORE.drafts, state.drafts);
    if (typeof state.editor.clearError === 'function') state.editor.clearError();

    state.running = true;
    setBusy(true);

    judge.evaluate({ problem: p, dataset: ds, code: code }).then(function (res) {
      state.running = false;
      setBusy(false);
      state.lastResult = res;

      if (isSubmit) persistResult(p, res);
      renderResult(res, p);
      paintPrediction(res, p, ds);

      // RE：把错误行标注到编辑器上
      if (res.verdict === 'RE') {
        var line = null;
        for (var i = 0; i < res.cases.length; i++) {
          if (res.cases[i].line) { line = res.cases[i].line; break; }
        }
        if (line && state.editor) state.editor.markError(line);
      }
    }).catch(function (err) {
      state.running = false;
      setBusy(false);
      renderResult({
        verdict: 'RE',
        passed: false,
        score: 0,
        passScore: p.passScore,
        metricLabel: judge.metricLabels[p.metric] || p.metric,
        cases: [],
        message: '判题器异常：' + ((err && err.message) || String(err))
      }, p);
    });
  }

  /**
   * 切换「判题中」按钮态。
   * @param {boolean} busy 是否忙碌
   */
  function setBusy(busy) {
    var btnRun = $('#btnRun');
    var btnSubmit = $('#btnSubmit');
    if (btnRun) btnRun.disabled = busy;
    if (btnSubmit) {
      btnSubmit.disabled = busy;
      btnSubmit.textContent = busy ? '判题中…' : '提交判题';
    }
  }

  /**
   * 把最后一个测试点的预测画到预览图上。
   * @param {Object} res 判题结果
   * @param {Object} p 题目
   * @param {Object} ds 数据集
   */
  function paintPrediction(res, p, ds) {
    if (!res || !res.cases || res.cases.length === 0) return;
    var last = res.cases[res.cases.length - 1];
    if (!last || !last.predictions) return;
    var canvas = $('#seriesChart');
    if (!canvas) return;
    TSJ.drawSeries(canvas, {
      values: ds.values,
      testStart: ds.values.length - p.horizon,
      predictions: last.predictions,
      height: 190
    });
  }

  /**
   * 把判题结果写入 localStorage（进度 + 提交记录）。
   * @param {Object} p 题目
   * @param {Object} res 判题结果
   */
  function persistResult(p, res) {
    var rec = state.progress[p.id] || { best: 0, passed: false, attempts: 0 };
    rec.attempts = (rec.attempts || 0) + 1;
    rec.best = Math.max(rec.best || 0, res.score);
    rec.passed = !!rec.passed || !!res.passed;
    rec.lastVerdict = res.verdict;
    rec.lastAt = Date.now();
    state.progress[p.id] = rec;
    writeJSON(STORE.progress, state.progress);

    state.submissions.unshift({
      at: Date.now(),
      problemId: p.id,
      title: p.title,
      score: res.score,
      verdict: res.verdict,
      passed: !!res.passed,
      metric: res.metricLabel
    });
    if (state.submissions.length > 120) state.submissions.length = 120;
    writeJSON(STORE.submissions, state.submissions);

    updateScoreChip();

    // 通过后解锁题解按钮
    var btnSolution = $('#btnSolution');
    if (btnSolution && rec.passed) {
      btnSolution.disabled = false;
      btnSolution.removeAttribute('title');
    }
  }

  /* ================================================================== *
   * 8. 结果面板
   * ================================================================== */

  /**
   * 渲染判题结果面板。
   * @param {Object|null} res 判题结果（null 表示空态）
   * @param {Object} p 题目
   */
  function renderResult(res, p) {
    var host = $('#resultPanel');
    if (!host) return;

    if (!res) {
      host.innerHTML = '<div class="result-empty">' +
        '写一个 <code>predict(history, horizon, ctx)</code> 函数，<br>' +
        '点「提交判题」或按 <code>Ctrl/⌘ + Enter</code> 开始评测。<br>' +
        '<span style="color:#4d5a68">通过线 ' + p.passScore + ' 分 · 需全部测试点达标</span>' +
        '</div>';
      return;
    }

    var html = [];

    if (res.degraded) {
      html.push('<div class="notice">当前环境不支持 Web Worker（可能被 file:// 策略限制），' +
        '已降级为同线程执行：判题结果一致，但超时保护失效。</div>');
    }

    // ---- 头部：环形分 + verdict ----
    var verdictClass = 'verdict-wa';
    var verdictText = '未通过 WA';
    if (res.verdict === 'AC') { verdictClass = 'verdict-ac'; verdictText = '通过 AC'; }
    else if (res.verdict === 'RE') { verdictClass = 'verdict-re'; verdictText = '运行时错误 RE'; }
    else if (res.verdict === 'TLE') { verdictClass = 'verdict-tle'; verdictText = '超时 TLE'; }

    var ringClass = res.score >= p.passScore ? '' : (res.score >= 40 ? ' warn' : ' bad');
    var circumference = 2 * Math.PI * 30;
    var offset = circumference * (1 - Math.max(0, Math.min(100, res.score)) / 100);

    html.push('<div class="result-head">');
    html.push('  <div class="ring-wrap">');
    html.push('    <svg class="ring" viewBox="0 0 72 72" aria-hidden="true">');
    html.push('      <circle class="ring-bg" cx="36" cy="36" r="30"></circle>');
    html.push('      <circle class="ring-fg' + ringClass + '" cx="36" cy="36" r="30" ' +
      'stroke-dasharray="' + circumference.toFixed(2) + '" ' +
      'stroke-dashoffset="' + offset.toFixed(2) + '"></circle>');
    html.push('    </svg>');
    html.push('    <div class="ring-label"><b>' + esc(res.score) + '</b><span>SCORE</span></div>');
    html.push('  </div>');
    html.push('  <div class="result-summary">');
    html.push('    <div class="verdict ' + verdictClass + '">' + verdictText + '</div>');
    html.push('    <div class="result-sub">' + esc(res.metricLabel || '') + ' · ' +
      (res.cases.length > 1 ? res.cases.length + ' 个测试点取平均' : '单测试点') + '</div>');
    html.push('    <div class="result-sub dim">通过线 ' + p.passScore + ' 分 · 阈值 ' +
      p.threshold + ' × 最优基线</div>');
    html.push('  </div>');
    html.push('</div>');

    // ---- 错误信息 ----
    if (res.verdict === 'RE' || res.verdict === 'TLE') {
      var firstCase = null;
      for (var i = 0; i < res.cases.length; i++) {
        if (res.cases[i].verdict === 'RE' || res.cases[i].verdict === 'TLE') { firstCase = res.cases[i]; break; }
      }
      var errText = (firstCase && firstCase.error) || res.message || '未知错误';
      var lineText = (firstCase && firstCase.line) ? ('第 ' + firstCase.line + ' 行') : '行号未知';
      html.push('<div class="err-box">' + esc(errText) +
        '<div class="err-meta">位置：' + esc(lineText) + '</div></div>');
    } else if (res.verdict === 'WA' && res.message) {
      html.push('<div class="result-sub" style="margin-bottom:10px">' + esc(res.message) + '</div>');
    }

    // ---- 逐测试点 ----
    if (res.cases.length > 0) {
      html.push('<div class="cases">');
      for (var c = 0; c < res.cases.length; c++) {
        var cs = res.cases[c];
        var vm = cs.verdict === 'AC' ? 'vm-ac'
          : cs.verdict === 'RE' ? 'vm-re'
            : cs.verdict === 'TLE' ? 'vm-tle' : 'vm-wa';
        html.push('<div class="case">');
        html.push('  <span class="verdict-mini ' + vm + '">' + esc(cs.verdict) + '</span>');
        html.push('  <span class="case-idx">测试点 ' + (c + 1) +
          (res.cases.length > 1 ? '（origin #' + esc(cs.index + 1) + '）' : '') + '</span>');
        html.push('  <span class="case-metric">你 ' + fmtNum(cs.yourMetric) +
          ' / 基线 ' + fmtNum(cs.bestBaseline) + '</span>');
        html.push('  <span class="case-score">' + esc(cs.score) + '</span>');
        if (cs.error) {
          html.push('  <span class="case-err">' + esc(cs.error) + '</span>');
        }
        html.push('</div>');
      }
      html.push('</div>');
    }

    // ---- 指标对比条（以最后一个测试点为例）----
    if (res.cases.length > 0 && isFinite(res.cases[res.cases.length - 1].yourMetric)) {
      var last = res.cases[res.cases.length - 1];
      var names = [];
      var values = {};
      var k;
      for (k in last.allBaselines) {
        if (Object.prototype.hasOwnProperty.call(last.allBaselines, k)) {
          names.push(k);
          values[k] = last.allBaselines[k];
        }
      }
      values.__mine = last.yourMetric;

      var maxVal = 0;
      for (k in values) {
        if (Object.prototype.hasOwnProperty.call(values, k) && isFinite(values[k]) && values[k] > maxVal) {
          maxVal = values[k];
        }
      }
      if (maxVal <= 0) maxVal = 1;

      html.push('<div class="bars">');
      html.push('  <div class="bars-title">指标对比 · ' + esc(res.metricLabel || '') +
        '（越短越好，黄色为最优基线）</div>');

      // 你的
      html.push('  <div class="bar-row">');
      html.push('    <span class="bar-label mine">你的预测</span>');
      html.push('    <span class="bar-track"><span class="bar-fill mine" style="width:' +
        Math.min(100, (values.__mine / maxVal) * 100).toFixed(1) + '%"></span></span>');
      html.push('    <span class="bar-val">' + fmtNum(values.__mine) + '</span>');
      html.push('  </div>');

      for (var n = 0; n < names.length; n++) {
        var nm = names[n];
        var isBest = nm === last.baselineName;
        html.push('  <div class="bar-row">');
        html.push('    <span class="bar-label">' + esc(judge.baselineLabels[nm] || nm) + '</span>');
        html.push('    <span class="bar-track"><span class="bar-fill' + (isBest ? ' best' : '') +
          '" style="width:' + Math.min(100, (values[nm] / maxVal) * 100).toFixed(1) + '%"></span></span>');
        html.push('    <span class="bar-val">' + fmtNum(values[nm]) + '</span>');
        html.push('  </div>');
      }
      html.push('</div>');
    }

    host.innerHTML = html.join('\n');
  }

  /* ================================================================== *
   * 9. 题解
   * ================================================================== */

  /**
   * 在左栏底部展示参考实现。
   * @param {Object} p 题目
   */
  function showSolution(p) {
    var host = $('#solutionHost');
    if (!host) return;
    if (host.getAttribute('data-open') === '1') {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var html = [];
    html.push('<div class="solution-box">');
    html.push('  <div class="sb-head"><span>参考实现 · ' + esc(p.title) + '</span><span>' +
      esc(p.difficulty) + '</span></div>');
    html.push('  <pre><code>' + (TSJ.highlightCode ? TSJ.highlightCode(p.solution) : esc(p.solution)) + '</code></pre>');
    html.push('</div>');
    host.innerHTML = html.join('\n');
    host.setAttribute('data-open', '1');
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================================================================== *
   * 10. 提交记录页
   * ================================================================== */

  /**
   * 渲染提交记录列表。
   */
  function renderSubmissions() {
    var html = [];
    html.push('<div class="page">');
    html.push('<div class="page-head"><h1>提交记录</h1>');
    html.push('<p class="sub">本地保存最近 120 条记录（localStorage: tsoj:submissions）</p></div>');

    if (state.submissions.length === 0) {
      html.push('<div class="empty"><span class="empty-icon">◌</span>还没有提交记录。<br>' +
        '<a href="#/problems">去题库挑一道题</a></div>');
    } else {
      html.push('<div class="table-wrap"><table class="ptable"><thead><tr>');
      html.push('<th style="width:150px">时间</th><th>题目</th>');
      html.push('<th class="num" style="width:80px">分数</th>');
      html.push('<th style="width:120px">结果</th>');
      html.push('<th style="width:90px">指标</th>');
      html.push('</tr></thead><tbody>');

      for (var i = 0; i < state.submissions.length; i++) {
        var s = state.submissions[i];
        var vClass = s.verdict === 'AC' ? 'verdict-ac'
          : s.verdict === 'RE' ? 'verdict-re'
            : s.verdict === 'TLE' ? 'verdict-tle' : 'verdict-wa';
        var vText = s.verdict === 'AC' ? 'AC 通过'
          : s.verdict === 'RE' ? 'RE 运行错误'
            : s.verdict === 'TLE' ? 'TLE 超时' : 'WA 未通过';
        html.push('<tr>');
        html.push('<td class="idx">' + esc(fmtTime(s.at)) + '</td>');
        html.push('<td><a class="p-title" href="#/problem/' + esc(s.problemId) + '">' + esc(s.title) + '</a></td>');
        html.push('<td class="num">' + esc(toScore(s.score)) + '</td>');
        html.push('<td><span class="' + vClass + '" style="font-size:12.5px;font-weight:600">' + esc(vText) + '</span></td>');
        html.push('<td class="num">' + esc(s.metric || '') + '</td>');
        html.push('</tr>');
      }

      html.push('</tbody></table></div>');
    }

    html.push('</div>');
    $('#view').innerHTML = html.join('\n');
  }

  /* ================================================================== *
   * 11. 排行榜页
   * ================================================================== */

  /**
   * 计算「参考解法」虚拟选手的每题得分（同步执行可信代码，结果确定）。
   * @returns {Object} { [problemId]: score }
   */
  function computeRefScores() {
    if (state.refScores) return state.refScores;
    var map = {};
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var ds = TSJ.findDataset(p.dataset);
      if (!ds) { map[p.id] = 0; continue; }
      try {
        map[p.id] = judge.evaluateSync({ problem: p, dataset: ds, code: p.solution }).score;
      } catch (e) {
        map[p.id] = 0;
      }
    }
    state.refScores = map;
    return map;
  }

  /**
   * 渲染排行榜。
   */
  function renderRanking() {
    var refScores = computeRefScores();
    var myTotal = totalScore();
    var myPassed = 0;
    var i;

    for (i = 0; i < problems.length; i++) {
      var rec = state.progress[problems[i].id];
      if (rec && rec.passed === true) myPassed++;
    }

    var refTotal = 0;
    var refPassed = 0;
    for (i = 0; i < problems.length; i++) {
      var rs = toScore(refScores[problems[i].id]);
      refTotal += rs;
      if (rs >= problems[i].passScore) refPassed++;
    }

    var rows = [
      { name: '参考解法（Holt-Winters）', you: false, total: refTotal, passed: refPassed, note: '每题由参考实现自动评分' },
      { name: '你', you: true, total: myTotal, passed: myPassed, note: '本地成绩' }
    ];
    rows.sort(function (a, b) { return b.total - a.total; });

    var html = [];
    html.push('<div class="page">');
    html.push('<div class="page-head"><h1>排行榜</h1>');
    html.push('<p class="sub">本地榜单 · 虚拟对手「参考解法（Holt-Winters）」的每题分数由参考实现实时计算</p></div>');

    html.push('<div class="table-wrap"><table class="ptable"><thead><tr>');
    html.push('<th style="width:60px">排名</th><th>选手</th>');
    html.push('<th class="num" style="width:100px">总分</th>');
    html.push('<th class="num" style="width:100px">通过题数</th>');
    html.push('<th style="width:200px">说明</th>');
    html.push('</tr></thead><tbody>');

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var gClass = r === 0 ? ' g1' : (r === 1 ? ' g2' : ' g3');
      html.push('<tr class="' + (row.you ? 'rank-me' : '') + '">');
      html.push('<td><span class="rank-badge' + gClass + '">' + (r + 1) + '</span></td>');
      html.push('<td class="' + (row.you ? 'rank-you' : '') + '">' + esc(row.name) + '</td>');
      html.push('<td class="num">' + esc(row.total) + '</td>');
      html.push('<td class="num">' + esc(row.passed) + ' / ' + problems.length + '</td>');
      html.push('<td style="color:var(--muted);font-size:12px">' + esc(row.note) + '</td>');
      html.push('</tr>');
    }

    html.push('</tbody></table></div>');

    // 每题对比
    html.push('<h2 class="section-title">逐题最佳分对比</h2>');
    html.push('<div class="ref-grid">');
    for (var j = 0; j < problems.length; j++) {
      var p = problems[j];
      var mine = toScore(state.progress[p.id] && state.progress[p.id].best);
      var ref = toScore(refScores[p.id]);
      html.push('<div class="ref-row">');
      html.push('  <span class="rf-idx">#' + p.index + '</span>');
      html.push('  <a class="rf-name" href="#/problem/' + esc(p.id) + '" title="' + esc(p.title) + '">' +
        esc(p.title) + '</a>');
      html.push('  <span class="rf-track" title="青色=你，紫色=参考解">' +
        '<span class="rf-you" style="width:' + Math.max(0, Math.min(100, mine)) + '%"></span>' +
        '<span class="rf-ref" style="width:' + Math.max(0, Math.min(100, ref)) + '%"></span></span>');
      html.push('  <span class="rf-score">' + esc(mine) + ' / ' + esc(ref) + '</span>');
      html.push('</div>');
    }
    html.push('</div>');

    html.push('<p class="sub" style="margin-top:14px;font-size:12px">' +
      '青条 = 你的最高分，紫条 = 参考解法得分（0~100）。' +
      '总分 = 各题最高分之和，满分 ' + (problems.length * 100) + '。</p>');
    html.push('</div>');

    $('#view').innerHTML = html.join('\n');
  }

  /* ================================================================== *
   * 12. 学习路径页
   * ================================================================== */

  /**
   * 渲染学习路径时间线。
   */
  function renderPath() {
    var html = [];
    html.push('<div class="page">');
    html.push('<div class="page-head"><h1>学习路径</h1>');
    html.push('<p class="sub">从零参数基线到滚动回测：每一步都在补上一块新的建模能力</p></div>');

    html.push('<div class="timeline">');

    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var rec = state.progress[p.id] || {};
      var done = rec.passed === true;
      var best = toScore(rec.best);

      html.push('<div class="tl-item">');
      html.push('  <div class="tl-dot' + (done ? ' done' : '') + '">' + (done ? '✓' : p.index) + '</div>');
      html.push('  <div class="tl-card' + (done ? ' done' : '') + '">');
      html.push('    <div class="tl-top">');
      html.push('      <span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span>');
      html.push('      <a href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a>');
      for (var t = 0; t < p.tags.length; t++) {
        html.push('      <span class="tag">' + esc(p.tags[t]) + '</span>');
      }
      html.push('    </div>');
      html.push('    <div class="tl-desc">' + esc(pathSummary(p)) + '</div>');
      html.push('    <div class="tl-note">' + (done
        ? '已通过 · 最高分 ' + esc(best) + ' · 题解已解锁'
        : (best > 0 ? '最高分 ' + esc(best) + ' · 尚未达到通过线 ' + esc(p.passScore) : '未开始')) + '</div>');
      html.push('  </div>');
      html.push('</div>');
    }

    html.push('</div>');
    html.push('</div>');
    $('#view').innerHTML = html.join('\n');
  }

  /**
   * 为学习路径生成一句话知识点摘要。
   * @param {Object} p 题目
   * @returns {string}
   */
  function pathSummary(p) {
    var ds = TSJ.findDataset(p.dataset);
    var dsName = ds ? ds.name : p.dataset;
    return '数据集 ' + dsName + ' · ' + (MODE_LABEL[p.mode] || p.mode) +
      ' · 预测 ' + p.horizon + ' 步 · 需要打败最优基线（阈值 ' + p.threshold + '）';
  }

  /* ================================================================== *
   * 13. 引导
   * ================================================================== */

  /**
   * 首次进入时的简短引导。
   */
  function showOnboarding() {
    var overlay = $('#overlay');
    if (!overlay) return;
    overlay.innerHTML = [
      '<div class="modal">',
      '  <h2>欢迎来到时序竞技场</h2>',
      '  <div class="modal-flow">',
      '    <span class="flow-step">写 predict 函数</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">提交</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">打败基线得分</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">解锁题解</span>',
      '  </div>',
      '  <p>每道题只要实现一个函数：</p>',
      '  <p><code>predict(history, horizon, ctx) → number[]</code></p>',
      '  <ul>',
      '    <li>得分由「你的误差 ÷ 最优基线误差」决定，误差比越小分越高</li>',
      '    <li>误差比 = 0.5 得满分 100，等于阈值恰好得 60 分，≥ 2 得 0 分</li>',
      '    <li>全部测试点达标才算通过，通过后可查看参考实现</li>',
      '    <li>代码与成绩都存在浏览器本地，随时可以继续</li>',
      '  </ul>',
      '  <div class="modal-actions">',
      '    <button type="button" class="btn btn-primary" id="onbStart">开始做题</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    overlay.classList.remove('hidden');

    var btn = $('#onbStart');
    if (btn) {
      btn.addEventListener('click', function () {
        overlay.classList.add('hidden');
        writeJSON(STORE.onboarded, true);
        btn.focus();
      });
      btn.focus();
    }
  }

  /* ================================================================== *
   * 14. 启动
   * ================================================================== */

  /**
   * 应用初始化。
   */
  function init() {
    // 读出的数据一律视为不可信：先过类型守卫（不合法则丢弃并静默重写），再逐字段归一化
    state.progress = readNormalized(STORE.progress, {}, isPlainObject, normalizeProgress);
    state.drafts = readNormalized(STORE.drafts, {}, isPlainObject, normalizeDrafts);
    state.submissions = readNormalized(STORE.submissions, [], isArrayValue, normalizeSubmissions);
    var savedFilter = readJSON(STORE.filter, '全部', function (v) { return typeof v === 'string'; });
    state.filter = (['全部'].concat(DIFFS).indexOf(savedFilter) >= 0) ? savedFilter : '全部';

    global.addEventListener('hashchange', route);

    if (!global.location.hash) {
      global.location.hash = '#/problems';
    }
    route();
    updateScoreChip();

    if (readJSON(STORE.onboarded, false, function (v) { return typeof v === 'boolean'; }) !== true) showOnboarding();
  }

  init();
})(typeof window !== 'undefined' ? window : this);
