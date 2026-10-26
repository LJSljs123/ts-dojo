/**
 * assets/js/app/problem.js —— 题目页（题面 + 编辑器 + 工具栏）、题解、首次进入引导
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → app.js
 * 挂载点：window.TSJ.appProblem
 *
 * 判题入口不在这里直接引用 app.js：统一走 views.invokeRunner()（由 app.js 注入），保持单向依赖。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var ui = TSJ.appUi;
  var a11y = TSJ.appA11y;
  var views = TSJ.appViews;

  var $ = core.$;
  var esc = core.esc;
  var toScore = core.toScore;
  var STORE = core.STORE;
  var DIFF_CLASS = core.DIFF_CLASS;
  var MODE_LABEL = core.MODE_LABEL;
  var md = ui.md;
  var mdInline = ui.mdInline;

  /** 分量预览只画最近这么多点：730 点挤进 300px，周节律会糊成一条实心带。140 = 20 个整周。 */
  var PART_WINDOW = 140;

  /* ---------- 1. 题目页 ---------- */
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

    // ---- 数据预览图（画完挂上 hover 交互；句柄存进 state 供路由切换时 destroy）----
    var canvas = $('#seriesChart', view);
    if (canvas) {
      TSJ.drawSeries(canvas, TSJ.appViews.chartOpts(p, ds));
      if (typeof TSJ.attachChartHover === 'function') {
        store.state.chartHover = TSJ.attachChartHover(canvas);
      }
    }
    // 分量小图：只画形状，不挂 hover（总量图才是交互主体）
    var strip = $('.parts-strip', view);
    if (strip && ds.parts && typeof TSJ.drawParts === 'function') {
      TSJ.drawParts(strip, ds.parts, { testStart: ds.values.length - p.horizon, window: PART_WINDOW });
    }

    /** 保存草稿（输入走防抖，Ctrl+S 直接调用）。 */
    function saveDraft() {
      if (!store.state.editor) return false;
      store.state.drafts[p.id] = store.state.editor.getValue();
      return store.saveDrafts();
    }

    // ---- 编辑器 ----
    store.state.editor = TSJ.createEditor($('#editorHost', view), {
      value: code,
      fontSize: store.state.edFont,
      errorHelpId: 'edErrorHelp',
      onChange: core.debounce(function (val) {
        store.state.drafts[p.id] = val;
        store.saveDrafts();
      }, 400),
      onRun: function () { views.invokeRunner(p, ds, false); },
      onSave: function () {
        if (saveDraft()) a11y.toast('草稿已保存', 'ok');
        else a11y.toast('本地存储已满，草稿未保存', 'err');
      }
    });

    // ---- 工具栏 ----
    var btnReset = $('#btnReset', view);
    var btnRun = $('#btnRun', view);
    var btnSubmit = $('#btnSubmit', view);
    var btnSolution = $('#btnSolution', view);
    var btnFont = $('#btnFont', view);

    if (btnFont) {
      var paintFont = function () {
        btnFont.textContent = 'A ' + store.state.edFont;
        btnFont.setAttribute('aria-label', '编辑器字号 ' + store.state.edFont + ' 像素，点击切换');
      };
      paintFont();
      btnFont.addEventListener('click', function () {
        var next = store.state.edFont >= 14 ? 12 : store.state.edFont + 1;
        store.saveEdFont(next);
        if (store.state.editor && typeof store.state.editor.setFontSize === 'function') {
          store.state.editor.setFontSize(next);
        }
        paintFont();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (!store.state.editor) return;
        store.state.editor.setValue(p.starter);
        store.state.drafts[p.id] = p.starter;
        store.saveDrafts();
      });
    }

    var sandboxOk = ui.canSubmit();
    if (btnRun) {
      btnRun.disabled = !sandboxOk;
      btnRun.addEventListener('click', function () { views.invokeRunner(p, ds, false); });
    }
    if (btnSubmit) {
      btnSubmit.disabled = !sandboxOk;
      if (!sandboxOk) btnSubmit.title = TSJ.judge.SANDBOX_REFUSED_REASON || '当前环境无法创建判题沙箱';
      btnSubmit.addEventListener('click', function () { views.invokeRunner(p, ds, true); });
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
    for (var h = 0; h < p.hints.length; h++) hints += '<li>' + mdInline(p.hints[h]) + '</li>';

    // 本地进度来自 localStorage（file:// 下可被同目录页面写入），因此先归一化再转义
    var bestScore = rec ? toScore(rec.best) : 0;
    var bestBadge = bestScore > 0
      ? '<span class="meta-item" data-best-badge="1" style="color:var(--accent)">历史最高 ' + esc(bestScore) + ' 分</span>'
      : '<span class="meta-item" data-best-badge="1">尚未提交</span>';

    var html = [];
    html.push('<div class="problem-layout" id="problemLayout">');

    /* ---------- 左：题面 ---------- */
    html.push('<section class="pane pane-left">\n  <div class="problem-head">\n    <div class="crumb"><a href="#/problems">题库</a> / #' + p.index + '</div>');
    html.push('    <h1>' + esc(p.title) + '</h1>\n    <div class="meta-row">\n      <span class="badge ' + DIFF_CLASS[p.difficulty] + '">' + esc(p.difficulty) + '</span>');
    html.push('      ' + tags + '\n      <span class="sep">|</span>' + bestBadge);
    html.push('    </div>\n    <div class="meta-row" style="margin-top:8px">' + meta + '</div>\n  </div>');

    html.push('  <div class="md">' + md(p.statement) + '</div>');

    // 事件标记（如促销日）：图例与标题都要说清「圆点是什么」，否则图上多出一排黄点没人解释
    var markField = p.markerField;
    var markCount = (markField && Array.isArray(ds[markField])) ? ds[markField].length : 0;
    var markLabel = p.markerLabel || '事件';

    html.push('  <div class="chart-card">\n    <div class="chart-title"><span>数据预览 · ' + esc(ds.name) + '（' + esc(ds.unit) + '）</span>');
    html.push('      <span>共 ' + ds.values.length + ' 点 · 周期 ' + ds.season +
      (markCount ? ' · ' + esc(markLabel) + ' ' + markCount + ' 天' : '') + '</span></div>');
    html.push('    <canvas id="seriesChart" class="chart-canvas" height="190"></canvas>\n    <div class="chart-legend">');
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:var(--v3-chart-history)"></i>历史</span>');
    if (markCount) {
      html.push('      <span class="legend-item"><i class="legend-dot dot-mark"></i>' + esc(markLabel) + '</span>');
    }
    html.push('      <span class="legend-item"><i class="legend-dot" style="border-top-color:var(--v3-chart-actual)"></i>测试集真实值</span>');
    html.push('      <span class="legend-item"><i class="legend-dot dash" style="border-top-color:var(--v3-chart-pred)"></i>你的预测</span>\n    </div>');
    // 分量预览（P18）：总量图上两个周期是叠在一起的，拆开才看得见各自的节律
    if (ds.parts && ds.parts.length) {
      var cells = ds.parts.map(function (x, i) {
        return '<div class="part-cell"><div class="part-name">' + esc(x.name) + ' · 周期 ' + x.period +
          '</div><canvas class="chart-canvas part-chart" data-part="' + i + '" height="120"></canvas></div>';
      });
      html.push('    <div class="parts-head">分量预览 · 最近 ' + PART_WINDOW + ' 天（右端高亮为测试区间）</div>' +
        '<div class="parts-strip">' + cells.join('') + '</div>');
    }
    html.push('  </div>');

    html.push('  <div class="md" style="margin-top:14px">\n    <h3 class="md-h">输入</h3><p class="md-p">' + mdInline(p.inputSpec) + '</p>');
    html.push('    <h3 class="md-h">输出</h3><p class="md-p">' + mdInline(p.outputSpec) + '</p>\n  </div>');

    html.push('  <details class="hints"><summary>提示（共 ' + p.hints.length + ' 条，点击展开）</summary>');
    html.push('    <div class="hints-body"><ol>' + hints + '</ol></div>\n  </details>');

    if (p.guide && p.guide.length) {
      var steps = [];
      for (var s = 0; s < p.guide.length; s++) {
        var st = p.guide[s];
        steps.push('<div class="guide-step">');
        steps.push('  <div class="guide-step-num">' + (s + 1) + '</div>');
        steps.push('  <div class="guide-step-main"><h4>' + esc(st.title) + '</h4>');
        steps.push('    <p>' + mdInline(st.text) + '</p>');
        if (st.code) {
          steps.push('    <pre class="guide-code"><code>' +
            (TSJ.highlightCode ? TSJ.highlightCode(st.code) : esc(st.code)) + '</code></pre>');
        }
        steps.push('  </div>');
        steps.push('</div>');
      }
      html.push('  <details class="guide" open><summary>手把手带做（' + p.guide.length +
        ' 步，零基础照做即可拿第一个 AC）</summary>');
      html.push('    <div class="guide-body">' + steps.join('\n') + '</div>\n  </details>');
    }

    html.push('  <div id="solutionHost"></div>\n</section>');

    /* ---------- 分隔条 ---------- */
    html.push('<div class="splitter" id="splitter" role="separator" aria-orientation="vertical" aria-label="调整左右分栏宽度" tabindex="-1"></div>');

    /* ---------- 右：编辑器 + 结果 ---------- */
    html.push('<section class="pane pane-right">\n  <div class="editor-toolbar">');
    html.push('    <div class="tb-left"><span class="file-chip">predict.js</span>');
    html.push('      <span class="tb-hint">Ctrl / ⌘ + Enter 运行 · Ctrl / ⌘ + S 存草稿</span></div>\n    <div class="tb-right">');
    html.push('      <button type="button" class="btn btn-ghost ed-font-btn" id="btnFont" title="切换编辑器字号">A 13</button>');
    html.push('      <button type="button" class="btn btn-ghost" id="btnReset">重置模板</button>');
    html.push('      <button type="button" class="btn btn-ghost" id="btnSolution"' + (rec && rec.passed === true ? '' : ' disabled title="通过本题后可查看题解"') + '>查看题解</button>');
    html.push('      <button type="button" class="btn" id="btnRun">运行</button>');
    html.push('      <button type="button" class="btn btn-primary" id="btnSubmit">提交判题</button>\n    </div>');
    html.push('  </div>\n  <div class="editor-host" id="editorHost"></div>');
    html.push('  <p class="ed-help" id="edErrorHelp">代码出错时会在这里说明行号与原因。</p>');
    html.push('  <div class="result-panel" id="resultPanel" aria-live="polite" aria-label="判题结果"></div>\n</section>');

    html.push('</div>');
    return html.join('\n');
  }

  /* ---------- 2. 题解 ---------- */
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
    html.push('  <pre><code>' + (TSJ.highlightCode ? TSJ.highlightCode(p.solution) : esc(p.solution)) + '</code></pre>\n</div>');
    host.innerHTML = html.join('\n');
    host.setAttribute('data-open', '1');
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 3. 首次进入引导 ---------- */
  /** 首次进入时的简短引导（弹层：焦点陷阱 + ESC 关闭 + 关闭后焦点回 #view）。 */
  function showOnboarding() {
    var html = [
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
      '  <p style="margin:0 0 6px">完全零基础？先用 25 分钟上' +
        '<a href="#/learn/m0" style="color:var(--accent)">「零基础第一课」</a>' +
        '，第 1 题还有手把手带做面板。</p>',
      '  <div class="modal-actions">',
      '    <button type="button" class="btn btn-primary" id="onbStart">开始做题</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    a11y.openModal({ html: html, label: '欢迎来到时序竞技场', initialFocus: '#onbStart' });
    var btn = $('#onbStart');
    if (btn) {
      btn.addEventListener('click', function () {
        core.writeJSON(STORE.onboarded, true);
        a11y.closeModal();
      });
    }
  }

  /**
   * 刷新题头的「历史最高 / 尚未提交」徽标。
   * 判题落盘后必须调用：否则刚提交完，右上角等级分已经变了，题头却还写着「尚未提交」。
   * @param {Object} p 题目
   */
  function refreshBestBadge(p) {
    var view = $('#view');
    if (!view || !p) return;
    var el = view.querySelector('[data-best-badge]');
    if (!el) return;
    var rec = store.state.progress[p.id];
    var best = rec ? toScore(rec.best) : 0;
    if (best > 0) {
      el.textContent = '历史最高 ' + best + ' 分';
      el.style.color = 'var(--accent)';
    } else {
      el.textContent = '尚未提交';
      el.style.color = '';
    }
  }

  TSJ.appProblem = {
    renderProblem: renderProblem,
    showSolution: showSolution,
    showOnboarding: showOnboarding,
    refreshBestBadge: refreshBestBadge
  };
})(typeof window !== 'undefined' ? window : this);
