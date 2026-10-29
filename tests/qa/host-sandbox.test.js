/**
 * tests/qa/host-sandbox.test.js —— 非文件宿主（`<iframe srcdoc>` + `sandbox`）
 *
 * 为什么必须单独测宿主：
 *
 *   预览面板、文档阅读器不打开文件，而是把 HTML 塞进 `<iframe srcdoc>`，而且通常带
 *   `sandbox`。这个 iframe 有三种形态，行为完全不同，前两种以前一条用例都没有：
 *
 *     | sandbox 属性                      | 脚本 | 同源 | 用户看到 |
 *     |-----------------------------------|------|------|----------|
 *     | （无）                             | 跑   | 是   | 正常 |
 *     | allow-scripts                     | 跑   | 否   | 正常（跨源，测不了 DOM，只能 postMessage 桥） |
 *     | allow-scripts allow-same-origin   | 跑   | 是   | 正常 |
 *     | 空 / 不含 allow-scripts            | 不跑 | 否   | **只剩顶栏，内容区全空，点哪都没反应** |
 *
 *   最后一格就是用户报的「我点击没一个能用」：页面看着是活的（顶栏有样式、导航会高亮），
 *   但脚本根本没执行，`#view` 永远是空的，任何点击都不可能有反应。
 *   代码层面唯一能做的是**把原因说出来** —— 一个 `<noscript>` 卡片，且必须落在首屏内。
 *   原来那句兜底文案放在 `<main>` 之后，被 `min-height:calc(100vh - 顶栏)` 顶到屏幕外，
 *   等于「有兜底但看不见」。H03 守的就是这条。
 *
 * 另外守一条：启动自检不能把「运行期错误」升级成全屏遮罩（遮罩 position:fixed +
 * z-index:99999，一旦出现就吞掉所有点击 —— 一个按钮报错会放大成「整站点点不动」）。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cdp = require('./helpers/cdp');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(os.tmpdir(), 'tsj-qa-host');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STANDALONE = path.join(ROOT, 'ts-dojo-standalone.html');

/** 注入到 iframe 内部的探针：跨源只能靠 postMessage 把状态带回顶层。 */
const SPY = [
  '<script>',
  'window.addEventListener("error", function (e) {',
  '  parent.postMessage({ err: (e.message || "?") + " @" + e.lineno }, "*");',
  '}, true);',
  'setInterval(function () {',
  '  var v = document.getElementById("view");',
  '  var a = document.querySelector(\'a[data-nav="problems"]\');',
  '  var r = a ? a.getBoundingClientRect() : null;',
  '  parent.postMessage({ state: {',
  '    cur: window.TSJ && window.TSJ.appRouter ? window.TSJ.appRouter.current() : null,',
  '    view: v ? v.innerHTML.length : -1,',
  '    tsj: Object.keys(window.TSJ || {}).length,',
  '    bootFail: !!document.getElementById("bootFail"),',
  '    rect: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null',
  '  } }, "*");',
  '}, 250);',
  '<\/script>',
].join('\n');

/** 构造宿主页：iframe 带 sandbox，且不注入任何同源权限。 */
function buildHost(name, opts) {
  const mode = (opts && opts.mode) || 'sandbox';
  const html = fs.readFileSync(STANDALONE, 'utf8');
  // 用函数式替换：替换串里含 `$` 时，String.replace 会把 `$$` 当转义序列吃掉一个 `$`，
  // 把 `function $$(...)` 悄悄改成 `function $(...)`（我在这上面踩过一次，探针自己造出了假缺陷）。
  const withSpy = html.replace('<head>', () => '<head>' + SPY + (opts && opts.throwAfter ? THROW_AFTER : ''));
  const attr = mode === 'sandbox' ? ' sandbox="allow-scripts"' : '';
  const file = path.join(OUT, name + '.html');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file,
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;overflow:hidden}' +
    'iframe{width:100%;height:100%;border:0;display:block}' +
    '</style></head><body>' +
    '<iframe id="f"' + attr + ' srcdoc="' + escapeAttr(withSpy) + '"></iframe>' +
    '<script>' +
    'window.__errs = []; window.__state = null;' +
    'window.addEventListener("message", function (e) {' +
    '  if (e.data && e.data.err) window.__errs.push(e.data.err);' +
    '  if (e.data && e.data.state) window.__state = e.data.state;' +
    '});' +
    '<\/script></body></html>', 'utf8');
  return 'file:///' + file.replace(/\\/g, '/');
}

/** 启动 1.2 秒后抛一个错，模拟「运行期某个按钮报错」。 */
const THROW_AFTER = [
  '<script>',
  'setTimeout(function () {',
  '  setTimeout(function () { throw new Error("模拟运行期错误"); }, 0);',
  '}, 1200);',
  '<\/script>',
].join('\n');

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function open(page) {
  return JSON.parse(await page.evaluate('JSON.stringify({ s: window.__state, e: window.__errs })'));
}

async function clickAt(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(900);
}

