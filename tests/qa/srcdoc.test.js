/**
 * L 组：srcdoc 宿主环境（预览面板 / 文档阅读器）
 *
 * 为什么单开一组：
 *   预览面板、文档阅读器这类宿主**不打开文件**，而是把 HTML 内容塞进
 *   `<iframe srcdoc="...">` 渲染。此时文档处于「不透明源」，`document.URL`
 *   是 `about:srcdoc` —— **它没有自己的 base URL**。
 *
 *   而应用全站用 `<a href="#/problems">` 做路由。在普通页面里这是同文档片段导航，
 *   但在 srcdoc 里，`#/problems` 会按**父页面的 base** 解析成
 *   `file:///.../host.html#/problems`：那是另一个 URL，于是浏览器执行**真实导航**，
 *   把 iframe 指向宿主页面 —— 应用整个被卸载，`window.TSJ` 消失。
 *
 *   用户看到的现象就是「点哪个都没反应」（其实是点一下应用就没了）。
 *
 * 这一组用例把这个环境固化成可复现的回归：**站内链接点下去，应用必须还在。**
 *
 * 单文件版是**现场构建**的（`tools/build-standalone.js#buildHtml`），不读已提交的
 * 产物 —— 否则改了源码却拿旧产物测试，正是要避免的假绿。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { launch, findBrowser } = require('./helpers/cdp.js');
const { buildHtml } = require('../../tools/build-standalone.js');

const HAS_BROWSER = !!findBrowser();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 就绪判据必须探进 iframe：顶层窗口没有 TSJ。 */
const READY = `(function(){
  var f = document.getElementById('tsjFrame');
  if (!f || !f.contentWindow) return false;
  var w = f.contentWindow;
  var d = w.document;
  var v = d && d.getElementById('view');
  return !!(w.TSJ && typeof w.TSJ.findProblem === 'function' && v && v.innerHTML.length > 0);
})()`;

/** iframe 内快照：URL 是否还在 srcdoc、TSJ 是否还在、视图长度。 */
const INNER = `(function(){
  var f = document.getElementById('tsjFrame');
  var w = f.contentWindow;
  var d = w.document;
  var v = d.getElementById('view');
  return {
    url: String(d.URL),
    stillSrcdoc: String(d.URL).indexOf('about:srcdoc') === 0,
    tsj: w.TSJ ? Object.keys(w.TSJ).length : 0,
    len: v ? v.innerHTML.length : -1,
    hash: String(w.location.hash),
    text: v ? (v.textContent || '').replace(/\\s+/g, ' ').slice(0, 60) : ''
  };
})()`;

let hostFile = '';
let hostDir = '';

test.before(() => {
  if (!HAS_BROWSER) return;
  const { html } = buildHtml();
  // srcdoc 是属性值：先转 & 再转 "，顺序不能反
  const escaped = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsoj-srcdoc-'));
  hostFile = path.join(hostDir, 'host.html');
  fs.writeFileSync(
    hostFile,
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;height:100%}iframe{width:100%;height:100vh;border:0}</style>' +
      '</head><body><iframe id="tsjFrame" title="TSOJ 单文件版" srcdoc="' + escaped + '"></iframe></body></html>',
    'utf8'
  );
});

