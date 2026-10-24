/**
 * tests/selftest.js —— 判题引擎自测（Node 直接运行，不参与 index.html 加载）
 *
 *   node tests/selftest.js
 *
 * 检查项：
 *   1. 每个数据集的长度 / 周期 / 数值合法性
 *   2. 每题参考解（solution）能算出分数且 passed === true
 *   3. 每题「朴素法」提交的得分（用于验证基线不是随便就能过）
 *   4. 指标与评分公式的边界行为
 *   5. 沙箱错误路径：语法错误 / 返回值长度错误 / 抛异常 / 访问 fetch
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const datasets = require(path.join(ROOT, 'assets/js/datasets.js'));
const problems = require(path.join(ROOT, 'assets/js/problems.js'));
const judge = require(path.join(ROOT, 'assets/js/judge.js'));

const NAIVE_CODE = [
  'function predict(history, horizon, ctx) {',
  '  var v = history[history.length - 1];',
  '  var out = [];',
  '  for (var i = 0; i < horizon; i++) out.push(v);',
  '  return out;',
  '}'
].join('\n');

let failures = 0;

function fail(msg) {
  failures++;
  console.log('  ✗ ' + msg);
}

function ok(msg) {
  console.log('  ✓ ' + msg);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 1. 数据集 ===');
for (const ds of datasets) {
  const n = ds.values.length;
  let bad = 0;
  for (const v of ds.values) if (typeof v !== 'number' || !isFinite(v)) bad++;
  const min = Math.min(...ds.values);
  const max = Math.max(...ds.values);
  const line = `${ds.id.padEnd(14)} n=${String(n).padStart(4)} season=${String(ds.season).padStart(3)} ` +
    `range=[${min.toFixed(1)}, ${max.toFixed(1)}] ${ds.unit}`;
  if (bad > 0) fail(line + ` 非法值 ${bad} 个`);
  else ok(line);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 2. 参考解 / 朴素解 对比 ===');
const rows = [];
for (const p of problems) {
  const ds = datasets.find((d) => d.id === p.dataset);
  if (!ds) { fail(`${p.id} 数据集缺失 ${p.dataset}`); continue; }

  const ref = judge.evaluateSync({ problem: p, dataset: ds, code: p.solution });
  const nv = judge.evaluateSync({ problem: p, dataset: ds, code: NAIVE_CODE });

  const ratios = ref.cases.map((c) => (c.ratio != null && isFinite(c.ratio) ? c.ratio.toFixed(3) : '∞')).join(' ');
  const scoreList = ref.cases.map((c) => c.score).join(' ');
  rows.push({
    idx: p.index,
    id: p.id,
    diff: p.difficulty,
    score: ref.score,
    passed: ref.passed,
    ratios,
    scoreList,
    naiveScore: nv.score,
    naivePassed: nv.passed
  });

  const flag = ref.passed ? 'PASS' : 'FAIL';
  const line = `#${p.index} ${p.id.padEnd(20)} 参考解 ${String(ref.score).padStart(3)} 分 ${flag}` +
    ` | 各窗口 ratio=[${ratios}] 分数=[${scoreList}]` +
    ` | 朴素解 ${String(nv.score).padStart(3)} 分 ${nv.passed ? 'PASS' : 'fail'}`;
  if (ref.passed) ok(line);
  else fail(line);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 3. 指标 ===');
const A = [1, 2, 3, 4];
const B = [1, 2, 3, 5];
const checks = [
  ['mse', 0.25],
  ['rmse', 0.5],
  ['mae', 0.25],
  ['mape', 6.25],      // 只有最后一个点 (4 vs 5) 有误差：|4-5|/4 = 25%，均值 25/4 = 6.25%
  ['smape', 100 * (2 / 9) / 4]  // 最后一个点 2*1/(4+5) = 2/9，均值再除 4
];
for (const [name, expected] of checks) {
  const got = judge.metrics[name](A, B);
  if (Math.abs(got - expected) > 1e-9) fail(`${name} = ${got}，期望 ${expected}`);
  else ok(`${name} = ${got}`);
}
// 0 值保护
const z = judge.metrics.mape([0, 0, 0], [1, 2, 3]);
if (z !== 0) fail('mape 对全 0 序列未做保护，返回 ' + z);
else ok('mape 全 0 保护 → 0');

/* ------------------------------------------------------------------ */
console.log('\n=== 4. 评分公式 ===');
const s = (r, t, ps) => judge.scoreForRatio(r, t, ps);
const cases = [
  [0.3, 0.95, 60, 100],
  [0.5, 0.95, 60, 100],
  [0.95, 0.95, 60, 60],
  [1.0, 0.95, 60, 57],
  [2.0, 0.95, 60, 0],
  [3.0, 0.95, 60, 0],
  [0.9, 0.9, 60, 60],
  [1.0, 1.0, 60, 60]
];
for (const [r, t, ps, want] of cases) {
  const got = s(r, t, ps);
  if (got !== want) fail(`scoreForRatio(${r}, ${t}, ${ps}) = ${got}，期望 ${want}`);
  else ok(`scoreForRatio(${r}, ${t}, ${ps}) = ${got}`);
}
// 单调性
let prev = 101;
for (let r = 0; r <= 2.5; r += 0.01) {
  const v = s(r, 0.9, 60);
  if (v > prev) { fail(`评分在 ratio=${r.toFixed(2)} 处不单调`); break; }
  prev = v;
}
if (prev >= 0) ok('评分随 ratio 单调不增');

