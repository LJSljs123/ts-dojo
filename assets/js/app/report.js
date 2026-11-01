/**
 * assets/js/app/report.js —— 学习报告 #/report（v3.11）
 * 加载顺序：… app/boards → app/report.js → app/cmdk → app.js　挂载点：window.TSJ.appReport
 *
 * 只汇总本机真实数据（题目进度 / 提交分布 / 工坊泛化差距 / 功能使用），产出「建议下一步」。
 * 不做排名、不评价人——所有结论都可由页面上的原始数字直接验证。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var esc = core.esc;

  function $(sel, root) { return (root || global.document).querySelector(sel); }

  /** 难度段通过率（含薄弱段识别：通过率最低且已开始的那一档）。 */
  function difficultyBars(state) {
    var rows = core.DIFFS.map(function (d) {
      var total = 0, done = 0;
      for (var i = 0; i < TSJ.problems.length; i++) {
        if (TSJ.problems[i].difficulty !== d) continue;
        total++;
        var rec = state.progress[TSJ.problems[i].id];
        if (rec && rec.passed) done++;
      }
      return { d: d, done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
    }).filter(function (r) { return r.total > 0; });
    var weakest = null;
    rows.forEach(function (r) {
      if (r.done < r.total && (weakest === null || r.pct < weakest.pct)) weakest = r;
    });
    var html = rows.map(function (r) {
      return '<div class="wk-dbar"><span class="wk-dbar-name">' + esc(r.d) + '</span>' +
        '<span class="wk-dbar-track"><span class="wk-dbar-fill" style="width:' + r.pct + '%"></span></span>' +
        '<span class="wk-dbar-n">' + r.done + '/' + r.total + '</span></div>';
    }).join('');
    var note = weakest
      ? '<p class="ds-card-sub">薄弱段：<b>' + esc(weakest.d) + '</b>（' + weakest.done + '/' + weakest.total +
        '）——建议回到该段未通过题目的「提示」而不是看题解。</p>'
      : '<p class="ds-card-sub">还没有可分析的进度：先去通过第一道题。</p>';
    return { bars: html, note: note, weakest: weakest };
  }

  /** 提交 verdict 分布（最近 50 条）。 */
  function verdictBars() {
    var subs = (store.state.submissions || []).slice(0, 50);
    var order = ['AC', 'WA', 'RE', 'TLE'];
    var cnt = { AC: 0, WA: 0, RE: 0, TLE: 0 };
    subs.forEach(function (s) { if (cnt[s.verdict] != null) cnt[s.verdict]++; });
    var total = subs.length || 1;
    var cls = { AC: 'vm-ac', WA: 'vm-wa', RE: 'vm-re', TLE: 'vm-tle' };
    var bars = order.map(function (v) {
      var pct = Math.round((cnt[v] / total) * 100);
      return '<div class="wk-dbar"><span class="wk-dbar-name">' + v + '</span>' +
        '<span class="wk-dbar-track"><span class="wk-dbar-fill' + (v !== 'AC' && v !== 'WA' ? ' wk-dbar-bad' : '') +
        '" style="width:' + pct + '%"></span></span>' +
        '<span class="wk-dbar-n">' + cnt[v] + '</span></div>';
    }).join('');
    var advise = '';
    if (cnt.RE + cnt.TLE > 0 && cnt.RE + cnt.TLE >= cnt.AC) {
      advise = '<p class="ds-card-sub">RE/TLE 占比偏高：先在本地把语法、返回长度、死循环这三件事过一遍再提交——' +
        '它们都不是「模型不行」，是「代码没跑对」。</p>';
    }
    return { bars: bars, advise: advise, total: subs.length };
  }

  /** 工坊泛化差距：同代码哈希既有 val 又有 final 的记录，test/val 比值。 */
  function generalizationRows() {
    var list = TSJ.appStudioStorage ? TSJ.appStudioStorage.list() : [];
    var byHash = {};
    list.forEach(function (r) {
      if (!byHash[r.codeHash]) byHash[r.codeHash] = {};
      byHash[r.codeHash][r.kind] = r;
    });
    var rows = [];
    Object.keys(byHash).forEach(function (h) {
      var pair = byHash[h];
      if (!pair.val || !pair.final) return;
      var vm = pair.val.valMetrics && pair.val.valMetrics.mse;
      var tm = pair.final.testMetrics && pair.final.testMetrics.mse;
      if (!(isFinite(vm) && isFinite(tm) && vm > 0)) return;
      rows.push({ hash: h, datasetId: pair.final.datasetId, val: vm, test: tm, ratio: tm / vm });
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio; });
    return rows.slice(0, 6);
  }

  function render(scope) {
    var state = store.state;
    var passed = 0, attempts = 0;
    for (var id in state.progress) {
      if (state.progress[id].passed) passed++;
      attempts += state.progress[id].attempts || 0;
    }
    var total = TSJ.problems.length;
    var diff = difficultyBars(state);
    var vd = verdictBars();
    var gen = generalizationRows();

    // 建议下一步
    var nextProblem = null;
    for (var i = 0; i < TSJ.problems.length; i++) {
      var rec = state.progress[TSJ.problems[i].id];
      if (!rec || !rec.passed) { nextProblem = TSJ.problems[i]; break; }
    }
    var tried = {
      lab: !!core.readJSON(core.STORE.lab, null, function () { return true; }),
      studio: (TSJ.appStudioStorage ? TSJ.appStudioStorage.list() : []).length > 0,
      csv: !!core.readJSON(core.STORE.studioCsv, null, function () { return true; }),
      backupExport: !!(TSJ.appAchievements && TSJ.appAchievements.status().filter(function (a) { return a.id === 'archivist' && a.at; }).length)
    };
    var nextFeat = !tried.lab ? ['实验室', '#/lab', '不写代码先看方法跑出来的样子']
      : !tried.studio ? ['模型工坊', '#/studio', '自己搓一个模型跑完 val/test 全流程']
      : !tried.csv ? ['上传 CSV', '#/studio', '用工坊分析你自己的真实数据']
      : !tried.backupExport ? ['导出全量备份', '#/submissions', '进度/成就/实验一次打包带走']
      : null;

    var genHtml = gen.length
      ? '<div class="ds-table-wrap"><table class="ds-table ds-table-hover"><thead><tr>' +
        '<th>代码</th><th>数据集</th><th class="num">val MSE</th><th class="num">test MSE</th><th class="num">test/val</th>' +
        '</tr></thead><tbody>' + gen.map(function (g) {
          var hot = g.ratio > 1.5 ? ' style="color:var(--v3-err)"' : '';
          return '<tr><td>' + esc(g.hash) + '</td><td>' + esc(g.datasetId) + '</td>' +
            '<td class="num">' + g.val.toFixed(1) + '</td><td class="num">' + g.test.toFixed(1) + '</td>' +
            '<td class="num"' + hot + '>' + g.ratio.toFixed(2) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="ds-card-sub">test/val &gt; 1.5（标红）说明你在 val 上选了过拟合的方案——m7 的数据窥探一课说的就是它。</p>'
      : '<div class="ds-empty"><strong>还没有可分析的工坊实验</strong><span>同一份代码跑完 ① 验证集与 ② 最终评测后，这里会给出泛化差距。</span></div>';

    var featHtml = nextFeat
      ? '<a class="wk-list-item" href="' + nextFeat[1] + '"><span class="wk-list-main"><b>' + esc(nextFeat[0]) +
        '</b><span>' + esc(nextFeat[2]) + '</span></span><span class="ds-badge">去尝试</span></a>'
      : '<p class="ds-card-sub">全部能力都已用过——剩下的只有把题做完和把模型调好。</p>';

    var html = [
      '<div class="wk-hero wk-hero-slim"><div class="wk-hero-main">',
      '  <div class="wk-kicker">学习报告</div>',
      '  <h1>数字不会说谎：你的薄弱点在哪</h1>',
      '  <p>全部结论来自本机数据（进度 / 提交 / 工坊记录），每个数字都能在对应页面里亲手验证。</p>',
      '  <div class="wk-cta-row">',
      nextProblem ? '<a class="ds-btn ds-btn-primary" href="#/problem/' + esc(nextProblem.id) + '">下一题：#' +
        nextProblem.index + ' ' + esc(nextProblem.title) + '</a>' : '<a class="ds-btn ds-btn-primary" href="#/problems">题库</a>',
      '  </div></div></div>',
      '<div class="wk-grid-2">',
      '  <div class="ds-card"><h2 class="ds-card-title">难度段通过率</h2>' + diff.bars + diff.note + '</div>',
      '  <div class="ds-card"><h2 class="ds-card-title">提交结果分布' +
        (vd.total ? '（最近 ' + vd.total + ' 条）' : '') + '</h2>' + vd.bars + vd.advise + '</div>',
      '</div>',
      '<div class="ds-card"><h2 class="ds-card-title">工坊泛化差距（val → test）</h2>' + genHtml + '</div>',
      '<div class="ds-card"><h2 class="ds-card-title">建议下一步</h2><div class="wk-list">' + featHtml + '</div></div>'
    ].join('\n');

    var view = global.document.getElementById('view');
    if (view) view.innerHTML = html;
    TSJ.appA11y.setTitle('学习报告 · TSOJ');
  }

  TSJ.appReport = { render: render };
})(typeof window !== 'undefined' ? window : this);
