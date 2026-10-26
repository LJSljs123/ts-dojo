/**
 * D 组：主题对比度（浅色 / 深色都要能读）
 *
 * 起因：浅色主题下「难度徽章」1.58:1、「行内代码」1.23:1、编辑器正文 1.3:1——
 * 全是深色主题的粉彩色被直接搬到浅底上。这类问题不会让任何用例变红，
 * 也不会横向溢出，只能靠量出来。
 *
 * 判据：正文与背景的 WCAG 对比度 ≥ 3.0（AA 正文要求 4.5，这里先守住 3.0 这条
 * 「明显看不清」的线，避免把大量装饰性小字一起判死）。
 *
 * 两类元素跳过，各有明确理由：
 *   1. 自身或祖先 opacity < 1 —— 禁用态按钮就是这样变灰的，颜色值算不出实际观感；
 *   2. 背景一路透明且祖先带 background-image（渐变）—— 取不到实际底色。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { launch, findBrowser } = require('./helpers/cdp.js');

const HAS_BROWSER = !!findBrowser();
const INDEX_URL = 'file://' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');
const ROUTES = ['#/', '#/problems', '#/problem/p18-channel-mix', '#/methods', '#/path'];

/** 在页面里跑：返回 {checked, bad:[{sel, ratio, text, color, bg}]}。 */
function auditSource() {
  function parse(c) {
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function over(fg, bg) {
    var a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function faded(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (parseFloat(getComputedStyle(n).opacity) < 1) return true;
      n = n.parentElement;
    }
    return false;
  }
  function bgOf(el) {
    var node = el, acc = null, gradient = false;
    while (node && node.nodeType === 1) {
      var st = getComputedStyle(node);
      if (st.backgroundImage && st.backgroundImage !== 'none') gradient = true;
      var c = parse(st.backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        // 一旦路上出现过渐变，实际底色就不可知（渐变画在透明层上），必须放弃这一项
        if (acc.a >= 0.999) return { bg: acc, ok: !gradient };
      }
      node = node.parentElement;
    }
    return { bg: acc || { r: 255, g: 255, b: 255, a: 1 }, ok: !gradient };
  }
  function sel(el) {
    var s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  }

  var bad = [], checked = 0;
  var all = document.querySelectorAll('#view *, .topbar *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var hasText = false;
    for (var k = 0; k < el.childNodes.length; k++) {
      if (el.childNodes[k].nodeType === 3 && el.childNodes[k].textContent.trim().length > 1) { hasText = true; break; }
    }
    if (!hasText) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    var st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (faded(el)) continue;
    var fg = parse(st.color);
    if (!fg) continue;
    var b = bgOf(el);
    if (!b.ok) continue;
    var f = fg.a < 1 ? over(fg, b.bg) : fg;
    var l1 = lum(f), l2 = lum(b.bg);
    var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    checked++;
    if (ratio < 3.0) {
      bad.push({
        sel: sel(el),
        ratio: Math.round(ratio * 100) / 100,
        text: (el.textContent || '').trim().slice(0, 20),
        color: st.color,
        bg: 'rgb(' + Math.round(b.bg.r) + ',' + Math.round(b.bg.g) + ',' + Math.round(b.bg.b) + ')'
      });
    }
  }
  return { checked: checked, bad: bad.slice(0, 12), total: bad.length };
}

let page = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 25000 });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false
  });
});

test.after(() => { if (page) page.close(); });

/** 切主题并逐路由审计；返回 {checked, total, bad}。 */
async function sweep(theme) {
  await page.evaluate(
    'localStorage.setItem("tsoj:theme", JSON.stringify(' + JSON.stringify(theme) + '));' +
    'localStorage.setItem("tsoj:onboarded", JSON.stringify(true));location.reload()'
  );
  await sleep(900);
  await page.waitReady(20000);
  const actual = await page.evaluate('document.documentElement.getAttribute("data-theme")');
  assert.equal(actual, theme, '主题没有切到 ' + theme);

  let checked = 0;
  const bad = [];
  for (const hash of ROUTES) {
    await page.evaluate('location.hash = ' + JSON.stringify(hash));
    await sleep(450);
    const r = await page.evaluate('(' + auditSource.toString() + ')()');
    checked += r.checked;
    r.bad.forEach((x) => bad.push(Object.assign({ hash: hash }, x)));
  }
  return { checked: checked, bad: bad };
}

test('D01 深色主题：可见文字的对比度不低于 3:1', async (t) => {
  if (!page) return t.skip('无浏览器');
  const r = await sweep('dark');
  console.log('    审计 ' + r.checked + ' 个文本节点 · 低对比 ' + r.bad.length + ' 个');
  r.bad.slice(0, 6).forEach((b) => console.log('      ' + b.ratio + ':1 ' + b.hash + ' ' + b.sel +
    ' [' + b.text + '] ' + b.color + ' on ' + b.bg));
  // 下界：扫描器坏掉时「零个低对比」也会通过，必须证明真的扫到了东西
  assert.ok(r.checked >= 200, '只审计到 ' + r.checked + ' 个文本节点，扫描器可能失效');
  assert.deepEqual(r.bad.map((b) => b.sel + ' ' + b.ratio), [], '深色主题存在看不清的文字');
});

test('D02 浅色主题：可见文字的对比度不低于 3:1', async (t) => {
  if (!page) return t.skip('无浏览器');
  const r = await sweep('light');
  console.log('    审计 ' + r.checked + ' 个文本节点 · 低对比 ' + r.bad.length + ' 个');
  r.bad.slice(0, 6).forEach((b) => console.log('      ' + b.ratio + ':1 ' + b.hash + ' ' + b.sel +
    ' [' + b.text + '] ' + b.color + ' on ' + b.bg));
  assert.ok(r.checked >= 200, '只审计到 ' + r.checked + ' 个文本节点，扫描器可能失效');
  assert.deepEqual(r.bad.map((b) => b.sel + ' ' + b.ratio), [], '浅色主题存在看不清的文字');
});
