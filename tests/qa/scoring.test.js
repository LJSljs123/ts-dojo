/**
 * scoring.test.js —— 评分公式的单调性、边界、以及端到端一致性
 *
 * 规则（来自题面与 judge.js 注释）：
 *   ratio <= 0.5            → 100
 *   ratio = threshold       → 恰好 passScore
 *   ratio >= 2              → 0
 *   中间两段线性，整数分，单调不增
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, makeCase } = require('./helpers/engine');

const { judge } = loadEngine();
const scoreForRatio = judge.scoreForRatio;

const THRS = [0.88, 0.9, 0.95, 0.51, 1, 2.5];

test('ratio <= 0.5 必须为 100（含边界 0.5 与 0）', () => {
  for (const thr of THRS) {
    assert.equal(scoreForRatio(0, thr, 60), 100, 'ratio=0 thr=' + thr);
    assert.equal(scoreForRatio(0.1, thr, 60), 100, 'ratio=0.1 thr=' + thr);
    assert.equal(scoreForRatio(0.5, thr, 60), 100, 'ratio=0.5 thr=' + thr);
    assert.equal(scoreForRatio(-3, thr, 60), 100, '负 ratio 应被夹到 0');
  }
});

test('ratio = threshold 时必须精确等于 passScore', () => {
  for (const thr of [0.88, 0.9, 0.95, 0.51, 1]) {
    for (const pass of [60, 70, 1, 100]) {
      assert.equal(
        scoreForRatio(thr, thr, pass),
        pass,
        'thr=' + thr + ' pass=' + pass + ' 应恰好等于通过线'
      );
    }
  }
});

test('ratio >= 2 必须为 0（threshold < 2 的现实区间）', () => {
  // 注意：threshold >= 2 时规则 ② 与 ④ 自相矛盾（ratio=thr 既该等于 passScore 又该为 0），
  // 该矛盾边界单独在下一个用例里固化。现有 9 道题的 threshold 都 <= 0.95。
  for (const thr of [0.51, 0.88, 0.9, 0.95, 1]) {
    assert.equal(scoreForRatio(2, thr, 60), 0, 'thr=' + thr);
    assert.equal(scoreForRatio(2.0001, thr, 60), 0);
    assert.equal(scoreForRatio(10, thr, 60), 0);
    assert.equal(scoreForRatio(Infinity, thr, 60), 0);
    assert.equal(scoreForRatio(NaN, thr, 60), 0);
  }
});

test('threshold > 2：④「ratio >= 2 → 0 分」优先于 ②，不得出现 60 分断崖', () => {
  // 契约 ④ 对**任意** threshold 都必须成立；因此 threshold 被夹到 2，
  // 且 ④ 的分支判定必须在 ② 之前（否则 thr=2.5 时 ratio=2 会命中 ② 拿到 70 分）。
  for (const thr of [2, 2.5, 3, 10]) {
    assert.equal(scoreForRatio(2, thr, 60), 0, 'thr=' + thr + ' 时 ratio=2 必须 0 分');
    assert.equal(scoreForRatio(2.0001, thr, 60), 0, 'thr=' + thr);
    assert.equal(scoreForRatio(thr, thr, 60), 0, 'thr=' + thr + ' 时 ratio=thr 落在 ④ 区间 → 0 分');
    assert.equal(scoreForRatio(50, thr, 60), 0, 'thr=' + thr);
  }
  // ratio < 2 时仍按 ② 平滑下降，不出现断崖：1.9 → 63、1.99 → 60、2 → 0
  assert.equal(scoreForRatio(1.9, 2.5, 60), 63);
  assert.equal(scoreForRatio(1.99, 2.5, 60), 60);
  assert.equal(scoreForRatio(2, 2.5, 60), 0);
});

test('threshold > 2 时同样满足单调不增（0.1 → 3 全程扫描）', () => {
  for (const thr of [2, 2.5, 10]) {
    let prev = Infinity;
    for (let i = 100; i <= 3000; i++) {
      const s = scoreForRatio(i / 1000, thr, 60);
      assert.ok(s <= prev, 'thr=' + thr + ' 非单调：ratio=' + i / 1000 + ' → ' + s + ' > ' + prev);
      prev = s;
    }
    assert.equal(prev, 0, 'thr=' + thr + ' 扫描到 ratio=3 应为 0 分');
  }
});

test('单调性：ratio 从 0.1 扫到 3，分数必须单调不增且落在 [0,100] 的整数上', () => {
  for (const thr of THRS) {
    let prev = Infinity;
    let prevRatio = null;
    for (let i = 100; i <= 3000; i++) {
      const ratio = i / 1000;
      const s = scoreForRatio(ratio, thr, 60);
      assert.equal(typeof s, 'number', 'score 应为数字');
      assert.ok(Number.isInteger(s), 'ratio=' + ratio + ' 得分应为整数，实际 ' + s);
      assert.ok(s >= 0 && s <= 100, 'ratio=' + ratio + ' 得分越界：' + s);
      assert.ok(
        s <= prev,
        'thr=' + thr + ' 非单调：ratio=' + prevRatio + ' → ' + prev + '，ratio=' + ratio + ' → ' + s
      );
      prev = s;
      prevRatio = ratio;
    }
  }
});

test('threshold 被夹到 >= 0.51（避免 ② 区间退化）', () => {
  assert.equal(scoreForRatio(0.51, 0.4, 60), 60);
  assert.equal(scoreForRatio(0.5, 0.4, 60), 100);
});

test('passScore 非法值时按 clamp(…, 1, 100) 处理', () => {
  assert.equal(scoreForRatio(0.9, 0.9, undefined), 60, '未提供 → 60');
  assert.equal(scoreForRatio(0.9, 0.9, 0), 60, '0 被视为未提供 → 60');
  assert.equal(scoreForRatio(0.9, 0.9, 200), 100, '超上限夹到 100');
  // 负数只被 clamp 到下限 1（不会被当作「未提供」回落 60）——
  // 产品数据里 passScore 恒为 60，故不可达；作为输入校验口径记录在报告 P2 中。
  assert.equal(scoreForRatio(0.9, 0.9, -5), 1, '负数夹到 1');
});

test('端到端：完美预测 → ratio 0 → 100 分 AC', () => {
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  const res = judge.evaluateSync({
    problem,
    dataset,
    code: 'function predict(h, n, c){ return [2,2,2,2]; }',
  });
  assert.equal(res.cases[0].ratio, 0);
  assert.equal(res.cases[0].score, 100);
  assert.equal(res.verdict, 'AC');
  assert.equal(res.passed, true);
});

test('端到端：最优基线完美（误差 0）而用户不完美 → ratio=Infinity → 0 分', () => {
  const values = [5, 5, 5, 5, 5, 5, 5, 5];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  const res = judge.evaluateSync({
    problem,
    dataset,
    code: 'function predict(h, n, c){ return [6,6,6,6]; }',
  });
  assert.equal(res.cases[0].bestBaseline, 0, '基线误差应为 0');
  assert.equal(res.cases[0].ratio, Infinity);
  assert.equal(res.cases[0].score, 0);
  assert.equal(res.verdict, 'WA');
});

test('端到端：最优基线完美且用户也完美 → 100 分', () => {
  const values = [5, 5, 5, 5, 5, 5, 5, 5];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  const res = judge.evaluateSync({
    problem,
    dataset,
    code: 'function predict(h, n, c){ return [5,5,5,5]; }',
  });
  assert.equal(res.cases[0].score, 100);
  assert.equal(res.verdict, 'AC');
});

test('端到端：ratio=0.5 恰好满分（误差为基线的 sqrt(0.5)）', () => {
  // history 全 1（naive=1），actual 全 2 → naive mse = 1
  // 预测 = 2 - sqrt(0.5) → 每点误差 sqrt(0.5) → mse 0.5 → ratio 0.5
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  const pred = 2 - Math.sqrt(0.5);
  const res = judge.evaluateSync({
    problem,
    dataset,
    code: 'function predict(h,n,c){ var v=' + pred + '; return [v,v,v,v]; }',
  });
  assert.ok(Math.abs(res.cases[0].ratio - 0.5) < 1e-9, 'ratio 应为 0.5，实际 ' + res.cases[0].ratio);
  assert.equal(res.cases[0].score, 100);
});

test('端到端：误差递增 → 得分单调不增', () => {
  // actual 全 2，naive 预测 1 → 基线 mse = 1；预测 2-d → 每点误差 d → mse = d²
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  let prev = Infinity;
  for (const d of [0, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 3.0]) {
    const v = 2 - d;
    const res = judge.evaluateSync({
      problem,
      dataset,
      code: 'function predict(h,n,c){ return [' + v + ',' + v + ',' + v + ',' + v + ']; }',
    });
    const s = res.cases[0].score;
    assert.ok(s <= prev, '误差 ' + d + ' 时得分 ' + s + ' 高于更小误差时的 ' + prev);
    prev = s;
  }
  assert.equal(prev, 0, '误差 3 时（ratio=9）应为 0 分');
});

test('滚动回测：任一窗口低于通过线 → 整体 WA（即使平均分足够高）', () => {
  // 3 个窗口：w0 用户完美(100)、w1 完美(100)、w2 与基线打平(ratio=1 → 55)
  const values = [];
  for (let i = 0; i < 12; i++) values.push(0); // 训练 0..11
  for (let i = 0; i < 4; i++) values.push(10); // w0 测试 12..15
  for (let i = 0; i < 4; i++) values.push(10); // w1 测试 16..19
  for (let i = 0; i < 4; i++) values.push(1000); // w2 测试 20..23
  const { problem, dataset } = makeCase(
    { horizon: 4, windows: 3, originStep: 4, mode: 'rolling', baselines: ['naive'], threshold: 0.9 },
    values
  );
  const res = judge.evaluateSync({
    problem,
    dataset,
    code: [
      'function predict(history, horizon, ctx) {',
      '  if (ctx.index === 0) return [10, 10, 10, 10];',
      '  return new Array(horizon).fill(history[history.length - 1]);',
      '}',
    ].join('\n'),
  });
  assert.equal(res.cases.length, 3, '应有 3 个窗口');
  assert.deepEqual(res.cases.map((c) => c.score), [100, 100, 55], '逐窗口得分');
  assert.equal(res.cases[2].verdict, 'WA', '第三个窗口未达标');
  assert.equal(res.score, 85, '总分应为逐窗口得分平均');
  assert.equal(res.verdict, 'WA', '有窗口未达标 → 整体 WA');
  assert.equal(res.passed, false);
});

test('holdout：AC 与 score>=passScore 必须一致', () => {
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, values);
  for (const v of [2, 1.5, 1.3, 1.0, 0.5]) {
    const res = judge.evaluateSync({
      problem,
      dataset,
      code: 'function predict(h,n,c){ return [' + v + ',' + v + ',' + v + ',' + v + ']; }',
    });
    assert.equal(
      res.cases[0].verdict,
      res.cases[0].score >= 60 ? 'AC' : 'WA',
      '单测试点：verdict 应与 score 一致'
    );
    assert.equal(res.passed, res.verdict === 'AC');
  }
});
