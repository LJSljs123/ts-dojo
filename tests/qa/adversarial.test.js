/**
 * adversarial.test.js —— 对抗性提交与沙箱隔离
 *
 * 三条路径都要覆盖：
 *   ① evaluateSync / runInProcess（同线程，可信代码路径）—— 验证返回值校验、异常、变异隔离；
 *   ② evaluate / runSandbox（Worker 沙箱）—— 用 helpers/fakeworker.js 在 Node 里造独立 realm，
 *      验证 fetch/Worker/globalThis 等禁用生效、死循环真的被判 TLE 而不是把进程挂死；
 *   ③ 降级路径无超时的证据 —— 子进程探针（3 秒必杀）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { loadEngine, makeCase, ROOT } = require('./helpers/engine');
const { installFakeWorker } = require('./helpers/fakeworker');

const { judge, datasets, problems } = loadEngine();

/** 10 点序列，horizon=4 → history = 前 6 点（全 1），actual = 后 4 点（全 2） */
function baseCase(over) {
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  return makeCase(Object.assign({ horizon: 4, baselines: ['naive'], threshold: 0.9 }, over || {}), values);
}

function evalSyncCode(code, over) {
  const { problem, dataset } = baseCase(over);
  return judge.evaluateSync({ problem, dataset, code });
}

/* ================================================================== *
 * ① 返回值校验（同线程路径）
 * ================================================================== */

test('返回 Infinity 数组 → RE，且不参与计分', () => {
  const res = evalSyncCode('function predict(history,horizon,ctx){ return new Array(horizon).fill(Infinity); }');
  assert.equal(res.verdict, 'RE');
  assert.equal(res.passed, false);
  assert.equal(res.score, 0);
  assert.equal(res.cases[0].score, 0);
  assert.match(res.cases[0].error, /不是有限数值/);
});

