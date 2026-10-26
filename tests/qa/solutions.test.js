/**
 * solutions.test.js —— 参考解通过性、朴素解可达性、数据集可复现性
 *
 * 结论性断言 + 诊断表格（表格用 t.diagnostic 输出，作为报告里的证据）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEngine, resetEngine, NAIVE_CODE, JS_DIR } = require('./helpers/engine');

const { judge, problems, datasets } = loadEngine();

function evalCode(p, code) {
  const ds = datasets.find((d) => d.id === p.dataset);
  return judge.evaluateSync({ problem: p, dataset: ds, code });
}

/* ================================================================== *
 * 1. 参考解必须全部通过
 * ================================================================== */

test('每题参考解：verdict=AC、passed=true、score >= passScore、逐测试点全 AC', () => {
  const rows = [];
  for (const p of problems) {
    const res = evalCode(p, p.solution);
    rows.push(p.id + ' ' + res.score + '/' + p.passScore + ' ' + res.verdict);
    assert.equal(res.verdict, 'AC', p.id + ' 参考解未通过（' + res.score + ' 分）');
    assert.equal(res.passed, true, p.id);
    assert.ok(res.score >= p.passScore, p.id + ' 参考解 ' + res.score + ' < 通过线 ' + p.passScore);
    for (const c of res.cases) {
      assert.equal(c.verdict, 'AC', p.id + ' 有测试点未达标：' + JSON.stringify(c));
    }
  }
  console.log('    参考解得分：' + rows.join(' | '));
});

