/**
 * assets/js/app/studio-report.js —— 模型工坊实验报告绘制（v3.6）
 * 加载顺序：… app/studio-storage → app/studio-report → app/studio.js
 * 挂载点：window.TSJ.appStudioReport
 *
 * 纯绘制层：指标对比表（val 列自动回查同代码哈希的验证记录）+ 预测对比图
 * （复用 v3 图表内核 forecast 渲染器，train/val/test 分界线由 splits 标出）。
 * 图表实例通过 opts.setChart 交还调用方管理（路由销毁 / 换图 destroy）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var esc = core.esc;

  function fmt(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '—'; }

  function bestOf(baselines) {
    var best = null;
    var keys = Object.keys(baselines || {});
    for (var i = 0; i < keys.length; i++) {
      var v = baselines[keys[i]] && baselines[keys[i]].mse;
      if (typeof v === 'number' && isFinite(v) && (best === null || v < best)) best = v;
    }
    return best;
  }

  /**
   * 绘制实验报告。
   * @param {Object} view { rec, actual, pred, baseline, sp, historyLen, d }
   * @param {Object} opts { scope, setChart(chart) }
   */
  function paint(view, opts) {
    var report = global.document.getElementById('studioReport');
    if (!report) return;
    var rec = view.rec;
    var d = view.d;
    var isFinal = rec.kind === 'final';

    // 最终评测的 val 对比列：回查同一份代码的最近验证记录（没有就显示 —）
    var valRec = null;
    if (isFinal) {
      var all = TSJ.appStudioStorage.list();
      for (var k = 0; k < all.length; k++) {
        if (all[k].kind === 'val' && all[k].codeHash === rec.codeHash) { valRec = all[k]; break; }
      }
    }
    var mVal = isFinal ? (valRec ? valRec.valMetrics.mse : null) : rec.valMetrics.mse;
    var baseVal = isFinal ? (valRec ? bestOf(valRec.baselinesVal) : null) : bestOf(rec.baselinesVal);
    var mTest = isFinal ? rec.testMetrics.mse : null;
    var baseTest = isFinal ? bestOf(rec.baselinesTest) : null;

    var rows = '<tr><td>MSE</td>' +
      '<td class="num">' + fmt(mVal) + '</td><td class="num">' + fmt(baseVal) + '</td>' +
      (isFinal ? '<td class="num">' + fmt(mTest) + '</td><td class="num">' + fmt(baseTest) + '</td>' : '') + '</tr>';

    report.innerHTML = [
      '<div class="studio-report-head"><span class="ds-badge ' + (isFinal ? 'ds-badge-ok' : '') + '">' +
      (isFinal ? '🏁 最终评测 · train+val 拟合 → test 打分' : '🔁 验证集评估 · train 拟合 → val 打分') + '</span>' +
      '<span class="ds-badge">' + esc(d.name) + '</span>' +
      '<span class="ds-badge">代码 ' + esc(rec.codeHash) + '</span></div>',
      '<div class="ds-table-wrap"><table class="ds-table ds-table-hover"><thead><tr><th>MSE</th>' +
      '<th class="num">你的（val）</th><th class="num">最优基线（val）</th>' +
      (isFinal ? '<th class="num">你的（test）</th><th class="num">最优基线（test）</th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>',
      isFinal && rec.testRuns > 1
        ? '<p class="md-note"><span>⚠</span><span>这份代码已对 test 评测 ' + rec.testRuns + ' 次——继续按 test 调参会让它变成另一个验证集。</span></p>'
        : '<p class="ds-card-sub">比值 = 你的 MSE ÷ 最优基线 MSE，&lt;1 表示跑赢了基线；模型选择只允许看 val。</p>',
      '<div class="chart-v2"><div class="chart-v2-head"><h3>预测对比</h3>' +
      '<div class="chart-v2-legend"><span><i style="border-color:var(--v3-chart-history)"></i>历史</span>' +
      '<span><i style="border-color:var(--v3-chart-actual)"></i>' + (isFinal ? 'test 真值' : 'val 真值') + '</span>' +
      '<span><i style="border-color:var(--v3-chart-pred);border-top-style:dashed"></i>你的模型</span>' +
      '<span><i style="border-color:var(--v3-chart-baseline);border-top-style:dotted"></i>移动平均</span></div></div>',
      '<div class="chart-v2-canvas-wrap"><canvas id="studioCanvas"></canvas></div>',
      '<p class="chart-v2-summary" id="studioChartSummary"></p></div>'
    ].join('\n');

    var values = d.values;
    var start = view.historyLen;
    var n = values.length;
    function pad(arr) {
      var out = new Array(n).fill(null);
      for (var i = 0; i < arr.length && start + i < n; i++) out[start + i] = arr[i];
      return out;
    }
    var model = {
      n: n,
      history: values.slice(),
      actual: pad(view.actual),
      prediction: pad(view.pred),
      baseline: pad(view.baseline),
      splits: isFinal
        ? [{ index: rec.split[0], role: 'val', label: '验证起点' }, { index: rec.split[0] + rec.split[1], role: 'test', label: '测试起点' }]
        : [{ index: rec.split[0], role: 'test', label: '验证起点' }],
      maxPoints: 1200
    };
    var chart = TSJ.charts.create(global.document.getElementById('studioCanvas'), {
      kind: 'forecast', scope: opts.scope, height: 280, unit: d.unit,
      ariaLabel: '模型工坊预测对比图', onInspect: function () {}
    });
    chart.update(model);
    var sm = global.document.getElementById('studioChartSummary');
    if (sm) sm.textContent = chart.summary() || '';
    if (typeof opts.setChart === 'function') opts.setChart(chart);
  }

  TSJ.appStudioReport = { paint: paint };
})(typeof window !== 'undefined' ? window : this);
