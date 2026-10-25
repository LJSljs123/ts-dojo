/**
 * assets/js/lab/stats.js —— 实验室纯函数：指标、训练残差、经验分位区间
 *
 * 区间只使用“预测起点之前”的训练残差；测试真值绝不参与校准。
 * 这里的区间是教学演示，不是模型原生概率输出。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var judge = TSJ.judge;
  var stats = TSJ.chartStats || {};

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function metricsFor(actual, pred, names) {
    var out = {};
    (names || []).forEach(function (name) {
      var fn = judge.metrics[name];
      out[name] = fn ? fn(actual, pred) : NaN;
    });
    return out;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * 在训练段内部计算一步预测残差（只用 t 之前的数据）。
   * @param {Function} runJobs 适配器批量执行函数
   * @param {number[]} values 完整序列
   * @param {number} minHistory 方法最小历史
   * @param {Object} [opts] { season }：必须与最终预测一致，否则残差来自不同参数形态的模型
   * @returns {number[]} 残差数组（已排序）
   */
  function trainingResiduals(runJobs, values, minHistory, opts) {
    var season = (opts && typeof opts.season === 'number') ? opts.season : 1;
    var start = Math.max(minHistory, 2);
    if (values.length <= start + 1) return [];
    var jobs = [];
    var index = [];
    for (var t = start; t < values.length; t++) {
      jobs.push({
        history: values.slice(0, t),
        horizon: 1,
        ctx: { season: season, datasetId: 'lab-train', index: t }
      });
      index.push(t);
    }
    var run = runJobs(jobs);
    var residuals = [];
    for (var i = 0; i < index.length; i++) {
      var r = run.results && run.results[i];
      if (r && r.status === 'ok' && finite(r.value[0])) residuals.push(values[index[i]] - r.value[0]);
    }
    residuals.sort(function (a, b) { return a - b; });
    return residuals;
  }

  /**
   * 由训练残差构造对称经验区间。
   * @returns {Array<{level:number,lower:number,upper:number}>}
   */
  function empiricalIntervals(residuals, levels) {
    if (!residuals.length) return [];
    var out = [];
    (levels || [80, 95]).forEach(function (level) {
      var alpha = (100 - level) / 100;
      var lo = quantile(residuals, alpha / 2);
      var hi = quantile(residuals, 1 - alpha / 2);
      if (finite(lo) && finite(hi)) out.push({ level: level, lower: lo, upper: hi });
    });
    return out;
  }

  function coverage(actual, lower, upper) {
    var n = 0, hit = 0;
    for (var i = 0; i < actual.length; i++) {
      if (!finite(actual[i]) || !finite(lower[i]) || !finite(upper[i])) continue;
      n++;
      if (actual[i] >= lower[i] && actual[i] <= upper[i]) hit++;
    }
    return n ? { n: n, rate: hit / n } : { n: 0, rate: NaN };
  }

  function applyInterval(prediction, interval) {
    var lower = [], upper = [];
    for (var i = 0; i < prediction.length; i++) {
      lower.push(finite(prediction[i]) ? prediction[i] + interval.lower : NaN);
      upper.push(finite(prediction[i]) ? prediction[i] + interval.upper : NaN);
    }
    return { lower: lower, upper: upper };
  }

  function summaryMetrics(metrics) {
    var keys = Object.keys(metrics);
    return keys.map(function (k) {
      var v = metrics[k];
      return (judge.metricLabels[k] || k) + ' ' + (finite(v) ? v.toFixed(3) : '—');
    }).join(' · ');
  }

  TSJ.labStats = {
    finite: finite,
    metricsFor: metricsFor,
    quantile: quantile,
    trainingResiduals: trainingResiduals,
    empiricalIntervals: empiricalIntervals,
    coverage: coverage,
    applyInterval: applyInterval,
    summaryMetrics: summaryMetrics,
    mean: stats.mean || function () { return NaN; }
  };
})(typeof window !== 'undefined' ? window : this);
