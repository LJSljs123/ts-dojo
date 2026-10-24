/**
 * assets/js/lab/runner.js —— 实验室确定性执行器
 *
 * - 先冻结配置，再用 judge.buildTestPoints 生成 origins；
 * - 每个 origin 只用其 history，候选与基线共享同一样本；
 * - 逐 origin 让出主线程；token 失效立即取消，旧结果整段丢弃；
 * - 区间只用训练段内部残差，测试真值绝不参与校准。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var judge = TSJ.judge;
  var adapters = TSJ.labAdapters;
  var labStats = TSJ.labStats;
  var core = TSJ.appCore;

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function yieldControl() {
    return new Promise(function (resolve) { global.setTimeout(resolve, 0); });
  }

  function hashConfig(cfg) {
    var text = TSJ.labConfig.stableStringify(cfg);
    if (core && typeof core.fnv1a === 'function') return core.fnv1a(text).slice(0, 8);
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function metricValue(name, actual, pred) {
    var fn = judge.metrics[name];
    return fn ? fn(actual, pred) : NaN;
  }

  /**
   * 运行实验。
   * @param {Object} rawConfig 配置
   * @param {Object} session { token, onOrigin, onStatus }
   * @returns {Promise<Object>} 结果；被取消时 resolve { canceled:true }
   */
  function run(rawConfig, session) {
    session = session || {};
    var started = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    var norm = TSJ.labConfig.normalize(rawConfig);
    if (!norm.ok) {
      return Promise.resolve({ ok: false, errors: norm.errors });
    }
    var cfg = norm.config;
    var token = session.token;
    var ds = null;
    for (var i = 0; i < (TSJ.datasets || []).length; i++) {
      if (TSJ.datasets[i].id === cfg.datasetId) ds = TSJ.datasets[i];
    }
    if (!ds) return Promise.resolve({ ok: false, errors: ['数据集不存在：' + cfg.datasetId] });

    var points = judge.buildTestPoints(ds.values, {
      mode: cfg.split.mode,
      horizon: cfg.split.horizon,
      windows: cfg.split.windows,
      originStep: cfg.split.originStep,
      season: ds.season,
      freq: ds.freq,
      datasetId: ds.id
    });

    var meta = TSJ.labConfig.METHODS[cfg.method];
    var runJobs = adapters.createRunner(cfg.method, cfg.params);
    var origins = [];
    var aggregate = {};
    var baselineAggregate = {};
    cfg.metrics.forEach(function (m) { aggregate[m] = []; baselineAggregate[m] = []; });

    function step() {
      if (session.token != null && token != null && session.token !== token) {
        return Promise.resolve({ canceled: true });
      }
      if (!origins.length && points.length) return runOrigin(points[0], 0);
      var idx = origins.length;
      if (idx >= points.length) return finish();
      return runOrigin(points[idx], idx);
    }

    function runOrigin(point, idx) {
      var jobs = [];
      var trainIndex = [];
      if (cfg.interval.enabled) {
        var start = Math.max(meta.minHistory, 2);
        for (var t = start; t < point.history.length; t++) {
          jobs.push({ history: point.history.slice(0, t), horizon: 1, ctx: { season: 0, datasetId: ds.id, index: t } });
          trainIndex.push(t);
        }
      }
      var finalJob = jobs.length;
      jobs.push({ history: point.history.slice(), horizon: cfg.split.horizon, ctx: point.ctx });

      var run;
      try {
        run = runJobs(jobs);
      } catch (err) {
        return Promise.resolve({ ok: false, errors: ['第 ' + (idx + 1) + ' 个测试点执行失败：' + ((err && err.message) || err)] });
      }
      for (var k = 0; k < run.results.length; k++) {
        if (!run.results[k] || run.results[k].status !== 'ok') {
          return Promise.resolve({ ok: false, errors: ['第 ' + (idx + 1) + ' 个测试点预测失败：' + ((run.results[k] && run.results[k].error) || '未知错误')] });
        }
      }

      var prediction = run.results[finalJob].value;
      var baselinePred = judge.baselines[cfg.baseline](point.history.slice(), cfg.split.horizon, point.ctx);
      var metrics = {};
      var baselineMetrics = {};
      cfg.metrics.forEach(function (m) {
        metrics[m] = metricValue(m, point.actual, prediction);
        baselineMetrics[m] = metricValue(m, point.actual, baselinePred);
        if (finite(metrics[m])) aggregate[m].push(metrics[m]);
        if (finite(baselineMetrics[m])) baselineAggregate[m].push(baselineMetrics[m]);
      });

      var intervals = [];
      var coverage = [];
      if (cfg.interval.enabled) {
        var residuals = [];
        for (var r = 0; r < trainIndex.length; r++) {
          var pv = run.results[r].value[0];
          if (finite(pv)) residuals.push(point.history[trainIndex[r]] - pv);
        }
        residuals.sort(function (a, b) { return a - b; });
        intervals = labStats.empiricalIntervals(residuals, cfg.interval.levels);
        intervals.forEach(function (iv) {
          var band = labStats.applyInterval(prediction, iv);
          coverage.push({
            level: iv.level,
            n: point.actual.length,
            rate: labStats.coverage(point.actual, band.lower, band.upper).rate
          });
          iv.lower = band.lower;
          iv.upper = band.upper;
        });
      }

      origins.push({
        index: idx,
        history: point.history,
        actual: point.actual,
        prediction: prediction,
        baseline: baselinePred,
        metrics: metrics,
        baselineMetrics: baselineMetrics,
        intervals: intervals,
        coverage: coverage
      });

      if (typeof session.onOrigin === 'function') session.onOrigin(origins[origins.length - 1], idx + 1, points.length);
      return yieldControl().then(step);
    }

    function finish() {
      var mean = {};
      var worst = {};
      var baselineMean = {};
      var baselineWorst = {};
      cfg.metrics.forEach(function (m) {
        var arr = aggregate[m];
        var barr = baselineAggregate[m];
        mean[m] = arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : NaN;
        worst[m] = arr.length ? Math.max.apply(null, arr) : NaN;
        baselineMean[m] = barr.length ? barr.reduce(function (a, b) { return a + b; }, 0) / barr.length : NaN;
        baselineWorst[m] = barr.length ? Math.max.apply(null, barr) : NaN;
      });
      var durationMs = ((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - started;
      return {
        ok: true,
        canceled: false,
        schema: 1,
        appVersion: '3.0.0',
        algorithmVersion: 'lab-1',
        datasetVersion: 'datasets-' + ((TSJ.datasets || []).length),
        createdAt: Date.now(),
        config: cfg,
        configHash: hashConfig(cfg),
        origins: origins,
        metrics: { mean: mean, worst: worst, baselineMean: baselineMean, baselineWorst: baselineWorst },
        baseline: cfg.baseline,
        intervalMeta: cfg.interval.enabled
          ? { kind: 'residual-empirical', note: '训练段内部一步残差分位；教学演示，非模型原生概率输出' }
          : null,
        durationMs: Math.round(durationMs)
      };
    }

    return step();
  }

  TSJ.labRunner = { run: run, hashConfig: hashConfig };
})(typeof window !== 'undefined' ? window : this);
