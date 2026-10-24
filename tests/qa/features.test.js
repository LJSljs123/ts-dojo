/**
 * features.test.js —— T05–T11 的功能验收（真实浏览器 + CDP）
 *
 *   T05 存储层升级：导出 / 导入 / 清空的往返一致性、校验哈希、旧 schema、配额提示
 *   T06 提交详情：代码快照 + 逐测试点、刷新后可访问、不存在 id 的空态
 *   T07 窄屏适配：375px 不横向溢出、题库标题不再一字一行、768/1280 不回归
 *   T08 图表交互：tooltip 数值与 values 一致、移出隐藏、路由切换不累积监听
 *   T09 题库搜索 / 标签 / 随机一题
 *   T10 编辑器：字号切换后 markError 仍准、括号同亮、2000 行单键 <50ms、Ctrl+S 存草稿
 *   T11 可访问性：焦点陷阱、ESC 关闭、焦点回 #view、aria-live
 *
 * 找不到浏览器时整体 skip（与 browser.test.js 口径一致）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT, loadEngine } = require('./helpers/engine');
const PROBLEM_COUNT = loadEngine().problems.length;
const { launch, findBrowser } = require('./helpers/cdp');

const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();
const P1 = 'p1-naive';

let page = null;

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 25000, readyTimeout: 20000 });
});

test.after(() => {
  if (page) page.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等待页面内条件成立。
 * @param {string} expr 表达式
 * @param {number} [timeout] 毫秒
 * @returns {Promise<boolean>}
 */
async function waitFor(expr, timeout) {
  const end = Date.now() + (timeout || 8000);
  while (Date.now() < end) {
    if (await page.evaluate('!!(' + expr + ')')) return true;
    await sleep(60);
  }
  return false;
}

/**
 * 重置到「干净存储 + 指定路由」。
 * @param {string} hash 路由
 * @returns {Promise<void>}
 */
async function reset(hash) {
  await page.evaluate(
    '(function(){try{localStorage.clear();localStorage.setItem("tsoj:onboarded","true");}catch(e){}' +
      'location.hash=' + JSON.stringify(hash) + ';})()'
  );
  await page.reload();
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(150);
}

/** 切路由并等一小会儿。 */
async function goto(hash) {
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(220);
}

/** 逐字段 diff（返回不一致的路径列表）。 */
function diffDeep(a, b, prefix, out) {
  const path0 = prefix || '';
  const list = out || [];
  const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  if (type(a) !== type(b)) {
    list.push(path0 + ' 类型不同：' + type(a) + ' vs ' + type(b));
    return list;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) list.push(path0 + ' 长度不同：' + a.length + ' vs ' + b.length);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diffDeep(a[i], b[i], path0 + '[' + i + ']', list);
    return list;
  }
  if (a && typeof a === 'object') {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) diffDeep(a[k], b[k], path0 + '.' + k, list);
    return list;
  }
  if (a !== b) list.push(path0 + ' 值不同：' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  return list;
}

/* ================================================================== *
 * T05 存储层升级
 * ================================================================== */

/** 一份确定的种子数据（写入 localStorage 后 reload 装载）。 */
const SEED = `(function(){
  var prog = {'p1-naive': {best:73, passed:true, attempts:2, lastVerdict:'AC', lastAt:1700000000000}};
  var drafts = {'p1-naive': 'function predict(h,n,c){ return new Array(n).fill(1); }'};
  var subs = [{
    id:'s-1700000000000-abcd1234', at:1700000000000, problemId:'p1-naive', title:'朴素预测',
    score:73, verdict:'AC', passed:true, metric:'MSE', code:'function predict(h,n,c){ return new Array(n).fill(1); }',
    cases:[{index:0, verdict:'AC', score:73, yourMetric:1.25, bestBaseline:1.1, baselineName:'naive'}],
    degraded:false
  }];
  localStorage.setItem('tsoj:progress', JSON.stringify(prog));
  localStorage.setItem('tsoj:drafts', JSON.stringify(drafts));
  localStorage.setItem('tsoj:submissions', JSON.stringify(subs));
  localStorage.setItem('tsoj:onboarded','true');
})()`;

