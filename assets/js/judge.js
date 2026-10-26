/**
 * judge.js —— 判题引擎
 *
 * 结构：
 *   metrics   评估指标（mse / rmse / mae / mape / smape / pinball）
 *   baselines 统计基线（naive / seasonal_naive / mean / linear_trend / moving_average）
 *   scoring   由「误差比」映射到 0~100 分（分段线性、单调、平滑）
 *   sandbox   Web Worker（Blob URL）沙箱执行用户代码，单次 1500ms / 整题 8000ms
 *   evaluate  异步判题（浏览器走 Worker；**无 Worker 环境一律拒绝执行**，不降级到主线程）
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
    },

    /**
     * Pinball 损失（τ=0.95 分位数备货，P16 专用）。
     * predicted 数组在这里的语义是「每一步的 95 分位备货水平」而非点预测：
     * 实际 ≥ 预测（缺货）罚 τ=0.95 倍缺口；实际 < 预测（过量）只罚 0.05 倍冗余。
     * τ 固化在指标里（指标签名 fn(actual, predicted) 无第三参），题面同步声明 95 分位。
     */
    pinball: function (actual, predicted) {
      var TAU = 0.95;
      var n = Math.min(actual.length, predicted.length);
      if (n === 0) return NaN;
      var s = 0;
      for (var i = 0; i < n; i++) {
        var d = actual[i] - predicted[i];
        s += d >= 0 ? TAU * d : (TAU - 1) * d;
      }
      return s / n;
    }
  };

  /** 指标中文名，UI 展示用 */
  var metricLabels = {
    mse: 'MSE',
    rmse: 'RMSE',
    mae: 'MAE',
    mape: 'MAPE(%)',
    smape: 'sMAPE(%)',
    pinball: 'Pinball(τ=0.95)'
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
   * 沙箱策略（三层，缺一不可）：
   *   1. **能力遮蔽**：fetch / XMLHttpRequest / importScripts / WebSocket / Worker /
   *      postMessage / self / globalThis / window / document / localStorage / location ...
   *      在「全局对象 + 整条原型链」上被改写成「读取即抛错」的访问器，
   *      且 configurable:false / writable:false —— `delete` 与重新赋值都不再能恢复；
   *   2. **代码执行面收窄**：全局 Function / eval 换成抛错桩，Function.prototype.constructor
   *      同样封死（否则 `(function(){}).constructor` 就能拿回真正的 Function）；
   *      setTimeout / setInterval 只接受函数参数，字符串形式直接拒绝；
   *   3. **冻结**：globalThis 与整条原型链 Object.freeze，杜绝事后往原型上挂钩子。
   *
   * 另外 index.html 的 CSP（connect-src 'none' / script-src 不含 http）在网络层再兜一层：
   * 即便 JS 层出现未知逃逸，请求也发不出去。
   *
   * 用户代码通过 new Function 执行，函数体首行即用户代码第 1 行，便于行号映射；
   * 返回值的长度与有限性在 worker 内校验，错误信息回传主线程。
   *
   * 注意：这里只做「隔离执行环境」，**不是**安全边界（同一台机器上的恶意代码仍可能通过
   * 侧信道推断信息）。README 里有明确口径。
   */
  var WORKER_SOURCE = [
    '(function () {',
    '  "use strict";',
    '  var __global = self;',
    '  var __post = __global.postMessage.bind(__global);',
    '  var __Function = Function;',
    '  var __Error = Error;',
    '  var __String = String;',
    '  var __isFinite = isFinite;',
    '  var __now = Date.now;',
    '  var __define = Object.defineProperty;',
    '  var __getProto = Object.getPrototypeOf;',
    '  var __freeze = Object.freeze;',
    '  var __hasOwn = Object.prototype.hasOwnProperty;',
    '  var __realTimeout = (typeof setTimeout === "function") ? setTimeout : null;',
    '  var __realInterval = (typeof setInterval === "function") ? setInterval : null;',
    '  function __rawLineOf(err) {',
    '    var stack = __String((err && err.stack) || "");',
    '    var m = /<anonymous>:(\\d+):(\\d+)/.exec(stack);',
    '    if (m) return parseInt(m[1], 10);',
    '    m = /:(\\d+):(\\d+)/.exec(stack);',
    '    return m ? parseInt(m[1], 10) : null;',
    '  }',
    '  // 探测「函数体第 1 行」在堆栈中的偏移（不同引擎不同）——必须在封 Function 之前完成',
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
    '  /* ---------- 第 1 层：能力遮蔽（全局 + 原型链） ---------- */',
    '  var __DENY = [',
    '    "fetch", "XMLHttpRequest", "importScripts", "WebSocket", "EventSource",',
    '    "Worker", "SharedWorker", "postMessage", "close", "self", "globalThis",',
    '    "window", "document", "localStorage", "sessionStorage", "indexedDB",',
    '    "navigator", "location", "history", "alert", "open", "parent", "top", "frames",',
    '    "caches", "BroadcastChannel", "WebTransport", "RTCPeerConnection"',
    '  ];',
    '  function __denyGetter(name) {',
    '    return function () { throw new __Error("沙箱限制：禁止访问 " + name); };',
    '  }',
    '  var __targets = [__global];',
    '  (function () {',
    '    var proto = __getProto(__global);',
    '    var guard = 0;',
    '    while (proto && guard < 12) {',
    '      __targets.push(proto);',
    '      proto = __getProto(proto);',
    '      guard++;',
    '    }',
    '  })();',
    '  function __sealName(target, name, force) {',
    '    var own = false;',
    '    try { own = __hasOwn.call(target, name); } catch (e) { own = false; }',
    '    if (!own && !force) return;',
    '    try {',
    '      __define(target, name, {',
    '        configurable: false,',
    '        enumerable: false,',
    '        get: __denyGetter(name),',
    '        set: __denyGetter(name)',
    '      });',
    '    } catch (e) {',
    '      try { target[name] = undefined; } catch (e2) {}',
    '    }',
    '  }',
    '  for (var __t = 0; __t < __targets.length; __t++) {',
    '    for (var __d = 0; __d < __DENY.length; __d++) {',
    '      __sealName(__targets[__t], __DENY[__d], __t === 0);',
    '    }',
    '  }',
    '  /* ---------- 第 2 层：代码执行面（Function / eval / 字符串定时器） ---------- */',
    '  function __lockValue(target, name, value) {',
    '    try {',
    '      __define(target, name, {',
    '        configurable: false,',
    '        writable: false,',
    '        enumerable: false,',
    '        value: value',
    '      });',
    '    } catch (e) {',
    '      try { target[name] = value; } catch (e2) {}',
    '    }',
    '  }',
    '  function __blockedCtor() { throw new __Error("沙箱限制：禁止使用 Function 构造器"); }',
    '  function __blockedEval() { throw new __Error("沙箱限制：禁止使用 eval"); }',
    '  __lockValue(__global, "Function", __blockedCtor);',
    '  __lockValue(__global, "eval", __blockedEval);',
    '  try {',
    '    __define(__Function.prototype, "constructor", {',
    '      configurable: false,',
    '      writable: false,',
    '      enumerable: false,',
    '      value: __blockedCtor',
    '    });',
    '  } catch (e) {}',
    '  function __timerGuard(name, real) {',
    '    return function (fn, ms) {',
    '      if (typeof fn === "string") {',
    '        throw new __Error("沙箱限制：禁止以字符串形式调用 " + name);',
    '      }',
    '      if (!real) throw new __Error("沙箱限制：当前环境不支持 " + name);',
    '      var args = [fn, ms];',
    '      for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);',
    '      return real.apply(__global, args);',
    '    };',
    '  }',
    '  __lockValue(__global, "setTimeout", __timerGuard("setTimeout", __realTimeout));',
    '  __lockValue(__global, "setInterval", __timerGuard("setInterval", __realInterval));',
    '  /* ---------- 执行与回传 ---------- */',
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
    '    var t0 = __now();',
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
    '        __post({ id: job.id, status: "ok", value: checked.value, ms: __now() - t0 });',
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
    '  /* ---------- 第 3 层：冻结全局与整条原型链（必须放在 onmessage 之后） ---------- */',
    '  for (var __f = 0; __f < __targets.length; __f++) {',
    '    try { __freeze(__targets[__f]); } catch (e) {}',
    '  }',
    '})();'
  ].join('\n');

  /**
   * 当前环境能否使用 Web Worker 沙箱。
   * UI 用它决定是否允许提交（不能沙箱 = 禁止提交，避免死循环锁死界面）。
   * @returns {boolean}
   */
  function canUseSandbox() {
    try {
      return (typeof Worker !== 'undefined') &&
        (typeof Blob !== 'undefined') &&
        (typeof URL !== 'undefined') &&
        typeof URL.createObjectURL === 'function';
    } catch (e) {
      return false;
    }
  }

  /** 无沙箱时的拒绝理由（UI 直接展示给用户） */
  var SANDBOX_REFUSED_REASON =
    '当前环境无法创建 Web Worker 沙箱（可能被浏览器安全策略、隐私设置或内核版本限制）。' +
    '为避免死循环卡死页面，已拒绝在页面主线程执行你的代码：请改用最新版 Chrome / Edge 打开，' +
    '或通过 http(s) 方式访问本页面。';

  /**
   * 在 Worker 沙箱中顺序执行全部测试点。
   * 单次执行超时 perJob → 终止 worker 并判 TLE；整题超时 total → 同样判 TLE。
   *
   * 环境不支持 Worker 时**拒绝执行**（返回 refused），不再静默降级到主线程 ——
   * 降级会让 `while(true){}` 直接锁死 UI，且没有任何超时保护。
   *
   * @param {string} code 用户代码
   * @param {Array} jobs [{history, horizon, ctx}]
   * @param {Object} [limits] { perJob, total }
   * @param {Object} [session] 可选会话句柄；会被挂上 abort()，供调用方（路由切换）取消
   * @returns {Promise<{results: Array, timedOut: boolean, refused?: boolean, aborted?: boolean, reason?: string}>}
   */
  function runSandbox(code, jobs, limits, session) {
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
        if (session && typeof session === 'object') {
          session.abort = null;
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

      /**
       * 放弃当前会话：立即 terminate 旧 Worker，不留后台计算。
       * 结果由调用方按 token 丢弃。
       */
      function abort() {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ results: results, timedOut: false, aborted: true });
      }

      if (session && typeof session === 'object') session.abort = abort;

      /** 派发下一个测试点 */
      function next() {
        if (index >= jobs.length) { finish(false); return; }
        var job = jobs[index];
        try {
          worker.postMessage({
            id: index,
            code: code,
            // 每个测试点传独立副本：用户代码即便就地修改 history，也污染不到下一个测试点
            history: job.history.slice(),
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

      // 环境不支持 Worker：拒绝执行（不再静默降级到主线程）
      if (!canUseSandbox()) {
        cleanup();
        resolve({ results: [], timedOut: false, refused: true, reason: SANDBOX_REFUSED_REASON });
        return;
      }

      try {
        url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (e) {
        cleanup();
        resolve({
          results: [],
          timedOut: false,
          refused: true,
          reason: SANDBOX_REFUSED_REASON + '（创建 Worker 失败：' + ((e && e.message) || e) + '）'
        });
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
        // 关键：先清掉在飞测试点的超时定时器，否则 next() 会用新定时器覆盖 jobTimer，
        // 旧定时器成为孤儿并在到期后把「还在正常跑的后续测试点」整题误判为 TLE。
        if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
        if (ev && typeof ev.preventDefault === 'function') {
          try { ev.preventDefault(); } catch (e) { /* 忽略：部分引擎不支持 */ }
        }
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
   * 滚动回测窗口覆盖度前置校验。
   *
   * 背景：`buildTestPoints` 在 `len < horizon + windows*originStep` 时会把装不下的窗口
   * **静默丢弃**（`trainEnd < 4` 分支），于是「4 个窗口的题」可能只剩 1 个测试点，
   * 而题面仍然写着 4 个窗口 —— 判题口径与题面不一致，属于数据/配置缺陷。
   *
   * `buildTestPoints` 的语义被 60+ 条用例锁死，一行都不能改；因此把校验放在它**之前**：
   * 判题入口先算一次「窗口是否装得下」，装不下就直接给出显式错误报告，绝不静默缩水。
   *
   * @param {Object} problem 题目
   * @param {Object} dataset 数据集
   * @returns {string|null} 错误说明；null 表示通过
   */
  function coverageError(problem, dataset) {
    if (!problem || (problem.mode || 'holdout') !== 'rolling') return null;
    var horizon = Number(problem.horizon) || 0;
    var windows = Math.max(1, Number(problem.windows) || 1);
    var step = Math.max(1, Number(problem.originStep) || horizon || 1);
    var len = (dataset && dataset.values) ? dataset.values.length : 0;
    var required = horizon + windows * step;
    if (len < required) {
      return '滚动回测窗口不足：' + windows + ' 个窗口（步长 ' + step + '、预测 ' + horizon +
        ' 步）至少需要 ' + required + ' 个数据点，当前数据集「' + ((dataset && dataset.id) || '?') +
        '」只有 ' + len + ' 个。已停止判题，避免把缩水后的测试点当作成绩。';
    }
    return null;
  }

  /**
   * 构造一个「不进入评分流程」的报告骨架（数据不足 / 沙箱不可用 / 会话取消）。
   * 结构与 buildReport 的返回值保持一致，便于 UI 统一渲染。
   *
   * @param {Object} params { problem }
   * @param {string} message 说明
   * @param {Object} flags 额外标记（dataError / refused / aborted）
   * @returns {Object} 判题报告
   */
  function guardReport(params, message, flags) {
    var problem = params.problem || {};
    var metric = problem.metric || 'mse';
    var report = {
      problemId: problem.id,
      verdict: 'RE',
      passed: false,
      score: 0,
      passScore: Number(problem.passScore) || 60,
      metric: metric,
      metricLabel: metricLabels[metric] || String(metric).toUpperCase(),
      cases: [],
      message: message,
      degraded: false,
      at: Date.now()
    };
    if (flags) {
      for (var k in flags) {
        if (Object.prototype.hasOwnProperty.call(flags, k)) report[k] = flags[k];
      }
    }
    return report;
  }

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
   *
   * 三条前置/旁路分支（都不进入评分流程）：
   *   - 数据/配置缺陷（滚动窗口装不下）→ dataError 报告；
   *   - 环境无沙箱 → refused 报告（**拒绝执行**，不降级到主线程）；
   *   - 会话被调用方取消（路由切换）→ aborted 报告（结果由调用方丢弃）。
   *
   * @param {Object} params { problem, dataset, code, limits?, session? }
   * @returns {Promise<Object>} 判题报告
   */
  function evaluate(params) {
    var bad = coverageError(params.problem, params.dataset);
    if (bad) return Promise.resolve(guardReport(params, bad, { dataError: true }));

    var jobs;
    try {
      jobs = buildJobs(params.problem, params.dataset, params.code);
    } catch (e) {
      return Promise.reject(e);
    }
    return runSandbox(params.code, jobs, params.limits, params.session).then(function (run) {
      if (run && run.aborted) {
        return guardReport(params, '判题已取消（页面已切换）。', { aborted: true });
      }
      if (run && run.refused) {
        return guardReport(params, run.reason || SANDBOX_REFUSED_REASON, { refused: true });
      }
      return buildReport(params, run);
    });
  }

  /**
   * 同步判题（同线程执行）。仅用于可信代码：参考解、排行榜虚拟选手。
   * @param {Object} params { problem, dataset, code }
   * @returns {Object} 判题报告
   */
  function evaluateSync(params) {
    var bad = coverageError(params.problem, params.dataset);
    if (bad) return guardReport(params, bad, { dataError: true });
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
    canUseSandbox: canUseSandbox,
    coverageError: coverageError,
    parseLine: parseLine,
    LIMITS: LIMITS,
    SANDBOX_REFUSED_REASON: SANDBOX_REFUSED_REASON,
    WORKER_SOURCE: WORKER_SOURCE
  };

  TSJ.judge = judge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = judge;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
