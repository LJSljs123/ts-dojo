/**
 * helpers/fakeworker.js —— 在 Node 里模拟浏览器的 Web Worker 环境，用于验证 judge.runSandbox。
 *
 * 为什么要自己写：Node 22 没有全局 Worker，judge.js 会因此降级到 runInProcess（同线程、无超时），
 * 那条路径无法验证「1500ms 超时是否真的生效」。这里用 node:vm 造一个**独立 realm** 的假 Worker：
 *   - 用户代码在 vm context 里执行（与主线程隔离，和真 Worker 的 realm 隔离同构）；
 *   - 单次执行受 vm 的 timeout 硬中断保护（模拟「真 Worker 被 terminate」）；
 *   - postMessage 用 context 原生函数实现，避免把 host 函数暴露进沙箱造成「假越狱」。
 *
 * 已知局限：context 内的 __outbox 是普通全局变量，理论上被测代码可以篡改它。
 * 本测试集的所有载荷都不会这么做（它们的目标是 fetch/Worker/globalThis 等真实攻击面）。
 */
'use strict';

const vm = require('node:vm');

/**
 * 安装假的 Worker / Blob / URL。
 * @param {Object} judge judge 模块（用它的 WORKER_SOURCE）
 * @param {Object} [opts] { hangMs: 单次执行被强制中断前的等待毫秒 }
 * @returns {{restore: Function, created: number, terminated: number, canary: string[]}}
 */
function installFakeWorker(judge, opts) {
  const hangMs = (opts && opts.hangMs) || 400;
  const saved = {
    Worker: globalThis.Worker,
    Blob: globalThis.Blob,
    URL: globalThis.URL,
  };
  const blobs = new Map();
  const stat = { created: 0, terminated: 0, canary: [] };
  let seq = 0;

  class FakeBlob {
    constructor(parts) {
      this._text = (parts || []).join('');
    }
  }

  class FakeWorker {
    constructor(url) {
      const text = blobs.get(url);
      if (!text) throw new Error('FakeWorker: 未知的 blob url ' + url);
      stat.created++;
      this.onmessage = null;
      this.onerror = null;
      this._dead = false;

      const ctx = vm.createContext({});
      this._ctx = ctx;
      // ① 先铺好「投递通道」——必须在 worker 源码封禁 globalThis 之前完成，
      //    否则后面连脚手架都读不到（这本身也说明 __block 确实生效了）。
      //    postMessage 用 context 原生函数，避免把 host 函数暴露进沙箱造成「假越狱」。
      //    注意：worker 源码末尾会 Object.freeze(globalThis)，因此作业载荷放在**可变对象**里
      //    （__inbox.json），而不是每次给全局变量赋新值 —— 后者在冻结后会被静默丢弃。
      vm.runInContext(
        'globalThis.self = globalThis;' +
          'globalThis.__outbox = [];' +
          'globalThis.__canary = [];' +
          'globalThis.__inbox = { json: null };' +
          // 预先抓住 push，模拟原生 postMessage 不依赖 Array.prototype（防止载荷劫持 push 卡住回包）
          'var __push = Array.prototype.push;' +
          'globalThis.postMessage = function (m) { __push.call(__outbox, m); };' +
          // 网络/加载类 API 的金丝雀：一旦被调用就留痕
          'globalThis.fetch = function () { __canary.push("fetch"); return {}; };' +
          'globalThis.XMLHttpRequest = function () { __canary.push("xhr"); };' +
          'globalThis.importScripts = function () { __canary.push("importScripts"); };' +
          'globalThis.Worker = function () { __canary.push("Worker"); };' +
          // 投递入口：JSON.parse 做一次「结构化克隆」，避免把 host 对象塞进沙箱
          'globalThis.__run = function () { onmessage({ data: JSON.parse(__inbox.json) }); };',
        ctx
      );
      // ② 执行 worker 源码（它会封掉 fetch / globalThis 等名字）
      vm.runInContext(judge.WORKER_SOURCE, ctx, { timeout: 3000 });
    }

    postMessage(job) {
      if (this._dead) return;
      const payload = JSON.stringify(job);
      const self = this;
      setImmediate(function () {
        if (self._dead) return;
        const ctx = self._ctx;
        // 通过可变容器投递：worker 源码末尾会冻结 globalThis，不能直接给全局变量赋值
        ctx.__inbox.json = payload;
        try {
          vm.runInContext('__run()', ctx, { timeout: hangMs });
        } catch (e) {
          // 死循环被 vm 强制中断 —— 等价于真 Worker 里「任务卡住、不回应」
        }
        const box = ctx.__outbox;
        const msgs = [];
        // 按索引读取并清空，不依赖 context 里的 Array.prototype 方法
        for (let i = 0; i < box.length; i++) msgs.push(box[i]);
        box.length = 0;
        const canary = ctx.__canary;
        for (let i = 0; i < canary.length; i++) stat.canary.push(String(canary[i]));
        canary.length = 0;
        for (const msg of msgs) {
          if (self._dead) return;
          if (typeof self.onmessage === 'function') self.onmessage({ data: msg });
        }
      });
    }

    terminate() {
      if (!this._dead) {
        this._dead = true;
        stat.terminated++;
      }
    }
  }

  globalThis.Blob = FakeBlob;
  globalThis.Worker = FakeWorker;
  // judge 只用到 URL.createObjectURL / URL.revokeObjectURL，用普通对象即可（且可重复安装）
  globalThis.URL = {
    createObjectURL(blob) {
      const url = 'blob:fake/' + ++seq;
      blobs.set(url, blob._text);
      return url;
    },
    revokeObjectURL(url) {
      blobs.delete(url);
    },
  };

  return {
    stat,
    restore() {
      globalThis.Worker = saved.Worker;
      globalThis.Blob = saved.Blob;
      globalThis.URL = saved.URL;
    },
  };
}

module.exports = { installFakeWorker };
