/**
 * backup.test.js —— v3.9 全量备份（schema 2）的 extras 往返与合并策略（纯 Node）
 *
 * 锁住四条容易被写坏的语义：
 *   1. buildBundle 必须把「有值」的 extras 键全部带上，且 schema = 2；
 *   2. 合并是「并集取优」不是覆盖：成就取最早解锁、achMeta 取大、数组按 id/hash 去重；
 *   3. 篡改 extras 任一键必须被 hash 校验拒绝（extras 在 hash 覆盖范围内）；
 *   4. v1 旧文件（仅三键、无 extras）仍可导入 —— 向后兼容是硬承诺。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');

/** 最小 localStorage 桩（core/storage 只用到 getItem/setItem/removeItem）。 */
const store = {};
globalThis.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};
globalThis.window = globalThis;

function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

// 与 index.html 同序的最小模块集（storage-extras 在 storage 之后装载并自注册）
['assets/js/app/util.js',
 'assets/js/app/core.js',
 'assets/js/app/schema.js',
 'assets/js/datasets.js',
 'assets/js/problems.js',
 'assets/js/app/store.js',
 'assets/js/app/storage.js',
 'assets/js/app/storage-extras.js',
 'assets/js/app/lab-storage.js',
 'assets/js/app/studio-storage.js',
 'assets/js/app/studio-csv.js',
].forEach(load);

const core = globalThis.TSJ.appCore;
const S = core.STORE;
const EXTRA_KEYS = [S.courseProgress, S.lab, S.studioExp, S.achievements, S.achMeta, S.labDraft, S.studioDraft, S.studioCsv];

function seed() {
  localStorage.setItem(S.courseProgress, JSON.stringify({ m1: { done: true, at: 111 } }));
  localStorage.setItem(S.lab, JSON.stringify([{ schema: 1, kind: 'illegal-record' }]));   // 非法 → 导入时被归一化丢弃
  localStorage.setItem(S.studioExp, JSON.stringify([{ schema: 1, kind: 'illegal-record' }]));
  localStorage.setItem(S.achievements, JSON.stringify({ 'first-ac': 500 }));
  localStorage.setItem(S.achMeta, JSON.stringify({ methods: ['ses'], looks: 3 }));
  localStorage.setItem(S.labDraft, JSON.stringify('lab draft v2'));
  localStorage.setItem(S.studioDraft, JSON.stringify('studio draft v2'));
  localStorage.setItem(S.studioCsv, JSON.stringify({ values: [1, 2, 3], name: 't', season: 7 }));
}

function clearExtras() {
  EXTRA_KEYS.forEach((k) => localStorage.removeItem(k));
}

test('备份往返：buildBundle 带全 extras（schema 2），清空后 applyImport 全部恢复', () => {
  localStorage.clear();
  seed();
  const bundle = globalThis.TSJ.appStorage.buildBundle();
  assert.equal(bundle.schema, 2, 'v2 备份 schema 应为 2');
  assert.ok(bundle.data.extras, '有值 extras 必须进备份');
  assert.equal(Object.keys(bundle.data.extras).length, 8, '八键应全部在备份里');
  const text = JSON.stringify(bundle);

  clearExtras();
  const parsed = globalThis.TSJ.appStorage.parseBundle(text);
  assert.equal(parsed.ok, true, '解析失败：' + parsed.reason);
  assert.equal(parsed.counts.extras, 8, '解析后 extras 键数：' + parsed.counts.extras);
  const merged = globalThis.TSJ.appStorage.applyImport(parsed.data);
  assert.ok(merged.extras >= 7, '合并键数（lab/studio 非法记录被丢弃后仍 ≥7）：' + JSON.stringify(merged));

  assert.deepEqual(JSON.parse(localStorage.getItem(S.courseProgress)), { m1: { done: true, at: 111 } });
  assert.equal(JSON.parse(localStorage.getItem(S.achievements))['first-ac'], 500);
  assert.equal(JSON.parse(localStorage.getItem(S.labDraft)), 'lab draft v2');
  assert.equal(JSON.parse(localStorage.getItem(S.studioDraft)), 'studio draft v2');
  assert.deepEqual(JSON.parse(localStorage.getItem(S.studioCsv)), { values: [1, 2, 3], name: 't', season: 7 });
  const meta = JSON.parse(localStorage.getItem(S.achMeta));
  assert.ok(meta.looks >= 3 && meta.methods.indexOf('ses') >= 0, 'achMeta 并集/取大失败');
});