test('返回 NaN 数组 → RE', () => {
  const res = evalSyncCode('function predict(history,horizon,ctx){ return new Array(horizon).fill(NaN); }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /第 1 个预测值不是有限数值/);
});

test('返回字符串数组 → RE（不是静默转数字）', () => {
  const res = evalSyncCode('function predict(h,n,c){ return ["1","2","3","4"]; }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /不是有限数值/);
});

test('返回空数组 → RE，提示期望长度', () => {
  const res = evalSyncCode('function predict(h,n,c){ return []; }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /长度必须为 4，实际为 0/);
});

test('返回长度差 1（少 1 / 多 1）→ RE', () => {
  for (const [code, actual] of [
    ['function predict(h,n,c){ return [1,2,3]; }', '3'],
    ['function predict(h,n,c){ return [1,2,3,4,5]; }', '5'],
  ]) {
    const res = evalSyncCode(code);
    assert.equal(res.verdict, 'RE');
    assert.match(res.cases[0].error, new RegExp('实际为 ' + actual));
  }
});

test('返回 null / undefined / 无 length 的对象 → RE', () => {
  for (const code of [
    'function predict(h,n,c){ return null; }',
    'function predict(h,n,c){ return; }',
    'function predict(h,n,c){ return {}; }',
  ]) {
    const res = evalSyncCode(code);
    assert.equal(res.verdict, 'RE', code);
    assert.ok(res.cases[0].error.length > 0);
  }
});

test('返回长度恰好相同但元素是字符的字符串 → RE（不被 length 蒙过）', () => {
  const res = evalSyncCode('function predict(h,n,c){ return "abcd"; }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /不是有限数值/);
});

test('返回 getter 抛异常的类数组 → RE，错误信息透传且不崩', () => {
  const res = evalSyncCode(
    'function predict(h,n,c){ var o={length:4}; Object.defineProperty(o,"0",{get:function(){throw new Error("boom-getter");}}); return o; }'
  );
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /boom-getter/);
});

test('抛异常 → RE 且错误信息透传', () => {
  const res = evalSyncCode('function predict(h,n,c){ throw new Error("boom"); }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /boom/);
});

test('语法错误 → RE，提示含「语法错误」', () => {
  const res = evalSyncCode('function predict(h,n,c){ return [1,2,3,4 }; }');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /语法错误/);
});

test('只写表达式不定义 predict → RE，提示 predict 未定义', () => {
  const res = evalSyncCode('[1,2,3,4]');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /predict is not defined/);
});

test('predict 不是函数 → RE', () => {
  const res = evalSyncCode('var predict = 42;');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /predict is not a function/);
});

test('死循环 + 同线程路径：无超时保护（子进程探针 3s 必杀，证明会挂死）', () => {
  // 这条用例不是在断言「好行为」，而是把「降级路径没有超时」这个事实固化成可回归的证据。
  const script = [
    'const {loadEngine,makeCase}=require(' + JSON.stringify(path.join(ROOT, 'tests/qa/helpers/engine.js')) + ');',
    'const {judge}=loadEngine();',
    'const c=makeCase({horizon:4,baselines:["naive"]},[1,1,1,1,1,1,2,2,2,2]);',
    'judge.evaluateSync({problem:c.problem,dataset:c.dataset,code:"function predict(){ while(true){} }"});',
    'console.log("RETURNED");',
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', script], { timeout: 3000, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '', '同线程路径竟然返回了（说明有超时保护）');
  assert.notEqual(r.status, 0, '应因超时被 kill，而不是正常退出');
});

/* ================================================================== *
 * ② 变异隔离 / 全局污染（同线程路径也不能污染数据集）
 * ================================================================== */

test('history.push(999) 不会污染数据集，也不会影响后续测试点', () => {
  const values = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  const { problem, dataset } = makeCase({ horizon: 4, windows: 2, originStep: 2, mode: 'rolling', baselines: ['naive'], threshold: 0.9 }, values);
  const before = dataset.values.slice();
  const code = [
    'function predict(history, horizon, ctx) {',
    '  globalThis.__qaSpy = globalThis.__qaSpy || [];',
    '  globalThis.__qaSpy.push(history.length);',
    '  history.push(999);',            // 试图篡改传入数组
    '  history[0] = -1;',
    '  return new Array(horizon).fill(2);',
    '}',
  ].join('\n');
  globalThis.__qaSpy = [];
  judge.evaluateSync({ problem, dataset, code });
  const spy = globalThis.__qaSpy.slice();
  delete globalThis.__qaSpy;
  assert.deepEqual(dataset.values, before, '数据集被用户代码修改了');
  assert.ok(spy.length >= 2, '应至少执行两个窗口');
  // 第二个窗口的 history 长度必须是原始 trainEnd（4 / 6），不受第一个窗口 push 影响
  assert.deepEqual(spy, [4, 6], '各窗口的 history 长度应保持原始值，实际 ' + JSON.stringify(spy));
});

test('同一份代码重复判题，结果完全一致（无隐藏状态）', () => {
  const { problem, dataset } = baseCase();
  const code = 'function predict(h,n,c){ return [1.5,1.5,1.5,1.5]; }';
  const a = judge.evaluateSync({ problem, dataset, code });
  const b = judge.evaluateSync({ problem, dataset, code });
  assert.equal(a.score, b.score);
  assert.equal(a.verdict, b.verdict);
  assert.deepEqual(a.cases[0].actual, b.cases[0].actual);
});

test('空训练集（len === horizon）不会崩溃或挂死', () => {
  const values = [9, 9, 9, 9];
  const { problem, dataset } = makeCase({ horizon: 4, baselines: ['naive', 'mean', 'linear_trend'], threshold: 0.9 }, values);
  const res = judge.evaluateSync({ problem, dataset, code: 'function predict(h,n,c){ return [9,9,9,9]; }' });
  assert.ok(['AC', 'WA', 'RE'].indexOf(res.verdict) >= 0, '应给出确定判决，实际 ' + res.verdict);
});

/* ================================================================== *
 * ③ Worker 沙箱：禁用 API、隔离、TLE
 * ================================================================== */

/** 在假 Worker 环境里跑一次 evaluate（带 6s 兜底，避免测试自身挂死） */
async function evalSandbox(code, over, limits) {
  const { problem, dataset } = baseCase(over);
  const fw = installFakeWorker(judge, { hangMs: 200 });
  try {
    const guard = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('判题在 6s 内没有返回（疑似挂死）')), 6000).unref()
    );
    // perJob 600ms：载荷全部同步抛错、不依赖等待；300ms 在整套 QA 并发负载下
    // 会被事件循环饥饿误判成 TLE（曾两次在全量运行中偶发翻车），放宽不弱化断言。
    const res = await Promise.race([
      judge.evaluate({ problem, dataset, code, limits: limits || { perJob: 600, total: 2500 } }),
      guard,
    ]);
    return { res, stat: fw.stat };
  } finally {
    fw.restore();
  }
}