test('参考解代码串语法合法且定义了 predict（toString 转换没有破坏结构）', () => {
  for (const p of problems) {
    assert.match(p.solution, /function predict\s*\(/, p.id + ' 的 solution 未包含 function predict');
    assert.doesNotThrow(() => new Function(p.solution + '\nreturn predict;'), p.id + ' 的 solution 语法错误');
    const fn = new Function(p.solution + '\nreturn predict;')();
    assert.equal(typeof fn, 'function', p.id);
  }
});

test('参考解不依赖 ctx.index（不在滚动回测里按窗口作弊）', () => {
  for (const p of problems) {
    assert.equal(p.solution.indexOf('ctx.index'), -1, p.id + ' 的参考解读取了 ctx.index');
  }
});

/* ================================================================== *
 * 2. 朴素解可达性（题目设计合理性）
 * ================================================================== */

test('纯 naive 提交：9 题全部不通过（p1 也已把 naive 放进对照组）', () => {
  const table = [];
  const passed = [];
  for (const p of problems) {
    const res = evalCode(p, NAIVE_CODE);
    table.push(p.id + ':' + res.score + '/' + res.verdict + '(r=' + (res.cases[0].ratio === undefined ? '-' : res.cases[0].ratio.toFixed(2)) + ')');
    if (res.passed) passed.push(p.id);
  }
  console.log('    naive 提交得分：' + table.join(' | '));
  assert.deepEqual(passed, [], '不应有任何题能被纯 naive 通过，实际通过：' + passed.join(','));
});

test('p1：纯 naive 打平最优基线 → 57 分 WA（打平基线不算赢）', () => {
  const p = problems.find((x) => x.id === 'p1-naive');
  const res = evalCode(p, NAIVE_CODE);
  assert.equal(res.score, 57);
  assert.equal(res.verdict, 'WA');
  assert.equal(res.passed, false);
  assert.ok(Math.abs(res.cases[0].ratio - 1) < 1e-9, 'ratio 应恰为 1.00，实际 ' + res.cases[0].ratio);
  // naive 必须在对照组里，否则「打平基线」无法被识别，题目零区分度
  assert.ok(p.baselines.indexOf('naive') >= 0, 'p1 的对照基线里必须有 naive');
  assert.ok(p.baselines.indexOf('mean') >= 0, 'p1 的对照基线里应有 mean');
});

test('p1：参考解（朴素 + 漂移）能过线，且明显优于 naive 基线', () => {
  const p = problems.find((x) => x.id === 'p1-naive');
  const res = evalCode(p, p.solution);
  assert.equal(res.verdict, 'AC', 'p1 参考解应 AC，实际 ' + res.score + ' 分');
  assert.ok(res.cases[0].ratio <= p.threshold, 'ratio 应 <= 阈值 ' + p.threshold + '，实际 ' + res.cases[0].ratio);
});

test('p8：纯 naive 55 分（ratio=1，即与最优基线打平）', () => {
  const p = problems.find((x) => x.id === 'p8-robust-shift');
  const res = evalCode(p, NAIVE_CODE);
  assert.equal(res.score, 55, '与基线打平应得 55 分（passScore=60 下方）');
  assert.equal(res.verdict, 'WA');
  assert.equal(res.cases[0].baselineName, 'naive', '该题最优基线就是 naive 本身');
});

test('模板（starter）原样提交：9 题全部不通过，且必须是 WA 而不是 RE/TLE', () => {
  const rows = [];
  const passed = [];
  const notWa = [];
  for (const p of problems) {
    const res = evalCode(p, p.starter);
    rows.push(p.id + '=' + res.score + '/' + res.verdict + (res.passed ? '(通过!)' : ''));
    if (res.passed) passed.push(p.id);
    if (res.verdict !== 'WA') notWa.push(p.id + ':' + res.verdict);
    // 骨架必须是「语法正确、能跑完」的，学习者拿到的应该是 WA（可比较的分数）而不是 RE
    assert.doesNotThrow(
      () => new Function(p.starter + '\nreturn predict;'),
      p.id + ' 的 starter 语法错误（会变成 RE，学习体验更差）'
    );
    if (p.mode === 'rolling') {
      // 滚动回测题：模板的平均分可能高于通过线，但必须至少有一个窗口崩掉
      // （p9 的设计就是「把 P6 的实现搬过来 → 窗口 1 只有 44 分」，见下一条用例）
      assert.ok(
        res.cases.some((c) => c.score < p.passScore),
        p.id + ' 的 starter 所有窗口都达标，模板直接过关'
      );
    } else {
      assert.ok(res.score < p.passScore, p.id + ' 的 starter 得分 ' + res.score + ' 不应达到通过线 ' + p.passScore);
    }
  }
  console.log('    starter 得分：' + rows.join(' | '));
  assert.deepEqual(passed, [], '模板原样提交就能通过，题目失去练习意义：' + passed.join(','));
  assert.deepEqual(notWa, [], '模板应以 WA 收场（便于比较分数），实际出现：' + notWa.join(','));
});

test('p9 模板：总分可能高于通过线，但必须有窗口低于通过线（滚动回测的教学点）', () => {
  const p = problems.find((x) => x.id === 'p9-rolling-challenge');
  const res = evalCode(p, p.starter);
  assert.equal(res.cases.length, 4, '应有 4 个窗口');
  assert.equal(res.passed, false);
  const bad = res.cases.filter((c) => c.score < p.passScore);
  assert.ok(bad.length >= 1, '至少应有一个窗口未达标，否则模板直接过关');
});

/* ================================================================== *
 * 2b. P18：题目必须真的在考「信息粒度」
 * ================================================================== */

test('p18：模板 55 分打平最优基线，拆开才 100 分', () => {
  const p = problems.find((x) => x.id === 'p18-channel-mix');
  assert.ok(p, 'p18-channel-mix 不存在');
  const base = evalCode(p, p.starter);
  assert.equal(base.score, 55, '模板应与最优基线打平（55 分）');
  assert.ok(Math.abs(base.cases[0].ratio - 1) < 1e-9, 'ratio 应恰为 1.00');
  assert.equal(base.cases[0].baselineName, 'seasonal_naive');

  const sol = evalCode(p, p.solution);
  assert.equal(sol.score, 100);
  assert.ok(sol.cases[0].ratio < 0.2, '参考解应把误差压到基线的 20% 以内，实际 ' + sol.cases[0].ratio);
});

test('p18：在总量上换周期 / 换模型都过不了线（否则题目考的是「猜对周期」）', () => {
  const p = problems.find((x) => x.id === 'p18-channel-mix');
  // ① 把周期从 7 换成 30：只补上企业渠道，丢掉门店的周节律
  const sn30 = evalCode(p, [
    'function predict(history, horizon, ctx) {',
    '  var m = 30, n = history.length, out = [];',
    '  for (var h = 0; h < horizon; h++) out.push(history[n - m + (h % m)]);',
    '  return out;',
    '}'
  ].join('\n'));
  assert.equal(sn30.verdict, 'WA', 'm=30 的单序列模型不应通过');
  assert.equal(sn30.score, 55, '题面写的是「55 分，和模板打平」');

  // ② 把 P6 的 Holt-Winters 参考解原样搬到总量上：模型更复杂，分数更低
  const hw = problems.find((x) => x.id === 'p6-holt-winters');
  const hwOn18 = evalCode(p, hw.solution);
  assert.equal(hwOn18.verdict, 'WA', 'Holt-Winters 不应通过');
  assert.equal(hwOn18.score, 41, '题面写的是「41 分，比模板还低」');
});

/* ================================================================== *
 * 3. 数据集可复现性 / 完整性
 * ================================================================== */

test('连续两次加载 datasets：序列数值必须完全一致（无 Math.random 泄漏）', () => {
  const first = datasets.map((d) => ({ id: d.id, values: d.values.slice() }));
  // 清缓存 → 重新执行 datasets.js（会重新跑一遍所有生成器）
  resetEngine();
  const second = require(path.join(JS_DIR, 'datasets.js'));
  assert.equal(second.length, first.length, '数据集数量应一致');
  for (let i = 0; i < first.length; i++) {
    assert.equal(second[i].id, first[i].id);
    assert.equal(second[i].values.length, first[i].values.length, first[i].id + ' 长度不一致');
    assert.deepEqual(second[i].values, first[i].values, first[i].id + ' 数值不可复现');
  }
  // 恢复引擎，避免影响后续用例
  loadEngine({ fresh: true });
});

test('数据集元数据与题面声明一致（长度 / 周期 / 频率）', () => {
  const expect = {
    airline: [144, 12, 'M'],
    electricity: [720, 24, 'H'],
    temperature: [730, 365, 'D'],
    traffic: [336, 24, 'H'],
    retail: [156, 52, 'W'],
    sunspot: [300, 11, 'Y'],
    demand_shift: [200, 7, 'D'],
    gmv: [160, 7, 'D'],
    intermittent: [120, 12, 'M'],
    retail_daily: [730, 7, 'D'],
    channels_daily: [730, 7, 'D'],
  };
  for (const d of datasets) {
    const e = expect[d.id];
    assert.ok(e, '未预期的数据集 ' + d.id);
    assert.equal(d.values.length, e[0], d.id + ' 长度');
    assert.equal(d.season, e[1], d.id + ' 周期');
    assert.equal(d.freq, e[2], d.id + ' 频率');
  }
});

test('外生协变量数据集：promoDays 升序去重且落在序列范围内', () => {
  // 只有 retail_daily 带促销日历；下标与 history 同一坐标系，越界会让「未来促销」永远落空，
  // 重复会让倍数估计把同一个促销日算两遍。两条都不报错，只会静默降低题目质量。
  for (const d of datasets) {
    if (!d.promoDays) continue;
    const days = d.promoDays;
    assert.ok(days.length > 0, d.id + ' 声明了促销日历但为空');
    for (let i = 0; i < days.length; i++) {
      assert.ok(Number.isInteger(days[i]), d.id + ' promoDays[' + i + '] 不是整数：' + days[i]);
      assert.ok(days[i] >= 0 && days[i] < d.values.length,
        d.id + ' promoDays[' + i + '] 越界：' + days[i] + '（长度 ' + d.values.length + '）');
      if (i > 0) assert.ok(days[i] > days[i - 1], d.id + ' promoDays 必须严格升序且不重复：' +
        days[i - 1] + ' → ' + days[i]);
    }
  }
  const rd = datasets.find((d) => d.id === 'retail_daily');
  assert.ok(rd && rd.promoDays, 'retail_daily 必须带促销日历（P17 依赖它）');
  // 最后两周必须各有促销日：否则「只清洗历史」或「只乘未来」的半成品解能过线
  const tail = rd.promoDays.filter((i) => i >= rd.values.length - 14);
  assert.ok(tail.length >= 2, 'retail_daily 最后 14 天至少要有 2 个促销日，实际 ' + tail.length);
  assert.ok(tail.some((i) => i >= rd.values.length - rd.season),
    'retail_daily 最后一个周期内必须有促销日（考「未来促销修正」）');
  assert.ok(tail.some((i) => i < rd.values.length - rd.season),
    'retail_daily 倒数第二个周期内必须有促销日（考「历史促销污染」）');
});

test('分量数据集：parts 与 values 等长、逐点可加、周期互不相同', () => {
  // P18 的全部前提都压在「总量 = 各分量逐点相加」上。这一条坏了不会报错，
  // 只会让参考解静默失准，所以必须逐点钉死。
  let seen = 0;
  for (const d of datasets) {
    if (!d.parts) continue;
    seen++;
    assert.ok(Array.isArray(d.parts) && d.parts.length >= 2, d.id + ' 的 parts 至少要两路');
    for (const part of d.parts) {
      assert.ok(part.name, d.id + ' 的分量缺少 name');
      assert.ok(Number.isInteger(part.period) && part.period > 1,
        d.id + ' 的分量周期非法：' + part.period);
      assert.equal(part.values.length, d.values.length,
        d.id + '/' + part.name + ' 长度与总量不一致');
    }
    const periods = d.parts.map((p) => p.period);
    assert.equal(new Set(periods).size, periods.length,
      d.id + ' 两路分量周期相同，拆开就没有意义：' + periods.join(','));
    for (let i = 0; i < d.values.length; i++) {
      const sum = d.parts.reduce((s, p) => s + p.values[i], 0);
      assert.ok(Math.abs(sum - d.values[i]) < 1e-6,
        d.id + '[' + i + '] 分量之和 ' + sum + ' ≠ 总量 ' + d.values[i]);
    }
  }
  assert.ok(seen >= 1, '没有任何数据集提供 parts（P18 依赖 channels_daily）');
});

test('channels_daily：测试窗口必须覆盖月末冲量，否则「不拆」也能过线', () => {
  const d = datasets.find((x) => x.id === 'channels_daily');
  assert.ok(d && d.parts, 'channels_daily 必须提供 parts（P18 依赖它）');
  const corp = d.parts.find((p) => p.period === 30);
  assert.ok(corp, 'channels_daily 必须有一路 30 天周期的分量');
  const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const overall = meanOf(corp.values);
  const peaks = corp.values.slice(-14).filter((v) => v > overall * 1.5);
  // 少了 → 模板不会失准，「不拆」也能过线；多了 → 峰变宽，Holt-Winters 的水平项
  // 会顺手吸收，题目就退化成「换个更复杂的模型」。
  assert.ok(peaks.length >= 2, '最后 14 天至少要有 2 天处在冲量峰，实际 ' + peaks.length);
  assert.ok(peaks.length <= 4, '冲量峰过宽（' + peaks.length + ' 天），会削弱题目区分度');
});

test('数据集全部为有限数值，且保留 1 位小数', () => {
  for (const d of datasets) {
    for (let i = 0; i < d.values.length; i++) {
      const v = d.values[i];
      assert.equal(typeof v, 'number', d.id + '[' + i + '] 不是数字');
      assert.ok(isFinite(v), d.id + '[' + i + '] 不是有限值：' + v);
      assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, d.id + '[' + i + '] 小数位超过 1：' + v);
    }
  }
});

test('题目与数据集引用完整（无悬空 dataset id）', () => {
  for (const p of problems) {
    assert.ok(datasets.some((d) => d.id === p.dataset), p.id + ' 引用了不存在的数据集 ' + p.dataset);
    assert.ok(p.passScore >= 1 && p.passScore <= 100, p.id + ' passScore 越界');
    assert.ok(p.threshold > 0 && p.threshold < 1, p.id + ' threshold 应在 (0,1)：' + p.threshold);
    assert.ok(p.horizon >= 1, p.id + ' horizon 非法');
    assert.ok(Array.isArray(p.baselines) && p.baselines.length > 0, p.id + ' 未配置基线');
    for (const b of p.baselines) assert.ok(judge.baselines[b], p.id + ' 引用了不存在的基线 ' + b);
    assert.ok(judge.metrics[p.metric], p.id + ' 引用了不存在的指标 ' + p.metric);
  }
});

test('同一份参考解重复判题结果稳定（滚动回测 4 窗口亦稳定）', () => {
  const p = problems.find((x) => x.id === 'p9-rolling-challenge');
  const a = evalCode(p, p.solution);
  const b = evalCode(p, p.solution);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.cases.map((c) => c.score), b.cases.map((c) => c.score));
});
