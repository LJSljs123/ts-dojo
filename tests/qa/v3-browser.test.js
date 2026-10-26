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
  for (const hash of ['#/', '#/problems', '#/methods', '#/learn', '#/learn/m1', '#/lab', '#/methods/dlinear', '#/glossary']) {
    const r = await goto(hash);
    assert.ok(r.html > 500, hash + ' 渲染内容过少（' + r.html + ' 字节）');
    assert.ok(r.text.length > 0, hash + ' 文本为空');
  }
  assert.deepEqual(page.exceptions, [], '新路由出现未捕获异常：' + JSON.stringify(page.exceptions));
});

test('术语表：默认全量、搜索与分类筛选取交集、站内跳转可用', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/glossary');
  const base = await page.evaluate('document.querySelectorAll(".gcard").length');
  assert.ok(base >= 50, '术语表默认应至少 50 张卡，实际 ' + base);

  // 搜索「季节」应命中多个术语
  await page.evaluate(
    '(function(){var el=document.getElementById("glossarySearch");el.value="季节";' +
    'el.dispatchEvent(new Event("input",{bubbles:true}));})()'
  );
  await sleep(300);
  const searched = await page.evaluate('document.querySelectorAll(".gcard").length');
  assert.ok(searched >= 1 && searched < base, '搜索「季节」应缩小结果：' + searched + '/' + base);

  // 分类筛选 chips 数量现算
  const chips = await page.evaluate(
    '[].map.call(document.querySelectorAll(".chip[data-cat]"), function(c){return c.textContent;})'
  );
  assert.ok(chips[0].indexOf('全部(' + base + ')') === 0, '全部 chip 应现算总数：' + chips.join(','));

  // 清除筛选回全量
  await page.evaluate('document.getElementById("btnGlossaryClear").click()');
  await sleep(300);
  assert.equal(await page.evaluate('document.querySelectorAll(".gcard").length'), base, '清除筛选未回到全量');
  assert.deepEqual(page.exceptions, [], '术语表页出现未捕获异常：' + JSON.stringify(page.exceptions));
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

test('实验室：切换方法不再把整个表单重置回默认（v3.2 P1 回归）', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/lab');
  // 把数据集先改成非默认（electricity），再切换方法到 SES —— 两项选择都必须保留
  await page.evaluate(
    '(function(){' +
    'var ds=document.getElementById("labDataset");ds.value="electricity";' +
    'ds.dispatchEvent(new Event("change",{bubbles:true}));' +
    'var m=document.getElementById("labMethod");m.value="ses";' +
    'm.dispatchEvent(new Event("change",{bubbles:true}));' +
    '})()'
  );
  await sleep(500);
  const state = await page.evaluate(`JSON.stringify({
    method: document.getElementById('labMethod').value,
    dataset: document.getElementById('labDataset').value,
    params: [].map.call(document.querySelectorAll('#labParams input'), function(i){return i.id + '=' + i.value;})
  })`);
  const s = JSON.parse(state);
  assert.equal(s.method, 'ses', '方法选择被重置回默认（旧 P1 bug）：' + state);
  assert.equal(s.dataset, 'electricity', '数据集选择被重置回默认（旧 P1 bug）：' + state);
  assert.deepEqual(s.params, ['param-alpha=0.28'], 'SES 的参数块应重绘为单参数默认值：' + state);
  assert.deepEqual(page.exceptions, [], '切换方法过程出现异常：' + JSON.stringify(page.exceptions));
});