test('沙箱：正常代码可真实判题，且与同线程路径结果一致（未降级）', async () => {
  const code = 'function predict(h,n,c){ return [1.5,1.5,1.5,1.5]; }';
  const { res, stat } = await evalSandbox(code);
  const sync = evalSyncCode(code);
  assert.equal(res.degraded, false, '不应降级为同线程执行');
  assert.equal(stat.created, 1, '应真的创建了 1 个 Worker');
  assert.equal(res.score, sync.score, '沙箱与同线程得分应一致');
  assert.equal(res.cases[0].yourMetric, sync.cases[0].yourMetric);
  assert.equal(res.verdict, sync.verdict);
});

test('沙箱：fetch / XHR / importScripts / Worker / postMessage / self / globalThis / document 全部被拦', async () => {
  const payloads = {
    fetch: 'function predict(){ fetch("http://x/"); return [1,1,1,1]; }',
    xhr: 'function predict(){ new XMLHttpRequest(); return [1,1,1,1]; }',
    importScripts: 'function predict(){ importScripts("http://x/a.js"); return [1,1,1,1]; }',
    Worker: 'function predict(){ new Worker("http://x/w.js"); return [1,1,1,1]; }',
    postMessage: 'function predict(){ postMessage({hack:1}); return [1,1,1,1]; }',
    self: 'function predict(){ self.postMessage({hack:1}); return [1,1,1,1]; }',
    globalThis: 'function predict(){ return new Array(4).fill(globalThis.process.pid); }',
    document: 'function predict(){ return new Array(4).fill(document.cookie.length); }',
    localStorage: 'function predict(){ localStorage.setItem("x","1"); return [1,1,1,1]; }',
    location: 'function predict(){ return new Array(4).fill(location.href.length); }',
  };
  for (const [name, code] of Object.entries(payloads)) {
    const { res, stat } = await evalSandbox(code);
    assert.equal(res.verdict, 'RE', name + ' 应被判 RE');
    assert.match(res.cases[0].error, /沙箱限制/, name + ' 的提示应说明沙箱限制，实际：' + res.cases[0].error);
    assert.deepEqual(stat.canary, [], name + ' 竟然真的调用了真实 API：' + JSON.stringify(stat.canary));
  }
});

