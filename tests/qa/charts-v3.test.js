/**
 * charts-v3.test.js —— 图表统计量数值校验（无浏览器）
 *
 * ACF/PACF/分解/分位数都有固定小例；图表渲染依赖这些纯函数，
 * 数值错了画面再漂亮也是误导。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../../assets/js/charts/core.js');
require('../../assets/js/charts/series.js');
require('../../assets/js/charts/diagnostics.js');

test('ACF：滞后 0 恒为 1，且落在 [-1, 1]', () => {
  const s = Array.from({ length: 40 }, (_, i) => (i % 7 === 0 ? 3 : 1) + i * 0.1);
  const r = TSJ.chartStats.acf(s, 10);
  assert.equal(r[0], 1);
  for (const v of r) {
    assert.ok(Number.isFinite(v));
    assert.ok(v >= -1.0001 && v <= 1.0001);
  }
});

test('PACF：滞后 0 为 1，输出长度与请求滞后一致', () => {
  const s = [];
  for (let i = 0; i < 50; i++) s.push((i >= 1 ? 0.6 * s[i - 1] : 0) + ((i * 29) % 13 - 6));
  const r = TSJ.chartStats.pacf(s, 6);
  assert.equal(r.length, 7);
  assert.equal(r[0], 1);
});

test('加性分解：合成「线性趋势 + 方波季节」应还原趋势与季节', () => {
  const n = 48, m = 12;
  const truth = Array.from({ length: n }, (_, i) => 10 + i * 0.5 + ((i % m) < 6 ? 3 : -3));
  const d = TSJ.chartStats.decomposeAdditive(truth, m);
  assert.ok(d, '两个完整周期内不应拒绝分解');
  assert.ok(Math.abs(d.trend[24] - (10 + 24 * 0.5)) < 1e-9, '趋势还原失败');
  assert.ok(Math.abs(d.seasonal[0] - 3) < 1e-9, '季节项还原失败');
  assert.ok(Math.abs(d.residual[24]) < 1e-9, '残差应接近 0');
  const mean = d.seasonal.reduce((a, b) => a + b, 0) / m;
  assert.ok(Math.abs(mean) < 1e-9, '季节项均值必须归一为 0');
});

test('分解在数据不足两个周期时拒绝，不画假图', () => {
  assert.equal(TSJ.chartStats.decomposeAdditive([1, 2, 3], 12), null);
  assert.equal(TSJ.chartStats.decomposeAdditive([1, NaN, 3], 2), null);
});
