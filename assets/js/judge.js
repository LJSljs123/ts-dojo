/**
 * judge.js —— 判题引擎
 *
 * 结构：
 *   metrics   评估指标（mse / rmse / mae / mape / smape）
 *   baselines 统计基线（naive / seasonal_naive / mean / linear_trend / moving_average）
 *   scoring   由「误差比」映射到 0~100 分（分段线性、单调、平滑）
 *   sandbox   Web Worker（Blob URL）沙箱执行用户代码，单次 1500ms / 整题 8000ms
 *   evaluate  异步判题（浏览器走 Worker；无 Worker 环境降级为同线程执行）
 *   evaluateSync 同步判题（只用于可信代码，例如参考解、排行榜计算）
 *
 * 挂载点：window.TSJ.judge = { evaluate, evaluateSync, metrics, baselines, runSandbox, ... }
 * 纯逻辑部分不依赖浏览器 API，可被 Node 直接 require 做单元测试。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 数值保护阈值 */
  var EPS = 1e-12;
  /** 沙箱时限（毫秒） */
  var LIMITS = { perJob: 1500, total: 8000 };

  /* ================================================================== *
   * 0. 小工具
   * ================================================================== */

  /**
   * 把数值夹在区间内。
   * @param {number} v 值
   * @param {number} lo 下界
   * @param {number} hi 上界
   * @returns {number}
   */
  function clamp(v, lo, hi) {
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  /**
   * 取数组均值（空数组返回 NaN）。
   * @param {number[]} arr
   * @returns {number}
   */
  function meanOf(arr) {
    if (!arr || arr.length === 0) return NaN;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  /* ================================================================== *
   * 1. 指标
   * ================================================================== */

  /**
   * 各指标函数签名统一为 fn(actual, predicted) => number（越小越好）。
   * 长度不一致时按较短长度截断计算；空数组返回 NaN。
   */
  var metrics = {
    /** 均方误差 */
    mse: function (actual, predicted) {
      var n = Math.min(actual.length, predicted.length);
      if (n === 0) return NaN;
      var s = 0;
      for (var i = 0; i < n; i++) {
        var d = actual[i] - predicted[i];
        s += d * d;
      }
      return s / n;
    },

    /** 均方根误差 */
    rmse: function (actual, predicted) {
      var m = metrics.mse(actual, predicted);
      return isFinite(m) ? Math.sqrt(m) : NaN;
    },

    /** 平均绝对误差 */
    mae: function (actual, predicted) {
      var n = Math.min(actual.length, predicted.length);
      if (n === 0) return NaN;
      var s = 0;
      for (var i = 0; i < n; i++) s += Math.abs(actual[i] - predicted[i]);
      return s / n;
    },

    /**
     * 平均绝对百分比误差（%）。
     * 对 0 值保护：|actual| < EPS（1e-12）的样本**跳过**，且不计入分母；
     * 若全部样本都被跳过则返回 0（而不是 NaN）。
     */
    mape: function (actual, predicted) {
      var n = Math.min(actual.length, predicted.length);
      if (n === 0) return NaN;
      var s = 0, cnt = 0;
      for (var i = 0; i < n; i++) {
        var a = actual[i];
        if (Math.abs(a) < EPS) continue;
        s += Math.abs((a - predicted[i]) / a);
        cnt++;
      }
      if (cnt === 0) return 0;
      return (s / cnt) * 100;
    },

    /**
     * 对称平均绝对百分比误差（%）。
     * 分母 |a| + |p| < EPS（1e-12）的样本**跳过**：贡献 0 误差，
     * 但**仍计入 n**（即按「该点误差为 0」处理），与 mape 的「跳过且不计入分母」口径不同。
     */
    smape: function (actual, predicted) {
      var n = Math.min(actual.length, predicted.length);
      if (n === 0) return NaN;
      var s = 0;
      for (var i = 0; i < n; i++) {
        var a = actual[i];
        var p = predicted[i];
        var denom = Math.abs(a) + Math.abs(p);
        if (denom < EPS) continue;
        s += (2 * Math.abs(a - p)) / denom;
      }
      return (s / n) * 100;
    }
  };

  /** 指标中文名，UI 展示用 */
  var metricLabels = {
    mse: 'MSE',
    rmse: 'RMSE',
    mae: 'MAE',
    mape: 'MAPE(%)',
    smape: 'sMAPE(%)'
  };

  /* ================================================================== *
   * 2. 统计基线
   * ================================================================== */

  /**
   * 各基线签名统一为 fn(history, horizon, ctx) => number[horizon]。
   * ctx = { freq, season, datasetId, index }
   */
  var baselines = {
    /** 朴素法：把最后一个观测值重复 horizon 次 */
    naive: function (history, horizon) {
      var last = history[history.length - 1];
      var out = new Array(horizon);
      for (var i = 0; i < horizon; i++) out[i] = last;
      return out;
    },

    /** 季节朴素法：重复上一个完整季节 */
    seasonal_naive: function (history, horizon, ctx) {
      var n = history.length;
      var m = (ctx && ctx.season > 1) ? ctx.season : 12;
      var out = new Array(horizon);
      if (m >= n) {
        // 历史长度不足一个季节，退化为朴素法
        return baselines.naive(history, horizon);
      }
      for (var h = 0; h < horizon; h++) {
        var idx = n - m + (h % m);
        out[h] = history[clamp(idx, 0, n - 1)];
      }
      return out;
    },

    /** 历史均值 */
    mean: function (history, horizon) {
      var avg = meanOf(history);
      var out = new Array(horizon);
      for (var i = 0; i < horizon; i++) out[i] = avg;
      return out;
    },

    /** 全局最小二乘直线外推 */
    linear_trend: function (history, horizon) {
      var n = history.length;
      var out = new Array(horizon);
      if (n < 2) return baselines.naive(history, horizon);
      var sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < n; i++) {
        sx += i;
        sy += history[i];
        sxx += i * i;
        sxy += i * history[i];
      }
      var denom = n * sxx - sx * sx;
      var slope = Math.abs(denom) < EPS ? 0 : (n * sxy - sx * sy) / denom;
      var intercept = (sy - slope * sx) / n;
      for (var h = 1; h <= horizon; h++) out[h - 1] = intercept + slope * (n - 1 + h);
      return out;
    },

    /** 移动平均（窗口 = 季节长度，退化为 6） */
    moving_average: function (history, horizon, ctx) {
      var n = history.length;
      var want = (ctx && ctx.season > 1) ? ctx.season : 6;
      var k = Math.max(2, Math.min(want, n));
      var sum = 0;
      for (var i = n - k; i < n; i++) sum += history[i];
      var avg = sum / k;
      var out = new Array(horizon);
      for (var h = 0; h < horizon; h++) out[h] = avg;
      return out;
    }
  };

  /** 基线中文名，UI 展示用 */
  var baselineLabels = {
    naive: '朴素法 naive',
    seasonal_naive: '季节朴素 seasonal_naive',
    mean: '历史均值 mean',
    linear_trend: '线性趋势 linear_trend',
    moving_average: '移动平均 moving_average'
  };

  /* ================================================================== *
   * 3. 评分公式
   * ================================================================== */

  /**
   * 由误差比映射得分。ratio = 你的误差 / 最优基线误差（越小越好）。
   *
   * 分段线性，严格单调不增：
   *   ① ratio <= 0.50             → 100 分（比最优基线好一倍，直接满分）
   *   ② 0.50 < ratio <= threshold → 从 100 线性降到 passScore（ratio = threshold 时恰好 = passScore）
   *   ③ threshold < ratio < 2.00  → 从 passScore 线性降到 0
   *   ④ ratio >= 2.00             → 0 分
   *
   * 分支优先级（重要）：① → ④ → ② → ③。
   * 「ratio >= 2 → 0 分」必须在「ratio <= threshold」之前判定，否则 threshold > 2 时
   * 会先命中 ② 而拿到 60 分以上，违反 ④。为此 threshold 被夹在 [0.51, 2]：
   *  - 下界 0.51 保证 ② 区间非退化；
   *  - 上界 2 与 ④ 自洽（threshold >= 2 时 ratio = threshold 由 ④ 判 0 分，④ 优先）。
   *
   * @param {number} ratio 误差比
   * @param {number} threshold 通过阈值（必须打败最优基线的倍数，越小越严）
   * @param {number} passScore 通过分数线
   * @returns {number} 0..100 的整数分
   */
  function scoreForRatio(ratio, threshold, passScore) {
    if (!isFinite(ratio)) return 0;
    var r = ratio < 0 ? 0 : ratio;
    var pass = clamp(Number(passScore) || 60, 1, 100);
    var FULL = 0.5;
    var ZERO = 2.0;
    var thr = clamp(Number(threshold) || 1, 0.51, ZERO);

    if (r <= FULL) return 100;
    if (r >= ZERO) return 0;            // ④ 必须先判，否则 thr > 2 时会被 ② 抢先

    if (r <= thr) {
      var t1 = (r - FULL) / (thr - FULL);
      return clamp(Math.round(100 - t1 * (100 - pass)), pass, 100);
    }

    var t2 = (r - thr) / (ZERO - thr);
    return clamp(Math.round(pass * (1 - t2)), 0, pass);
  }

  /* ================================================================== *
   * 4. 测试点构造（holdout / rolling）
   * ================================================================== */

  /**
   * 构造测试点。
   *  - holdout：训练集 = 前 len-horizon 点，测试集 = 最后 horizon 点（1 个测试点）
   *  - rolling：从 len-horizon-(windows-1)*originStep 开始，滑动 windows 个 origin，
   *             每个 origin 只用该点之前的数据训练，预测之后 horizon 步。
   *
   * @param {number[]} values 完整序列
   * @param {Object} opts { mode, horizon, originStep, windows, season, freq, datasetId }
   * @returns {Array<{history:number[], actual:number[], ctx:Object, index:number}>}
   */
  function buildTestPoints(values, opts) {
    var horizon = opts.horizon;
    var points = [];

    /**
     * 生成单个测试点。
     * @param {number} trainEnd 训练集截止下标（不含）
     * @param {number} index 测试点序号
     */
    function makePoint(trainEnd, index) {
      var ctx = {
        freq: opts.freq || 'M',
        season: opts.season || 1,
        datasetId: opts.datasetId || '',
        index: index
      };
      return {
        history: values.slice(0, trainEnd),
        actual: values.slice(trainEnd, trainEnd + horizon),
        ctx: ctx,
        index: index
      };
    }

    if (opts.mode === 'rolling') {
      var windows = Math.max(1, opts.windows || 1);
      var step = Math.max(1, opts.originStep || horizon);
      var start = values.length - horizon - (windows - 1) * step;
      for (var w = 0; w < windows; w++) {
        var trainEnd = start + w * step;
        if (trainEnd < 4) continue;              // 训练集过短则跳过
        points.push(makePoint(trainEnd, w));
      }
      if (points.length === 0) points.push(makePoint(values.length - horizon, 0));
      return points;
    }

    points.push(makePoint(values.length - horizon, 0));
    return points;
  }

  /* ================================================================== *
   * 5. 单测试点评分
   * ================================================================== */

  /**
   * 对单个测试点评分。
   * @param {Object} point 测试点
   * @param {Object} run 执行结果 { status:'ok'|'error'|'timeout', value, error, line }
   * @param {Object} opts 判题参数
   * @returns {Object} 测试点结果
   */
  function scoreCase(point, run, opts) {
    var metricFn = metrics[opts.metric] || metrics.mse;

    if (!run || run.status !== 'ok') {
      var isTimeout = run && run.status === 'timeout';
      return {
        index: point.index,
        verdict: isTimeout ? 'TLE' : 'RE',
        score: 0,
        yourMetric: NaN,
        bestBaseline: NaN,
        baselineName: '',
        allBaselines: {},
        error: (run && run.error) || '执行失败',
        line: (run && run.line) || null,
        actual: point.actual,
        predictions: null
      };
    }

    var pred = run.value;
    var yourMetric = metricFn(point.actual, pred);

    // 各基线
    var all = {};
    var bestName = '';
    var bestVal = Infinity;
    for (var i = 0; i < opts.baselines.length; i++) {
      var name = opts.baselines[i];
      var fn = baselines[name];
      if (typeof fn !== 'function') continue;
      var bv = metricFn(point.actual, fn(point.history, opts.horizon, point.ctx));
      all[name] = bv;
      if (isFinite(bv) && bv < bestVal) {
        bestVal = bv;
        bestName = name;
      }
    }

    if (!isFinite(yourMetric)) {
      return {
        index: point.index,
        verdict: 'RE',
        score: 0,
        yourMetric: NaN,
        bestBaseline: bestVal,
        baselineName: bestName,
        allBaselines: all,
        error: '你的预测无法计算指标（可能含非法值）',
        line: null,
        actual: point.actual,
        predictions: pred
      };
    }

    // 误差比：最优基线为 0（完美）时做特殊处理
    var ratio;
    if (!isFinite(bestVal)) {
      ratio = 1;
    } else if (bestVal < EPS) {
      ratio = yourMetric < EPS ? 0 : Infinity;
    } else {
      ratio = yourMetric / bestVal;
    }

    var score = scoreForRatio(ratio, opts.threshold, opts.passScore);

    return {
      index: point.index,
      verdict: score >= opts.passScore ? 'AC' : 'WA',
      score: score,
      yourMetric: yourMetric,
      bestBaseline: bestVal,
      baselineName: bestName,
      allBaselines: all,
      ratio: ratio,
      error: null,
      line: null,
      actual: point.actual,
      predictions: pred
    };
  }

  /* ================================================================== *
   * 6. 用户代码执行：同线程（可信代码 / 无 Worker 降级）
   * ================================================================== */

  /**
   * 从错误堆栈里取出「引擎报告的原始行号」。
   * @param {Error} err 错误对象
   * @returns {number|null}
   */
  function rawLineOf(err) {
    var stack = String((err && err.stack) || '');
    var m = /<anonymous>:(\d+):(\d+)/.exec(stack);
    if (m) return parseInt(m[1], 10);
    m = /:(\d+):(\d+)/.exec(stack);
    if (m) {
      var line = parseInt(m[1], 10);
      if (line > 0) return line;
    }
    return null;
  }

  /**
   * 探测「函数体第 1 行」在堆栈里被报告成第几行。
   * 不同引擎对 new Function 生成代码的包裹方式不同（V8 是 3 行头部，SpiderMonkey 是 1 行），
   * 因此用一段已知在第 1 行抛错的探针代码实测，得到偏移量。
   * @returns {number} 偏移量（用户行号 = 原始行号 - 偏移）
   */
  var LINE_OFFSET = (function detectOffset() {
    try {
      /* eslint-disable no-new-func */
      var probe = new Function('', 'throw new Error("probe");');
      probe();
    } catch (e) {
      var reported = rawLineOf(e);
      if (reported && reported > 1) return reported - 1;
    }
    return 0;
  })();

  /**
   * 把引擎行号映射回用户代码行号。
   * @param {Error} err 错误对象
   * @returns {number|null} 用户代码行号（1 基）
   */
  function parseLine(err) {
    var raw = rawLineOf(err);
    if (raw === null) return null;
    var line = raw - LINE_OFFSET;
    return line > 0 ? line : null;
  }

  /**
   * 校验 predict 的返回值。
   * @param {*} out 用户返回值
   * @param {number} horizon 期望长度
   * @returns {{value?: number[], error?: string}}
   */
  function validateOutput(out, horizon) {
    if (out === null || out === undefined) {
      return { error: 'predict 返回了 ' + String(out) + '，应返回长度为 ' + horizon + ' 的数组' };
    }
    var len = out.length;
    if (typeof len !== 'number' || len !== horizon) {
      return { error: '返回数组长度必须为 ' + horizon + '，实际为 ' + String(len) };
    }
    var arr = new Array(horizon);
    for (var i = 0; i < horizon; i++) {
      var v = out[i];
      if (typeof v !== 'number' || !isFinite(v)) {
        return { error: '第 ' + (i + 1) + ' 个预测值不是有限数值（NaN / Infinity / 非数字）' };
      }
      arr[i] = v;
    }
    return { value: arr };
  }

  /**
   * 把用户代码编译成可调用函数。
   * @param {string} code 用户代码
   * @returns {{fn?: Function, error?: string, line?: number|null}}
   */
  function compile(code) {
    try {
      /* eslint-disable no-new-func */
      var fn = new Function(
        'history',
        'horizon',
        'ctx',
        String(code) + '\n;return predict(history, horizon, ctx);'
      );
      return { fn: fn };
    } catch (err) {
      // 语法错误时堆栈指向 worker 自身，无法映射到用户行号，故 line 置空
      return {
        error: '语法错误：' + ((err && err.message) || String(err)),
        line: null
      };
    }
  }

  /**
   * 同线程执行全部测试点（不使用 Worker）。
   * 仅用于：① 可信代码（参考解 / 排行榜）；② 环境禁用 Worker 时的降级。
   * @param {string} code 用户代码
   * @param {Array} jobs [{history, horizon, ctx}]
   * @returns {{results: Array, timedOut: boolean, degraded?: boolean}}
   */
  function runInProcess(code, jobs) {
    var compiled = compile(code);
    var results = [];

    if (compiled.error) {
      for (var k = 0; k < jobs.length; k++) {
        results.push({ status: 'error', error: compiled.error, line: compiled.line });
      }
      return { results: results, timedOut: false };
    }

    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      try {
        var out = compiled.fn(job.history.slice(), job.horizon, job.ctx);
        var checked = validateOutput(out, job.horizon);
        if (checked.error) {
          results.push({ status: 'error', error: checked.error, line: null });
        } else {
          results.push({ status: 'ok', value: checked.value });
        }
      } catch (err) {
        results.push({
          status: 'error',
          error: (err && err.message) || String(err),
          line: parseLine(err)
        });
      }
    }
    return { results: results, timedOut: false };
  }

  /* ================================================================== *
   * 7. Web Worker 沙箱
   * ================================================================== */

  /**
   * Worker 源码。必须用 Blob URL 创建，因为 file:// 下无法加载独立 worker 文件。
   *
   * 沙箱策略：
   *   1. 先缓存内部要用的 postMessage / Function，避免被自己封掉；
   *   2. 把 fetch / XMLHttpRequest / importScripts / WebSocket / Worker / postMessage /
   *      self / globalThis / window / document / localStorage ... 全部替换成「读取即抛错」的 getter；
   *   3. 用户代码通过 new Function 执行，函数体首行即用户代码第 1 行，便于行号映射；
   *   4. 返回值的长度与有限性在 worker 内校验，错误信息回传主线程。
   */
  var WORKER_SOURCE = [
    '(function () {',
    '  "use strict";',
    '  var __global = self;',
    '  var __post = __global.postMessage.bind(__global);',
    '  var __Function = Function;',
    '  var __Error = Error;',
    '  var __isFinite = isFinite;',
    '  var __String = String;',
    '  function __rawLineOf(err) {',
    '    var stack = __String((err && err.stack) || "");',
    '    var m = /<anonymous>:(\\d+):(\\d+)/.exec(stack);',
    '    if (m) return parseInt(m[1], 10);',
    '    m = /:(\\d+):(\\d+)/.exec(stack);',
    '    return m ? parseInt(m[1], 10) : null;',
    '  }',
    '  // 探测「函数体第 1 行」在堆栈中的偏移（不同引擎不同）',
    '  var __lineOffset = (function () {',
    '    try {',
    '      var p = new __Function("", "throw new Error(\\"probe\\");");',
    '      p();',
    '    } catch (e) {',
    '      var r = __rawLineOf(e);',
    '      if (r && r > 1) return r - 1;',
    '    }',
    '    return 0;',
    '  })();',
    '  var __DENY = [',
    '    "fetch", "XMLHttpRequest", "importScripts", "WebSocket", "EventSource",',
    '    "Worker", "SharedWorker", "postMessage", "close", "self", "globalThis",',
    '    "window", "document", "localStorage", "sessionStorage", "indexedDB",',
    '    "navigator", "location", "history", "alert", "open", "parent", "top", "frames"',
    '  ];',
    '  function __block(name) {',
    '    try {',
    '      Object.defineProperty(__global, name, {',
    '        configurable: true,',
    '        get: function () { throw new __Error("沙箱限制：禁止访问 " + name); },',
    '        set: function () {}',
    '      });',
    '    } catch (e) {',
    '      try { __global[name] = undefined; } catch (e2) {}',
    '    }',
    '  }',
    '  for (var __i = 0; __i < __DENY.length; __i++) __block(__DENY[__i]);',
    '  function __lineOf(err) {',
    '    var raw = __rawLineOf(err);',
    '    if (raw === null) return null;',
    '    var l = raw - __lineOffset;',
    '    return l > 0 ? l : null;',
    '  }',
    '  function __validate(out, horizon) {',
    '    if (out === null || out === undefined) {',
    '      return { error: "predict 返回了 " + __String(out) + "，应返回长度为 " + horizon + " 的数组" };',
    '    }',
    '    var len = out.length;',
    '    if (typeof len !== "number" || len !== horizon) {',
    '      return { error: "返回数组长度必须为 " + horizon + "，实际为 " + __String(len) };',
    '    }',
    '    var arr = new Array(horizon);',
    '    for (var i = 0; i < horizon; i++) {',
    '      var v = out[i];',
    '      if (typeof v !== "number" || !__isFinite(v)) {',
    '        return { error: "第 " + (i + 1) + " 个预测值不是有限数值（NaN / Infinity / 非数字）" };',
    '      }',
    '      arr[i] = v;',
    '    }',
    '    return { value: arr };',
    '  }',
    '  __global.onmessage = function (ev) {',
    '    var job = ev.data || {};',
    '    var t0 = Date.now();',
    '    var fn;',
    '    try {',
    '      fn = new __Function("history", "horizon", "ctx",',
    '        __String(job.code) + "\\n;return predict(history, horizon, ctx);");',
    '    } catch (syntaxErr) {',
    '      __post({',
    '        id: job.id,',
    '        status: "error",',
    '        error: "语法错误：" + ((syntaxErr && syntaxErr.message) ? syntaxErr.message : __String(syntaxErr)),',
    '        line: null',
    '      });',
    '      return;',
    '    }',
    '    try {',
    '      var out = fn(job.history, job.horizon, job.ctx);',
    '      var checked = __validate(out, job.horizon);',
    '      if (checked.error) {',
    '        __post({ id: job.id, status: "error", error: checked.error, line: null });',
    '      } else {',
    '        __post({ id: job.id, status: "ok", value: checked.value, ms: Date.now() - t0 });',
    '      }',
    '    } catch (err) {',
    '      __post({',
    '        id: job.id,',
    '        status: "error",',
    '        error: (err && err.message) ? err.message : __String(err),',
    '        line: __lineOf(err)',
    '      });',
    '    }',
    '  };',
    '})();'
  ].join('\n');

  /**
   * 在 Worker 沙箱中顺序执行全部测试点。
   * 单次执行超时 perJob → 终止 worker 并判 TLE；整题超时 total → 同样判 TLE。
   *
   * @param {string} code 用户代码
   * @param {Array} jobs [{history, horizon, ctx}]
   * @param {Object} [limits] { perJob, total }
   * @returns {Promise<{results: Array, timedOut: boolean, degraded?: boolean}>}
   */
  function runSandbox(code, jobs, limits) {
    var lim = limits || LIMITS;

    return new Promise(function (resolve) {
      var results = [];
      var index = 0;
      var worker = null;
      var url = null;
      var jobTimer = null;
      var totalTimer = null;
      var finished = false;

      /** 释放资源 */
      function cleanup() {
        if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
        if (totalTimer) { clearTimeout(totalTimer); totalTimer = null; }
        if (worker) {
          try { worker.terminate(); } catch (e) { /* ignore */ }
          worker = null;
        }
        if (url) {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
          url = null;
        }
      }

      /**
       * 结束判题，把未执行的用例标记为超时。
       * @param {boolean} timedOut 是否因超时结束
       */
      function finish(timedOut) {
        if (finished) return;
        finished = true;
        for (var i = results.length; i < jobs.length; i++) {
          results.push({
            status: 'timeout',
            error: timedOut
              ? '执行超时（单次 ' + lim.perJob + 'ms / 整题 ' + lim.total + 'ms）'
              : '未执行',
            line: null
          });
        }
        cleanup();
        resolve({ results: results, timedOut: !!timedOut });
      }

      /** 派发下一个测试点 */
      function next() {
        if (index >= jobs.length) { finish(false); return; }
        var job = jobs[index];
        try {
          worker.postMessage({
            id: index,
            code: code,
            history: job.history,
            horizon: job.horizon,
            ctx: job.ctx
          });
        } catch (e) {
          results.push({ status: 'error', error: '无法向沙箱投递任务：' + ((e && e.message) || e), line: null });
          index++;
          next();
          return;
        }
        jobTimer = setTimeout(function () { finish(true); }, lim.perJob);
      }

      // 环境不支持 Worker（例如某些 file:// 限制）时降级为同线程执行
      var canWorker = (typeof Worker !== 'undefined') &&
        (typeof Blob !== 'undefined') &&
        (typeof URL !== 'undefined') &&
        typeof URL.createObjectURL === 'function';

      if (!canWorker) {
        var fallback = runInProcess(code, jobs);
        fallback.degraded = true;
        resolve(fallback);
        return;
      }

      try {
        url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (e) {
        cleanup();
        var fb = runInProcess(code, jobs);
        fb.degraded = true;
        resolve(fb);
        return;
      }

      worker.onmessage = function (ev) {
        var msg = ev.data || {};
        if (finished || msg.id !== index) return;
        if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
        if (msg.status === 'ok') {
          results.push({ status: 'ok', value: msg.value, ms: msg.ms });
        } else {
          results.push({ status: 'error', error: msg.error, line: msg.line });
        }
        index++;
        next();
      };

      worker.onerror = function (ev) {
        if (finished) return;
        var text = (ev && ev.message) ? ev.message : '沙箱内部错误';
        results.push({ status: 'error', error: text, line: null });
        index++;
        if (index >= jobs.length) { finish(false); }
        else { next(); }
      };

      totalTimer = setTimeout(function () { finish(true); }, lim.total);
      next();
    });
  }

  /* ================================================================== *
   * 8. 判题主流程
   * ================================================================== */

  /**
   * 汇总执行结果，产出最终判题报告。
   * @param {Object} params { problem, dataset, code }
   * @param {Object} run { results, timedOut, degraded }
   * @returns {Object} 判题报告
   */
  function buildReport(params, run) {
    var problem = params.problem;
    var dataset = params.dataset;

    var opts = {
      mode: problem.mode || 'holdout',
      horizon: problem.horizon,
      originStep: problem.originStep,
      windows: problem.windows,
      metric: problem.metric || 'mse',
      baselines: (problem.baselines && problem.baselines.length) ? problem.baselines : ['naive'],
      threshold: problem.threshold,
      passScore: problem.passScore || 60,
      season: problem.season || dataset.season,
      freq: dataset.freq,
      datasetId: dataset.id
    };

    var points = buildTestPoints(dataset.values, opts);
    var cases = [];
    var sum = 0;
    var hasRe = false;
    var hasTle = false;

    for (var i = 0; i < points.length; i++) {
      var c = scoreCase(points[i], run.results[i], opts);
      if (c.verdict === 'RE') hasRe = true;
      if (c.verdict === 'TLE') hasTle = true;
      sum += c.score;
      cases.push(c);
    }

    var score = Math.round(sum / Math.max(1, cases.length));
    var allAC = cases.every(function (c) { return c.verdict === 'AC'; });
    var verdict;
    var message = '';

    if (hasTle || run.timedOut) {
      verdict = 'TLE';
      score = 0;
      message = '执行超时，请检查是否有死循环或过大的计算量。';
    } else if (hasRe) {
      verdict = 'RE';
      var firstErr = null;
      for (var j = 0; j < cases.length; j++) {
        if (cases[j].verdict === 'RE') { firstErr = cases[j]; break; }
      }
      message = firstErr ? firstErr.error : '运行时错误';
    } else if (allAC && score >= opts.passScore) {
      verdict = 'AC';
      message = '全部测试点达标，通过！';
    } else {
      verdict = 'WA';
      message = '存在未达标的测试点，误差仍然偏大。';
    }

    return {
      problemId: problem.id,
      verdict: verdict,
      passed: verdict === 'AC',
      score: score,
      passScore: opts.passScore,
      metric: opts.metric,
      metricLabel: metricLabels[opts.metric] || String(opts.metric).toUpperCase(),
      cases: cases,
      message: message,
      degraded: !!run.degraded,
      at: Date.now()
    };
  }

  /**
   * 把 problem + dataset + code 转成沙箱任务列表。
   * @param {Object} problem 题目
   * @param {Object} dataset 数据集
   * @param {string} code 用户代码
   * @returns {Array}
   */
  function buildJobs(problem, dataset, code) {
    var opts = {
      mode: problem.mode || 'holdout',
      horizon: problem.horizon,
      originStep: problem.originStep,
      windows: problem.windows,
      season: problem.season || dataset.season,
      freq: dataset.freq,
      datasetId: dataset.id
    };
    var points = buildTestPoints(dataset.values, opts);
    return points.map(function (p) {
      return { code: code, history: p.history, horizon: opts.horizon, ctx: p.ctx };
    });
  }

  /**
   * 异步判题（浏览器：Worker 沙箱）。
   * @param {Object} params { problem, dataset, code, limits? }
   * @returns {Promise<Object>} 判题报告
   */
  function evaluate(params) {
    var jobs;
    try {
      jobs = buildJobs(params.problem, params.dataset, params.code);
    } catch (e) {
      return Promise.reject(e);
    }
    return runSandbox(params.code, jobs, params.limits).then(function (run) {
      return buildReport(params, run);
    });
  }

  /**
   * 同步判题（同线程执行）。仅用于可信代码：参考解、排行榜虚拟选手。
   * @param {Object} params { problem, dataset, code }
   * @returns {Object} 判题报告
   */
  function evaluateSync(params) {
    var jobs = buildJobs(params.problem, params.dataset, params.code);
    var run = runInProcess(params.code, jobs);
    run.degraded = true;
    return buildReport(params, run);
  }

  /* ================================================================== *
   * 9. 导出
   * ================================================================== */

  var judge = {
    metrics: metrics,
    metricLabels: metricLabels,
    baselines: baselines,
    baselineLabels: baselineLabels,
    scoreForRatio: scoreForRatio,
    buildTestPoints: buildTestPoints,
    buildJobs: buildJobs,
    runSandbox: runSandbox,
    runInProcess: runInProcess,
    evaluate: evaluate,
    evaluateSync: evaluateSync,
    parseLine: parseLine,
    LIMITS: LIMITS,
    WORKER_SOURCE: WORKER_SOURCE
  };

  TSJ.judge = judge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = judge;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