test('T05 导出 → 清空 → 导入：progress / drafts / submissions 逐字段一致', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/submissions');
  await page.evaluate(SEED);
  await page.reload();
  await page.evaluate('location.hash = "#/submissions"');
  await sleep(200);

  const out = await page.evaluate(
    `(function(){
      var st = TSJ.appStore.state;
      var snap = function(){
        return {
          progress: JSON.parse(JSON.stringify(st.progress)),
          drafts: JSON.parse(JSON.stringify(st.drafts)),
          submissions: JSON.parse(JSON.stringify(st.submissions))
        };
      };
      var before = snap();
      // 导出：真的走 Blob + a.download（返回值就是写进文件的那份文本）
      var text = TSJ.appStorage.exportProgress();
      var bundle = JSON.parse(text);
      var fileName = TSJ.appStorage.exportFileName(1700000000000);

      // 清空：只删 tsoj:* 前缀
      localStorage.setItem('qa:other', 'keep-me');
      var removed = TSJ.appStorage.clearAll();
      var afterClear = snap();
      var keptOther = localStorage.getItem('qa:other');
      var leftTsoj = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('tsoj:') === 0) leftTsoj.push(k);
      }

      // 导入
      var parsed = TSJ.appStorage.parseBundle(text);
      var counts = parsed.ok ? TSJ.appStorage.applyImport(parsed.data) : null;
      var after = snap();
      // 落盘是否也一致
      var disk = {
        progress: JSON.parse(localStorage.getItem('tsoj:progress') || '{}'),
        drafts: JSON.parse(localStorage.getItem('tsoj:drafts') || '{}'),
        submissions: JSON.parse(localStorage.getItem('tsoj:submissions') || '[]')
      };
      return {
        before: before, afterClear: afterClear, after: after, disk: disk,
        schema: bundle.schema, app: bundle.app, hashLen: (bundle.hash || '').length,
        fileName: fileName, removed: removed, keptOther: keptOther, leftTsoj: leftTsoj,
        parsedOk: parsed.ok, parsedReason: parsed.reason, counts: counts
      };
    })()`
  );

  console.log('    导出文件名：' + out.fileName + ' · schema=' + out.schema + ' · app=' + out.app +
    ' · hash 长度=' + out.hashLen);
  console.log('    清空删除键：' + JSON.stringify(out.removed) + ' · 残留 tsoj 键=' + JSON.stringify(out.leftTsoj) +
    ' · 非 tsoj 键保留=' + JSON.stringify(out.keptOther));
  console.log('    清空后条目数：progress=' + Object.keys(out.afterClear.progress).length +
    ' drafts=' + Object.keys(out.afterClear.drafts).length + ' submissions=' + out.afterClear.submissions.length);
  console.log('    导入计数：' + JSON.stringify(out.counts));

  const diff = diffDeep(out.before, out.after, '', []);
  console.log('    逐字段 diff（before vs after）：' + (diff.length === 0 ? '无差异' : JSON.stringify(diff)));
  const diffDisk = diffDeep(out.before, out.disk, '', []);
  console.log('    逐字段 diff（before vs 落盘）：' + (diffDisk.length === 0 ? '无差异' : JSON.stringify(diffDisk)));

  assert.equal(out.schema, 1);
  assert.equal(out.app, 'tsoj');
  assert.equal(out.hashLen, 8, 'hash 应为 8 位 FNV-1a 十六进制');
  assert.match(out.fileName, /^tsoj-progress-\d{8}\.json$/);
  // 清空的语义：删掉「所有」tsoj:* 键，且一个非 tsoj 键都不许碰。
  // 不写死完整键名清单 —— 新增键（如 tsoj:edFont）不应让这条用例失效。
  assert.ok(out.removed.length >= 3, '清空至少应删除 progress / drafts / submissions 三个键');
  assert.deepEqual(
    out.removed.filter((k) => k.indexOf('tsoj:') !== 0), [],
    '只应删除 tsoj:* 键，实际删了：' + JSON.stringify(out.removed));
  ['tsoj:progress', 'tsoj:drafts', 'tsoj:submissions'].forEach(function (k) {
    assert.ok(out.removed.indexOf(k) >= 0, '清空应删除 ' + k);
  });
  assert.deepEqual(out.leftTsoj, [], '清空后不应残留 tsoj:* 键');
  assert.equal(out.keptOther, 'keep-me', '清空不得影响非 tsoj 前缀的键');
  assert.deepEqual(out.afterClear.progress, {}, '清空后进度应为空');
  assert.deepEqual(out.afterClear.submissions, [], '清空后提交记录应为空');
  assert.equal(out.parsedOk, true, '导出的文件必须能重新导入：' + out.parsedReason);
  assert.deepEqual(diff, [], '往返后内存态不一致：' + JSON.stringify(diff));
  assert.deepEqual(diffDisk, [], '往返后落盘不一致：' + JSON.stringify(diffDisk));
});

test('T05 篡改 hash 被拒，且现有数据一点不动', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/submissions');
  await page.evaluate(SEED);
  await page.reload();
  await sleep(200);

  const out = await page.evaluate(
    `(function(){
      var text = JSON.stringify(TSJ.appStorage.buildBundle(), null, 2);
      var obj = JSON.parse(text);
      obj.data.progress['p1-naive'].best = 100;   // 改数据但不改 hash
      var tampered = JSON.stringify(obj);
      var snapBefore = JSON.stringify(TSJ.appStore.state.progress);
      var res = TSJ.appStorage.parseBundle(tampered);
      var snapAfter = JSON.stringify(TSJ.appStore.state.progress);
      return { ok: res.ok, reason: res.reason, unchanged: snapBefore === snapAfter };
    })()`
  );
  console.log('    篡改后导入结果：ok=' + out.ok + ' · 原因=' + out.reason);
  assert.equal(out.ok, false, '被篡改的文件必须拒绝');
  assert.match(out.reason, /校验失败/, '应给出「校验失败」的具体原因：' + out.reason);
  assert.equal(out.unchanged, true, '校验失败时不得改动现有数据');
});

test('T05 旧 schema（0）可导入、过新 schema（99）被拒且不崩', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/submissions');
  await page.evaluate(SEED);
  await page.reload();
  await sleep(200);

  const out = await page.evaluate(
    `(function(){
      var core = TSJ.appCore;
      var mk = function(schema){
        // 旧版文件：data 里没有 id / cases / degraded 这些 T05 才有的字段
        var data = {
          progress: {'p1-naive': {best: 60, passed: true, attempts: 1}},
          drafts: {},
          submissions: [{at: 1600000000000, problemId: 'p1-naive', title: '旧记录', score: 60, verdict: 'AC', passed: true, metric: 'MSE'}]
        };
        return JSON.stringify({schema: schema, app: 'tsoj', exportedAt: 1600000000000, data: data, hash: core.fnv1a(JSON.stringify(data))});
      };
      var old = TSJ.appStorage.parseBundle(mk(0));
      var applied = old.ok ? TSJ.appStorage.applyImport(old.data) : null;
      var legacy = TSJ.appStore.state.submissions.filter(function(s){ return s.problemId === 'p1-naive' && s.score === 60; });
      var tooNew = TSJ.appStorage.parseBundle(mk(99));
      var badJson = TSJ.appStorage.parseBundle('{not json');
      var notOurs = TSJ.appStorage.parseBundle(JSON.stringify({app: 'other', schema: 1, data: {}}));
      var noHash = TSJ.appStorage.parseBundle(JSON.stringify({app: 'tsoj', schema: 0, data: {progress: {}}}));
      return {
        oldOk: old.ok, oldSchema: old.schema, applied: applied,
        legacyId: legacy.length ? legacy[0].id : null,
        legacyCases: legacy.length ? legacy[0].cases.length : -1,
        legacyCode: legacy.length ? legacy[0].code : null,
        tooNew: {ok: tooNew.ok, reason: tooNew.reason},
        badJson: {ok: badJson.ok, reason: badJson.reason},
        notOurs: {ok: notOurs.ok, reason: notOurs.reason},
        noHash: {ok: noHash.ok, reason: noHash.reason}
      };
    })()`
  );
  console.log('    旧 schema 导入：ok=' + out.oldOk + ' schema=' + out.oldSchema +
    ' 计数=' + JSON.stringify(out.applied) + ' 补出的 id=' + JSON.stringify(out.legacyId));
  console.log('    schema 99 → ' + JSON.stringify(out.tooNew));
  console.log('    非法 JSON → ' + JSON.stringify(out.badJson));
  console.log('    app 不是 tsoj → ' + JSON.stringify(out.notOurs));
  console.log('    缺 hash → ' + JSON.stringify(out.noHash));

  assert.equal(out.oldOk, true, 'schema 0 的旧文件必须能导入');
  assert.equal(out.oldSchema, 0);
  assert.ok(out.legacyId, '旧记录应被补出稳定 id，详情路由才可访问');
  assert.equal(out.legacyCases, 0, '旧记录没有逐测试点，应归一化为空数组而不是 undefined');
  assert.equal(out.legacyCode, '', '旧记录没有代码快照，应归一化为空串');
  assert.equal(out.tooNew.ok, false);
  assert.match(out.tooNew.reason, /版本过新/);
  assert.equal(out.badJson.ok, false);
  assert.match(out.badJson.reason, /合法的 JSON/);
  assert.equal(out.notOurs.ok, false);
  assert.match(out.notOurs.reason, /不是 TSOJ/);
  assert.equal(out.noHash.ok, false);
  assert.match(out.noHash.reason, /校验失败/);
});

