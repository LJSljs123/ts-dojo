/**
 * K 组：键盘可达性
 *
 * 起因：a11y.js 写了完整的弹层焦点陷阱 / inert / 标题更新，但**一条用例都没有**——
 * 整个模块坏掉也不会有人发现。同时换维度走查（Tab 走一遍）量出三处真缺陷：
 *
 *   1. 编辑器是键盘陷阱：Tab / Shift+Tab 都被缩进占用，焦点进得去出不来（WCAG 2.1.2）；
 *   2. 「跳到主要内容」排在顶栏之后，是第 4 个可聚焦元素，跳过导航等于没跳；
 *   3. 弹层关闭后焦点一律回 #view，不回触发按钮，键盘用户按完 Esc 就丢了位置。
 *
 * 测量注意：焦点环宽度**必须等过渡结束再读**。`.btn` 上有 transition，
 * Tab 过去 40ms 内读到的 outline-width 是 0→2px 的插值（实测 1px、
 * outline-offset 0.75px、颜色是 accent 与底色的混合），据此断言会得到
 * 「焦点环只有 1px」的假缺陷——与对比度审计里那次 1.09:1 的假阳性同类。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { launch, findBrowser } = require('./helpers/cdp.js');

const HAS_BROWSER = !!findBrowser();
const INDEX_URL = 'file://' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');
const PROBLEM = '#/problem/p1-naive';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读当前焦点元素的摘要。 */
const ACTIVE = `(function(){
  var a = document.activeElement;
  if (!a) return null;
  return {
    tag: a.tagName, id: a.id || '', cls: (a.className || '').toString(),
    text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24),
    outlineStyle: getComputedStyle(a).outlineStyle,
    outlineWidth: getComputedStyle(a).outlineWidth
  };
})()`;

let page = null;

/** 派发一次真实按键（不是合成 KeyboardEvent：合成事件不会触发浏览器默认的焦点移动）。 */
async function press(key, code, vk, modifiers) {
  const base = { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key: key, code: code };
  if (modifiers) base.modifiers = modifiers;
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(40);
}

const TAB = () => press('Tab', 'Tab', 9);
const ESC = () => press('Escape', 'Escape', 27);

/** 打开某路由并把焦点收回 body（保证 Tab 走查从头开始）。 */
async function goto(hash) {
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(420);
  await page.evaluate('document.activeElement && document.activeElement.blur(); document.body.focus();');
}

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL + PROBLEM, { timeout: 25000 });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1366, height: 768, deviceScaleFactor: 1, mobile: false
  });
  // 关掉一次性引导弹层，否则整个走查都被焦点陷阱关在弹层里
  await page.evaluate(
    'localStorage.setItem("tsoj:onboarded", JSON.stringify(true)); location.reload()'
  );
  await sleep(900);
  await page.waitReady(20000);
});

test.after(() => { if (page) page.close(); });

test('K01 「跳到主要内容」是第一个可聚焦元素，第一次 Tab 就落在它上面', async (t) => {
  if (!page) return t.skip('无浏览器');
  // 重新加载：必须验证「真实首屏」的焦点起点。若先跑过 goto()，#view 会被
  // focusView 抢到焦点，顺序导航就从页面中部开始，测出来的不是首屏行为。
  await page.reload();
  await sleep(500);

  // DOM 顺序：必须是 body 下第一个可聚焦元素。排在第 4 位等于没跳。
  const first = await page.evaluate(`(function(){
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    var list = Array.prototype.filter.call(document.querySelectorAll(sel), function(el){
      return el.getClientRects().length > 0 && !el.closest('#overlay');
    });
    var el = list[0];
    return { cls: (el.className || '').toString(), text: el.textContent.trim(), href: el.getAttribute('href'), total: list.length };
  })()`);
  console.log('    第一个可聚焦元素：.' + first.cls + ' 「' + first.text + '」 共 ' + first.total + ' 个');
  assert.match(first.cls, /ds-skip-link/, '第一个可聚焦元素不是跳转链接（实际是 .' + first.cls + '）');
  assert.equal(first.href, '#view', '跳转链接的目标不是 #view');

  // 首屏不应把焦点抢进 #view，否则顺序导航从页面中部开始
  const startup = await page.evaluate('document.activeElement.tagName');
  assert.notEqual(startup, 'MAIN', '首屏渲染就把焦点交给了 #view，跳转链接会被甩在身后');

  await TAB();
  const a = await page.evaluate(ACTIVE);
  assert.match(a.cls, /ds-skip-link/, '第一次 Tab 没有落在跳转链接上（落在 ' + a.tag + '.' + a.cls + '）');
});

test('K02 编辑器不是键盘陷阱：Tab 缩进、Esc 退出并把焦点交给提交按钮', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto(PROBLEM);

  const before = await page.evaluate(`(function(){
    var ta = document.querySelector('.ed-input');
    ta.focus();
    ta.setSelectionRange(0, 0);
    return { value: ta.value.length, focused: document.activeElement === ta };
  })()`);
  assert.equal(before.focused, true, '无法把焦点放进编辑器');

  // Tab 必须仍然被编辑器吃掉（缩进 2 空格），否则说明缩进功能被误删
  await TAB();
  const afterTab = await page.evaluate(`(function(){
    var ta = document.querySelector('.ed-input');
    return { focused: document.activeElement === ta, value: ta.value, caret: ta.selectionStart };
  })()`);
  assert.equal(afterTab.focused, true, 'Tab 竟然把焦点移出了编辑器，缩进功能可能坏了');
  assert.equal(afterTab.value.slice(0, 2), '  ', 'Tab 没有插入 2 空格缩进');

  // Esc 必须能出去，且落在「提交判题」
  await ESC();
  const afterEsc = await page.evaluate(ACTIVE);
  console.log('    Esc 后焦点：' + afterEsc.tag + '#' + afterEsc.id + ' 「' + afterEsc.text + '」');
  assert.notEqual(afterEsc.tag, 'TEXTAREA', 'Esc 没有把焦点移出编辑器（键盘陷阱，WCAG 2.1.2）');
  assert.equal(afterEsc.id, 'btnSubmit', 'Esc 退出的落点不是「提交判题」（实际 ' + afterEsc.tag + '#' + afterEsc.id + '）');
});

