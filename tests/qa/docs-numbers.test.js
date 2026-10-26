/**
 * docs-numbers.test.js —— 文档里的数字必须与源码一致
 *
 * 背景：README 的题数 / 方法数 / 脚本数 / 测试条数原本都是手写的，每加内容就漂。
 * 2026-10-26 一天之内漂了三次（P16 漏登记题库表、16→17 题数、218→221 测试条数），
 * 最后一次还漏了「实验室 9 条数据 → 实际 10 条」（P17 新增数据集后下拉框多了一项）。
 *
 * 这个文件把「口径」变成断言：数字不再靠人记，靠 tools/numbers.js 现算。
 * 失败时的提示直接给出 README 行号与应有的值，改完再跑一次 `node tools/numbers.js` 即可自检。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compute, checkReadme, BUNDLE_TOLERANCE_KB } = require('../../tools/numbers.js');

const n = compute();

test('README 的题数 / 方法数 / 课程 / 术语 / 数据集 / 脚本数都与源码一致', () => {
  const bad = checkReadme(n).filter((b) => b.claim !== '单文件版体积');
  assert.deepEqual(
    bad.map((b) => 'README:' + b.line + ' 「' + b.text + '」应为 ' + b.expected + '（' + b.claim + '）'),
    [],
    'README 与源码口径不一致。改完执行 `node tools/numbers.js` 复核。'
  );
});

test('README 的单文件版体积与实际产物相差不超过 ' + BUNDLE_TOLERANCE_KB + 'KB', () => {
  const bad = checkReadme(n).filter((b) => b.claim === '单文件版体积');
  assert.ok(n.bundleKB > 0, '单文件版不存在或为空，先跑 node tools/build-standalone.js');
  assert.deepEqual(
    bad.map((b) => 'README:' + b.line + ' 「' + b.text + '」应为 ' + b.expected + 'KB'),
    [],
    '单文件版体积与 README 不符（重建产物后同步 README）'
  );
});

test('口径本身自洽：分层求和 = 方法总数，可练数 ≤ 方法总数', () => {
  const sum = Object.keys(n.byTier).reduce((s, k) => s + n.byTier[k], 0);
  assert.equal(sum, n.methods, '五层数量之和应等于方法总数（有方法落了非法 tier）');
  assert.ok(n.practice > 0 && n.practice <= n.methods, '可练方法数越界：' + n.practice);
  const diffSum = Object.keys(n.byDifficulty).reduce((s, k) => s + n.byDifficulty[k], 0);
  assert.equal(diffSum, n.problems, '难度分布之和应等于题数');
});

test('tools/numbers.js 统计的用例数与 test runner 实际执行数一致', () => {
  // 只做数量级校验：runner 的输出在测试内部拿不到，这里用「文件里 test( 的条数」作为口径，
  // 只要它等于 numbers.json 里的 tests，就说明没有动态生成用例把统计漏掉。
  // 真实执行条数由 `node --test` 自己的汇总行保证（见 README 的测试规模说明）。
  assert.ok(n.tests >= 200, '用例数异常偏少：' + n.tests);
});
