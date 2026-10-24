/**
 * assets/js/app/views.js —— 题库页 / 题目页 / 题解 / 引导弹层（挂载点 TSJ.appViews）
 *
 * 加载顺序：core → store → ui → views → app.js。依赖方向单向：views 可用 core / store / ui，
 * 但**不能**直接引用 app.js 的 route / runJudge —— 判题回调由 app.js 启动时用 bindRunner()
 * 注入，因此不存在反向引用与循环依赖。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var ui = TSJ.appUi;
  var problems = TSJ.problems;

  var $ = core.$;
  var esc = core.esc;
  var toScore = core.toScore;
  var writeJSON = core.writeJSON;
  var STORE = core.STORE;
  var DIFF_CLASS = core.DIFF_CLASS;
  var MODE_LABEL = core.MODE_LABEL;
  var md = ui.md;
  var mdInline = ui.mdInline;

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

  /* ---------- 1. 题库页 ---------- */
  /** 渲染题库列表。 */
  function renderProblemList() {
    var state = store.state;
    var html = [];
    html.push('<div class="page">\n<div class="page-head">' + '\n' + '<h1>题库</h1>' + '\n' + '<p class="sub">共 ' + problems.length + ' 题 · 写一个 predict 函数，打败统计基线即可得分，通过后解锁题解</p>' + '\n' + '</div>');

    html.push('<div class="filters" role="group" aria-label="按难度筛选">');
    var options = ['全部'].concat(core.DIFFS);
    for (var f = 0; f < options.length; f++) {
      var on = state.filter === options[f] ? ' chip-on' : '';
      html.push('<button type="button" class="chip' + on + '" data-filter="' + esc(options[f]) + '">' +
        esc(options[f]) + '</button>');
    }
    html.push('</div>');

    html.push('<div class="table-wrap"><table class="ptable"><thead><tr>' + '\n' + '<th style="width:64px">编号</th><th>标题</th><th style="width:76px">难度</th>');
    html.push('<th style="width:250px">标签</th><th style="width:62px">状态</th>' + '\n' + '<th class="num" style="width:72px">最高分</th><th class="num" style="width:72px">通过率</th>' + '\n' + '</tr></thead><tbody>');

    var shown = 0;
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      if (state.filter !== '全部' && p.difficulty !== state.filter) continue;
      shown++;

      var rec = state.progress[p.id] || {};
      var best = toScore(rec.best);
      var stats = store.problemStats(p);
      var tags = '';
      for (var t = 0; t < p.tags.length; t++) {
        tags += '<span class="tag">' + esc(p.tags[t]) + '</span>';
      }

      html.push('<tr class="prow" tabindex="0" data-id="' + esc(p.id) + '">' + '\n' + '<td class="idx">#' + p.index + '</td>');
      html.push('<td><a class="p-title" href="#/problem/' + esc(p.id) + '">' + esc(p.title) + '</a></td>');
      html.push('<td><span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span></td>' + '\n' + '<td>' + tags + '</td>');
      html.push('<td>' + (rec.passed === true
        ? '<span class="status-ok" title="已通过">✓</span>'
        : '<span class="status-no" title="未通过">—</span>') + '</td>');
      html.push('<td class="num">' + (best > 0 ? esc(best) : '—') + '</td>' + '\n' + '<td class="num">' + esc(stats.rate) + '%</td>' + '\n' + '</tr>');
    }

    if (shown === 0) {
      html.push('<tr><td colspan="7"><div class="empty">该难度下暂无题目</div></td></tr>');
    }

    html.push('</tbody></table></div>\n</div>');

    var view = $('#view');
    view.innerHTML = html.join('\n');
    bindProblemList(view);
  }

  /** 绑定题库页交互。 */
  function bindProblemList(view) {
    var chips = view.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        store.state.filter = this.getAttribute('data-filter');
        writeJSON(STORE.filter, store.state.filter);
        renderProblemList();
      });
    }

    var rows = view.querySelectorAll('.prow');
    for (var r = 0; r < rows.length; r++) {
      rows[r].addEventListener('click', function (ev) {
        // 标题本身是 <a>，交给浏览器处理
        if (ev.target && ev.target.tagName === 'A') return;
        global.location.hash = '#/problem/' + this.getAttribute('data-id');
      });
      rows[r].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          global.location.hash = '#/problem/' + this.getAttribute('data-id');
        }
      });
    }
  }

  /* ---------- 2. 题目页 ---------- */
  /** 渲染题目详情页（左题面 / 右编辑器）。 */
  function renderProblem(id) {
    var p = TSJ.findProblem(id);
    var view = $('#view');

    if (!p) {
      view.innerHTML = '<div class="page"><div class="empty"><span class="empty-icon">◌</span>' +
        '找不到这道题目。<br><a href="#/problems">返回题库</a></div></div>';
      return;
    }

    var ds = TSJ.findDataset(p.dataset);
    if (!ds) {
      view.innerHTML = '<div class="page"><div class="empty">数据集缺失：' + esc(p.dataset) + '</div></div>';
      return;
    }

    store.state.activeProblem = p;
    var rec = store.state.progress[p.id] || {};
    var draft = store.state.drafts[p.id];
    var code = typeof draft === 'string' ? draft : p.starter;

    view.innerHTML = problemTemplate(p, ds, rec);

    // ---- 数据预览图 ----
    var canvas = $('#seriesChart', view);
    if (canvas) {
      TSJ.drawSeries(canvas, {
        values: ds.values,
        testStart: ds.values.length - p.horizon,
        height: 190
      });
    }

    // ---- 编辑器 ----
    store.state.editor = TSJ.createEditor($('#editorHost', view), {
      value: code,
      onChange: core.debounce(function (val) {
        store.state.drafts[p.id] = val;
        writeJSON(STORE.drafts, store.state.drafts);
      }, 400),
      onRun: function () { invokeRunner(p, ds, false); }
    });

    // ---- 工具栏 ----
    var btnReset = $('#btnReset', view);
    var btnRun = $('#btnRun', view);
    var btnSubmit = $('#btnSubmit', view);
    var btnSolution = $('#btnSolution', view);

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (!store.state.editor) return;
        store.state.editor.setValue(p.starter);
        store.state.drafts[p.id] = p.starter;
        writeJSON(STORE.drafts, store.state.drafts);
      });
    }

    var sandboxOk = ui.canSubmit();
    if (btnRun) {
      btnRun.disabled = !sandboxOk;
      btnRun.addEventListener('click', function () { invokeRunner(p, ds, false); });
    }
    if (btnSubmit) {
      btnSubmit.disabled = !sandboxOk;
      if (!sandboxOk) btnSubmit.title = TSJ.judge.SANDBOX_REFUSED_REASON || '当前环境无法创建判题沙箱';
      btnSubmit.addEventListener('click', function () { invokeRunner(p, ds, true); });
    }
    if (btnSolution) {
      btnSolution.disabled = !rec.passed;
      btnSolution.addEventListener('click', function () { showSolution(p); });
    }

    ui.bindSplitter(view);
    if (sandboxOk) {
      ui.renderResult(null, p);
    } else {
      // 无沙箱 → 禁止提交，并明确告知原因（旧行为是静默降级 + 仍允许提交，死循环会锁死 UI）
      ui.renderGuardNotice({ message: TSJ.judge.SANDBOX_REFUSED_REASON });
    }
  }

  /** 题目页 HTML 模板。 */
  function problemTemplate(p, ds, rec) {
    var tags = '';
    for (var t = 0; t < p.tags.length; t++) tags += '<span class="tag">' + esc(p.tags[t]) + '</span>';

    var modeText = MODE_LABEL[p.mode] || p.mode;
    var modeDetail = p.mode === 'rolling'
      ? modeText + '（' + p.windows + ' 个窗口 / 步长 ' + p.originStep + '）'
      : modeText;

    var meta = [
      '<span class="meta-item">数据集 ' + esc(p.dataset) + '</span>',
      '<span class="meta-item">' + esc(modeDetail) + '</span>',
      '<span class="meta-item">步长 ' + p.horizon + '</span>',
      '<span class="meta-item">指标 ' + esc((TSJ.judge.metricLabels[p.metric] || p.metric)) + '</span>',
      '<span class="meta-item">阈值 ≤ ' + p.threshold + ' × 最优基线</span>',
      '<span class="meta-item">通过线 ' + p.passScore + '</span>'
    ].join('<span class="sep">·</span>');

    var hints = '';
    for (var h = 0; h < p.hints.length; h++) {
      hints += '<li>' + mdInline(p.hints[h]) + '</li>';
    }

    // 本地进度来自 localStorage（file:// 下可被同目录页面写入），因此先归一化再转义
    var bestScore = rec ? toScore(rec.best) : 0;
    var bestBadge = bestScore > 0
      ? '<span class="meta-item" style="color:var(--accent)">历史最高 ' + esc(bestScore) + ' 分</span>'
      : '<span class="meta-item">尚未提交</span>';

    var html = [];
    html.push('<div class="problem-layout" id="problemLayout">');

    /* ---------- 左：题面 ---------- */
    html.push('<section class="pane pane-left">\n  <div class="problem-head">' + '\n' + '    <div class="crumb"><a href="#/problems">题库</a> / #' + p.index + '</div>');
    html.push('    <h1>' + esc(p.title) + '</h1>' + '\n' + '    <div class="meta-row">' + '\n' + '      <span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span>');
    html.push('      ' + tags + '\n' + '      <span class="sep">|</span>' + bestBadge);
    html.push('    </div>' + '\n' + '    <div class="meta-row" style="margin-top:8px">' + meta + '</div>' + '\n' + '  </div>');

    html.push('  <div class="md">' + md(p.statement) + '</div>');

    html.push('  <div class="chart-card">' + '\n' + '    <div class="chart-title"><span>数据预览 · ' + esc(ds.name) + '（' + esc(ds.unit) + '）</span>');
    html.push('      <span>共 ' + ds.values.length + ' 点 · 周期 ' + ds.season + '</span></div>');
    html.push('    <canvas id="seriesChart" class="chart-canvas" height="190"></canvas>' + '\n' + '    <div class="chart-legend">');
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:#3fb6a8"></i>历史</span>');
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:#8a97a8"></i>测试集真实值</span>');
    html.push('      <span class="legend-item"><i class="legend-dot dash" style="border-top-color:#a5b4fc"></i>你的预测</span>' + '\n' + '    </div>\n  </div>');

    html.push('  <div class="md" style="margin-top:14px">' + '\n' + '    <h3 class="md-h">输入</h3><p class="md-p">' + mdInline(p.inputSpec) + '</p>');
    html.push('    <h3 class="md-h">输出</h3><p class="md-p">' + mdInline(p.outputSpec) + '</p>' + '\n' + '  </div>');

    html.push('  <details class="hints"><summary>提示（共 ' + p.hints.length + ' 条，点击展开）</summary>');
    html.push('    <div class="hints-body"><ol>' + hints + '</ol></div>' + '\n' + '  </details>');

    html.push('  <div id="solutionHost"></div>\n</section>');

    /* ---------- 分隔条 ---------- */
    html.push('<div class="splitter" id="splitter" role="separator" aria-orientation="vertical" aria-label="调整左右分栏宽度" tabindex="-1"></div>');

    /* ---------- 右：编辑器 + 结果 ---------- */
    html.push('<section class="pane pane-right">\n  <div class="editor-toolbar">');
    html.push('    <div class="tb-left"><span class="file-chip">predict.js</span>');
    html.push('      <span class="tb-hint">Ctrl / ⌘ + Enter 运行</span></div>\n    <div class="tb-right">');
    html.push('      <button type="button" class="btn btn-ghost" id="btnReset">重置模板</button>');
    html.push('      <button type="button" class="btn btn-ghost" id="btnSolution"' + (rec && rec.passed === true ? '' : ' disabled title="通过本题后可查看题解"') + '>查看题解</button>');
    html.push('      <button type="button" class="btn" id="btnRun">运行</button>');
    html.push('      <button type="button" class="btn btn-primary" id="btnSubmit">提交判题</button>\n    </div>');
    html.push('  </div>\n  <div class="editor-host" id="editorHost"></div>' + '\n' + '  <div class="result-panel" id="resultPanel"></div>\n</section>');

    html.push('</div>');
    return html.join('\n');
  }

  /* ---------- 3. 题解 ---------- */
  /** 在左栏底部展示参考实现。 */
  function showSolution(p) {
    var view = $('#view');
    var host = view ? $('#solutionHost', view) : null;
    if (!host) return;
    if (host.getAttribute('data-open') === '1') {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var html = [];
    html.push('<div class="solution-box">');
    html.push('  <div class="sb-head"><span>参考实现 · ' + esc(p.title) + '</span><span>' +
      esc(p.difficulty) + '</span></div>');
    html.push('  <pre><code>' + (TSJ.highlightCode ? TSJ.highlightCode(p.solution) : esc(p.solution)) + '</code></pre>' + '\n' + '</div>');
    host.innerHTML = html.join('\n');
    host.setAttribute('data-open', '1');
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 4. 首次进入引导 ---------- */
  /** 首次进入时的简短引导。 */
  function showOnboarding() {
    var overlay = $('#overlay');
    if (!overlay) return;
    overlay.innerHTML = [
      '<div class="modal">',
      '  <h2>欢迎来到时序竞技场</h2>',
      '  <div class="modal-flow">',
      '    <span class="flow-step">写 predict 函数</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">提交</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">打败基线得分</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">解锁题解</span>',
      '  </div>',
      '  <p>每道题只要实现一个函数：</p>',
      '  <p><code>predict(history, horizon, ctx) → number[]</code></p>',
      '  <ul>',
      '    <li>得分由「你的误差 ÷ 最优基线误差」决定，误差比越小分越高</li>',
      '    <li>误差比 = 0.5 得满分 100，等于阈值恰好得 60 分，≥ 2 得 0 分</li>',
      '    <li>全部测试点达标才算通过，通过后可查看参考实现</li>',
      '    <li>代码与成绩都存在浏览器本地，随时可以继续</li>',
      '  </ul>',
      '  <div class="modal-actions">',
      '    <button type="button" class="btn btn-primary" id="onbStart">开始做题</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    overlay.classList.remove('hidden');

    var btn = $('#onbStart');
    if (btn) {
      btn.addEventListener('click', function () {
        overlay.classList.add('hidden');
        writeJSON(STORE.onboarded, true);
        btn.focus();
      });
      btn.focus();
    }
  }

  TSJ.appViews = {
    bindRunner: bindRunner,
    renderProblemList: renderProblemList,
    renderProblem: renderProblem,
    showSolution: showSolution,
    showOnboarding: showOnboarding
  };
})(typeof window !== 'undefined' ? window : this);
