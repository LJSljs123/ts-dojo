/**
 * helpers/cdp.js —— 用本机 Edge/Chrome 无头模式 + CDP 做真实浏览器冒烟
 *
 * 只依赖 Node 内置能力（child_process / fetch / WebSocket），不装任何 npm 包。
 * 找不到浏览器或连不上 CDP 时，调用方应跳过（返回 null），并在报告里明确写「未验证」。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {
      /* ignore */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头浏览器并连上第一个 page target。
 *
 * 返回前会内置调用 waitReady()，因此调用方拿到 page 时 `window.TSJ.findProblem` 已可调用、
 * `#view` 已渲染出内容 —— 不需要再 `sleep(400)` 之类的固定等待。
 *
 * @param {string} url 要打开的 file:// URL
 * @param {{timeout?: number, readyTimeout?: number}} [opts]
 * @returns {Promise<{send: Function, evaluate: Function, waitReady: Function,
 *   reload: Function, on: Function, close: Function, exceptions: Array, logs: Array}|null>}
 */
async function launch(url, opts) {
  const exe = findBrowser();
  if (!exe) return null;
  const port = 9400 + Math.floor(Math.random() * 200);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tsoj-cdp-'));
  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profile,
      '--allow-file-access-from-files',
      url,
    ],
    { stdio: 'ignore' }
  );

  const deadline = Date.now() + (opts && opts.timeout ? opts.timeout : 15000);
  let target = null;
  while (Date.now() < deadline) {
    try {
      // 每次探测都带超时：浏览器卡死时 /json/list 可能永不返回，
      // 不加超时会让 launch 永远停在轮询里（整套测试随之挂死）。
      const res = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) });
      const list = await res.json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) {
      /* 还没起来 / 探测超时：继续轮询直到 deadline */
    }
    await sleep(200);
  }
  if (!target) {
    try { proc.kill(); } catch (e) { /* ignore */ }
    return null;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
  });

  let seq = 0;
  const pending = new Map();
  const exceptions = [];
  const logs = [];
  const handlers = new Map();

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' / ' + JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      exceptions.push((d.exception && d.exception.description) || d.text || 'unknown');
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '),
      });
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry || {};
      logs.push({ type: e.level, text: e.text || '' });
      if (e.level === 'error') exceptions.push(e.text || '');
    }
    const hs = handlers.get(msg.method);
    if (hs) hs.forEach((fn) => fn(msg.params));
  });

  function send(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      // 必须有超时：浏览器卡死 / WebSocket 断开时 CDP 永远不回包，
      // 没有超时会把整个测试文件挂死（而不是失败）。
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('CDP 请求超时（20s）：' + method));
      }, 20000);
      timer.unref ? timer.unref() : void 0;
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  /**
   * 在页面里求值。
   * @param {string} expression JS 表达式
   * @param {boolean} [awaitPromise] 是否等待 Promise
   * @returns {Promise<*>} 值的 JSON 形式
   */
  async function evaluate(expression, awaitPromise) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: !!awaitPromise,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面内求值异常：' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }

  /** 页面就绪判据：TSJ 命名空间可用 + 首个视图已渲染 */
  const READY_EXPR =
    '!!(window.TSJ && typeof TSJ.findProblem === "function" && ' +
    'typeof TSJ.judge === "object" && document.querySelector("#view") && ' +
    'document.querySelector("#view").innerHTML.length > 0)';

  /**
   * 轮询等待页面脚本执行完毕（消除「靠固定 sleep 掩盖 flake」的做法）。
   *
   * 判据必须包含「TSJ.findProblem 可调用」与「#view 已渲染」两条：
   *   - 只看 TSJ 存在会在 app.js 还没 init 时提前通过；
   *   - 只看 #view 非空会在 datasets/problems 尚未挂载时提前通过。
   *
   * @param {number} [timeout] 超时毫秒
   * @returns {Promise<boolean>} 就绪返回 true，超时抛错
   */
  async function waitReady(timeout) {
    const end = Date.now() + (timeout || 15000);
    let last = '';
    while (Date.now() < end) {
      try {
        const r = await send('Runtime.evaluate', {
          expression: READY_EXPR,
          returnByValue: true,
          allowUnsafeEvalBlockedByCSP: true,
        });
        if (r && r.result && r.result.value === true) return true;
        if (r && r.exceptionDetails) last = r.exceptionDetails.text || 'exception';
      } catch (e) {
        last = (e && e.message) || String(e); // 页面重载期间执行上下文会被销毁
      }
      await sleep(80);
    }
    throw new Error('页面在 ' + (timeout || 15000) + 'ms 内未就绪（TSJ.findProblem 不可用）' + (last ? '：' + last : ''));
  }

  /**
   * 重载页面并等待就绪（替代 reload + 固定 sleep）。
   * @returns {Promise<void>}
   */
  async function reload() {
    await send('Page.reload');
    await waitReady(15000);
  }

  // 启动即等待就绪：调用方不再需要 sleep(400) 之类的兜底
  await waitReady(opts && opts.readyTimeout ? opts.readyTimeout : 15000);

  return {
    send,
    evaluate,
    waitReady,
    reload,
    exceptions,
    logs,
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    close() {
      try { ws.close(); } catch (e) { /* ignore */ }
      try { proc.kill(); } catch (e) { /* ignore */ }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    },
  };
}

module.exports = { launch, findBrowser };
