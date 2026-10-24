/**
 * assets/js/app/store.js —— 应用状态与派生数据
 *
 * 加载顺序：core → store → ui → views → app.js
 * 挂载点：window.TSJ.appStore
 *
 * 分工：
 *   - `state` 是所有可变状态的**唯一**持有者（含判题会话令牌）；
 *   - 派生量（累计分 / 等级 / 每题统计 / 参考解分数）都是纯函数，输入只来自 state；
 *   - 后续里程碑（进度导出/导入、清空）在这里扩展，读写一律走 core 的 STORE 常量。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
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
    editor: null,
    activeProblem: null,
    /** 单调递增的判题会话令牌 */
    judgeToken: 0,
    /** 当前会话里在跑的判题令牌；-1 表示空闲（等于 judgeToken 即「有判题在跑」） */
    busyToken: -1,
    /** 当前判题会话句柄（含 abort()），路由切换时用来 terminate 旧 Worker */
    session: null,
    lastResult: null,
    refScores: null
  };

  /** 从 localStorage 装载状态（读出的数据一律视为不可信：先守卫、再归一化）。 */
  function loadState() {
    state.progress = core.readNormalized(
      core.STORE.progress, {}, core.isPlainObject, core.normalizeProgress);
    state.drafts = core.readNormalized(
      core.STORE.drafts, {}, core.isPlainObject, core.normalizeDrafts);
    state.submissions = core.readNormalized(
      core.STORE.submissions, [], core.isArrayValue, core.normalizeSubmissions);
    var savedFilter = core.readJSON(core.STORE.filter, '全部', function (v) {
      return typeof v === 'string';
    });
    var allowed = ['全部'].concat(core.DIFFS);
    state.filter = allowed.indexOf(savedFilter) >= 0 ? savedFilter : '全部';
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
    var links = document.querySelectorAll('#nav a');
    for (var i = 0; i < links.length; i++) {
      var isOn = links[i].getAttribute('data-nav') === name;
      if (isOn) links[i].classList.add('on');
      else links[i].classList.remove('on');
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

  TSJ.appStore = {
    state: state,
    loadState: loadState,
    totalScore: totalScore,
    levelOf: levelOf,
    problemStats: problemStats,
    updateScoreChip: updateScoreChip,
    setActiveNav: setActiveNav,
    computeRefScores: computeRefScores,
    pathSummary: pathSummary
  };
})(typeof window !== 'undefined' ? window : this);