test('T05 配额不足：writeJSON 失败要提示「本地存储已满」并降级为内存态', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/submissions');
  await sleep(150);

  const out = await page.evaluate(
    `(function(){
      var proto = Storage.prototype;
      var orig = proto.setItem;
      var toast = document.getElementById('toast');
      toast.className = 'toast';
      toast.textContent = '';
      proto.setItem = function(){
        var e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      };
      TSJ.appStore.state.drafts = {'p1-naive': 'var a = 1;'};
      var ok = TSJ.appStore.saveDrafts();
      var storageOk = TSJ.appStore.state.storageOk;
      proto.setItem = orig;
      return { ok: ok, storageOk: storageOk, toast: toast.textContent, cls: toast.className };
    })()`
  );
  console.log('    写盘返回=' + out.ok + ' · state.storageOk=' + out.storageOk +
    ' · 提示=' + JSON.stringify(out.toast) + ' · class=' + JSON.stringify(out.cls));
  assert.equal(out.ok, false, '配额不足时 writeJSON 必须返回 false');
  assert.equal(out.storageOk, false, '应降级为内存态');
  assert.match(out.toast, /本地存储已满，进度未保存/, '必须给出明确提示');
  assert.match(out.cls, /toast-show/, '提示应真正显示出来');
});

/* ================================================================== *
 * T06 提交详情
 * ================================================================== */

test('T06 提交后可在提交记录里点开详情：代码快照 + 逐测试点，刷新后仍可访问', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  assert.ok(await waitFor('document.querySelector("#view #btnSubmit")'), 'p1 页面未渲染');

  // 用参考解提交，产生一条带 code / cases 的记录
  await page.evaluate(
    `(function(){
      var ta = document.querySelector('.ed-input');
      ta.value = TSJ.findProblem(${JSON.stringify(P1)}).solution;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#view #btnSubmit').click();
    })()`
  );
  assert.ok(await waitFor('document.querySelector("#view .verdict")', 20000), '判题结果没出来');
  await sleep(400);

  await goto('#/submissions');
  const list = await page.evaluate(
    `(function(){
      var row = document.querySelector('.srow');
      return { rows: document.querySelectorAll('.srow').length, sid: row ? row.getAttribute('data-sid') : null,
               tabindex: row ? row.getAttribute('tabindex') : null };
    })()`
  );
  console.log('    提交记录行数=' + list.rows + ' · 首行 id=' + JSON.stringify(list.sid));
  assert.ok(list.rows >= 1, '应有提交记录');
  assert.ok(list.sid, '每行都要有 id 才能跳详情');
  assert.equal(list.tabindex, '0', '行必须可键盘聚焦');

  // 点行 → 进详情
  await page.evaluate('document.querySelector(".srow").click()');
  await sleep(260);
  const detail = await page.evaluate(
    `(function(){
      var code = document.querySelector('.detail-code');
      var cases = document.querySelectorAll('.case');
      var span = code ? code.querySelectorAll('span.tok-kw').length : -1;
      return {
        hash: location.hash,
        hasCode: !!code,
        tokSpans: span,
        cases: cases.length,
        imgs: document.querySelectorAll('#view img').length,
        title: document.title,
        text: code ? code.textContent.slice(0, 40) : ''
      };
    })()`
  );
  console.log('    详情页：hash=' + detail.hash + ' · 代码块=' + detail.hasCode +
    ' · 关键字高亮 span=' + detail.tokSpans + ' · 测试点行=' + detail.cases + ' · 标题=' + detail.title);
  assert.match(detail.hash, /^#\/submission\/.+/);
  assert.equal(detail.hasCode, true, '详情页必须显示代码快照');
  assert.ok(detail.tokSpans > 0, '代码块必须语法高亮（应出现 tok-kw span）');
  assert.ok(detail.cases >= 1, '详情页必须显示逐测试点');
  assert.equal(detail.imgs, 0);
  assert.match(detail.title, /· 时序竞技场 TSOJ$/);

  // 刷新后仍可访问（id 已落盘）
  const hash = detail.hash;
  await page.reload();
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(260);
  const afterReload = await page.evaluate(
    '(function(){return {code: !!document.querySelector(".detail-code"), cases: document.querySelectorAll(".case").length};})()'
  );
  console.log('    刷新后：代码块=' + afterReload.code + ' · 测试点行=' + afterReload.cases);
  assert.equal(afterReload.code, true, '刷新后详情应仍可访问');
  assert.ok(afterReload.cases >= 1);

  // 不存在的 id → 友好空态
  await goto('#/submission/does-not-exist');
  const empty = await page.evaluate(
    '(function(){var e=document.querySelector("#view .empty");return {has:!!e, text:e?e.textContent:"", link:!!document.querySelector("#view .empty a")};})()'
  );
  console.log('    不存在 id 的空态：' + JSON.stringify(empty.text.slice(0, 40)));
  assert.equal(empty.has, true, '不存在的 id 必须有空态');
  assert.ok(empty.link, '空态里要有「返回提交记录」链接');
  assert.deepEqual(page.exceptions, [], '详情流程出现未捕获异常：' + JSON.stringify(page.exceptions));
});

