/**
 * library.test.js —— v2.2 第一批：方法库（知识库）页面验收
 *
 * 覆盖（对应施工图 5.2 的 6 条）：
 *   1. 数据层完整性：46 条、tier 只有五个合法值、必填字段齐全、id 唯一；
 *   2. practice 引用的题目必须存在（第二批的 6 道新题尚未落地，用精确白名单兜住）；
 *   3. runnable 与 practice 的一致性（可跑且有题 / 有题必须可跑）；
 *   4. 无头浏览器：#/methods 默认 46 张、搜索 patch、层筛选 14 张、只看能练的 14 张、清空回 46；
 *   5. 点「去练这道题」→ hash 变成对应 #/problem/<id>；
 *   6. 375px 下 scrollWidth === 375，展开区两栏改堆叠、卡片不溢出。
 *
 * 找不到浏览器时整体 skip（与 browser.test.js / features.test.js 口径一致）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT, loadEngine, fileOf } = require('./helpers/engine');
const { launch, findBrowser } = require('./helpers/cdp');

const engine = loadEngine();
const TSJ = engine.TSJ;
// methods.js 挂到 window.TSJ 上，同时 module.exports 出数组本身（附带 tiers / methodsById）
const methods = require(fileOf('methods'));
const TIERS = methods.tiers.map((t) => t.id);

/**
 * practice 引用白名单：methods.js 里每条方法的 practice 指向的题目必须真实存在。
 *
 * v2.2 第二批（p10–p15 落地）之后这里就是空的 —— 空名单意味着「一个都不许缺」。
 * 如果将来又出现「内容层先行、题目后补」的过渡期，请把缺口作为精确清单临时列在这里，
 * 并在题目落地后立刻清空；本文件下方的反向断言会在题落地后强制提醒清理。
 */
const PENDING_PRACTICE = [];

const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();

let page = null;

/**
 * 惰性启动浏览器：只在第一个浏览器用例里启动，而不是 test.before。
 * 原因：整个 QA 套件里有 4 个文件各自拉起一个无头浏览器，如果本文件一进来就占住一个进程，
 * 会拉长「4 个浏览器同时存活」的窗口，把 browser.test.js 里对时间敏感的 Worker 判题用例挤到超时
 * （已实测：把本文件移出后 6 轮全绿，留着时偶发 TLE）。断言一条没动，只是缩短占用时间。
 * @returns {Promise<Object|null>}
 */
async function ensurePage() {
  if (!HAS_BROWSER) return null;
  if (!page) page = await launch(INDEX_URL, { timeout: 25000, readyTimeout: 20000 });
  return page;
}

test.after(() => {
  if (page) page.close();
});

/**
 * 轮询等待页面内条件成立（不用固定 sleep 掩盖加载）。
 * @param {string} expr 表达式
 * @param {number} [timeout] 毫秒
 * @returns {Promise<boolean>}
 */
