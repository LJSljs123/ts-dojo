/**
 * v3-browser.test.js —— v3 前端升级的浏览器验收（真实无头 Edge/Chrome + CDP）
 *
 * 覆盖：新路由、课程/方法详情渲染、实验室端到端、主题持久化、窄屏无溢出、
 *      路由切换后画布与监听不残留。找不到浏览器时整体 skip（与既有用例口径一致）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT, loadEngine } = require('./helpers/engine');
const { launch, findBrowser } = require('./helpers/cdp');

const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();
const COURSE_COUNT = (() => {
  global.window = global;
  loadEngine({ fresh: true });
  require('../../assets/js/methods.js');
  require('../../assets/js/content/courses.js');
  return TSJ.courses.length;
})();

let page = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 25000, readyTimeout: 20000 });
  await page.evaluate('(function(){localStorage.clear();localStorage.setItem("tsoj:onboarded","true");})()');
  await page.reload();
});

test.after(() => { if (page) page.close(); });

async function goto(hash) {
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(450);
  return page.evaluate('(function(){var v=document.querySelector("#view");return {html:v.innerHTML.length, text:(v.innerText||"").slice(0,80)};})()');
}

test('v3 新路由全部可渲染，且旧路由不回归', async (t) => {
  if (!page) return t.skip('无浏览器');
  for (const hash of ['#/', '#/problems', '#/methods', '#/learn', '#/learn/m1', '#/lab', '#/methods/dlinear']) {
    const r = await goto(hash);
    assert.ok(r.html > 500, hash + ' 渲染内容过少（' + r.html + ' 字节）');
    assert.ok(r.text.length > 0, hash + ' 文本为空');
  }
  assert.deepEqual(page.exceptions, [], '新路由出现未捕获异常：' + JSON.stringify(page.exceptions));
});

test('课程页：正文、公式面板、参考来源与练习出口都在', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/learn/m2');
  const info = await page.evaluate(`JSON.stringify({
    h1: (document.querySelector('#view h1')||{}).textContent,
    formulas: document.querySelectorAll('#view .md-formula').length,
    refs: document.querySelectorAll('#view .course-refs a').length,
    demo: !!document.querySelector('#view a[href^="#/lab"]'),
    exercise: document.querySelectorAll('#view .course-panel a[href^="#/problem/"]').length
  })`);
  const m = JSON.parse(info);
  assert.match(String(m.h1), /经典统计与诊断/);
  assert.ok(m.formulas >= 2, '课程应渲染公式面板，实际 ' + m.formulas);
  assert.ok(m.refs >= 1, '课程应给出来源链接');
  assert.ok(m.demo, '课程应有演示出口');
  assert.ok(m.exercise >= 1, '课程应有练习出口');
});

test('方法详情：运行级别徽标、公式、引用与「去练这道题」出口', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/methods/dlinear');
  const info = await page.evaluate(`JSON.stringify({
    title: (document.querySelector('#view h1')||{}).textContent,
    badges: [].map.call(document.querySelectorAll('#view .ds-badge'), b=>b.textContent.trim()),
    formula: document.querySelectorAll('#view .md-formula').length,
    refs: document.querySelectorAll('#view .course-refs a').length,
    practice: (document.querySelector('#view a[href^="#/problem/"]')||{}).getAttribute ? document.querySelector('#view a[href^="#/problem/"]').getAttribute('href') : null
  })`);
  const m = JSON.parse(info);
  assert.match(String(m.title), /DLinear/);
  assert.ok(m.badges.some((b) => b.indexOf('可沙箱运行') >= 0), '缺少运行级别徽标：' + m.badges.join('|'));
  assert.ok(m.formula >= 1, '方法详情应有关键式子');
  assert.ok(m.refs >= 1, '方法详情应有引用');
  assert.equal(m.practice, '#/problem/p15-dlinear');
});

test('无效方法 ID 返回方法库，不留坏后退栈', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.evaluate('location.hash = "#/methods/not-exist"');
  await sleep(400);
  const hash = await page.evaluate('location.hash');
  assert.equal(hash, '#/methods');
});

test('实验室端到端：运行后有指标、画布几何与历史记录', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/lab');
  await page.evaluate('document.getElementById("labRun").click()');
  const done = await (async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const s = await page.evaluate('(document.getElementById("labStatus")||{}).textContent');
      if (s && s.indexOf('完成') === 0) return s;
      await sleep(150);
    }
    return null;
  })();
  assert.ok(done, '实验室未在 15s 内完成');
  const info = await page.evaluate(`JSON.stringify({
    canvas: !!document.getElementById('labCanvas'),
    geom: !!(document.getElementById('labCanvas')||{}).__tsjGeom,
    table: document.querySelectorAll('#view .ds-table tbody tr').length,
    history: document.querySelectorAll('#labHistory .lab-history-item').length
  })`);
  const m = JSON.parse(info);
  assert.ok(m.canvas && m.geom, '结果画布或几何信息缺失');
  assert.ok(m.table >= 2, '指标表行数不足：' + m.table);
  assert.ok(m.history >= 1, '实验记录未保存');
  assert.deepEqual(page.exceptions, [], '实验室出现未捕获异常：' + JSON.stringify(page.exceptions));
});

test('主题切换：写入 localStorage 并跨刷新保留', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/');
  const before = await page.evaluate('document.documentElement.getAttribute("data-theme")');
  await page.evaluate('document.getElementById("btnTheme").click()');
  const after = await page.evaluate('document.documentElement.getAttribute("data-theme")');
  assert.notEqual(before, after, '主题切换后未变化');
  const stored = await page.evaluate('localStorage.getItem("tsoj:theme")');
  const mode = stored ? JSON.parse(stored) : null;
  assert.ok(['system', 'light', 'dark'].includes(mode), '主题未正确持久化：' + stored);
  await page.reload();
  await sleep(300);
  const reloaded = await page.evaluate('document.documentElement.getAttribute("data-theme")');
  assert.equal(reloaded, after, '刷新后主题丢失');
});

test('窄屏：题库与实验室 375px 不横向溢出，标签云默认折叠', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 820, deviceScaleFactor: 1, mobile: true });
  await goto('#/problems');
  const p = JSON.parse(await page.evaluate(`JSON.stringify({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    tagHidden: document.getElementById('tagCloud').hidden,
    rows: document.querySelectorAll('.prow, .pcard').length
  })`));
  assert.equal(p.scrollW, 375, '题库 375px 横向溢出：' + p.scrollW);
  assert.equal(p.clientW, 375);
  assert.equal(p.tagHidden, true, '窄屏标签云应默认折叠');
  assert.ok(p.rows > 0, '窄屏题库没有题目');

  await goto('#/lab');
  const l = JSON.parse(await page.evaluate(`JSON.stringify({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  })`));
  assert.equal(l.scrollW, 375, '实验室 375px 横向溢出：' + l.scrollW);
  await page.send('Emulation.clearDeviceMetricsOverride');
});

test('生命周期：连续 20 次路由切换无异常，离开实验室后画布被清理', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/lab');
  await page.evaluate('document.getElementById("labRun").click()');
  await sleep(1200);
  const hasCanvas = await page.evaluate('!!document.getElementById("labCanvas")');
  assert.ok(hasCanvas, '实验室应创建画布');
  for (let i = 0; i < 20; i++) {
    await page.evaluate('location.hash = ' + JSON.stringify(i % 2 ? '#/learn/m1' : '#/lab'));
    await sleep(60);
  }
  await goto('#/problems');
  const left = await page.evaluate('document.querySelectorAll("#view canvas").length');
  assert.equal(left, 0, '离开实验室/课程后仍残留画布：' + left);
  assert.deepEqual(page.exceptions, [], '连续路由切换出现异常：' + JSON.stringify(page.exceptions));
});

test('课程模块数量与内容层一致', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/learn');
  const cards = await page.evaluate('document.querySelectorAll(".course-module").length');
  assert.equal(cards, COURSE_COUNT, '课程地图模块数与内容层不一致');
});
