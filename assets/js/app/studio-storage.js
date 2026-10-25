/**
 * assets/js/app/studio-storage.js —— 模型工坊实验记录（v3.6）
 * 加载顺序：… app/lab-storage → app/studio-storage → app/studio.js
 * 挂载点：window.TSJ.appStudioStorage
 *
 * 与 lab-storage 同构：先完整校验再入列；写入失败不动旧数据；上限 30 条按时间淘汰。
 * 记录保存「代码快照 + 拆分协议 + val/test 指标与基线对比」，保证可复现与可复盘。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var KEY = core.STORE.studioExp;
  var MAX = 30;

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  /** 指标对象白名单归一化：只接受 mse/mae/smape 三个键的有限数。 */
  function normMetrics(m) {
    var out = {};
    var ok = false;
    ['mse', 'mae', 'smape'].forEach(function (k) {
      if (m && isFiniteNumber(m[k])) { out[k] = m[k]; ok = true; }
    });
    return ok ? out : null;
  }

  /** 基线对比表归一化：{ name: {mse,mae,smape} }，只保留合法项。 */
  function normBaselines(b) {
    var out = {};
    if (!b || typeof b !== 'object') return out;
    Object.keys(b).forEach(function (name) {
      var m = normMetrics(b[name]);
      if (m) out[String(name).slice(0, 40)] = m;
    });
    return out;
  }

  function normalizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.schema !== 1) return null;
    if (r.kind !== 'val' && r.kind !== 'final') return null;
    if (!r.datasetId || typeof r.datasetId !== 'string') return null;
    if (typeof r.codeHash !== 'string' || !r.codeHash) return null;
    if (!Array.isArray(r.split)) return null;
    if (r.split.length !== 3) return null;
    if (!r.split.every(function (n) { return typeof n === 'number' && n > 0; })) return null;
    var valM = normMetrics(r.valMetrics);
    var testM = normMetrics(r.testMetrics);
    if (r.kind === 'val' && !valM) return null;
    if (r.kind === 'final' && !testM) return null;   // final 只强制 test；val 对比列由展示层按代码哈希回查
    return {
      schema: 1,
      id: typeof r.id === 'string' && r.id ? r.id : 'exp-' + (r.at || 0),
      at: isFiniteNumber(r.at) ? r.at : 0,
      kind: r.kind,
      datasetId: r.datasetId,
      season: isFiniteNumber(r.season) ? r.season : 1,
      split: r.split.slice(),
      codeHash: r.codeHash,
      code: typeof r.code === 'string' ? r.code.slice(0, 20 * 1024) : '',
      valMetrics: valM || {},
      testMetrics: testM || {},
      baselinesVal: normBaselines(r.baselinesVal),
      baselinesTest: normBaselines(r.baselinesTest),
      testRuns: typeof r.testRuns === 'number' && r.testRuns > 0 ? Math.min(99, Math.floor(r.testRuns)) : 1
    };
  }

  function list() {
    var raw = core.readJSON(KEY, [], function (v) { return Array.isArray(v); });
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var rec = normalizeRecord(raw[i]);
      if (rec) out.push(rec);
    }
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }

  function save(record) {
    var rec = normalizeRecord(record);
    if (!rec) return { ok: false, error: '记录不合法，未保存' };
    var arr = list();
    arr.unshift(rec);
    while (arr.length > MAX) arr.pop();
    core.writeJSON(KEY, arr);
    return { ok: true, count: arr.length };
  }

  /** 同一代码哈希的最终评测次数（诚实性提示用）。 */
  function testRunCount(codeHash, datasetId) {
    var n = 0;
    var arr = list();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].kind === 'final' && arr[i].codeHash === codeHash && arr[i].datasetId === datasetId) n++;
    }
    return n;
  }

  function clear() { core.writeJSON(KEY, []); }

  function exportJSON(record) {
    var rec = normalizeRecord(record);
    if (!rec) return null;
    return JSON.stringify({ app: 'tsoj-studio', schema: 1, exportedAt: Date.now(), record: rec }, null, 2);
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法 JSON' }; }
    if (!data || data.app !== 'tsoj-studio') return { ok: false, error: '不是 TSOJ 模型工坊实验文件' };
    if (data.schema !== 1) return { ok: false, error: 'schema 不支持：' + data.schema };
    var rec = normalizeRecord(data.record);
    if (!rec) return { ok: false, error: '记录字段不完整' };
    var res = save(rec);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, record: rec, count: res.count };
  }

  TSJ.appStudioStorage = {
    MAX: MAX,
    list: list,
    save: save,
    clear: clear,
    testRunCount: testRunCount,
    exportJSON: exportJSON,
    importJSON: importJSON,
    normalizeRecord: normalizeRecord
  };
})(typeof window !== 'undefined' ? window : this);
