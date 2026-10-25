/**
 * assets/js/lab/adapters.js —— 白名单方法的唯一适配层
 *
 * 基线直接调用 judge.baselines；参考方法用「题目参考解 + 精确参数锚点替换」，
 * 再用 judge.runInProcess 执行与校验。锚点缺失或替换不唯一时**失败关闭**，
 * 绝不复制算法，也不用宽松正则猜参数。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var judge = TSJ.judge;
  var config = TSJ.labConfig;

  var ANCHORS = {
    ses: [{ from: 'var alpha = 0.28;', param: 'alpha' }],
    holt: [
      { from: 'var alpha = 0.42;', param: 'alpha' },
      { from: 'var beta = 0.10;', param: 'beta' }
    ],
    'holt-winters': [
      { from: 'var alpha = 0.32;', param: 'alpha' },
      { from: 'var beta = 0.06;', param: 'beta' },
      { from: 'var gamma = 0.28;', param: 'gamma' }
    ],
    ar: [{ from: 'var p = Math.min(10, Math.max(1, Math.floor(n / 4)));', param: 'order' }],
    theta: [{ from: 'var alpha = 0.2;', param: 'alpha' }],
    dlinear: [],
    tsb: [
      { from: 'var alpha = 0.05;', param: 'alpha' },
      { from: 'var beta = 0.1;', param: 'beta' }
    ],
    combination: []
  };

  var SOURCE_PROBLEM = {
    ses: 'p4-ses',
    holt: 'p5-holt',
    'holt-winters': 'p6-holt-winters',
    ar: 'p11-ar-yw',
    theta: 'p10-theta',
    dlinear: 'p15-dlinear',
    tsb: 'p12-croston',
    combination: 'p14-combination'
  };

  function replaceOnce(src, anchor, replacement, label) {
    var idx = src.indexOf(anchor);
    if (idx < 0) throw new Error('参数锚点缺失：' + label);
    if (src.indexOf(anchor, idx + anchor.length) >= 0) throw new Error('参数锚点不唯一：' + label);
    return src.slice(0, idx) + replacement + src.slice(idx + anchor.length);
  }

  function buildSource(method, params) {
    if (!config.METHODS[method]) throw new Error('方法不在白名单：' + method);
    var problemId = SOURCE_PROBLEM[method];
    // 既不是基线、又没有参考解的白名单方法属于配置错误：必须抛错，
    // 不能返回 null —— 否则 null 会被当成源码字符串编译成 "predict is not defined"。
    if (!problemId) throw new Error('方法缺少基线与参考解的适配：' + method);
    var p = TSJ.findProblem(problemId);
    if (!p || !p.solution) throw new Error('找不到参考解：' + problemId);
    var src = p.solution;
    var anchors = ANCHORS[method] || [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var value = params[a.param];
      if (value == null) continue;
      var literal = a.param === 'order' ? String(Math.round(value)) : String(value);
      src = replaceOnce(src, a.from, 'var ' + a.param + ' = ' + literal + ';', method + '.' + a.param);
    }
    return src;
  }

  /**
   * 白名单键 → judge.baselines 键的映射。
   * 白名单用连字符（seasonal-naive），judge 基线用下划线（seasonal_naive）——
   * 不映射的话这两个方法会走「参考解」分支并因找不到来源而失败。
   */
  function baselineKeyOf(method) {
    return method.indexOf('-') >= 0 ? method.replace(/-/g, '_') : method;
  }

  /**
   * 批量执行同一方法的一组任务：参考方法只编译一次，避免逐点重复编译。
   * @returns {{results:Array}} 与 judge.runInProcess 同构
   */
  function runJobs(method, params, jobs) {
    if (!config.METHODS[method]) throw new Error('方法不在白名单：' + method);
    params = params || {};
    var baseline = judge.baselines[baselineKeyOf(method)];
    if (baseline) {
      var results = [];
      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        try {
          var out = baseline(job.history.slice(), job.horizon, job.ctx);
          if (!Array.isArray(out) || out.length !== job.horizon) throw new Error('基线输出长度不正确');
          results.push({ status: 'ok', value: out });
        } catch (err) {
          results.push({ status: 'error', error: (err && err.message) || String(err), line: null });
        }
      }
      return { results: results, timedOut: false };
    }
    var src = buildSource(method, params);
    return judge.runInProcess(src, jobs);
  }

  /**
   * 返回一个预测函数。
   * @param {string} method 白名单方法
   * @param {Object} params 参数
   */
  function buildForecaster(method, params) {
    var runner = function (jobs) { return runJobs(method, params, jobs); };
    return function (history, horizon, ctx) {
      var run = runner([{ history: history.slice(), horizon: horizon, ctx: ctx }]);
      var r = run.results && run.results[0];
      if (!r || r.status !== 'ok') throw new Error((r && r.error) || '预测失败');
      return r.value;
    };
  }

  /**
   * 创建一个批量执行器：参考方法只编译一次，避免逐点重复编译。
   */
  function createRunner(method, params) {
    return function (jobs) { return runJobs(method, params, jobs); };
  }

  TSJ.labAdapters = {
    ANCHORS: ANCHORS,
    SOURCE_PROBLEM: SOURCE_PROBLEM,
    baselineKeyOf: baselineKeyOf,
    buildSource: buildSource,
    runJobs: runJobs,
    createRunner: createRunner,
    buildForecaster: buildForecaster
  };
})(typeof window !== 'undefined' ? window : this);