/* ================================================================== *
 * T07 窄屏适配
 * ================================================================== */

test('T07 375px：整页不横向溢出，题库标题不再一字一行（卡片式）', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 1, mobile: true,
  });
  try {
    await reset('#/problems');
    await sleep(250);
    const m = await page.evaluate(
      `(function(){
        var card = document.querySelector('.pcard');
        var title = card ? card.querySelector('.p-title') : null;
        var cs = title ? getComputedStyle(title) : null;
        var lh = cs ? parseFloat(cs.lineHeight) : 0;
        var table = document.querySelector('.list-table');
        var cards = document.querySelector('.pcards');
        return {
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          cardsDisplay: cards ? getComputedStyle(cards).display : null,
          tableDisplay: table ? getComputedStyle(table).display : null,
          tableOverflowX: table ? getComputedStyle(table).overflowX : null,
          prowCount: document.querySelectorAll('.prow').length,
          cardCount: document.querySelectorAll('.pcard').length,
          titleH: title ? title.clientHeight : -1,
          titleLh: lh,
          lines: lh > 0 ? (title.clientHeight / lh) : -1,
          titleText: title ? title.textContent : ''
        };
      })()`
    );
    console.log('    375px 题库：scrollWidth=' + m.docScroll + '（client=' + m.docClient + '）' +
      ' · 卡片 display=' + m.cardsDisplay + ' · 表格 display=' + m.tableDisplay +
      '（overflow-x=' + m.tableOverflowX + '）');
    console.log('    首条标题「' + m.titleText + '」高度=' + m.titleH + 'px / 行高=' + m.titleLh +
      'px → ' + m.lines.toFixed(2) + ' 行');

    assert.equal(m.docClient, 375, '视口不是 375（CDP 覆盖失败）');
    assert.equal(m.docScroll, 375, '375px 下整页横向溢出：scrollWidth=' + m.docScroll);
    assert.equal(m.cardsDisplay, 'flex', '窄屏必须切到卡片布局');
    assert.equal(m.tableDisplay, 'none', '窄屏应隐藏表格（表格给桌面端用）');
    assert.ok(m.cardCount === PROBLEM_COUNT, '卡片应有 ' + PROBLEM_COUNT + ' 张，实际 ' + m.cardCount);
    assert.equal(m.prowCount, PROBLEM_COUNT, '桌面表格的 .prow 应等于题目数（browser.test.js 依赖）');
    assert.ok(m.lines > 0 && m.lines <= 3, '标题渲染高度应 ≤3 行，实际 ' + m.lines.toFixed(2) + ' 行');

    // 题目页在 375px 下也不能横向溢出
    await goto('#/problem/' + P1);
    await sleep(200);
    const p = await page.evaluate(
      `(function(){
        var pane = document.querySelector('.pane-right');
        var host = document.querySelector('.editor-host');
        var btns = [].slice.call(document.querySelectorAll('.editor-toolbar .btn'));
        var small = btns.filter(function(b){ return b.getBoundingClientRect().height < 40; });
        return {
          docScroll: document.documentElement.scrollWidth,
          paneMinH: pane ? Math.round(pane.getBoundingClientRect().height) : -1,
          editorMinH: host ? Math.round(host.getBoundingClientRect().height) : -1,
          btns: btns.length,
          tooSmall: small.length
        };
      })()`
    );
    console.log('    375px 题目页：scrollWidth=' + p.docScroll + ' · 右栏高=' + p.paneMinH +
      'px · 编辑器高=' + p.editorMinH + 'px · 工具栏按钮=' + p.btns + ' 个（<40px 的 ' + p.tooSmall + ' 个）');
    assert.equal(p.docScroll, 375, '375px 下题目页横向溢出：scrollWidth=' + p.docScroll);
    assert.ok(p.editorMinH >= 480, '编辑器高度应至少 60vh（812*0.6≈487），实际 ' + p.editorMinH);
    assert.equal(p.tooSmall, 0, '窄屏工具栏按钮触控高度必须 ≥40px');
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
});

test('T07 768 / 1280：仍是表格布局，与改造前一致（不回归）', async (t) => {
  if (!page) return t.skip('无浏览器');
  for (const width of [768, 1280]) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    try {
      await reset('#/problems');
      await sleep(200);
      const m = await page.evaluate(
        `(function(){
          var table = document.querySelector('.list-table');
          var cards = document.querySelector('.pcards');
          return {
            docScroll: document.documentElement.scrollWidth,
            docClient: document.documentElement.clientWidth,
            tableDisplay: table ? getComputedStyle(table).display : null,
            cardsDisplay: cards ? getComputedStyle(cards).display : null,
            rows: document.querySelectorAll('.prow').length,
            headDisplay: (function(){var h=document.querySelector('.ptable thead');return h?getComputedStyle(h).display:null;})()
          };
        })()`
      );
      console.log('    ' + width + 'px：表格=' + m.tableDisplay + ' · 卡片=' + m.cardsDisplay +
        ' · .prow=' + m.rows + ' · 表头=' + m.headDisplay + ' · scrollWidth=' + m.docScroll);
      assert.equal(m.tableDisplay, 'block', width + 'px 应显示表格');
      assert.equal(m.cardsDisplay, 'none', width + 'px 不应显示卡片');
      assert.equal(m.rows, PROBLEM_COUNT, width + 'px 下 .prow 应等于题目数');
      assert.notEqual(m.headDisplay, 'none', width + 'px 下表头必须可见');
      assert.ok(m.docScroll <= m.docClient, width + 'px 出现横向溢出：' + m.docScroll);
    } finally {
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  }
});

