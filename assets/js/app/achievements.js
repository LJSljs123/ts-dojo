/**
 * assets/js/app/achievements.js —— 成就徽章系统（v3.7）
 * 加载顺序：… app/studio.js → app/achievements → app/cmdk → app.js
 * 挂载点：window.TSJ.appAchievements
 *
 * 设计原则（轻量、诚实、零后端）：
 *   - 只从「已发生的事件」推导（判题落盘、工坊运行落档），不做任何轮询；
 *   - 解锁即 toast + 落盘（tsoj:achievements:v1），工作台与命令面板可见；
 *   - 成就定义与判定函数集中在此文件，新增成就只改一处。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var KEY = core.STORE.achievements;

  /* ---------- 成就注册表 ---------- */
  var DEFS = [
    { id: 'first-ac', icon: '🥇', name: '第一个 AC', desc: '通过任意一道题。每个预测旅程都从这里开始。' },
    { id: 'streak-3', icon: '🔥', name: '三连胜', desc: '按题号连续通过 3 道题。' },
    { id: 'all-easy', icon: '🌱', name: '入门毕业', desc: '通过全部「入门」难度的题。' },
    { id: 'studio-beats-base', icon: '🛠️', name: '工坊开张', desc: '在模型工坊里让你的模型在验证集上跑赢最优基线。' },
    { id: 'honest-researcher', icon: '🧭', name: '诚实研究者', desc: '工坊最终评测：同一份代码对 test 只评了一次就定稿。' },
    { id: 'glossary-reader', icon: '📖', name: '词典编纂者', desc: '在术语表里累计搜索/查阅 20 次。' },
    { id: 'method-explorer', icon: '🗺️', name: '方法旅行家', desc: '查看过 15 个不同的方法详情页。' },
    { id: 'half-score', icon: '💎', name: '半分神话', desc: '任意一题拿到误差比 ≤ 0.5 的满分。' }
  ];

  var unlocked = null;   // { [id]: at }
  var seenMethods = null; // 方法详情浏览记录
  var glossaryLooks = 0;

  /* ---------- 存储 ---------- */
  function load() {
    if (unlocked) return;
    unlocked = core.readJSON(KEY, {}, function (v) {
      return v && typeof v === 'object' && !Array.isArray(v);
    });
    var meta = core.readJSON(core.STORE.achMeta, { methods: [], looks: 0 }, function (v) {
      return v && typeof v === 'object' && !Array.isArray(v);
    });
    seenMethods = Array.isArray(meta.methods) ? meta.methods.slice(0, 60) : [];
    glossaryLooks = typeof meta.looks === 'number' && meta.looks > 0 ? Math.min(9999, Math.floor(meta.looks)) : 0;
  }

  function persistMeta() {
    core.writeJSON(core.STORE.achMeta, { methods: seenMethods, looks: glossaryLooks });
  }

  /* ---------- 解锁 ---------- */
  /** 解锁成就：toast + 落盘（重复解锁幂等）。 */
  function unlock(id) {
    load();
    if (unlocked[id]) return;
    var def = null;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) def = DEFS[i];
    if (!def) return;
    unlocked[id] = Date.now();
    core.writeJSON(KEY, unlocked);
    if (TSJ.appA11y) TSJ.appA11y.toast('🏆 成就解锁：' + def.name + ' — ' + def.desc, 'ok');
  }

  /* ---------- 事件入口（由 app 层在恰当时机调用） ---------- */

  /** 判题落盘后：检查首 AC / 连胜 / 入门毕业 / 半分神话。 */
  function onJudgeResult(problem, result, allProgress) {
    load();
    if (!result) return;
    if (result.passed) {
      unlock('first-ac');
      // 半分神话：整题满分（误差比 ≤ 0.5 → 100 分），不是某个测试点满分
      if (result.score === 100) unlock('half-score');
      // 连胜：按题号检查连续通过（宽松定义：已通过的题里存在连续 3 个 index）
      var passedIdx = [];
      var probs = TSJ.problems || [];
      for (var i = 0; i < probs.length; i++) {
        var rec = allProgress[probs[i].id];
        if (rec && rec.passed) passedIdx.push(probs[i].index);
      }
      passedIdx.sort(function (a, b) { return a - b; });
      var run = 1;
      for (i = 1; i < passedIdx.length; i++) {
        run = passedIdx[i] === passedIdx[i - 1] + 1 ? run + 1 : 1;
        if (run >= 3) { unlock('streak-3'); break; }
      }
      // 入门毕业
      var easyAll = true;
      for (i = 0; i < probs.length; i++) {
        if (probs[i].difficulty === '入门') {
          var r2 = allProgress[probs[i].id];
          if (!r2 || !r2.passed) { easyAll = false; break; }
        }
      }
      if (easyAll) unlock('all-easy');
    }
  }

  /** 工坊运行落档后：kind='val' 检查跑赢基线；kind='final' 检查诚实研究者。 */
  function onStudioRun(record) {
    load();
    if (!record) return;
    function bestOf(b) {
      var best = null;
      Object.keys(b || {}).forEach(function (k) {
        var v = b[k] && b[k].mse;
        if (typeof v === 'number' && isFinite(v) && (best === null || v < best)) best = v;
      });
      return best;
    }
    if (record.kind === 'val') {
      var mine = record.valMetrics && record.valMetrics.mse;
      var base = bestOf(record.baselinesVal);
      if (typeof mine === 'number' && typeof base === 'number' && mine < base) unlock('studio-beats-base');
    }
    if (record.kind === 'final' && record.testRuns === 1) unlock('honest-researcher');
  }

  /** 方法详情页浏览（method-detail 渲染时调用）。 */
  function onMethodView(id) {
    load();
    if (seenMethods.indexOf(id) < 0) {
      seenMethods.push(id);
      if (seenMethods.length > 60) seenMethods.shift();
      persistMeta();
    }
    var count = 0;
    for (var i = 0; i < seenMethods.length; i++) {
      if (TSJ.methodsById && TSJ.methodsById(seenMethods[i])) count++;
    }
    if (count >= 15) unlock('method-explorer');
  }

  /** 术语表查阅（glossary 渲染/搜索时调用，一次路由进入算一次）。 */
  function onGlossaryLook() {
    load();
    glossaryLooks++;
    persistMeta();
    if (glossaryLooks >= 20) unlock('glossary-reader');
  }

  /* ---------- 查询 ---------- */
  /** 全部成就状态（供工作台/命令面板渲染）。 */
  function status() {
    load();
    return DEFS.map(function (d) {
      return { id: d.id, icon: d.icon, name: d.name, desc: d.desc, at: unlocked[d.id] || null };
    });
  }

  function count() {
    load();
    var n = 0;
    Object.keys(unlocked).forEach(function (k) { if (unlocked[k]) n++; });
    return n;
  }

  TSJ.appAchievements = {
    DEFS: DEFS,
    onJudgeResult: onJudgeResult,
    onStudioRun: onStudioRun,
    onMethodView: onMethodView,
    onGlossaryLook: onGlossaryLook,
    status: status,
    count: count
  };
})(typeof window !== 'undefined' ? window : this);
