/**
 * assets/js/app/studio.js —— 模型工坊 #/studio（v3.6）
 * 加载顺序：… app/studio-storage → app/studio.js → app/cmdk → app.js　挂载点：window.TSJ.appStudio
 *
 * 完整实验流程：自己写 predict（训练逻辑写在函数内，只允许用 history）：
 *   ① 验证集评估（可迭代）→ ② 最终评测（同代码 test 只评一次，次数如实记录）。
 * 沙箱与判题完全同源（judge.evaluate + Worker 超时 + 防泄漏拆分），零额外依赖。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var esc = core.esc;
  var doc = global.document;
  var a11y = TSJ.appA11y;
  var storage = TSJ.appStudioStorage;

  function $(id) { return doc.getElementById(id); }

  var BASELINES = ['naive', 'seasonal_naive', 'mean', 'moving_average', 'linear_trend'];
  var METRIC = 'mse';

  var TPL = TSJ.appStudioTemplates;

  /** 拆分协议：test = val = clamp(15%, 12, 48)，train 为剩余；train 不足 24 点时报错。 */
  function splitOf(n) {
    var testLen = Math.max(12, Math.min(48, Math.round(n * 0.15)));
    var trainLen = n - testLen * 2;
    if (trainLen < 24) return null;
    return { trainLen: trainLen, valLen: testLen, testLen: testLen };
  }

  function hashOf(code) { return core.fnv1a(code).slice(0, 8); }

  /** 用合成 problem/dataset 走 judge.evaluate：沙箱、超时、基线全家桶免费获得。 */
  function synthAndRun(srcDs, values, horizon, code, session, covExtra) {
    var ds = {
      id: 'studio', name: '模型工坊', unit: '', freq: srcDs.freq, season: srcDs.season, desc: '', values: values
    };
    var problem = {
      id: 'studio', index: 0, title: '模型工坊', difficulty: '入门', tags: [],
      points: 100, passScore: 60, dataset: 'studio', mode: 'holdout',
      horizon: horizon, metric: METRIC, baselines: BASELINES, threshold: 0.95
    };
    if (covExtra) problem.ctxExtra = covExtra;
    return TSJ.judge.evaluate({ problem: problem, dataset: ds, code: code, session: session });
  }

  function findDataset(id) { return TSJ.findDataset(id); }   // 引擎层同名查找（datasets.js）

  /* ---------- 渲染 ---------- */
  function render(scope) {
    var ctx = { code: loadDraft(), result: null, phase: null, busy: false, chart: null, cov: { promo: true, parts: true } };

    if (scope && scope.own) scope.own({ destroy: function () {
      ctx.busy = false;
      if (ctx.chart && ctx.chart.destroy) ctx.chart.destroy();
      ctx.chart = null;
    } });   // 图表与在途会话随路由销毁

    var host = doc.getElementById('view');
    host.innerHTML = [
      '<div class="wk-hero wk-hero-slim"><div class="wk-hero-main">',
      '  <div class="wk-kicker">模型工坊</div>',
      '  <h1>自己搓一个模型，跑完完整实验流程</h1>',
      '  <p>训练逻辑写在 predict 里（只能用 history）——验证集上随便迭代，最终评测一次定论。沙箱、超时、防泄漏与判题完全同源。范围：单变量模型；协变量题（P17/P18 依赖 ctx 扩展字段）请到题库练习。</p>',
      '</div></div>',
      '<div class="problem-layout studio-layout" id="studioLayout">',
      '<section class="pane pane-left">',
      '  <div class="ds-card"><h2 class="ds-card-title">实验配置</h2>',
      '    <label class="ds-field"><span>数据集</span><select id="studioDataset">' +
      (TSJ.datasets || []).map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === 'airline' ? ' selected' : '') + '>' +
          esc(d.name) + '（' + d.values.length + ' 点 · ' + esc(d.freq) + '）</option>';
      }).join('') + '</select></label>',
      '    <div class="studio-cov" id="studioCov"></div>',
      '    <div class="studio-csv-row">',
      '      <label class="ds-btn ds-btn-sm studio-csv-btn"><input type="file" id="studioCsvFile" accept=".csv,.txt,.tsv" style="display:none">📂 上传自己的 CSV</label>',
      '      <span class="ds-card-sub" id="studioCsvHint">单列数值或「时间,数值」两列；≥72 点</span>',
      '    </div>',
      '    <div class="studio-splits" id="studioSplits"></div>',
      '  </div>',
      '  <div class="editor-toolbar"><div class="tb-left"><span class="file-chip">my-model.js</span>' +
      '    <span class="tb-hint">Ctrl/⌘+Enter 运行</span></div>',
      '    <div class="tb-right"><button type="button" class="btn btn-ghost" id="studioTemplate">基础</button>' +
