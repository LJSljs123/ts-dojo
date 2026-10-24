/**
 * split.test.js —— 测试点构造（holdout / rolling）与数据泄漏
 *
 * 关键不变量：
 *   history = values[0, trainEnd)   actual = values[trainEnd, trainEnd+horizon)
 *   两段不重叠；holdout 的 trainEnd 必须是 len - horizon；rolling 最后一个窗口同理。
 *   交给用户代码的 job 里不能出现 actual 或完整序列。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/engine');

const { judge, problems, datasets } = loadEngine();
const { buildTestPoints, buildJobs } = judge;

/** 造一个每个点都不同的序列，便于用数字反查泄漏 */
function seq(n, base) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((base || 0) + i * 7 + 1);
  return out;
}

test('holdout：训练集严格截止于 len-horizon，测试集是最后 horizon 点', () => {
  const values = seq(20);
  const pts = buildTestPoints(values, { mode: 'holdout', horizon: 5, season: 4, freq: 'D', datasetId: 'qa' });
  assert.equal(pts.length, 1, 'holdout 应只有 1 个测试点');
  const p = pts[0];
  assert.equal(p.history.length, 20 - 5, '训练集长度应为 len-horizon');
  assert.deepEqual(p.history, values.slice(0, 15), '训练集必须是前 len-horizon 个点');
  assert.deepEqual(p.actual, values.slice(15), '测试集必须是最后 horizon 个点');
  assert.equal(p.actual.length, 5);
});

test('holdout：训练集与测试集无交集', () => {
  const values = seq(30);
  const pts = buildTestPoints(values, { mode: 'holdout', horizon: 7, season: 3 });
  const set = new Set(pts[0].history);
  for (const v of pts[0].actual) assert.ok(!set.has(v), '测试点 ' + v + ' 出现在训练集里（泄漏）');
});

test('holdout：ctx 字段与题目声明一致', () => {
  const pts = buildTestPoints(seq(20), {
    mode: 'holdout',
    horizon: 4,
    season: 12,
    freq: 'M',
    datasetId: 'airline',
  });
  assert.deepEqual(pts[0].ctx, { freq: 'M', season: 12, datasetId: 'airline', index: 0 });
});

test('rolling：4 个窗口的训练集长度依次为 96/108/120/132（p9 声明值）', () => {
  const airline = datasets.find((d) => d.id === 'airline');
  assert.ok(airline, 'airline 数据集应存在');
  assert.equal(airline.values.length, 144, 'airline 长度应为 144');
  const pts = buildTestPoints(airline.values, {
    mode: 'rolling',
    horizon: 12,
    windows: 4,
    originStep: 12,
    season: 12,
    datasetId: 'airline',
  });
  assert.equal(pts.length, 4, '应产生 4 个窗口');
  assert.deepEqual(pts.map((p) => p.history.length), [96, 108, 120, 132], '训练集长度');
  assert.deepEqual(pts.map((p) => p.index), [0, 1, 2, 3], '窗口序号');
  for (const p of pts) assert.equal(p.actual.length, 12, '每个窗口的测试集长度应为 horizon');
});

test('rolling：每个 origin 的训练集 = values[0, trainEnd)，测试集紧随其后', () => {
  const values = seq(60);
  const pts = buildTestPoints(values, { mode: 'rolling', horizon: 6, windows: 3, originStep: 6, season: 3 });
  // start = 60 - 6 - 2*6 = 42 → trainEnd 42 / 48 / 54
  assert.deepEqual(pts.map((p) => p.history.length), [42, 48, 54]);
  for (const p of pts) {
    const end = p.history.length;
    assert.deepEqual(p.history, values.slice(0, end), '训练集应为前缀');
    assert.deepEqual(p.actual, values.slice(end, end + 6), '测试集应紧随训练集');
  }
});

test('rolling：最后一个窗口的训练集截止于 len-horizon（不越界、不泄漏未来）', () => {
  const values = seq(50);
  const pts = buildTestPoints(values, { mode: 'rolling', horizon: 8, windows: 3, originStep: 8, season: 4 });
  const last = pts[pts.length - 1];
  assert.equal(last.history.length, 50 - 8, '最后窗口训练集应截止于 len-horizon');
  assert.deepEqual(last.actual, values.slice(42), '最后窗口测试集应是序列末尾');
  assert.equal(last.actual.length, 8);
});