/* ------------------------------------------------------------------ */
console.log('\n=== 5. 沙箱错误路径 ===');
const dsAirline = datasets.find((d) => d.id === 'airline');
const p1 = problems[0];

function runCase(label, code, expectVerdict) {
  const res = judge.evaluateSync({ problem: p1, dataset: dsAirline, code });
  const v = res.verdict;
  const msg = res.cases[0] && res.cases[0].error ? res.cases[0].error : '';
  if (v !== expectVerdict) fail(`${label}: verdict=${v}，期望 ${expectVerdict}（${msg}）`);
  else ok(`${label}: ${v}${msg ? ' — ' + msg : ''}`);
}

runCase('语法错误', 'function predict( {', 'RE');
runCase('长度错误', 'function predict(h, n, c) { return [1, 2]; }', 'RE');
runCase('含 NaN', 'function predict(h, n, c) { var o = []; for (var i = 0; i < n; i++) o.push(NaN); return o; }', 'RE');
runCase('抛异常', 'function predict(h, n, c) { throw new Error("boom"); }', 'RE');
runCase('没有 predict', 'var x = 1;', 'RE');
runCase('正常（参考解）', p1.solution, 'AC');
// p1 把 naive 放进了对照组：打平基线只有 57 分 → WA（这是设计意图，不是缺陷）
runCase('打平基线（naive）', NAIVE_CODE, 'WA');

// 行号映射
const lineRes = judge.evaluateSync({
  problem: p1,
  dataset: dsAirline,
  code: 'function predict(h, n, c) {\n  var x = 1;\n  throw new Error("boom");\n}'
});
const line = lineRes.cases[0].line;
if (line !== 3) fail(`行号映射错误：得到 ${line}，期望 3`);
else ok(`行号映射正确：第 ${line} 行`);

/* ------------------------------------------------------------------ */
console.log('\n=== 6. 测试点构造 ===');
const rolling = problems.find((p) => p.mode === 'rolling');
const dsEl = datasets.find((d) => d.id === rolling.dataset);
const pts = judge.buildTestPoints(dsEl.values, {
  mode: 'rolling',
  horizon: rolling.horizon,
  originStep: rolling.originStep,
  windows: rolling.windows,
  season: dsEl.season,
  freq: dsEl.freq,
  datasetId: dsEl.id
});
ok(`rolling 测试点数 = ${pts.length}，训练长度 = ${pts.map((x) => x.history.length).join('/')}`);
if (pts.length !== rolling.windows) fail('rolling 测试点数与 windows 不一致');
const lastPt = pts[pts.length - 1];
if (lastPt.history.length !== dsEl.values.length - rolling.horizon) fail('最后一个 origin 的训练集长度不正确');
else ok('最后一个 origin 的训练集截止于 len - horizon');

/* ------------------------------------------------------------------ */
console.log('\n=== 汇总 ===');
console.log('题目 | 难度 | 参考解分数 | passed | 朴素解分数');
for (const r of rows) {
  console.log(`#${r.idx} ${r.id.padEnd(20)} ${r.diff}  ${String(r.score).padStart(3)}  ${r.passed ? 'true ' : 'false'}  ${r.naiveScore}`);
}
console.log(failures === 0 ? '\nIS_PASS: YES' : `\nIS_PASS: NO（${failures} 项失败）`);
process.exit(failures === 0 ? 0 : 1);
