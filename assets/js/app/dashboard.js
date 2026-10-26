/**
 * assets/js/app/dashboard.js —— 工作台 #/
 *
 * 只汇总本机真实数据：学习进度、做题进度、最近提交、最近实验。
 * 不显示营销大屏，也不把本地统计说成在线排行。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var esc = core.esc;

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function readProgress() {
    return core.readJSON(core.STORE.courseProgress, {}, function (v) {
      return v && typeof v === 'object' && !Array.isArray(v);
    });
  }

  function doneCount(p) {
    var n = 0;
    for (var i = 0; i < TSJ.courses.length; i++) {
      if (p && p[TSJ.courses[i].id] && p[TSJ.courses[i].id].done) n++;
    }
    return n;
  }

  function nextLesson() {
    var prog = readProgress();
    var sorted = TSJ.courses.slice().sort(function (a, b) { return a.index - b.index; });
    for (var i = 0; i < sorted.length; i++) {
      if (!(prog[sorted[i].id] && prog[sorted[i].id].done)) return sorted[i];
    }
    return null;
  }

  function recentSubmissions(n) {
    return (store.state.submissions || []).slice().sort(function (a, b) { return b.at - a.at; }).slice(0, n || 5);
  }

  function recentExperiments(n) {
    return TSJ.appLabStorage.list().slice(0, n || 5);
  }

  /** SVG 进度环（0~100%）。 */
  function ringSvg(pct, label, sub) {
    var r = 34;
    var circ = 2 * Math.PI * r;
    var off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return '<svg class="wk-ring" viewBox="0 0 84 84" role="img" aria-label="' + esc(label + ' ' + sub) + '">' +
      '<circle class="wk-ring-bg" cx="42" cy="42" r="' + r + '"></circle>' +
      '<circle class="wk-ring-fg" cx="42" cy="42" r="' + r + '" stroke-dasharray="' + circ.toFixed(1) +
      '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
      '<text x="42" y="40" class="wk-ring-num">' + esc(label) + '</text>' +
      '<text x="42" y="56" class="wk-ring-sub">' + esc(sub) + '</text></svg>';
  }

  /** 「学习进度」卡：进度环 + 分难度条 + 关键数字（数据全部来自本机 state）。 */
  function overviewCard(state) {
    var total = TSJ.problems.length;
    var passed = 0;
    var attempts = 0;
    var byDiff = {};
    var i;
    for (i = 0; i < core.DIFFS.length; i++) byDiff[core.DIFFS[i]] = { done: 0, total: 0 };
    for (i = 0; i < TSJ.problems.length; i++) {
      var p = TSJ.problems[i];
      var rec = state.progress[p.id];
      if (byDiff[p.difficulty]) byDiff[p.difficulty].total++;
      if (rec && rec.passed) {
        passed++;
        attempts += rec.attempts || 0;
        if (byDiff[p.difficulty]) byDiff[p.difficulty].done++;
      }
    }
    var pct = total ? Math.round((passed / total) * 100) : 0;
    var bars = core.DIFFS.map(function (d) {
      var b = byDiff[d];
      var w = b.total ? Math.round((b.done / b.total) * 100) : 0;
      return '<div class="wk-dbar"><span class="wk-dbar-name">' + esc(d) + '</span>' +
        '<span class="wk-dbar-track"><span class="wk-dbar-fill" style="width:' + w + '%"></span></span>' +
        '<span class="wk-dbar-n">' + b.done + '/' + b.total + '</span></div>';
    }).join('');
    var courseDone = doneCount(readProgress());
    return '<div class="ds-card"><h2 class="ds-card-title">学习进度</h2><p class="ds-card-sub">数据只保存在当前浏览器。</p>' +
      '<div class="wk-overview">' + ringSvg(pct, passed + '/' + total, '已通过') +
      '<div class="wk-overview-main">' + bars +
      '<div class="wk-mini-stats"><span>课程 ' + courseDone + ' / ' + TSJ.courses.length + '</span>' +
      '<span>提交 ' + attempts + ' 次</span><span>等级分 ' + (state.totalScore || 0) + '</span></div>' +
      '</div></div></div>';
  }

  /** 成就徽章卡：已解锁高亮，未解锁灰置（悬停看解锁条件）。 */
  function achievementsCard() {
    if (!TSJ.appAchievements) return '';
    var st = TSJ.appAchievements.status();
    var n = TSJ.appAchievements.count();
    var chips = st.map(function (a) {
      return '<span class="wk-ach' + (a.at ? ' wk-ach-on' : '') + '" title="' +
        esc(a.name + '：' + a.desc + (a.at ? '（已解锁）' : '（未解锁）')) + '">' +
        a.icon + ' ' + esc(a.name) + '</span>';
    }).join('');
    return '<div class="ds-card"><h2 class="ds-card-title">成就 <span class="ds-badge">' + n + ' / ' + st.length + '</span></h2>' +
      '<div class="wk-ach-row">' + chips + '</div></div>';
  }

  function render(scope) {
    var state = store.state;
    var lesson = nextLesson();
    var subs = recentSubmissions(5);
    var labs = recentExperiments(5);

    var html = [
      '<div class="wk-hero">',
      '  <div class="wk-hero-main">',
      '    <div class="wk-kicker">TSOJ v3 · 研究工作台</div>',
      '    <h1>看数据、选方法、回测、诊断、复盘</h1>',
      '    <p>先用基线与评估建立可靠判断，再进入高阶方法。所有实验都固定数据版本、切分协议与指标；本地进度可导出，换机器不丢记录。</p>',
      '    <div class="wk-cta-row">',
      '      <a class="ds-btn ds-btn-primary" href="#/lab">进入可视化实验室</a>',
      lesson ? '<a class="ds-btn" href="#/learn/' + encodeURIComponent(lesson.id) + '">继续学习：' + esc(lesson.title) + '</a>' : '<a class="ds-btn" href="#/learn">查看课程地图</a>',
      '      <a class="ds-btn" href="#/methods">浏览方法库</a>',
      '      <a class="ds-btn" href="#/glossary">新手术语表</a>',
      '    </div>',
      '  </div>',
      '  <div class="wk-side-stack">',
      overviewCard(state),
      achievementsCard(),
      '    <div class="ds-card"><h2 class="ds-card-title">快速入口</h2><div class="wk-list">',
      '      <a class="wk-list-item" href="#/problems"><span class="wk-list-main"><b>题库</b><span>' + TSJ.problems.length + ' 道可判题练习</span></span><span class="ds-badge">去练习</span></a>',
      '      <a class="wk-list-item" href="#/learn/m0"><span class="wk-list-main"><b>零基础第一课</b><span>25 分钟：从看懂一条曲线到写出第一个 predict</span></span><span class="ds-badge">去入门</span></a>',
      '      <a class="wk-list-item" href="#/learn"><span class="wk-list-main"><b>课程</b><span>9 个模块与先修路径</span></span><span class="ds-badge">去学习</span></a>',
      '      <a class="wk-list-item" href="#/glossary"><span class="wk-list-main"><b>术语表</b><span>题面与课程里的行话速查</span></span><span class="ds-badge">去查阅</span></a>',
      '      <a class="wk-list-item" href="#/studio"><span class="wk-list-main"><b>模型工坊</b><span>自己搓一个模型，跑完验证/最终两阶段实验</span></span><span class="ds-badge">去搓模型</span></a>',
      '      <a class="wk-list-item" href="#/submissions"><span class="wk-list-main"><b>提交记录</b><span>代码快照与逐测试点复盘</span></span><span class="ds-badge">去复盘</span></a>',
      '    </div></div>',
      '  </div>',
      '</div>',

      '<div class="wk-grid-2">',
      '  <div class="ds-card"><h2 class="ds-card-title">最近提交</h2><p class="ds-card-sub">点开可看当时的代码与逐测试点。</p>',
      subs.length ? '<div class="wk-list">' + subs.map(function (s) {
        return '<a class="wk-list-item" href="#/submission/' + encodeURIComponent(s.id) + '"><span class="wk-list-main"><b>' + esc(s.title) + '</b><span>' + fmtTime(s.at) + ' · ' + esc(s.verdict) + '</span></span><span class="ds-badge">' + s.score + ' 分</span></a>';
      }).join('') + '</div>' : '<div class="ds-empty"><strong>还没有提交</strong><span>从第 1 题或模板开始，先建立基线直觉。</span><a class="ds-btn" href="#/problem/p1-naive">打开第 1 题</a></div>',
      '  </div>',
      '  <div class="ds-card"><h2 class="ds-card-title">最近实验</h2><p class="ds-card-sub">实验室配置与结果保存在本机，可复现。</p>',
      labs.length ? '<div class="lab-history">' + labs.map(function (r) {
        var m = r.metrics && r.metrics.mean || {};
        var first = Object.keys(m)[0];
        return '<div class="lab-history-item"><span>' + esc(r.config.datasetId) + ' · ' + esc(r.config.method) + '</span><span>' + (first ? (first.toUpperCase() + ' ' + m[first].toFixed(2)) : '—') + '</span></div>';
      }).join('') + '</div>' : '<div class="ds-empty"><strong>还没有实验</strong><span>选一个数据集和方法，先跑一次受控回测。</span><a class="ds-btn" href="#/lab">打开实验室</a></div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.getElementById('view').innerHTML = html;
    TSJ.appA11y.setTitle('工作台 · TSOJ');
  }

  TSJ.appDashboard = { render: render };
})(typeof window !== 'undefined' ? window : this);
