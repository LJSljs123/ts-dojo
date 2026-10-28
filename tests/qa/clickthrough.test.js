/**
 * C 组：前端功能点击走查
 *
 * 目的：不是「路由能渲染」，而是「**每个控件点下去都有反应，且反应是对的**」。
 * 既有的 browser / v3-browser 用例走的是「关键路径」（判题、图表、分栏），
 * 大量按钮只在源码里被读到、从没被点过：主题切换、菜单抽屉、标签筛选、
 * 字号循环、查看题解、恢复默认、分享卡、导出、清空确认……
 *
 * 判据（每一步都查，不靠肉眼）：
 *   1. 元素存在、有尺寸、`visibility` 不是 hidden（否则是「看得见点不到」）；
 *   2. 点击不产生未捕获异常（含 console.error）；
 *   3. 点击后 `#view` 不出现**新增**的 `undefined` / `NaN` / `[object Object]`
 *      —— 占位符残留是「功能看起来跑了，其实数据没接上」的典型症状；
 *   4. 声明了效果的步骤，验证具体效果（hash 变化 / 弹层打开 / 结果出现 / 文案变化）。
 *
 * 为什么用 `el.click()` 而不是 CDP 鼠标事件：这里验的是「点了会不会出事」，
 * 不是命中区域。命中区域由 v3-browser 的几何断言（视口 / 裁切）负责。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { launch, findBrowser } = require('./helpers/cdp.js');

const HAS_BROWSER = !!findBrowser();
const INDEX_URL = 'file://' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面快照：路由、DOM 长度、占位符残留、弹层与轻提示状态。
 *
 * 占位符判据是「**整个文本节点就是一个占位符**」，不是「文本里含这个词」：
 * 题面会正当地写「返回值不能含 NaN」、课程会讲「数组里出了 NaN 是除以 0」，
 * 用包含匹配必然假阳性（第一版就是这样把两处教学文本判成了缺陷）。
 * 真正的缺陷长这样：`<span class="metric">undefined</span>`。
 *
 * 同时排除 `pre` / `code` / 高亮层：代码模板里的 `undefined` 是代码，不是渲染结果。
 */
const SNAP = `(function(){
  var view = document.getElementById('view');
  var ov = document.getElementById('overlay');
  var toast = document.getElementById('toast');
  var STRAY = /^(undefined|NaN|null|Infinity|\\[object Object\\])$/;
  var stray = [];
  if (view) {
    var walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var p = n.parentElement;
      if (p && p.closest('pre, code, .ed-highlight, .ed-gutter, .ed-input')) continue;
      var t = (n.nodeValue || '').trim();
      if (STRAY.test(t)) stray.push(t + '@' + p.tagName + '.' + (p.className || '').toString().split(' ')[0]);
    }
  }
  return {
    hash: location.hash,
    len: view ? view.innerHTML.length : 0,
    overlay: ov ? !ov.classList.contains('hidden') : false,
    overlayLen: ov ? ov.innerHTML.length : 0,
    toast: toast && toast.className.indexOf('toast-show') >= 0 ? toast.textContent : '',
    stray: stray,
    text: view ? (view.textContent || '').slice(0, 1200) : ''
  };
})()`;

let page = null;
/** 本文件累计的走查记录，失败时一次性打印，避免第一条就中断看不到全貌 */
let failures = [];
let steps = 0;

/** 打开路由并等渲染。 */
async function goto(hash) {
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(420);
}

