/**
 * onboarding-shell.test.js —— 首次引导不被初始路由关掉，工作台给对新入口，
 * 常见宽度下顶栏不再裁掉后排导航。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT } = require('./helpers/engine');
const { launch, findBrowser } = require('./helpers/cdp');

const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();

let page = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 25000, readyTimeout: 20000 });
});

test.after(() => { if (page) page.close(); });

async function freshHome() {
  // 空 hash 的真实首屏：清存储后把 hash 去掉再刷新，复现「第一次打开 index.html」
  await page.evaluate(`(function(){
    localStorage.clear();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  })()`);
  await page.reload();
  await sleep(400);
}

test('浏览器可用性检查（无浏览器则跳过）', (t) => {
  if (!HAS_BROWSER) {
    t.skip('本机未找到 Edge/Chrome，浏览器验收未验证');
    return;
  }
  assert.ok(page, 'CDP 连接失败');
});

test('首次进入：引导弹层在初始 hash 同步后仍然打开，主按钮指向第一课', async (t) => {
  if (!page) return t.skip('无浏览器');
  await freshHome();
  const first = await page.evaluate(`(function(){
    var ov = document.getElementById('overlay');
    var lesson = document.getElementById('onbLesson');
    var problem = document.getElementById('onbProblem');
    return {
      open: !!(ov && !ov.classList.contains('hidden') && ov.querySelector('.modal-onboard')),
      lesson: lesson ? lesson.getAttribute('href') : null,
      problem: problem ? problem.getAttribute('href') : null
    };
  })()`);
  assert.equal(first.open, true, '首屏没有打开引导弹层');
  assert.equal(first.lesson, '#/learn/m0', '引导主按钮应指向零基础第一课');
  assert.equal(first.problem, '#/problem/p1-naive', '引导次按钮应指向第 1 题');

  // 给「把空 hash 写成 #/」的 hashchange 留出时间，确认不会被关掉
  await sleep(500);
  const still = await page.evaluate(`(function(){
    var ov = document.getElementById('overlay');
    return !!(ov && !ov.classList.contains('hidden') && ov.querySelector('.modal-onboard'));
  })()`);
  assert.equal(still, true, '引导弹层被初始路由 / hashchange 关掉了');
});

test('新访客工作台：主 CTA 是第一课，而不是实验室', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.evaluate('localStorage.setItem("tsoj:onboarded", JSON.stringify(true));');
  await page.evaluate('location.hash = "#/"');
  await sleep(300);
  const r = await page.evaluate(`(function(){
    var primary = document.querySelector('#view .wk-cta-row .ds-btn-primary, #view .wk-cta-row a.ds-btn');
    var h1 = (document.querySelector('#view h1') || {}).textContent || '';
    return { href: primary ? primary.getAttribute('href') : null, text: primary ? primary.textContent.trim() : null, h1: h1 };
  })()`);
  assert.equal(r.href, '#/learn/m0', '新访客主 CTA 应是零基础第一课，实际：' + r.href + ' / ' + r.text);
  assert.match(r.h1, /看数据|工作台/, '新访客工作台标题应仍能被识别为首屏：' + r.h1);
});

test('1024×768 顶栏：主栏目不被裁切，后排入口在「更多」里可打开', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1024, height: 768, deviceScaleFactor: 1, mobile: false
  });
  try {
    await page.evaluate('localStorage.setItem("tsoj:onboarded", JSON.stringify(true)); location.hash = "#/"');
    await sleep(300);
    const r = await page.evaluate(`(function(){
      function box(sel) {
        var el = document.querySelector(sel);
        if (!el) return null;
        var b = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        return {
          display: cs.display,
          hidden: cs.display === 'none' || b.width === 0 || b.height === 0,
          right: Math.round(b.right),
          left: Math.round(b.left)
        };
      }
      var vw = window.innerWidth;
      var lab = box('#nav a[data-nav="lab"]');
      var studio = box('#nav a[data-nav="studio"]');
      var moreBtn = box('#btnNavMore');
      var menuBtn = box('#btnMenu');
      var path = document.querySelector('#nav a[data-nav="path"]');
      return {
        vw: vw,
        lab: lab,
        studio: studio,
        moreBtn: moreBtn,
        menuBtn: menuBtn,
        pathInMore: !!(path && path.closest('#navMoreMenu')),
        labClipped: !!(lab && !lab.hidden && lab.right > vw + 1),
        studioClipped: !!(studio && !studio.hidden && studio.right > vw + 1)
      };
    })()`);
    console.log('    1024 导航：' + JSON.stringify(r));
    assert.equal(r.moreBtn && r.moreBtn.hidden, false, '1024 宽度下应显示「更多」');
    assert.equal(r.menuBtn && r.menuBtn.hidden, true, '1024 宽度下不应再常驻「菜单」按钮');
    assert.equal(r.labClipped, false, '实验室入口被裁出视口');
    assert.equal(r.studioClipped, false, '模型工坊入口被裁出视口');
    assert.equal(r.pathInMore, true, '学习路径应放在「更多」菜单里');

    await page.evaluate('document.getElementById("btnNavMore").click()');
    await sleep(200);
    const open = await page.evaluate(`(function(){
      var menu = document.getElementById('navMoreMenu');
      var path = document.querySelector('#nav a[data-nav="path"]');
      if (!menu || !path) return { open: false };
      var b = path.getBoundingClientRect();
      return { open: !menu.hidden, pathVisible: b.width > 0 && b.height > 0 && b.bottom > 0 };
    })()`);
    assert.equal(open.open, true, '点击「更多」没有打开菜单');
    assert.equal(open.pathVisible, true, '「更多」打开后仍看不到学习路径');
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
});
