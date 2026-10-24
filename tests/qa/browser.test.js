/**
 * browser.test.js —— 真实浏览器冒烟（无头 Edge/Chrome + CDP）
 *
 * 验证 Node 测不到的东西：
 *   - file:// 双击场景下页面是否有未捕获异常、5 个路由能否渲染；
 *   - Worker 沙箱在 file:// 下能否**真实**判题（degraded 必须为 false，不能降级到同线程）；
 *   - 真实 TLE（死循环）是否会终止 Worker 且页面仍可交互；
 *   - 用户提交内容（报错信息、返回值）是否会触发 XSS；
 *   - localStorage 脏数据是否会让页面崩溃。
 *
 * 找不到浏览器时整体 skip（报告中明确写「未验证」）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT } = require('./helpers/engine');
const { launch, findBrowser } = require('./helpers/cdp');

const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const HAS_BROWSER = !!findBrowser();

let page = null;

test.before(async () => {
  if (!HAS_BROWSER) return;
  page = await launch(INDEX_URL, { timeout: 20000 });
});

test.after(() => {
  if (page) page.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待页面内的条件成立 */
async function waitFor(expr, timeout) {
  const end = Date.now() + (timeout || 8000);
  while (Date.now() < end) {
    const v = await page.evaluate('!!(' + expr + ')');
    if (v) return true;
    await sleep(120);
  }
  return false;
}

/** 切路由并返回 #view 的渲染结果 */
async function goto(hash) {
  await page.evaluate('location.hash = ' + JSON.stringify(hash));
  await sleep(260);
  return page.evaluate(
    '(function(){var v=document.querySelector("#view");return {html:v.innerHTML.length, text:(v.innerText||"").slice(0,60)};})()'
  );
}

test('浏览器可用性检查（无浏览器则跳过）', (t) => {
  if (!HAS_BROWSER) {
    t.skip('本机未找到 Edge/Chrome，浏览器冒烟未验证');
    return;
  }
  assert.ok(page, 'CDP 连接失败');
});

test('file:// 首屏：无未捕获异常，题库页渲染出 9 道题', async (t) => {
  if (!page) return t.skip('无浏览器');
  // 不再需要 sleep(400)：cdp.launch() 内置 waitReady()，拿到 page 时 TSJ.findProblem 已可调用
  const info = await page.evaluate(
    '(function(){return {title:document.title, rows:document.querySelectorAll(".prow").length, view:document.querySelector("#view").innerHTML.length, onboarded: !!document.querySelector(".modal")};})()'
  );
  assert.equal(info.rows, 9, '题库应有 9 行，实际 ' + info.rows);
  assert.ok(info.view > 500, '#view 内容过少，疑似渲染失败');
  assert.deepEqual(page.exceptions, [], '首屏出现未捕获异常：' + JSON.stringify(page.exceptions));
});

test('5 个路由都能渲染出内容（problems / submissions / ranking / path / problem）', async (t) => {
  if (!page) return t.skip('无浏览器');
  for (const hash of ['#/problems', '#/submissions', '#/ranking', '#/path', '#/problem/p1-naive']) {
    const r = await goto(hash);
    assert.ok(r.html > 200, hash + ' 渲染内容过少（' + r.html + ' 字节）');
    assert.ok(r.text.length > 0, hash + ' 文本为空');
  }
  assert.deepEqual(page.exceptions, [], '路由切换出现异常：' + JSON.stringify(page.exceptions));
});

test('Worker 沙箱在 file:// 下真实生效（degraded 必须为 false）', async (t) => {
  if (!page) return t.skip('无浏览器');
  const out = await page.evaluate(
    `(function(){
      var p = TSJ.findProblem('p1-naive');
      var d = TSJ.findDataset(p.dataset);
      return TSJ.judge.evaluate({ problem: p, dataset: d, code: p.solution });
    })()`,
    true
  );
  assert.equal(out.degraded, false, '判题降级为同线程执行（Worker 在 file:// 下不可用）');
  assert.equal(out.verdict, 'AC', 'p1 参考解应 AC，实际 ' + out.verdict);
  assert.ok(out.score >= 60, '参考解得分应 >= 通过线，实际 ' + out.score);
});

