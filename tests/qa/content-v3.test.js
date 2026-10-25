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
require('../../assets/js/content/glossary.js');
require('../../assets/js/content/content.js');

/** 内容规模契约：v3.2 扩充后为 46 方法（13/3/14/10/6 五层）+ 8 课程 + 术语表。 */
const METHOD_COUNT = 46;
const TIER_COUNTS = { classic: 13, competition: 3, deep: 14, foundation: 10, eval: 6 };

test('内容完整性：9 课程（含 m0 零基础课）/ 46 方法详情 / 引用全部通过 validate()', () => {
  assert.equal(TSJ.courses.length, 9);
  assert.equal(TSJ.methods.length, METHOD_COUNT);
  assert.equal(Object.keys(TSJ.methodDetails).length, METHOD_COUNT);
  const byTier = {};
  for (const m of TSJ.methods) byTier[m.tier] = (byTier[m.tier] || 0) + 1;
  assert.deepEqual(byTier, TIER_COUNTS, '五层数量与内容契约不一致');
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

test('术语表：字段齐全、分类合法、see 与 links 全部指向真实目标', () => {
  const terms = TSJ.glossary;
  const cats = new Set(TSJ.glossaryCategories.map((c) => c.id));
  const termIds = new Set(terms.map((t) => t.id));
  assert.ok(terms.length >= 50, '术语应至少 50 条，实际 ' + terms.length);

  for (const t of terms) {
    assert.ok(t.id && t.term && t.en && t.def, (t.id || '?') + ' 缺基础字段');
    assert.ok(t.def.length >= 10, t.id + ' 定义过短');
    assert.ok(cats.has(t.cat), t.id + ' 分类非法：' + t.cat);
    for (const s of t.see || []) {
      assert.ok(termIds.has(s), t.id + ' 的 see 指向不存在的术语：' + s);
    }
    const L = t.links || {};
    if (L.course) assert.ok(TSJ.content.course(L.course), t.id + ' 链接的课程不存在：' + L.course);
    if (L.method) assert.ok(TSJ.methodsById(L.method), t.id + ' 链接的方法不存在：' + L.method);
    if (L.problem) assert.ok(TSJ.findProblem(L.problem), t.id + ' 链接的题目不存在：' + L.problem);
  }
});
