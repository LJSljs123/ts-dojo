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

/** P17 的事件标记契约：数据集 promoDays 的长度就是图上应有的标记数。 */
const P17 = (() => {
  const e = loadEngine({ fresh: true });
  const p = e.problems.find((x) => x.id === 'p17-promo-covariate');
  const ds = e.datasets.find((d) => d.id === p.dataset);
  return { id: p.id, horizon: p.horizon, promos: ds.promoDays.length, label: p.markerLabel };
})();

/** P18 的分量契约：parts 长度、各自周期、序列长度（分量图必须与数据一一对应）。 */
const P18 = (() => {
  const e = loadEngine({ fresh: true });
  const p = e.problems.find((x) => x.id === 'p18-channel-mix');
  const ds = e.datasets.find((d) => d.id === p.dataset);
  return {
    id: p.id,
    len: ds.values.length,
    horizon: p.horizon,
    parts: ds.parts.length,
    periods: ds.parts.map((x) => x.period)
  };
})();

/**
 * 内容层契约：课程数 + P18 的相关链接来源。
 *
 * 必须一次加载算完：loadEngine({fresh:true}) 只清 datasets/problems/judge 的缓存，
 * methods.js / courses.js 仍是缓存命中——再调一次 fresh 会把 global.TSJ 删掉，
 * 而缓存的模块不会重新挂载，TSJ.methods 就变成 undefined。
 */
const CONTENT = (() => {
  global.window = global;
  loadEngine({ fresh: true });
  require('../../assets/js/methods.js');
  require('../../assets/js/content/courses.js');
  const pid = 'p18-channel-mix';
  const methods = (TSJ.methods || []).filter((m) => m.practice === pid);
  const courses = (TSJ.courses || []).filter(
    (c) => ((c.exercise && c.exercise.problemIds) || []).indexOf(pid) >= 0
  );
  return {
    courseCount: (TSJ.courses || []).length,
    // 反向样本：P18 没有课程，课程链接那一支得另找一道挂了课的题来验
    courseProblem: (() => {
      for (const c of TSJ.courses || []) {
        const ids = (c.exercise && c.exercise.problemIds) || [];
        if (ids.length) return { pid: ids[0], courseId: c.id };
      }
      return null;
    })(),
    rel: {
      pid,
      methods: methods.map((m) => m.id),
      methodName: methods.length ? methods[0].name : '',
      courses: courses.map((c) => c.id)
    }
  };
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
  assert.equal(cards, CONTENT.courseCount, '课程地图模块数与内容层不一致');
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

/* ================================================================== *
 * 事件标记：P17 的促销日必须画进图里（且跑完预测后不消失）
 * ================================================================== */

test('P17 数据预览：促销日画成标记点，图例与标题同步说明', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/' + P17.id);

  const raw = await page.evaluate(`(function(){
    var c = document.querySelector('#view #seriesChart');
    var chart = c.__tsjChart || {};
    var g = c.__tsjGeom || {};
    var marks = (chart.markers && chart.markers.indices) || [];
    var legend = document.querySelector('#view .chart-legend');
    var title = document.querySelector('#view .chart-title');
    return JSON.stringify({
      label: chart.markers && chart.markers.label,
      markCount: marks.length,
      geomCount: g.markers ? Object.keys(g.markers).length : 0,
      inRange: marks.every(function (i) { return i >= 0 && i < g.n; }),
      legend: legend ? legend.innerText : '',
      title: title ? title.innerText : ''
    });
  })()`);
  const r = JSON.parse(raw);
  console.log('    标记 ' + r.markCount + ' 个 · geom ' + r.geomCount + ' 个 · 图例「' + r.legend.replace(/\s+/g, ' ') + '」');
  console.log('    标题「' + r.title.replace(/\s+/g, ' ') + '」');

  assert.equal(r.markCount, P17.promos, '图上标记数应等于数据集 promoDays 长度');
  assert.equal(r.geomCount, P17.promos, 'geom.markers 应覆盖全部促销日（hover 反查依赖它）');
  assert.ok(r.inRange, '标记下标越界（会被静默跳过，图上少点）');
  assert.equal(r.label, P17.label, '标记图例文案应取题目的 markerLabel');
  assert.match(r.legend, /促销日/, '图例里必须解释黄点是什么');
  assert.match(r.title, new RegExp('促销日 ' + P17.promos + ' 天'), '标题应给出促销日天数');
});

test('P17 跑完预测后重绘：标记点仍在，预测线也画上了', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/' + P17.id);

  // 模板能跑完（返回长度 14 的数组），跑完会重绘整张图 —— 这里正是标记最容易丢的地方
  await page.evaluate('document.querySelector("#view #btnRun").click()');
  const painted = await (async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const ok = await page.evaluate(
        '(function(){var c=document.querySelector("#view #seriesChart");var g=c&&c.__tsjGeom;return !!(g&&g.predictions&&g.predictions.length);})()'
      );
      if (ok) return true;
      await sleep(120);
    }
    return false;
  })();
  assert.ok(painted, '运行后预测线没有画出来（paintPrediction 未生效）');

  const raw = await page.evaluate(`(function(){
    var c = document.querySelector('#view #seriesChart');
    var chart = c.__tsjChart || {};
    var g = c.__tsjGeom || {};
    return JSON.stringify({
      markCount: ((chart.markers && chart.markers.indices) || []).length,
      geomCount: g.markers ? Object.keys(g.markers).length : 0,
      preds: g.predictions ? g.predictions.length : 0,
      legend: (document.querySelector('#view .chart-legend') || {}).innerText || ''
    });
  })()`);
  const r = JSON.parse(raw);
  assert.equal(r.markCount, P17.promos, '重绘后标记点丢了（chartOpts 没被 paintPrediction 复用）');
  assert.equal(r.geomCount, P17.promos, '重绘后 hover 用的标记索引丢了');
  assert.equal(r.preds, P17.horizon, '预测点数应等于 horizon');
  assert.match(r.legend, /促销日/, '重绘后图例里的促销日说明丢了');
});