test('K03 弹层：背景 inert、Tab 循环、Esc 关闭、焦点归还触发按钮', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto(PROBLEM);

  // 从「运行」按钮触发，验证关闭后焦点回到它而不是页面顶部
  const opened = await page.evaluate(`(function(){
    var trigger = document.getElementById('btnRun');
    trigger.focus();
    TSJ.appA11y.openModal({
      html: '<button type="button" id="mkA">甲</button><button type="button" id="mkB">乙</button>',
      label: '键盘测试',
      initialFocus: '#mkA'
    });
    var view = document.getElementById('view');
    return {
      inModal: !!document.activeElement.closest('#overlay'),
      viewInert: view.hasAttribute('inert') || view.inert === true,
      viewHidden: view.getAttribute('aria-hidden')
    };
  })()`);
  assert.equal(opened.inModal, true, '弹层打开后焦点没有进入弹层');
  assert.equal(opened.viewInert, true, '弹层打开时背景没有设 inert');
  assert.equal(opened.viewHidden, 'true', '弹层打开时背景没有设 aria-hidden');

  // Tab 只在弹层内循环：两次 Tab 后必须还在弹层里
  await TAB();
  await TAB();
  const cycling = await page.evaluate(`(function(){
    return { inModal: !!document.activeElement.closest('#overlay'), id: document.activeElement.id };
  })()`);
  assert.equal(cycling.inModal, true, 'Tab 把焦点移出了弹层（焦点陷阱失效）');
  console.log('    弹层内 Tab 两次后焦点：#' + cycling.id);

  await ESC();
  const closed = await page.evaluate(`(function(){
    var ov = document.getElementById('overlay');
    var view = document.getElementById('view');
    return {
      hidden: ov.classList.contains('hidden'),
      stillInert: view.hasAttribute('inert'),
      activeId: document.activeElement.id,
      modalOpen: TSJ.appA11y.modalOpen()
    };
  })()`);
  assert.equal(closed.hidden, true, 'Esc 没有关闭弹层');
  assert.equal(closed.modalOpen, false, 'modalOpen() 仍报打开');
  assert.equal(closed.stillInert, false, '关闭后背景仍是 inert，页面再也点不动');
  assert.equal(closed.activeId, 'btnRun', '关闭后焦点没有回到触发按钮（实际 #' + closed.activeId + '）');
});

test('K04 焦点环：Tab 到的每个元素都有可见焦点环，宽度 ≥ 2px', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto(PROBLEM);

  const thin = [];
  let seen = 0;
  for (let i = 0; i < 14; i++) {
    await TAB();
    // 等过渡结束：`.btn` 有 transition，40ms 内读到的是 0→2px 的插值（约 1px）
    await sleep(260);
    const a = await page.evaluate(ACTIVE);
    if (!a || a.tag === 'BODY') continue;
    seen++;
    if (a.outlineStyle === 'none' || parseFloat(a.outlineWidth) < 2) {
      thin.push(a.tag + (a.id ? '#' + a.id : '.' + a.cls.split(' ')[0]) + ' ' + a.outlineStyle + ' ' + a.outlineWidth);
    }
  }
  console.log('    走查 ' + seen + ' 个可聚焦元素，焦点环不足 2px 的 ' + thin.length + ' 个');
  // 下界：走查坏掉时「零个不合格」也会通过
  assert.ok(seen >= 10, '只走到 ' + seen + ' 个可聚焦元素，Tab 走查可能失效');
  assert.deepEqual(thin, [], '存在没有可见焦点环的元素');
});

test('K05 可聚焦元素都有可读名字（读屏不会念「按钮」）', async (t) => {
  if (!page) return t.skip('无浏览器');
  const ROUTES = ['#/', '#/problems', PROBLEM, '#/studio'];
  const nameless = [];
  let checked = 0;

  for (const hash of ROUTES) {
    await goto(hash);
    const r = await page.evaluate(`(function(){
      var sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
        'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      var list = Array.prototype.filter.call(document.querySelectorAll(sel), function(el){
        return el.getClientRects().length > 0;
      });
      var bad = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        var labelled = el.id && document.querySelector('label[for="' + el.id + '"]');
        if (!name && !labelled && el.tagName !== 'MAIN') {
          bad.push(el.tagName + (el.id ? '#' + el.id : '.' + (el.className || '').toString().split(' ')[0]));
        }
      }
      return { total: list.length, bad: bad };
    })()`);
    checked += r.total;
    r.bad.forEach((b) => nameless.push(hash + ' ' + b));
  }

  console.log('    检查 ' + checked + ' 个可聚焦元素，无名字 ' + nameless.length + ' 个');
  assert.ok(checked >= 30, '只检查到 ' + checked + ' 个可聚焦元素，扫描器可能失效');
  assert.deepEqual(nameless, [], '存在读屏念不出名字的可聚焦元素');
});
