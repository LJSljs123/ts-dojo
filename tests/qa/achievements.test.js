/**
 * achievements.test.js —— 成就判定（纯逻辑，不需要浏览器）
 *
 * 重点锁住两条容易被写错的语义：
 *   1. 「半分神话」看**整题** score === 100，不是某个测试点满分（P9 有窗口 100 但整题 79）；
 *   2. 「词典编纂者」必须真的被 glossary 路由调用（onGlossaryLook 曾只定义不调用）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..', '..');

/** 最小 localStorage 桩：core.readJSON / writeJSON 只用到这三个方法。 */
const store = {};
globalThis.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; }
};

function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

delete globalThis.TSJ;
load('assets/js/app/util.js');
load('assets/js/app/core.js');

/** 重新执行 achievements.js，清掉闭包里的 unlocked 缓存。 */
function reset() {
  globalThis.localStorage.clear();
  load('assets/js/app/achievements.js');
  return globalThis.TSJ.appAchievements;
}

function has(ach, id) {
  const item = ach.status().filter((a) => a.id === id)[0];
  return !!(item && item.at);
}

const PROBS = [
  { id: 'p1', index: 1, difficulty: '入门' },
  { id: 'p2', index: 2, difficulty: '入门' },
  { id: 'p3', index: 3, difficulty: '普及' }
];

test('首个 AC：任意一题通过即解锁', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  assert.equal(has(ach, 'first-ac'), false);
  ach.onJudgeResult(PROBS[0], { passed: true, score: 73 }, { p1: { passed: true } });
  assert.equal(has(ach, 'first-ac'), true);
});

test('半分神话：整题 100 分解锁', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[0], { passed: true, score: 100 }, { p1: { passed: true } });
  assert.equal(has(ach, 'half-score'), true);
});

test('半分神话：单测试点 100 但整题 79 不解锁（P9 场景）', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[0],
    { passed: true, score: 79, cases: [{ score: 44 }, { score: 100 }, { score: 89 }, { score: 82 }] },
    { p1: { passed: true } });
  assert.equal(has(ach, 'half-score'), false, '单窗口满分不应解锁整题满分成就');
});

test('三连胜：按题号连续通过 3 道题', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[2], { passed: true, score: 70 },
    { p1: { passed: true }, p2: { passed: true }, p3: { passed: true } });
  assert.equal(has(ach, 'streak-3'), true);
});

test('三连胜：只通过两道不解锁', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[1], { passed: true, score: 70 },
    { p1: { passed: true }, p2: { passed: true } });
  assert.equal(has(ach, 'streak-3'), false);
});

test('入门毕业：全部入门题通过才解锁', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[0], { passed: true, score: 70 }, { p1: { passed: true } });
  assert.equal(has(ach, 'all-easy'), false, '只过一题不应毕业');
  ach.onJudgeResult(PROBS[1], { passed: true, score: 70 },
    { p1: { passed: true }, p2: { passed: true } });
  assert.equal(has(ach, 'all-easy'), true);
});

test('词典编纂者：累计查阅 20 次解锁，19 次不解锁', () => {
  const ach = reset();
  for (let i = 0; i < 19; i++) ach.onGlossaryLook();
  assert.equal(has(ach, 'glossary-reader'), false);
  ach.onGlossaryLook();
  assert.equal(has(ach, 'glossary-reader'), true);
});

test('解锁幂等：重复触发不改变解锁时间', () => {
  const ach = reset();
  globalThis.TSJ.problems = PROBS;
  ach.onJudgeResult(PROBS[0], { passed: true, score: 100 }, { p1: { passed: true } });
  const first = ach.status().filter((a) => a.id === 'first-ac')[0].at;
  ach.onJudgeResult(PROBS[0], { passed: true, score: 100 }, { p1: { passed: true } });
  const second = ach.status().filter((a) => a.id === 'first-ac')[0].at;
  assert.equal(first, second);
});
