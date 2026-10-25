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

test('参数默认值必须跟随目标方法，不能把 Holt-Winters 参数泄漏进 SES', () => {
  const cfg = TSJ.labConfig.normalize(baseConfig({ method: 'ses' })).config;
  assert.deepEqual(Object.keys(cfg.params).sort(), ['alpha']);
  const hw = TSJ.labConfig.normalize(baseConfig({ method: 'holt-winters' })).config;
  assert.deepEqual(Object.keys(hw.params).sort(), ['alpha', 'beta', 'gamma']);
});

test('数据集太短时必须显式报错，不得靠缩水测试点硬跑', () => {
  const bad = TSJ.labConfig.normalize(baseConfig({
    datasetId: 'intermittent',
    split: { mode: 'rolling', horizon: 48, windows: 12, originStep: 48 }
  }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.indexOf('数据集太短') >= 0), JSON.stringify(bad.errors));
});

test('v3.1 实验室扩展：TSB 与组合预测在白名单内，且锚点替换失败会关闭', () => {
  assert.ok(TSJ.labConfig.METHODS.tsb);
  assert.ok(TSJ.labConfig.METHODS.combination);
  const src = TSJ.labAdapters.buildSource('tsb', { alpha: 0.2, beta: 0.3 });
  assert.ok(src.indexOf('var alpha = 0.2;') >= 0, 'TSB alpha 锚点未替换');
  assert.ok(src.indexOf('var beta = 0.3;') >= 0, 'TSB beta 锚点未替换');
  assert.ok(TSJ.labAdapters.buildSource('combination', {}).length > 0, '组合预测缺少参考解');
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

test('v3.2 修复回归：连字符基线方法必须真正跑通（seasonal-naive / moving-average）', async () => {
  // 白名单键是连字符、judge 基线键是下划线：不映射时会走参考解分支并报
  // 误导性的 "predict is not defined"。修复后应直接命中基线并输出正确长度。
  assert.equal(TSJ.labAdapters.baselineKeyOf('seasonal-naive'), 'seasonal_naive');
  assert.equal(TSJ.labAdapters.baselineKeyOf('moving-average'), 'moving_average');
  assert.equal(TSJ.labAdapters.baselineKeyOf('ses'), 'ses');

  const jobs = [{ history: [3, 1, 4, 1, 5, 9, 2, 6], horizon: 3, ctx: { season: 4, freq: 'D', datasetId: 'qa', index: 0 } }];
  for (const m of ['naive', 'seasonal-naive', 'mean', 'moving-average']) {
    const run = TSJ.labAdapters.runJobs(m, {}, jobs);
    assert.equal(run.results[0].status, 'ok', m + ' 应正常执行：' + JSON.stringify(run.results[0]));
    assert.equal(run.results[0].value.length, 3, m + ' 输出长度应为 horizon');
    assert.ok(run.results[0].value.every((v) => isFinite(v)), m + ' 输出应全为有限数');
  }
});

test('v3.2 修复回归：白名单方法既无基线也无参考解时必须抛错（fail-closed）', () => {
  // 用白名单里存在、但 SOURCE_PROBLEM 没登记且基线映射也不存在的键做一次验证。
  // holt-winters 有参考解，不应抛；构造非法映射时必须抛出而不是返回 null
  // （null 会被 runInProcess 编译成 "null" 源码 → 误导性的 predict is not defined）。
  assert.doesNotThrow(() => TSJ.labAdapters.buildSource('holt-winters', { alpha: 0.3, beta: 0.05, gamma: 0.2 }));
  const saved = TSJ.labAdapters.SOURCE_PROBLEM['holt-winters'];
  delete TSJ.labAdapters.SOURCE_PROBLEM['holt-winters'];
  try {
    assert.throws(() => TSJ.labAdapters.buildSource('holt-winters', {}), /缺少基线与参考解的适配/);
  } finally {
    TSJ.labAdapters.SOURCE_PROBLEM['holt-winters'] = saved;
  }
});

test('v3.2 修复回归：区间校准任务必须携带数据集真实 season', async () => {
  const cfg = TSJ.labConfig.normalize(baseConfig({
    datasetId: 'traffic',            // season = 24，与 Holt-Winters 回退值 12 不同
    method: 'holt-winters',
    interval: { enabled: true, levels: [80, 95] }
  })).config;
  const res = await TSJ.labRunner.run(cfg, { token: 1 });
  assert.equal(res.ok, true, '运行应成功');
  assert.ok(res.origins[0].intervals.length > 0, '应产出经验区间');
  // 静态守卫：校准任务不允许再出现 season: 0
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/lab/runner.js'), 'utf8');
  assert.equal(src.indexOf('season: 0'), -1, 'runner.js 仍残留 season: 0 校准任务');
});