/** 取元素摘要；不存在或不可见返回 null。 */
async function probe(sel) {
  return page.evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      tag: el.tagName, disabled: !!el.disabled,
      w: Math.round(r.width), h: Math.round(r.height),
      visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0,
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30)
    };
  })()`);
}

/**
 * 点一个控件并验证「有反应、不出事」。
 *
 * @param {string} sel 选择器
 * @param {Object} [opts] { label, wait, effect }
 *   effect: 'dom'（默认，DOM 或 hash 必须变）/ 'any'（幂等控件）/ 'overlay' / 'none'
 * @returns {Promise<Object>} 快照对
 */
async function click(sel, opts) {
  const o = opts || {};
  const label = o.label || sel;
  const wait = o.wait == null ? 350 : o.wait;
  const effect = o.effect || 'dom';
  steps++;

  const el = await probe(sel);
  if (!el) {
    failures.push(label + ' → 元素不存在（' + sel + '）');
    return null;
  }
  if (!el.visible) {
    failures.push(label + ' → 元素存在但不可见/零尺寸（' + sel + '）');
    return null;
  }
  if (el.disabled) {
    failures.push(label + ' → 元素处于 disabled（' + sel + '）');
    return null;
  }

  const before = await page.evaluate(SNAP);
  const errBefore = page.exceptions.length;
  await page.evaluate(`(function(){ document.querySelector(${JSON.stringify(sel)}).click(); })()`);
  await sleep(wait);
  const after = await page.evaluate(SNAP);
  const errs = page.exceptions.slice(errBefore);

  if (errs.length) failures.push(label + ' → 点击抛异常：' + errs.join(' | '));
  if (after.len === 0) failures.push(label + ' → 点击后 #view 变空（渲染失败）');

  // 占位符残留：只查**新增**的「整节点就是 undefined / NaN」的槽位
  if (after.stray.length > before.stray.length) {
    const added = after.stray.slice(before.stray.length);
    failures.push(label + ' → 新增占位符残留：' + added.join(', '));
  }

  const changed = after.len !== before.len || after.hash !== before.hash ||
    after.overlay !== before.overlay || after.toast !== before.toast;
  if (effect === 'dom' && !changed) failures.push(label + ' → 点击后没有任何变化（按钮可能没接事件）');
  if (effect === 'overlay' && !after.overlay) failures.push(label + ' → 没有打开弹层');

  console.log('      ' + (changed ? '✓' : '·') + ' ' + label +
    (after.hash !== before.hash ? ' → ' + after.hash : '') +
    (after.overlay && !before.overlay ? ' [弹层]' : '') +
    (after.toast ? ' [toast: ' + after.toast.slice(0, 16) + ']' : ''));

  return { before: before, after: after };
}

/** 关闭可能打开的弹层。 */
async function closeOverlay() {
  const open = await page.evaluate(`!document.getElementById('overlay').classList.contains('hidden')`);
  if (open) {
    await page.evaluate('TSJ.appA11y.closeModal()');
    await sleep(150);
  }
}

/** 汇总本轮 failures 并清空。 */
function report(title) {
  const bad = failures.slice();
  failures = [];
  assert.deepEqual(bad, [], title + '：' + bad.length + ' 处异常\n  ' + bad.join('\n  '));
}

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 25000, readyTimeout: 20000 });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await page.evaluate('localStorage.setItem("tsoj:onboarded", JSON.stringify(true)); location.reload()');
  await sleep(900);
  await page.waitReady(20000);
});

test.after(() => { if (page) page.close(); });

test('C01 冒烟：13 条路由都能渲染，无异常、无占位符残留', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  const ROUTES = ['#/', '#/problems', '#/problem/p1-naive', '#/methods', '#/methods/holt-winters',
    '#/learn', '#/learn/m0', '#/glossary', '#/lab', '#/studio', '#/submissions',
    '#/ranking', '#/path'];
  const errBefore = page.exceptions.length;

  for (const h of ROUTES) {
    await goto(h);
    const s = await page.evaluate(SNAP);
    const id = await page.evaluate('location.hash');
    console.log('      ' + h.padEnd(22) + ' #view=' + String(s.len).padStart(6) + ' 字符');
    assert.ok(s.len > 400, h + ' 渲染内容过少（' + s.len + ' 字符）');
    assert.deepEqual(s.stray, [], h + ' 出现占位符残留：' + s.stray.join(', '));
    assert.equal(id, h, h + ' 路由没有生效');
  }
  const errs = page.exceptions.slice(errBefore);
  assert.deepEqual(errs, [], '路由切换出现未捕获异常：' + errs.join(' | '));
});

test('C02 顶栏：主题切换 / 菜单抽屉 / 命令面板全流程', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  await goto('#/');
  await closeOverlay();

  // 主题：连点 4 次（深浅循环）后必须回到原值，且 data-theme 一直是合法值
  const themes = [];
  for (let i = 0; i < 4; i++) {
    await click('#btnTheme', { label: '主题切换 #' + (i + 1), effect: 'any', wait: 220 });
    themes.push(await page.evaluate('document.documentElement.getAttribute("data-theme")'));
  }
  console.log('      主题循环：' + themes.join(' → '));
  themes.forEach((th) => assert.ok(th === 'dark' || th === 'light', '主题值非法：' + th));
  assert.equal(themes[3], themes[1], '主题没有在深浅之间循环');

  // 菜单抽屉：打开 → 里面有导航 → aria-expanded 同步
  await click('#btnMenu', { label: '菜单抽屉', effect: 'any', wait: 300 });
  const drawer = await page.evaluate(`(function(){
    var d = document.getElementById('drawerNav');
    if (!d) return { exists: false };
    var btn = document.getElementById('btnMenu');
    return {
      exists: true,
      open: d.classList.contains('open'),
      expanded: btn ? btn.getAttribute('aria-expanded') : null,
      links: d.querySelectorAll('a[href^="#/"]').length
    };
  })()`);
  console.log('      抽屉：存在=' + drawer.exists + ' · 打开=' + drawer.open +
    ' · aria-expanded=' + drawer.expanded + ' · 链接=' + drawer.links);
  assert.equal(drawer.exists, true, '菜单抽屉 #drawerNav 不存在');
  assert.equal(drawer.open, true, '点了「菜单」抽屉没有打开');
  assert.equal(drawer.expanded, 'true', 'aria-expanded 没有同步为 true');
  assert.ok(drawer.links >= 7, '抽屉里只有 ' + drawer.links + ' 个导航链接');
  // 收起来，避免挡住后面的点击
  await click('#btnMenu', { label: '菜单抽屉收起', effect: 'any', wait: 250 });

  // 命令面板：Ctrl+K → 输入 → ↓ → Enter
  await page.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75,
    key: 'k', code: 'KeyK', modifiers: 2
  });
  await sleep(350);
  const cmdkOpen = await page.evaluate(`(function(){
    var ov = document.getElementById('overlay');
    return { open: !ov.classList.contains('hidden'), hasInput: !!document.getElementById('cmdkInput') };
  })()`);
  assert.equal(cmdkOpen.open, true, 'Ctrl+K 没有打开命令面板');
  assert.equal(cmdkOpen.hasInput, true, '命令面板里没有输入框');

  await page.evaluate(`(function(){
    var input = document.getElementById('cmdkInput');
    input.value = 'Holt';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const results = await page.evaluate(`document.querySelectorAll('#cmdkResults .cmdk-item').length`);
  console.log('      命令面板搜索「Holt」：' + results + ' 条结果');
  assert.ok(results >= 1, '命令面板搜索「Holt」没有结果');

  await page.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown'
  });
  await sleep(150);
  await page.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter'
  });
  await sleep(500);
  const jumped = await page.evaluate(`(function(){
    return { hash: location.hash, open: !document.getElementById('overlay').classList.contains('hidden') };
  })()`);
  console.log('      Enter 之后：' + jumped.hash + ' · 面板关闭=' + !jumped.open);
  assert.equal(jumped.open, false, 'Enter 之后命令面板没有关闭');
  assert.notEqual(jumped.hash, '#/', 'Enter 之后没有跳转');

  report('顶栏交互');
});