/* ================================================================== *
 * T08 图表交互
 * ================================================================== */

test('T08 hover：tooltip 数值与 values 一致，移出即隐藏', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const out = await page.evaluate(
    `(function(){
      var canvas = document.querySelector('#view #seriesChart');
      var g = canvas.__tsjGeom;
      var handle = TSJ.appStore.state.chartHover;
      if (!g || !handle) return { err: '缺少几何信息或 hover 句柄' };
      var rect = canvas.getBoundingClientRect();
      var target = Math.round(g.n * 0.8);            // 落在测试区间里
      var x = g.xOf(target);
      var y = g.yOf(g.values[target]);
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + x, clientY: rect.top + y, bubbles: true, pointerId: 1
      }));
      var tip = handle.tip();
      var idx = handle.index();
      canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));
      var afterLeave = handle.tip();
      return {
        idx: idx, target: target, tip: tip, afterLeave: afterLeave,
        actual: g.values[target],
        predict: g.predictions ? g.predictions[target - g.testStart] : null,
        testStart: g.testStart, n: g.n
      };
    })()`
  );
  console.log('    hover 到 index=' + out.idx + '（期望 ' + out.target + '）· 真值=' + out.actual +
    ' · 预测=' + out.predict);
  console.log('    tooltip 行：' + JSON.stringify(out.tip && out.tip.lines));
  console.log('    移出后 tooltip=' + JSON.stringify(out.afterLeave));

  assert.equal(out.idx, out.target, '应命中最近的索引');
  assert.ok(out.tip, 'hover 应出现 tooltip');
  assert.equal(out.tip.values.actual, out.actual, 'tooltip 真值必须与 values 一致');
  if (out.predict !== null && out.predict !== undefined) {
    assert.equal(out.tip.values.predicted, out.predict, 'tooltip 预测值必须与 predictions 一致');
    assert.match(out.tip.lines.join(' '), /差值/, '测试区间内应显示差值');
  }
  assert.equal(out.afterLeave, null, '指针移出后 tooltip 必须隐藏');
});

test('T08 连续进出题目页 5 次，pointermove 监听仍只有 1 个', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problems');
  await page.evaluate(
    `(function(){
      window.__pmAdd = 0;
      window.__pmRemove = 0;
      var proto = HTMLCanvasElement.prototype;
      var add = proto.addEventListener;
      var rem = proto.removeEventListener;
      proto.addEventListener = function(type, fn, opts){
        if (type === 'pointermove') window.__pmAdd++;
        return add.call(this, type, fn, opts);
      };
      proto.removeEventListener = function(type, fn, opts){
        if (type === 'pointermove') window.__pmRemove++;
        return rem.call(this, type, fn, opts);
      };
    })()`
  );
  for (let i = 0; i < 5; i++) {
    await goto('#/problem/' + P1);
    await goto('#/problems');
  }
  await goto('#/problem/' + P1);
  const c = await page.evaluate('({add: window.__pmAdd, remove: window.__pmRemove})');
  const net = c.add - c.remove;
  console.log('    pointermove 监听：add=' + c.add + ' · remove=' + c.remove + ' · 净剩=' + net);
  assert.equal(net, 1, '监听数应为 1，实际 ' + net + '（路由切换没有 destroy）');
});

/* ================================================================== *
 * T09 题库搜索 / 标签 / 随机
 * ================================================================== */

test('T09 搜索 / 标签 / 难度三者取交集，默认态仍是 9 行', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problems');
  await sleep(200);

  /** 在页面里设置搜索词并等防抖。 */
  const setQuery = async (q) => {
    await page.evaluate(
      `(function(){
        var input = document.getElementById('searchInput');
        input.value = ${JSON.stringify(q)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`
    );
    await sleep(220);
  };
  const count = async () => page.evaluate('document.querySelectorAll(".prow").length');
  const rows = async () => page.evaluate('[].map.call(document.querySelectorAll(".prow"), function(r){return r.getAttribute("data-id");})');

  const base = await count();
  console.log('    默认态行数=' + base + ' · 搜索框初值=' +
    JSON.stringify(await page.evaluate('document.getElementById("searchInput").value')) +
    ' · 标签选中数=' + (await page.evaluate('document.querySelectorAll(".tag-chip.on").length')));
  assert.equal(base, PROBLEM_COUNT, '默认态必须等于题目总数（不得预置搜索词/标签）');

  await setQuery('holt');
  const holt = await count();
  const holtIds = await rows();
  console.log('    搜索 "holt" → ' + holt + ' 行：' + JSON.stringify(holtIds));

  await setQuery('');
  await page.evaluate('document.querySelector(".tag-chip[data-tag=\\"滚动回测\\"]").click()');
  await sleep(180);
  const tag = await count();
  const tagIds = await rows();
  console.log('    标签「滚动回测」→ ' + tag + ' 行：' + JSON.stringify(tagIds));
  assert.equal(tag, 1, '标签「滚动回测」应只剩 1 行');
  assert.deepEqual(tagIds, ['p9-rolling-challenge']);

  // 难度 + 标签 取交集：标签「滚动回测」+ 难度「入门」应为 0 行（并给出空态）
  await page.evaluate('document.querySelector(".chip[data-filter=\\"入门\\"]").click()');
  await sleep(180);
  const inter = await count();
  const empty = await page.evaluate(
    '(function(){var e=document.querySelector("#view .empty");return {has:!!e, btn:!!document.querySelector("#btnClearFilters")};})()'
  );
  console.log('    标签「滚动回测」+ 难度「入门」→ ' + inter + ' 行 · 空态=' + empty.has + ' · 清除筛选按钮=' + empty.btn);
  assert.equal(inter, 0, '难度与标签应取交集');
  assert.equal(empty.has, true, '无结果必须有空态提示');
  assert.equal(empty.btn, true, '空态里要有「清除筛选」');

  // 清除筛选 → 回到 9 行
  await page.evaluate('document.querySelector("#btnClearFilters").click()');
  await sleep(200);
  const cleared = await count();
  console.log('    点「清除筛选」→ ' + cleared + ' 行');
  assert.equal(cleared, PROBLEM_COUNT, '清除筛选后应回到题目总数');

  // 难度「入门」→ 2 行
  await page.evaluate('document.querySelector(".chip[data-filter=\\"入门\\"]").click()');
  await sleep(180);
  const easy = await count();
  console.log('    难度「入门」→ ' + easy + ' 行');
  assert.equal(easy, 2, '难度「入门」应有 2 行');

  // 随机一题：优先从「未通过」里抽（当前全未通过）
  await page.evaluate('document.querySelector("#btnRandom").click()');
  await sleep(220);
  const hash = await page.evaluate('location.hash');
  console.log('    「随机一题」跳到 ' + hash);
  assert.match(hash, /^#\/problem\/p\d/, '随机一题应跳到某道题');

  // 收尾：回到默认态，避免影响后续用例
  await goto('#/problems');
  await page.evaluate(
    '(function(){var b=document.querySelector("#btnClearFilters");if(b)b.click();})()'
  );
  await sleep(200);
  assert.equal(await count(), PROBLEM_COUNT);
});