test('沙箱：eval 被遮蔽 —— 既不能执行任意代码，也就无法绕过超时（判 RE + 沙箱限制）', async () => {
  // 期望值变更（T03）：加固后 eval 被替换成抛错桩，载荷根本跑不到 while(true)，
  // 因此判决从 TLE 变成 RE「沙箱限制：禁止使用 eval」。这是**产品行为变正确**，不是放宽断言：
  //   - 旧行为：eval 能执行任意代码，只是靠 1500ms 超时兜底；
  //   - 新行为：eval 直接不可用，超时兜底仍然存在（见下一条「死循环 → TLE」用例）。
  const t0 = Date.now();
  const { res, stat } = await evalSandbox('function predict(){ eval("while(true){}"); return [1,1,1,1]; }');
  const dt = Date.now() - t0;
  assert.equal(res.verdict, 'RE');
  assert.equal(res.score, 0);
  assert.match(res.cases[0].error, /沙箱限制/, '应提示沙箱限制，实际：' + res.cases[0].error);
  assert.match(res.cases[0].error, /eval/);
  assert.match(res.message, /沙箱限制/);
  assert.ok(dt < 4000, '应在数秒内返回，实际 ' + dt + 'ms');
  assert.ok(stat.terminated >= 1, '结束时应 terminate worker');
});

test('沙箱：死循环 → TLE（perJob 生效），进程不被挂死', async () => {
  const t0 = Date.now();
  const { res, stat } = await evalSandbox('function predict(){ while(true){} }');
  const dt = Date.now() - t0;
  assert.equal(res.verdict, 'TLE', '应判超时，实际 ' + res.verdict);
  assert.equal(res.score, 0);
  assert.equal(res.passed, false);
  assert.match(res.cases[0].error, /超时/);
  assert.ok(dt >= 250 && dt < 4000, '应在 perJob 附近返回，实际 ' + dt + 'ms');
  assert.ok(stat.terminated >= 1, '应终止 worker');
});

test('沙箱：只有部分窗口超时 → 整体 TLE、0 分（不会把已通过的窗口算成 AC）', async () => {
  // 第 2 个窗口死循环
  const values = [];
  for (let i = 0; i < 12; i++) values.push(1);
  for (let i = 0; i < 4; i++) values.push(2);
  const { problem, dataset } = makeCase(
    { horizon: 4, windows: 2, originStep: 4, mode: 'rolling', baselines: ['naive'], threshold: 0.9 },
    values
  );
  const fw = installFakeWorker(judge, { hangMs: 200 });
  try {
    const res = await judge.evaluate({
      problem,
      dataset,
      code: 'function predict(h,n,c){ if (c.index === 1) { while(true){} } return [2,2,2,2]; }',
      limits: { perJob: 300, total: 1500 },
    });
    assert.equal(res.verdict, 'TLE');
    assert.equal(res.score, 0, '超时应强制 0 分');
    assert.equal(res.passed, false);
  } finally {
    fw.restore();
  }
});

test('沙箱：污染 Object.prototype / Array.prototype 不会影响主线程', async () => {
  const code = [
    'function predict(history, horizon, ctx) {',
    '  Object.prototype.__qaPwn = "pwned";',
    '  Array.prototype.push = function(){ throw new Error("hijacked"); };',
    '  return new Array(horizon).fill(1.5);',
    '}',
  ].join('\n');
  const { res } = await evalSandbox(code);
  assert.ok(['AC', 'WA', 'RE'].indexOf(res.verdict) >= 0, '应给出确定判决');
  assert.equal({}.__qaPwn, undefined, 'Object.prototype 被沙箱内的代码污染了');
  assert.doesNotThrow(() => [].push(1), 'Array.prototype.push 被沙箱内的代码替换了');
  // 主线程判题器仍然正常工作
  const again = evalSyncCode('function predict(h,n,c){ return [1.5,1.5,1.5,1.5]; }');
  assert.equal(again.verdict, 'AC');
});

test('沙箱：语法错误在 worker 内被捕获，不触发 onerror 死循环', async () => {
  const { res } = await evalSandbox('function predict( { ');
  assert.equal(res.verdict, 'RE');
  assert.match(res.cases[0].error, /语法错误/);
});