test('P17 hover 到促销日：tooltip 首行标出「促销日」', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/' + P17.id);

  const raw = await page.evaluate(`(function(){
    var c = document.querySelector('#view #seriesChart');
    var g = c.__tsjGeom;
    var handle = TSJ.appStore.state.chartHover;
    if (!g || !handle) return JSON.stringify({ err: '缺少几何信息或 hover 句柄' });
    var idx = (c.__tsjChart.markers.indices || [])[10];   // 任取一个促销日
    var rect = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + g.xOf(idx), clientY: rect.top + g.yOf(g.values[idx]),
      bubbles: true, pointerId: 1
    }));
    var tip = handle.tip();
    var plain = idx + 1;
    while (c.__tsjChart.markers.indices.indexOf(plain) >= 0) plain++;
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + g.xOf(plain), clientY: rect.top + g.yOf(g.values[plain]),
      bubbles: true, pointerId: 1
    }));
    var tipPlain = handle.tip();
    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));
    return JSON.stringify({
      idx: idx, marked: tip && tip.lines, plain: tipPlain && tipPlain.lines
    });
  })()`);
  const r = JSON.parse(raw);
  assert.ok(!r.err, r.err);
  console.log('    促销日 tooltip：' + JSON.stringify(r.marked));
  console.log('    普通日 tooltip：' + JSON.stringify(r.plain));
  assert.match(r.marked[0], /促销日/, '促销日的 tooltip 首行应标出「促销日」');
  assert.doesNotMatch(r.plain[0], /促销日/, '非促销日不应被标成促销日');
});

/* ================================================================== *
 * 分量预览：P18 的「总量 = 两个渠道之和」必须能在页面上拆开看
 * ================================================================== */

test('P18 数据预览：两路分量各画一张小图，周期标注与数据一致', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/' + P18.id);

  const raw = await page.evaluate(`(function(){
    var strip = document.querySelector('#view .parts-strip');
    var canvases = strip ? strip.querySelectorAll('.part-chart') : [];
    var parts = [];
    for (var i = 0; i < canvases.length; i++) {
      var g = canvases[i].__tsjGeom || {};
      var nameEl = canvases[i].parentNode.querySelector('.part-name');
      parts.push({
        name: nameEl ? nameEl.innerText : '',
        n: g.n || 0,
        testStart: g.testStart,
        painted: canvases[i].getAttribute('data-tsj-chart') === '1'
      });
    }
    var card = document.querySelector('#view .chart-card');
    var main = (document.querySelector('#view #seriesChart') || {}).__tsjGeom || {};
    return JSON.stringify({
      count: canvases.length,
      parts: parts,
      mainN: main.n || 0,
      scrollW: card ? card.scrollWidth : 0,
      clientW: card ? card.clientWidth : 0
    });
  })()`);
  const r = JSON.parse(raw);
  console.log('    分量图 ' + r.count + ' 张：' +
    r.parts.map((p) => p.name + '(n=' + p.n + ')').join(' · '));

  assert.equal(r.count, P18.parts, '分量小图数量应等于数据集 parts 长度');
  for (let i = 0; i < r.parts.length; i++) {
    const p = r.parts[i];
    assert.ok(p.painted, '第 ' + (i + 1) + ' 张分量图没有画（drawParts 未生效）');
    // 窗口上限是设计约束：730 点挤进 300px 会把周节律糊成一条实心带，「拆开看」就没意义了
    assert.ok(p.n > 0 && p.n <= 200, '第 ' + (i + 1) + ' 张分量图窗口过大（n=' + p.n + '），节律会被压平');
    assert.ok(p.n >= 60, '第 ' + (i + 1) + ' 张分量图窗口过小（n=' + p.n + '），看不到完整周期');
    assert.equal(p.testStart + P18.horizon, p.n, '测试区间高亮带应贴在分量图右端');
    assert.match(p.name, new RegExp('周期 ' + P18.periods[i]),
      '第 ' + (i + 1) + ' 张分量图的标题应标出它自己的周期');
  }
  assert.equal(r.mainN, P18.len, '总量图的点数不应被分量图影响');
  assert.ok(r.scrollW <= r.clientW + 1,
    '分量图撑破了图表卡片（' + r.scrollW + ' > ' + r.clientW + '）');
});

