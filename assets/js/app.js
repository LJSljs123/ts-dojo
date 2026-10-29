/**
 * assets/js/app.js —— 应用外壳：路由、判题会话、启动装配
 *
 * 加载顺序（经典 script）：core → store → storage → ui → a11y → views → pages → app.js。
 * 本文件必须是**最后一个**脚本，且末尾同步调用 init()：靠「脚本位于 body 末尾」保证 DOM 已就绪，
 * 不监听任何页面加载事件。
 *
 * 路由表：
 *   #/problems            题库（搜索 / 标签 / 难度）
 *   #/methods             方法库（47 条方法卡片，按 5 个层次检索）
 *   #/method/:id          方法详情（直觉 / 公式 / 假设 / 反例 / 引用）
 *   #/glossary            术语表（新手术语速查）
 *   #/learn[/:id]         课程地图与模块页（9 模块）
 *   #/lab                 可视化实验室（受控回测）
 *   #/studio              模型工坊（自己搓模型跑完整实验）
 *   #/problem/:id         题目页（题面 + 编辑器）
 *   #/submission/<id>     提交详情（代码快照 + 逐测试点）
 *   #/submissions         提交记录（含导出 / 导入 / 清空）
 *   #/ranking             排行榜
 *   #/path                学习路径
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore, store = TSJ.appStore, storage = TSJ.appStorage;
  var ui = TSJ.appUi, a11y = TSJ.appA11y, views = TSJ.appViews, judge = TSJ.judge;
  var problem = TSJ.appProblem, pages = TSJ.appPages, library = TSJ.appLibrary;
  var boards = TSJ.appBoards, glossary = TSJ.appGlossary, theme = TSJ.appTheme;
  var lifecycle = TSJ.appLifecycle, dashboard = TSJ.appDashboard;
  var learn = TSJ.appLearn;
  var methodDetail = TSJ.appMethodDetail;
  var lab = TSJ.appLab;
  var studio = TSJ.appStudio;

  var $ = core.$;
  var esc = core.esc;
  var STORE = core.STORE;
  var state = store.state;

  /** 提交记录 id 的会话内序号（不引入随机数：数据集与判题都要求可复现） */
  var subSeq = 0;

  /* ---------- 1. 路由 ---------- */
  /**
   * 路由已抽到 app/router.js。渲染的输入是**显式路径**，不再回头读 location.hash：
   * sandbox 宿主（不透明源）里 hash 赋值既不抛错也不生效，靠 hashchange 驱动的路由
   * 会整条断掉 —— 表现就是「点哪个都没反应」。详见 router.js 头部注释。
   */
  var route = TSJ.appRouter.route;

  /* ---------- 2. 判题 ---------- */
  /** 判断某个判题会话是否已经过期（被新提交或路由切换作废）。 */
  function isStale(token, p) {
    return token !== state.judgeToken || state.activeProblem !== p;
  }

  /** 触发判题。 */
  function runJudge(p, ds, isSubmit) {
    if (!state.editor) return;
    // 同一会话内已有判题在跑 → 忽略重复点击；会话被切走后 busyToken 自动失配，新页面可立即判题
    if (state.busyToken === state.judgeToken) return;

    var code = state.editor.getValue();
    state.drafts[p.id] = code;
    store.saveDrafts();
    if (typeof state.editor.clearError === 'function') state.editor.clearError();

    var token = ++state.judgeToken;
    state.busyToken = token;
    var session = {};
    state.session = session;
    ui.setBusy(true, token);

    judge.evaluate({ problem: p, dataset: ds, code: code, session: session }).then(function (res) {
      // 首行校验会话：不匹配就整段丢弃（不碰 DOM、不写存储），旧结果绝不会落到新页面
      if (isStale(token, p)) return;
      state.busyToken = -1;
      state.session = null;
      ui.setBusy(false, token);
      state.lastResult = res;

      if (isSubmit) persistResult(p, res, code);
      ui.renderResult(res, p);
      views.paintPrediction(res, p, ds);

      // RE：把错误行标注到编辑器上（同时更新 aria-describedby 指向的说明文本）
      if (res.verdict === 'RE' && res.cases && res.cases.length > 0) {
        var line = null;
        for (var i = 0; i < res.cases.length; i++) {
          if (res.cases[i].line) { line = res.cases[i].line; break; }
        }
        if (line && state.editor) state.editor.markError(line);
      }
    }).catch(function (err) {
      if (isStale(token, p)) return;
      state.busyToken = -1;
      state.session = null;
      ui.setBusy(false, token);
      ui.renderResult({
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
   * 把判题结果写入存储（进度 + 带代码快照与逐测试点的提交记录）。
   * @param {Object} p 题目
   * @param {Object} res 判题结果
   * @param {string} code 本次提交的代码
   */
  function persistResult(p, res, code) {
    var now = Date.now();
    var rec = state.progress[p.id] || { best: 0, passed: false, attempts: 0 };
    rec.attempts = (rec.attempts || 0) + 1;
    rec.best = Math.max(rec.best || 0, res.score);
    rec.passed = !!rec.passed || !!res.passed;
    rec.lastVerdict = res.verdict;
    rec.lastAt = now;
    state.progress[p.id] = rec;
    store.saveProgress();

    // 逐测试点快照：只留 6 个字段，防止把整份报告（含 allBaselines / predictions）写进存储
    var cases = [];
    var src = res.cases || [];
    for (var i = 0; i < src.length && i < core.MAX_CASES; i++) {
      cases.push({
        index: core.toCount(src[i].index),
        verdict: src[i].verdict,
        score: core.toScore(src[i].score),
        yourMetric: core.toMetric(src[i].yourMetric),
        bestBaseline: core.toMetric(src[i].bestBaseline),
        baselineName: core.toText(src[i].baselineName)
      });
    }

    subSeq++;
    state.submissions.unshift({
      id: now + '-' + core.fnv1a(code + '|' + now + '|' + subSeq).slice(0, 8),
      at: now,
      problemId: p.id,
      title: p.title,
      score: res.score,
      verdict: res.verdict,
      passed: !!res.passed,
      metric: res.metricLabel,
      code: core.truncateCode(code),
      cases: cases,
      degraded: res.degraded === true
    });
    store.saveSubmissions();
    store.updateScoreChip();
    if (TSJ.appAchievements) TSJ.appAchievements.onJudgeResult(p, res, state.progress);  // 成就检查（首AC/连胜/满分）
    // 题头的「历史最高 / 尚未提交」必须跟着落盘结果一起刷新，否则要手动刷新页面才更新
    if (TSJ.appProblem && typeof TSJ.appProblem.refreshBestBadge === 'function') {
      TSJ.appProblem.refreshBestBadge(p);
    }

    // 通过后解锁题解按钮（查询限定在 #view 内，避免摸到别的页面的按钮）
    var view = $('#view');
    var btnSolution = view ? $('#btnSolution', view) : null;
    if (btnSolution && rec.passed) {
      btnSolution.disabled = false;
      btnSolution.removeAttribute('title');
    }
  }

  /* ---------- 3. 启动 ---------- */
  /** 绑定主题切换与移动端抽屉（只绑一次，挂在应用级 Scope 上）。 */
  function bindShell() {
    var rootScope = lifecycle.createScope('app');
    state.appScope = rootScope;

    theme.init();
    TSJ.appCmdk.install();   // Ctrl/Cmd+K 命令面板（自持监听，随页面生存）
    var btn = $('#btnTheme');
    function paintTheme() {
      if (!btn) return;
      var mode = theme.get();
      btn.textContent = mode === 'system' ? '主题：跟随系统' : (mode === 'dark' ? '主题：深色' : '主题：浅色');
      btn.setAttribute('aria-pressed', theme.resolved() === 'light' ? 'true' : 'false');
    }
    paintTheme();
    theme.onChange(paintTheme);
    rootScope.own(theme.watchSystem());

    if (btn) {
      rootScope.listen(btn, 'click', function () {
        theme.toggle();
        paintTheme();
      });
    }

    var menu = $('#btnMenu');
    var drawer = $('#drawerNav');
    function closeDrawer() {
      if (!drawer || !menu) return;
      drawer.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
    }
    if (menu && drawer) {
      rootScope.listen(menu, 'click', function () {
        var open = drawer.classList.toggle('open');
        menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      rootScope.listen(drawer, 'click', function (ev) {
        if (ev.target && ev.target.tagName === 'A') closeDrawer();
      });
      rootScope.listen(doc(), 'keydown', function (ev) {
        if (ev.key === 'Escape') closeDrawer();
      });
    }

    global.addEventListener('hashchange', route);
    // 站内链接的点击语义：srcdoc 宿主里 href="#/x" 会被解析成父页面 URL 导致整个应用被卸载
    TSJ.appLinks.bind();
  }

  function doc() { return global.document; }

  /** 应用初始化。 */
  function init() {
    // 读出的数据一律视为不可信：先过类型守卫（不合法则丢弃并静默重写），再逐字段归一化
    store.loadState();

    // 注入判题入口与刷新入口：views / pages 不反向引用 app.js，避免循环依赖
    views.bindRunner(runJudge);
    pages.bindRefresh(route);

    // 写盘失败（配额不足 / 隐私模式）→ 明确提示并降级为内存态
    core.onWriteError(function (quota) {
      state.storageOk = false;
      a11y.toast(quota ? '本地存储已满，进度未保存' : '本地存储不可用，进度仅在本次会话内有效', 'err');
    });

    // 跨标签页同步：别的页面改了 tsoj:* → 重新装载并重渲染当前视图（避免后写覆盖先写）
    store.onExternalChange(function () { route(); });
    storage.bindStorageSync();

    bindShell();

    if (!global.location.hash) global.location.hash = '#/';
    route();
    store.updateScoreChip();

    if (core.readJSON(STORE.onboarded, false, function (v) { return typeof v === 'boolean'; }) !== true) {
      problem.showOnboarding();
    }
  }

  TSJ.app = {
    route: route,
    runJudge: runJudge,
    persistResult: persistResult,
    init: init
  };

  init();
})(typeof window !== 'undefined' ? window : this);
