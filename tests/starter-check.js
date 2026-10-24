/**
 * tests/starter-check.js —— 模板（starter）有效性自证
 *
 *   node tests/starter-check.js
 *
 * 检查项：
 *   1. 每题 starter 语法合法、能定义出 predict（否则学习者拿到的是 RE 而不是 WA）
 *   2. 每题 starter 原样提交必然不通过（9/9 全 WA，且分数/窗口分低于通过线）
 *   3. 每题参考解（solution）仍然通过
 *   4. 题面提示（hints）没有把 starter 的洞直接写成答案
 *
 * 退出码：0 = 全部符合预期，1 = 有题目能被模板直接通过
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const datasets = require(path.join(ROOT, 'assets/js/datasets.js'));
const problems = require(path.join(ROOT, 'assets/js/problems.js'));
const judge = require(path.join(ROOT, 'assets/js/judge.js'));

let failures = 0;

/**
 * 判一次题。
 * @param {Object} p 题目
 * @param {string} code 用户代码
 * @returns {Object} 判题报告
 */
function evalCode(p, code) {
  const ds = datasets.find((d) => d.id === p.dataset);
  return judge.evaluateSync({ problem: p, dataset: ds, code });
}

/**
 * 打印一行并累计失败数。
 * @param {boolean} ok 是否通过
 * @param {string} msg 说明
 */
function check(ok, msg) {
  if (!ok) {
    failures++;
    console.log('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
}

/* ------------------------------------------------------------------ */
console.log('\n=== 1. starter 语法 / 结构 ===');
for (const p of problems) {
  let fn = null;
  let err = null;
  try {
    /* eslint-disable no-new-func */
    fn = new Function(p.starter + '\nreturn predict;')();
  } catch (e) {
    err = e;
  }
  check(!err && typeof fn === 'function', `${p.id} starter 可编译且定义了 predict${err ? '：' + err.message : ''}`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 2. starter 原样提交：必须全部不通过 ===');
const rows = [];
for (const p of problems) {
  const res = evalCode(p, p.starter);
  const windowScores = res.cases.map((c) => c.score).join('/');
  rows.push({
    idx: p.index,
    id: p.id,
    mode: p.mode,
    score: res.score,
    passScore: p.passScore,
    verdict: res.verdict,
    passed: res.passed,
    windowScores
  });
  check(res.passed === false, `${p.id} 模板未通过（${res.score} 分 / ${res.verdict}，窗口分 ${windowScores}）`);
  check(res.verdict === 'WA', `${p.id} 模板的 verdict 是 WA（不是 RE/TLE）`);
  if (p.mode === 'rolling') {
    check(
      res.cases.some((c) => c.score < p.passScore),
      `${p.id} 至少一个窗口低于通过线（${windowScores}）`
    );
  } else {
    check(res.score < p.passScore, `${p.id} 模板得分 ${res.score} < 通过线 ${p.passScore}`);
  }
}

/* ------------------------------------------------------------------ */
console.log('\n=== 3. 参考解仍然通过 ===');
for (const p of problems) {
  const res = evalCode(p, p.solution);
  check(res.passed === true && res.verdict === 'AC', `${p.id} 参考解 ${res.score} 分 ${res.verdict}`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 4. hints 不含完整答案（不出现可直接抄的赋值 / 完整公式） ===');
const BANNED = [
  /history\[n - m \+ \(h % m\)\]/,
  /out\[h\]\s*=\s*prof/,
  /level\s*=\s*alpha\s*\*\s*history\[i\]\s*\+\s*\(1\s*-\s*alpha\)\s*\*\s*level/,
  /season\[i\]\s*=\s*history\[i\]\s*-/,
  /resid\[t % m\]\s*\+=/,
  /a \+ b\s*\*\s*\(2m\s*-\s*1\)/
];
for (const p of problems) {
  const joined = p.hints.join('\n');
  const hit = BANNED.filter((re) => re.test(joined)).map(String);
  check(hit.length === 0, `${p.id} hints 未泄露完整答案${hit.length ? '：命中 ' + hit.join(' , ') : ''}`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== 汇总表：模板原样提交 ===');
console.log('题目 | 编号 | 模式 | 得分 | 通过线 | verdict | passed | 逐窗口得分');
for (const r of rows) {
  console.log(
    `${r.id.padEnd(20)} #${r.idx} ${r.mode.padEnd(8)} ${String(r.score).padStart(3)} / ${String(r.passScore).padStart(3)} ` +
    `${r.verdict.padEnd(3)} passed=${String(r.passed).padEnd(5)} 窗口分=[${r.windowScores}]`
  );
}

console.log(failures === 0 ? '\nIS_PASS: YES' : `\nIS_PASS: NO（${failures} 项失败）`);
process.exit(failures === 0 ? 0 : 1);