test('题目页「继续深入」：回到方法卡与课程（方法库能跳题目，这里要有回程路）', async (t) => {
  if (!page) return t.skip('无浏览器');
  assert.ok(CONTENT.rel.methods.length, 'p18 没有关联方法卡，这条用例就失去意义');

  await goto('#/problem/' + CONTENT.rel.pid);
  const raw = await page.evaluate(`(function(){
    var box = document.querySelector('#view .rel-box');
    var chips = box ? box.querySelectorAll('.rel-chip') : [];
    var out = [];
    for (var i = 0; i < chips.length; i++) {
      out.push({ text: chips[i].textContent, href: chips[i].getAttribute('href') });
    }
    var label = box ? box.querySelector('.rel-label') : null;
    return JSON.stringify({ has: !!box, label: label ? label.textContent : '', chips: out });
  })()`);
  const r = JSON.parse(raw);
  console.log('    继续深入：' + r.chips.map((c) => c.text + ' → ' + c.href).join(' · '));

  assert.ok(r.has, '题目页缺少「继续深入」区块');
  assert.equal(r.label, '继续深入');
  const hrefs = r.chips.map((c) => c.href);
  for (const id of CONTENT.rel.methods) {
    assert.ok(hrefs.indexOf('#/methods/' + id) >= 0, '缺少方法卡链接：' + id);
  }
  for (const id of CONTENT.rel.courses) {
    assert.ok(hrefs.indexOf('#/learn/' + id) >= 0, '缺少课程链接：' + id);
  }

  // 点一下：必须真的走 hash 路由并渲染出方法详情，而不是只改地址栏
  await page.evaluate('document.querySelector("#view .rel-box .rel-chip").click()');
  await sleep(500);
  const after = await page.evaluate('(function(){return {hash: location.hash, text: document.querySelector("#view").innerText || ""};})()');
  assert.equal(after.hash, '#/methods/' + CONTENT.rel.methods[0], '点击后 hash 应指向方法卡');
  assert.ok(after.text.indexOf(CONTENT.rel.methodName) >= 0, '跳转后没有渲染出方法详情：' + CONTENT.rel.methodName);
});

test('题目页「继续深入」：挂了课程的题要给出课程链接', async (t) => {
  if (!page) return t.skip('无浏览器');
  const sample = CONTENT.courseProblem;
  assert.ok(sample, '没有任何课程挂题目，课程链接这一支无从验证');

  await goto('#/problem/' + sample.pid);
  const hrefs = await page.evaluate(
    '[].map.call(document.querySelectorAll("#view .rel-box .rel-chip"), function(a){return a.getAttribute("href");})'
  );
  console.log('    ' + sample.pid + ' 的相关链接：' + JSON.stringify(hrefs));
  assert.ok(hrefs.indexOf('#/learn/' + sample.courseId) >= 0,
    '缺少课程链接 #/learn/' + sample.courseId + '（实际 ' + JSON.stringify(hrefs) + '）');
  assert.ok(
    await page.evaluate('!!document.querySelector("#view .rel-box .rel-chip-course")'),
    '课程 chip 应有独立的样式类（与纯文字方法 chip 区分）'
  );

  // m0 的标题很长（「零基础第一课：从看懂一条曲线到写出第一个 predict」），窄屏最容易被撑破
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 1, mobile: true
  });
  try {
    const narrow = await page.evaluate(
      `(function(){
        var box = document.querySelector('#view .rel-box');
        var chips = box.querySelectorAll('.rel-chip');
        var maxRight = 0;
        for (var i = 0; i < chips.length; i++) {
          var r = chips[i].getBoundingClientRect();
          if (r.right > maxRight) maxRight = r.right;
        }
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          maxRight: Math.round(maxRight),
          boxRight: Math.round(box.getBoundingClientRect().right)
        };
      })()`
    );
    console.log('    375px 相关链接：scrollWidth=' + narrow.scroll + ' · chip 最右 ' + narrow.maxRight);
    assert.equal(narrow.scroll, narrow.client, '375px 下页面出现横向滚动（相关链接撑破）');
    assert.ok(narrow.maxRight <= narrow.boxRight + 1,
      'chip 溢出了容器：' + narrow.maxRight + ' > ' + narrow.boxRight);
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
});
