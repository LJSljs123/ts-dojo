/**
 * assets/js/app/store.js —— 应用状态、派生数据与写盘策略
 *
 * 加载顺序：core → store → storage → ui → a11y → views → pages → app.js
 * 挂载点：window.TSJ.appStore
 *
 * 分工：
 *   - `state` 是所有可变状态的**唯一**持有者（含判题会话令牌、图表 hover 句柄、题库筛选条件）；
 *   - 派生量（累计分 / 等级 / 每题统计 / 参考解分数）都是纯函数，输入只来自 state；
 *   - 写盘一律走 save*()：**先读盘、再合并、后写回**，避免两个标签页「后写覆盖先写」；
 *   - 导入 / 导出 / 清空在 app/storage.js，这里只提供合并所需的纯函数。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var schema = TSJ.appSchema;
  var problems = TSJ.problems;

  /**
   * 全局可变状态（不持久化部分）。
   *
   * judgeToken / busyToken 是判题会话隔离的核心：
   *   - 每次提交分配 `token = ++judgeToken`；
   *   - 回调首行比对 `token === judgeToken && activeProblem === p`，不匹配整段丢弃；
   *   - route() 只自增 judgeToken（作废旧会话），**不**重置任何布尔量 ——
   *     旧实现用布尔 `running`，被 route() 重置后守卫失效，导致 A 题结果画到 B 题。
   */
  var state = {
    progress: {},
    drafts: {},
    submissions: [],
    filter: '全部',
    /** 题库搜索词（T09）：默认空串 —— 默认态必须无预置搜索词，否则题库不是 9 行 */
    query: '',
    /** 题库标签筛选（T09）：默认 null 表示「全部标签」 */
    tag: null,
    editor: null,
    activeProblem: null,
    /** 单调递增的判题会话令牌 */
    judgeToken: 0,
    /** 当前会话里在跑的判题令牌；-1 表示空闲（等于 judgeToken 即「有判题在跑」） */
    busyToken: -1,
    /** 当前判题会话句柄（含 abort()），路由切换时用来 terminate 旧 Worker */
    session: null,
    lastResult: null,
    refScores: null,
    /** 当前页图表 hover 句柄（T08）：路由切换必须 destroy()，否则监听会累积 */
    chartHover: null,
    /** 编辑器字号（T10）：12 / 13 / 14 */
    edFont: 13,
    /** 本地存储是否可用（配额不足时为 false，界面降级为内存态） */
    storageOk: true
  };

  /** 外部变更回调（storage 事件触发，由 app 层注册用于重渲染当前视图） */
  var externalHandler = null;

  /**
   * 注册「存储被其它标签页改写」回调。
   * @param {Function} fn function(kind:string)
   */
  function onExternalChange(fn) {
    externalHandler = typeof fn === 'function' ? fn : null;
  }

  /** 从 localStorage 装载状态（读出的数据一律视为不可信：先守卫、再归一化）。 */
  function loadState() {
    state.progress = core.readNormalized(
      core.STORE.progress, {}, core.isPlainObject, schema.normalizeProgress);
    state.drafts = core.readNormalized(
      core.STORE.drafts, {}, core.isPlainObject, schema.normalizeDrafts);
    state.submissions = core.readNormalized(
      core.STORE.submissions, [], core.isArrayValue, schema.normalizeSubmissions);
    var savedFilter = core.readJSON(core.STORE.filter, '全部', function (v) {
      return typeof v === 'string';
    });
    var allowed = ['全部'].concat(core.DIFFS);
    state.filter = allowed.indexOf(savedFilter) >= 0 ? savedFilter : '全部';

    // 存储格式版本：缺失时补写当前版本（旧数据本身已由归一化兼容，无需迁移）
    var savedSchema = core.readJSON(core.STORE.schema, 0, function (v) {
      return typeof v === 'number';
    });
    if (savedSchema !== core.CURRENT_SCHEMA) core.writeJSON(core.STORE.schema, core.CURRENT_SCHEMA);

    var font = core.readJSON(core.STORE.edFont, 13, function (v) {
      return typeof v === 'number';
    });
    state.edFont = (font === 12 || font === 13 || font === 14) ? font : 13;
    // 装载后回写一次归一化结果：保证「界面字号」与「存储值」始终一致（首次运行也会落盘）
    core.writeJSON(core.STORE.edFont, state.edFont);
  }

  /** 累计等级分 = 各题历史最高分之和。 */
  function totalScore() {
    var sum = 0;
    for (var i = 0; i < problems.length; i++) {
      var rec = state.progress[problems[i].id];
      if (rec) sum += core.toScore(rec.best);
    }
    return sum;
  }

  /** 由累计分推等级。 */
  function levelOf(score) {
    return Math.max(1, Math.floor(score / 150) + 1);
  }

  /** 某题的本地统计（无本地记录时用题目自带通过率）。 */
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

  /** 更新顶部等级分胶囊。 */
  function updateScoreChip() {
    var total = totalScore();
    var lvEl = core.$('#lvText');
    var ptsEl = core.$('#ptsText');
    if (lvEl) lvEl.textContent = 'Lv.' + levelOf(total);
    if (ptsEl) ptsEl.textContent = total + ' 分';
  }

  /** 高亮当前导航项。 */
  function setActiveNav(name) {
    var links = document.querySelectorAll('#nav a, #drawerNav a');
    for (var i = 0; i < links.length; i++) {
      var isOn = links[i].getAttribute('data-nav') === name;
      links[i].classList.toggle('on', isOn);
      if (isOn) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  /** 计算「参考解法」虚拟选手的每题得分（同步执行可信代码，结果确定且带缓存）。 */
  function computeRefScores() {
    if (state.refScores) return state.refScores;
    var map = {};
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var ds = TSJ.findDataset(p.dataset);
      if (!ds) { map[p.id] = 0; continue; }
      try {
        map[p.id] = TSJ.judge.evaluateSync({ problem: p, dataset: ds, code: p.solution }).score;
      } catch (e) {
        map[p.id] = 0;
      }
    }
    state.refScores = map;
    return map;
  }

  /** 为学习路径生成一句话知识点摘要。 */
  function pathSummary(p) {
    var ds = TSJ.findDataset(p.dataset);
    var dsName = ds ? ds.name : p.dataset;
    return '数据集 ' + dsName + ' · ' + (core.MODE_LABEL[p.mode] || p.mode) +
      ' · 预测 ' + p.horizon + ' 步 · 需要打败最优基线（阈值 ' + p.threshold + '）';
  }

  /* ---------- 写盘策略 ---------- */

  /**
   * 合并两份进度表（本地写盘用）：同一题取更优记录，不重复累加 attempts。
   * @param {Object} disk 盘上的进度
   * @param {Object} mem 内存里的进度
   * @returns {Object}
   */
  function mergeProgressForWrite(disk, mem) {
    var out = {};
    var id;
    for (id in disk) {
      if (Object.prototype.hasOwnProperty.call(disk, id)) out[id] = disk[id];
    }
    for (id in mem) {
      if (!Object.prototype.hasOwnProperty.call(mem, id)) continue;
      var a = out[id];
      var b = mem[id];
      if (!a) { out[id] = b; continue; }
      out[id] = {
        best: Math.max(core.toScore(a.best), core.toScore(b.best)),
        passed: a.passed === true || b.passed === true,
        attempts: Math.max(core.toCount(a.attempts), core.toCount(b.attempts)),
        lastVerdict: core.toTime(b.lastAt) >= core.toTime(a.lastAt) ? b.lastVerdict : a.lastVerdict,
        lastAt: Math.max(core.toTime(a.lastAt), core.toTime(b.lastAt))
      };
    }
    return out;
  }

  /**
   * 合并两份进度表（导入用）：best = max(旧,新)、attempts = 旧+新、passed = 或。
   * @param {Object} oldP 现有进度
   * @param {Object} newP 导入的进度
   * @returns {Object}
   */
  function mergeProgressForImport(oldP, newP) {
    var out = {};
    var id;
    for (id in oldP) {
      if (Object.prototype.hasOwnProperty.call(oldP, id)) out[id] = oldP[id];
    }
    for (id in newP) {
      if (!Object.prototype.hasOwnProperty.call(newP, id)) continue;
      var a = out[id];
      var b = newP[id];
      if (!a) { out[id] = b; continue; }
      var newer = core.toTime(b.lastAt) >= core.toTime(a.lastAt) ? b : a;
      out[id] = {
        best: Math.max(core.toScore(a.best), core.toScore(b.best)),
        passed: a.passed === true || b.passed === true,
        attempts: core.toCount(a.attempts) + core.toCount(b.attempts),
        lastVerdict: newer.lastVerdict,
        lastAt: Math.max(core.toTime(a.lastAt), core.toTime(b.lastAt))
      };
    }
    return out;
  }

  /**
   * 合并提交记录：按 id 去重（新的覆盖旧的），按时间倒序，截断到 120 条。
   * @param {Array} oldList 现有记录
   * @param {Array} newList 新记录
   * @returns {Array}
   */
  function mergeSubmissions(oldList, newList) {
    var seen = {};
    var out = [];
    var i;
    var src = (newList || []).concat(oldList || []);
    for (i = 0; i < src.length; i++) {
      var s = src[i];
      if (!s || !s.id || seen[s.id]) continue;
      seen[s.id] = true;
      out.push(s);
    }
    out.sort(function (x, y) { return y.at - x.at; });
    if (out.length > core.MAX_SUBMISSIONS) out.length = core.MAX_SUBMISSIONS;
    return out;
  }

  /** 写进度：先读盘合并，再写回（避免覆盖其它标签页刚写入的记录）。 */
  function saveProgress() {
    var disk = schema.normalizeProgress(core.readJSON(core.STORE.progress, {}, core.isPlainObject));
    state.progress = mergeProgressForWrite(disk, state.progress);
    var ok = core.writeJSON(core.STORE.progress, state.progress);
    state.storageOk = ok;
    return ok;
  }

  /** 写草稿：草稿是「本机最新意图」，直接整表写回。 */
  function saveDrafts() {
    var ok = core.writeJSON(core.STORE.drafts, state.drafts);
    state.storageOk = ok;
    return ok;
  }

  /** 写提交记录：先读盘合并去重，再写回。 */
  function saveSubmissions() {
    var disk = schema.normalizeSubmissions(core.readJSON(core.STORE.submissions, [], core.isArrayValue));
    state.submissions = mergeSubmissions(disk, state.submissions);
    var ok = core.writeJSON(core.STORE.submissions, state.submissions);
    state.storageOk = ok;
    return ok;
  }

  /** 保存编辑器字号。 */
  function saveEdFont(size) {
    state.edFont = (size === 12 || size === 13 || size === 14) ? size : 13;
    return core.writeJSON(core.STORE.edFont, state.edFont);
  }

  /**
   * 外部（其它标签页）改写存储后重新装载。
   * @returns {boolean} 是否真的读到了变化
   */
  function reloadFromStorage() {
    var before = '';
    var after = '';
    try {
      before = JSON.stringify([state.progress, state.drafts, state.submissions]);
    } catch (e) {
      before = '';
    }
    state.progress = core.readNormalized(
      core.STORE.progress, {}, core.isPlainObject, schema.normalizeProgress);
    state.drafts = core.readNormalized(
      core.STORE.drafts, {}, core.isPlainObject, schema.normalizeDrafts);
    state.submissions = core.readNormalized(
      core.STORE.submissions, [], core.isArrayValue, schema.normalizeSubmissions);
    try {
      after = JSON.stringify([state.progress, state.drafts, state.submissions]);
    } catch (e) {
      after = '';
    }
    return before !== after;
  }

  /** 清空内存态（清空进度后调用；storage 侧由 app/storage.js 负责删除键）。 */
  function resetState() {
    state.progress = {};
    state.drafts = {};
    state.submissions = [];
    state.filter = '全部';
    state.query = '';
    state.tag = null;
    state.lastResult = null;
    state.refScores = null;
  }

  /** 触发外部变更回调（storage 事件用）。 */
  function notifyExternal(kind) {
    if (externalHandler) externalHandler(kind);
  }

  TSJ.appStore = {
    state: state,
    onExternalChange: onExternalChange,
    loadState: loadState,
    totalScore: totalScore,
    levelOf: levelOf,
    problemStats: problemStats,
    updateScoreChip: updateScoreChip,
    setActiveNav: setActiveNav,
    computeRefScores: computeRefScores,
    pathSummary: pathSummary,
    mergeProgressForWrite: mergeProgressForWrite,
    mergeProgressForImport: mergeProgressForImport,
    mergeSubmissions: mergeSubmissions,
    saveProgress: saveProgress,
    saveDrafts: saveDrafts,
    saveSubmissions: saveSubmissions,
    saveEdFont: saveEdFont,
    reloadFromStorage: reloadFromStorage,
    resetState: resetState,
    notifyExternal: notifyExternal
  };
})(typeof window !== 'undefined' ? window : this);
