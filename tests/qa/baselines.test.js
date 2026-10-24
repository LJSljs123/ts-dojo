/**
 * baselines.test.js —— 基线数值必须精确符合定义（逐一手算）
 *
 * 统一用手工序列 history = [1,2,3,...,12]、horizon = 6、season = 4。
 * 期望值：
 *   naive          → 末值 12
 *   seasonal_naive → 重复上一个完整季节 [9,10,11,12]
 *   mean           → 均值 6.5
 *   linear_trend   → y = 1 + i（完全线性），未来下标 12.. → 13,14,15,16,17,18
 *   moving_average → 最近 4 点均值 (9+10+11+12)/4 = 10.5
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/engine');

const { judge } = loadEngine();
const B = judge.baselines;

const HIST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CTX = { freq: 'M', season: 4, datasetId: 'qa', index: 0 };
const H = 6;

test('基线集合齐全', () => {
  for (const k of ['naive', 'seasonal_naive', 'mean', 'linear_trend', 'moving_average']) {
    assert.equal(typeof B[k], 'function', k + ' 应为函数');
  }
});

test('naive = 末值重复 horizon 次', () => {
  assert.deepEqual(B.naive(HIST, H), [12, 12, 12, 12, 12, 12]);
});

test('seasonal_naive = 上一个完整季节 [9,10,11,12] 循环', () => {
  assert.deepEqual(B.seasonal_naive(HIST, H, CTX), [9, 10, 11, 12, 9, 10]);
});

test('mean = 历史均值 6.5', () => {
  assert.deepEqual(B.mean(HIST, H), [6.5, 6.5, 6.5, 6.5, 6.5, 6.5]);
});

test('linear_trend = 精确外推 [13,14,15,16,17,18]', () => {
  const out = B.linear_trend(HIST, H);
  assert.deepEqual(out, [13, 14, 15, 16, 17, 18]);
});

test('linear_trend 对非整数斜率也精确（y = 2 + 2i）', () => {
  const hist = [2, 4, 6, 8];
  // 未来下标 4,5 → 10,12
  assert.deepEqual(B.linear_trend(hist, 2), [10, 12]);
});

test('moving_average = 最近 k 点均值（k = season = 4）', () => {
  assert.deepEqual(B.moving_average(HIST, H, CTX), [10.5, 10.5, 10.5, 10.5, 10.5, 10.5]);
});

test('每个基线输出长度严格等于 horizon', () => {
  for (const k of ['naive', 'seasonal_naive', 'mean', 'linear_trend', 'moving_average']) {
    for (const h of [1, 3, 12, 24]) {
      const out = B[k](HIST, h, CTX);
      assert.equal(out.length, h, k + ' horizon=' + h);
      for (const v of out) assert.equal(typeof v, 'number', k + ' 元素应为数字');
    }
  }
});

test('seasonal_naive：历史不足一个季节时退化为 naive', () => {
  assert.deepEqual(B.seasonal_naive([1, 2, 3], 2, { season: 12 }), [3, 3]);
  // n === m 也算「不足」→ naive
  assert.deepEqual(B.seasonal_naive([1, 2, 3, 4], 2, { season: 4 }), [4, 4]);
});

test('seasonal_naive：n 不是 m 的整数倍时取最后 m 个点', () => {
  // n=10, m=4 → 起点 6 → history[6..9] = 7,8,9,10
  const hist = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(B.seasonal_naive(hist, 4, { season: 4 }), [7, 8, 9, 10]);
});

test('seasonal_naive：ctx.season 缺失/为 1 时默认 12', () => {
  assert.deepEqual(B.seasonal_naive(HIST, 2, {}), [12, 12]); // m=12,n=12 → naive
  const hist24 = [];
  for (let i = 1; i <= 24; i++) hist24.push(i);
  assert.deepEqual(B.seasonal_naive(hist24, 2, { season: 1 }), [13, 14]); // 取最后 12 个的前两个
});

test('linear_trend：n < 2 退化为 naive', () => {
  assert.deepEqual(B.linear_trend([5], 3), [5, 5, 5]);
  assert.deepEqual(B.linear_trend([], 2), [undefined, undefined]); // 空历史：末值为 undefined
});

test('linear_trend：水平序列斜率 0', () => {
  assert.deepEqual(B.linear_trend([5, 5, 5, 5], 2), [5, 5]);
});

test('mean：空历史 → NaN（不抛错）', () => {
  const out = B.mean([], 2);
  assert.equal(out.length, 2);
  assert.ok(out.every((v) => Number.isNaN(v)), '应为 NaN');
});

test('moving_average：k 被夹在 [2, n] 之间', () => {
  // n=2, season=6 → k = max(2, min(6,2)) = 2 → (1+2)/2 = 1.5
  assert.deepEqual(B.moving_average([1, 2], 2, { season: 6 }), [1.5, 1.5]);
  // 无 ctx → want=6 → k=min(6,12)=6 → 最近 6 点均值 (7..12) = 9.5
  assert.deepEqual(B.moving_average(HIST, 1, {}), [9.5]);
});

test('所有基线都不修改传入的 history', () => {
  const copy = HIST.slice();
  for (const k of ['naive', 'seasonal_naive', 'mean', 'linear_trend', 'moving_average']) {
    B[k](HIST, 4, CTX);
  }
  assert.deepEqual(HIST, copy, 'history 被基线修改');
});