'    <button type="button" class="btn btn-ghost" id="studioTemplateCov" title="用 ctx.promoDays 做促销感知预测">协变量</button>' +

      '    <button type="button" class="btn" id="studioRunVal">① 验证集评估</button>' +
      '    <button type="button" class="btn btn-primary" id="studioRunFinal">② 最终评测</button></div></div>',
      '  <div class="editor-host" id="studioEditorHost"></div>',
      '  <p class="ed-help" id="studioEdHelp">' + TSJ.escapeHtml(TSJ.EDITOR_HELP_IDLE) + '</p>',
      '</section>',
      '<div class="splitter" id="studioSplitter" role="separator" aria-orientation="vertical" aria-label="调整左右分栏宽度" tabindex="-1"></div>',
      '<section class="pane pane-right">',
      '  <div class="ds-card"><h2 class="ds-card-title">实验报告</h2><div id="studioReport">' +
      '    <div class="ds-empty"><strong>还没有运行</strong><span>先「① 验证集评估」迭代模型，满意后「② 最终评测」。</span></div></div></div>',
      '  <div class="ds-card"><h2 class="ds-card-title">实验记录</h2>' +
      '    <div class="lab-status"><span id="studioExpCount"></span>' +
      '    <button class="ds-btn ds-btn-sm" id="studioShare">分享卡</button>' +
    '    <button class="ds-btn ds-btn-sm" id="studioExport">导出记录</button>' +
      '    <button class="ds-btn ds-btn-sm btn-danger" id="studioClear">清空记录</button></div>',
      '    <div id="studioRecords"></div></div>',
      '</section>',
      '</div>'
    ].join('\n');

    store.state.editor = TSJ.createEditor($('studioEditorHost'), {
      value: ctx.code,
      fontSize: store.state.edFont,
      errorHelpId: 'studioEdHelp',
      escapeTo: '#studioRunFinal',   // ESC 优先退出编辑焦点而非关闭页面
      onChange: function (val) { ctx.code = val; core.writeJSON(core.STORE.studioDraft, val); },
      onRun: function () { runPhase('val'); },
      onSave: function () { core.writeJSON(core.STORE.studioDraft, ctx.code); a11y.toast('草稿已保存', 'ok'); }
    });

    // 左右分栏可拖拽：与题目页同一份逻辑，只是 id 不同
    TSJ.appUi.bindSplitter(host, { layoutId: 'studioLayout', splitterId: 'studioSplitter' });

    TSJ.appStudioCsv.setupPanel({ onDatasetChanged: paintConfig });
    paintSplits();
    paintRecords();

    /** 协变量开关区：html 由 studio-report.covChecksHtml 生成，这里只绑定勾选状态。 */
    function paintCov() {
      var d = findDataset($('studioDataset').value) || {};
      var box = $('studioCov');
      if (!box) return;
      var checksHtml = TSJ.appStudioReport.covChecksHtml(d, ctx.cov);
      if (d.parts) checksHtml += ' <button type="button" class="btn btn-ghost btn-sm" id="studioTemplateChan">载入渠道示例</button>';
      box.innerHTML = checksHtml;
      var a = $('studioCovPromo'), b = $('studioCovParts'), tplCov = $('studioTemplateCov');
      if (a) a.addEventListener('change', function () { ctx.cov.promo = this.checked; });
      if (b) b.addEventListener('change', function () { ctx.cov.parts = this.checked; });
      if (tplCov) tplCov.disabled = !d.promoDays;
      var tplChan = $('studioTemplateChan');
      if (tplChan) tplChan.disabled = !d.parts;
    }
    $('studioDataset').addEventListener('change', paintConfig);
    paintConfig();
    function loadTpl(code, msg) {
      store.state.editor.setValue(code);
      ctx.code = code;
      core.writeJSON(core.STORE.studioDraft, code);
      a11y.toast(msg, 'ok');
    }
    $('studioTemplate').addEventListener('click', function () { loadTpl(TPL.STARTER, '已载入基础示例（SES + 网格搜索 α）'); });
    $('studioTemplateCov').addEventListener('click', function () { loadTpl(TPL.COV, '已载入协变量示例（促销提升系数 × 季节朴素）'); });
    var chanBtn = $('studioTemplateChan');   // 仅在有 parts 的数据集上渲染
    if (chanBtn) chanBtn.addEventListener('click', function () {
      ctx.cov.parts = true;
      var cb = $('studioCovParts');
      if (cb) cb.checked = true;
      loadTpl(TPL.CHANNEL, '已载入渠道拆分示例（per-channel 季节朴素 → 相加）');
    });
    $('studioRunVal').addEventListener('click', function () { runPhase('val'); });
    $('studioRunFinal').addEventListener('click', function () { runPhase('final'); });
    $('studioShare').addEventListener('click', function () {
      if (!ctx.result) { TSJ.appA11y.toast('还没有可分享的实验', 'err'); return; }
      var html = TSJ.appStudioReport.buildShareCard(ctx.lastView || { rec: ctx.result, d: findDataset(ctx.result.datasetId) });
      var blob = new global.Blob([html], { type: 'text/html' });
      var a2 = doc.createElement('a');
      a2.href = global.URL.createObjectURL(blob);
      a2.download = 'tsoj-studio-card-' + ctx.result.codeHash + '-' + ctx.result.kind + '.html';
      a2.click();
      global.URL.revokeObjectURL(a2.href);
    });
    $('studioExport').addEventListener('click', function () {
      if (!ctx.result) { a11y.toast('还没有可导出的实验', 'err'); return; }
      var text = storage.exportJSON(ctx.result);
      var blob = new global.Blob([text], { type: 'application/json' });
      var a = doc.createElement('a');
      a.href = global.URL.createObjectURL(blob);
      a.download = 'tsoj-studio-' + ctx.result.codeHash + '-' + ctx.result.kind + '.json';
      a.click();
      global.URL.revokeObjectURL(a.href);
    });
    // 清空记录必须先确认：这些记录是跑了几分钟的结果，清掉不可恢复。
    // 原来是一键直接清（同一站的「清空本机进度」却有确认），口径不一致。
    $('studioClear').addEventListener('click', function () {
      a11y.confirmDanger({
        title: '清空实验记录？',
        body: '将删除本机保存的全部工坊实验记录（验证集与最终评测）。此操作不可撤销。',
        hint: '建议先「导出记录」留一份备份。',
        confirmText: '确认清空',
        idPrefix: 'studioClear',
        onConfirm: function () {
          storage.clear();
          paintRecords();
          a11y.toast('已清空实验记录', 'ok');
        }
      });
    });

    function paintConfig() { paintSplits(); paintCov(); }
    function paintSplits() {
      var d = findDataset($('studioDataset').value);
      var box = $('studioSplits');
      var sp = d ? splitOf(d.values.length) : null;
      if (!box) return;
      if (!d || !sp) { box.innerHTML = '<p class="md-note"><span>⚠</span><span>该数据集太短，装不下 train/val/test 三段。</span></p>'; return; }
      box.innerHTML = '<div class="studio-split-row"><span>train ' + sp.trainLen + '</span>' +
        '<span class="studio-split-val">val ' + sp.valLen + '</span>' +
        '<span class="studio-split-test">test ' + sp.testLen + '</span></div>' +
        '<p class="ds-card-sub">训练只看 train；验证集用于迭代；test 只在最终评测时解密。</p>';
    }

    function paintRecords() {
      var list = storage.list();
      var el = $('studioExpCount');
      if (el) el.textContent = '本地 ' + list.length + ' 条（上限 ' + storage.MAX + '）';
      var box = $('studioRecords');
      if (!box) return;
      var dsId = $('studioDataset') ? $('studioDataset').value : null;
      box.innerHTML = TSJ.appStudioReport.recordsPanel(list, dsId);
      var btns = core.$$('[data-code]', box);
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          var h = this.getAttribute('data-code');
          for (var j = 0; j < list.length; j++) {
            if (list[j].codeHash === h && list[j].code) {
              store.state.editor.setValue(list[j].code);
              ctx.code = list[j].code;
              core.writeJSON(core.STORE.studioDraft, ctx.code);
              a11y.toast('已载入代码快照 ' + h, 'ok');
              return;
            }
          }
        });
      }
    }

    /** 两阶段评测：val 在 train 上拟合、val 上打分；final 在 train+val 上拟合、test 上打分。 */
    function runPhase(kind) {
      if (ctx.busy) return;
      var d = findDataset($('studioDataset').value);
      var sp = d ? splitOf(d.values.length) : null;
      if (!sp) { a11y.toast('数据集太短，装不下三段拆分', 'err'); return; }
      var code = store.state.editor.getValue();
      ctx.code = code;
      core.writeJSON(core.STORE.studioDraft, code);

      var values, horizon;
      if (kind === 'val') {
        values = d.values.slice(0, sp.trainLen + sp.valLen);
        horizon = sp.valLen;
      } else {
        values = d.values.slice();
        horizon = sp.testLen;
      }
      var historyLen = values.length - horizon;
      var history = values.slice(0, historyLen);
      var actual = values.slice(historyLen);

      var token = ++store.state.judgeToken;
      var session = {};
      store.state.session = session;
      ctx.busy = true;
      setButtons(true);
      var report = $('studioReport');
      if (report) report.innerHTML = '<div class="notice">正在运行（' + (kind === 'val' ? '验证集' : '最终评测') + '）…</div>';

      // 协变量注入：与 P17/P18 同一 judge 机制（problem.ctxExtra），注入与否由用户勾选。
      // 注意闭包捕获真实数据集的日历/渠道——合成 ds 上没有这些字段。
      var covExtra = null;
      if (ctx.cov.promo && d.promoDays) {
        var pd = d.promoDays;
        covExtra = function () { return { promoDays: pd }; };
      } else if (ctx.cov.parts && d.parts) {
        var parts = d.parts;
        covExtra = function (point) {
          var end = point.history.length;
          return { parts: parts.map(function (p) {
            return { name: p.name, period: p.period, values: p.values.slice(0, end) };
          }) };
        };
      }
      synthAndRun(d, values, horizon, code, session, covExtra).then(function (res) {
        if (token !== store.state.judgeToken) return;   // 路由切换 / 新一轮：整段丢弃
        ctx.busy = false;
        setButtons(false);
        if (res.refused || res.dataError || res.aborted) {
          if (report) report.innerHTML = '<div class="notice">' + esc((res && res.reason) || (res && res.message) || '无法运行。') + '</div>';
          return;
        }
        if (res.verdict === 'RE' || res.verdict === 'TLE') {
          var errCase = (res.cases && res.cases[0]) || {};
          if (report) report.innerHTML = '<div class="err-box">' + esc(errCase.error || res.message || '运行失败') +
            '<div class="err-meta">位置：' + (errCase.line ? '第 ' + errCase.line + ' 行' : '行号未知') + '</div></div>';
          if (errCase.line && store.state.editor) store.state.editor.markError(errCase.line);
          return;
        }
        var pred = (res.cases[0] && res.cases[0].predictions) || [];
        var baseline = TSJ.judge.baselines.moving_average(history.slice(), horizon, { season: d.season, freq: d.freq, datasetId: d.id, index: 0 });
        var rec = {
          schema: 1, id: String(Date.now()), at: Date.now(), kind: kind,
          datasetId: d.id, season: d.season, split: [sp.trainLen, sp.valLen, sp.testLen],
          covariates: ((ctx.cov.promo && d.promoDays) ? 'promo' : '') + ((ctx.cov.parts && d.parts) ? 'parts' : '') || null,
          codeHash: hashOf(code), code: code,
          valMetrics: kind === 'val' ? { mse: TSJ.judge.metrics.mse(actual, pred) } : {},
          testMetrics: kind === 'final' ? { mse: TSJ.judge.metrics.mse(actual, pred) } : {},
          baselinesVal: kind === 'val' ? (res.cases[0] && res.cases[0].allBaselines) || {} : {},
          baselinesTest: kind === 'final' ? (res.cases[0] && res.cases[0].allBaselines) || {} : {}
        };
        if (kind === 'final') rec.testRuns = storage.testRunCount(rec.codeHash, d.id) + 1;
        storage.save(rec);
        if (TSJ.appAchievements) TSJ.appAchievements.onStudioRun(rec);
        ctx.result = rec;
        ctx.lastView = { rec: rec, actual: actual, pred: pred, baseline: baseline, res: res, sp: sp, historyLen: historyLen, d: d };
        paintReport(ctx.lastView);
        paintRecords();
        if (kind === 'final') {
          a11y.toast('最终评测完成 · 该代码 testRuns=' + rec.testRuns, rec.testRuns > 1 ? 'warn' : 'ok');
        } else {
          a11y.toast('验证集评估完成，可继续迭代', 'ok');
        }
      }).catch(function (err) {
        ctx.busy = false;
        setButtons(false);
        if (report) report.innerHTML = '<div class="notice">运行异常：' + esc((err && err.message) || String(err)) + '</div>';
      });
    }

    /** 报告绘制委托给 app/studio-report.js（表格 + 预测图 + val/test 分界线）。 */
    function paintReport(view) {
      TSJ.appStudioReport.paint(view, {
        scope: scope,
        setChart: function (c) { ctx.chart = c; }
      });
    }

    function setButtons(busy) {
      var a = $('studioRunVal'), b = $('studioRunFinal');
      if (a) a.disabled = !!busy;
      if (b) b.disabled = !!busy;
    }

    function loadDraft() {
      return core.readJSON(core.STORE.studioDraft, TPL.STARTER, function (v) { return typeof v === 'string' && v; });
    }

    a11y.setTitle('模型工坊 · TSOJ');
  }

  TSJ.appStudio = { render: render };
})(typeof window !== 'undefined' ? window : this);