/* ================================================================== *
 * T10 编辑器增强
 * ================================================================== */

test('T10 字号 12/13/14 循环：切换后 markError 行号定位仍准', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const seq = [];
  for (let i = 0; i < 4; i++) {
    const one = await page.evaluate(
      `(function(){
        var btn = document.getElementById('btnFont');
        var ed = TSJ.appStore.state.editor;
        // 造 120 行，标第 90 行错误，检查它是否被滚进可视区
        var lines = [];
        for (var i = 1; i <= 120; i++) lines.push('var line' + i + ' = ' + i + ';');
        ed.setValue(lines.join('\\n'));
        ed.markError(90);
        var m = ed.metrics();
        var ta = document.querySelector('.ed-input');
        var target = (90 - 1) * m.lineHeight + m.padTop;
        var inView = target >= ta.scrollTop && target <= ta.scrollTop + ta.clientHeight;
        var cs = getComputedStyle(ta);
        return {
          font: ed.getFontSize(), label: btn.textContent.trim(),
          lineHeight: m.lineHeight, cssLineHeight: parseFloat(cs.lineHeight),
          cssFont: parseFloat(cs.fontSize), padTop: m.padTop, cssPadTop: parseFloat(cs.paddingTop),
          inView: inView, scrollTop: Math.round(ta.scrollTop), target: Math.round(target),
          errLn: document.querySelectorAll('.ed-ln-err').length,
          stored: localStorage.getItem('tsoj:edFont')
        };
      })()`
    );
    seq.push(one);
    console.log('    字号 ' + one.font + 'px（按钮「' + one.label + '」）：行高=' + one.lineHeight +
      'px（CSS ' + one.cssLineHeight + '）· padding-top=' + one.padTop + '（CSS ' + one.cssPadTop + '）' +
      ' · 第 90 行目标 y=' + one.target + ' · scrollTop=' + one.scrollTop +
      ' · 在可视区=' + one.inView + ' · 错误行标=' + one.errLn + ' · 落盘=' + one.stored);
    assert.equal(one.lineHeight, one.cssLineHeight, '行高必须来自 getComputedStyle（不能与 CSS 双写错位）');
    assert.equal(one.padTop, one.cssPadTop, 'padding-top 必须来自 getComputedStyle');
    assert.equal(one.cssFont, one.font, '实际字号应与状态一致');
    assert.equal(one.inView, true, 'markError 应把错误行滚进可视区');
    assert.equal(one.errLn, 1, '应有一行错误标记');
    assert.equal(one.stored, String(one.font), '字号要写进 tsoj:edFont');
    await page.evaluate('document.getElementById("btnFont").click()');
    await sleep(120);
  }
  const fonts = seq.map((x) => x.font);
  console.log('    循环序列：' + fonts.join(' → '));
  assert.deepEqual(fonts, [13, 14, 12, 13], '字号应按 13→14→12 循环');

  // 刷新后字号仍然记住（4 次点击后实际停在 14px：13→14→12→13→14）
  const beforeReload = await page.evaluate('TSJ.appStore.state.edFont');
  const storedBeforeReload = await page.evaluate('localStorage.getItem("tsoj:edFont")');
  assert.equal(storedBeforeReload, String(beforeReload), '点击切换后字号必须落盘');
  await page.reload();
  await sleep(300);
  const afterReload = await page.evaluate(
    '(function(){return {font: TSJ.appStore.state.edFont, label: document.getElementById("btnFont").textContent.trim()};})()'
  );
  console.log('    刷新前字号=' + beforeReload + 'px → 刷新后：字号=' + afterReload.font +
    ' · 按钮「' + afterReload.label + '」');
  assert.equal(afterReload.font, beforeReload, '刷新后应恢复上次选的字号');
  assert.equal(afterReload.label, 'A ' + beforeReload, '按钮文案应与恢复的字号一致');
});