test.after(() => {
  if (hostDir) {
    try { fs.rmSync(hostDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
});

/** 在 iframe 内按选择器真实点击（坐标与顶层视口一致：iframe 占满整页）。 */
async function clickInside(page, sel) {
  const box = await page.evaluate(`(function(){
    var d = document.getElementById('tsjFrame').contentDocument;
    var el = d.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  assert.ok(box, '找不到要点击的元素：' + sel);
  assert.ok(box.w > 4 && box.h > 4, sel + ' 尺寸过小（' + box.w + 'x' + box.h + '），点不到');
  const b = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await page.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, b));
  await page.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, b));
  await page.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, b));
  return box;
}

async function openHost() {
  const page = await launch('file://' + hostFile.replace(/\\/g, '/'), { readyExpr: READY, readyTimeout: 20000 });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  return page;
}

test('L01 srcdoc 宿主里应用能启动：URL 是 about:srcdoc，视图已渲染', async (t) => {
  if (!HAS_BROWSER) return t.skip('无浏览器');
  const page = await openHost();
  const s = await page.evaluate(INNER);
  console.log('    URL=' + s.url + ' · TSJ 键=' + s.tsj + ' · 视图=' + s.len + ' 字符');
  assert.equal(s.stillSrcdoc, true, 'iframe 的 URL 不是 about:srcdoc（' + s.url + '）');
  assert.ok(s.tsj >= 40, 'TSJ 命名空间不完整（' + s.tsj + ' 个键）');
  assert.ok(s.len > 1000, '首页没有渲染出来（' + s.len + ' 字符）');
  await page.close();
});

test('L02 点顶栏导航后应用必须还在（srcdoc 里 href="#/x" 会解析成父页面 URL）', async (t) => {
  if (!HAS_BROWSER) return t.skip('无浏览器');
  const page = await openHost();

  await clickInside(page, '#nav a[href="#/problems"]');
  await sleep(900);
  const s = await page.evaluate(INNER);
  console.log('    点「题库」→ URL=' + s.url + ' · TSJ=' + s.tsj + ' · 视图=' + s.len + ' 字符 · 「' + s.text + '」');

  assert.equal(s.stillSrcdoc, true,
    '点击后 iframe 被导航到了 ' + s.url + ' —— 应用已被卸载（这就是「点哪个都没反应」）');
  assert.ok(s.tsj >= 40, '点击后 TSJ 只剩 ' + s.tsj + ' 个键：应用被卸载了');
  assert.equal(s.hash, '#/problems', '路由没有切到题库（hash=' + s.hash + '）');
  assert.ok(s.len > 5000, '题库没有渲染出来（' + s.len + ' 字符）');
  assert.match(s.text, /题库/, '题库页正文里没有「题库」');
  await page.close();
});

test('L03 站内链接连续跳转：题库 → 题目页 → 返回，全程留在应用内', async (t) => {
  if (!HAS_BROWSER) return t.skip('无浏览器');
  const page = await openHost();

  await clickInside(page, '#nav a[href="#/problems"]');
  await sleep(800);
  await clickInside(page, '#view .prow, #view .pcard');
  await sleep(900);
  const onProblem = await page.evaluate(INNER);
  console.log('    点题卡 → ' + onProblem.hash + ' · 视图 ' + onProblem.len + ' 字符');
  assert.equal(onProblem.stillSrcdoc, true, '点题卡后应用被卸载（URL=' + onProblem.url + '）');
  assert.match(onProblem.hash, /^#\/problem\//, '没有进入题目页（hash=' + onProblem.hash + '）');
  assert.ok(onProblem.len > 2000, '题目页没有渲染（' + onProblem.len + ' 字符）');

  // 题目页里的站内链接（面包屑 / 相关方法）
  await clickInside(page, '#view a[href^="#/methods"], #view a[href^="#/problems"]');
  await sleep(900);
  const after = await page.evaluate(INNER);
  console.log('    再点站内链接 → ' + after.hash + ' · 视图 ' + after.len + ' 字符');
  assert.equal(after.stillSrcdoc, true, '第二次跳转后应用被卸载（URL=' + after.url + '）');
  assert.ok(after.tsj >= 40, '第二次跳转后 TSJ 丢失');
  assert.ok(after.len > 1000, '第二次跳转后视图为空（' + after.len + ' 字符）');
  await page.close();
});

test('L04 跳转链接 #view 只移动焦点，不改路由（否则会被当成未知视图渲染成题库）', async (t) => {
  if (!HAS_BROWSER) return t.skip('无浏览器');
  const page = await openHost();

  const before = await page.evaluate(INNER);
  assert.equal(before.hash, '#/', '起始路由不是首页（' + before.hash + '）');

  await page.evaluate(`(function(){
    document.getElementById('tsjFrame').contentDocument.querySelector('.ds-skip-link').click();
  })()`);
  await sleep(500);
  const after = await page.evaluate(INNER);
  const focus = await page.evaluate(`(function(){
    var d = document.getElementById('tsjFrame').contentDocument;
    return d.activeElement ? (d.activeElement.id || d.activeElement.tagName) : null;
  })()`);
  console.log('    点跳转链接 → hash=' + after.hash + ' · 焦点=' + focus + ' · 视图 ' + after.len + ' 字符');

  assert.equal(after.hash, '#/', '点「跳到主要内容」把路由改成了 ' + after.hash + '（应保持首页）');
  assert.equal(focus, 'view', '点「跳到主要内容」后焦点没有落到 #view（实际 ' + focus + '）');
  assert.ok(after.len > 1000, '视图被跳转链接清空了（' + after.len + ' 字符）');
  await page.close();
});