test('实验室实时滑杆：拖动即重算，同步数字输入框，不写记录', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/lab');
  // 切到 SES（单参数，实时重算最快）
  await page.evaluate(
    '(function(){var m=document.getElementById("labMethod");m.value="ses";' +
    'm.dispatchEvent(new Event("change",{bubbles:true}));})()'
  );
  await sleep(300);
  await page.evaluate('document.getElementById("labRun").click()');
  const done = await (async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const s = await page.evaluate('(document.getElementById("labStatus")||{}).textContent');
      if (s && s.indexOf('完成') === 0) return s;
      await sleep(120);
    }
    return null;
  })();
  assert.ok(done, '正式运行未在 15s 内完成');
  const before = await page.evaluate(
    'document.querySelector("#labMetricsZone .ds-table tbody td.num").textContent'
  );
  // 拖滑杆到 0.6（默认 0.28）→ 触发实时重算
  await page.evaluate(
    '(function(){var s=document.getElementById("live-alpha");s.value="0.6";' +
    's.dispatchEvent(new Event("input",{bubbles:true}));})()'
  );
  await sleep(600);
  const after = await page.evaluate(
    'document.querySelector("#labMetricsZone .ds-table tbody td.num").textContent'
  );
  assert.notEqual(before, after, '拖动滑杆后指标未变化（实时重算未生效）');
  const status = await page.evaluate('(document.getElementById("labStatus")||{}).textContent');
  assert.match(status, /实时预览/, '状态应显示实时预览：' + status);
  // 数字输入框同步（保证「所见 = 所保存」）
  const synced = await page.evaluate('document.getElementById("param-alpha").value');
  assert.equal(Number(synced), 0.6, '滑杆值未同步到配置面板数字输入框');
  const records = await page.evaluate('TSJ.appLabStorage.list().length');
  const recsAfter = await page.evaluate(
    '(function(){var s=document.getElementById("labRun");return TSJ.appLabStorage.list().length;})()'
  );
  assert.equal(records, recsAfter, '实时预览不应写实验记录');
  assert.deepEqual(page.exceptions, [], '实时滑杆出现异常：' + JSON.stringify(page.exceptions));
});

test('命令面板 Ctrl+K：搜索、键盘导航、跳转', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/');
  await page.evaluate(
    'document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}))'
  );
  await sleep(300);
  const openState = await page.evaluate(
    '[!!document.getElementById("cmdkInput"), document.querySelectorAll("#cmdkResults .cmdk-item").length]'
  );
  assert.equal(openState[0], true, 'Ctrl+K 未打开命令面板');
  assert.ok(openState[1] >= 3, '空态结果过少：' + openState[1]);
  // 输入 holt → 应命中方法与题目
  await page.evaluate(
    '(function(){var i=document.getElementById("cmdkInput");i.value="holt";' +
    'i.dispatchEvent(new Event("input",{bubbles:true}));})()'
  );
  await sleep(250);
  const found = await page.evaluate(
    '[].map.call(document.querySelectorAll("#cmdkResults .cmdk-label"), function(b){return b.textContent;})'
  );
  assert.ok(found.some((s) => /Holt|holt/.test(s)), '搜索 holt 应命中 Holt 相关条目：' + JSON.stringify(found.slice(0, 5)));
  // 键盘 Enter 跳转到第一个结果
  await page.evaluate(
    'document.getElementById("cmdkInput").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))'
  );
  await sleep(450);
  const hash = await page.evaluate('location.hash');
  assert.ok(/#\/(methods|problem)\//.test(hash), 'Enter 未跳转：' + hash);
  const closed = await page.evaluate('!document.getElementById("cmdkInput")');
  assert.equal(closed, true, '跳转后面板未关闭');
  // 再按 Ctrl+K 可再次打开（关闭状态可复开）
  await page.evaluate(
    'document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}))'
  );
  await sleep(250);
  assert.equal(await page.evaluate('!!document.getElementById("cmdkInput")'), true, '面板无法再次打开');
  await page.evaluate(
    'document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}))'
  );
  await sleep(250);
  assert.equal(await page.evaluate('!document.getElementById("cmdkInput")'), true, 'Ctrl+K 切换关闭失败');
  assert.deepEqual(page.exceptions, [], '命令面板出现异常：' + JSON.stringify(page.exceptions));
});