test('file:// 下的判题口径与 Node 一致：naive 在 p1 只有 57 分（打平基线不算赢）', async (t) => {
  if (!page) return t.skip('无浏览器');
  const out = await page.evaluate(
    `(function(){
      var p = TSJ.findProblem('p1-naive');
      var d = TSJ.findDataset(p.dataset);
      return TSJ.judge.evaluate({
        problem: p, dataset: d,
        code: 'function predict(history, horizon, ctx){ var v=history[history.length-1]; var o=[]; for(var i=0;i<horizon;i++)o.push(v); return o; }'
      });
    })()`,
    true
  );
  assert.equal(out.verdict, 'WA', 'naive 在 p1 应 WA（与最优基线打平），实际 ' + out.verdict);
  assert.equal(out.score, 57);
});

test('真实 TLE：死循环在 Worker 里被终止，页面仍可交互', async (t) => {
  if (!page) return t.skip('无浏览器');
  const t0 = Date.now();
  const out = await page.evaluate(
    `(function(){
      var p = TSJ.findProblem('p1-naive');
      var d = TSJ.findDataset(p.dataset);
      return TSJ.judge.evaluate({ problem: p, dataset: d, code: 'function predict(){ while(true){} }' });
    })()`,
    true
  );
  const dt = Date.now() - t0;
  assert.equal(out.verdict, 'TLE');
  assert.equal(out.score, 0);
  assert.ok(dt < 12000, 'TLE 应在 8s 整题超时内返回，实际 ' + dt + 'ms');
  // 页面还能继续跑
  const alive = await page.evaluate('1+1');
  assert.equal(alive, 2, 'TLE 之后页面失去响应');
});

test('XSS：提交含 <img onerror> 的代码，不会被执行（报错信息按文本渲染）', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/p1-naive');
  await page.evaluate(
    `(function(){
      window.__xss = 0;
      var ta = document.querySelector('.ed-input');
      ta.value = 'function predict(){ throw new Error("<img src=x onerror=window.__xss=1>"); }';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btnSubmit').click();
    })()`
  );
  const ok = await waitFor('document.querySelector(".err-box")', 15000);
  assert.ok(ok, '判题结果没有渲染出来');
  await sleep(300);
  const r = await page.evaluate(
    '(function(){var e=document.querySelector(".err-box");return {xss:window.__xss, text:e.textContent, html:e.innerHTML, imgs:document.querySelectorAll("#resultPanel img").length};})()'
  );
  assert.equal(r.xss, 0, 'XSS 被执行了：window.__xss=' + r.xss);
  assert.equal(r.imgs, 0, '结果面板里出现了真实 <img> 元素');
  assert.ok(r.text.indexOf('<img') >= 0, '报错信息应以文本形式展示原始载荷');
  assert.ok(r.html.indexOf('&lt;img') >= 0, '载荷未被转义（innerHTML 里应出现 &lt;img）');
});

test('XSS：返回 length 为恶意字符串的类数组，错误信息同样被转义', async (t) => {
  if (!page) return t.skip('无浏览器');
  await goto('#/problem/p1-naive');
  await page.evaluate(
    `(function(){
      window.__xss2 = 0;
      var ta = document.querySelector('.ed-input');
      ta.value = 'function predict(){ return { length: "<img src=x onerror=window.__xss2=1>" }; }';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btnSubmit').click();
    })()`
  );
  const ok = await waitFor('document.querySelector(".err-box")', 15000);
  assert.ok(ok, '判题结果没有渲染出来');
  await sleep(300);
  const r = await page.evaluate(
    '(function(){var e=document.querySelector(".err-box");return {xss:window.__xss2, text:e.textContent, imgs:document.querySelectorAll("#resultPanel img").length};})()'
  );
  assert.equal(r.xss, 0, 'XSS 被执行了：window.__xss2=' + r.xss);
  assert.equal(r.imgs, 0);
  assert.ok(r.text.indexOf('实际为') >= 0, '应提示长度不符：' + r.text);
});