test('T10 括号匹配：光标处的 { 与 } 同时高亮', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const out = await page.evaluate(
    `(function(){
      var ed = TSJ.appStore.state.editor;
      var ta = document.querySelector('.ed-input');
      var code = 'function predict(h, n, c) {\\n  var a = (1 + 2);\\n  return [a];\\n}';
      ed.setValue(code);
      var pos = code.indexOf('{') + 1;      // 光标紧跟在 { 之后
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
      ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      var marks = ed.matchMarks();
      var spans = document.querySelectorAll('.ed-highlight .ed-match');
      var texts = [].map.call(spans, function(s){ return s.textContent; });
      // 再移到普通字符处，匹配应清空
      ta.selectionStart = ta.selectionEnd = code.indexOf('var');
      ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      var cleared = document.querySelectorAll('.ed-highlight .ed-match').length;
      return { marks: marks, count: spans.length, texts: texts, cleared: cleared };
    })()`
  );
  console.log('    匹配区间=' + JSON.stringify(out.marks) + ' · .ed-match 数量=' + out.count +
    ' · 内容=' + JSON.stringify(out.texts) + ' · 移开后=' + out.cleared);
  assert.equal(out.count, 2, '开括号与闭括号应同时高亮（2 个 .ed-match）');
  assert.deepEqual(out.texts, ['{', '}'], '高亮的应是这一对花括号');
  assert.equal(out.cleared, 0, '光标离开后应清除匹配高亮');
});

test('T10 2000 行降级：单次按键处理 <50ms，且关闭实时高亮', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const out = await page.evaluate(
    `(function(){
      var ed = TSJ.appStore.state.editor;
      var ta = document.querySelector('.ed-input');
      var lines = [];
      for (var i = 0; i < 2000; i++) lines.push('var value' + i + ' = ' + i + ' * 2; // 行 ' + i);
      ed.setValue(lines.join('\\n'));
      // 让 rAF 把这次全量绘制跑完
      var t0 = performance.now();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise(function(resolve){
        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            var firstMs = performance.now() - t0;
            var samples = [];
            for (var k = 0; k < 6; k++) {
              ta.value += 'x';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              // 强制同步跑一次 rAF 回调：用 setTimeout(0) 无法保证，这里直接读 perf
              samples.push(k);
            }
            // 逐个等待 rAF 完成，记录每次绘制的耗时
            var measured = [];
            var idx = 0;
            function step(){
              if (idx >= 6) {
                resolve({
                  firstMs: firstMs,
                  degraded: ed.isDegraded(),
                  lines: ed.perf.lastLines,
                  paintMs: ed.perf.lastPaintMs,
                  measured: measured,
                  tokSpans: document.querySelectorAll('.ed-highlight .tok-kw').length,
                  gutterNodes: document.querySelectorAll('.ed-ln').length,
                  textLen: ta.value.length
                });
                return;
              }
              ta.value += 'y';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              requestAnimationFrame(function(){
                measured.push(ed.perf.lastPaintMs);
                idx++;
                step();
              });
            }
            step();
          });
        });
      });
    })()`,
    true
  );
  const worst = Math.max.apply(null, out.measured.concat([out.paintMs]));
  console.log('    2000 行：降级=' + out.degraded + ' · 行号节点=' + out.gutterNodes +
    ' · 高亮 token span=' + out.tokSpans + ' · 文本长度=' + out.textLen);
  console.log('    首次全量绘制=' + out.firstMs.toFixed(1) + 'ms · 单键绘制样本(ms)=' +
    out.measured.map((v) => v.toFixed(2)).join(', ') + ' · 最差=' + worst.toFixed(2) + 'ms');
  assert.equal(out.degraded, true, '2000 行应进入降级模式');
  assert.equal(out.tokSpans, 0, '降级模式下不应再生成高亮 token');
  assert.equal(out.gutterNodes, 2000, '行号栏仍应完整（2000 行）');
  assert.ok(worst < 50, '单次按键绘制应 <50ms，实际最差 ' + worst.toFixed(2) + 'ms');
});

test('T10 Ctrl+S 存草稿且不弹浏览器保存框', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const out = await page.evaluate(
    `(function(){
      var ta = document.querySelector('.ed-input');
      ta.focus();
      ta.value = 'function predict(h, n, c) { return new Array(n).fill(42); }';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      var ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
      var dispatched = ta.dispatchEvent(ev);
      var drafts = JSON.parse(localStorage.getItem('tsoj:drafts') || '{}');
      var toast = document.getElementById('toast');
      return {
        prevented: ev.defaultPrevented,
        drafts: drafts[${JSON.stringify(P1)}] || null,
        toast: toast.textContent,
        toastShown: /toast-show/.test(toast.className)
      };
    })()`
  );
  console.log('    defaultPrevented=' + out.prevented + ' · 草稿长度=' +
    (out.drafts ? out.drafts.length : 'null') + ' · 提示=' + JSON.stringify(out.toast));
  assert.equal(out.prevented, true, 'Ctrl+S 必须 preventDefault（否则会弹浏览器保存框）');
  assert.ok(out.drafts && out.drafts.indexOf('fill(42)') >= 0, 'tsoj:drafts 必须已更新');
  assert.match(out.toast, /草稿已保存/);
  assert.equal(out.toastShown, true, '应给出轻提示');
});

/* ================================================================== *
 * T11 可访问性
 * ================================================================== */