/** 往输入框里输入文本并触发 input 事件（搜索框都是监听 input）。 */
async function typeInto(sel, text, wait) {
  steps++;
  const el = await probe(sel);
  if (!el) {
    failures.push(sel + ' → 输入框不存在');
    return;
  }
  await page.evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    el.focus();
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(wait == null ? 350 : wait);
  console.log('      ✓ 输入「' + text + '」到 ' + sel);
}

/**
 * 按可见文本找元素并点击（找不到时给出明确失败，而不是静默跳过）。
 *
 * 标记必须在每次查找前**清干净**：`data-qa-hit` 留在没被重渲染掉的元素上
 * （筛选 chip 就是这种），下一次 `querySelector('[data-qa-hit]')` 会取到它，
 * 于是「点方法卡标题」实际点的是几轮之前的那个 chip —— 断言看着过了，其实没测。
 */
async function clickByText(scopeSel, text, opts) {
  const found = await page.evaluate(`(function(){
    var stale = document.querySelectorAll('[data-qa-hit]');
    for (var k = 0; k < stale.length; k++) stale[k].removeAttribute('data-qa-hit');
    var list = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(scopeSel)}));
    var t = ${JSON.stringify(text)};
    for (var i = 0; i < list.length; i++) {
      if ((list[i].textContent || '').trim().indexOf(t) >= 0) {
        list[i].setAttribute('data-qa-hit', '1');
        return true;
      }
    }
    return false;
  })()`);
  if (!found) {
    steps++;
    failures.push('「' + text + '」→ 在 ' + scopeSel + ' 里找不到');
    return null;
  }
  return click('[data-qa-hit="1"]', opts || { label: '「' + text + '」' });
}