test('XSS：题面/题解渲染（highlightCode）不含未转义标签', async (t) => {
  if (!page) return t.skip('无浏览器');
  const out = await page.evaluate(
    `(function(){
      var p = TSJ.findProblem('p1-naive');
      return { hasSolution: typeof p.solution === 'string', esc: TSJ.highlightCode('</code><img src=x onerror=1>') };
    })()`
  );
  assert.equal(out.esc.indexOf('<img'), -1);
  assert.equal(out.esc.indexOf('</code>'), -1);
});

test('【缺陷 P2】localStorage 被写入恶意字段时，进度/提交记录渲染存在 XSS', async (t) => {
  if (!page) return t.skip('无浏览器');
  // file:// 下 localStorage 属于 opaque origin，同目录其它本地页面可写入。
  // app.js 里 rec.best / s.score 未转义就拼进 innerHTML（renderProblem / renderPath / renderSubmissions）。
  const payload = '<img src=x onerror=window.__pwn=1>';
  await page.evaluate(
    `(function(){
      window.__pwn = 0;
      localStorage.setItem('tsoj:progress', JSON.stringify({'p1-naive':{best:'${payload}',passed:true,attempts:1}}));
      localStorage.setItem('tsoj:submissions', JSON.stringify([{at:1,problemId:'p1-naive',title:'${payload}',score:'${payload}',verdict:'AC',passed:true,metric:'${payload}'}]));
      localStorage.setItem('tsoj:drafts', JSON.stringify({'p1-naive': 42}));
    })()`
  );
  await page.send('Page.reload');
  await sleep(900);
  await goto('#/problem/p1-naive');
  await sleep(200);
  const r1 = await page.evaluate(
    '(function(){return {pwn:window.__pwn, imgs:document.querySelectorAll(".pane-left img").length, meta:document.querySelector(".meta-row").textContent};})()'
  );
  await goto('#/path');
  await sleep(200);
  const r1b = await page.evaluate(
    '(function(){return {pwn:window.__pwn, imgs:document.querySelectorAll("#view img").length, text:document.querySelector("#view").textContent};})()'
  );
  await goto('#/submissions');
  await sleep(200);
  const r2 = await page.evaluate('(function(){return {pwn:window.__pwn, imgs:document.querySelectorAll("#view img").length};})()');
  const stored = await page.evaluate(
    "(function(){return {progress:localStorage.getItem('tsoj:progress'), drafts:localStorage.getItem('tsoj:drafts')};})()"
  );
  await page.evaluate(
    "(function(){['tsoj:progress','tsoj:submissions','tsoj:drafts'].forEach(function(k){localStorage.removeItem(k);});})()"
  );
  console.log('    注入结果：' + JSON.stringify(r1) + ' ' + JSON.stringify(r1b) + ' ' + JSON.stringify(r2));
  // 注意：reload 之后 window.__pwn 会重置为 undefined，因此用「是否为 1」判定，不能用求和
  assert.notEqual(r1.pwn, 1, 'localStorage 里的 HTML 被执行为脚本（rec.best 未转义）');
  assert.notEqual(r1b.pwn, 1, 'localStorage 里的 HTML 被执行为脚本（renderPath 未转义）');
  assert.notEqual(r2.pwn, 1, 'localStorage 里的 HTML 被执行为脚本（s.score 未转义）');
  assert.equal(r1.imgs + r1b.imgs + r2.imgs, 0, '页面里出现了注入的 <img> 元素');
  // 恶意 score / title 必须以纯文本呈现（被 esc 过），而不是变成标签
  assert.ok(r2.imgs === 0);
  assert.ok(r1.meta.indexOf('<img') === -1, 'meta 行里出现了未转义载荷');
  // 脏字段被归一化：progress.best 变成数字 0（Number 归一），drafts 里的非字符串被丢弃
  const parsed = JSON.parse(stored.progress || '{}');
  assert.equal(typeof parsed['p1-naive'].best, 'number', 'progress.best 未被归一化为数字：' + JSON.stringify(parsed));
  assert.equal(parsed['p1-naive'].best, 0);
  assert.equal(stored.drafts, '{}', 'drafts 里的非字符串值未被丢弃：' + stored.drafts);
});