test('模型工坊：两阶段实验流程端到端（验证集 → 最终评测 → 记录留档）', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/studio');
  assert.ok(await page.evaluate('!!document.getElementById("studioEditorHost")'), '工坊页未渲染');
  const splits = await page.evaluate('document.getElementById("studioSplits").textContent');
  assert.ok(/train \d+/.test(splits) && /val \d+/.test(splits) && /test \d+/.test(splits), '拆分协议未显示：' + splits);

  // ① 验证集评估（示例模板 = SES + 网格搜索，可跑完）
  await page.evaluate('document.getElementById("studioRunVal").click()');
  const valOk = await (async () => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const badge = await page.evaluate('(document.querySelector("#studioReport .ds-badge")||{}).textContent');
      if (badge && badge.indexOf('验证集评估') >= 0) return true;
      await sleep(150);
    }
    return false;
  })();
  assert.ok(valOk, '验证集评估未完成');
  const valMse = await page.evaluate('(document.querySelector("#studioReport tbody td.num")||{}).textContent');
  assert.ok(/^\d/.test(valMse), 'val MSE 未渲染：' + valMse);
  const canvasOk = await page.evaluate('!!(document.getElementById("studioCanvas")||{}).__tsjGeom');
  assert.ok(canvasOk, '预测对比图未绘制');

  // ② 最终评测（train+val 拟合 → test 打分），记录留档
  await page.evaluate('document.getElementById("studioRunFinal").click()');
  const finalOk = await (async () => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const badge = await page.evaluate('(document.querySelector("#studioReport .ds-badge")||{}).textContent');
      if (badge && badge.indexOf('最终评测') >= 0) return true;
      await sleep(150);
    }
    return false;
  })();
  assert.ok(finalOk, '最终评测未完成');
  const recCount = await page.evaluate('TSJ.appStudioStorage.list().length');
  assert.ok(recCount >= 2, '实验记录未留档：' + recCount);
  const hasFinal = await page.evaluate(
    'TSJ.appStudioStorage.list().some(function(r){return r.kind==="final" && r.testMetrics && isFinite(r.testMetrics.mse);})'
  );
  assert.ok(hasFinal, '最终记录缺少 test MSE');
  assert.deepEqual(page.exceptions, [], '模型工坊出现异常：' + JSON.stringify(page.exceptions));
});

test('模型工坊：分享卡自包含、字段齐全、数据集名被转义', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/studio');
  const raw = await page.evaluate(`(function(){
    var rec = {
      kind: 'final', datasetId: 'airline', codeHash: 'abc123def',
      split: [100, 20, 20], testMetrics: { mse: 1.23 }, valMetrics: { mse: 1.5 },
      testRuns: 1, at: 1761400000000
    };
    var d = TSJ.findDataset('airline');
    var html = TSJ.appStudioReport.buildShareCard({ rec: rec, d: d });
    var evil = { id: 'x', name: '<img src=x onerror=alert(1)>', unit: '', freq: 'D', season: 7, values: [1, 2, 3] };
    var html2 = TSJ.appStudioReport.buildShareCard({ rec: rec, d: evil });
    return JSON.stringify({
      doctype: html.indexOf('<!DOCTYPE html>') === 0,
      title: html.indexOf('TSOJ 模型工坊实验卡') >= 0,
      hash: html.indexOf('abc123def') >= 0,
      mse: html.indexOf('MSE') >= 0,
      runs: html.indexOf('test 评测次数') >= 0,
      split: html.indexOf('train 100') >= 0,
      escaped: html2.indexOf('<img src=x') < 0 && html2.indexOf('&lt;img') >= 0
    });
  })()`);
  const m = JSON.parse(raw);
  assert.ok(m.doctype, '分享卡必须是完整 HTML 文档');
  assert.ok(m.title && m.hash && m.mse && m.runs && m.split, '分享卡字段缺失：' + raw);
  assert.ok(m.escaped, '分享卡未转义数据集名：' + raw);
});