test('T11 弹层：焦点陷阱 / ESC 关闭 / 关闭后焦点回 #view', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/submissions');
  await sleep(250);

  const opened = await page.evaluate(
    `(function(){
      document.getElementById('btnClear').click();
      var ov = document.getElementById('overlay');
      var view = document.getElementById('view');
      var list = [].filter.call(ov.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        function(el){ return el.getClientRects().length > 0; });
      return {
        open: !ov.classList.contains('hidden'),
        role: ov.getAttribute('role'),
        modal: ov.getAttribute('aria-modal'),
        inert: view.hasAttribute('inert') || view.inert === true,
        ariaHidden: view.getAttribute('aria-hidden'),
        focusables: list.length,
        activeId: document.activeElement ? document.activeElement.id : null
      };
    })()`
  );
  console.log('    打开确认弹层：open=' + opened.open + ' · role=' + opened.role + ' · aria-modal=' + opened.modal +
    ' · #view inert=' + opened.inert + ' · 可聚焦元素=' + opened.focusables + ' · 初始焦点=' + opened.activeId);
  assert.equal(opened.open, true);
  assert.equal(opened.role, 'dialog');
  assert.equal(opened.modal, 'true');
  assert.equal(opened.inert, true, '弹层打开时其余内容应 inert');
  assert.equal(opened.ariaHidden, 'true', '同时给出 aria-hidden 兜底');
  assert.ok(opened.focusables >= 2, '弹层内应有多个可聚焦元素');
  assert.equal(opened.activeId, 'clearCancel', '初始焦点应落在弹层内第一个按钮');

  // Tab 从最后一个 → 回到第一个
  const trap = await page.evaluate(
    `(function(){
      var ov = document.getElementById('overlay');
      var list = [].filter.call(ov.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        function(el){ return el.getClientRects().length > 0; });
      var first = list[0];
      var last = list[list.length - 1];
      last.focus();
      var ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return { first: first.id, last: last.id, after: document.activeElement.id, prevented: ev.defaultPrevented };
    })()`
  );
  console.log('    焦点陷阱：最后一个(' + trap.last + ') Tab → ' + trap.after + '（第一个是 ' + trap.first + '）');
  assert.equal(trap.after, trap.first, 'Tab 应从最后一个回到第一个（焦点锁在弹层内）');

  // ESC 关闭 → 焦点回 #view
  const closed = await page.evaluate(
    `(function(){
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      var ov = document.getElementById('overlay');
      var view = document.getElementById('view');
      return {
        hidden: ov.classList.contains('hidden'),
        inert: view.hasAttribute('inert') || view.inert === true,
        activeId: document.activeElement ? document.activeElement.id : null,
        empty: ov.innerHTML.length === 0,
        liveCount: document.querySelectorAll('[aria-live]').length,
        tabindex: view.getAttribute('tabindex')
      };
    })()`
  );
  console.log('    ESC 关闭：hidden=' + closed.hidden + ' · #view inert=' + closed.inert +
    ' · activeElement=#' + closed.activeId + ' · 弹层已清空=' + closed.empty +
    ' · aria-live 元素=' + closed.liveCount);
  assert.equal(closed.hidden, true, 'ESC 应关闭弹层');
  assert.equal(closed.inert, false, '关闭后必须解除 inert');
  assert.equal(closed.activeId, 'view', '关闭后焦点应回到 #view');
  assert.equal(closed.tabindex, '-1');
  assert.ok(closed.liveCount >= 1, '页面必须存在 aria-live 区域');
});

test('T11 判题结果面板 aria-live、编辑器 aria-describedby、路由切换更新标题并聚焦 #view', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const a = await page.evaluate(
    `(function(){
      var panel = document.getElementById('resultPanel');
      var ta = document.querySelector('.ed-input');
      var help = document.getElementById(ta.getAttribute('aria-describedby') || '');
      var ed = TSJ.appStore.state.editor;
      ed.markError(7);
      var invalid = ta.getAttribute('aria-invalid');
      var helpText = help ? help.textContent : '';
      ed.clearError();
      return {
        live: panel ? panel.getAttribute('aria-live') : null,
        describedby: ta.getAttribute('aria-describedby'),
        helpExists: !!help,
        helpText: helpText,
        invalid: invalid,
        afterClearInvalid: ta.getAttribute('aria-invalid'),
        title: document.title,
        activeId: document.activeElement ? document.activeElement.id : null
      };
    })()`
  );
  console.log('    resultPanel aria-live=' + a.live + ' · textarea aria-describedby=' + a.describedby +
    '（存在=' + a.helpExists + '）· markError 后 aria-invalid=' + a.invalid +
    ' · 说明=' + JSON.stringify(a.helpText));
  console.log('    题目页标题=' + JSON.stringify(a.title) + ' · 路由切换后 activeElement=#' + a.activeId);
  assert.equal(a.live, 'polite', '结果面板必须 aria-live="polite"');
  assert.equal(a.describedby, 'edErrorHelp', '编辑器必须 aria-describedby 指向错误说明');
  assert.equal(a.helpExists, true);
  assert.match(a.helpText, /第 7 行/, '错误说明要写明行号');
  assert.equal(a.invalid, 'true', '错误行应给出 aria-invalid 语义');
  assert.equal(a.afterClearInvalid, null, '清除错误后应移除 aria-invalid');
  assert.match(a.title, /Holt|朴素|·/, '标题应包含题目名');
  assert.match(a.title, /· 时序竞技场 TSOJ$/);
  assert.equal(a.activeId, 'view', '路由切换后焦点应落在 #view');
});

/* ================================================================== *
 * 回归：判题落盘后，题头进度徽标必须同步（不刷新页面）
 * ================================================================== */

test('判题落盘后题头「尚未提交」应立即变成「历史最高 N 分」', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  await sleep(300);

  const before = await page.evaluate(
    '(document.querySelector("[data-best-badge]")||{}).textContent');
  assert.match(String(before), /尚未提交/, '初始态应为「尚未提交」，实际：' + before);

  await page.evaluate('document.getElementById("btnSubmit").click()');
  const done = await waitFor('document.querySelector(".verdict")', 15000);
  assert.ok(done, '判题应在 15s 内出结果');

  const after = await page.evaluate(
    `(function(){
      var el = document.querySelector('[data-best-badge]');
      var chip = document.getElementById('ptsText');
      var sub = JSON.parse(localStorage.getItem('tsoj:submissions')||'[]')[0]||{};
      return { badge: el ? el.textContent : null, chip: chip ? chip.textContent : null,
               score: sub.score, passed: sub.passed };
    })()`);
  console.log('    提交后：题头「' + after.badge + '」· 等级分「' + after.chip + '」· 本次 ' + after.score + ' 分');

  assert.doesNotMatch(String(after.badge), /尚未提交/, '提交后不得再显示「尚未提交」');
  assert.match(String(after.badge), new RegExp('历史最高 ' + after.score + ' 分'),
    '题头应显示本次得分，实际：' + after.badge);
  assert.match(String(after.chip), new RegExp(after.score + ' 分'), '右上角等级分应同步');
});