async function waitFor(expr, timeout) {
  const end = Date.now() + (timeout || 8000);
  while (Date.now() < end) {
    if (await page.evaluate('!!(' + expr + ')')) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

/**
 * 重置到「干净存储 + 方法库页」。
 * @returns {Promise<void>}
 */
async function resetMethods() {
  await page.evaluate(
    '(function(){try{localStorage.clear();localStorage.setItem("tsoj:onboarded","true");}catch(e){}' +
      'location.hash="#/methods";})()'
  );
  await page.reload();
  await page.evaluate('if (location.hash !== "#/methods") location.hash = "#/methods";');
  const ok = await waitFor('document.querySelectorAll(".mcard").length === 46');
  assert.ok(ok, '方法库未渲染出 46 张卡片');
}

/** 当前卡片数。 */
const cardCount = () => page.evaluate('document.querySelectorAll(".mcard").length');

/**
 * 在搜索框里输入并等筛选结果稳定。
 * @param {string} q 关键词
 * @param {string} expect 期望成立的表达式（如 '=== 1'）
 * @returns {Promise<boolean>}
 */
async function setSearch(q, expect) {
  await page.evaluate(
    '(function(){var el=document.getElementById("methodSearch");el.value=' + JSON.stringify(q) +
      ';el.dispatchEvent(new Event("input",{bubbles:true}));})()'
  );
  return waitFor('document.querySelectorAll(".mcard").length ' + expect);
}

/* ================================================================== *
 * 1–3 数据层（纯 Node，无浏览器）
 * ================================================================== */

test('L01 数据层：46 条方法，tier 只有五个合法值，必填字段齐全且 id 唯一', () => {
  assert.equal(methods.length, 46, '方法数应为 46，实际 ' + methods.length);
  assert.deepEqual(TIERS, ['classic', 'competition', 'deep', 'foundation', 'eval'], '分层定义与施工图不一致');

  const required = ['id', 'name', 'venue', 'year', 'idea', 'when', 'limit', 'runnable'];
  const seen = new Set();
  const bad = [];
  for (const m of methods) {
    if (!TIERS.includes(m.tier)) bad.push(m.id + ' 的 tier 非法：' + m.tier);
    for (const k of required) {
      const v = m[k];
      const empty = v === undefined || v === null || v === '';
      if (empty) bad.push(m.id + ' 缺字段 ' + k);
    }
    if (typeof m.runnable !== 'boolean') bad.push(m.id + ' 的 runnable 不是布尔值');
    if (!Array.isArray(m.tags) || m.tags.length === 0) bad.push(m.id + ' 的 tags 为空');
    if (seen.has(m.id)) bad.push('id 重复：' + m.id);
    seen.add(m.id);
  }
  assert.deepEqual(bad, [], '数据层问题：' + bad.join('; '));

  // 每层数量（页面 chips 上的数字就是这四个）
  const byTier = (t) => methods.filter((m) => m.tier === t).length;
  assert.deepEqual(
    { classic: byTier('classic'), competition: byTier('competition'), deep: byTier('deep'),
      foundation: byTier('foundation'), eval: byTier('eval') },
    { classic: 13, competition: 3, deep: 14, foundation: 10, eval: 6 },
    '五层数量与内容契约不一致'
  );
  assert.equal(methods.filter((m) => !!m.practice).length, 14, '「可练」应为 14 条');
});

test('L02 practice 引用的题目必须存在（第二批 6 题未落地时走精确白名单）', () => {
  const practiceIds = methods.filter((m) => !!m.practice).map((m) => m.practice);
  const missing = practiceIds.filter((id) => !TSJ.findProblem(id));
  console.log('    practice 共 ' + practiceIds.length + ' 条 · 当前缺失 ' + missing.length +
    ' 条：' + JSON.stringify(missing));
  // 精确断言：缺失的必须正好是「第二批待落地」的那 6 个，多一个少一个都失败
  assert.deepEqual(missing.slice().sort(), PENDING_PRACTICE.slice().sort(),
    'practice 指向了不存在的题目（除第二批待落地的 6 题之外不应再有缺口）：' + JSON.stringify(missing));
  // 反向：白名单里的 id 一旦落地就要清空白名单（否则本断言失败）
  const resolved = PENDING_PRACTICE.filter((id) => TSJ.findProblem(id));
  assert.deepEqual(resolved, [], '这些题已经落地，请把 library.test.js 的 PENDING_PRACTICE 清空：' +
    JSON.stringify(resolved));
});

test('L03 runnable 与 practice 一致：有题的必须可跑，可跑的题必须存在', () => {
  const bad = [];
  for (const m of methods) {
    if (!m.practice) continue;
    // 有对应题目却说沙箱跑不了 —— 数据自相矛盾
    if (m.runnable !== true) bad.push(m.id + ' 有 practice 但 runnable=false');
    // 可跑的方法一旦声明了题目，题目就必须存在（否则用户点进去没题）
    if (m.runnable === true && !TSJ.findProblem(m.practice) && !PENDING_PRACTICE.includes(m.practice)) {
      bad.push(m.id + ' 的 practice 指向不存在的题目：' + m.practice);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
  // 沙箱跑不了的方法只允许出现在「知识卡片」里：不得声明 practice
  const noSandbox = methods.filter((m) => m.runnable === false);
  console.log('    沙箱跑不了的方法 ' + noSandbox.length + ' 条：' +
    noSandbox.map((m) => m.id).join(', '));
  assert.ok(noSandbox.length >= 10, '应有相当数量的方法属于「仅供选型参考」');
});

/* ================================================================== *
 * 4–6 真实浏览器
 * ================================================================== */

test('L04 #/methods 默认 46 张卡片；搜索 patch；层筛选 14 张；只看能练的 13 张；清空回 46', async (t) => {
  if (!(await ensurePage())) return t.skip('无浏览器');
  await resetMethods();

  // 副标题必须现算（不许写死数字）
  const sub = await page.evaluate('document.querySelector("#view .page-head .sub").textContent');
  const expectSub = methods.length + ' 个方法 · ' + TIERS.length + ' 个层次 · ' +
    methods.filter((m) => !!m.practice).length + ' 个可练';
  console.log('    副标题「' + sub + '」');
  assert.equal(sub, expectSub, '副标题必须从 TSJ.methods 现算');

  // 层 chips 上带每层数量（层名与顺序都取自 methods.js 的 TIERS，不在页面里另写一份）
  const chips = await page.evaluate(
    '[].map.call(document.querySelectorAll(".chip[data-tier]"), function(c){return c.textContent;})'
  );
  const expectChips = ['全部(' + methods.length + ')'].concat(
    methods.tiers.map((t) => t.name + '(' + methods.filter((m) => m.tier === t.id).length + ')')
  );
  console.log('    chips：' + JSON.stringify(chips));
  assert.deepEqual(chips, expectChips);
  assert.deepEqual(chips, ['全部(46)', '经典统计(13)', '竞赛级方法(3)', '顶会深度学习(14)', '时序基础模型(10)', '评估方法论(6)']);

  // 默认态：46 张，且没有任何预置筛选
  const base = await cardCount();
  console.log('    默认卡片数=' + base + ' · 搜索框初值=' +
    JSON.stringify(await page.evaluate('document.getElementById("methodSearch").value')) +
    ' · 开关=' + (await page.evaluate('document.getElementById("onlyPractice").checked')));
  assert.equal(base, 46, '默认态必须是 46 张卡片');

  // 搜索 patch（命中 PatchTST 的 name / idea；v3.2 起 patch 已是通用术语，
  // TimesFM/Timer/Sundial/Time-LLM 等新卡的 idea 里也会出现，只约束上界）
  assert.ok(await setSearch('patch', '<= 8 && document.querySelectorAll(".mcard").length >= 1'),
    '搜索 patch 没有收敛');
  const patch = await cardCount();
  const patchIds = await page.evaluate(
    '[].map.call(document.querySelectorAll(".mcard"), function(c){return c.getAttribute("data-mid");})'
  );
  console.log('    搜索 "patch" → ' + patch + ' 张：' + JSON.stringify(patchIds));
  assert.ok(patch >= 1 && patch <= 8, '搜索 patch 应命中 1–8 张，实际 ' + patch);
  assert.ok(patchIds.includes('patchtst'), 'patch 必须命中 PatchTST');

  // 清空搜索 → 回 29
  assert.ok(await setSearch('', '=== 46'), '清空搜索后应回到 46 张');

  // 层筛选「顶会深度学习」= 9 张
  await page.evaluate('document.querySelector(".chip[data-tier=\\"deep\\"]").click()');
  assert.ok(await waitFor('document.querySelectorAll(".mcard").length === 14'), '深度学习层应为 14 张');
  const deepIds = await page.evaluate(
    '[].map.call(document.querySelectorAll(".mcard"), function(c){return c.getAttribute("data-tier");})'
  );
  console.log('    层「顶会深度学习」→ ' + deepIds.length + ' 张，tier 全为 deep=' +
    deepIds.every((x) => x === 'deep'));
  assert.ok(deepIds.every((x) => x === 'deep'), '层筛选结果里混入了其它层');

  // 层 + 搜索取交集：deep 层里搜 patch 仍只命中 patchtst
  assert.ok(await setSearch('patch', '=== 1'), '层与搜索应取交集');

  // 回到全部 + 空搜索
  await page.evaluate('document.querySelector(".chip[data-tier=\\"all\\"]").click()');
  assert.ok(await setSearch('', '=== 46'), '层回到全部、搜索清空后应回 46 张');

  // 「只看能练的」= 13 张
  await page.evaluate(
    '(function(){var b=document.getElementById("onlyPractice");b.checked=true;' +
      'b.dispatchEvent(new Event("change",{bubbles:true}));})()'
  );
  assert.ok(await waitFor('document.querySelectorAll(".mcard").length === 14'), '只看能练的应为 14 张');
  const withPractice = await page.evaluate(
    '[].every.call(document.querySelectorAll(".mcard"), function(c){' +
      'return !!TSJ.methodsById(c.getAttribute("data-mid")).practice;})'
  );
  console.log('    只看能练的 → 14 张 · 全部带 practice=' + withPractice);
  assert.equal(withPractice, true, '开关打开后仍有方法没有 practice');

  // 空态：开关 + 一个搜不到的词
  assert.ok(await setSearch('zzz-no-such-method', '=== 0'), '无结果时卡片应为 0');
  const empty = await page.evaluate(
    '(function(){var e=document.querySelector("#methodList .empty");return {has:!!e,btn:!!document.querySelector("[data-clear]")};})()'
  );
  assert.equal(empty.has, true, '无结果必须有空态');
  assert.equal(empty.btn, true, '空态里要有「清除筛选」');

  // 清除筛选 → 回 46 张
  await page.evaluate('document.querySelector("#btnMethodClear").click()');
  assert.ok(await waitFor('document.querySelectorAll(".mcard").length === 46'), '清除筛选后应回到 46 张');
  console.log('    清除筛选 → 46 张');
  assert.deepEqual(page.exceptions, [], '方法库出现未捕获异常：' + JSON.stringify(page.exceptions));
});

test('L05 展开卡片 → 点「去练这道题」跳到对应题目', async (t) => {
  if (!(await ensurePage())) return t.skip('无浏览器');
  await resetMethods();

  // 默认收起
  const before = await page.evaluate(
    '(function(){var c=document.querySelector(".mcard[data-mid=\\"naive\\"]");' +
      'return {open:c.classList.contains("mcard-open"),expanded:c.querySelector(".mc-title").getAttribute("aria-expanded"),' +
      'hidden:c.querySelector(".mc-body").hasAttribute("hidden")};})()'
  );
  assert.equal(before.open, false, '默认必须收起');
  assert.equal(before.expanded, 'false', '收起态 aria-expanded 应为 false');
  assert.equal(before.hidden, true, '收起态展开区应 hidden');

  // 键盘 Enter 展开
  await page.evaluate(
    '(function(){var el=document.querySelector(".mcard[data-mid=\\"naive\\"] .mc-title");' +
      'el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));})()'
  );
  assert.ok(await waitFor('document.querySelector(".mcard[data-mid=\\"naive\\"]").classList.contains("mcard-open")'),
    'Enter 应能展开卡片');
  const opened = await page.evaluate(
    '(function(){var c=document.querySelector(".mcard[data-mid=\\"naive\\"]");' +
      'return {expanded:c.querySelector(".mc-title").getAttribute("aria-expanded"),' +
      'text:c.querySelector(".mc-body").textContent,' +
      'formula:!!c.querySelector(".mc-formula"),' +
      'src:(c.querySelector(".mc-src")||{}).href||"",' +
      'rel:(c.querySelector(".mc-src")||{}).getAttribute?c.querySelector(".mc-src").getAttribute("rel"):""};})()'
  );
  assert.equal(opened.expanded, 'true', '展开后 aria-expanded 应为 true');
  assert.ok(opened.text.indexOf('核心思想') >= 0 && opened.text.indexOf('适用') >= 0 &&
    opened.text.indexOf('局限') >= 0, '展开区缺少四个小节');
  assert.equal(opened.formula, true, '朴素法有 formula，应渲染关键式子块');
  assert.ok(opened.src.indexOf('https://www.bing.com/search?q=') === 0, '检索原文应指向 Bing：' + opened.src);
  assert.match(opened.rel, /noopener/, '检索原文必须带 noopener');

  // 另外两种底部文案：无题但可跑 / 沙箱跑不了
  const notes = await page.evaluate(
    '(function(){' +
      'var out={};' +
      '["ets","nbeats"].forEach(function(id){' +
      '  var c=document.querySelector(".mcard[data-mid=\\""+id+"\\"]");' +
      '  c.querySelector(".mc-title").click();' +
      '  var n=c.querySelector(".mc-note");' +
      '  out[id]={note:n?n.textContent:null,hasPractice:!!c.querySelector(".mc-practice"),' +
      '    formula:!!c.querySelector(".mc-formula")};' +
      '});' +
      'return out;})()'
  );
  console.log('    ets=' + JSON.stringify(notes.ets) + ' · nbeats=' + JSON.stringify(notes.nbeats));
  assert.equal(notes.ets.note, '暂无对应题目', 'ets 可跑但无题，应显示「暂无对应题目」');
  assert.equal(notes.ets.hasPractice, false, 'ets 不应出现「去练这道题」');
  assert.equal(notes.nbeats.note, '沙箱跑不了，仅供选型参考', 'N-BEATS 应显示「沙箱跑不了」');
  assert.equal(notes.nbeats.hasPractice, false, 'N-BEATS 不应出现「去练这道题」');

  // 点「去练这道题」→ 路由跳到 p1-naive
  await page.evaluate('document.querySelector(".mcard[data-mid=\\"naive\\"] .mc-practice").click()');
  assert.ok(await waitFor('location.hash === "#/problem/p1-naive"'), 'hash 未跳到 #/problem/p1-naive');
  console.log('    点「去练这道题」→ ' + (await page.evaluate('location.hash')));
  assert.deepEqual(page.exceptions, [], '跳转过程出现异常：' + JSON.stringify(page.exceptions));
});

test('L06 375px：scrollWidth === 375，展开区两栏改堆叠，卡片不溢出', async (t) => {
  if (!(await ensurePage())) return t.skip('无浏览器');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 1, mobile: true,
  });
  try {
    await resetMethods();
    // 展开第一张卡片，验证展开区在窄屏下堆叠
    await page.evaluate('document.querySelector(".mcard .mc-title").click()');
    assert.ok(await waitFor('!!document.querySelector(".mcard-open .mc-grid")'), '展开区未渲染');

    const m = await page.evaluate(
      `(function(){
        var cards = document.querySelectorAll('.mcard');
        var maxRight = 0;
        for (var i = 0; i < cards.length; i++) {
          var r = cards[i].getBoundingClientRect();
          if (r.right > maxRight) maxRight = r.right;
        }
        var grid = document.querySelector('.mcard-open .mc-grid');
        var cols = grid ? getComputedStyle(grid).gridTemplateColumns : '';
        var f = document.querySelector('.mcard-open .mc-formula');
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          cards: cards.length,
          maxRight: Math.round(maxRight),
          cols: cols,
          formulaRight: f ? Math.round(f.getBoundingClientRect().right) : 0
        };
      })()`
    );
    console.log('    375px 方法库：scrollWidth=' + m.scroll + '（client=' + m.client + '）· 卡片 ' +
      m.cards + ' 张 · 卡片最右 ' + m.maxRight + 'px · 展开区列宽「' + m.cols + '」');

    assert.equal(m.client, 375, '视口不是 375（CDP 覆盖失败）');
    assert.equal(m.scroll, 375, '375px 下整页横向溢出：scrollWidth=' + m.scroll);
    assert.equal(m.cards, 46, '375px 下仍应渲染 46 张卡片');
    assert.ok(m.maxRight <= 375, '卡片右侧超出视口：' + m.maxRight);
    assert.equal(m.cols.split(' ').length, 1, '窄屏展开区应堆叠成一栏，实际列宽「' + m.cols + '」');
    assert.ok(m.formulaRight <= 375, '关键式子块溢出：' + m.formulaRight);
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
});
