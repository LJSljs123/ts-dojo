/**
 * assets/js/app/boards.js —— 两个只读看板：排行榜 / 学习路径
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → boards → app.js
 * 挂载点：window.TSJ.appBoards
 *
 * 这两页没有任何写操作，纯粹是「state → HTML」的映射，因此和「有导入/清空动作」的 pages.js 分开，
 * 各自都能守住可维护性上限。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var problems = TSJ.problems;

  var $ = core.$;
  var esc = core.esc;
  var toScore = core.toScore;
  var DIFF_CLASS = core.DIFF_CLASS;

  /* ---------- 1. 排行榜 ---------- */
  /** 渲染排行榜（参考解法 vs 你）。 */
  function renderRanking() {
    var refScores = store.computeRefScores();
    var myTotal = store.totalScore();
    var myPassed = 0;
    var refTotal = 0;
    var refPassed = 0;
    var i;

    for (i = 0; i < problems.length; i++) {
      var rec = store.state.progress[problems[i].id];
      if (rec && rec.passed === true) myPassed++;
      var rs = toScore(refScores[problems[i].id]);
      refTotal += rs;
      if (rs >= problems[i].passScore) refPassed++;
    }

    var rows = [
      { name: '参考解法（各题参考实现）', you: false, total: refTotal, passed: refPassed, note: '每题由参考实现自动评分' },
      { name: '你', you: true, total: myTotal, passed: myPassed, note: '本地成绩' }
    ];
    rows.sort(function (a, b) { return b.total - a.total; });

    var html = [];
    html.push('<div class="page">\n<div class="page-head"><h1>排行榜</h1>' +
      '<p class="sub">本地榜单 · 虚拟对手「参考解法」的每题分数由该题参考实现实时计算（各题参考实现不同，并非单一模型）</p></div>');

    html.push('<div class="table-wrap"><table class="ptable"><thead><tr>\n<th style="width:60px">排名</th><th>选手</th>' +
      '<th class="num" style="width:100px">总分</th>\n<th class="num" style="width:100px">通过题数</th>' +
      '<th style="width:200px">说明</th>\n</tr></thead><tbody>');

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var gClass = r === 0 ? ' g1' : (r === 1 ? ' g2' : ' g3');
      html.push('<tr class="' + (row.you ? 'rank-me' : '') + '">' +
        '<td><span class="rank-badge' + gClass + '">' + (r + 1) + '</span></td>' +
        '<td class="' + (row.you ? 'rank-you' : '') + '">' + esc(row.name) + '</td>' +
        '<td class="num">' + esc(row.total) + '</td>' +
        '<td class="num">' + esc(row.passed) + ' / ' + problems.length + '</td>' +
        '<td style="color:var(--muted);font-size:12px">' + esc(row.note) + '</td>\n</tr>');
    }
    html.push('</tbody></table></div>');

    // 每题对比
    html.push('<h2 class="section-title">逐题最佳分对比</h2>\n<div class="ref-grid">');
    for (var j = 0; j < problems.length; j++) {
      var p = problems[j];
      var mine = toScore(store.state.progress[p.id] && store.state.progress[p.id].best);
      var ref = toScore(refScores[p.id]);
      html.push('<div class="ref-row">\n  <span class="rf-idx">#' + p.index + '</span>' +
        '  <a class="rf-name" href="#/problem/' + esc(p.id) + '" title="' + esc(p.title) + '">' +
        esc(p.title) + '</a>');
      html.push('  <span class="rf-track" title="青色=你，紫色=参考解">' +
        '<span class="rf-you" style="width:' + Math.max(0, Math.min(100, mine)) + '%"></span>' +
        '<span class="rf-ref" style="width:' + Math.max(0, Math.min(100, ref)) + '%"></span></span>');
      html.push('  <span class="rf-score">' + esc(mine) + ' / ' + esc(ref) + '</span>\n</div>');
    }
    html.push('</div>');

    html.push('<p class="sub" style="margin-top:14px;font-size:12px">' +
      '青条 = 你的最高分，紫条 = 参考解法得分（0~100）。' +
      '总分 = 各题最高分之和，满分 ' + (problems.length * 100) + '。</p>');
    html.push('</div>');

    $('#view').innerHTML = html.join('\n');
  }

  /* ---------- 2. 学习路径 ---------- */
  /** 渲染学习路径时间线。 */
  function renderPath() {
    var html = [];
    html.push('<div class="page">\n<div class="page-head"><h1>学习路径</h1>' +
      '<p class="sub">从零参数基线到滚动回测：每一步都在补上一块新的建模能力</p></div>\n<div class="timeline">');

    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var rec = store.state.progress[p.id] || {};
      var done = rec.passed === true;
      var best = toScore(rec.best);

      html.push('<div class="tl-item">' +
        '  <div class="tl-dot' + (done ? ' done' : '') + '">' + (done ? '✓' : p.index) + '</div>' +
        '  <div class="tl-card' + (done ? ' done' : '') + '">' +
        '    <div class="tl-top">' +
        '<span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span>' +
        '<a href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a>');
      for (var t = 0; t < p.tags.length; t++) {
        html.push('      <span class="tag">' + esc(p.tags[t]) + '</span>');
      }
      html.push('    </div>\n    <div class="tl-desc">' + esc(store.pathSummary(p)) + '</div>');
      html.push('    <div class="tl-note">' + (done
        ? '已通过 · 最高分 ' + esc(best) + ' · 题解已解锁'
        : (best > 0 ? '最高分 ' + esc(best) + ' · 尚未达到通过线 ' + esc(p.passScore) : '未开始')) + '</div>');
      html.push('  </div>\n</div>');
    }

    html.push('</div>\n</div>');
    $('#view').innerHTML = html.join('\n');
  }

  TSJ.appBoards = {
    renderRanking: renderRanking,
    renderPath: renderPath
  };
})(typeof window !== 'undefined' ? window : this);