/** 取当前题库可见行数。 */
const ROW_COUNT = `document.querySelectorAll('#view .ptable tbody tr, #view .pcard').length`;

test('C03 题库：搜索 / 难度 / 标签 / 随机 / 进题', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  await goto('#/problems');
  await closeOverlay();

  const all = await page.evaluate(ROW_COUNT);
  console.log('      初始行数：' + all);
  assert.ok(all >= 10, '题库初始只有 ' + all + ' 行');

  // 搜索：命中要变少，清空要回到全量
  await typeInto('#searchInput', 'Holt');
  const hit = await page.evaluate(ROW_COUNT);
  console.log('      搜索「Holt」：' + hit + ' 行');
  assert.ok(hit >= 1 && hit < all, '搜索「Holt」结果异常：' + hit + ' 行（全量 ' + all + '）');
  await typeInto('#searchInput', 'zzz-不存在-zzz');
  // 无结果时题库会渲染一行「没有匹配」空态提示，所以不能断言行数为 0，
  // 要断言「没有题卡/题行」
  const none = await page.evaluate(`(function(){
    var cards = document.querySelectorAll('#view .ptable tbody tr.prow, #view .pcard').length;
    var txt = (document.getElementById('view').textContent || '');
    return { cards: cards, empty: /没有|无匹配|未找到/.test(txt) };
  })()`);
  console.log('      搜索无结果：题卡 ' + none.cards + ' 个 · 空态提示=' + none.empty);
  assert.equal(none.cards, 0, '搜索无结果时仍渲染了 ' + none.cards + ' 个题卡');
  assert.equal(none.empty, true, '搜索无结果时没有给出空态提示');
  await typeInto('#searchInput', '');
  const back = await page.evaluate(ROW_COUNT);
  assert.equal(back, all, '清空搜索没有回到全量（' + back + ' vs ' + all + '）');

  // 难度筛选：每个 chip 点一遍，行数都不能超过全量
  for (const level of ['入门', '普及', '提高', '挑战']) {
    await clickByText('#view button.chip', level, { label: '难度「' + level + '」', effect: 'any' });
    const n = await page.evaluate(ROW_COUNT);
    console.log('      难度「' + level + '」：' + n + ' 行');
    assert.ok(n <= all, '难度筛选「' + level + '」行数超过全量');
  }
  await clickByText('#view button.chip', '全部', { label: '难度「全部」', effect: 'any' });

  // 标签筛选：宽屏下默认**展开**（`setTagCloud(!narrow)`），所以先验收起再验展开。
  // 第一版直接点了一次 toggle，把面板收了起来，后面点标签全是零尺寸 —— 断言失败
  // 在「元素不可见」上，看着像功能坏了，其实是测试把面板关掉了。
  const tagOpen = () => page.evaluate(`(function(){
    var c = document.getElementById('tagCloud');
    var b = document.getElementById('btnTagToggle');
    return { hidden: c ? c.hidden : null, expanded: b ? b.getAttribute('aria-expanded') : null };
  })()`);
  const tagInit = await tagOpen();
  console.log('      标签面板初始：hidden=' + tagInit.hidden + ' · aria-expanded=' + tagInit.expanded);

  await click('#btnTagToggle', { label: '标签筛选（收起）', effect: 'any', wait: 260 });
  const tagClosed = await tagOpen();
  assert.equal(tagClosed.hidden, true, '点「标签筛选」没有收起面板');
  assert.equal(tagClosed.expanded, 'false', '收起后 aria-expanded 没同步');

  await click('#btnTagToggle', { label: '标签筛选（展开）', effect: 'any', wait: 260 });
  const tagReopen = await tagOpen();
  assert.equal(tagReopen.hidden, false, '再点「标签筛选」没有展开面板');

  await clickByText('#view button.tag-chip', '平滑', { label: '标签「平滑」', effect: 'any' });
  const tagged = await page.evaluate(ROW_COUNT);
  console.log('      标签「平滑」：' + tagged + ' 行');
  assert.ok(tagged >= 1 && tagged <= all, '标签筛选结果异常：' + tagged);
  await clickByText('#view button.tag-chip', '平滑', { label: '标签「平滑」再点一次（取消）', effect: 'any' });

  // 随机一题：必须跳到某道题
  await click('#btnRandom', { label: '随机一题', wait: 500 });
  const randHash = await page.evaluate('location.hash');
  console.log('      随机一题 → ' + randHash);
  assert.match(randHash, /^#\/problem\//, '「随机一题」没有跳到题目页');

  // 从题库点进第一道题
  await goto('#/problems');
  await clickByText('#view .prow, #view .pcard', '朴素', { label: '题库第一道题', wait: 500 });
  const entered = await page.evaluate('location.hash');
  console.log('      点题卡 → ' + entered);
  assert.match(entered, /^#\/problem\//, '点题卡没有进入题目页');

  report('题库交互');
});

test('C04 题目页：字号 / 重置 / 运行 / 提交 / 折叠面板 / 相关链接', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/p1-naive');
  await closeOverlay();

  // 字号：12 → 13 → 14 循环。起点不一定是 12（用户上次的选择会持久化），
  // 所以断言「点满一圈回到起点」，而不是断言等于某个具体值。
  const fontBefore = await page.evaluate(`document.getElementById('btnFont').textContent.trim()`);
  const fonts = [];
  for (let i = 0; i < 3; i++) {
    await click('#btnFont', { label: '字号切换 #' + (i + 1), effect: 'any', wait: 220 });
    fonts.push(await page.evaluate(`document.getElementById('btnFont').textContent.trim()`));
  }
  console.log('      字号循环：' + fontBefore + ' → ' + fonts.join(' → '));
  assert.equal(fonts[2], fontBefore, '字号没有走完一圈回到起点（' + fontBefore + ' → ' + fonts.join(' → ') + '）');
  assert.equal(new Set([fontBefore, fonts[0], fonts[1]]).size, 3, '字号三个档位有重复');

  // 重置模板：先改代码，再重置，必须回到模板原文
  const reset = await page.evaluate(`(function(){
    var ed = TSJ.appStore.state.editor;
    ed.setValue('// 被改坏了');
    document.getElementById('btnReset').click();
    return { value: ed.getValue().slice(0, 40) };
  })()`);
  console.log('      重置模板后开头：' + JSON.stringify(reset.value.slice(0, 24)));
  assert.notEqual(reset.value, '// 被改坏了', '「重置模板」没有生效');

  // 折叠面板：两个 summary 都能展开
  await click('#view summary', { label: '提示折叠面板', effect: 'dom', wait: 260 });
  const opened = await page.evaluate(`document.querySelector('#view details[open]') !== null`);
  assert.equal(opened, true, '点「提示」没有展开');

  // 运行：结果面板必须出现内容，且不能是占位符
  await click('#btnRun', { label: '运行', wait: 2600 });
  const run = await page.evaluate(`(function(){
    var p = document.getElementById('resultPanel');
    return { len: p ? p.innerHTML.length : 0, text: p ? p.textContent.trim().slice(0, 80) : '' };
  })()`);
  console.log('      运行后结果面板：' + run.len + ' 字符 · ' + JSON.stringify(run.text.slice(0, 50)));
  assert.ok(run.len > 40, '「运行」后结果面板为空');

  // 提交判题：必须给出分数与是否通过
  await click('#btnSubmit', { label: '提交判题', wait: 3200 });
  const submit = await page.evaluate(`(function(){
    var p = document.getElementById('resultPanel');
    var t = p ? p.textContent : '';
    return { text: t.slice(0, 200), hasScore: /\\d+\\s*分|通过|未通过/.test(t) };
  })()`);
  console.log('      提交后：' + JSON.stringify(submit.text.replace(/\\s+/g, ' ').slice(0, 90)));
  assert.equal(submit.hasScore, true, '提交后没有出现分数或通过状态');

  // 题解按钮：未通过时应 disabled（解锁逻辑），点不动
  const sol = await page.evaluate(`(function(){
    var b = document.getElementById('btnSolution');
    return { disabled: b.disabled, title: b.getAttribute('title') || '' };
  })()`);
  console.log('      题解按钮：disabled=' + sol.disabled + ' · ' + sol.title);
  assert.equal(sol.disabled, true, '未通过本题时「查看题解」应当是禁用的');

  // 相关链接：点一个 rel-chip 应跳到方法或题目
  await click('#view a.rel-chip', { label: '相关链接（第一个 rel-chip）', wait: 500 });
  const relHash = await page.evaluate('location.hash');
  console.log('      相关链接 → ' + relHash);
  assert.match(relHash, /^#\/(methods|problem|learn)\//, '相关链接没有跳到站内页面');

  report('题目页交互');
});

/** 切换 <select> 到第 n 个选项（0 基）并派发 change。 */
async function selectIndex(sel, idx, wait) {
  steps++;
  const el = await probe(sel);
  if (!el) {
    failures.push(sel + ' → 下拉框不存在');
    return null;
  }
  const info = await page.evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    var before = el.value;
    var n = el.options.length;
    var target = el.options[Math.min(${idx}, n - 1)];
    el.value = target.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { before: before, after: el.value, text: target.textContent.trim().slice(0, 24), count: n };
  })()`);
  await sleep(wait == null ? 600 : wait);
  console.log('      ✓ ' + sel + ' → 「' + info.text + '」（' + info.count + ' 个选项）');
  return info;
}

test('C05 方法库 / 课程 / 术语表：筛选、搜索、进详情、标记完成', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  await goto('#/methods');
  await closeOverlay();

  const total = await page.evaluate(`document.querySelectorAll('#view .mc-title').length`);
  console.log('      方法卡：' + total + ' 张');
  assert.ok(total >= 40, '方法库只有 ' + total + ' 张卡');

  // 层筛选：每个 chip 点一遍，卡数不能超过全量
  for (const tier of ['经典统计', '竞赛级方法', '顶会深度学习', '时序基础模型', '评估方法论']) {
    await clickByText('#view button.chip', tier, { label: '层「' + tier + '」', effect: 'any' });
    const n = await page.evaluate(`document.querySelectorAll('#view .mc-title').length`);
    console.log('      ' + tier + '：' + n + ' 张');
    assert.ok(n >= 1 && n <= total, '层筛选「' + tier + '」卡数异常：' + n);
  }
  await clickByText('#view button.chip', '全部', { label: '层「全部」', effect: 'any' });

  // 只看能练：开关一次，卡数应变少
  await click('#onlyPractice', { label: '只看能练的开关', effect: 'any', wait: 300 });
  const practice = await page.evaluate(`document.querySelectorAll('#view .mc-title').length`);
  console.log('      只看能练：' + practice + ' 张');
  assert.ok(practice >= 1 && practice < total, '「只看能练」结果异常：' + practice);
  await click('#onlyPractice', { label: '只看能练（关）', effect: 'any', wait: 300 });

  // 搜索
  await typeInto('#methodSearch', 'Holt');
  const searched = await page.evaluate(`document.querySelectorAll('#view .mc-title').length`);
  console.log('      搜索「Holt」：' + searched + ' 张');
  assert.ok(searched >= 1 && searched < total, '方法搜索「Holt」结果异常：' + searched);

  // 方法卡：`.mc-title` 是**折叠开关**（不是链接），点开应展开正文
  await clickByText('#view .mc-title', 'Holt', { label: '方法卡「Holt」标题', wait: 400 });
  const expanded = await page.evaluate(`(function(){
    var t = document.querySelector('#view .mc-title[aria-expanded="true"]');
    if (!t) return { expanded: false };
    var body = document.getElementById(t.getAttribute('aria-controls'));
    return { expanded: true, bodyVisible: !!body && !body.hasAttribute('hidden'), bodyLen: body ? body.innerHTML.length : 0 };
  })()`);
  console.log('      方法卡展开：' + expanded.expanded + ' · 正文 ' + expanded.bodyLen + ' 字符');
  assert.equal(expanded.expanded, true, '点方法卡标题没有展开');
  assert.equal(expanded.bodyVisible, true, '展开后正文仍 hidden');
  assert.ok(expanded.bodyLen > 200, '展开后的正文过少（' + expanded.bodyLen + ' 字符）');

  // 详情入口：展开区里必须有「查看详情」链到 #/methods/:id
  await clickByText('#view .mc-detail', '查看详情', { label: '方法卡「查看详情」', wait: 500 });
  const detail = await page.evaluate('location.hash');
  console.log('      查看详情 → ' + detail);
  assert.match(detail, /^#\/methods\/.+/, '点「查看详情」没有进入详情页');
  const detailLen = await page.evaluate(`document.getElementById('view').innerHTML.length`);
  assert.ok(detailLen > 2000, '方法详情页内容过少（' + detailLen + ' 字符）');

  // 课程：进模块 → 标记完成 → 下一课
  await goto('#/learn');
  await clickByText('#view a[href^="#/learn/"]', '零基础第一课', { label: '课程模块「零基础第一课」', wait: 500 });
  const courseHash = await page.evaluate('location.hash');
  console.log('      课程模块 → ' + courseHash);
  assert.match(courseHash, /^#\/learn\/.+/, '点课程模块没有进入模块页');

  const doneBefore = await page.evaluate(`(function(){
    var b = document.getElementById('btnCourseDone');
    return b ? b.textContent.trim() : null;
  })()`);
  await click('#btnCourseDone', { label: '标记本模块完成', effect: 'any', wait: 400 });
  const doneAfter = await page.evaluate(`(function(){
    var b = document.getElementById('btnCourseDone');
    return b ? b.textContent.trim() : null;
  })()`);
  console.log('      标记完成：' + JSON.stringify(doneBefore) + ' → ' + JSON.stringify(doneAfter));
  assert.ok(doneAfter !== null, '标记完成按钮消失了');
  assert.notEqual(doneAfter, doneBefore, '点「标记本模块完成」按钮文案没变（可能没写进度）');

  // 术语表：搜索 + 分类 chip + 展开一个术语
  await goto('#/glossary');
  const terms = await page.evaluate(`document.querySelectorAll('#view .gl-item, #view .term-item, #view button.chip').length`);
  console.log('      术语表控件：' + terms + ' 个');
  await typeInto('#glossarySearch', '季节');
  await clickByText('#view button.chip', '基础概念', { label: '术语分类「基础概念」', effect: 'any' });
  const glen = await page.evaluate(`document.getElementById('view').innerHTML.length`);
  console.log('      术语筛选后：' + glen + ' 字符');
  assert.ok(glen > 500, '术语筛选后内容过少');

  report('方法库/课程/术语表交互');
});

test('C06 实验室 / 模型工坊：下拉、参数、运行、导出、清空确认', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');

  // ---- 实验室 ----
  await goto('#/lab');
  await closeOverlay();
  await selectIndex('#labDataset', 2, 700);
  await selectIndex('#labMethod', 4, 700);   // 简单指数平滑：有 alpha 参数
  await selectIndex('#labMode', 1, 700);
  // 参数输入：实验室的参数是 number 输入框（#param-<key>），不是滑杆；
  // 不同方法挂不同数量，只断言「至少有一个且能改」
  const params = await page.evaluate(`document.querySelectorAll('#view input[type="number"][id^="param-"]').length`);
  console.log('      参数输入框：' + params + ' 个');
  assert.ok(params >= 1, '切换方法后没有参数输入框');
  if (params >= 1) {
    const edited = await page.evaluate(`(function(){
      var el = document.querySelector('#view input[type="number"][id^="param-"]');
      var before = el.value;
      el.value = String(Number(el.max) || Number(el.value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { id: el.id, before: before, after: el.value };
    })()`);
    console.log('      改参数 ' + edited.id + '：' + edited.before + ' → ' + edited.after);
    assert.notEqual(edited.after, edited.before, '参数输入框改了值但没变化');
  }

  await click('#labRun', { label: '实验室运行实验', wait: 3000 });
  const labOut = await page.evaluate(`(function(){
    var v = document.getElementById('view');
    var t = v.textContent || '';
    return { len: v.innerHTML.length, hasNumber: /\\d+\\.\\d+/.test(t) };
  })()`);
  console.log('      实验室运行后：' + labOut.len + ' 字符 · 有数值=' + labOut.hasNumber);
  assert.equal(labOut.hasNumber, true, '实验室运行后没有出现数值结果');

  await click('#labReset', { label: '实验室恢复默认', wait: 600 });
  await click('#labExport', { label: '实验室导出结果', effect: 'any', wait: 700 });

  // ---- 模型工坊 ----
  await goto('#/studio');
  await closeOverlay();
  await selectIndex('#studioDataset', 1, 800);

  // 先清空编辑器再载入：工坊草稿会持久化，上一轮跑完时编辑器里可能已经是示例模型，
  // 「长度变了」这种断言就会假失败。清空后断言「从空变成有内容」才是稳的。
  await page.evaluate(`TSJ.appStore.state.editor.setValue('')`);
  await sleep(200);
  const beforeTpl = await page.evaluate(`TSJ.appStore.state.editor.getValue().length`);
  await click('#studioTemplate', { label: '工坊载入示例模型', wait: 700 });
  const afterTpl = await page.evaluate(`TSJ.appStore.state.editor.getValue().length`);
  console.log('      示例模型：' + beforeTpl + ' → ' + afterTpl + ' 字符');
  assert.equal(beforeTpl, 0, '清空编辑器失败（' + beforeTpl + ' 字符）');
  assert.ok(afterTpl > 100, '「载入示例模型」没有写入代码（' + afterTpl + ' 字符）');

  await click('#studioRunVal', { label: '工坊①验证集评估', wait: 4000 });
  const val = await page.evaluate(`(function(){
    var r = document.getElementById('studioRecords');
    return { len: r ? r.innerHTML.length : 0, text: r ? r.textContent.trim().slice(0, 60) : '' };
  })()`);
  console.log('      验证集评估：记录区 ' + val.len + ' 字符');
  assert.ok(val.len > 100, '①验证集评估后记录区为空');

  await click('#studioRunFinal', { label: '工坊②最终评测', wait: 4000 });
  const fin = await page.evaluate(`document.getElementById('studioRecords').innerHTML.length`);
  console.log('      最终评测后记录区：' + fin + ' 字符');
  assert.ok(fin >= val.len, '②最终评测没有追加记录');

  await click('#studioShare', { label: '工坊分享卡', effect: 'any', wait: 1200 });
  await click('#studioExport', { label: '工坊导出记录', effect: 'any', wait: 900 });

  // 清空记录：必须弹确认框，取消后记录还在
  await click('#studioClear', { label: '工坊清空记录', effect: 'overlay', wait: 500 });
  const confirmText = await page.evaluate(`document.getElementById('overlay').textContent.trim().slice(0, 60)`);
  console.log('      清空确认框：' + JSON.stringify(confirmText));
  assert.ok(confirmText.length > 0, '清空记录的确认框是空的');
  await closeOverlay();
  const afterCancel = await page.evaluate(`document.getElementById('studioRecords').innerHTML.length`);
  assert.ok(afterCancel > 100, '取消清空后记录被清掉了（' + afterCancel + ' 字符）');

  report('实验室/工坊交互');
});

test('C07 提交记录：列表 / 详情 / 导出 / 清空确认', async (t) => {
  failures = [];   // 上一条用例 assert 抛错时 report() 没跑到，残留会污染本条
  if (!page) return t.skip('无浏览器');
  await goto('#/submissions');
  await closeOverlay();

  const rows = await page.evaluate(`document.querySelectorAll('#view .sub-row, #view table.ptable tbody tr').length`);
  console.log('      提交记录行：' + rows + ' 行');
  assert.ok(rows >= 1, '提交记录为空（前面的提交没有落盘？）');

  // 点开详情
  await clickByText('#view .sub-row, #view table.ptable tbody tr', '朴素', { label: '提交记录第一行', wait: 500 });
  const subHash = await page.evaluate('location.hash');
  console.log('      提交详情 → ' + subHash);
  assert.match(subHash, /^#\/submission\//, '点提交记录没有进入详情页');
  const detailLen = await page.evaluate(`document.getElementById('view').innerHTML.length`);
  assert.ok(detailLen > 800, '提交详情内容过少（' + detailLen + ' 字符）');

  // 导出 / 导入 / 清空
  await goto('#/submissions');
  await click('#btnExport', { label: '导出进度', effect: 'any', wait: 800 });
  await click('#btnImport', { label: '导入进度（触发文件选择）', effect: 'any', wait: 500 });
  await click('#btnClear', { label: '清空进度', effect: 'overlay', wait: 500 });
  const clearText = await page.evaluate(`document.getElementById('overlay').textContent.trim().slice(0, 60)`);
  console.log('      清空确认框：' + JSON.stringify(clearText));
  assert.ok(clearText.length > 0, '清空进度的确认框是空的');
  // 取消，别把后面用例的数据清掉
  await click('#clearCancel', { label: '取消清空', wait: 400 });

  report('提交记录交互');
});
