/**
 * assets/js/app/studio.js —— 模型工坊 #/studio（v3.6）
 * 加载顺序：… app/studio-storage → app/studio.js → app/cmdk → app.js　挂载点：window.TSJ.appStudio
 *
 * 完整实验流程：自己写 predict（训练逻辑写在函数内，只允许用 history）
 *   ① 验证集评估：fit 在 train、打分在 val，可反复迭代；
 *   ② 最终评测：train+val 重新拟合、在 test 上打分——每代代码只评一次，次数如实记录。
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

  var STARTER = [
    'function predict(history, horizon, ctx) {',
    '  // 你的模型：在 history 上「训练」，再预测 horizon 步。',
    '  // 示例：SES + 网格搜索 α（只用 history 内部做一步回测选参，绝不碰 val/test）',
    '  var best = { a: 0.3, err: Infinity };',
    '  for (var a = 0.05; a <= 0.95; a += 0.05) {',
    '    var err = 0, level = history[0];',
    '    for (var i = 1; i < history.length - 1; i++) {',
    '      var oneStep = level;                    // 用 i 之前的状态预测 i',
    '      level = a * history[i] + (1 - a) * level;',
    '      err += Math.pow(history[i + 1] - oneStep, 2);',
    '    }',
    '    if (err < best.err) best = { a: a, err: err };',
    '  }',
    '  var level = history[0];                     // 用选好的 α 在全部 history 上重新平滑',
    '  for (var j = 1; j < history.length; j++) level = best.a * history[j] + (1 - best.a) * level;',
    '  var out = [];',
    '  for (var h = 0; h < horizon; h++) out.push(level);',
    '  return out;',
    '}'
  ].join('\n');

  /** 拆分协议：test = val = clamp(15%, 12, 48)，train 为剩余；train 不足 24 点时报错。 */
  function splitOf(n) {
    var testLen = Math.max(12, Math.min(48, Math.round(n * 0.15)));
    var trainLen = n - testLen * 2;
    if (trainLen < 24) return null;
    return { trainLen: trainLen, valLen: testLen, testLen: testLen };
  }

  function hashOf(code) { return core.fnv1a(code).slice(0, 8); }

  /** 用合成 problem/dataset 走 judge.evaluate：沙箱、超时、基线全家桶免费获得。 */
  function synthAndRun(values, horizon, code, session) {
    var ds = {
      id: 'studio', name: '模型工坊', unit: '', freq: ctx0().freq, season: ctx0().season, desc: '', values: values
    };
    var problem = {
      id: 'studio', index: 0, title: '模型工坊', difficulty: '入门', tags: [],
      points: 100, passScore: 60, dataset: 'studio', mode: 'holdout',
      horizon: horizon, metric: METRIC, baselines: BASELINES, threshold: 0.95
    };
    return TSJ.judge.evaluate({ problem: problem, dataset: ds, code: code, session: session });
    /** 数据集元信息（频率/季节来自所选数据集）。 */
    function ctx0() {
      var d = TSJ.findDataset(stateDsId());
      return { freq: d ? d.freq : 'M', season: d ? d.season : 12 };
    }
  }

  function stateDsId() { return doc.getElementById('studioDataset') ? doc.getElementById('studioDataset').value : 'airline'; }

  function findDataset(id) {
    var list = TSJ.datasets || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- 渲染 ---------- */
  function render(scope) {
    var ctx = { code: loadDraft(), result: null, phase: null, busy: false, chart: null };
    var ds = findDataset('airline');

    function cleanup() {
      ctx.busy = false;
      if (ctx.chart && ctx.chart.destroy) ctx.chart.destroy();
      ctx.chart = null;
    }
    if (scope && scope.own) scope.own({ destroy: cleanup });

    var host = doc.getElementById('view');
    host.innerHTML = [
      '<div class="wk-hero wk-hero-slim"><div class="wk-hero-main">',
      '  <div class="wk-kicker">模型工坊</div>',
      '  <h1>自己搓一个模型，跑完完整实验流程</h1>',
      '  <p>训练逻辑写在 predict 里（只能用 history）——验证集上随便迭代，最终评测一次定论。沙箱、超时、防泄漏与判题完全同源。</p>',
      '</div></div>',
      '<div class="problem-layout studio-layout" id="studioLayout">',
      '<section class="pane pane-left">',
      '  <div class="ds-card"><h2 class="ds-card-title">实验配置</h2>',
      '    <label class="ds-field"><span>数据集</span><select id="studioDataset">' +
      (TSJ.datasets || []).map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === 'airline' ? ' selected' : '') + '>' +
          esc(d.name) + '（' + d.values.length + ' 点 · ' + esc(d.freq) + '）</option>';
      }).join('') + '</select></label>',
      '    <div class="studio-csv-row">',
      '      <label class="ds-btn ds-btn-sm studio-csv-btn"><input type="file" id="studioCsvFile" accept=".csv,.txt,.tsv" style="display:none">📂 上传自己的 CSV</label>',
      '      <span class="ds-card-sub" id="studioCsvHint">单列数值或「时间,数值」两列；≥72 点</span>',
      '    </div>',
      '    <div class="studio-splits" id="studioSplits"></div>',
      '  </div>',
      '  <div class="editor-toolbar"><div class="tb-left"><span class="file-chip">my-model.js</span>' +
      '    <span class="tb-hint">Ctrl/⌘+Enter 运行</span></div>',
      '    <div class="tb-right"><button type="button" class="btn btn-ghost" id="studioTemplate">载入示例模型</button>' +
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
      escapeTo: '#studioRunFinal',
      onChange: function (val) { ctx.code = val; core.writeJSON(core.STORE.studioDraft, val); },
      onRun: function () { runPhase('val'); },
      onSave: function () { core.writeJSON(core.STORE.studioDraft, ctx.code); a11y.toast('草稿已保存', 'ok'); }
    });

    // 左右分栏可拖拽：与题目页同一份逻辑，只是 id 不同
    TSJ.appUi.bindSplitter(host, { layoutId: 'studioLayout', splitterId: 'studioSplitter' });

    TSJ.appStudioCsv.setupPanel({ onDatasetChanged: paintSplits });
    paintSplits();
    paintRecords();

    $('studioDataset').addEventListener('change', paintSplits);
    $('studioTemplate').addEventListener('click', function () {
      store.state.editor.setValue(STARTER);
      ctx.code = STARTER;
      core.writeJSON(core.STORE.studioDraft, STARTER);
      a11y.toast('已载入示例模型（SES + 网格搜索 α）', 'ok');
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
    $('studioClear').addEventListener('click', function () { storage.clear(); paintRecords(); a11y.toast('已清空实验记录', 'ok'); });

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
      box.innerHTML = list.length ? '<div class="lab-history">' + list.map(function (r) {
        return '<div class="lab-history-item"><span>' + (r.kind === 'final' ? '🏁' : '🔁') + ' ' +
          esc(r.datasetId) + ' · ' + esc(r.kind === 'final' ? '最终' : '验证') + ' · MSE ' +
          (r.kind === 'final' ? fmt(r.testMetrics.mse) : fmt(r.valMetrics.mse)) + ' · ' + esc(r.codeHash) + '</span>' +
          '<span><button data-code="' + esc(r.codeHash) + '">载入代码</button></span></div>';
      }).join('') + '</div>' : '<div class="ds-empty"><strong>还没有实验记录</strong><span>每代代码的 val/test 成绩都会留档。</span></div>';
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

    function fmt(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '—'; }

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

      synthAndRun(values, horizon, code, session).then(function (res) {
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
      var a = $('studioRunVal');
      var b = $('studioRunFinal');
      if (a) a.disabled = !!busy;
      if (b) b.disabled = !!busy;
    }

    function loadDraft() {
      return core.readJSON(core.STORE.studioDraft, STARTER, function (v) { return typeof v === 'string' && v; });
    }

    a11y.setTitle('模型工坊 · TSOJ');
  }

  TSJ.appStudio = { render: render };
})(typeof window !== 'undefined' ? window : this);
