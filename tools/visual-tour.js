/**
 * tools/visual-tour.js —— 视觉巡检：全页截图（captureBeyondViewport，1280 桌面视口）
 *
 * 用法：node tools/visual-tour.js [输出目录]
 * 覆盖：全部 12 条路由（深色）+ 实验室/题目页运行态 + 浅色代表页 + 375 窄屏代表页。
 * 注意：tsoj:theme 必须写 JSON 字符串（产品 readJSON 走 JSON.parse），写裸字符串会被丢弃回落 system。
 * 截图输出到 <repo>/../tour/（默认，可用参数覆盖）；巡检完可整目录删除。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch, findBrowser } = require('../tests/qa/helpers/cdp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'tour'));
const INDEX = pathToFileURL(path.join(ROOT, 'index.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  ['dashboard', '#/'],
  ['problems', '#/problems'],
  ['problem', '#/problem/p1-naive'],
  ['methods', '#/methods'],
  ['method-detail', '#/methods/dlinear'],
  ['learn', '#/learn'],
  ['module-m0', '#/learn/m0'],
  ['lab', '#/lab'],
  ['glossary', '#/glossary'],
  ['submissions', '#/submissions'],
  ['ranking', '#/ranking'],
  ['path', '#/path'],
];

async function shot(page, name) {
  const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  ✓ ' + name);
}

async function setViewport(page, w, h, mobile) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile,
  });
  await sleep(150);
}

(async () => {
  if (!findBrowser()) { console.error('找不到浏览器'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const page = await launch(INDEX, { timeout: 25000, readyTimeout: 20000 });
  try {
    await page.evaluate(
      '(function(){try{localStorage.clear();localStorage.setItem("tsoj:onboarded","true");' +
      'localStorage.setItem("tsoj:theme", JSON.stringify("dark"));}catch(e){}})()'
    );
    await setViewport(page, 1280, 800, false);
    await page.reload();
    await sleep(500);

    // ---- 深色 · 全路由 ----
    console.log('dark 1280:');
    for (const [name, hash] of ROUTES) {
      await page.evaluate('location.hash = ' + JSON.stringify(hash));
      await sleep(600);
      await shot(page, 'dark-' + name);
    }

    // ---- 运行态 ----
    console.log('dark running states:');
    await page.evaluate('location.hash = "#/lab"');
    await sleep(500);
    await page.evaluate('document.getElementById("labRun").click()');
    await sleep(3500);
    await shot(page, 'dark-lab-run');
    await page.evaluate('location.hash = "#/problem/p1-naive"');
    await sleep(600);
    await page.evaluate('document.getElementById("btnRun").click()');
    await sleep(2500);
    await shot(page, 'dark-problem-run');

    // ---- 浅色 · 代表页（theme 值必须写 JSON）----
    console.log('light 1280:');
    await page.evaluate('(function(){try{localStorage.setItem("tsoj:theme", JSON.stringify("light"));}catch(e){}})()');
    await page.reload();
    await sleep(600);
    await page.evaluate('location.hash = "#/"');
    await sleep(600);
    await shot(page, 'light-dashboard');
    await page.evaluate('location.hash = "#/problem/p1-naive"');
    await sleep(600);
    await shot(page, 'light-problem');
    await page.evaluate('location.hash = "#/methods"');
    await sleep(600);
    await shot(page, 'light-methods');
    await page.evaluate('location.hash = "#/lab"');
    await sleep(500);
    await page.evaluate('document.getElementById("labRun").click()');
    await sleep(3500);
    await shot(page, 'light-lab-run');
    await page.evaluate('location.hash = "#/glossary"');
    await sleep(600);
    await shot(page, 'light-glossary');

    // ---- 窄屏 375（深色，恢复主题）----
    console.log('dark 375:');
    await page.evaluate('(function(){try{localStorage.setItem("tsoj:theme", JSON.stringify("dark"));}catch(e){}})()');
    await setViewport(page, 375, 812, true);
    await page.reload();
    await sleep(600);
    for (const [name, hash] of [['dashboard', '#/'], ['problems', '#/problems'], ['methods', '#/methods'], ['glossary', '#/glossary']]) {
      await page.evaluate('location.hash = ' + JSON.stringify(hash));
      await sleep(600);
      await shot(page, 'narrow-' + name);
    }
    console.log('完成：' + OUT);
  } finally { page.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
