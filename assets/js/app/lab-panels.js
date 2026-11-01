/**
 * assets/js/app/lab-panels.js —— 实验室 UI 面板片段（纯字符串生成）
 *
 * 与 app/lab.js 分离：这里不做事件绑定与图表生命周期，只输出 HTML 片段，
 * 方便控制单文件长度并独立做静态审计。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var esc = core.esc;

  /**
   * 课程「打开演示」预设（#/lab?demo=<id>，由 router 传入 lab.js）：
   * 把课程概念映射成一组可运行的实验室配置 + 默认诊断图。
   * feature-window（m3 特征工程）在实验室没有对应方法，课程侧为概念级演示。
   */
  var DEMO_PRESETS = {
    'decomposition': { raw: { datasetId: 'airline', method: 'holt-winters' }, kind: 'decomposition' },
    'acf-pacf': { raw: { datasetId: 'airline', method: 'ses' }, kind: 'acf' },
    'dlinear': { raw: { datasetId: 'electricity', method: 'dlinear' }, kind: 'forecast' },
    'intervals': { raw: { datasetId: 'airline', method: 'holt-winters' }, kind: 'forecast' },
    'rolling': { raw: { datasetId: 'airline', method: 'holt-winters', split: { mode: 'rolling', horizon: 12, windows: 4, originStep: 12 } }, kind: 'forecast' },
    'croston': { raw: { datasetId: 'intermittent', method: 'tsb' }, kind: 'forecast' }
  };

  /** 诊断图类型（lab.js 与结果外壳共用同一份注册表）。 */
  var KINDS = [
    { id: 'forecast', label: '预测对比' },
    { id: 'residual', label: '残差' },
    { id: 'acf', label: 'ACF' },
    { id: 'pacf', label: 'PACF' },
    { id: 'decomposition', label: '季节分解' }
  ];

  function paramsHtml(method) {
    var meta = TSJ.labConfig.METHODS[method];
    if (!meta || !Object.keys(meta.params).length) return '<p class="ds-card-sub">该方法无可调参数。</p>';
    var rows = Object.keys(meta.params).map(function (key) {
      var r = meta.params[key];
      return '<label class="ds-field"><span>' + esc(key) + '（' + r.min + '–' + r.max + '）</span>' +
        '<input id="param-' + esc(key) + '" type="number" min="' + r.min + '" max="' + r.max + '" step="' + r.step + '" value="' + r.def + '"></label>';
    });
    return '<div class="lab-config-row">' + rows.join('') + '</div>';
  }

  function metricChecks(selected) {
    return Object.keys(TSJ.labConfig.METRICS).map(function (m) {
      var on = selected.indexOf(m) >= 0;
      return '<label class="ds-badge"><input type="checkbox" class="lab-metric" value="' + m + '"' + (on ? ' checked' : '') + '> ' + esc(TSJ.labConfig.METRICS[m].label) + '</label>';
    }).join('');
  }

  function configPanel(ctx) {
    var cfg = ctx.config;
    return [
      '<div class="ds-card lab-config">',
      '  <h2 class="ds-card-title">实验配置</h2>',
      '  <label class="ds-field"><span>数据集</span><select id="labDataset">',
      TSJ.datasets.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === cfg.datasetId ? ' selected' : '') + '>' + esc(d.name) + '（' + d.values.length + ' 点 · ' + esc(d.freq) + '）</option>';
      }).join(''),
      '  </select></label>',
      '  <label class="ds-field"><span>方法（白名单）</span><select id="labMethod">',
      Object.keys(TSJ.labConfig.METHODS).map(function (m) {
        return '<option value="' + esc(m) + '"' + (m === cfg.method ? ' selected' : '') + '>' + esc(TSJ.labConfig.METHODS[m].label) + '</option>';
      }).join(''),
      '  </select></label>',
      '<div id="labParams">' + paramsHtml(cfg.method) + '</div>',
      '  <div class="lab-config-row">',
      '    <label class="ds-field"><span>切分</span><select id="labMode">',
      '      <option value="holdout"' + (cfg.split.mode === 'holdout' ? ' selected' : '') + '>留出法</option>',
      '      <option value="rolling"' + (cfg.split.mode === 'rolling' ? ' selected' : '') + '>滚动回测</option>',
      '    </select></label>',
      '    <label class="ds-field"><span>horizon</span><input id="labHorizon" type="number" min="1" max="48" value="' + cfg.split.horizon + '"></label>',
      '    <label class="ds-field"><span>窗口数</span><input id="labWindows" type="number" min="1" max="12" value="' + cfg.split.windows + '"></label>',
      '    <label class="ds-field"><span>起点步长</span><input id="labOriginStep" type="number" min="1" max="48" value="' + cfg.split.originStep + '"></label>',
      '  </div>',
      '  <div class="ds-field"><span>指标</span><div>' + metricChecks(cfg.metrics) + '</div></div>',
      '  <label class="ds-field"><span>对照基线</span><select id="labBaseline">',
      TSJ.labConfig.BASELINES.map(function (b) {
        return '<option value="' + esc(b) + '"' + (b === cfg.baseline ? ' selected' : '') + '>' + esc(TSJ.judge.baselineLabels[b] || b) + '</option>';
      }).join(''),
      '  </select></label>',
      '  <label class="ds-badge"><input type="checkbox" id="labInterval"' + (cfg.interval.enabled ? ' checked' : '') + '> 残差经验区间（80/95%）</label>',
      '  <div class="lab-actions">',
      '    <button class="ds-btn ds-btn-primary" id="labRun">运行实验</button>',
      '    <button class="ds-btn" id="labReset">恢复默认</button>',
      '  </div>',
      '  <p class="md-note"><span>⚠</span><span>区间由训练段内部一步残差分位构造，是教学演示，不是模型原生概率输出；测试真值不参与校准。</span></p>',
      '</div>'
    ].join('\n');
  }

  /**
   * 结果卡外壳：工具条 + 图表区 + 指标区 + 实时滑杆区。
   * 图表区 / 指标区 / 覆盖说明都带独立 id，lab.js 的轻量重绘只替换这些区域，
   * 不重建工具条与滑杆（保持拖动状态）。滑杆渲染委托给 app/lab-live.js。
   */
  function resultShell(r, state) {
    var originButtons = r.origins.map(function (o, i) {
      return '<button class="ds-btn ds-btn-sm' + (i === state.originIndex ? ' ds-btn-primary' : '') + '" data-origin="' + i + '">#' + (i + 1) + '</button>';
    }).join('');
    var kindButtons = '<div class="lab-seg" role="group" aria-label="诊断图类型">' + KINDS.map(function (k) {
      return '<button type="button" class="lab-seg-btn' + (k.id === state.kind ? ' lab-seg-on' : '') +
        '" data-kind="' + k.id + '">' + k.label + '</button>';
    }).join('') + '</div>';
    var kindLabel = KINDS.filter(function (k) { return k.id === state.kind; })[0].label;
    return [
      '<div class="ds-card"><h2 class="ds-card-title">结果摘要</h2>',
      '<p class="ds-card-sub">配置指纹 ' + esc(r.configHash) + ' · 数据版本 ' + esc(r.datasetVersion) + ' · 算法版本 ' + esc(r.algorithmVersion) + ' · 耗时 ' + r.durationMs + 'ms</p>',
      '<div class="lab-toolbar"><div class="lab-actions" aria-label="测试点">' + originButtons + '</div>' + kindButtons + '</div>',
      '<div id="labChartZone"><div class="chart-v2"><div class="chart-v2-head"><h3>' + esc(kindLabel) + '</h3>',
      '<div class="chart-v2-legend"><span><i style="border-color:var(--v3-chart-history)"></i>历史</span><span><i style="border-color:var(--v3-chart-actual)"></i>真值</span><span><i style="border-color:var(--v3-chart-pred);border-top-style:dashed"></i>预测</span><span><i style="border-color:var(--v3-chart-baseline);border-top-style:dotted"></i>基线</span></div></div>',
      '<div class="chart-v2-canvas-wrap" id="labChartWrap"><canvas id="labCanvas"></canvas></div>',
      '<p class="chart-v2-summary" id="labChartSummary"></p>',
      '<p class="chart-v2-summary" id="labCoverage"></p>',
      '</div></div>',
      '<div class="lab-metrics" id="labMetricsZone"><h3 class="lab-metrics-title">指标对比</h3>',
      metricTable(r),
      '</div>',
      '<div id="labLiveZone">' + (TSJ.appLabLive ? TSJ.appLabLive.render(r.config) : '') + '</div>',
      '</div>'
    ].join('\n');
  }

  function originModel(origin) {
    var n = origin.history.length + origin.actual.length;
    var split = origin.history.length;
    function pad(arr) {
      var out = new Array(n).fill(null);
      for (var i = 0; i < arr.length; i++) out[split + i] = arr[i];
      return out;
    }
    var intervals = (origin.intervals || []).map(function (iv) {
      return { level: iv.level, lower: pad(iv.lower || []), upper: pad(iv.upper || []) };
    });
    return {
      n: n,
      history: origin.history.slice(),
      actual: pad(origin.actual),
      prediction: pad(origin.prediction),
      baseline: pad(origin.baseline),
      intervals: intervals,
      splits: [{ index: split, role: 'test', label: '测试起点' }],
      maxPoints: 1200
    };
  }

  function metricTable(result) {
    var rows = result.config.metrics.map(function (m) {
      function fmt(v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(3) : '—'; }
      // 候选 vs 基线均值：全部指标都是越小越好；优势格着色 + 方向标
      var meanV = result.metrics.mean[m];
      var baseV = result.metrics.baselineMean[m];
      var hasBoth = isFinite(meanV) && isFinite(baseV);
      var win = hasBoth && meanV < baseV;
      var lose = hasBoth && meanV > baseV;
      var meanCell = fmt(meanV) + (win ? ' <span class="cell-good">▼优</span>' : lose ? ' <span class="cell-bad">▲劣</span>' : '');
      return '<tr><td>' + esc(TSJ.labConfig.METRICS[m].label) + '</td>' +
        '<td class="num">' + meanCell + '</td>' +
        '<td class="num">' + fmt(result.metrics.worst[m]) + '</td>' +
        '<td class="num">' + fmt(result.metrics.baselineMean[m]) + '</td>' +
        '<td class="num">' + fmt(result.metrics.baselineWorst[m]) + '</td></tr>';
    }).join('');
    return '<div class="ds-table-wrap"><table class="ds-table ds-table-hover"><thead><tr><th>指标</th><th class="num">均值</th><th class="num">最差窗口</th><th class="num">基线均值</th><th class="num">基线最差</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function historyPanel() {
    var list = TSJ.appLabStorage.list();
    if (!list.length) return '<div class="ds-empty"><strong>还没有实验记录</strong><span>运行成功后会自动保存最近 20 组。</span></div>';
    return '<div class="lab-history">' + list.map(function (r) {
      var m = r.metrics && r.metrics.mean || {};
      var first = Object.keys(m)[0];
      return '<div class="lab-history-item"><span>' + esc(r.config.datasetId) + ' · ' + esc(r.config.method) + ' · ' + (first ? first.toUpperCase() + ' ' + m[first].toFixed(2) : '—') + '</span>' +
        '<span><button data-load="' + esc(r.configHash) + '">载入配置</button></span></div>';
    }).join('') + '</div>';
  }

  TSJ.appLabPanels = {
    KINDS: KINDS,
    DEMO_PRESETS: DEMO_PRESETS,
    paramsHtml: paramsHtml,
    metricChecks: metricChecks,
    configPanel: configPanel,
    resultShell: resultShell,
    originModel: originModel,
    metricTable: metricTable,
    historyPanel: historyPanel
  };
})(typeof window !== 'undefined' ? window : this);
