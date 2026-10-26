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
    var n = history.length;              // n：历史一共有几个数（数组的 .length 属性）
    var level = history[0];              // level：当前「水平」估计，先用第 1 个值当起点
    // for 循环从第 2 个数走到最后一个（下标 1 到 n-1）
    for (var i = 1; i < n; i++) {
      // 核心一步（加权平均）：新水平 = α×新观测 + (1−α)×旧水平
      // α 大 → 更相信最新观测（记性短）；α 小 → 更相信历史（记性长）
      level = alpha * history[i] + (1 - alpha) * level;
    }
    var out = [];                        // 装预测值的空数组
    // SES 假设没有趋势/季节：未来每一步都等于最终水平，循环 horizon 次填满
    for (var h = 0; h < horizon; h++) out.push(level);
    return out;                          // 返回数组的长度必须等于 horizon
  }

  /**
   * P5 Holt 线性趋势：同时维护水平项与趋势项，按趋势外推。
   */
  function solHolt(history, horizon, ctx) {
    var alpha = 0.42;
    var beta = 0.10;
    var n = history.length;              // 历史长度
    var level = history[0];              // 水平（现在多高）：从第 1 个值起步
    // 趋势（每步走多远）初始化为前两值之差；三目运算符：条件 ? 真值 : 假值
    // 只有一个点时没有差可算，取 0
    var trend = n > 1 ? history[1] - history[0] : 0;

    // 逐期更新两条状态：每来一个新观测，循环体执行一遍
    for (var i = 1; i < n; i++) {
      var prevLevel = level;             // 先存旧水平：下一行会覆盖它，趋势更新还要用
      // 水平更新（加权平均）：新水平 = α×新观测 + (1−α)×(按趋势外推的旧水平)
      // 与 SES 的差别：旧状态先加一个 trend 提前量，而不是原地不动
      level = alpha * history[i] + (1 - alpha) * (level + trend);
      // 趋势更新（也是加权平均）：新趋势 = β×(刚发生的水平变化) + (1−β)×旧趋势
      // β 小 → 趋势变化慢、抗噪声；β 大 → 追踪快但容易被噪声带偏
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    var out = [];                        // 从当前水平出发，每步抬一个 trend（线性外推）
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

    // ---- 初始化：用头两个周期把三条状态估出来 ----
    var i;
    var s1 = 0;                          // s1/s2：第 1、第 2 个周期的累加器
    var s2 = 0;
    for (i = 0; i < m; i++) {
      s1 += history[i];                  // 第 1 个周期的 m 个数之和
      s2 += history[m + i];              // 第 2 个周期（下标整体右移 m）
    }
    s1 /= m;                             // 复合赋值：s1 = s1 / m → 周期均值
    s2 /= m;

    var level = s1;                      // 初始水平 = 第 1 个周期均值
    var trend = (s2 - s1) / m;           // 初始趋势 = 两周期均值之差 ÷ 周期长（每步抬升）
    var season = [];                     // 季节项：每个相位一个数（观测减掉水平后的余量）
    for (i = 0; i < m; i++) season.push(history[i] - s1);

    // ---- 逐期更新三条状态 ----
    // t % m 是取余：当前时刻落在周期内的第几个相位（0..m-1 循环）
    for (var t = 1; t < n; t++) {
      var si = season[t % m];            // 取出当前相位的旧季节项
      var prevLevel = level;             // 存旧水平（趋势更新要用）
      // 水平更新：先把季节项从观测里扣掉（去季节），再与「趋势外推的旧水平」加权平均
      level = alpha * (history[t] - si) + (1 - alpha) * (level + trend);
      // 趋势更新：与 Holt 完全相同
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      // 季节更新：只更新当前相位 = γ×(观测 − 新水平) + (1−γ)×旧季节项
      season[t % m] = gamma * (history[t] - level) + (1 - gamma) * si;
    }

    // ---- 外推：水平 + h 步趋势 + 未来相位的季节项 ----
    var out = [];
    for (var h = 1; h <= horizon; h++) {
      // (n + h - 1) % m：第 h 步未来时刻对应的相位；三条状态在同一时刻相加
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

  /* ================================================================== *
   * 0.5 高阶题参考解（P10–P15）
   *
   * 这六道题对应方法库里「经典统计」与「竞赛级方法」两层的可练条目：
   *   P10 Theta 方法        —— Assimakopoulos & Nikolopoulos, IJF 2000（M3 冠军）
   *   P11 AR(p) Yule-Walker —— Box & Jenkins 传统，闭式解
   *   P12 Croston 法        —— Syntetos & Boylan, IJF 2005（间歇需求）
   *   P13 周期图 + 谐波回归  —— 经典谱分析，频域方法的思想源头
   *   P14 组合预测          —— Bates & Granger 1969，M4 的核心结论
   *   P15 DLinear 分解线性  —— Zeng et al., AAAI 2023
   * ================================================================== */

  /**
   * P10 Theta 方法：θ=0 线（线性回归）与 θ=2 线（SES）各占一半，再加回季节。
   * 两个极简模型拼起来打赢任何单一基线 —— 这正是 M3 冠军的做法。
   */
  function solTheta(history, horizon, ctx) {
    var n = history.length;
    var m = (ctx && ctx.season > 1) ? ctx.season : 1;
    var i;

    // 1) 先用全局 OLS 去掉趋势，再按相位求残差均值，得到加性季节项（归一后和为 0）
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += i; sy += history[i]; sxx += i * i; sxy += i * history[i]; }
    var den = n * sxx - sx * sx;
    var slope = Math.abs(den) < 1e-12 ? 0 : (n * sxy - sx * sy) / den;
    var icept = (sy - slope * sx) / n;

    var s = null;
    if (m > 1) {
      var sum = [], cnt = [];
      for (i = 0; i < m; i++) { sum.push(0); cnt.push(0); }
      for (i = 0; i < n; i++) { var p = i % m; sum[p] += history[i] - (icept + slope * i); cnt[p]++; }
      s = [];
      var mean = 0;
      for (i = 0; i < m; i++) { s.push(cnt[i] > 0 ? sum[i] / cnt[i] : 0); mean += s[i]; }
      mean /= m;
      for (i = 0; i < m; i++) s[i] -= mean;
    }

    // 2) 去季节序列
    var d = [];
    for (i = 0; i < n; i++) d.push(history[i] - (s ? s[i % m] : 0));

    // 3) θ=0 线：对去季节序列再做一次 OLS 直线（长期趋势）
    var ax = 0, ay = 0, axx = 0, axy = 0;
    for (i = 0; i < n; i++) { ax += i; ay += d[i]; axx += i * i; axy += i * d[i]; }
    var den2 = n * axx - ax * ax;
    var b0 = Math.abs(den2) < 1e-12 ? 0 : (n * axy - ax * ay) / den2;
    var a0 = (ay - b0 * ax) / n;

    // 4) θ=2 线：SES（α=0.2），取末端水平（短期）
    var alpha = 0.2;
    var level = d[0];
    for (i = 1; i < n; i++) level = alpha * d[i] + (1 - alpha) * level;

    // 5) 0.5 / 0.5 组合，再加回季节
    var out = [];
    for (var h = 0; h < horizon; h++) {
      var t = n + h;
      var v = 0.5 * (a0 + b0 * t) + 0.5 * level;
      if (s) v += s[t % m];
      out.push(v);
    }
    return out;
  }

  /**
   * P11 AR(p)：Yule-Walker 方程 + Levinson-Durbin 递推，闭式解、无需迭代优化。
   */
  function solArYW(history, horizon, ctx) {
    var n = history.length;
    var p = Math.min(10, Math.max(1, Math.floor(n / 4)));
    var i, k;                            // 循环变量先声明、两处复用

    // ---- 1) 去均值：AR 假设序列围绕某个水平波动，先把水平减掉 ----
    var mu = 0;                          // mu：均值（先累加、再除以 n）
    for (i = 0; i < n; i++) mu += history[i];
    mu /= n;
    var x = [];                          // 中心化序列：每项 = 原值 − 均值（偏离平均多少）
    for (i = 0; i < n; i++) x.push(history[i] - mu);

    // ---- 2) 自协方差 γ(0..p)：隔 k 步的两个值「同涨同跌」的程度 ----
    // γ(0) 是方差（自己乘自己）；γ(k) ÷ γ(0) 就是自相关系数（ACF）
    var g = [];
    for (k = 0; k <= p; k++) {
      var acc = 0;                       // 累加器：Σ x[i]·x[i+k]（对应相乘再求和，即点积）
      for (i = 0; i + k < n; i++) acc += x[i] * x[i + k];
      g.push(acc / n);
    }
    // 常数序列：没有可提取的自相关结构，直接给均值
    if (!(g[0] > 1e-12)) {
      var flat = [];
      for (i = 0; i < horizon; i++) flat.push(mu);
      return flat;
    }

    // ---- 3) Levinson-Durbin 递推解 Γ_p·φ = γ_p ----
    // 目标：解出 p 个未知数 φ（自回归系数）。方程组的矩阵沿对角线取值相同（Toeplitz），
    // 普通高斯消元是 O(p³)；这里从 AR(1) 逐阶升到 AR(p)，只要 O(p²)。
    var prev = null, err = g[0], phi = null;
    for (k = 0; k < p; k++) {            // 第 k 轮 = 求解 AR(k+1)
      var cur = new Array(p + 1).fill(0); // new Array(len).fill(0)：造一个全 0 数组
      if (k === 0) {
        // AR(1) 有直接解：φ1 = γ(1)/γ(0)
        cur[1] = g[1] / g[0];
        err = g[0] * (1 - cur[1] * cur[1]);   // err：当前阶的一步预测误差方差
      } else {
        // 分子 = γ(k+1) − 旧系数与 γ 的「倒序点积」：还没被解释掉的新息
        var num = g[k + 1];
        for (i = 1; i <= k; i++) num -= prev[i] * g[k + 1 - i];
        var refl = num / err;            // 反射系数：这一阶新加的第 k+1 步依赖有多强
        cur[k + 1] = refl;
        // 旧系数整体修正：减去反射系数 × 旧系数的镜像（倒序重放）
        for (i = 1; i <= k; i++) cur[i] = prev[i] - refl * prev[k + 1 - i];
        err = err * (1 - refl * refl);   // 误差方差按 (1 − refl²) 收缩
      }
      if (!(err > 1e-12)) { cur = new Array(p + 1).fill(0); err = 1e-12; }  // 防数值崩坏
      prev = cur;                        // 本轮结果成为下一轮的「旧系数」
      phi = cur;
    }

    // ---- 4) 多步递推预测：ŷ(t) = φ1·x(t−1) + … + φp·x(t−p) ----
    // 走过一步之后就没有真值了，把预测值补进 ext 再继续往后算（递归式多步）
    var ext = x.slice();                 // slice()：复制一份，不动原数组
    for (var h = 1; h <= horizon; h++) {
      var v = 0;
      for (i = 1; i <= p; i++) v += phi[i] * ext[ext.length - i];  // 取末尾 p 个值做点积
      ext.push(v);                       // 预测值入列，成为下一轮的「历史」
    }
    var out = [];
    for (var j = 0; j < horizon; j++) out.push(mu + ext[n + j]);    // 记得把均值加回去
    return out;
  }

  /**
   * P12 TSB（Teunter-Syntetos-Babai, IJPE 2011）：
   * 不估「间隔」而直接估「本月有需求」的概率 q，预测 q · z。
   * 对需求频率的变化比 Croston / SBA 更敏感。
   */
  function solTsb(history, horizon, ctx) {
    var n = history.length;
    var alpha = 0.05;   // 非零需求量 z 的平滑系数
    var beta = 0.1;     // 需求发生概率 q 的平滑系数
    var prob = 1;       // 平滑后的「本月有需求」概率
    var z = null;       // 平滑后的「非零需求量」

    for (var i = 0; i < n; i++) {
      var v = history[i];
      var occurred = v > 0 ? 1 : 0;
      prob = beta * occurred + (1 - beta) * prob;
      if (!occurred) continue;
      if (z === null) { z = v; }
      else { z += alpha * (v - z); }
    }
    // 全程零需求：没什么可预测的
    if (z === null || !(prob > 0)) {
      var zeros = [];
      for (var j = 0; j < horizon; j++) zeros.push(0);
      return zeros;
    }
    var rate = prob * z;
    var out = [];
    for (var k = 0; k < horizon; k++) out.push(rate);
    return out;
  }

  /**
   * P13 周期图 + 谐波回归：先用功率谱估周期，再最小二乘外推。
   */
  function solHarmonic(history, horizon, ctx) {
    var n = history.length;
    var i, j;

    // 1) 周期图：先去掉线性趋势，再在整数周期上求功率
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += i; sy += history[i]; sxx += i * i; sxy += i * history[i]; }
    var den = n * sxx - sx * sx;
    var b = Math.abs(den) < 1e-12 ? 0 : (n * sxy - sx * sy) / den;
    var a = (sy - b * sx) / n;

    var d = [];
    for (i = 0; i < n; i++) d.push(history[i] - (a + b * i));

    var best = [];
    for (var P = 4; P <= Math.floor(n / 2); P++) {
      var re = 0, im = 0;
      for (i = 0; i < n; i++) {
        var w = 2 * Math.PI * i / P;
        re += d[i] * Math.cos(w);
        im += d[i] * Math.sin(w);
      }
      best.push({ P: P, power: (re * re + im * im) / n });
    }
    best.sort(function (u, v) { return v.power - u.power; });
    // 取 top-3，并去掉彼此成倍数关系的（同一个物理周期的谐波）
    var periods = [];
    for (i = 0; i < best.length && periods.length < 3; i++) {
      var cand = best[i].P;
      var dup = false;
      for (j = 0; j < periods.length; j++) {
        if (cand % periods[j] === 0 || periods[j] % cand === 0) { dup = true; break; }
      }
      if (!dup && best[i].power > 1e-9) periods.push(cand);
    }
    if (periods.length === 0) periods.push(12);

    // 2) 设计矩阵：[截距, 时间, 每个周期的 cos / sin]，直接对原序列做最小二乘
    var ncol = 2 + 2 * periods.length;
    var A = [];
    for (i = 0; i < n; i++) {
      var row = [1, i];
      for (j = 0; j < periods.length; j++) {
        var w2 = 2 * Math.PI * i / periods[j];
        row.push(Math.cos(w2));
        row.push(Math.sin(w2));
      }
      A.push(row);
    }
    var coef = lstsq(A, history, ncol);

    // 3) 外推
    var out = [];
    for (var h = 0; h < horizon; h++) {
      var t = n + h;
      var v = coef[0] + coef[1] * t;
      for (j = 0; j < periods.length; j++) {
        var w3 = 2 * Math.PI * t / periods[j];
        v += coef[2 + 2 * j] * Math.cos(w3) + coef[3 + 2 * j] * Math.sin(w3);
      }
      out.push(v);
    }
    return out;

    /** 正规方程 + 列主元高斯消元（带极小 ridge 防止奇异）。 */
    function lstsq(M, y, nc) {
      var ata = [], aty = [];
      for (var c1 = 0; c1 < nc; c1++) { ata.push(new Array(nc).fill(0)); aty.push(0); }
      for (var r = 0; r < M.length; r++) {
        for (var c2 = 0; c2 < nc; c2++) {
          aty[c2] += M[r][c2] * y[r];
          for (var c3 = 0; c3 < nc; c3++) ata[c2][c3] += M[r][c2] * M[r][c3];
        }
      }
      for (var c4 = 0; c4 < nc; c4++) ata[c4][c4] += 1e-8;
      for (var col = 0; col < nc; col++) {
        var piv = col;
        for (var rr = col + 1; rr < nc; rr++) {
          if (Math.abs(ata[rr][col]) > Math.abs(ata[piv][col])) piv = rr;
        }
        if (piv !== col) {
          var tmp = ata[piv]; ata[piv] = ata[col]; ata[col] = tmp;
          var t2 = aty[piv]; aty[piv] = aty[col]; aty[col] = t2;
        }
        var dd = ata[col][col];
        if (Math.abs(dd) < 1e-12) continue;
        for (var r2 = col + 1; r2 < nc; r2++) {
          var f = ata[r2][col] / dd;
          if (f === 0) continue;
          for (var cc = col; cc < nc; cc++) ata[r2][cc] -= f * ata[col][cc];
          aty[r2] -= f * aty[col];
        }
      }
      var xs = new Array(nc).fill(0);
      for (var r3 = nc - 1; r3 >= 0; r3--) {
        var s2 = aty[r3];
        for (var cc2 = r3 + 1; cc2 < nc; cc2++) s2 -= ata[r3][cc2] * xs[cc2];
        xs[r3] = Math.abs(ata[r3][r3]) < 1e-12 ? 0 : s2 / ata[r3][r3];
      }
      return xs;
    }
  }

  /**
   * P14 组合预测：五个候选（Holt-Winters / Holt / SES / 季节朴素 / 漂移朴素）取中位数。
   * 中位数比加权平均更稳 —— 这是 M4 之后被反复验证的结论。
   */
  function solCombination(history, horizon, ctx) {
    var m = (ctx && ctx.season > 1) ? ctx.season : 1;

    function ses(hist, alpha, h) {
      var l = hist[0];
      for (var i = 1; i < hist.length; i++) l = alpha * hist[i] + (1 - alpha) * l;
      var o = []; for (var j = 0; j < h; j++) o.push(l); return o;
    }
    function holt(hist, alpha, beta, h) {
      var l = hist[0], tr = hist.length > 1 ? hist[1] - hist[0] : 0;
      for (var i = 1; i < hist.length; i++) {
        var prev = l;
        l = alpha * hist[i] + (1 - alpha) * (l + tr);
        tr = beta * (l - prev) + (1 - beta) * tr;
      }
      var o = []; for (var j = 0; j < h; j++) o.push(l + (j + 1) * tr); return o;
    }
    function seasNaive(hist, h) {
      var T = hist.length - 1, o = [];
      for (var j = 0; j < h; j++) {
        var hh = j + 1;
        var lag = m * Math.ceil(hh / m);
        var idx = T + hh - lag;
        o.push(idx >= 0 ? hist[idx] : hist[0]);
      }
      return o;
    }
    function driftNaive(hist, h) {
      var last = hist[hist.length - 1];
      var sl = hist.length > 1 ? (hist[hist.length - 1] - hist[0]) / (hist.length - 1) : 0;
      var o = []; for (var j = 0; j < h; j++) o.push(last + (j + 1) * sl); return o;
    }
    function hwAdditive(hist, h, alpha, beta, gamma) {
      var len = hist.length;
      if (m <= 1 || len < 2 * m) return null;
      var l = 0, tr = 0, s = [];
      for (var i = 0; i < m; i++) { s.push(hist[i]); l += hist[i]; }
      l /= m;
      tr = (hist[m] - hist[0]) / m;
      for (var t = 1; t < len; t++) {
        var ph = t % m, prev = l;
        l = alpha * (hist[t] - s[ph]) + (1 - alpha) * (l + tr);
        tr = beta * (l - prev) + (1 - beta) * tr;
        s[ph] = gamma * (hist[t] - l) + (1 - gamma) * s[ph];
      }
      var o = [];
      for (var j = 0; j < h; j++) o.push(l + (j + 1) * tr + s[(len + j) % m]);
      return o;
    }

    var members = [];
    var hw = hwAdditive(history, horizon, 0.3, 0.05, 0.3);
    if (hw) members.push(hw);
    members.push(holt(history, 0.3, 0.1, horizon));
    members.push(ses(history, 0.3, horizon));
    members.push(seasNaive(history, horizon));
    members.push(driftNaive(history, horizon));

    var out = [];
    for (var h = 0; h < horizon; h++) {
      var col = [];
      for (var c = 0; c < members.length; c++) col.push(members[c][h]);
      col.sort(function (u, v) { return u - v; });
      var mid = col.length >> 1;
      out.push(col.length % 2 ? col[mid] : (col[mid - 1] + col[mid]) / 2);
    }
    return out;
  }

  /**
   * P16 分位数备货带：季节朴素（典型日曲线）+ 残差经验 95 分位上沿。
   * 点预测冠军（季节朴素）只是残差的中位数；容量规划需要分布的上沿。
   */
  function solQuantileBand(history, horizon, ctx) {
    var m = ctx.season > 1 ? ctx.season : 24;
    var TAU = 0.95;
    var WIN = 360;
    var n = history.length;
    var res = [];
    for (var i = m; i < n; i++) res.push(history[i] - history[i - m]);   // 一步季节朴素残差
    var src = res.length > WIN ? res.slice(res.length - WIN) : res;
    var a = src.slice().sort(function (x, y) { return x - y; });
    var pos = TAU * (a.length - 1);
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    var q = lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);   // 线性插值经验分位数
    var out = [];
    for (var h = 0; h < horizon; h++) out.push(history[n - m + h] + q);  // 典型日曲线 + 安全余量
    return out;
  }

  /**
   * P15 DLinear：趋势 / 季节分解，两条分支各做一次线性映射。
   * 论文里那两层是训练出来的，这里用最小二乘在历史窗口上拟合等价映射。
   */
  function solDLinear(history, horizon, ctx) {
    var n = history.length;
    var m = (ctx && ctx.season > 1) ? ctx.season : 1;
    var L = Math.min(2 * m, n);
    var i, j;

    /** 列主元高斯消元解 A x = b。 */
    function gauss(A, rhs) {
      var nc = rhs.length;
      var M = [], v = [];
      for (i = 0; i < nc; i++) { M.push(A[i].slice()); v.push(rhs[i]); }
      for (var col = 0; col < nc; col++) {
        var piv = col;
        for (var r = col + 1; r < nc; r++) {
          if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        }
        if (piv !== col) {
          var t1 = M[piv]; M[piv] = M[col]; M[col] = t1;
          var t2 = v[piv]; v[piv] = v[col]; v[col] = t2;
        }
        var dd = M[col][col];
        if (Math.abs(dd) < 1e-14) continue;
        for (var r2 = col + 1; r2 < nc; r2++) {
          var f = M[r2][col] / dd;
          if (f === 0) continue;
          for (var c = col; c < nc; c++) M[r2][c] -= f * M[col][c];
          v[r2] -= f * v[col];
        }
      }
      var xs = new Array(nc).fill(0);
      for (var r3 = nc - 1; r3 >= 0; r3--) {
        var s = v[r3];
        for (var c2 = r3 + 1; c2 < nc; c2++) s -= M[r3][c2] * xs[c2];
        xs[r3] = Math.abs(M[r3][r3]) < 1e-14 ? 0 : s / M[r3][r3];
      }
      return xs;
    }

    /**
     * 拟合「长度为 Lv 的窗口 → 未来 hz 步」的线性映射（ridge 正则的最小二乘）。
     * @returns {Array|null} W[k] 是第 k 步的权重向量；样本不足时返回 null
     */
    function fitMap(seq, Lv, hz) {
      var rows = seq.length - Lv - hz + 1;
      if (rows < Lv + 2) return null;
      var A = [], B = [];
      for (i = 0; i < Lv; i++) { A.push(new Array(Lv).fill(0)); B.push(new Array(hz).fill(0)); }
      for (var r = 0; r < rows; r++) {
        var x = seq.slice(r, r + Lv);
        var y = seq.slice(r + Lv, r + Lv + hz);
        for (var p1 = 0; p1 < Lv; p1++) {
          for (var p2 = 0; p2 < Lv; p2++) A[p1][p2] += x[p1] * x[p2];
          for (var c = 0; c < hz; c++) B[p1][c] += x[p1] * y[c];
        }
      }
      for (var q = 0; q < Lv; q++) A[q][q] += 1e-6;
      var W = [];
      for (var k = 0; k < hz; k++) {
        var col = [];
        for (var q2 = 0; q2 < Lv; q2++) col.push(B[q2][k]);
        W.push(gauss(A, col));
      }
      return W;
    }

    // 1) 趋势 = 居中移动平均（窗口 2m+1，边界用可用点）
    var ww = 2 * m + 1;
    var trend = [];
    for (i = 0; i < n; i++) {
      var lo = Math.max(0, i - m), hi = Math.min(n - 1, i + m);
      var s = 0;
      for (j = lo; j <= hi; j++) s += history[j];
      trend.push(s / (hi - lo + 1));
    }
    // 2) 季节 = 残差
    var seas = [];
    for (i = 0; i < n; i++) seas.push(history[i] - trend[i]);

    var Wt = fitMap(trend, L, horizon);
    var Ws = fitMap(seas, L, horizon);
    if (!Wt || !Ws) {
      // 样本不足以拟合映射：退化为「重复最后一个观测值」，至少不会崩
      var fb = [];
      for (var h = 0; h < horizon; h++) fb.push(history[n - 1]);
      return fb;
    }

    var lastT = trend.slice(n - L);
    var lastS = seas.slice(n - L);
    var out = [];
    for (var h2 = 0; h2 < horizon; h2++) {
      var vt = 0, vs = 0;
      for (var q3 = 0; q3 < L; q3++) { vt += Wt[h2][q3] * lastT[q3]; vs += Ws[h2][q3] * lastS[q3]; }
      out.push(vt + vs);
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

      /* 零基础手把手带做（problem.js 会渲染成折叠面板；只给第一题配，之后要自己飞） */
      guide: [
        {
          title: '先跑一遍，认识 57 分',
          text: '什么代码都不用写。编辑器里的模板已经是一个能跑的朴素法（drift 是 0）。点右上角「运行」，' +
            '看结果面板：verdict 是 WA，分数 57，ratio 恰好 1.00 —— 因为你照抄最后值，对照组 naive 也是照抄最后值，打平不算赢。'
        },
        {
          title: '看图，找到差在哪',
          text: '回看上方数据预览图：右边浅色高亮带是藏起来的 12 个月真值，它们整体在往上爬；' +
            '而朴素法的预测是一条水平线。差距就是「每个月抬升了多少」—— 这就是趋势（drift，漂移）。'
        },
        {
          title: '把漂移补上（复制这段）',
          text: '用最近一年（12 个月）的平均水平和上一年平均水平的差，换算成「每步抬升量」。' +
            '把编辑器里的 TODO 那几行换成下面这段（或整段替换函数）：',
          code: [
            'function predict(history, horizon, ctx) {',
            '  var n = history.length;',
            '  var m = ctx.season > 1 ? ctx.season : 12;   // 周期：月度数据就是 12',
            '',
            '  var last = history[n - 1];                  // 朴素法的起点：最后一个值',
            '',
            '  // 最近一个周期的总和 与 上一个周期的总和',
            '  var cur = 0, prev = 0;',
            '  for (var i = 0; i < m; i++) {',
            '    cur  += history[n - m + i];               // 最后 m 个数之和',
            '    prev += history[n - 2 * m + i];           // 再往前 m 个数之和',
            '  }',
            '  // 两个周期总和的差 = m 步里一共抬升了 (cur-prev) ，',
            '  // 除以 m 是"平均每步差"、再除以 m 是换算回"每步抬升"——所以是 m*m',
            '  var drift = (cur - prev) / (m * m);',
            '',
            '  var out = [];                               // 从 last 出发，每步抬 drift',
            '  for (var h = 1; h <= horizon; h++) {',
            '    out.push(last + drift * h);',
            '  }',
            '  return out;                                 // 长度正好是 horizon',
            '}'
          ].join('\n')
        },
        {
          title: '运行 → 提交 → 解锁题解',
          text: '先点「运行」：大约 73 分、verdict AC。再点「提交判题」正式记分，通过后「查看题解」按钮亮起。' +
            '然后自己动手玩：把 drift 乘 0.5 或 1.5 再跑，看分数怎么掉 —— 你会直观感受到「过犹不及」。'
        }
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
        'α 建议 0.35~0.5，β 建议 0.05~0.15；β 太大容易把噪声当成趋势。',
        '数学补给：两条更新式都是[[term:weighted-average|加权平均]]——新信息占 α/β、旧状态占 1−α/1−β；trend 项估计的就是直线的[[term:derivative|斜率]]。'
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
        '注意不要写成递归：`out[h]` 不能依赖 `out[h-1]`，否则就不是直接法了。',
        '数学补给：第一步的直线拟合是[[term:least-squares|最小二乘法]]（[[term:linear-regression|线性回归]]）；分母 n·Σx²−(Σx)² 趋近 0 时把斜率置 0，防止除零。'
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
    },

    /* ---------------- P10 ---------------- */
    {
      id: 'p10-theta',
      index: 10,
      title: 'Theta 方法：两个笨模型拼赢一个聪明模型',
      difficulty: '提高',
      tags: ['Theta', 'M3 冠军', '组合', '去季节'],
      points: 100,
      passScore: 60,
      dataset: 'retail',
      mode: 'holdout',
      horizon: 12,
      metric: 'mse',
      baselines: ['naive', 'seasonal_naive', 'mean', 'linear_trend'],
      threshold: 0.7,
      passRate: 24,

      statement: [
        '### 背景',
        '',
        'Theta 方法是 M3 竞赛的冠军方法（Assimakopoulos & Nikolopoulos，',
        '*International Journal of Forecasting*，2000）。它的思路朴素得几乎不像一个「模型」：',
        '',
        '把去季节后的序列拆成两条 theta 线，各取一半相加：',
        '',
        '- **θ = 0 线**：对时间做最小二乘的直线，负责长期趋势；',
        '- **θ = 2 线**：简单指数平滑（SES）的末端水平，负责短期状态。',
        '',
        '两个极简模型各管一头，拼起来就能在大量月度 / 季度序列上打赢任何单一基线。',
        '这道题要你完整实现一遍：去季节 → 两条线 → 0.5 / 0.5 组合 → 加回季节。',
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
        '实现 `predict`，用 Theta 方法给出未来 12 周预测。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`seasonal_naive`、`mean`、`linear_trend`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.7` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '本题真正的对手是 `mean`：它完全放弃趋势，但在这种振幅不大的序列上反而很稳。',
        '想赢过它，两条线都必须真的实现 —— 只留 θ=0 线就是一条纯直线，赢不了。',
        '',
        '所以本题的关键是：**季节项要按相位求均值并归一（让 52 个相位的季节项之和为 0），',
        'θ=2 线要用 SES 的末端水平而不是又一次最小二乘**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 144 个历史周零售额（万元），`ctx.season = 52`。',
      outputSpec: '`number[]` —— 长度必须为 12。',

      hints: [
        '先跑一次模板：它只输出了 θ=0 线（纯直线 + 季节项），θ=2 线完全没实现。',
        '季节项不要直接拿残差均值用 —— 52 个相位的均值加起来通常不为 0，会让整体水平被抬高或压低。先求平均再整体减去这个平均。',
        'θ=2 线是指数平滑：`level = a * d[t] + (1 - a) * level`，取循环结束时的 `level`，不要再拟合一次直线。',
        '外推时两条线用的是同一个未来时刻 `t = n + h`，季节项也用同一个时刻的 `t % m` —— 三者必须对齐。',
        '数学补给：θ=0 线的斜率来自[[term:least-squares|最小二乘法]]；「两条 θ 线组合」本质上是对序列做一次[[term:weighted-average|加权平均]]。'
      ],

      solution: toPredictSource(solTheta),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 1;',
        '  var i;',
        '',
        '  // 1) 全局最小二乘直线',
        '  var sx = 0, sy = 0, sxx = 0, sxy = 0;',
        '  for (i = 0; i < n; i++) {',
        '    sx += i; sy += history[i]; sxx += i * i; sxy += i * history[i];',
        '  }',
        '  var den = n * sxx - sx * sx;',
        '  var slope = Math.abs(den) < 1e-12 ? 0 : (n * sxy - sx * sy) / den;',
        '  var intercept = (sy - slope * sx) / n;',
        '',
        '  // 2) 相位残差剖面（加性季节项）',
        '  var sum = [], cnt = [];',
        '  for (i = 0; i < m; i++) { sum.push(0); cnt.push(0); }',
        '  for (i = 0; i < n; i++) {',
        '    var p = i % m;',
        '    sum[p] += history[i] - (intercept + slope * i);',
        '    cnt[p]++;',
        '  }',
        '  var season = [];',
        '  for (i = 0; i < m; i++) season.push(cnt[i] > 0 ? sum[i] / cnt[i] : 0);',
        '',
        '  // TODO: 季节项还没归一化。52 个相位的均值加起来一般不为 0，',
        '  //       会把整体水平顶高或压低。请先求 season 的平均值，再整体减掉它。',
        '',
        '  // TODO: θ=2 线还没实现。请在去季节序列上做 SES（a 取 0.2），',
        '  //       取循环结束时的末端水平 level。',
        '',
        '  // 3) 目前只有 θ=0 线：纯直线 + 季节项',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    var t = n + h;',
        '    out.push(intercept + slope * t + season[t % m]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P11 ---------------- */
    {
      id: 'p11-ar-yw',
      index: 11,
      title: 'AR(p) 与 Yule-Walker：不训练的闭式自回归',
      difficulty: '挑战',
      tags: ['自回归', 'Box-Jenkins', 'Levinson-Durbin', '闭式解'],
      points: 100,
      passScore: 60,
      dataset: 'sunspot',
      mode: 'holdout',
      horizon: 8,
      metric: 'mse',
      baselines: ['naive', 'mean', 'linear_trend'],
      threshold: 0.75,
      passRate: 18,

      statement: [
        '### 背景',
        '',
        'AR(p) 是 Box-Jenkins 传统（1970）的核心构件：把当前值写成过去 p 个值的线性组合。',
        '它的参数不需要迭代优化 —— 自协方差满足一组 **Yule-Walker 方程**：',
        '',
        '```',
        'Γ_p · φ = γ_p',
        '```',
        '',
        '其中 `Γ_p` 是由自协方差组成的 Toeplitz 矩阵，`γ_p` 是滞后 1..p 的自协方差。',
        '这个方程可以用 **Levinson-Durbin 递推**在 O(p²) 内精确解出，全程闭式。',
        '',
        '太阳黑子数是最经典的 AR 适用序列：有明显的自相关和约 11 年的周期，',
        '而它又是年度数据（`ctx.season = 11`，不要指望季节朴素法）。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`sunspot`（太阳黑子相对数，年度）',
        '- 长度：300 点，季节周期 11',
        '- 形态：均值约 55，标准差约 45，含约 11 年周期与明显的自相关',
        '- 评估方式：留出法。前 292 点作为 `history`，最后 8 年作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`：估自协方差 → Levinson-Durbin 解 Yule-Walker → 多步递推预测 8 年。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`mean`、`linear_trend`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.75` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '这里最强的对手是 `mean`：太阳黑子长期围绕一个水平波动，均值预测相当稳。',
        'AR(p) 要赢，必须真的把自相关结构利用起来 —— 只套个公式但解错了方程是赢不了的。',
        '',
        '所以本题的关键是：**解的是 Toeplitz 方程，不是把自相关系数直接当 AR 系数**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 292 个年度太阳黑子数，`ctx.season = 11`。',
      outputSpec: '`number[]` —— 长度必须为 8，且不含 NaN / Infinity。',

      hints: [
        '先跑一次模板：它把自相关系数 γ(k)/γ(0) 直接当成 AR 系数用，这是最常见的错误。',
        '正确的做法是解方程：Γ_p φ = γ_p。Γ_p 的第 (i,j) 个元素是 γ(|i-j|)，右边是 γ(1..p)。',
        'Levinson-Durbin 递推：从一阶开始，每阶用反射系数把上一阶的系数更新到本阶，同时更新预测误差方差。',
        '多步预测要把刚预测出来的值回填进历史再预测下一步（`ext` 数组边算边推）。',
        '如果 γ(0) 接近 0（序列几乎是常数），直接返回均值，不要除零。',
        '数学补给：Γφ=γ 就是一个[[term:linear-system|线性方程组]]；Γ 沿对角线取值相同（Toeplitz [[term:matrix|矩阵]]），Levinson-Durbin 利用这点把 O(p³) 的消元降到 O(p²)。'
      ],

      solution: toPredictSource(solArYW),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var p = Math.min(10, Math.max(1, Math.floor(n / 4)));',
        '  var i, k;',
        '',
        '  var mu = 0;',
        '  for (i = 0; i < n; i++) mu += history[i];',
        '  mu /= n;',
        '',
        '  var x = [];',
        '  for (i = 0; i < n; i++) x.push(history[i] - mu);',
        '',
        '  // 1) 自协方差 γ(0..p)',
        '  var g = [];',
        '  for (k = 0; k <= p; k++) {',
        '    var acc = 0;',
        '    for (i = 0; i + k < n; i++) acc += x[i] * x[i + k];',
        '    g.push(acc / n);',
        '  }',
        '  if (!(g[0] > 1e-12)) {',
        '    var flat = [];',
        '    for (i = 0; i < horizon; i++) flat.push(mu);',
        '    return flat;',
        '  }',
        '',
        '  // TODO: 这里直接把自相关系数当成 AR 系数 —— 错了。',
        '  //       自相关 ρ(k) = γ(k)/γ(0) 不是 AR 系数 φ。',
        '  //       请用 Levinson-Durbin 递推解 Yule-Walker 方程 Γ_p φ = γ_p。',
        '  var phi = [];',
        '  for (k = 0; k <= p; k++) phi.push(g[k] / g[0]);',
        '',
        '  // 2) 多步递推',
        '  var ext = x.slice();',
        '  for (var h = 1; h <= horizon; h++) {',
        '    var v = 0;',
        '    for (i = 1; i <= p; i++) v += phi[i] * ext[ext.length - i];',
        '    ext.push(v);',
        '  }',
        '',
        '  var out = [];',
        '  for (var j = 0; j < horizon; j++) out.push(mu + ext[n + j]);',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P12 ---------------- */
    {
      id: 'p12-croston',
      index: 12,
      title: '间歇需求：把需求量与需求频率分开估计',
      difficulty: '提高',
      tags: ['间歇需求', '零膨胀', '库存', 'Croston', 'TSB'],
      points: 100,
      passScore: 60,
      dataset: 'intermittent',
      mode: 'holdout',
      horizon: 12,
      metric: 'mae',
      baselines: ['naive', 'mean', 'seasonal_naive', 'moving_average'],
      threshold: 0.85,
      passRate: 22,

      statement: [
        '### 背景',
        '',
        '间歇需求（intermittent demand）是指「大量月份完全没有需求、偶尔来一单」的序列，',
        '典型如备件、慢销品、B2B 订单。这类序列的麻烦在于：**均值被大量零稀释，',
        '方差被偶发大单放大**，任何「把整段历史一锅平滑」的做法都只能给出一个含糊的中间值。',
        '',
        'Croston（1972）的做法是把两件事分开估计：',
        '',
        '- **非零需求量** `z`：只在有需求的月份更新；',
        '- **需求间隔** `p`：只在有需求的月份更新「距上次需求过了多久」。',
        '',
        '需求率 = `z / p`。Syntetos & Boylan（*IJF*，2005）指出 Croston 对需求率',
        '系统性偏高，乘以修正因子 `(1 - α/2)` 即 SBA。Teunter、Syntetos & Babai',
        '（*IJPE*，2011）的 TSB 则换成直接平滑「本月是否有需求」的概率 `q`，',
        '预测 `q · z`，对需求频率的变化更敏感 —— 本题参考解用的就是 TSB。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`intermittent`（月度备件需求，单位：件）',
        '- 长度：120 个月（10 年）',
        '- 形态：约半数月份为零；有需求的月份 20–180 件；随备件进入服役中后期，',
        '  需求频率由约 18% 升至约 85%、单次量级放大约 1.2 倍；偶发 3–5 倍大单',
        '- 评估方式：留出法。前 108 个月作为 `history`，最后 12 个月作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`：把「需求量」与「需求频率」分开估计，输出未来 12 个月的需求率。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MAE**（间歇需求用 MAE 比 MSE 合理，不受偶发大单支配）',
        '- 对照基线：`naive`、`mean`、`seasonal_naive`、`moving_average`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.85` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '四个基线会以四种方式失败：',
        '',
        '- `naive`：重复最后一个月的值 —— 那个值要么是 0（灾难性低估），要么是一笔偶发大单（严重高估）；',
        '- `seasonal_naive`：滞后 12 个月，把一年前的随机波动原样搬过来；',
        '- `moving_average`：对原序列取近 12 个月均值，被大量零稀释；',
        '- `mean`：全局均值，跟不上服役期内的上升。',
        '',
        '一句实话：本题并不阻止你用别的办法过关。服役中后期需求变密之后，',
        '「用很小的 α 直接平滑原序列」也能打到阈值附近 —— 这是间歇需求文献里',
        '被反复验证过的现象（Kourentzes，*IJF*，2014：平滑法在不少真实序列上',
        '并不输给 Croston 家族）。值得你自己试一把，再想清楚它为什么追了上来。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 108 个月备件需求（件），`ctx.season = 12`。',
      outputSpec: '`number[]` —— 长度必须为 12，元素为有限数值。',

      hints: [
        '模板用的是「重复最近一次非零需求」—— 把一笔偶发大单当常态，也完全没用到需求频率。',
        'Croston 的循环里，遇到 0 只累加间隔 `since`，不碰 `z`；遇到非零值才同时更新 `z` 和 `p`。',
        '`p` 的初值是「从序列开头到第一个非零需求的月数」，不是 1。',
        'TSB 更直接：单独平滑「本月有需求」的概率 `q`（初值 1，β 取 0.1），预测 `q · z`。',
        '如果整个历史一个非零值都没有，返回全 0，不要除零。'
      ],

      solution: toPredictSource(solTsb),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '',
        '  // TODO: 这里只是「重复最近一次非零需求」—— 把一笔偶发大单当成了常态，',
        '  //       也完全没有利用需求频率。请把「需求量」与「需求频率/间隔」分开估计。',
        '  var last = 0;',
        '  for (var i = 0; i < n; i++) {',
        '    if (history[i] > 0) last = history[i];',
        '  }',
        '',
        '  var out = [];',
        '  for (var j = 0; j < horizon; j++) out.push(last);',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P13 ---------------- */
    {
      id: 'p13-harmonic',
      index: 13,
      title: '周期图 + 谐波回归：让数据自己说出周期',
      difficulty: '提高',
      tags: ['频域', '周期图', '谐波回归', '最小二乘'],
      points: 100,
      passScore: 60,
      dataset: 'temperature',
      mode: 'holdout',
      horizon: 24,
      metric: 'mse',
      baselines: ['seasonal_naive', 'naive', 'mean', 'linear_trend'],
      threshold: 0.75,
      passRate: 20,

      statement: [
        '### 背景',
        '',
        '谐波回归的思路：把序列写成「截距 + 线性趋势 + 若干组 sin/cos」的形式，',
        '然后用最小二乘解出系数。周期**不必事先知道** —— 可以先用**周期图**',
        '（离散傅里叶变换的功率谱）从数据里把主导频率找出来。',
        '',
        '这是所有频域深度模型（FEDformer、TimesNet 等）的思想源头：',
        '先估计周期，再在周期结构上建模。本题用最经典的谱分析把它完整走一遍。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`temperature`（日平均气温，单位：℃）',
        '- 长度：730 点（2 年），季节周期 365',
        '- 形态：强年周期（正弦型）+ 缓慢上升趋势 + 噪声',
        '- 评估方式：留出法。前 706 点作为 `history`，最后 24 天作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`：算周期图 → 取 top-3 周期 → 构造设计矩阵 → 最小二乘 → 外推 24 天。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`seasonal_naive`、`naive`、`mean`、`linear_trend`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.75` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '这条序列的形状接近正弦，是谐波回归的理想场景：',
        '两三组谐波就能把年周期拟合得很准，而 `seasonal_naive` 只能生硬地重复去年同一天。',
        '',
        '所以本题的关键是：**周期要从功率谱里挑出来，而不是照抄 `ctx.season`；',
        '设计矩阵要包含截距和线性趋势，谐波只是它的补充**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 706 个日平均气温（℃），`ctx.season = 365`。',
      outputSpec: '`number[]` —— 长度必须为 24。',

      hints: [
        '先跑一次模板：它把周期硬编码成 12，且只用一组谐波 —— 这条序列的真周期是 365。',
        '周期图的做法：先减掉线性趋势，再对每个候选周期 P 算 `Σ d[t]·cos(2πt/P)` 与 `Σ d[t]·sin(2πt/P)`，功率 = (实部² + 虚部²) / n。',
        '取功率最大的前 3 个周期，但要把彼此成倍数关系的去掉（同一个物理周期的谐波）。',
        '解最小二乘要自己写正规方程 + 高斯消元；对角上加 1e-8 的 ridge 防止奇异。',
        '外推时用的是未来的时刻 `t = n + h`，设计矩阵的列要和外推时的列完全一致。',
        '数学补给：第 2 步在解[[term:least-squares|最小二乘法]]的正规方程（[[term:transpose|转置]]矩阵 Aᵀ·A，加 1e-8 防奇异）；cos/sin 基来自[[term:fourier|傅里叶分解]]。'
      ],

      solution: toPredictSource(solHarmonic),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var i, j;',
        '',
        '  // TODO: 周期被硬编码成 12，且只用一组谐波。',
        '  //       请先用周期图从数据里估出 top-3 周期，再用多组谐波做最小二乘。',
        '  var P = 12;',
        '',
        '  var ncol = 4;   // 截距 + 时间 + 一组 cos/sin',
        '  var A = [];',
        '  for (i = 0; i < n; i++) {',
        '    var w = 2 * Math.PI * i / P;',
        '    A.push([1, i, Math.cos(w), Math.sin(w)]);',
        '  }',
        '',
        '  // 正规方程 + 高斯消元（列主元）',
        '  function lstsq(M, y, nc) {',
        '    var ata = [], aty = [];',
        '    for (var c1 = 0; c1 < nc; c1++) { ata.push(new Array(nc).fill(0)); aty.push(0); }',
        '    for (var r = 0; r < M.length; r++) {',
        '      for (var c2 = 0; c2 < nc; c2++) {',
        '        aty[c2] += M[r][c2] * y[r];',
        '        for (var c3 = 0; c3 < nc; c3++) ata[c2][c3] += M[r][c2] * M[r][c3];',
        '      }',
        '    }',
        '    for (var c4 = 0; c4 < nc; c4++) ata[c4][c4] += 1e-8;',
        '    for (var col = 0; col < nc; col++) {',
        '      var piv = col;',
        '      for (var rr = col + 1; rr < nc; rr++) {',
        '        if (Math.abs(ata[rr][col]) > Math.abs(ata[piv][col])) piv = rr;',
        '      }',
        '      if (piv !== col) {',
        '        var tmp = ata[piv]; ata[piv] = ata[col]; ata[col] = tmp;',
        '        var t2 = aty[piv]; aty[piv] = aty[col]; aty[col] = t2;',
        '      }',
        '      var dd = ata[col][col];',
        '      if (Math.abs(dd) < 1e-12) continue;',
        '      for (var r2 = col + 1; r2 < nc; r2++) {',
        '        var f = ata[r2][col] / dd;',
        '        if (f === 0) continue;',
        '        for (var cc = col; cc < nc; cc++) ata[r2][cc] -= f * ata[col][cc];',
        '        aty[r2] -= f * aty[col];',
        '      }',
        '    }',
        '    var xs = new Array(nc).fill(0);',
        '    for (var r3 = nc - 1; r3 >= 0; r3--) {',
        '      var s2 = aty[r3];',
        '      for (var cc2 = r3 + 1; cc2 < nc; cc2++) s2 -= ata[r3][cc2] * xs[cc2];',
        '      xs[r3] = Math.abs(ata[r3][r3]) < 1e-12 ? 0 : s2 / ata[r3][r3];',
        '    }',
        '    return xs;',
        '  }',
        '',
        '  var coef = lstsq(A, history, ncol);',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    var t = n + h;',
        '    var w2 = 2 * Math.PI * t / P;',
        '    out.push(coef[0] + coef[1] * t + coef[2] * Math.cos(w2) + coef[3] * Math.sin(w2));',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P14 ---------------- */
    {
      id: 'p14-combination',
      index: 14,
      title: '组合预测：别把赌注押在一个模型上',
      difficulty: '提高',
      tags: ['组合', '中位数', '稳健', 'Bates-Granger'],
      points: 100,
      passScore: 60,
      dataset: 'gmv',
      mode: 'holdout',
      horizon: 12,
      metric: 'mse',
      baselines: ['naive', 'seasonal_naive', 'mean', 'linear_trend'],
      threshold: 0.80,
      passRate: 30,

      statement: [
        '### 背景',
        '',
        'Bates & Granger（1969）发现：多个模型的误差往往不完全相关，',
        '把它们组合起来，方差会下降。这是预测领域最稳的一条经验规律 ——',
        '**组合几乎从不比最好的单模型差太多，却极少灾难性翻车**。M4 竞赛（*IJF*，2020）',
        '再次确认：冠军方案的核心就是组合，而不是某个更花的模型。',
        '',
        '加权方式上，简单平均和**中位数**往往比「按误差加权」更稳：',
        '权重在短样本上估计不稳，一个偶然表现好的模型就会垄断权重。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`gmv`（日成交额 GMV，单位：万元）',
        '- 长度：160 点，季节周期 7',
        '- 形态：加速增长（二次趋势）+ 弱周周期 + 随水平放大的噪声 + 大促尖峰',
        '- 评估方式：留出法。前 148 点作为 `history`，最后 12 天作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`：内部实现至少 4 个候选预测器，取它们的中位数作为输出。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`seasonal_naive`、`mean`、`linear_trend`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.80` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '这条序列同时有二次趋势、周周期、放大的噪声和偶发大促尖峰 —— ',
        '没有任何单一模型能同时处理好这四件事，这正是组合的用武之地。',
        '',
        '所以本题的关键是：**候选要真的多样化（趋势型 / 水平型 / 季节型都要有），',
        '然后取中位数，而不是自己再发明一个模型**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 148 个日成交额（万元），`ctx.season = 7`。',
      outputSpec: '`number[]` —— 长度必须为 12。',

      hints: [
        '先跑一次模板：它只组合了两个成员（朴素 + 季节朴素），成员太少，抗不住这条序列的二次趋势。',
        '候选至少要覆盖三类：水平型（SES）、趋势型（Holt 或带漂移的朴素）、季节型（季节朴素或 Holt-Winters）。',
        '中位数的取法：把该步所有候选值排序，偶数个取中间两个的平均。',
        '不要用「按历史误差加权」—— 权重在短样本上不稳，本题取中位数就够。',
        'Holt-Winters 的季节项要按 `t % m` 存取，初值可以用前 m 个点。'
      ],

      solution: toPredictSource(solCombination),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 1;',
        '  var i;',
        '',
        '  // TODO: 只组合了两个成员，且都偏「水平 / 季节」，没有趋势型候选。',
        '  //       请至少补上 Holt 或带漂移的朴素，再取全部候选的中位数。',
        '  var naive = [];',
        '  for (i = 0; i < horizon; i++) naive.push(history[n - 1]);',
        '',
        '  var seas = [];',
        '  for (i = 0; i < horizon; i++) {',
        '    var hh = i + 1;',
        '    var lag = m * Math.ceil(hh / m);',
        '    var idx = n - 1 + hh - lag;',
        '    seas.push(idx >= 0 ? history[idx] : history[0]);',
        '  }',
        '',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    out.push((naive[h] + seas[h]) / 2);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },

    /* ---------------- P15 ---------------- */
    {
      id: 'p15-dlinear',
      index: 15,
      title: 'DLinear：一层线性打败一堆 Transformer',
      difficulty: '挑战',
      tags: ['分解', '线性模型', 'AAAI 2023', '最小二乘'],
      points: 100,
      passScore: 60,
      dataset: 'electricity',
      mode: 'holdout',
      horizon: 24,
      metric: 'mse',
      baselines: ['naive', 'seasonal_naive', 'mean', 'linear_trend', 'moving_average'],
      threshold: 0.7,
      passRate: 16,

      statement: [
        '### 背景',
        '',
        'Zeng 等人在 *AAAI 2023* 的论文《Are Transformers Effective for Time Series Forecasting?》',
        '里给出一个反直觉结论：把序列分解成趋势与季节两部分，各接一个**单层线性**映射，',
        '就能在多个长期预测基准上打败 Informer / Autoformer 这一整代 Transformer。',
        '',
        '作者的解释是：时序的「顺序」信息会被自注意力打乱，而线性层天然保序。',
        '这个模型后来被称为 **DLinear**，它的两个分支是：',
        '',
        '- `trend = MovingAverage(y)`，`seasonal = y - trend`；',
        '- 每条分支各做一个「从长度为 L 的窗口到 horizon 步」的线性映射，输出相加。',
        '',
        '论文里那两层是**训练**出来的。本题不要求你训练 —— ',
        '用最小二乘在历史的重叠窗口上拟合一个等价的线性映射即可。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`electricity`（小时用电负荷，单位：MW）',
        '- 长度：720 点，季节周期 24（日内）',
        '- 形态：趋势 + 24 小时周期 + 噪声',
        '- 评估方式：留出法。前 696 点作为 `history`，最后 24 小时作为测试集',
        '',
        '### 任务',
        '',
        '实现 `predict`：居中移动平均分解 → 两条分支各拟合一个线性映射 → 相加输出 24 步。',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**MSE**',
        '- 对照基线：`naive`、`seasonal_naive`、`mean`、`linear_trend`、`moving_average`，取误差最小者',
        '- `ratio <= 0.5` 满分，`ratio = 0.7` 恰好 60 分，`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '`seasonal_naive` 在这里已经不错（周期很规整），想大幅赢过它，',
        '必须让两条分支都真的起作用：趋势分支跟上水平变化，季节分支刻画 24 小时的形状。',
        '',
        '所以本题的关键是：**分解要用居中移动平均（窗口 `2m+1`），',
        '两条分支各解一个最小二乘，而不是只做分解后直接外推**。'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 696 个小时用电负荷（MW），`ctx.season = 24`。',
      outputSpec: '`number[]` —— 长度必须为 24。',

      hints: [
        '先跑一次模板：分解做对了，但两条分支都退化成「平移复制」，没有线性映射。',
        '居中移动平均：窗口取 `2m + 1`，第 i 点取 `[i-m, i+m]` 的均值（边界用可用点）。',
        '线性映射的拟合：对每个起点 r，输入 `seq[r .. r+L-1]`，目标 `seq[r+L .. r+L+hz-1]`，',
        '累加出 `A = XᵀX`（L×L）与 `B = XᵀY`（L×hz），对角加 1e-6 的 ridge。',
        '然后对每个预测步 k 解一个 L 元线性方程组 —— 写一个列主元高斯消元，别用迭代法。',
        '历史长度不足以构造训练窗口时，退化为「重复最后一个观测值」，不要报错。',
        '数学补给：Linear 层就是一次[[term:matrix-multiply|矩阵乘法]]（权重矩阵 × 输入[[term:vector|向量]]）；这里的权重用[[term:least-squares|最小二乘法]]在历史窗口上直接解出。'
      ],

      solution: toPredictSource(solDLinear),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  var n = history.length;',
        '  var m = ctx.season > 1 ? ctx.season : 1;',
        '  var L = Math.min(2 * m, n);',
        '  var i, j;',
        '',
        '  // 1) 居中移动平均 → 趋势',
        '  var trend = [];',
        '  for (i = 0; i < n; i++) {',
        '    var lo = Math.max(0, i - m), hi = Math.min(n - 1, i + m);',
        '    var s = 0;',
        '    for (j = lo; j <= hi; j++) s += history[j];',
        '    trend.push(s / (hi - lo + 1));',
        '  }',
        '',
        '  // 2) 季节 = 残差',
        '  var seas = [];',
        '  for (i = 0; i < n; i++) seas.push(history[i] - trend[i]);',
        '',
        '  // TODO: 两条分支现在都只是「平移复制」，没有线性映射。',
        '  //       请用最小二拟在历史重叠窗口上拟合 L → horizon 的映射，再外推。',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    var tIdx = (n + h) % m;',
        '    out.push(trend[n - 1] + seas[n - L + (h % L)]);',
        '  }',
        '  return out;',
        '}'
      ].join('\n')
    },
    /* ---------------- P16 ---------------- */
    {
      id: 'p16-quantile-band',
      index: 16,
      title: '分位数备货：点冠军不是分位数冠军',
      difficulty: '挑战',
      tags: ['分位数', '区间预测', '容量规划', 'pinball', '电力负荷'],
      points: 100,
      passScore: 60,
      dataset: 'electricity',
      mode: 'holdout',
      horizon: 24,
      metric: 'pinball',
      baselines: ['naive', 'seasonal_naive', 'mean', 'moving_average', 'linear_trend'],
      threshold: 0.9,
      passRate: 18,

      statement: [
        '### 背景',
        '',
        '电力调度中心要决定**明天每小时备用容量**：备少了缺电（事故 + 罚款），备多了烧钱。',
        '这类「不对称代价」的决策不能用点预测打分——**缺货与过量代价不等价**，评估要用',
        '**Pinball 损失（τ=0.95）**：实际超出你预报的量，每单位罚 0.95；实际低于你的预报，',
        '每单位只罚 0.05。直觉：你预报的是「95 分位安全容量」，把缺货概率压到约 5%。',
        '',
        '上一题（P15）的教训是「点预测冠军可以很强」；本题是它的反面——',
        '**点冠军不是分位数冠军**。季节朴素（P3）在逐点 MSE 上很强，但它本质只预测了',
        '残差的「中位水平」；95 分位备货需要把**不确定性的上沿**也叠上去。',
        '',
        '### 数据说明',
        '',
        '- 数据集：`electricity`（用电负荷，小时级，单位：MW）',
        '- 长度：720 点（30 天），日周期 24，早晚双峰 + 周末低谷 + 偶发尖峰',
        '- 评估方式：留出法。前 696 点作为 `history`，最后 24 点（明天全天）作为测试，只评测 1 次',
        '',
        SIGNATURE_MD,
        '',
        '### 评分规则',
        '',
        '- 主指标：**Pinball(τ=0.95)**（越小越好）',
        '- 对照基线：`naive` / `seasonal_naive` / `mean` / `moving_average` / `linear_trend`——',
        '  它们都是**点预测**被直接当备货水平使用，这正是要你打败的「错误做法」',
        '- 误差比 `ratio = 你的 Pinball / 最优基线 Pinball`；`ratio <= 0.5` 得 100 分，',
        '  `ratio = 0.9` 恰好 60 分（通过线），`ratio >= 2` 得 0 分',
        '',
        '### 数据形态提示',
        '',
        '昨天同一小时的负荷（季节朴素）描述了「典型明天」，但它一半概率偏低——',
        '尖峰与上行噪声全在你预报线的上方，每一点都在按 0.95 倍罚款。',
        '想一想：把历史残差（实际 − 季节朴素）排序，第 95 百分位在哪？把这段「安全余量」',
        '加到典型日曲线上会发生什么？'
      ].join('\n'),

      inputSpec: '`history: number[]` —— 696 个历史观测（MW）。',
      outputSpec: '`number[]` —— 长度必须为 24，每个元素是当小时的 95 分位备货水平（MW）。',

      hints: [
        '先交一次「季节朴素」本身（`history[n-24+h]`），看分数——它就是点冠军的下场（55 分，通过线 60）。',
        '计算一步季节朴素残差 `r_t = history[t] - history[t-24]`（从 t=24 起）。这串数就是「如果明天用典型日曲线，会错多少」的历史样本。',
        '把残差排序取 95 分位（经验分位数 + 线性插值），只取最近 360 个残差（近期误差更有代表性）。',
        '预报 = 典型日曲线 + 安全余量：`history[n-24+h] + q95`。它不再是点预测，而是「明天每小时的 95 分位容量」。'
      ],

      guide: [
        {
          title: '先看点冠军的下场',
          text: '示例模板就是季节朴素本身。点「运行」：55 分 WA（通过线 60）。' +
            '它逐点 MSE 打遍天下（P3 靠它满分），但在 τ=0.95 的备货评分里，它有一半天数在「缺货」。'
        },
        {
          title: '把误差分布晒出来',
          text: '对历史算 r_t = y_t − y_{t−24}（昨日同小时误差）。这串数就是「如果明天用典型日曲线，会错多少」的历史样本——' +
            '大部分在 0 附近，少数大正值是尖峰日，少数负值是低谷日。'
        },
        {
          title: '加上 95 分位安全余量（复制这段）',
          text: '把编辑器整个替换为下面这段：',
          code: [
            'function predict(history, horizon, ctx) {',
            '  var m = ctx.season > 1 ? ctx.season : 24;   // 日周期 24',
            '  var TAU = 0.95;                             // 95 分位（与评分口径一致）',
            '  var WIN = 360;                              // 只用最近 360 个残差',
            '  var n = history.length;',
            '  var res = [];',
            '  for (var i = m; i < n; i++) res.push(history[i] - history[i - m]);',
            '  var src = res.length > WIN ? res.slice(res.length - WIN) : res;',
            '  var a = src.slice().sort(function (x, y) { return x - y; });',
            '  var pos = TAU * (a.length - 1);',
            '  var lo = Math.floor(pos), hi = Math.ceil(pos);',
            '  var q = lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);',
            '  var out = [];',
            '  for (var h = 0; h < horizon; h++) out.push(history[n - m + h] + q);',
            '  return out;',
            '}'
          ].join('\n')
        },
        {
          title: '运行 → 提交 → 体会「上移预报线」的代价结构',
          text: '运行应得约 100 分（比值 ≤ 0.5 满分）。然后做两个实验：把 TAU 改成 0.5（等于点预测），分数崩回 50；' +
            '把 TAU 改成 0.99，分数也不涨——过度保险开始被 0.05 倍的冗余成本反噬。**最优 τ 由代价结构决定**，这就是分位数预测的全部秘密。'
        }
      ],

      solution: toPredictSource(solQuantileBand),

      starter: [
        'function predict(history, horizon, ctx) {',
        '  // 洞：把「点预测冠军」（季节朴素）直接当 95 分位备货水平。',
        '  // 它只是残差的中位数——一半的天数会在你的预报线之上缺货。',
        '  var m = ctx.season > 1 ? ctx.season : 24;',
        '  var n = history.length;',
        '  var out = [];',
        '  for (var h = 0; h < horizon; h++) {',
        '    out.push(history[n - m + h]);',
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
