/**
 * assets/js/app/views.js —— 题库页（搜索 / 标签 / 难度 / 随机一题）与判题入口注入
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → app.js。
 * 依赖方向单向：views 可用 core / store / storage / ui / a11y，但**不能**直接引用 app.js 的
 * route / runJudge —— 判题回调由 app.js 启动时用 bindRunner() 注入，因此不存在反向依赖与循环依赖。
 * 题目页在 app/problem.js（那里要用到这里的 invokeRunner）。
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
  var STORE = core.STORE;
  var DIFF_CLASS = core.DIFF_CLASS;

  /** 由 app.js 注入的判题入口：function(problem, dataset, isSubmit) */
  var runner = null;

  /** 注入判题入口（app.js 启动时调用一次）。 */
  function bindRunner(fn) {
    runner = typeof fn === 'function' ? fn : null;
  }

  /** 触发判题（未注入时静默忽略，保证 views 可独立渲染）。 */
  function invokeRunner(p, ds, isSubmit) {
    if (runner) runner(p, ds, isSubmit);
  }

  /* ---------- 1. 筛选条件 ---------- */
  /** 汇总所有题目标签（去重，保持首次出现顺序）。 */
  function allTags() {
    var seen = {};
    var out = [];
    for (var i = 0; i < problems.length; i++) {
      for (var t = 0; t < problems[i].tags.length; t++) {
        var tag = problems[i].tags[t];
        if (!seen[tag]) { seen[tag] = true; out.push(tag); }
      }
    }
    return out;
  }

  /** 难度 + 标签 + 搜索词三者取交集。 */
  function matches(p) {
    var st = store.state;
    var q = String(st.query || '').trim().toLowerCase();
    if (q) {
      var hay = (p.id + ' ' + p.title + ' ' + p.tags.join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (st.tag && p.tags.indexOf(st.tag) < 0) return false;
    if (st.filter !== '全部' && p.difficulty !== st.filter) return false;
    return true;
  }

  /* ---------- 2. 题库页 ---------- */
  /** 渲染题库页（外壳只渲染一次，筛选变化只重绘列表区）。 */
  function renderProblemList() {
    var view = $('#view');
    var st = store.state;
    var html = [];
    html.push('<div class="page">\n<div class="page-head">\n<h1>题库</h1>');
    html.push('<p class="sub">共 ' + problems.length + ' 题 · 写一个 predict 函数，打败统计基线即可得分，通过后解锁题解</p>\n</div>');

    html.push('<div class="toolbar-row">');
    html.push('  <input type="search" class="search-input" id="searchInput" placeholder="搜索题号 / 标题 / 标签"' +
      ' aria-label="搜索题目" value="' + esc(st.query) + '">');
    html.push('  <button type="button" class="btn btn-random" id="btnRandom" title="优先从还没通过的题目里抽一题">随机一题</button>');
    html.push('  <button type="button" class="btn" id="btnTagToggle" aria-expanded="true" aria-controls="tagCloud">标签筛选</button>');
    html.push('  <button type="button" class="btn btn-clear" id="btnClearFilters" hidden>清除筛选</button>');
    html.push('</div>');

    html.push('<div class="filters" role="group" aria-label="按难度筛选">');
    var options = ['全部'].concat(core.DIFFS);
    for (var f = 0; f < options.length; f++) {
      var on = st.filter === options[f] ? ' chip-on' : '';
      html.push('<button type="button" class="chip' + on + '" data-filter="' + esc(options[f]) + '">' +
        esc(options[f]) + '</button>');
    }
    html.push('</div>');

    html.push('<div class="tag-cloud" id="tagCloud" role="group" aria-label="按标签筛选">');
    var tags = allTags();
    for (var g = 0; g < tags.length; g++) {
      var tagOn = st.tag === tags[g] ? ' on' : '';
      html.push('<button type="button" class="tag-chip' + tagOn + '" data-tag="' + esc(tags[g]) + '">' +
        esc(tags[g]) + '</button>');
    }
    html.push('</div>');

    html.push('<div id="listHost"></div>\n</div>');
    view.innerHTML = html.join('\n');

    bindShell(view);
    paintList();
  }

  /** 绑定题库页外壳交互（搜索框 / 难度 / 标签 / 随机一题）。 */
  function bindShell(view) {
    var input = $('#searchInput', view);
    if (input) {
      var onType = core.debounce(function () {
        store.state.query = input.value;
        paintList();
      }, 120);
      input.addEventListener('input', onType);
    }

    var chips = core.$$('.chip[data-filter]', view);
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        store.state.filter = this.getAttribute('data-filter');
        core.writeJSON(STORE.filter, store.state.filter);
        paintChips();
        paintList();
      });
    }

    var tagChips = core.$$('.tag-chip', view);
    for (var t = 0; t < tagChips.length; t++) {
      tagChips[t].addEventListener('click', function () {
        var tag = this.getAttribute('data-tag');
        store.state.tag = store.state.tag === tag ? null : tag;
        paintChips();
        paintList();
      });
    }

    var btnRandom = $('#btnRandom', view);
    if (btnRandom) btnRandom.addEventListener('click', goRandom);

    // 标签云在窄屏默认折叠，保证首屏先给「继续做题」入口；桌面默认展开
    var tagCloud = $('#tagCloud', view);
    var tagToggle = $('#btnTagToggle', view);
    if (tagCloud && tagToggle) {
      var narrow = !!(global.matchMedia && global.matchMedia('(max-width: 640px)').matches);
      function setTagCloud(open) {
        tagCloud.hidden = !open;
        tagToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      setTagCloud(!narrow);
      tagToggle.addEventListener('click', function () {
        setTagCloud(tagCloud.hidden);
      });
    }

    var btnClear = $('#btnClearFilters', view);
    if (btnClear) btnClear.addEventListener('click', clearFilters);
  }

  /** 当前是否有任何筛选条件生效（搜索词 / 标签 / 难度）。 */
  function hasActiveFilter() {
    var st = store.state;
    return String(st.query || '').trim() !== '' || st.tag !== null || st.filter !== '全部';
  }

  /** 一键清除所有筛选条件，回到默认态。 */
  function clearFilters() {
    store.state.query = '';
    store.state.tag = null;
    store.state.filter = '全部';
    core.writeJSON(STORE.filter, '全部');
    var input = $('#searchInput');
    if (input) input.value = '';
    paintChips();
    paintList();
  }

  /** 同步「清除筛选」按钮的可见性（有筛选才出现，避免常驻干扰）。 */
  function syncClearBtn() {
    var btn = $('#btnClearFilters');
    if (!btn) return;
    if (hasActiveFilter()) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  /** 同步 chip / tag-chip 的选中态（不重绘列表）。 */
  function paintChips() {
    var view = $('#view');
    if (!view) return;
    var chips = core.$$('.chip[data-filter]', view);
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-filter') === store.state.filter;
      chips[i].classList[on ? 'add' : 'remove']('chip-on');
    }
    var tagChips = core.$$('.tag-chip', view);
    for (var t = 0; t < tagChips.length; t++) {
      var tagOn = tagChips[t].getAttribute('data-tag') === store.state.tag;
      tagChips[t].classList[tagOn ? 'add' : 'remove']('on');
    }
  }

  /** 重绘列表区（桌面表格 .prow + 窄屏卡片 .pcard，两份 DOM 由同一循环产出）。 */
  function paintList() {
    var host = $('#listHost');
    if (!host) return;
    var html = [];
    html.push('<div class="table-wrap list-table">\n<table class="ptable"><thead><tr>');
    html.push('<th style="width:64px">编号</th><th>标题</th><th style="width:76px">难度</th>');
    html.push('<th style="width:250px">标签</th><th style="width:62px">状态</th>');
    html.push('<th class="num" style="width:72px">最高分</th><th class="num" style="width:72px">通过率</th>');
    html.push('</tr></thead><tbody>');

    var shown = 0;
    var cards = [];
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      if (!matches(p)) continue;
      shown++;

      var rec = store.state.progress[p.id] || {};
      var best = toScore(rec.best);
      var stats = store.problemStats(p);
      var tags = '';
      for (var t = 0; t < p.tags.length; t++) tags += '<span class="tag">' + esc(p.tags[t]) + '</span>';
      var status = rec.passed === true
        ? '<span class="status-ok" title="已通过">✓</span>'
        : '<span class="status-no" title="未通过">—</span>';

      html.push('<tr class="prow" tabindex="0" data-id="' + esc(p.id) + '">\n<td class="idx">#' + p.index + '</td>');
      html.push('<td><a class="p-title" href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a></td>');
      html.push('<td><span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span></td>\n<td>' + tags + '</td>');
      html.push('<td>' + status + '</td>');
      html.push('<td class="num">' + (best > 0 ? esc(best) : '—') + '</td>\n<td class="num">' + esc(stats.rate) + '%</td>\n</tr>');

      cards.push('<article class="pcard" tabindex="0" data-id="' + esc(p.id) + '">');
      cards.push('  <div class="pc-head"><span class="pc-idx">#' + p.index + '</span>' +
        '<a class="p-title" href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a></div>');
      cards.push('  <div class="pc-tags">' + tags + '</div>');
      cards.push('  <div class="pc-foot"><span class="badge ' + DIFF_CLASS[p.difficulty] + '">' +
        esc(p.difficulty) + '</span><span class="pc-stat">最高分 ' + (best > 0 ? esc(best) : '—') +
        '</span><span class="pc-stat">通过率 ' + esc(stats.rate) + '%</span><span class="pc-stat">' + status + '</span></div>');
      cards.push('</article>');
    }

    if (shown === 0) {
      html.push('<tr><td colspan="7"><div class="empty">没有符合条件的题目。<br>' +
        '<button type="button" class="btn" data-clear="1">清除筛选</button></div></td></tr>');
    }
    html.push('</tbody></table>\n</div>');

    var cardHtml = ['<div class="pcards">'];
    cardHtml.push(shown === 0
      ? '<div class="empty">没有符合条件的题目。<br><button type="button" class="btn" data-clear="1">清除筛选</button></div>'
      : cards.join('\n'));
    cardHtml.push('</div>');
    html.push(cardHtml.join('\n'));

    host.innerHTML = html.join('\n');
    bindRows(host);

    var inlineClears = core.$$('[data-clear]', host);
    for (var c = 0; c < inlineClears.length; c++) {
      inlineClears[c].addEventListener('click', clearFilters);
    }
    syncClearBtn();
  }

  /** 绑定列表行 / 卡片的点击与键盘操作。 */
  function bindRows(host) {
    var rows = core.$$('.prow, .pcard', host);
    for (var r = 0; r < rows.length; r++) {
      rows[r].addEventListener('click', function (ev) {
        // 标题本身是 <a>，交给浏览器处理
        if (ev.target && ev.target.tagName === 'A') return;
        global.location.hash = '#/problem/' + this.getAttribute('data-id');
      });
      rows[r].addEventListener('keydown', function (ev) {
        if (ev.target && ev.target.tagName === 'A') return;
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          global.location.hash = '#/problem/' + this.getAttribute('data-id');
        }
      });
    }
  }

  /** 随机一题：优先从「还没通过」的题目里抽，全部通过后全量随机。 */
  function goRandom() {
    var pool = [];
    var i;
    for (i = 0; i < problems.length; i++) {
      var rec = store.state.progress[problems[i].id];
      if (!rec || rec.passed !== true) pool.push(problems[i]);
    }
    if (pool.length === 0) pool = problems.slice();
    // 用时间戳取模做伪随机：不引入随机数（数据集与判题都要求可复现）
    var pick = pool[Date.now() % pool.length];
    if (pick) global.location.hash = '#/problem/' + pick.id;
  }

  /* ---------- 题面预览图：初始绘制与跑完叠加预测共用同一份 opts ---------- */

  /**
   * 题面预览图的绘制参数。
   * 初始绘制（app/problem.js）与「跑完画预测」（paintPrediction）必须走同一个函数：
   * 否则跑一次之后，事件标记（如促销日）就随着重绘消失了。
   *
   * @param {Object} p 题目
   * @param {Object} ds 数据集
   * @param {number[]} [predictions] 最后一个测试点的预测（可选）
   * @returns {Object} drawSeries 的 opts
   */
  function chartOpts(p, ds, predictions) {
    var opts = {
      values: ds.values,
      testStart: ds.values.length - p.horizon,
      height: 190
    };
    if (predictions) opts.predictions = predictions;
    var field = p && p.markerField;
    var marks = (field && ds) ? ds[field] : null;
    if (Array.isArray(marks) && marks.length) {
      opts.markers = { indices: marks, label: p.markerLabel || '事件' };
    }
    return opts;
  }

  /** 把最后一个测试点的预测画到预览图上（hover 绑定由题目页负责，paint 后几何信息自动更新）。 */
  function paintPrediction(res, p, ds) {
    if (!res || !res.cases || res.cases.length === 0) return;
    var last = res.cases[res.cases.length - 1];
    if (!last || !last.predictions) return;
    var view = $('#view');
    var canvas = view ? $('#seriesChart', view) : null;
    if (!canvas) return;
    TSJ.drawSeries(canvas, chartOpts(p, ds, last.predictions));
  }

  TSJ.appViews = {
    bindRunner: bindRunner,
    invokeRunner: invokeRunner,
    allTags: allTags,
    matches: matches,
    renderProblemList: renderProblemList,
    paintList: paintList,
    goRandom: goRandom,
    chartOpts: chartOpts,
    paintPrediction: paintPrediction
  };
})(typeof window !== 'undefined' ? window : this);