test('合并策略：成就取最早解锁、achMeta 取大、数组去重取新', () => {
  localStorage.clear();
  seed();
  const storage = globalThis.TSJ.appStorage;
  const b1 = storage.buildBundle();

  // 本机状态演化：成就更晚解锁、looks 涨到 9、lab/studio 各有一条新记录
  localStorage.setItem(S.achievements, JSON.stringify({ 'first-ac': 900 }));
  localStorage.setItem(S.achMeta, JSON.stringify({ methods: ['holt'], looks: 9 }));
  const newLab = {
    schema: 1, kind: 'val', at: 1700000000000,
    appVersion: '3.9.0', algorithmVersion: 'lab-1', datasetVersion: 'datasets-9',
    config: { schema: 1, datasetId: 'airline', method: 'ses', params: { alpha: 0.3 },
      split: { mode: 'holdout', horizon: 12, windows: 1, originStep: 12 },
      metrics: ['mse'], baseline: 'seasonal_naive', interval: { enabled: false, levels: [80, 95] } },
    configHash: 'aaaa1111',
    origins: [{ index: 0, history: [1, 2, 3], actual: [4], prediction: [4], baseline: [4], metrics: { mse: 1 }, baselineMetrics: { mse: 1 }, intervals: [], coverage: [] }],
    metrics: { mean: { mse: 1 }, worst: { mse: 1 }, baselineMean: { mse: 2 }, baselineWorst: { mse: 2 } },
    baseline: 'seasonal_naive', intervalMeta: null, durationMs: 5,
  };
  localStorage.setItem(S.lab, JSON.stringify([newLab]));
  localStorage.setItem(S.studioExp, JSON.stringify([]));

  const text = JSON.stringify(b1);
  const parsed = storage.parseBundle(text);
  storage.applyImport(parsed.data);

  assert.equal(JSON.parse(localStorage.getItem(S.achievements))['first-ac'], 500, '成就应取最早解锁时间');
  const meta = JSON.parse(localStorage.getItem(S.achMeta));
  assert.equal(meta.looks, 9, 'looks 应取大');
  assert.deepEqual(meta.methods.sort(), ['holt', 'ses'], 'methods 应并集');
  const labList = globalThis.TSJ.appLabStorage.list();
  assert.equal(labList.length, 1, '非法实验室记录应被归一化丢弃，合法记录保留');
});

test('安全：篡改 extras 任一键必须被 hash 拒绝；v1 旧文件仍可导入', () => {
  localStorage.clear();
  seed();
  const storage = globalThis.TSJ.appStorage;
  const b = storage.buildBundle();
  const tampered = JSON.parse(JSON.stringify(b));
  tampered.data.extras[S.labDraft] = 'tampered';
  const r = storage.parseBundle(JSON.stringify(tampered));
  assert.equal(r.ok, false, '篡改 extras 必须被 hash 校验拒绝');

  // v1 旧文件（仅三键、无 extras）：向后兼容硬承诺
  const data = { progress: { 'p1-naive': { best: 88, passed: true, attempts: 2 } }, drafts: {}, submissions: [] };
  const v1 = JSON.stringify({
    schema: 1, app: 'tsoj', exportedAt: 1600000000000,
    data: data, hash: core.fnv1a(JSON.stringify(data)),
  });
  const parsed = storage.parseBundle(v1);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.equal(parsed.counts.extras, 0);
  assert.equal(parsed.data.progress['p1-naive'].best, 88);
});
