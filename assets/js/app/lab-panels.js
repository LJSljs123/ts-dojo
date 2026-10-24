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
      paramsHtml(cfg.method),
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
      return '<tr><td>' + esc(TSJ.labConfig.METRICS[m].label) + '</td>' +
        '<td class="num">' + fmt(result.metrics.mean[m]) + '</td>' +
        '<td class="num">' + fmt(result.metrics.worst[m]) + '</td>' +
        '<td class="num">' + fmt(result.metrics.baselineMean[m]) + '</td>' +
        '<td class="num">' + fmt(result.metrics.baselineWorst[m]) + '</td></tr>';
    }).join('');
    return '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>指标</th><th class="num">均值</th><th class="num">最差窗口</th><th class="num">基线均值</th><th class="num">基线最差</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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
    paramsHtml: paramsHtml,
    metricChecks: metricChecks,
    configPanel: configPanel,
    originModel: originModel,
    metricTable: metricTable,
    historyPanel: historyPanel
  };
})(typeof window !== 'undefined' ? window : this);