test('rolling：训练集过短（<4）的窗口被跳过，不会产生空历史', () => {
  const values = seq(10);
  const pts = buildTestPoints(values, { mode: 'rolling', horizon: 4, windows: 3, originStep: 4, season: 2 });
  // start = 10-4-2*4 = -2 → trainEnd -2 / 2 / 6 → 只有 6 合法
  assert.equal(pts.length, 1);
  assert.equal(pts[0].history.length, 6);
  for (const p of pts) assert.ok(p.history.length >= 4, '训练集不应短于 4');
});

test('rolling：全部窗口都被跳过时兜底为单点 holdout', () => {
  const values = seq(6);
  const pts = buildTestPoints(values, { mode: 'rolling', horizon: 4, windows: 5, originStep: 4, season: 2 });
  assert.equal(pts.length, 1);
  assert.equal(pts[0].history.length, 2); // 6 - 4
});

test('泄漏检测：job 里只有 {code, history, horizon, ctx}，不含 actual / 完整序列', () => {
  const p = problems.find((x) => x.id === 'p1-naive');
  const ds = datasets.find((d) => d.id === p.dataset);
  const jobs = buildJobs(p, ds, 'function predict(){}');
  assert.equal(jobs.length, 1);
  for (const job of jobs) {
    assert.deepEqual(
      Object.keys(job).sort(),
      ['code', 'ctx', 'history', 'horizon'],
      'job 字段集合不应对用户暴露更多东西'
    );
    assert.equal(job.actual, undefined, 'job 不应携带 actual');
    assert.equal(job.history.length, ds.values.length - p.horizon);
  }
});

test('泄漏检测：序列化后的 job 里找不到任何一个测试集数值', () => {
  // 用互不相同的数值构造，保证「出现在 job 里」可被检出
  const values = seq(40, 100000);
  const pts = buildTestPoints(values, { mode: 'holdout', horizon: 6, season: 4, datasetId: 'qa' });
  const forbidden = pts[0].actual;
  const p = { id: 'x', mode: 'holdout', horizon: 6, metric: 'mse', baselines: ['naive'], threshold: 0.9 };
  const ds = { id: 'qa', freq: 'D', season: 4, values };
  const jobs = buildJobs(p, ds, 'function predict(){}');
  const blob = JSON.stringify(jobs);
  for (const v of forbidden) {
    assert.equal(blob.indexOf(String(v)), -1, '测试集数值 ' + v + ' 泄漏进了 job');
  }
});

test('泄漏检测：history 之后的下标读出 undefined（无法越界偷看）', () => {
  const values = seq(20);
  const pts = buildTestPoints(values, { mode: 'holdout', horizon: 5, season: 4 });
  const h = pts[0].history;
  assert.equal(h.length, 15);
  assert.equal(h[15], undefined, 'history 之后不应可读');
  assert.equal(h[-1], undefined);
  // 用原型链也拿不到原数组
  assert.equal(h.__proto__, Array.prototype, 'history 应是普通数组副本');
});

test('所有题目的 history.length + horizon 都不超过数据集长度', () => {
  for (const p of problems) {
    const ds = datasets.find((d) => d.id === p.dataset);
    assert.ok(ds, p.id + ' 引用的数据集 ' + p.dataset + ' 不存在');
    const pts = buildTestPoints(ds.values, {
      mode: p.mode || 'holdout',
      horizon: p.horizon,
      originStep: p.originStep,
      windows: p.windows,
      season: p.season || ds.season,
      datasetId: ds.id,
    });
    for (const pt of pts) {
      assert.ok(pt.history.length + p.horizon <= ds.values.length, p.id + ' 测试点越界');
      assert.equal(pt.actual.length, p.horizon, p.id + ' 测试集长度应等于 horizon');
      assert.deepEqual(
        pt.history,
        ds.values.slice(0, pt.history.length),
        p.id + ' 训练集必须是前缀'
      );
    }
  }
});

test('题目声明的窗口数 / 训练长度与实现一致（仅 p9 为 rolling）', () => {
  const rolling = problems.filter((p) => p.mode === 'rolling');
  assert.deepEqual(rolling.map((p) => p.id), ['p9-rolling-challenge'], '只有 p9 是滚动回测');
  for (const p of rolling) {
    const ds = datasets.find((d) => d.id === p.dataset);
    const pts = buildTestPoints(ds.values, {
      mode: p.mode,
      horizon: p.horizon,
      originStep: p.originStep,
      windows: p.windows,
      season: p.season || ds.season,
      datasetId: ds.id,
    });
    assert.equal(pts.length, p.windows, '窗口数应与声明一致');
  }
});
