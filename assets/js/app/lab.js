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
  var KINDS = panels.KINDS;
  var DEMO_PRESETS = panels.DEMO_PRESETS;   // 诊断图类型注册在 panels（外壳渲染需要），这里只引用

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


  function render(scope, initialRaw, demoId) {
    // 初始配置：默认值，或调用方传入（载入历史记录 / 课程演示预设）。
    // 注意不能在这里无条件用 defaults —— 否则「载入配置 / 恢复记录」会被默认值覆盖。
    var preset = demoId ? DEMO_PRESETS[demoId] : null;
    var seed = initialRaw;
    if (!seed && preset) {
      seed = TSJ.labConfig.defaults();
      Object.keys(preset.raw).forEach(function (k) {
        if (k === 'split') { seed.split = preset.raw.split; return; }
        seed[k] = preset.raw[k];
      });
    }
    var initial = TSJ.labConfig.normalize(seed || TSJ.labConfig.defaults());
    var ctx = {
      config: initial.config,
      result: null,
      originIndex: 0,
      kind: (preset && preset.kind) || 'forecast',
      chart: null,
      token: 0,
      busy: false,
      activeSession: null
    };

    function cleanup() {
      ctx.token++;
      ctx.busy = false;
      // 作废在途实验：runner 在每个 origin 开始前检查 session.token，失配即取消，
      // 避免路由切走后旧实验继续占满主线程、再向已拆掉的 DOM 写结果。
      if (ctx.activeSession) ctx.activeSession.token = -1;
      ctx.activeSession = null;
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
      var model, kind = ctx.kind;
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
      if (!box) return;   // 路由已切走：结果面板不存在，静默放弃（结果仍已存入 labStorage）
      if (!ctx.result) {
        box.innerHTML = '<div class="ds-empty"><strong>还没有运行</strong><span>选好配置后点「运行实验」。</span></div>';
        return;
      }
      // 外壳（工具条 / 图表区 / 指标区 / 实时滑杆区）由 panels 生成；
      // 之后 origin/kind 切换与实时调节都走 repaintResult 轻量重绘，不重建滑杆。
      box.innerHTML = panels.resultShell(ctx.result, { kind: ctx.kind, originIndex: ctx.originIndex });
      paintChart();
      bindResultButtons();
      TSJ.appLabLive.bind({ onChange: liveRerun });
    }

    /**
     * 轻量重绘：只更新图表、覆盖说明与指标表（origin/kind 切换、实时调节共用）。
     * 不重建工具条与滑杆，保持拖动状态。
     */
    function repaintResult() {
      var r = ctx.result;
      if (!r) return;
      var o = r.origins[ctx.originIndex] || r.origins[0];
      var cov = $('labCoverage');
      if (cov) {
        cov.innerHTML = (o && o.coverage && o.coverage.length)
          ? '经验覆盖：' + o.coverage.map(function (c) {
              return c.level + '% → ' + (isFinite(c.rate) ? (c.rate * 100).toFixed(0) + '%' : '—') + '（n=' + c.n + '）';
            }).join(' · ')
          : '';
      }
      var mz = $('labMetricsZone');
      if (mz) mz.innerHTML = panels.metricTable(r);
      paintChart();
    }

    /** 同步工具条按钮的激活态（origin / kind）。 */
    function syncToolbarActive() {
      [].forEach.call(doc.querySelectorAll('[data-origin]'), function (b) {
        b.classList[Number(b.getAttribute('data-origin')) === ctx.originIndex ? 'add' : 'remove']('ds-btn-primary');
      });
      [].forEach.call(doc.querySelectorAll('[data-kind]'), function (b) {
        b.classList[b.getAttribute('data-kind') === ctx.kind ? 'add' : 'remove']('lab-seg-on');
      });
    }

    /** 实时重算回调（滑杆拖动，防抖后到达）：不写记录、不动正式配置指纹。 */
    function liveRerun() {
      if (ctx.busy || !ctx.result) return;
      var raw = currentConfigFromUI();
      raw.params = TSJ.appLabLive.currentParams();
      var norm = TSJ.labConfig.normalize(raw);
      if (!norm.ok) return;
      TSJ.labRunner.run(norm.config, { token: ctx.token }).then(function (res) {
        if (res.canceled || !res.ok) return;
        ctx.result = res;
        ctx.originIndex = 0;
        repaintResult();
        var el = $('labStatus');
        if (el) el.textContent = '实时预览（未保存）· ' + res.origins.length + ' 个测试点';
      });
    }

    function bindResultButtons() {
      [].forEach.call(doc.querySelectorAll('[data-origin]'), function (b) {
        b.addEventListener('click', function () {
          ctx.originIndex = Number(b.getAttribute('data-origin'));
          syncToolbarActive();
          repaintResult();
        });
      });
      [].forEach.call(doc.querySelectorAll('[data-kind]'), function (b) {
        b.addEventListener('click', function () {
          ctx.kind = b.getAttribute('data-kind');
          syncToolbarActive();
          repaintResult();
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
      ctx.activeSession = session;
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

    /** 切分模式下窗口数 / 起点步长的可用性（holdout 用不到这两个输入）。 */
    function syncSplitInputs() {
      var mode = $('labMode');
      var win = $('labWindows');
      var step = $('labOriginStep');
      var rolling = !!(mode && mode.value === 'rolling');
      if (win) win.disabled = !rolling;
      if (step) step.disabled = !rolling;
    }

    function bind() {
      $('labRun').addEventListener('click', run);
      $('labReset').addEventListener('click', function () {
        render(scope);
        TSJ.appA11y.toast('已恢复默认配置', 'ok');
      });
      /*
       * 方法切换：只局部重绘参数块，不整页重建。
       * 旧实现 render(scope) 会用默认配置重建整个表单 —— 用户刚选的方法立刻
       * 弹回 holt-winters，数据集 / 指标 / 区间 / 结果全被重置（11/12 个方法在
       * UI 上不可达）。运行时 run() 会从 UI 现读全部字段，这里只需同步参数块。
       */
      $('labMethod').addEventListener('change', function () {
        var raw = currentConfigFromUI();
        var norm = TSJ.labConfig.normalize(raw);
        ctx.config = norm.config;
        var box = $('labParams');
        if (box) box.innerHTML = panels.paramsHtml(norm.config.method);
        TSJ.appLabLive.reset();   // 旧方法的滑杆对新方法无意义：清空，待下次运行重建
      });
      $('labMode').addEventListener('change', function () {
        syncSplitInputs();
      });
      syncSplitInputs();
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
          // 用记录的配置重建页面（旧实现 render 后再写旧闭包的 ctx，是死代码）
          render(scope, rec.config);
          TSJ.appA11y.toast('已载入配置，点「运行实验」复现', 'ok');
        });
      });
    }

    var host = doc.getElementById('view');
    host.innerHTML = [
      '<div class="wk-hero wk-hero-slim"><div class="wk-hero-main">',
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
