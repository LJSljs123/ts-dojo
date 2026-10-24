/**
 * assets/js/app.js —— 应用外壳：路由、判题会话、三个列表页（提交记录/排行榜/学习路径）、启动
 *
 * 加载顺序（经典 script）：core → store → ui → views → app.js。本文件必须是**最后一个**脚本，
 * 且末尾同步调用 init()：靠「脚本位于 body 末尾」保证 DOM 已就绪，不监听任何页面加载事件。
 *
 * 三个列表页是纯数据表格/时间线、由路由直接产出，因此留在外壳层；views.js 只放有交互的
 * 题库页与题目页，这样五个文件都能守住 ≤350 行的可维护性上限。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var ui = TSJ.appUi;
  var views = TSJ.appViews;
  var judge = TSJ.judge;
  var problems = TSJ.problems;

  var $ = core.$;
  var esc = core.esc;
  var toScore = core.toScore;
  var writeJSON = core.writeJSON;
  var fmtTime = core.fmtTime;
  var STORE = core.STORE;
  var DIFF_CLASS = core.DIFF_CLASS;
  var state = store.state;

  /* ---------- 1. 路由 ---------- */
  /** 解析 hash 并渲染对应视图。 */
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

    // 作废旧判题会话：令牌自增让在途回调全部失配（整段丢弃），并立刻 terminate 旧 Worker。
    // 注意：这里**不**重置任何「忙」布尔量 —— 忙闲由 token 判定，重置布尔量正是旧竞态的根源。
    state.judgeToken++;
    if (state.session && typeof state.session.abort === 'function') {
      state.session.abort();
    }
    state.session = null;
    state.busyToken = -1;

    if (view === 'problem' && parts[1]) {
      store.setActiveNav('problems');
      views.renderProblem(parts[1]);
    } else if (view === 'submissions') {
      store.setActiveNav('submissions');
      renderSubmissions();
    } else if (view === 'ranking') {
      store.setActiveNav('ranking');
      renderRanking();
    } else if (view === 'path') {
      store.setActiveNav('path');
      renderPath();
    } else {
      store.setActiveNav('problems');
      views.renderProblemList();
    }

    store.updateScoreChip();
    global.scrollTo(0, 0);
  }

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
    writeJSON(STORE.drafts, state.drafts);
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

      if (isSubmit) persistResult(p, res);
      ui.renderResult(res, p);
      ui.paintPrediction(res, p, ds);

      // RE：把错误行标注到编辑器上
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

  /** 把判题结果写入 localStorage（进度 + 提交记录）。 */
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

    store.updateScoreChip();

    // 通过后解锁题解按钮（查询限定在 #view 内，避免摸到别的页面的按钮）
    var view = $('#view');
    var btnSolution = view ? $('#btnSolution', view) : null;
    if (btnSolution && rec.passed) {
      btnSolution.disabled = false;
      btnSolution.removeAttribute('title');
    }
  }

  /* ---------- 3. 提交记录页 ---------- */
  /** 渲染提交记录列表。 */
  function renderSubmissions() {
    var html = [];
    html.push('<div class="page">\n<div class="page-head"><h1>提交记录</h1>');
    html.push('<p class="sub">本地保存最近 120 条记录（localStorage: tsoj:submissions）</p></div>');

    if (state.submissions.length === 0) {
      html.push('<div class="empty"><span class="empty-icon">◌</span>还没有提交记录。<br>' +
        '<a href="#/problems">去题库挑一道题</a></div>');
    } else {
      html.push('<div class="table-wrap"><table class="ptable"><thead><tr>');
      html.push('<th style="width:150px">时间</th><th>题目</th>\n<th class="num" style="width:80px">分数</th>');
      html.push('<th style="width:120px">结果</th>\n<th style="width:90px">指标</th>' + '\n' + '</tr></thead><tbody>');

      for (var i = 0; i < state.submissions.length; i++) {
        var s = state.submissions[i];
        var vClass = s.verdict === 'AC' ? 'verdict-ac'
          : s.verdict === 'RE' ? 'verdict-re'
            : s.verdict === 'TLE' ? 'verdict-tle' : 'verdict-wa';
        var vText = s.verdict === 'AC' ? 'AC 通过'
          : s.verdict === 'RE' ? 'RE 运行错误'
            : s.verdict === 'TLE' ? 'TLE 超时' : 'WA 未通过';
        html.push('<tr>' + '\n' + '<td class="idx">' + esc(fmtTime(s.at)) + '</td>');
        html.push('<td><a class="p-title" href="#/problem/' + esc(s.problemId) + '">' + esc(s.title) + '</a></td>');
        html.push('<td class="num">' + esc(toScore(s.score)) + '</td>');
        html.push('<td><span class="' + vClass + '" style="font-size:12.5px;font-weight:600">' + esc(vText) + '</span></td>');
        html.push('<td class="num">' + esc(s.metric || '') + '</td>' + '\n' + '</tr>');
      }

      html.push('</tbody></table></div>');
    }

    html.push('</div>');
    $('#view').innerHTML = html.join('\n');
  }

  /* ---------- 4. 排行榜页 ---------- */
  /** 渲染排行榜。 */
  function renderRanking() {
    var refScores = store.computeRefScores();
    var myTotal = store.totalScore();
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
    html.push('<div class="page">\n<div class="page-head"><h1>排行榜</h1>');
    html.push('<p class="sub">本地榜单 · 虚拟对手「参考解法（Holt-Winters）」的每题分数由参考实现实时计算</p></div>');

    html.push('<div class="table-wrap"><table class="ptable"><thead><tr>\n<th style="width:60px">排名</th><th>选手</th>');
    html.push('<th class="num" style="width:100px">总分</th>\n<th class="num" style="width:100px">通过题数</th>');
    html.push('<th style="width:200px">说明</th>\n</tr></thead><tbody>');

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var gClass = r === 0 ? ' g1' : (r === 1 ? ' g2' : ' g3');
      html.push('<tr class="' + (row.you ? 'rank-me' : '') + '">');
      html.push('<td><span class="rank-badge' + gClass + '">' + (r + 1) + '</span></td>');
      html.push('<td class="' + (row.you ? 'rank-you' : '') + '">' + esc(row.name) + '</td>');
      html.push('<td class="num">' + esc(row.total) + '</td>');
      html.push('<td class="num">' + esc(row.passed) + ' / ' + problems.length + '</td>');
      html.push('<td style="color:var(--muted);font-size:12px">' + esc(row.note) + '</td>' + '\n' + '</tr>');
    }

    html.push('</tbody></table></div>');

    // 每题对比
    html.push('<h2 class="section-title">逐题最佳分对比</h2>\n<div class="ref-grid">');
    for (var j = 0; j < problems.length; j++) {
      var p = problems[j];
      var mine = toScore(state.progress[p.id] && state.progress[p.id].best);
      var ref = toScore(refScores[p.id]);
      html.push('<div class="ref-row">' + '\n' + '  <span class="rf-idx">#' + p.index + '</span>');
      html.push('  <a class="rf-name" href="#/problem/' + esc(p.id) + '" title="' + esc(p.title) + '">' +
        esc(p.title) + '</a>');
      html.push('  <span class="rf-track" title="青色=你，紫色=参考解">' +
        '<span class="rf-you" style="width:' + Math.max(0, Math.min(100, mine)) + '%"></span>' +
        '<span class="rf-ref" style="width:' + Math.max(0, Math.min(100, ref)) + '%"></span></span>');
      html.push('  <span class="rf-score">' + esc(mine) + ' / ' + esc(ref) + '</span>' + '\n' + '</div>');
    }
    html.push('</div>');

    html.push('<p class="sub" style="margin-top:14px;font-size:12px">' +
      '青条 = 你的最高分，紫条 = 参考解法得分（0~100）。' +
      '总分 = 各题最高分之和，满分 ' + (problems.length * 100) + '。</p>');
    html.push('</div>');

    $('#view').innerHTML = html.join('\n');
  }

  /* ---------- 5. 学习路径页 ---------- */
  /** 渲染学习路径时间线。 */
  function renderPath() {
    var html = [];
    html.push('<div class="page">\n<div class="page-head"><h1>学习路径</h1>');
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
      html.push('    <div class="tl-desc">' + esc(store.pathSummary(p)) + '</div>');
      html.push('    <div class="tl-note">' + (done
        ? '已通过 · 最高分 ' + esc(best) + ' · 题解已解锁'
        : (best > 0 ? '最高分 ' + esc(best) + ' · 尚未达到通过线 ' + esc(p.passScore) : '未开始')) + '</div>');
      html.push('  </div>\n</div>');
    }

    html.push('</div>\n</div>');
    $('#view').innerHTML = html.join('\n');
  }

  /* ---------- 6. 启动 ---------- */
  /** 应用初始化。 */
  function init() {
    // 读出的数据一律视为不可信：先过类型守卫（不合法则丢弃并静默重写），再逐字段归一化
    store.loadState();

    // 注入判题入口：views 不反向引用 app.js，避免循环依赖
    views.bindRunner(runJudge);

    global.addEventListener('hashchange', route);

    if (!global.location.hash) {
      global.location.hash = '#/problems';
    }
    route();
    store.updateScoreChip();

    if (core.readJSON(STORE.onboarded, false, function (v) { return typeof v === 'boolean'; }) !== true) {
      views.showOnboarding();
    }
  }

  TSJ.app = {
    route: route,
    runJudge: runJudge,
    init: init
  };

  init();
})(typeof window !== 'undefined' ? window : this);