test('沙箱：异步抛错（worker.onerror）不得把后续测试点误判为 TLE（孤儿定时器回归）', async () => {
  /*
   * 场景：用户代码留下 setTimeout 回调异步抛错（沙箱允许函数形式的 setTimeout），
   * 错误事件在下一个测试点在飞时到达主线程 worker.onerror。
   * 旧实现 onerror 不清 jobTimer 就 next()：旧定时器被新赋值覆盖成为孤儿，
   * 到期后 finish(true)，把仍在正常跑的后续测试点整题误判 TLE、总分记 0。
   * 修复后：onerror 先清定时器；只有出错的那个点记 RE，其余点照常完成。
   */
  const fw = installFakeWorker(judge, { hangMs: 200 });
  try {
    const RealWorker = globalThis.Worker;
    globalThis.Worker = class extends RealWorker {
      constructor(url) {
        super(url);
        const self = this;
        let handler = null;
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get() { return handler; },
          set(fn) {
            // 第 2 个测试点（id=1）的结果送达前，先模拟一次异步 onerror；
            // 之后每个测试点延迟 150ms 送达 —— 模拟真实耗时，让孤儿定时器有机会在
            // 「后续测试点仍在飞」时到期（旧 bug 正是这时把整题误判 TLE）。
            handler = function (ev) {
              const id = ev.data && ev.data.id;
              if (id === 1 && !self.__qaBoom) {
                self.__qaBoom = true;
                if (typeof self.onerror === 'function') self.onerror({ message: 'Uncaught Error: boom (async)' });
              }
              if (id >= 2) {
                setTimeout(function () { fn(ev); }, 150);
                return;
              }
              fn(ev);
            };
          },
        });
      }
    };
    const values = [];
    for (let i = 0; i < 60; i++) values.push(1 + (i % 4));
    const { problem, dataset } = makeCase(
      { horizon: 4, mode: 'rolling', windows: 12, originStep: 4, baselines: ['naive'], threshold: 0.9 },
      values
    );
    const guard = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('判题在 40s 内没有返回（疑似挂死）')), 40000).unref()
    );
    const res = await Promise.race([
      judge.evaluate({
        problem, dataset,
        code: 'function predict(h,n,c){ return new Array(n).fill(1.5); }',
        /*
         * 时序设计（对并行负载鲁棒）：12 个滚动窗口、送达延迟 d=150ms。
         * onerror 在 id=1（第 2 个 job）送达时触发，孤儿定时器 = 该 job 的 perJob，
         * 从 T1（其派发时刻）起算；其余 10 个 job 的结果在 T1 + k·d 逐个到达，
         * 全部完成于 T1 + 10d = 1500ms。
         * 旧代码变红：孤儿须落在最后一个窗口的在飞区间 (9d, 10d) = (1350, 1500)
         * → perJob=1425 ✓（负载膨胀 L 倍时完成时刻 1500·L ≥ 1425 恒成立 → 恒红）。
         * 新代码变绿：每个 job 的送达间隔 150·L 必须小于 perJob=1425
         * → 容忍 L ≤ 9.5 倍并行负载膨胀。正常并行负载（≤3 倍）下稳定。
         */
        limits: { perJob: 1425, total: 30000 },
      }),
      guard,
    ]);
    assert.equal(res.cases.length, 12, '应有 12 个测试点');
    const verdicts = res.cases.map((c) => c.verdict);
    assert.ok(verdicts.indexOf('TLE') < 0, '任何测试点都不应被判 TLE，实际：' + JSON.stringify(verdicts));
    assert.notEqual(res.verdict, 'TLE', '整题不应被判 TLE');
    // 出错只应落在异步错误波及的那个点上（其余点正常完成）
    assert.equal(verdicts[1], 'RE', '异步错误应记到在飞的第 2 个点上：' + JSON.stringify(verdicts));
    assert.match(res.cases[1].error, /boom/);
    assert.notEqual(verdicts[0], 'RE');
    assert.notEqual(verdicts[verdicts.length - 1], 'RE');
  } finally {
    fw.restore();
  }
});
