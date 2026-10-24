/**
 * datasets.js —— 教学用合成时间序列数据集
 *
 * 全部序列由「固定种子的确定性伪随机数发生器（mulberry32）」在运行时生成：
 *  - 同一份代码在任何机器、任何时间、任何浏览器上生成的数字完全一致（可复现）；
 *  - 不硬编码几百个数字，文件体积小，便于审阅；
 *  - 形态尽量贴近真实数据：趋势、季节、异方差、异常点、水平漂移、振幅调制等。
 *
 * 每条数据集结构：
 *   { id, name, unit, freq, season, desc, values: number[] }
 *
 * 挂载点：window.TSJ.datasets（数组），并提供 TSJ.findDataset(id)
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /* ------------------------------------------------------------------ *
   * 1. 确定性伪随机
   * ------------------------------------------------------------------ */

  /**
   * mulberry32：32 位状态的快速确定性 PRNG，周期 2^32。
   * @param {number} seed 任意整数种子
   * @returns {function(): number} 返回 [0,1) 均匀分布
   */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 包装成一个带常用分布的随机源。
   * @param {number} seed 种子
   * @returns {{next: Function, uniform: Function, normal: Function}}
   */
  function makeRng(seed) {
    var next = mulberry32(seed);
    var spare = null;
    return {
      next: next,
      uniform: function (a, b) { return a + (b - a) * next(); },
      /** Box-Muller 标准正态（缓存另一半样本） */
      normal: function () {
        if (spare !== null) {
          var cached = spare;
          spare = null;
          return cached;
        }
        var u = 0, v = 0, r = 0;
        do {
          u = next() * 2 - 1;
          v = next() * 2 - 1;
          r = u * u + v * v;
        } while (r === 0 || r >= 1);
        var f = Math.sqrt(-2 * Math.log(r) / r);
        spare = v * f;
        return u * f;
      }
    };
  }

  /**
   * 保留指定小数位。
   * @param {number} x 数值
   * @param {number} digits 小数位
   * @returns {number}
   */
  function round(x, digits) {
    var p = Math.pow(10, digits);
    return Math.round(x * p) / p;
  }

  /**
   * 统一把数组四舍五入到 1 位小数。
   * @param {number[]} arr 原始数组
   * @returns {number[]}
   */
  function roundAll(arr) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) out[i] = round(arr[i], 1);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 2. 各数据集生成器
   * ------------------------------------------------------------------ */

  /**
   * airline：144 点月度航空客运量。
   * 形态：线性增长趋势 + 12 个月乘法季节（振幅随水平增长）+ 逐渐增大的噪声 + 3 个异常月。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildAirline(rng) {
    var values = [];
    var n = 144;
    for (var t = 0; t < n; t++) {
      var m = t % 12;
      // 季节形状：夏高冬低，略带二次谐波，避免纯正弦
      var shape = 1 +
        0.155 * Math.sin(2 * Math.PI * (m - 2.5) / 12) +
        0.045 * Math.cos(4 * Math.PI * m / 12);
      var level = 108 + 1.18 * t;
      var amp = 1 + 0.10 * t / n;             // 乘法季节：振幅随水平增长
      var factor = 1 + (shape - 1) * amp;
      var noise = rng.normal() * (2.1 + 0.014 * t);  // 异方差：噪声随时间放大
      values.push(level * factor + noise);
    }
    // 偶发异常点（罢工、节假日冲击）
    values[31] += 26;
    values[32] += 11;
    values[95] -= 30;
    return roundAll(values);
  }

  /**
   * electricity：720 点（30 天 × 24 小时）小时级用电负荷。
   * 形态：24 周期强季节 + 周末效应 + 缓慢上漂 + 随机尖峰。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildElectricity(rng) {
    var values = [];
    var n = 720;
    for (var t = 0; t < n; t++) {
      var h = t % 24;
      var day = Math.floor(t / 24);
      var dow = day % 7;
      var daily = 1 +
        0.22 * Math.sin(2 * Math.PI * (h - 8.5) / 24) +
        0.13 * Math.sin(4 * Math.PI * (h - 6.5) / 24);
      var weekend = (dow === 5 || dow === 6) ? 0.87 : 1;
      var drift = 1 + 0.00042 * t;            // 30 天累计约 +30%
      var base = 320 * drift * daily * weekend;
      var noise = rng.normal() * (7 + 0.012 * base);
      var spike = rng.next() < 0.012 ? rng.uniform(60, 140) : 0;
      values.push(base + noise + spike);
    }
    return roundAll(values);
  }

  /**
   * temperature：730 点（2 年）日级气温。
   * 形态：365 天年周期 + 白噪声 + 一次热浪与一次寒潮。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildTemperature(rng) {
    var values = [];
    var n = 730;
    for (var t = 0; t < n; t++) {
      var annual = 13.5 + 11.5 * Math.sin(2 * Math.PI * (t - 105) / 365) + 0.004 * t;
      var noise = rng.normal() * 2.4;
      values.push(annual + noise);
    }
    // 热浪 / 寒潮（连续多天的系统性偏移）
    for (var i = 205; i <= 209; i++) values[i] += 3.6 + (i - 205) * 0.5;
    for (var j = 545; j <= 548; j++) values[j] -= 4.2;
    return roundAll(values);
  }

  /**
   * traffic：336 点（2 周 × 24 小时）小时级车流量。
   * 形态：双周期（24 与 168）+ 周末低谷 + 随机拥堵尖峰。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildTraffic(rng) {
    var values = [];
    var n = 336;
    for (var t = 0; t < n; t++) {
      var h = t % 24;
      var day = Math.floor(t / 24);
      var dow = day % 7;                       // 0..6，5/6 视为周末
      var base = 1150 +
        620 * Math.sin(2 * Math.PI * (h - 8.5) / 24) +
        250 * Math.sin(4 * Math.PI * (h - 6) / 24);
      var wk = (dow === 5 || dow === 6) ? 0.74 : (dow === 4 ? 1.06 : 1);
      var noise = rng.normal() * 52;
      var spike = rng.next() < 0.01 ? rng.uniform(150, 320) : 0;
      values.push(base * wk + noise + spike);
    }
    return roundAll(values);
  }

  /**
   * retail：156 点（3 年）周级零售额。
   * 形态：线性趋势 + 52 周季节 + 周期性促销 + 随机促销尖峰。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildRetail(rng) {
    var values = [];
    var n = 156;
    for (var t = 0; t < n; t++) {
      var level = 235 + 2.6 * t;
      var seas = 1 +
        0.17 * Math.sin(2 * Math.PI * (t - 4) / 52) +
        0.08 * Math.sin(4 * Math.PI * (t - 2) / 52);
      var promo = (t % 13 === 0) ? 1.22 : 1;   // 固定节奏的促销
      if (rng.next() < 0.05) promo *= 1.15;    // 随机促销
      var noise = rng.normal() * (7 + 0.02 * level);
      values.push(level * seas * promo + noise);
    }
    return roundAll(values);
  }

  /**
   * sunspot：300 点年级太阳黑子相对数。
   * 形态：约 11 年准周期（周期本身缓慢变化）+ 振幅调制（大小年）+ 非对称波形。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildSunspot(rng) {
    var values = [];
    var n = 300;
    var phase = 0.4;
    for (var t = 0; t < n; t++) {
      var amp = 62 + 42 * Math.sin(2 * Math.PI * t / 96 + 0.8);  // 20..104
      var shape = Math.pow(0.5 * (1 - Math.cos(phase)), 1.7);    // 上升快、下降慢
      var v = amp * shape + rng.normal() * 5.5;
      values.push(Math.max(0, v));
      // 周期长度本身在 11 年附近摆动
      phase += (2 * Math.PI / 11.2) * (1 + 0.13 * Math.sin(2 * Math.PI * t / 74));
    }
    return roundAll(values);
  }

  /**
   * demand_shift：200 点日需求。
   * 形态：t=110 处发生水平漂移（level shift），之后叠加缓慢增长；含弱周周期与异常尖峰。
   * 用途：考察「对突变快速适应」与「对异常点鲁棒」。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildDemandShift(rng) {
    var values = [];
    var n = 200;
    for (var t = 0; t < n; t++) {
      var level;
      if (t < 105) {
        level = 500;
      } else if (t < 110) {
        level = 500 + (t - 105) * 24;          // 5 点过渡，避免不真实的垂直跳变
      } else {
        level = 620 + 0.45 * (t - 110);
      }
      var seas = 1 + 0.055 * Math.sin(2 * Math.PI * t / 7);
      var noise = rng.normal() * 17;
      var spike = rng.next() < 0.02 ? rng.uniform(45, 90) : 0;
      values.push(level * seas + noise + spike);
    }
    return roundAll(values);
  }

  /**
   * gmv：160 点日级成交额。
   * 形态：加速增长（二次项）+ 弱周周期 + 随水平放大的噪声 + 大促尖峰。
   * 用途：固定斜率直线外推会有系统偏差，自适应趋势（Holt）能跟上。
   * @param {Object} rng 随机源
   * @returns {number[]}
   */
  function buildGmv(rng) {
    var values = [];
    var n = 160;
    for (var t = 0; t < n; t++) {
      var level = 780 + 4.0 * t + 0.022 * t * t;
      var seas = 1 + 0.045 * Math.sin(2 * Math.PI * (t - 1) / 7);
      var noise = rng.normal() * (18 + 0.02 * level);
      var spike = rng.next() < 0.03 ? rng.uniform(80, 220) : 0;
      values.push(level * seas + noise + spike);
    }
    return roundAll(values);
  }

  /* ------------------------------------------------------------------ *
   * 3. 数据集清单
   * ------------------------------------------------------------------ */

  var DEFINITIONS = [
    {
      id: 'airline',
      name: '航空客运量（月度）',
      unit: '千人',
      freq: 'M',
      season: 12,
      seed: 20240117,
      build: buildAirline,
      desc: '144 个月的国际航空客运量：线性增长趋势 + 12 个月乘法季节（振幅随水平增长）+ 逐渐增大的噪声，并含 3 个异常月。'
    },
    {
      id: 'electricity',
      name: '用电负荷（小时级）',
      unit: 'MW',
      freq: 'H',
      season: 24,
      seed: 771013,
      build: buildElectricity,
      desc: '720 点（30 天 × 24 小时）区域用电负荷：24 小时强周期 + 周末下降 + 缓慢上漂 + 随机尖峰。'
    },
    {
      id: 'temperature',
      name: '日均气温（日级）',
      unit: '℃',
      freq: 'D',
      season: 365,
      seed: 31415926,
      build: buildTemperature,
      desc: '730 点（2 年）日均气温：365 天年周期 + 白噪声 + 一次热浪与一次寒潮。'
    },
    {
      id: 'traffic',
      name: '道路车流量（小时级）',
      unit: '辆/时',
      freq: 'H',
      season: 24,
      seed: 60606,
      build: buildTraffic,
      desc: '336 点（2 周 × 24 小时）车流量：双周期（24 与 168）+ 周末低谷 + 偶发拥堵尖峰。'
    },
    {
      id: 'retail',
      name: '零售额（周级）',
      unit: '万元',
      freq: 'W',
      season: 52,
      seed: 888888,
      build: buildRetail,
      desc: '156 点（3 年）周零售额：线性趋势（每周约 +2.6 万元）+ 52 周季节 + 固定节奏与随机促销尖峰。'
    },
    {
      id: 'sunspot',
      name: '太阳黑子相对数（年级）',
      unit: '个',
      freq: 'Y',
      season: 11,
      seed: 1610,
      build: buildSunspot,
      desc: '300 点年级太阳黑子相对数：约 11 年准周期（周期自身缓慢变化）+ 振幅调制 + 非对称波形。'
    },
    {
      id: 'demand_shift',
      name: '日需求（含水平漂移）',
      unit: '件',
      freq: 'D',
      season: 7,
      seed: 424242,
      build: buildDemandShift,
      desc: '200 点日需求：第 110 点附近发生水平漂移（+24%），之后缓慢增长；含弱周周期与异常尖峰。'
    },
    {
      id: 'gmv',
      name: '成交额 GMV（日级）',
      unit: '万元',
      freq: 'D',
      season: 7,
      seed: 909090,
      build: buildGmv,
      desc: '160 点日成交额：加速增长（二次趋势）+ 弱周周期 + 随水平放大的噪声 + 大促尖峰。'
    }
  ];

  var datasets = DEFINITIONS.map(function (def) {
    var rng = makeRng(def.seed);
    var values = def.build(rng);
    return {
      id: def.id,
      name: def.name,
      unit: def.unit,
      freq: def.freq,
      season: def.season,
      desc: def.desc,
      values: values
    };
  });

  /** id → dataset 映射，便于 O(1) 查找 */
  var byId = {};
  for (var i = 0; i < datasets.length; i++) byId[datasets[i].id] = datasets[i];

  /**
   * 按 id 查找数据集。
   * @param {string} id 数据集 id
   * @returns {Object|null}
   */
  function findDataset(id) {
    return byId[id] || null;
  }

  TSJ.datasets = datasets;
  TSJ.findDataset = findDataset;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = datasets;
    module.exports.findDataset = findDataset;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
