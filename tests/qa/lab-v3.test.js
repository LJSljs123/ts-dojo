/**
 * lab-v3.test.js —— 可视化实验室引擎校验（无浏览器）
 *
 * 重点：配置白名单、确定性、与判题引擎同源、区间只来自训练残差。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/engine');

global.window = global;
loadEngine({ fresh: true });
require('../../assets/js/app/util.js');
require('../../assets/js/app/core.js');
require('../../assets/js/lab/config.js');
require('../../assets/js/lab/adapters.js');
require('../../assets/js/lab/stats.js');
require('../../assets/js/lab/runner.js');

function baseConfig(over) {
  return Object.assign({
    datasetId: 'airline',
    method: 'ses',
    params: { alpha: 0.3 },
    split: { mode: 'holdout', horizon: 12, windows: 1, originStep: 12 },
    metrics: ['mse', 'mae'],
    baseline: 'seasonal_naive',
    interval: { enabled: false, levels: [80] }
  }, over || {});
}

test('配置归一化：越界参数 / 未知方法 / 非法指标必须报错', () => {
  const bad = TSJ.labConfig.normalize(baseConfig({ method: 'ses', params: { alpha: 3 } }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.indexOf('alpha') >= 0));

  const unknown = TSJ.labConfig.normalize(baseConfig({ method: 'magic' }));
  assert.equal(unknown.ok, false);

  const noMetric = TSJ.labConfig.normalize(baseConfig({ metrics: [] }));
  assert.equal(noMetric.ok, false);
});

test('同配置两次运行：指标与预测完全一致（确定性）', async () => {
  const cfg = TSJ.labConfig.normalize(baseConfig()).config;
  const a = await TSJ.labRunner.run(cfg, { token: 1 });
  const b = await TSJ.labRunner.run(cfg, { token: 2 });
  assert.equal(a.ok, true, JSON.stringify(a.errors));
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.equal(a.configHash, b.configHash);
  assert.deepEqual(a.origins[0].prediction, b.origins[0].prediction);
  assert.deepEqual(a.metrics.mean, b.metrics.mean);
});

test('实验记录：候选与基线共享同一样本，且都输出有限值', async () => {
  const r = await TSJ.labRunner.run(TSJ.labConfig.normalize(baseConfig()).config, { token: 3 });
  const o = r.origins[0];
  assert.equal(o.actual.length, o.prediction.length);
  assert.equal(o.actual.length, o.baseline.length);
  for (const v of o.prediction.concat(o.baseline)) assert.ok(Number.isFinite(v), '预测含非法值');
  assert.ok(r.metrics.baselineMean.mse > 0, '基线指标应被计算');
});

test('区间：仅在教学开关打开时出现，且元数据声明非原生概率输出', async () => {
  const off = await TSJ.labRunner.run(TSJ.labConfig.normalize(baseConfig()).config, { token: 4 });
  assert.equal(off.origins[0].intervals.length, 0);
  assert.equal(off.intervalMeta, null);

  const on = await TSJ.labRunner.run(
    TSJ.labConfig.normalize(baseConfig({ interval: { enabled: true, levels: [80, 95] } })).config,
    { token: 5 }
  );
  const iv = on.origins[0].intervals;
  assert.equal(iv.length, 2);
  for (const band of iv) {
    assert.equal(band.lower.length, on.origins[0].prediction.length);
    assert.equal(band.upper.length, on.origins[0].prediction.length);
  }
  assert.match(on.intervalMeta.note, /教学演示/);
});

test('白名单：不能通过实验执行任意代码，只能选注册方法', () => {
  const cfg = TSJ.labConfig.normalize(baseConfig({ method: 'eval' })).config;
  assert.equal(cfg.method, 'holt-winters', '未知方法必须回退默认并报错');
  assert.throws(() => TSJ.labAdapters.buildSource('eval', {}), /白名单/);
});

test('统计函数：经验分位与训练残差只取有限值', () => {
  const q = TSJ.labStats.quantile([1, 2, 3, 4], 0.5);
  assert.ok(q >= 2 && q <= 3);
  const iv = TSJ.labStats.empiricalIntervals([-2, -1, 0, 1, 2], [80]);
  assert.equal(iv.length, 1);
  assert.ok(iv[0].lower <= 0 && iv[0].upper >= 0);
});
