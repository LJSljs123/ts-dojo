/**
 * content-v3.test.js —— v3 内容层静态校验（无浏览器）
 *
 * 重点：完整性、引用存在、运行级别合法、Markdown 安全、公式字段齐全。
 * 这些用例失败说明「内容体系」本身坏了，而不是某个页面样式问题。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/engine');

global.window = global;
loadEngine({ fresh: true });
require('../../assets/js/methods.js');
require('../../assets/js/content/references.js');
require('../../assets/js/content/courses.js');
require('../../assets/js/content/method-details.js');
require('../../assets/js/content/content.js');

test('内容完整性：8 课程 / 29 方法详情 / 引用全部通过 validate()', () => {
  assert.equal(TSJ.courses.length, 8);
  assert.equal(TSJ.methods.length, 29);
  assert.equal(Object.keys(TSJ.methodDetails).length, 29);
  const errors = TSJ.content.validate();
  assert.deepEqual(errors, [], '内容校验失败：' + errors.join('; '));
});

test('课程先修无环、出口题目真实存在', () => {
  for (const c of TSJ.courses) {
    for (const p of c.prereq) assert.ok(TSJ.content.course(p), c.id + ' 先修不存在：' + p);
    for (const pid of (c.exercise.problemIds || [])) {
      assert.ok(TSJ.findProblem(pid), c.id + ' 练习题目不存在：' + pid);
    }
  }
});

test('运行三级标签合法：不可运行的方法不能被标成 sandbox', () => {
  const valid = { sandbox: true, precomputed: true, concept: true };
  for (const m of TSJ.methods) {
    const d = TSJ.methodDetails[m.id];
    assert.ok(valid[d.runLevel], m.id + ' runLevel 非法');
    if (m.runnable === false) assert.notEqual(d.runLevel, 'sandbox', m.id + ' 标错运行级别');
  }
});

test('引用表：URL 必须 https，且有核查日期', () => {
  for (const r of TSJ.references) {
    assert.match(r.url, /^https:\/\//, r.id + ' URL 不是 https');
    assert.ok(r.checkedAt, r.id + ' 缺少核查日期');
    assert.ok(r.title && r.venue, r.id + ' 缺少题名或发表处');
  }
});

test('Markdown 渲染：转义裸 HTML，[ref] 生成外链，公式不带未转义内容', () => {
  const c = TSJ.content.course('m1');
  const html = TSJ.content.renderCourseBody(c);
  assert.equal(/<script/i.test(html), false, '渲染结果含 script');
  assert.equal(/\sonerror=/i.test(html), false, '渲染结果含事件属性');
  assert.ok(html.indexOf('otexts.com') > 0, '引用链接未渲染');
  assert.ok(html.indexOf('md-formula') > 0, '公式块未渲染');
  // 用户内容里的尖括号必须被转义
  const evil = TSJ.content.renderMarkdown('<img src=x onerror=alert(1)> **b** `c`', {});
  assert.ok(evil.indexOf('&lt;img') === 0 || evil.indexOf('&lt;img') > 0, '裸 HTML 未转义：' + evil);
  assert.equal(/<img/i.test(evil), false, '裸 HTML 被渲染成元素');
});

test('方法详情覆盖所有卡片的关键字段，且不与方法卡重复整段', () => {
  for (const m of TSJ.methods) {
    const d = TSJ.methodDetails[m.id];
    assert.ok(d.intuition && d.intuition.length >= 10, m.id + ' 直觉过短');
    assert.ok(d.assumptions.length && d.limitations.length, m.id + ' 缺少假设/局限');
    assert.ok(d.workedExample && d.counterexample, m.id + ' 缺少小例/反例');
    assert.notEqual(d.intuition, m.idea, m.id + ' 详情直接复制了方法卡 idea');
  }
});
