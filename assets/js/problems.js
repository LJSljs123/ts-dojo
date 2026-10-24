/**
 * problems.js —— 题库定义
 *
 * 每题结构：
 *   { id, index, title, difficulty, tags, points, passScore, dataset, mode,
 *     horizon, originStep, windows, metric, baselines, threshold,
 *     statement, inputSpec, outputSpec, hints, solution, starter, passRate }
 *
 * 学习路径（由易到难）：
 *   P1 朴素预测 → P2 移动平均 → P3 季节朴素 → P4 SES → P5 Holt
 *   → P6 Holt-Winters → P7 直接多步 → P8 突变鲁棒 → P9 滚动回测挑战
 *
 * 参考解（solution）以真实函数书写，再用 toString() 转成字符串，
 * 这样参考解本身会被 node --check 与自测脚本覆盖，不会出现「字符串里的语法错误」。
 *
 * 挂载点：window.TSJ.problems
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /* ================================================================== *
   * 0. 参考解函数（全部自包含，不引用外部变量）
   * ================================================================== */

  /**
   * P1 朴素法：最后一个观测值重复 horizon 次。
   */
  function solNaive(history, horizon, ctx) {
    var last = history[history.length - 1];
    var out = [];
    for (var i = 0; i < horizon; i++) out.push(last);
    return out;
  }

  /**
   * P1 参考解：朴素法 + 漂移修正（random walk with drift）。
   *
   * 纯朴素法在趋势序列上会系统性低估，误差比恰好 = 1.0（打平基线只能拿 57 分）。
   * 补一个「每步漂移」就能过线：用「最近一个周期的均值」与「上一个周期的均值」之差
   * 估出每步平均抬升量，再按 h 线性外推。
   */
  function solNaiveDrift(history, horizon, ctx) {
    var n = history.length;
    var m = ctx.season > 1 ? ctx.season : 12;
    var last = history[n - 1];

    // 每步漂移 = (最近一个周期均值 - 上一个周期均值) / m
    var drift = 0;
    if (n >= 2 * m) {
      var cur = 0;
      var prev = 0;
      for (var i = 0; i < m; i++) {
        cur += history[n - m + i];
        prev += history[n - 2 * m + i];
      }
      drift = (cur - prev) / (m * m);
    }

    var out = [];
    for (var h = 1; h <= horizon; h++) out.push(last + drift * h);
    return out;
  }

  /**
   * P2 相位移动平均：
   * 移动平均的窗口必须与周期对齐 —— 对每个「相位」（同一小时 / 同一月份）分别做跨周期平均，
   * 这样既消掉噪声，又保留完整的季节形状；最后用「本周期均值 - 上周期均值」补回漂移。
   */
  function solMovingAverage(history, horizon, ctx) {
    var n = history.length;
    var m = ctx.season > 1 ? ctx.season : 12;
    var blocks = Math.min(Math.floor(n / m), 14);
    var j;

    if (blocks < 1) {
      // 历史不足一个周期：退化为朴素法（自包含）
      var fb = [];
      var lastVal = history[n - 1];
      for (j = 0; j < horizon; j++) fb.push(lastVal);
      return fb;
    }

    // 1) 按相位做移动平均（窗口 = 最近 blocks 个周期的同相位样本）
    var prof = [];
    for (j = 0; j < m; j++) prof.push(0);
    var base = n - blocks * m;
    for (var d = 0; d < blocks; d++) {
      for (j = 0; j < m; j++) prof[j] += history[base + d * m + j];
    }
    for (j = 0; j < m; j++) prof[j] /= blocks;

    // 2) 漂移：最近一个周期均值 与 上一个周期均值 之差，换算成每步漂移
    var drift = 0;
    if (n >= 2 * m) {
      var cur = 0;
      var prev = 0;
      for (j = 0; j < m; j++) {
        cur += history[n - m + j];
        prev += history[n - 2 * m + j];
      }
      drift = (cur - prev) / (m * m);
    }

    var out = [];
    for (var h = 0; h < horizon; h++) {
      out.push(prof[(n + h) % m] + drift * (h + 1));
    }
    return out;
  }

  /**
   * P3 季节朴素法：直接重复上一个完整季节。
   */
  function solSeasonalNaive(history, horizon, ctx) {
    var n = history.length;
    var m = ctx.season > 1 ? ctx.season : 12;
    var out = [];
    for (var h = 0; h < horizon; h++) {
      var idx = n - m + (h % m);
      if (idx < 0) idx = n - 1;
      out.push(history[idx]);
    }
    return out;
  }

  /**
   * P4 简单指数平滑（SES）：只维护水平项，按 alpha 做指数加权。
   */
  function solSes(history, horizon, ctx) {
    var alpha = 0.28;
    var n = history.length;
    var level = history[0];
    for (var i = 1; i < n; i++) {
      level = alpha * history[i] + (1 - alpha) * level;
    }
    var out = [];
    for (var h = 0; h < horizon; h++) out.push(level);
    return out;
  }

  /**
   * P5 Holt 线性趋势：同时维护水平项与趋势项，按趋势外推。
   */
  function solHolt(history, horizon, ctx) {
    var alpha = 0.42;
    var beta = 0.10;
    var n = history.length;
    var level = history[0];
    var trend = n > 1 ? history[1] - history[0] : 0;

    for (var i = 1; i < n; i++) {
      var prevLevel = level;
      level = alpha * history[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    var out = [];
    for (var h = 1; h <= horizon; h++) out.push(level + trend * h);
    return out;
  }

  /**
   * P6 Holt-Winters 加性：水平 + 趋势 + 季节三件套。
   */
  function solHoltWinters(history, horizon, ctx) {
    var m = ctx.season > 1 ? ctx.season : 12;
    var n = history.length;
    if (n < 2 * m) {
      // 历史不足两个周期：退化为朴素法（必须自包含，不能引用外部函数）
      var fb = [];
      var lastVal = history[history.length - 1];
      for (var f = 0; f < horizon; f++) fb.push(lastVal);
      return fb;
    }

    var alpha = 0.32;
    var beta = 0.06;
    var gamma = 0.28;

    var i;
    var s1 = 0;
    var s2 = 0;
    for (i = 0; i < m; i++) {
      s1 += history[i];
      s2 += history[m + i];
    }
    s1 /= m;
    s2 /= m;

    var level = s1;
    var trend = (s2 - s1) / m;
    var season = [];
    for (i = 0; i < m; i++) season.push(history[i] - s1);

    for (var t = 1; t < n; t++) {
      var si = season[t % m];
      var prevLevel = level;
      level = alpha * (history[t] - si) + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      season[t % m] = gamma * (history[t] - level) + (1 - gamma) * si;
    }

    var out = [];
    for (var h = 1; h <= horizon; h++) {
      out.push(level + h * trend + season[(n + h - 1) % m]);
    }
    return out;
  }

  /**
   * P7 直接多步预测：
   * 用最小二乘一次性估计「全局线性趋势」，再按相位求残差均值得到「季节剖面」，
   * 最后对每个 h 独立外推。全程不把预测值塞回历史，因此没有递归误差累积。
   */
  function solDirect(history, horizon, ctx) {
    var n = history.length;
    var m = ctx.season > 1 ? ctx.season : 12;
    var i;

    // 1) 全局最小二乘直线
    var sx = 0;
    var sy = 0;
    var sxx = 0;
    var sxy = 0;
    for (i = 0; i < n; i++) {
      sx += i;
      sy += history[i];
      sxx += i * i;
      sxy += i * history[i];
    }
    var denom = n * sxx - sx * sx;
    var slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;

    // 2) 相位残差剖面
    var resid = [];
    var cnt = [];
    for (i = 0; i < m; i++) {
      resid.push(0);
      cnt.push(0);
    }
    for (i = 0; i < n; i++) {
      var j = i % m;
      resid[j] += history[i] - (intercept + slope * i);
      cnt[j]++;
    }
    for (i = 0; i < m; i++) resid[i] = cnt[i] > 0 ? resid[i] / cnt[i] : 0;

    // 3) 一次性外推
    var out = [];
    for (var h = 0; h < horizon; h++) {
      out.push(intercept + slope * (n + h) + resid[(n + h) % m]);
    }
    return out;
  }

  /**
   * P8 鲁棒水平 + 鲁棒季节剖面：
   * 用中位数（抗异常点）估计每个相位的水平，再用前后两段均值之差估计漂移并限幅，
   * 避免「刚发生突变时外推过猛」。
   */
  function solRobustLevel(history, horizon, ctx) {
    var n = history.length;
    var m = ctx.season > 1 ? ctx.season : 7;

    /** 中位数 */
    function median(arr) {
      var a = arr.slice().sort(function (x, y) { return x - y; });
      var mid = a.length >> 1;
      if (a.length === 0) return 0;
      if (a.length % 2 === 1) return a[mid];
      return (a[mid - 1] + a[mid]) / 2;
    }

    var cycles = Math.min(6, Math.floor(n / m));
    var j;
    if (cycles < 1) {
      // 历史不足一个周期：退化为朴素法（自包含）
      var fb = [];
      var lastVal = history[n - 1];
      for (j = 0; j < horizon; j++) fb.push(lastVal);
      return fb;
    }

    // 1) 每个相位取最近 cycles 个周期样本的中位数
    var prof = [];
    for (j = 0; j < m; j++) {
      var bucket = [];
      for (var c = 0; c < cycles; c++) {
        var t = n - cycles * m + c * m + j;
        if (t >= 0 && t < n) bucket.push(history[t]);
      }
      prof.push(bucket.length > 0 ? median(bucket) : 0);
    }

    // 2) 中心化，得到季节偏移
    var center = median(prof);
    for (j = 0; j < m; j++) prof[j] -= center;

    // 3) 漂移：最近 cycles 个周期 与 更早 cycles 个周期 的均值差
    var drift = 0;
    if (n >= 2 * cycles * m) {
      var span = cycles * m;
      var a = 0;
      var b = 0;
      for (var q = 0; q < span; q++) {
        a += history[n - span + q];
        b += history[n - 2 * span + q];
      }
      drift = (a - b) / (span * span);
    }

    // 4) 限幅：单步漂移不超过当前水平的 2%
    var cap = Math.abs(center) * 0.02;
    if (drift > cap) drift = cap;
    if (drift < -cap) drift = -cap;

    var out = [];
    for (var h = 0; h < horizon; h++) {
      out.push(center + drift * (h + 1) + prof[(n + h) % m]);
    }
    return out;
  }

  /**
   * P9 滚动回测下的稳健 Holt-Winters（加性）：
   * 与 P6 的唯一区别是**初始化方式**——用最小二乘拟合前两个周期来估计初始水平与趋势，
   * 而不是用「首值差 / 两段均值差」。在滚动回测里，训练集长度会变化，
   * 稳健的初始化能让每个窗口都稳定，不靠某一段的运气。
   */
  function solRollingHW(history, horizon, ctx) {
    var m = ctx.season > 1 ? ctx.season : 12;
    var n = history.length;
    var j;

    if (n < 2 * m) {
      // 历史不足两个周期：退化为朴素法（自包含）
      var fb = [];
      var lastVal = history[n - 1];
      for (j = 0; j < horizon; j++) fb.push(lastVal);
      return fb;
    }

    var alpha = 0.20;
    var beta = 0.05;
    var gamma = 0.35;

    // 1) 用前两个周期做最小二乘，得到更稳的初始水平与趋势
    var K = 2 * m;
    var sx = 0;
    var sy = 0;
    var sxx = 0;
    var sxy = 0;
    for (j = 0; j < K; j++) {
      sx += j;
      sy += history[j];
      sxx += j * j;
      sxy += j * history[j];
    }
    var denom = K * sxx - sx * sx;
    var slope = Math.abs(denom) < 1e-12 ? 0 : (K * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / K;

    var level = intercept + slope * (K - 1);
    var trend = slope;
    var season = [];
    for (j = 0; j < m; j++) season.push(history[j] - (intercept + slope * j));

    // 2) 递推更新
    for (var t = K; t < n; t++) {
      var si = season[t % m];
      var prevLevel = level;
      level = alpha * (history[t] - si) + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      season[t % m] = gamma * (history[t] - level) + (1 - gamma) * si;
    }

    // 3) 外推
    var out = [];
    for (var h = 1; h <= horizon; h++) {
      out.push(level + h * trend + season[(n + h - 1) % m]);
    }
    return out;
  }

  /**
   * 把参考解函数转成用户可见的代码字符串（函数名统一改成 predict）。
   * @param {Function} fn 参考解函数
   * @returns {string}
   */
  function toPredictSource(fn) {
    return String(fn).replace(/^function\s+[A-Za-z0-9_$]+/, 'function predict');
  }

  /* ================================================================== *
   * 1. 题面公共片段
   * ================================================================== */

  var SIGNATURE_MD = [
    '```js',
    'function predict(history, horizon, ctx) {',
    '  // history : number[] 历史观测（长度 >= 2 个季节周期）',
    '  // horizon : number   需要预测的未来步数',
    '  // ctx     : { freq, season, datasetId, index }',
    '  // 返回    : number[] 长度必须 === horizon，且不含 NaN / Infinity',
    '',
    '  return [];   // ← 占位：请返回长度为 horizon 的预测数组',
    '}',
    '```'
  ].join('\n');

  /* ================================================================== *
   * 2. 题目列表
   * ================================================================== */

  var problems = [

    /* ---------------- P1 ---------------- */
    {
      id: 'p1-naive',
      index: 1,
      title: '朴素预测 + 漂移：打平基线不算赢',
      difficulty: '入门',
      tags: ['基线', '漂移修正', '留出评估'],
      points: 100,
      passScore: 60,
      dataset: 'airline',
      mode: 'holdout',
      horizon: 12,
      metric: 'mse',
      baselines: ['naive', 'mean'],
      threshold: 0.95,
      passRate: 82,

      statement: [
        '### 背景',
        '',
        '任何时间序列项目的第一步都不是建模，而是**建立基线**。如果复杂的模型打不过「把最后一个观测值照抄下去」，说明要么数据没有可学习结构，要么模型用错了。',
        '',
        '但基线有一条容易被忽略的性质：**打平基线不算赢**。本题把 `naive` 本身放进对照组 —— 只写出朴素法，误差比恰好是 `1.00`，只能拿 **57 分**（低于 60 的通过线）。你必须在这条基线之上再补一层最朴素的结构，才可能过关。',
        '',
        '本题用最经典的航空客运量数据，让你亲手实现朴素法（naive / random walk forecast），理解**留出评估（hold-out）**的含义，并亲手体会「基线 + 一点点结构」为什么能打败「纯基线」。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`airline`（航空客运量，月度，单位：千人）',
        '- 长度：144 点（12 年），季节周期 12',
        '- 形态：明显的线性增长趋势 + 夏季高峰的乘法季节 + 随时间放大的噪声，另有 3 个异常月',
        '- 评估方式：留出法。前 132 点作为 `history`，最后 12 点作为测试集，只评测 1 次',
        '',
        '### 任务',
        '',
        '实现 `predict(history, horizon, ctx)`，返回未来 `horizon` 步的预测值。',
        '',
        '先写出朴素法（这一步必须做，它是本题的对照组），再想办法把它的系统性偏差补掉。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**（均方误差，越小越好）',
        '- 对照基线：`naive`（重复最后一点）、`mean`（历史均值常数预测）；取误差更小者作为最优基线（本题中是 `naive`）',
        '- 误差比 `ratio = 你的 MSE / 最优基线 MSE`；`ratio <= 0.5` 得 100 分，`ratio = 0.95` 恰好得 60 分（通过线），`ratio >= 2` 得 0 分',
        '- `ratio = 1.00`（与基线打平）只有 **57 分** —— 打平基线不算赢',
        '',
        '### 数据形态提示',
        '',
        '序列有明显的上升趋势，而朴素法把未来 12 个月全部钉在「最后一个月的取值」上。',
        '想一想：一个有趋势的序列，用常数去预测未来 12 步，误差主要来自哪里？如果只允许你再补一个数字（「每步抬升多少」），你会用历史里的哪两段数据把它估出来？'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 132 个历史观测值（千人）。',
      outputSpec: '`number[]` —— 长度必须为 12，元素为有限数值。',

      hints: [
        '先只写朴素法，跑一次，看看 `ratio` 是不是恰好 1.00、得分是不是 57 —— 这就是「打平基线」的样子。',
        '朴素法把未来 12 步钉成同一个值，而真实值在往上走。你缺的是一个「每步抬升量」（漂移），不是更复杂的模型。',
        '漂移怎么估？拿最近一个周期的**平均**水平和上一个周期的**平均**水平作差，再想想：这个差值是一个周期（12 步）的总抬升，还是一次抬升？',
        '注意返回数组长度必须严格等于 horizon，否则会被判为运行时错误。'
      ],

      solution: toPredictSource(solNaiveDrift),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 12;   // 季节周期',
        '',
        '  // 步骤 1：朴素法 —— 把最后一个观测值当作未来所有步的水平',
        '  var last = history[n - 1];',
        '',
        '  // TODO: 纯朴素法的 ratio 恰好 = 1.00（打平基线 → 57 分，不通过）。',
        '  //       请估计一个「每步漂移」补掉趋势带来的系统性偏差。',
        '  var drift = 0;   // ← 洞：漂移还没有估计，所以现在就是纯朴素法',
        '',
        '  // 步骤 2：按漂移线性外推',
        '  var out = [];',
        '  for (var h = 1; h <= horizon; h++) {',
        '    out.push(last + drift * h);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P2 ---------------- */
    {
      id: 'p2-moving-average',
      index: 2,
      title: '移动平均：窗口必须与周期对齐',
      difficulty: '入门',
      tags: ['平滑', '窗口对齐', '相位剖面'],
      points: 100,
      passScore: 60,
      dataset: 'electricity',
      mode: 'holdout',
      horizon: 24,
      metric: 'mse',
      baselines: ['naive', 'mean'],
      threshold: 0.90,
      passRate: 64,

      statement: [
        '### 背景',
        '',
        '移动平均（Moving Average）是最直观的平滑手段：把最近 `k` 个观测取平均，白噪声的方差可以降到原来的 `1/k`。',
        '',
        '但「取平均」有一个致命前提：**参与平均的样本必须处在同一相位**。对小时级负荷序列来说，早 8 点的值和凌晨 3 点的值本来就不是同一个量级；',
        '如果你把「最近 24 个点」一股脑平均成一个数，得到的是「日均水平」，它会同时抹掉早高峰与夜间低谷 —— 未来一整天的预测都会变成一条水平直线。',
        '',
        '本题要求你把移动平均**按相位**来做：对每个小时，分别对「最近若干天的同一小时」取平均。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`electricity`（区域用电负荷，小时级，单位：MW）',
        '- 长度：720 点（30 天 × 24 小时），季节周期 24',
        '- 形态：24 小时强周期（早晚双峰）+ 周末下降约 13% + 缓慢上漂（30 天累计约 +30%）+ 随机尖峰',
        '- 评估方式：留出法。前 696 点作为 `history`，最后 24 点（一整天）作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用「按相位的移动平均」给出未来 24 小时的预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`（重复最后一点）、`mean`（历史均值）；取两者中误差更小的作为「最优基线」',
        '- 误差比 `ratio = 你的 MSE / 最优基线 MSE`；`ratio <= 0.5` 满分，`ratio = 0.90` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '朴素法会把「当前小时的取值」一路平移到未来 24 小时，误差极大（MSE 约 5800）；',
        '而把 24 个点平均成一个常数，误差仍然有 1800 左右 —— 因为日周期被抹平了。',
        '正确做法是：**相位内平均（降噪）+ 相位间保留形状**，最后再补一个很小的漂移修正。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 696 个历史负荷值（MW），`ctx.season = 24`。',
      outputSpec: '`number[]` —— 长度必须为 24。',

      hints: [
        '先跑一次模板：它把「最近 7 小时」平均成一个常数，ratio 约 1.2（42 分）。问题出在窗口长度 7 与季节周期 24 **不整除**。',
        '想让 24 小时的形状保留下来，就不能把不同相位的样本混在一起平均。你会怎么把「同一个小时」的样本挑出来？',
        '需要平均多少个周期？样本越多噪声越小，但也越容易被「很久以前」的旧水平拖累 —— 试一个上限（例如不超过 14 个周期）。',
        '按相位平均之后，预测出来的整条曲线会停在「过去若干天的平均水平」上，而序列还在缓慢上漂。差多少？怎么估这个差？',
        '对比实验：把「平均周期数」改成 1（只用昨天同一小时），你会发现 MSE 立刻变差 —— 这就是平均的降噪价值。'
      ],

      solution: toPredictSource(solMovingAverage),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 24;   // 季节周期（24 小时）',
        '',
        '  // 步骤 1：朴素滑动窗口 —— 随手取最近 k 个点求平均',
        '  //         注意：k = 7 与季节周期 24 不整除，窗口会跨相位',
        '  var k = 7;',
        '  var sum = 0;',
        '  for (var i = n - k; i < n; i++) sum += history[i];',
        '  var avg = sum / k;',
        '',
        '  // TODO: 这里把 24 个小时压成了一个常数，日周期被完全抹平（42 分）。',
        '  //       正确做法是「按相位」平均：对每个相位 j 单独取跨周期的均值，',
        '  //       再把 24 个相位的形状还原成一条曲线。',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    out.push(avg);   // ← 洞：所有步都等于同一个常数',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P3 ---------------- */
    {
      id: 'p3-seasonal-naive',
      index: 3,
      title: '季节朴素：让周期替你说话',
      difficulty: '普及',
      tags: ['周期性', '基线', '双周期'],
      points: 100,
      passScore: 60,
      dataset: 'traffic',
      mode: 'holdout',
      horizon: 24,
      metric: 'mse',
      baselines: ['naive', 'mean'],
      threshold: 0.95,
      passRate: 58,

      statement: [
        '### 背景',
        '',
        '当序列存在强周期时，最强的零成本基线不是朴素法，而是**季节朴素法**：直接照抄「上一个周期同一相位」的值，即 `ŷ(t+h) = y(t+h-m)`。',
        '',
        '它之所以强，是因为它同时保留了周期形状与水平信息；它之所以弱，是因为一旦水平发生漂移，它会把漂移原封不动地带进未来。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`traffic`（道路车流量，小时级，单位：辆/时）',
        '- 长度：336 点（2 周 × 24 小时）',
        '- 形态：**双周期**——日内 24 小时周期（早晚高峰）+ 周内 168 小时周期（周末下降约 26%）；另有偶发拥堵尖峰',
        '- 评估方式：留出法。前 312 点作为 `history`，最后 24 点作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用季节朴素思路给出未来 24 小时的预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`mean`，取误差更小者作为最优基线',
        '- `ratio <= 0.5` 满分，`ratio = 0.95` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '`ctx.season = 24`，但序列真正的完整周期是 168（一周）。本题只评测 24 步（一天），所以按 24 平移是可行的；',
        '如果你想更进一步，可以思考「同一天内」与「同一星期几」两种相位如何组合。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 312 个历史车流量，`ctx.season = 24`。',
      outputSpec: '`number[]` —— 长度必须为 24。',

      hints: [
        '先跑一次模板：它取的是「两个周期前」的同一相位（58 分）。方向对了，但选错了参考周期。',
        '季节朴素法的核心是「平移一个周期」：未来第 h 步 ≈ 一个周期之前同一相位的观测。平移多少步？',
        '要取「离现在最近的那个完整周期」，起点下标应该从 `n` 往回退多少？再想想 `h` 超过一个周期之后怎么绕回起点。',
        '注意下标越界：如果 `n < m`，需要退化处理，否则会取到 `undefined` 并判成运行时错误。',
        '写完后和 `naive` 比一比：为什么朴素法在小时级数据上会崩，而平移一个周期就不会？'
      ],

      solution: toPredictSource(solSeasonalNaive),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 24;   // 季节周期（24 小时）',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    // TODO: 这里退得太远了 —— 取的是「两个周期前」的同一相位，',
        '    //       水平已经漂移，58 分不通过。请改成「最近一个完整周期」。',
        '    var idx = n - 2 * m + (h % m);   // ← 洞：参考周期选错',
        '    out.push(history[idx]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P4 ---------------- */
    {
      id: 'p4-ses',
      index: 4,
      title: '简单指数平滑 SES：只维护一个水平',
      difficulty: '普及',
      tags: ['指数平滑', '水平更新', '参数 alpha'],
      points: 100,
      passScore: 60,
      dataset: 'temperature',
      mode: 'holdout',
      horizon: 20,
      metric: 'mse',
      baselines: ['naive', 'mean'],
      threshold: 0.90,
      passRate: 52,

      statement: [
        '### 背景',
        '',
        '简单指数平滑（Simple Exponential Smoothing, SES）把「最近观测」和「历史水平」做加权平均：',
        '',
        '```',
        'ℓ(t) = α · y(t) + (1 - α) · ℓ(t-1)',
        'ŷ(t+h) = ℓ(t)    对任意 h',
        '```',
        '',
        'α 越接近 1 越「跟手」（等价于朴素法），越接近 0 越「平滑」（等价于长期均值）。SES 只有一个参数，却是理解所有指数平滑族（Holt、Holt-Winters）的入口。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`temperature`（日均气温，日级，单位：℃）',
        '- 长度：730 点（2 年），季节周期 365',
        '- 形态：365 天年周期 + 白噪声（标准差约 2.4℃）+ 一次热浪与一次寒潮',
        '- 评估方式：留出法。前 710 点作为 `history`，最后 20 点作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用 SES 给出未来 20 天的气温预测（水平预测，即所有步相同）。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`mean`，取误差更小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.90` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '预测步长 20 天，而年周期在 20 天内只走 1/18 个周期（当前正处在年周期的谷底附近，变化很慢），所以「水平模型」是够用的。',
        '真正的胜负手是 α 的取值：α 太大退化成朴素法（紧跟最后一个噪声点），太小则跟不上缓慢的季节漂移。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 710 个历史日均气温（℃）。',
      outputSpec: '`number[]` —— 长度必须为 20，20 个值可以相同。',

      hints: [
        '先跑一次模板：水平项根本没被更新（`level = history[i]` 等价于「只记住最后一个观测」），55 分，正好打平朴素基线。',
        '你要写的是这一行：用「当前观测」和「上一期水平」做加权平均，权重分别是 α 与 (1-α)。α 乘在谁身上？',
        'α 在 0.2 ~ 0.35 之间通常表现不错，可以手动试几个值比较 MSE；α 越接近 1 越像朴素法。',
        '注意 SES 不建模季节：α 太大时预测会紧跟最后一个噪声点，反而更差。'
      ],

      solution: toPredictSource(solSes),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var alpha = 0.28;   // 平滑系数，试着调一调',
        '  var n = history.length;',
        '',
        '  // 初始化：用第一个观测作为初始水平',
        '  var level = history[0];',
        '',
        '  for (var i = 1; i < n; i++) {',
        '    // TODO: 指数平滑更新 —— 让 level 融合「当前观测 history[i]」与「上一期水平 level」',
        '    //       占位写法只是把 level 覆盖成当前观测，等价于朴素法（55 分，打平基线不算赢）',
        '    level = history[i];   // ← 洞：没有任何平滑',
        '  }',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) out.push(level);',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P5 ---------------- */
    {
      id: 'p5-holt',
      index: 5,
      title: 'Holt 线性趋势：让预测跟着趋势走',
      difficulty: '普及',
      tags: ['趋势', '双参数', '外推'],
      points: 100,
      passScore: 60,
      dataset: 'gmv',
      mode: 'holdout',
      horizon: 14,
      metric: 'mse',
      baselines: ['naive', 'mean', 'linear_trend'],
      threshold: 0.95,
      passRate: 41,

      statement: [
        '### 背景',
        '',
        'SES 只能预测「常数」。一旦序列有趋势，它就会系统性滞后。Holt 方法在 SES 之上增加一个趋势项：',
        '',
        '```',
        'ℓ(t) = α · y(t) + (1 - α) · (ℓ(t-1) + b(t-1))',
        'b(t) = β · (ℓ(t) - ℓ(t-1)) + (1 - β) · b(t-1)',
        'ŷ(t+h) = ℓ(t) + h · b(t)',
        '```',
        '',
        '注意趋势项是**自适应**的：它跟随最近的水平变化，而不是用整段历史拟合一条固定直线。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`gmv`（日成交额，单位：万元）',
        '- 长度：160 点，季节周期 7（弱周内效应）',
        '- 形态：**加速增长**（含二次项）+ 弱周周期 + 随水平放大的噪声 + 大促尖峰',
        '- 评估方式：留出法。前 146 点作为 `history`，最后 14 点作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用 Holt 线性趋势方法给出未来 14 天预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`mean`、`linear_trend`（对整段历史做最小二乘直线外推），取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.95` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '因为增长在加速，**用整段历史拟合的直线斜率偏小**（被早期的低速增长拖累），会系统性低估未来。',
        'Holt 的趋势项只看最近的水平变化，因此能跟上加速。这是本题与 `linear_trend` 基线的核心差异。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 146 个历史成交额（万元）。',
      outputSpec: '`number[]` —— 长度必须为 14。',

      hints: [
        '先跑一次模板：水平项没有平滑（`level = history[i]`），趋势项就被单点噪声带偏，只有 29 分。',
        '先修水平项：它应该是「当前观测」与「上一期水平 + 趋势」的加权平均，权重是 α 与 (1-α)。',
        '趋势项本身已经写好了，注意它用的是「本期的水平增量」`level - prevLevel`，所以 `prevLevel` 必须在更新前保存。',
        '预测公式是 `level + trend * h`（h 从 1 开始），不要写成 `h - 1`。',
        'α 建议 0.35~0.5，β 建议 0.05~0.15；β 太大容易把噪声当成趋势。'
      ],

      solution: toPredictSource(solHolt),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var alpha = 0.42;',
        '  var beta = 0.10;',
        '  var n = history.length;',
        '',
        '  // 初始化：水平取第一个观测，趋势取「首两个观测之差」',
        '  var level = history[0];',
        '  var trend = history[1] - history[0];',
        '',
        '  for (var i = 1; i < n; i++) {',
        '    var prevLevel = level;',
        '',
        '    // TODO: 水平更新 —— 用「当前观测」与「上一期水平 + 趋势」做加权平均',
        '    //       占位写法直接把水平换成当前观测，趋势项于是被单点噪声带偏（29 分）',
        '    level = history[i];   // ← 洞：水平没有平滑，也没有把趋势项带进来',
        '',
        '    // 趋势更新（已给出）：跟随最近的水平变化，并按 β 平滑',
        '    trend = beta * (level - prevLevel) + (1 - beta) * trend;',
        '  }',
        '',
        '  var out = [];',
        '  for (var h = 1; h <= horizon; h++) out.push(level + trend * h);',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P6 ---------------- */
    {
      id: 'p6-holt-winters',
      index: 6,
      title: 'Holt-Winters 加性：趋势 + 季节三件套',
      difficulty: '提高',
      tags: ['趋势', '季节', '三参数'],
      points: 100,
      passScore: 60,
      dataset: 'airline',
      mode: 'holdout',
      horizon: 12,
      metric: 'mse',
      baselines: ['naive', 'seasonal_naive', 'mean'],
      threshold: 0.90,
      passRate: 33,

      statement: [
        '### 背景',
        '',
        'Holt-Winters 加性模型把序列拆成三部分：水平 `ℓ`、趋势 `b`、季节 `s`（季节成分之和近似为 0）：',
        '',
        '```',
        'ℓ(t) = α · (y(t) - s(t-m)) + (1 - α) · (ℓ(t-1) + b(t-1))',
        'b(t) = β · (ℓ(t) - ℓ(t-1)) + (1 - β) · b(t-1)',
        's(t) = γ · (y(t) - ℓ(t)) + (1 - γ) · s(t-m)',
        'ŷ(t+h) = ℓ(t) + h · b(t) + s(t + h - m)',
        '```',
        '',
        '与季节朴素法相比，它多了**趋势外推**；与 Holt 相比，它多了**季节项**。当序列同时有趋势和季节时，这是标准的工业级基线。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`airline`（航空客运量，月度，单位：千人）',
        '- 长度：144 点（12 年），季节周期 12',
        '- 形态：线性增长趋势 + 12 个月乘法季节（振幅随水平增长）+ 渐强噪声 + 3 个异常月',
        '- 评估方式：留出法。前 132 点（11 个完整年）作为 `history`，最后 12 点作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用 Holt-Winters 加性方法给出未来 12 个月的预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`seasonal_naive`、`mean`，取误差最小者（本题中通常是 `seasonal_naive`）',
        '- `ratio <= 0.5` 满分，`ratio = 0.90` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '`seasonal_naive` 会把「去年同月」直接搬过来，但序列每年增长约 14 千人，12 步外推会**系统性低估**。',
        '本题的胜负点就是：能否在保留季节形状的同时，把趋势补上去。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 132 个历史观测值（千人），`ctx.season = 12`。',
      outputSpec: '`number[]` —— 长度必须为 12。',

      hints: [
        '先跑一次模板：三个更新式只写了两个（水平、趋势），季节项永远停在初值，ratio 约 3.9（0 分）。',
        '季节项也需要「递推」：每次观测到新数据，都要用「本次残差 = 观测 - 水平」去修正对应相位的季节值，权重是 γ。',
        '三件套的分工：水平项要先扣掉季节项再看趋势，所以它是 `α·(y - s) + (1-α)·(ℓ + b)` —— 注意 `y - s` 里用的是哪个相位的 s。',
        '初始化怎么估？季节是「相对水平的偏移」，所以需要一个基准水平：前两个完整周期各自的均值，能同时给出基准水平与趋势初值。',
        '预测时的季节下标是 `(n + h - 1) % m`，很容易写错，建议先用 h=1 手算一遍。',
        'γ 建议 0.2~0.35；α 太大时会与季节项互相抢解释力。'
      ],

      solution: toPredictSource(solHoltWinters),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var m = ctx.season > 1 ? ctx.season : 12;',
        '  var n = history.length;',
        '  var alpha = 0.32, beta = 0.06, gamma = 0.28;',
        '',
        '  // 1) 用前两个完整周期初始化水平与趋势',
        '  var s1 = 0, s2 = 0, i;',
        '  for (i = 0; i < m; i++) { s1 += history[i]; s2 += history[m + i]; }',
        '  s1 /= m; s2 /= m;',
        '',
        '  var level = s1;',
        '  var trend = (s2 - s1) / m;',
        '',
        '  // 2) 季节初值：第一个周期相对基准水平的偏移',
        '  var season = [];',
        '  for (i = 0; i < m; i++) season.push(history[i] - s1);',
        '',
        '  // 3) 递推更新（水平 / 趋势 / 季节）',
        '  for (var t = 1; t < n; t++) {',
        '    var si = season[t % m];',
        '    var prevLevel = level;',
        '    level = alpha * (history[t] - si) + (1 - alpha) * (level + trend);',
        '    trend = beta * (level - prevLevel) + (1 - beta) * trend;',
        '',
        '    // TODO: 季节项的递推更新还没写 —— 现在 season 永远停在第一年的初值，',
        '    //       季节振幅完全跟不上（ratio 约 3.9，0 分）。',
        '    //       用「本次残差 history[t] - level」去修正 season[t % m]，权重 γ。',
        '    season[t % m] = si;   // ← 洞：季节项没有更新',
        '  }',
        '',
        '  // 4) 外推',
        '  var out = [];',
        '  for (var h = 1; h <= horizon; h++) {',
        '    out.push(level + h * trend + season[(n + h - 1) % m]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P7 ---------------- */
    {
      id: 'p7-direct-multistep',
      index: 7,
      title: '直接多步预测：拒绝误差累积',
      difficulty: '提高',
      tags: ['多步策略', '直接法', '相位剖面'],
      points: 100,
      passScore: 60,
      dataset: 'retail',
      mode: 'holdout',
      horizon: 12,
      metric: 'mse',
      baselines: ['naive', 'mean', 'seasonal_naive'],
      threshold: 0.90,
      passRate: 27,

      statement: [
        '### 背景',
        '',
        '多步预测有两种策略：',
        '',
        '- **递归法（recursive）**：先预测 1 步，把预测值塞回历史，再预测下 1 步。实现简单，但误差会逐步累积、放大。',
        '- **直接法（direct）**：对每一个预测步 h 单独建模，一次性给出 `ŷ(t+h)`，全程不把预测值当输入。',
        '',
        '本题要求你用直接法做一次完整的**分解式外推**：',
        '',
        '1. 用最小二乘拟合一条全局直线，得到「趋势」；',
        '2. 把每个点减去直线值，再按相位（`t mod m`）求残差均值，得到「季节剖面」；',
        '3. 对每个 h 独立地算 `趋势值 + 相位残差`，一次性输出全部预测。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`retail`（周零售额，单位：万元）',
        '- 长度：156 点（3 年），季节周期 52',
        '- 形态：线性趋势（每周约 +2.6 万元）+ 52 周季节（振幅约 ±17%）+ 固定节奏促销（每 13 周）+ 随机促销尖峰',
        '- 评估方式：留出法。前 144 点作为 `history`，最后 12 周作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，用直接多步法给出未来 12 周预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`mean`、`seasonal_naive`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.90` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '三个基线在这里会以三种不同的方式失败，值得逐一观察：',
        '',
        '- `seasonal_naive`（滞后 52 周）：趋势带来约 +135 的系统性低估，误差最大；',
        '- `naive`（重复最后一周）：如果最后一周恰好是促销周，它会把 22% 的促销溢价原封不动延续 12 周；',
        '- `mean`（历史均值）：够稳，但完全放弃趋势，是本题真正的对手。',
        '',
        '所以本题的关键是：**趋势要估准，季节形状要保留，促销尖峰不要被当成季节**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 144 个历史周零售额（万元），`ctx.season = 52`。',
      outputSpec: '`number[]` —— 长度必须为 12。',

      hints: [
        '先跑一次模板：残差剖面是全 0（`resid` 只被初始化，从没累加过），于是预测退化成一条纯直线，ratio 约 6（0 分）。',
        '残差剖面的含义：每个相位（`t % m`）上，「观测值比直线高多少 / 低多少」的平均值。你需要遍历全部历史，把残差按相位累加。',
        '累加之后别忘了除以「该相位的样本数」才是均值；如果某个相位一个样本都没有，要给出一个安全的默认值。',
        '外推时，直线值应该用未来时刻的下标（历史长度之后），相位残差用同一个时刻的 `% m` —— 两者必须对应同一个时间点。',
        '注意不要写成递归：`out[h]` 不能依赖 `out[h-1]`，否则就不是直接法了。'
      ],

      solution: toPredictSource(solDirect),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 52;',
        '  var i;',
        '',
        '  // 1) 全局最小二乘直线：y ≈ intercept + slope * t',
        '  var sx = 0, sy = 0, sxx = 0, sxy = 0;',
        '  for (i = 0; i < n; i++) {',
        '    sx += i; sy += history[i]; sxx += i * i; sxy += i * history[i];',
        '  }',
        '  var denom = n * sxx - sx * sx;',
        '  var slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;',
        '  var intercept = (sy - slope * sx) / n;',
        '',
        '  // 2) 相位残差剖面',
        '  var resid = [];',
        '  var cnt = [];',
        '  for (i = 0; i < m; i++) { resid.push(0); cnt.push(0); }',
        '',
        '  // TODO: 残差剖面还没累加 —— 现在 resid 全 0，预测退化成一条纯直线（0 分）。',
        '  //       请遍历全部历史，把「观测值 - 直线值」按相位 i % m 累加进 resid，并统计 cnt。',
        '',
        '  for (i = 0; i < m; i++) resid[i] = cnt[i] > 0 ? resid[i] / cnt[i] : 0;',
        '',
        '  // 3) 一次性外推，不做递归',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    out.push(intercept + slope * (n + h) + resid[(n + h) % m]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P8 ---------------- */
    {
      id: 'p8-robust-shift',
      index: 8,
      title: '突变与异常：鲁棒的水平与相位估计',
      difficulty: '提高',
      tags: ['鲁棒统计', '水平漂移', '中位数'],
      points: 100,
      passScore: 60,
      dataset: 'demand_shift',
      mode: 'holdout',
      horizon: 20,
      metric: 'mae',
      baselines: ['naive', 'mean'],
      threshold: 0.90,
      passRate: 22,

      statement: [
        '### 背景',
        '',
        '真实业务序列经常出现两种「不友好」的现象：',
        '',
        '- **水平漂移（level shift）**：某天起需求整体上了一个台阶（改价、渠道变化、竞品退出）；',
        '- **异常点（outlier）**：单点尖峰（大促、爬虫、事故）。',
        '',
        '均值与最小二乘对异常点非常敏感——一个 +90 的尖峰能把 12 点均值拉高 7.5。中位数则几乎不受影响（崩溃点 50%）。本题要求你用**鲁棒统计**做出一个既抗异常、又能跟上突变的水平估计。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`demand_shift`（日需求，单位：件）',
        '- 长度：200 点，季节周期 7（弱周内效应，振幅约 ±5.5%）',
        '- 形态：前 105 点水平约 500；第 105~110 点快速过渡；第 110 点后水平约 620 并缓慢增长（每日 +0.45）；噪声标准差 17；约 2% 的异常尖峰（+45~+90）',
        '- 评估方式：留出法。前 180 点作为 `history`，最后 20 点作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`，给出未来 20 天的需求预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MAE**（平均绝对误差，对异常点不如 MSE 敏感，更适合本题）',
        '- 对照基线：`naive`（重复最后一点）、`mean`（历史均值，会被漂移严重拖累），取误差更小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.90` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '`naive` 在这个数据集上其实很强（它天然跟得上水平漂移），所以你的目标不是「超过一个很弱的基线」，而是**在跟得上突变的同时把噪声压下去**。',
        '序列还有约 ±5.5% 的周内周期（振幅约 34 件），如果只估一个「水平」，这部分误差是压不掉的 —— 这正是需要按相位取中位数的原因。',
        '这正是「中位数相位剖面 + 限幅漂移」能赢的地方。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 180 个历史需求值（件），`ctx.season = 7`。',
      outputSpec: '`number[]` —— 长度必须为 20。',

      hints: [
        '先跑一次模板：它用「全历史均值」当一个常数去预测，被第 110 天的水平突变彻底拖垮（ratio 约 2.1，0 分）。',
        '第一步：把「水平」估准。均值会被异常点和突变前的旧数据一起带偏，你能换一个「抗异常 + 只看最近」的统计量吗？',
        '第二步：只估一个水平还不够 —— 序列还有约 ±5.5% 的周内周期。按星期几分别估一个偏移，就能把这部分误差压下去。',
        '第三步：水平还在缓慢上漂（每日约 +0.45）。用「最近若干周」与「更早若干周」的均值差估一个每步漂移，但一定要**限幅**，否则突变刚发生时会外推过猛。',
        '想一想：为什么中位数对「+90 的尖峰」几乎不动，而 12 点均值会被拉高 7.5？'
      ],

      solution: toPredictSource(solRobustLevel),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 7;',
        '',
        '  // 朴素做法：把全历史平均成一个常数当作未来水平',
        '  var sum = 0;',
        '  for (var i = 0; i < n; i++) sum += history[i];',
        '  var level = sum / n;',
        '',
        '  // TODO: 这个「全历史均值」有两个致命问题：',
        '  //       ① 不鲁棒：异常尖峰会把均值拉高；',
        '  //       ② 不跟手：第 110 天水平突变之后，它仍然把突变前的旧水平平均进来（0 分）。',
        '  //       请改成「按相位取中位数（抗异常）+ 限幅漂移（跟得上突变）」。',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    out.push(level);   // ← 洞：既没有相位剖面，也没有漂移',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P9 ---------------- */
    {
      id: 'p9-rolling-challenge',
      index: 9,
      title: '滚动回测：在 4 个时间起点上都要赢',
      difficulty: '挑战',
      tags: ['滚动回测', '稳健性', '初始化技巧'],
      points: 100,
      passScore: 60,
      dataset: 'airline',
      mode: 'rolling',
      horizon: 12,
      originStep: 12,
      windows: 4,
      metric: 'mse',
      baselines: ['naive', 'seasonal_naive', 'mean', 'linear_trend'],
      threshold: 0.88,
      passRate: 14,

      statement: [
        '### 背景',
        '',
        '留出法只评测 1 个时间点，很容易「运气好」：恰好那一段平稳，模型就通过了。工业界的标准做法是**滚动回测（rolling / walk-forward backtesting）**：',
        '',
        '在多个历史起点分别训练、分别预测，再对各窗口的指标取平均。这样得到的结果才代表「长期可复现的能力」。',
        '',
        '本题的模板就是**上一题（P6 加性 Holt-Winters）的实现原样搬过来**。它在你熟悉的留出法里能拿 82 分，但在这里只有 79 分，而且**第 1 个窗口只有 44 分** —— 4 个窗口里崩了 1 个，整体判 WA。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`airline`（航空客运量，月度，单位：千人）',
        '- 长度：144 点（12 年），季节周期 12',
        '- 形态：线性增长趋势 + 12 个月乘法季节（振幅随水平增长）+ 渐强噪声 + 3 个异常月',
        '- 评估方式：**滚动回测**，共 4 个测试点',
        '  - 起点从 `n - horizon - (4-1)*originStep` 开始，每隔 `originStep = 12` 点滑动一次',
        '  - 4 个 origin 的训练集长度依次为 96 / 108 / 120 / 132 点（8 / 9 / 10 / 11 个完整年）',
        '  - 每个测试点只用该起点之前的数据训练，预测之后 12 步（一整年）',
        '  - 逐窗口计算 MSE，再对 4 个窗口取平均作为本题得分依据',
        '',
        '### 任务',
        '',
        '实现 `predict`，要求它在 4 个窗口上**都**达到通过线。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**（对 4 个窗口分别计算后取平均）',
        '- 对照基线：`naive`、`seasonal_naive`、`mean`、`linear_trend`，每个窗口各自取误差最小者作为该窗口的最优基线',
        '- 每个窗口 `ratio <= 0.5` 得 100 分，`ratio = 0.88` 恰好 60 分，`ratio >= 2` 得 0 分',
        '- **全部 4 个窗口都达到 60 分**、且总分 >= 60 才算通过',
        '',
        '### 陷阱说明：为什么会崩掉一个窗口',
        '',
        '模板崩在第 1 个窗口（训练集只有 96 点 = 8 个完整周期），而窗口 2/3/4 都在 89 分以上。',
        '下面三组是实测数据（同一份代码，每次只改一处）：',
        '',
        '- 模板原样（两段均值差初始化 + P6 参数）：`44 / 100 / 89 / 82` → 总分 79，窗口 1 崩；',
        '- 只把初始化换成「前 2m 点最小二乘」（参数不动）：`54 / 100 / 96 / 90` → 总分 85，窗口 1 仍不达标；',
        '- 再把参数调成 α≈0.20 / γ≈0.35：`100 / 100 / 100 / 100` → 总分 100，4 窗口全绿。',
        '',
        '两个机制：',
        '',
        '- **初始化**：用「前两个周期的均值差」估初始趋势，8 个周期里只用了 2 个；初始趋势一旦偏，`level + h * trend` 会把它放大 12 倍（h 最大到 12），整年的预测一起偏。把前 2m 个点整体拟合一条直线，窗口 1 就从 44 升到 54。',
        '- **平滑参数**：P6 的 α=0.32 / γ=0.28 在这个数据集上偏「追噪声」。滚动回测里「少追噪声」比「快速反应」更重要，把 α 调小、γ 调大才能把剩下的余量吃满。',
        '',
        '也就是说：**同一个模型结构，换个初始化、换组参数，最弱的那个窗口就会从崩掉变成满分** —— 留出法只测一个点，永远看不到这件事。',
        '',
        '### 数据形态提示',
        '',
        '两个可以调的杠杆（都需要你自己想清楚）：',
        '',
        '1. **初始化**：与其用「两段均值差」或「首两个观测之差」，能不能用更多数据把「初始水平 + 初始趋势」一起估出来？（例如对前两个周期拟合一条直线，取它的末端值与斜率。）',
        '2. **平滑参数**：先只改初始化，看窗口 1 还差多少；再回头调 α / γ。每次只改一个，看逐窗口分数的变化。',
        '',
        '（注意：本题的陷阱不是「换个初值就好」。把初值简单置 0 或取首值也能让窗口 1 勉强过关（85 分左右），但那只是「递推几十步之后把初值忘光了」，并没有解决初始趋势的偏差 —— 换个数据集就会失效。真正被 12 步外推放大的是**初始趋势的偏差**。）'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 每个测试点不同的历史长度（96 / 108 / 120 / 132），`ctx.index` 为窗口序号 0~3，`ctx.season = 12`。',
      outputSpec: '`number[]` —— 长度必须为 12。',

      hints: [
        '先看结果面板的「逐测试点」：模板是 44 / 100 / 89 / 82，只有窗口 1 崩了。先确认崩溃只发生在训练集最短的那个窗口。',
        '窗口 1 的训练集只有 8 个完整周期。用「前两个周期」去估趋势，只用了 8 个周期里的 2 个 —— 数据利用率太低了。能不能把 2m 个点整体用起来？',
        '对前 2m 个点拟合一条直线（最小二乘），你就同时得到了「初始水平」（直线在 2m-1 处的取值）与「初始趋势」（斜率）。',
        '季节初值 = 第一个周期相对那条直线的残差，而不是相对「第一年均值」的残差。',
        '递推要从 `t = 2m` 开始（前两个周期已经用于初始化），否则会把初始化信息又冲掉。',
        '最后再调参数：α 建议 0.15~0.25、β 0.03~0.08、γ 0.3~0.4。每次只改一个，看逐窗口分数的变化。'
      ],

      solution: toPredictSource(solRollingHW),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var m = ctx.season > 1 ? ctx.season : 12;',
        '  var n = history.length;',
        '  var alpha = 0.32, beta = 0.06, gamma = 0.28;   // 这是 P6 的参数',
        '  var j;',
        '',
        '  if (n < 2 * m) {',
        '    var fb = [];',
        '    for (j = 0; j < horizon; j++) fb.push(history[n - 1]);',
        '    return fb;',
        '  }',
        '',
        '  // TODO（洞 1）：初始化方式 —— 这里照抄了 P6 的「两段均值差」，',
        '  //   只用 2 个周期的均值去估趋势，训练集只有 8 个周期时偏差会被 12 步外推放大。',
        '  //   想想怎么把前 2m 个点整体利用起来（例如拟合一条直线，同时得到水平与趋势）。',
        '  var s1 = 0, s2 = 0;',
        '  for (j = 0; j < m; j++) { s1 += history[j]; s2 += history[m + j]; }',
        '  s1 /= m; s2 /= m;',
        '',
        '  var level = s1;',
        '  var trend = (s2 - s1) / m;',
        '  var season = [];',
        '  for (j = 0; j < m; j++) season.push(history[j] - s1);',
        '',
        '  // 递推更新',
        '  for (var t = 1; t < n; t++) {',
        '    var si = season[t % m];',
        '    var prevLevel = level;',
        '    level = alpha * (history[t] - si) + (1 - alpha) * (level + trend);',
        '    trend = beta * (level - prevLevel) + (1 - beta) * trend;',
        '    season[t % m] = gamma * (history[t] - level) + (1 - gamma) * si;',
        '  }',
        '',
        '  // 外推',
        '  var out = [];',
        '  for (var h = 1; h <= horizon; h++) {',
        '    out.push(level + h * trend + season[(n + h - 1) % m]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    }
  ];

  /* ================================================================== *
   * 3. 导出
   * ================================================================== */

  TSJ.problems = problems;

  /**
   * 按 id 查找题目。
   * @param {string} id 题目 id
   * @returns {Object|null}
   */
  TSJ.findProblem = function (id) {
    for (var i = 0; i < problems.length; i++) {
      if (problems[i].id === id) return problems[i];
    }
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = problems;
    module.exports.findProblem = TSJ.findProblem;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