test('localStorage 脏数据（非法 JSON）不影响启动', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.evaluate(
    `(function(){
      localStorage.setItem('tsoj:progress', '{{{');
      localStorage.setItem('tsoj:drafts', 'not-json');
      localStorage.setItem('tsoj:submissions', '[]');
      localStorage.setItem('tsoj:filter', '[]');
    })()`
  );
  await page.send('Page.reload');
  await sleep(900);
  // reload 会保留 hash，先回到题库页再断言
  await goto('#/problems');
  const info = await page.evaluate('(function(){return {rows:document.querySelectorAll(".prow").length};})()');
  assert.equal(info.rows, 9, '脏数据导致题库渲染失败');
  // 非法 JSON / 类型不符的键必须被静默重写成合法默认值
  const rewritten = await page.evaluate(
    "(function(){return {p:localStorage.getItem('tsoj:progress'), d:localStorage.getItem('tsoj:drafts'), f:localStorage.getItem('tsoj:filter')};})()"
  );
  assert.equal(rewritten.p, '{}', '非法 progress 未被重写：' + rewritten.p);
  assert.equal(rewritten.d, '{}', '非法 drafts 未被重写：' + rewritten.d);
  assert.equal(rewritten.f, '"全部"', '类型不符的 filter 未被重写：' + rewritten.f);
  // 清干净，避免影响后续用例
  await page.evaluate(
    "(function(){['tsoj:progress','tsoj:drafts','tsoj:submissions','tsoj:filter'].forEach(function(k){localStorage.removeItem(k);});})()"
  );
});

test('【缺陷 P2】localStorage 类型错乱时提交被伪装成运行时错误', async (t) => {
  if (!page) return t.skip('无浏览器');
  await page.evaluate("localStorage.setItem('tsoj:submissions','{}'); localStorage.setItem('tsoj:progress','\"x\"');");
  await page.send('Page.reload');
  await sleep(900);
  await goto('#/problem/p1-naive');
  const before = page.exceptions.length;
  await page.evaluate(
    `(function(){
      var ta = document.querySelector('.ed-input');
      ta.value = TSJ.findProblem('p1-naive').solution;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btnSubmit').click();
    })()`
  );
  await waitFor('document.querySelector(".verdict")', 15000);
  await sleep(400);
  const r = await page.evaluate(
    '(function(){var v=document.querySelector(".verdict");var e=document.querySelector(".err-box");return {verdict:v?v.textContent:null, err:e?e.textContent:null, stored:localStorage.getItem("tsoj:submissions")};})()'
  );
  const newExceptions = page.exceptions.slice(before);
  console.log('    脏数据类型下的提交结果：' + JSON.stringify(r) + ' 新异常=' + JSON.stringify(newExceptions));
  await page.evaluate(
    "(function(){['tsoj:progress','tsoj:submissions','tsoj:drafts'].forEach(function(k){localStorage.removeItem(k);});})()"
  );
  // 脏数据类型必须被类型守卫挡掉（丢弃 + 静默重写），正确答案仍然要判 AC、并且真的写进记录。
  assert.equal(newExceptions.length, 0, '脏数据类型导致未捕获异常：' + JSON.stringify(newExceptions));
  assert.ok(r.verdict && r.verdict.indexOf('AC') >= 0, '应正常判为 AC，实际 ' + r.verdict + '（' + r.err + '）');
  assert.equal(r.err, null, '不应出现错误框：' + r.err);
  const stored = JSON.parse(r.stored || 'null');
  assert.ok(Array.isArray(stored), '提交记录应为数组，实际 ' + r.stored);
  assert.equal(stored.length, 1, '应有 1 条提交记录，实际 ' + r.stored);
  assert.equal(stored[0].problemId, 'p1-naive');
});
