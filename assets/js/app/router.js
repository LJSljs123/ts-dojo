/**
 * assets/js/app/router.js —— 路由：按「显式路径」渲染，地址栏只是尽力同步
 *
 * 为什么要把渲染和 hash 解耦（这是真缺陷，不是洁癖）：
 *
 *   应用用 hash 做路由。传统写法是「改 hash → 监听 hashchange → 读 hash 渲染」，
 *   渲染的**唯一输入**是 `location.hash`。这条链在一种宿主里会整条断掉：
 *
 *     <iframe sandbox="allow-scripts">   ← 不透明源，预览面板常用
 *
 *   实测：点顶栏「题库」，`location.hash` 赋值既不抛错也不生效（地址栏停在
 *   `about:srcdoc#/`），于是没有 hashchange、没有渲染 —— 用户看到的是
 *   **「点了没一个能用」**。而主题按钮（纯 DOM 操作、不碰地址栏）在同一宿主里
 *   工作正常，这个对比直接指出问题在路由链路上。
 *
 *   所以这里把两件事拆开：
 *     - `render(parts)`  渲染的唯一入口，输入是**路径数组**，不读地址栏；
 *     - `navigate(href)` 先尽量同步地址栏（try/catch 包住），再直接渲染。
 *   地址栏同步失败时，前进/后退与刷新会不准 —— 但**页面能用**。可用性优先于
 *   地址栏一致性，这个取舍是刻意的。
 *
 * 去重：`navigate` 记录 `currentPath`，点当前所在页的导航项直接返回，不重渲染
 * （重渲染会重建编辑器、丢掉未提交的代码）。
 *
 * 另：`hashchange` 仍保留为入口，浏览器前进/后退、手改地址、其它脚本改 hash
 * 都要能走通。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 当前已渲染的路径（形如 `#/problems`），用于 navigate 去重。 */
  var currentPath = null;

  /** navigate 自己改的 hash：随后的那次 hashchange 不必再渲染一遍。 */
  var skipHash = null;

  /** 是否还在首次渲染（首次渲染不把焦点交给 #view）。 */
  var firstRoute = true;

  /**
   * 把 `#/problem/p1` / `problem/p1` / `#/` 解析成路径段数组。
   *
   * @param {string} href 地址或路径
   * @returns {string[]} 路径段（已过滤空段）
   */
  function parse(href) {
    return String(href || '')
      .replace(/^#/, '')
      .replace(/^\//, '')
      .split('/')
      .filter(function (s) { return s.length > 0; });
  }

  /** 路径段 → 规范地址（`#/` 或 `#/a/b`）。 */
  function toHash(parts) {
    return parts.length ? '#/' + parts.join('/') : '#/';
  }

  /**
   * 按路径段渲染视图。**唯一**的渲染入口。
   *
   * @param {string[]} parts 路径段
   */
  function render(parts) {
    var store = TSJ.appStore, a11y = TSJ.appA11y, lifecycle = TSJ.appLifecycle;
    var state = store.state;
    var problem = TSJ.appProblem, pages = TSJ.appPages, boards = TSJ.appBoards;
    var library = TSJ.appLibrary, glossary = TSJ.appGlossary;
    var learn = TSJ.appLearn, methodDetail = TSJ.appMethodDetail;
    var lab = TSJ.appLab, studio = TSJ.appStudio, dashboard = TSJ.appDashboard;
    var views = TSJ.appViews;

    currentPath = toHash(parts);

    var view = parts[0] || 'dashboard';

    // 路由级生命周期：新 Scope 建立前先销毁旧页面的监听 / 图表 / 定时器
    var scope = lifecycle.createScope('route');
    if (state.routeScope && typeof state.routeScope.destroy === 'function') state.routeScope.destroy();
    state.routeScope = scope;

    // 切换路由前销毁旧编辑器与旧图表 hover 句柄（否则 pointermove 监听会累积）
    if (state.editor && typeof state.editor.destroy === 'function') state.editor.destroy();
    state.editor = null;
    if (state.chartHover && typeof state.chartHover.destroy === 'function') state.chartHover.destroy();
    state.chartHover = null;
    state.activeProblem = null;
    state.lastResult = null;

    // 作废旧判题会话：令牌自增让在途回调全部失配（整段丢弃），并立刻 terminate 旧 Worker。
    // 注意：这里**不**重置任何「忙」布尔量 —— 忙闲由 token 判定，重置布尔量正是旧竞态的根源。
    state.judgeToken++;
    if (state.session && typeof state.session.abort === 'function') state.session.abort();
    state.session = null;
    state.busyToken = -1;

    // 路由切换时如果有弹层打开，先关掉（避免弹层浮在新页面上）
    if (a11y.modalOpen()) a11y.closeModal();
    document.body.classList.remove('dragging');   // 分栏拖拽中途切路由：DOM 已换、pointerup 不再触发，摘掉防光标困住

    if (view === 'problem' && parts[1]) {
      var p = TSJ.findProblem(decodeURIComponent(parts[1]));
      store.setActiveNav('problems');
      problem.renderProblem(parts[1], scope);
      a11y.setTitle(p ? p.title : '题目不存在');
    } else if (view === 'submission' && parts[1]) {
      store.setActiveNav('submissions');
      pages.renderSubmissionDetail(decodeURIComponent(parts[1]));
      a11y.setTitle('提交详情');
    } else if (view === 'submissions') {
      store.setActiveNav('submissions');
      pages.renderSubmissions();
      a11y.setTitle('提交记录');
    } else if (view === 'ranking' || view === 'path') {
      store.setActiveNav(view);
      if (view === 'ranking') { boards.renderRanking(); a11y.setTitle('排行榜'); }
      else { boards.renderPath(); a11y.setTitle('学习路径'); }
    } else if (view === 'methods' && parts[1]) {
      store.setActiveNav('methods');
      methodDetail.render(decodeURIComponent(parts[1]), scope);
    } else if (view === 'methods') {
      store.setActiveNav('methods');
      library.renderMethods();
      a11y.setTitle('方法库');
    } else if (view === 'glossary') {
      store.setActiveNav('glossary');
      glossary.renderGlossary();
      a11y.setTitle('术语表');
    } else if (view === 'learn' && parts[1]) {
      store.setActiveNav('learn');
      learn.renderModule(decodeURIComponent(parts[1]), scope);
    } else if (view === 'learn') {
      store.setActiveNav('learn');
      learn.renderMap(scope);
    } else if (view === 'lab') {
      store.setActiveNav('lab');
      lab.render(scope);
    } else if (view === 'studio') {
      store.setActiveNav('studio');
      studio.render(scope);
    } else if (view === 'dashboard') {
      store.setActiveNav('dashboard');
      dashboard.render(scope);
    } else {
      store.setActiveNav('problems');
      views.renderProblemList();
      a11y.setTitle('题库');
    }

    store.updateScoreChip();
    global.scrollTo(0, 0);
    // 首屏不抢焦点：focusView 是为了让读屏用户知道「内容已更新」，
    // 但首次渲染时页面本来就在最上面，抢焦点会让顺序导航从 #view 开始，
    // 于是「跳到主要内容」这个第一个可聚焦元素被甩在身后，等于没有跳转链接。
    if (!firstRoute) a11y.focusView();
    firstRoute = false;
  }

  /**
   * 按当前地址栏渲染（hashchange / 前进后退 / 外部改 hash 的入口）。
   */
  function route() {
    var hash = global.location.hash || '#/';
    // navigate 已经同步渲染过，这次 hashchange 是它自己触发的，跳过
    if (skipHash !== null && hash === skipHash) {
      skipHash = null;
      return;
    }
    skipHash = null;
    render(parse(hash));
  }

  /**
   * 跳到某个地址。**先渲染，再尽力同步地址栏** —— 地址栏同步失败不影响页面可用。
   *
   * @param {string} href 形如 `#/problems`（也接受 `problems` / `#/`）
   * @returns {boolean} 是否发生了渲染（同路由返回 false）
   */
  function navigate(href) {
    var parts = parse(href);
    var want = toHash(parts);
    if (want === currentPath) return false;   // 已在该路由：不重渲染（会重建编辑器、丢草稿）

    if (global.location.hash !== want) {
      skipHash = want;
      try {
        global.location.hash = want;
      } catch (e) {
        // 不透明源（sandbox 无 allow-same-origin）里可能不允许改 hash。
        // 此时地址栏不同步，但页面照常渲染 —— 可用性优先。
        skipHash = null;
      }
    }
    render(parts);
    return true;
  }

  TSJ.appRouter = {
    parse: parse,
    render: render,
    route: route,
    navigate: navigate,
    /** 当前路径（只读，供测试与调试） */
    current: function () { return currentPath; }
  };
})(typeof window !== 'undefined' ? window : this);
