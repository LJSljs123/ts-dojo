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

  /**
   * 生成自包含分享卡 HTML（图表 canvas 转内嵌 PNG，打开即看、无任何外链）。
   * @param {Object} view 与 paint 同构的 view 对象
   * @returns {string} 完整 HTML 文档文本（调用方负责触发下载）
   */
  function buildShareCard(view) {
    var rec = view.rec;
    var d = view.d;
    var isFinal = rec.kind === 'final';
    var canvas = global.document.getElementById('studioCanvas');
    var imgData = '';
    try { imgData = canvas ? canvas.toDataURL('image/png') : ''; } catch (e) { imgData = ''; }
    var fmtCard = function (v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '—'; };
    var mVal = isFinal ? fmtCard(rec.testMetrics.mse) : fmtCard(rec.valMetrics.mse);
    var rows = [
      ['数据集', esc(d.name)],
      ['阶段', isFinal ? '🏁 最终评测（test）' : '🔁 验证集评估（val）'],
      ['拆分', 'train ' + rec.split[0] + ' / val ' + rec.split[1] + ' / test ' + rec.split[2]],
      ['MSE', mVal],
      ['代码指纹', esc(rec.codeHash)],
      ['test 评测次数', isFinal ? String(rec.testRuns) : '—']
    ].map(function (r) {
      return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    }).join('');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>TSOJ 模型工坊实验卡 ' + esc(rec.codeHash) + '</title><style>' +
      'body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
      'background:#0d1117;color:#e6edf3;margin:0;padding:28px;display:flex;justify-content:center}' +
      '.tsc-card{max-width:680px;width:100%;background:#131a22;border:1px solid #1f2833;border-radius:14px;padding:26px}' +
      'h1{font-size:18px;margin:0 0 4px}.tsc-sub{color:#8b98a9;font-size:12.5px;margin:0 0 18px}' +
      'img{width:100%;border:1px solid #1f2833;border-radius:10px;background:#0d1117}' +
      'table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}' +
      'th{color:#8b98a9;text-align:left;padding:7px 10px;border-bottom:1px solid #1f2833;white-space:nowrap}' +
      'td{padding:7px 10px;border-bottom:1px solid #1f2833;font-family:ui-monospace,Consolas,monospace}' +
      '.tsc-foot{color:#5c6874;font-size:11.5px;margin-top:16px;text-align:center}' +
      '</style></head><body><div class="tsc-card">' +
      '<h1>时序竞技场 TSOJ · 模型工坊实验卡</h1>' +
      '<p class="tsc-sub">纯前端沙箱内完成 · 数据与代码只存在本地浏览器</p>' +
      (imgData ? '<img src="' + imgData + '" alt="预测对比图">' : '') +
      '<table>' + rows + '</table>' +
      '<div class="tsc-foot">由 时序竞技场 TSOJ 生成 · ' + new Date(rec.at).toISOString().slice(0, 10) + '</div>' +
      '</div></body></html>';
  }

  /**
   * 协变量开关区 html（studio.js 只做赋值与绑定）。
   * 数据集无 promoDays/parts 时给出明确空态，不冒充可注入。
   */
  function covChecksHtml(ds, cov) {
    var checks = [];
    if (ds.promoDays) checks.push('<label class="ds-badge"><input type="checkbox" id="studioCovPromo"' +
      (cov.promo ? ' checked' : '') + '> 注入促销日历（ctx.promoDays，' + ds.promoDays.length + ' 天）</label>');
    if (ds.parts) checks.push('<label class="ds-badge"><input type="checkbox" id="studioCovParts"' +
      (cov.parts ? ' checked' : '') + '> 注入渠道历史（ctx.parts）</label>');
    return checks.length
      ? '<span class="ds-card-sub">协变量（只读注入，val/test 段同样可得）：</span>' + checks.join(' ')
      : '<span class="ds-card-sub">该数据集无协变量注入。</span>';
  }

  /**
   * 实验记录 + 对比视图：同一数据集的最终记录 ≥2 条时，追加 MSE 对比表
   * （代码哈希 / val / test / 评测次数），行内 data-code 供「载回代码」。
   */
  function recordsPanel(records, datasetId) {
    function fmtD(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '—'; }
    var listHtml = records.length
      ? '<div class="lab-history">' + records.map(function (r) {
          return '<div class="lab-history-item"><span>' + (r.kind === 'final' ? '🏁' : '🔁') + ' ' +
            esc(r.datasetId) + ' · ' + esc(r.kind === 'final' ? '最终' : '验证') + ' · MSE ' +
            (r.kind === 'final' ? fmtD(r.testMetrics.mse) : fmtD(r.valMetrics.mse)) + ' · ' + esc(r.codeHash) + '</span>' +
            '<span><button data-code="' + esc(r.codeHash) + '">载入代码</button></span></div>';
        }).join('') + '</div>'
      : '<div class="ds-empty"><strong>还没有实验记录</strong><span>每代代码的 val/test 成绩都会留档。</span></div>';
    var finals = records.filter(function (r) {
      return r.kind === 'final' && (!datasetId || r.datasetId === datasetId);
    });
    var compare = '';
    if (finals.length >= 2) {
      var rows = finals.map(function (r) {
        return '<tr><td><button type="button" class="cmdk-go" data-code="' + esc(r.codeHash) + '">' + esc(r.codeHash) + '</button></td>' +
          '<td class="num">' + fmtD(r.valMetrics.mse) + '</td>' +
          '<td class="num">' + fmtD(r.testMetrics.mse) + '</td>' +
          '<td class="num">' + r.testRuns + '</td></tr>';
      }).join('');
      compare = '<h3 class="lab-metrics-title">对比（同数据集最终评测）</h3>' +
        '<div class="ds-table-wrap"><table class="ds-table ds-table-hover"><thead><tr>' +
        '<th>代码</th><th class="num">val MSE</th><th class="num">test MSE</th><th class="num">test 次数</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="ds-card-sub">val→test 的落差就是泛化差距；同一代码 test 次数 &gt;1 时数字已失去无偏性。</p>';
    }
    return listHtml + compare;
  }

  TSJ.appStudioReport = {
    paint: paint,
    buildShareCard: buildShareCard,
    covChecksHtml: covChecksHtml,
    recordsPanel: recordsPanel
  };
})(typeof window !== 'undefined' ? window : this);
