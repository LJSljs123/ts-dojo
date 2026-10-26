/**
 * metrics.test.js —— 指标数学正确性（全部期望值由手算给出，不依赖实现）
 *
 * 运行：node --test tests/qa/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/engine');

const { judge } = loadEngine();
const M = judge.metrics;

const EPS = 1e-9;

function closeTo(actual, expected, msg, eps) {
  const e = eps || EPS;
  assert.ok(
    Math.abs(actual - expected) <= e * Math.max(1, Math.abs(expected)),
    (msg || '') + ' 期望 ' + expected + '，实际 ' + actual
  );
}

test('指标集合包含且仅包含文档声明的 6 个指标（v3.7 增 pinball）', () => {
  assert.deepEqual(Object.keys(M).sort(), ['mae', 'mape', 'mse', 'pinball', 'rmse', 'smape']);
  for (const k of Object.keys(M)) assert.equal(typeof M[k], 'function', k + ' 应为函数');
});

test('mse：手算 [1,2,3] vs [2,4,6] = (1+4+9)/3', () => {
  // 误差 -1,-2,-3 → 平方 1,4,9 → 14/3
  closeTo(M.mse([1, 2, 3], [2, 4, 6]), 14 / 3, 'mse 基本');
});

test('mse：负数样本', () => {
  // 误差 -2,-4 → 4+16=20 → /2 = 10
  closeTo(M.mse([-1, -2], [1, 2]), 10, 'mse 负数');
});

test('mse：全 0 输入 = 0（不是 NaN）', () => {
  assert.equal(M.mse([0, 0, 0], [0, 0, 0]), 0);
});

test('mse：长度不一致按较短截断', () => {
  // n = min(3,2) = 2 → 误差 0,0
  closeTo(M.mse([1, 2, 3], [1, 2]), 0, 'mse 截断');
  closeTo(M.mse([1, 2], [1, 2, 99]), 0, 'mse 截断（反向）');
});

test('mse / mae / mape / smape：空数组返回 NaN', () => {
  assert.ok(Number.isNaN(M.mse([], [])), 'mse([]) 应为 NaN');
  assert.ok(Number.isNaN(M.mae([], [])), 'mae([]) 应为 NaN');
  assert.ok(Number.isNaN(M.mape([], [])), 'mape([]) 应为 NaN');
  assert.ok(Number.isNaN(M.smape([], [])), 'smape([]) 应为 NaN');
  assert.ok(Number.isNaN(M.rmse([], [])), 'rmse([]) 应为 NaN');
});

test('rmse = sqrt(mse)', () => {
  const a = [3, 7, 11];
  const p = [4, 5, 13];
  closeTo(M.rmse(a, p), Math.sqrt(M.mse(a, p)), 'rmse');
  // 手算：误差 -1,2,-2 → 1+4+4=9 → mse 3 → rmse sqrt(3)
  closeTo(M.rmse(a, p), Math.sqrt(3), 'rmse 手算');
});

test('mae：手算 (1+2+3)/3 = 2', () => {
  closeTo(M.mae([1, 2, 3], [2, 4, 6]), 2, 'mae 基本');
});

test('mae：负数与零', () => {
  // |−1−1| = 2, |0−0| = 0, |5−2| = 3 → 5/3
  closeTo(M.mae([-1, 0, 5], [1, 0, 2]), 5 / 3, 'mae 负零混合');
});

test('mape：手算 15%', () => {
  // 0.2 与 0.1 → 平均 0.15 → 15%
  closeTo(M.mape([10, 20], [12, 18]), 15, 'mape 基本');
});

test('mape：actual 为 0 的样本被跳过（不被 0 除）', () => {
  // 只有第 2 个样本参与：|10-12|/10 = 0.2 → 20%
  closeTo(M.mape([0, 10], [5, 12]), 20, 'mape 跳过 0');
});

test('mape：actual 全 0 → 返回 0（全部跳过）', () => {
  assert.equal(M.mape([0, 0], [1, 1]), 0);
});

test('mape：负数样本按绝对值做分母', () => {
  // |-10+8|/10 = 0.2, |-20+24|/20 = 0.2 → 20%
  closeTo(M.mape([-10, -20], [-8, -24]), 20, 'mape 负数');
});

test('smape：手算 14.35407%', () => {
  // 4/22 + 4/38 = 0.181818 + 0.105263 = 0.287081 → /2 = 0.1435407 → 14.35407%
  const expected = ((2 * 2) / 22 + (2 * 2) / 38) / 2 * 100;
  closeTo(M.smape([10, 20], [12, 18]), expected, 'smape 基本');
  closeTo(expected, 14.354066985645933, 'smape 手算常量', 1e-12);
});

test('smape：actual 与 pred 全 0 → 0（0/0 记为 0，仍计入 n）', () => {
  assert.equal(M.smape([0, 0], [0, 0]), 0);
});

test('smape：负数样本', () => {
  // 4/18 + 8/44 = 0.222222 + 0.181818 → /2 → 20.2020%
  const expected = ((2 * 2) / (10 + 8) + (2 * 4) / (20 + 24)) / 2 * 100;
  closeTo(M.smape([-10, -20], [-8, -24]), expected, 'smape 负数');
  closeTo(expected, 20.202020202020204, 'smape 负数手算常量', 1e-12);
});

test('smape：分母为 0 的样本记 0 但仍在 n 内（与 mape 跳过口径不同）', () => {
  // i0: a=0,p=0 → 跳过（贡献 0）；i1: 4/22 → s=0.181818；/n=2 → 9.0909%
  closeTo(M.smape([0, 10], [0, 12]), (4 / 22) / 2 * 100, 'smape 0 样本');
});

test('所有指标都不修改入参', () => {
  const a = [1, 2, 3];
  const p = [4, 5, 6];
  const ac = a.slice();
  const pc = p.slice();
  M.mse(a, p);
  M.rmse(a, p);
  M.mae(a, p);
  M.mape(a, p);
  M.smape(a, p);
  assert.deepEqual(a, ac, 'actual 被修改');
  assert.deepEqual(p, pc, 'predicted 被修改');
});

test('指标对完美预测返回 0', () => {
  const a = [3.5, -1.25, 0, 42];
  assert.equal(M.mse(a, a.slice()), 0);
  assert.equal(M.rmse(a, a.slice()), 0);
  assert.equal(M.mae(a, a.slice()), 0);
  closeTo(M.mape(a, a.slice()), 0, 'mape 完美');
  closeTo(M.smape(a, a.slice()), 0, 'smape 完美');
});

test('pinball：对称点（τ=0.95 备货语义）与手算校验', () => {
  const actual = [10, 10, 10, 10];
  // 全部低估 2 单位 → 每点罚 0.95×2
  assert.ok(Math.abs(M.pinball(actual, [8, 8, 8, 8]) - 1.9) < 1e-9);
  // 全部高估 2 单位 → 每点罚 0.05×2
  assert.ok(Math.abs(M.pinball(actual, [12, 12, 12, 12]) - 0.1) < 1e-9);
  // 精确命中 → 0
  assert.equal(M.pinball(actual, actual), 0);
  // 混合：两点低估 1（各罚 0.95）、两点高估 1（各罚 0.05）→ (0.95 + 0.05) × 2 / 4 = 0.5
  assert.ok(Math.abs(M.pinball(actual, [9, 11, 9, 11]) - 0.5) < 1e-9);
  // 空数组 → NaN；长度按短者截断
  assert.ok(Number.isNaN(M.pinball([], [])));
  assert.ok(Math.abs(M.pinball([10, 10], [9]) - 0.95) < 1e-9);
});

test('pinball：不对称性（低估惩罚是高估的 19 倍，τ=0.95 vs 0.05）', () => {
  const a = [100];
  assert.ok(M.pinball(a, [90]) === M.pinball(a, [90]));
  const under = M.pinball(a, [90]);   // 缺货 10
  const over = M.pinball(a, [110]);   // 冗余 10
  assert.ok(Math.abs(under / over - 19) < 1e-9, '低估/高估代价比应为 19：' + (under / over));
});
