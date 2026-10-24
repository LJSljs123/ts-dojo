/**
 * assets/js/app/lab.js —— 可视化实验室 #/lab
 *
 * 受控实验：白名单方法、有限参数、确定性回测、诊断图表与最近记录。
 * 用户不能提交代码；测试真值不参与校准或调参。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var esc = core.esc;
  var doc = global.document;
  var panels = TSJ.appLabPanels;

  var KINDS = [
    { id: 'forecast', label: '预测对比' },
    { id: 'residual', label: '残差' },
    { id: 'acf', label: 'ACF' },
    { id: 'pacf', label: 'PACF' },
    { id: 'decomposition', label: '季节分解' }
  ];

  function $(id) { return doc.getElementById(id); }

  function currentConfigFromUI() {
    var raw = {
      datasetId: $('labDataset').value,
      method: $('labMethod').value,
      params: {},
      split: {
        mode: $('labMode').value,
        horizon: Number($('labHorizon').value),
        windows: Number($('labWindows').value),
        originStep: Number($('labOriginStep').value)
      },
      metrics: [].map.call(doc.querySelectorAll('.lab-metric:checked'), function (c) {
        return c.getAttribute('value');
      }).filter(function (v) { return !!v; }),
      baseline: $('labBaseline').value,
      interval: { enabled: $('labInterval').checked, levels: [80, 95] }
    };
    var meta = TSJ.labConfig.METHODS[raw.method] || { params: {} };
    Object.keys(meta.params).forEach(function (key) {
      var el = $('param-' + key);
      if (el) raw.params[key] = Number(el.value);
    });
    return raw;
  }


  function render(scope) {
    var initial = TSJ.labConfig.normalize(TSJ.labConfig.defaults());
    var ctx = {
      config: initial.config,
      result: null,
      originIndex: 0,
      kind: 'forecast',
      chart: null,
      token: 0,
      busy: false
    };

    function cleanup() {
      ctx.token++;
      ctx.busy = false;
      if (ctx.chart && ctx.chart.destroy) ctx.chart.destroy();
      ctx.chart = null;
    }
    if (scope && typeof scope.own === 'function') scope.own({ destroy: cleanup });

    function paintChart() {
      var wrap = $('labChartWrap');
      var canvas = $('labCanvas');
      var summary = $('labChartSummary');
      if (!wrap || !canvas || !ctx.result) return;
      if (ctx.chart && ctx.chart.destroy) ctx.chart.destroy();
      var origin = ctx.result.origins[ctx.originIndex] || ctx.result.origins[0];
      var model;
      var kind = ctx.kind;
      if (kind === 'forecast') model = panels.originModel(origin);
      else if (kind === 'residual') {
        model = { residuals: origin.actual.map(function (a, i) { return a - origin.prediction[i]; }) };
      } else if (kind === 'acf' || kind === 'pacf') {
        var residuals = origin.actual.map(function (a, i) { return a - origin.prediction[i]; });
        var fn = kind === 'acf' ? TSJ.chartStats.acf : TSJ.chartStats.pacf;
        var lags = 20;
        model = {
          name: kind.toUpperCase(),
          values: fn(residuals, lags),
          lags: Array.from({ length: lags + 1 }, function (_, i) { return i; }),
          conf: new Array(lags + 1).fill(1.96 / Math.sqrt(Math.max(2, residuals.length)))
        };
      } else {
        var season = (TSJ.datasets.find(function (d) { return d.id === ctx.result.config.datasetId; }) || {}).season || 1;
        var parts = TSJ.chartStats.decomposeAdditive(origin.history, season);
        model = parts ? { series: origin.history, parts: parts } : { series: [] };
      }
      ctx.chart = TSJ.charts.create(canvas, {
        kind: kind,
        scope: scope,
        height: 300,
        unit: (TSJ.datasets.find(function (d) { return d.id === ctx.result.config.datasetId; }) || {}).unit || '',
        ariaLabel: KINDS.filter(function (k) { return k.id === kind; })[0].label,
        onInspect: function () {}
      });
      ctx.chart.update(model);
      summary.textContent = ctx.chart.summary() || '';
    }

    function paintResults() {
      var box = $('labResults');
      if (!ctx.result) {
        box.innerHTML = '<div class="ds-empty"><strong>还没有运行</strong><span>选好配置后点「运行实验」。</span></div>';
        return;
      }
      var r = ctx.result;
      var originButtons = r.origins.map(function (o, i) {
        return '<button class="ds-btn ds-btn-sm' + (i === ctx.originIndex ? ' ds-btn-primary' : '') + '" data-origin="' + i + '">#' + (i + 1) + '</button>';
      }).join('');
      var kindButtons = KINDS.map(function (k) {
        return '<button class="ds-btn ds-btn-sm' + (k.id === ctx.kind ? ' ds-btn-primary' : '') + '" data-kind="' + k.id + '">' + k.label + '</button>';
      }).join('');
      var coverage = '';
      var o = r.origins[ctx.originIndex] || r.origins[0];
      if (o && o.coverage && o.coverage.length) {
        coverage = '<p class="chart-v2-summary">经验覆盖：' + o.coverage.map(function (c) {
          return c.level + '% → ' + (isFinite(c.rate) ? (c.rate * 100).toFixed(0) + '%' : '—') + '（n=' + c.n + '）';
        }).join(' · ') + '</p>';
      }
      box.innerHTML = [
        '<div class="ds-card"><h2 class="ds-card-title">结果摘要</h2>',
        '<p class="ds-card-sub">配置指纹 ' + esc(r.configHash) + ' · 数据版本 ' + esc(r.datasetVersion) + ' · 算法版本 ' + esc(r.algorithmVersion) + ' · 耗时 ' + r.durationMs + 'ms</p>',
        panels.metricTable(r),
        '<div class="lab-actions">' + originButtons + '</div>',
        '<div class="lab-actions">' + kindButtons + '</div>',
        '<div class="chart-v2"><div class="chart-v2-head"><h3>' + esc(KINDS.filter(function (k) { return k.id === ctx.kind; })[0].label) + '</h3>' +
        '<div class="chart-v2-legend"><span><i style="border-color:var(--v3-chart-history)"></i>历史</span><span><i style="border-color:var(--v3-chart-actual)"></i>真值</span><span><i style="border-color:var(--v3-chart-pred);border-top-style:dashed"></i>预测</span><span><i style="border-color:var(--v3-chart-baseline);border-top-style:dotted"></i>基线</span></div></div>',
        '<div class="chart-v2-canvas-wrap" id="labChartWrap"><canvas id="labCanvas"></canvas></div>',
        '<p class="chart-v2-summary" id="labChartSummary"></p>',
        coverage,
        '</div></div>'
      ].join('\n');
      paintChart();
      bindResultButtons();
    }

    function bindResultButtons() {
      [].forEach.call(doc.querySelectorAll('[data-origin]'), function (b) {
        b.addEventListener('click', function () {
          ctx.originIndex = Number(b.getAttribute('data-origin'));
          paintResults();
        });
      });
      [].forEach.call(doc.querySelectorAll('[data-kind]'), function (b) {
        b.addEventListener('click', function () {
          ctx.kind = b.getAttribute('data-kind');
          paintResults();
        });
      });
    }

    function setStatus(text, busy) {
      var el = $('labStatus');
      if (el) el.textContent = text;
      var run = $('labRun');
      if (run) run.disabled = !!busy;
      ctx.busy = !!busy;
    }

    function run() {
      if (ctx.busy) return;
      var raw = currentConfigFromUI();
      var norm = TSJ.labConfig.normalize(raw);
      if (!norm.ok) {
        TSJ.appA11y.toast('配置无效：' + norm.errors[0], 'err');
        return;
      }
      ctx.config = norm.config;
      cleanup();
      setStatus('正在运行…', true);
      var session = {
        token: ctx.token,
        onOrigin: function (o, i, total) { setStatus('正在运行… ' + i + '/' + total, true); }
      };
      TSJ.labRunner.run(ctx.config, session).then(function (res) {
        if (res.canceled) return;
        if (!res.ok) {
          setStatus('运行失败', false);
          TSJ.appA11y.toast((res.errors && res.errors[0]) || '运行失败', 'err');
          return;
        }
        ctx.result = res;
        ctx.originIndex = 0;
        setStatus('完成 · ' + res.origins.length + ' 个测试点', false);
        TSJ.appLabStorage.save(res);
        paintResults();
        var host = $('labHistory');
        if (host) host.innerHTML = panels.historyPanel();
      }).catch(function (err) {
        setStatus('运行异常', false);
        TSJ.appA11y.toast((err && err.message) || String(err), 'err');
      });
    }

    function bind() {
      $('labRun').addEventListener('click', run);
      $('labReset').addEventListener('click', function () {
        var d = TSJ.labConfig.defaults();
        render(scope);
        TSJ.appA11y.toast('已恢复默认配置', 'ok');
      });
      $('labMethod').addEventListener('change', function () {
        var raw = currentConfigFromUI();
        raw.method = $('labMethod').value;
        var norm = TSJ.labConfig.normalize(raw);
        ctx.config = norm.config;
        render(scope);
      });
      $('labMode').addEventListener('change', function () {
        var raw = currentConfigFromUI();
        var norm = TSJ.labConfig.normalize(raw);
        ctx.config = norm.config;
        render(scope);
      });
      var file = $('labImport');
      if (file) {
        file.addEventListener('change', function () {
          var f = file.files && file.files[0];
          if (!f) return;
          var reader = new global.FileReader();
          reader.onload = function () {
            var res = TSJ.appLabStorage.importJSON(String(reader.result || ''));
            if (!res.ok) { TSJ.appA11y.toast('导入失败：' + res.error, 'err'); return; }
            TSJ.appA11y.toast('已导入实验记录', 'ok');
            var host = $('labHistory');
            if (host) host.innerHTML = panels.historyPanel();
          };
          reader.readAsText(f);
        });
      }
      var exportBtn = $('labExport');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          if (!ctx.result) { TSJ.appA11y.toast('还没有可导出的结果', 'err'); return; }
          var text = TSJ.appLabStorage.exportJSON(ctx.result);
          var blob = new global.Blob([text], { type: 'application/json' });
          var a = doc.createElement('a');
          a.href = global.URL.createObjectURL(blob);
          a.download = 'tsoj-lab-' + ctx.result.configHash + '.json';
          a.click();
          global.URL.revokeObjectURL(a.href);
        });
      }
      [].forEach.call(doc.querySelectorAll('[data-load]'), function (b) {
        b.addEventListener('click', function () {
          var hash = b.getAttribute('data-load');
          var rec = TSJ.appLabStorage.list().filter(function (r) { return r.configHash === hash; })[0];
          if (!rec) return;
          render(scope);
          // 重新渲染后用记录配置填充
          var norm = TSJ.labConfig.normalize(rec.config);
          ctx.config = norm.config;
          TSJ.appA11y.toast('已载入配置，点「运行实验」复现', 'ok');
        });
      });
    }

    var host = doc.getElementById('view');
    host.innerHTML = [
      '<div class="wk-hero"><div class="wk-hero-main">',
      '  <div class="wk-kicker">可视化实验室</div>',
      '  <h1>受控回测与诊断</h1>',
      '  <p>选数据、选白名单方法、调有限参数，立即得到确定性结果与诊断图。候选与基线共享同一切分；测试真值不参与校准。</p>',
      '</div></div>',
      '<div class="lab-layout">',
      panels.configPanel(ctx),
      '<div class="lab-results">',
      '  <div class="ds-card"><h2 class="ds-card-title">运行状态</h2><div class="lab-status"><span id="labStatus">空闲</span>' +
      '    <button class="ds-btn ds-btn-sm" id="labExport">导出当前结果</button>' +
      '    <label class="ds-btn ds-btn-sm"><input type="file" id="labImport" accept="application/json" style="display:none">导入实验</label></div></div>',
      '  <div id="labResults"><div class="ds-empty"><strong>还没有运行</strong><span>选好配置后点「运行实验」。</span></div></div>',
      '  <div class="ds-card"><h2 class="ds-card-title">最近实验</h2><div id="labHistory">' + panels.historyPanel() + '</div></div>',
      '</div>',
      '</div>'
    ].join('\n');

    bind();
    TSJ.appA11y.setTitle('可视化实验室 · TSOJ');
  }

  TSJ.appLab = { render: render };
})(typeof window !== 'undefined' ? window : this);