test('H01 不透明源沙箱里应用能启动，点导航真的换页', async (t) => {
  if (!fs.existsSync(STANDALONE)) return t.skip('单文件版不存在，先跑 build-standalone');
  const url = buildHost('boot');
  let page = null;
  try {
    page = await cdp.launch(url, {
      readyExpr: '!!document.getElementById("f")', readyTimeout: 45000, lockTimeout: 60000,
    });
  } catch (e) {
    return t.skip('无浏览器：' + e.message);
  }
  if (!page) return t.skip('无浏览器');

  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(2200);

    const first = await open(page);
    console.log('    启动后：' + JSON.stringify(first.s));
    assert.ok(first.s, 'iframe 没有回报状态（探针未注入或文档未加载）');
    assert.ok(first.s.tsj > 10, 'TSJ 没加载起来（键数 ' + first.s.tsj + '）');
    assert.ok(first.s.view > 1000, '首页没渲染出内容（' + first.s.view + ' 字符）');
    assert.equal(first.s.bootFail, false, '不该出现启动失败遮罩');
    assert.equal(first.s.cur, '#/', '初始路由不是工作台（' + first.s.cur + '）');
    assert.deepEqual(first.e, [], '启动期有异常：' + JSON.stringify(first.e));

    // 点「题库」——这是用户最先点的那个链接
    assert.ok(first.s.rect && first.s.rect.w > 0, '拿不到「题库」的坐标（顶栏折叠？）');
    await clickAt(page, first.s.rect.x, first.s.rect.y);

    const after = await open(page);
    console.log('    点「题库」后：' + JSON.stringify(after.s));
    assert.equal(after.s.cur, '#/problems',
      '在不透明源沙箱里点导航没有换页（cur=' + after.s.cur + '）—— 这个宿主里点击必须照常工作');
    assert.ok(after.s.view > first.s.view * 2,
      '换页后内容没变多（' + first.s.view + ' → ' + after.s.view + '）');
  } finally {
    await page.close();
  }
});

test('H03 脚本被拦时，noscript 兜底卡片必须落在首屏内', async (t) => {
  if (!fs.existsSync(STANDALONE)) return t.skip('单文件版不存在');
  let page = null;
  try {
    page = await cdp.launch('file:///' + STANDALONE.replace(/\\/g, '/'), {
      readyTimeout: 45000, lockTimeout: 60000,
    });
  } catch (e) {
    return t.skip('无浏览器：' + e.message);
  }
  if (!page) return t.skip('无浏览器');

  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    // 复现「预览面板用 <iframe sandbox> 承载」：脚本被拦，只剩静态 HTML
    await page.send('Emulation.setScriptExecutionDisabled', { value: true });
    await page.send('Page.reload');
    await sleep(1200);

    const r = JSON.parse(await page.evaluate(`(function(){
      var el = document.querySelector('.boot-noscript');
      if (!el) return JSON.stringify({ found: false });
      var b = el.getBoundingClientRect();
      return JSON.stringify({ found: true, top: b.top, bottom: b.bottom, vh: innerHeight, h: b.height });
    })()`));
    console.log('    兜底卡片：' + JSON.stringify(r));

    assert.equal(r.found, true, '脚本被拦时没有 noscript 兜底 —— 用户只会看到「顶栏正常、内容区全空」');
    assert.ok(r.h > 40, '兜底卡片没有高度（CSS 没生效？）');
    // 这条是重点：原来兜底文案放在 <main> 之后，被 min-height:calc(100vh - 顶栏) 顶到首屏之外，
    // 等于「有兜底但看不见」，用户照样一脸茫然。
    assert.ok(r.top >= 0 && r.bottom <= r.vh,
      '兜底卡片不在首屏内（top=' + Math.round(r.top) + ' bottom=' + Math.round(r.bottom) +
      ' 视口高=' + r.vh + '）—— 文案存在但用户看不见，等于没有');
  } finally {
    await page.close();
  }
});

test('H02 运行期错误不许升级成全屏遮罩（遮罩会吞掉所有点击）', async (t) => {
  if (!fs.existsSync(STANDALONE)) return t.skip('单文件版不存在');
  const url = buildHost('runtime-err', { mode: 'plain', throwAfter: true });
  let page = null;
  try {
    page = await cdp.launch(url, {
      readyExpr: '!!document.getElementById("f")', readyTimeout: 45000, lockTimeout: 60000,
    });
  } catch (e) {
    return t.skip('无浏览器：' + e.message);
  }
  if (!page) return t.skip('无浏览器');

  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(2600);   // 等过 1.2s 的那次抛错

    const s = await open(page);
    console.log('    抛错后：' + JSON.stringify(s.s) + ' · 捕获 ' + JSON.stringify(s.e));
    assert.ok(s.s, 'iframe 没有回报状态');
    assert.ok(s.e.length > 0, '模拟的运行期错误没有被捕获（用例自身失效）');
    assert.equal(s.s.bootFail, false,
      '应用已经渲染出内容，运行期错误却弹了全屏遮罩 —— 遮罩 z-index 99999、' +
      'position:fixed 铺满，会把「一个按钮报错」放大成「整个站点点不动」');
    assert.ok(s.s.view > 1000, '遮罩之外页面内容也没了（' + s.s.view + '）');
  } finally {
    await page.close();
  }
});
