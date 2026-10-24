/**
 * assets/js/app/lab-storage.js —— 实验室记录存储（最近 20 组）
 *
 * 导入先完整校验再替换；写入失败不动旧数据；达到上限按时间淘汰。
 * 记录里保存完整配置、版本、逐 origin 预测/真值/指标与基线，保证可复现。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var KEY = core.STORE.lab;
  var MAX = 20;

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function normalizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.schema !== 1) return null;
    if (r.algorithmVersion !== 'lab-1') return null;
    if (!r.config || typeof r.config !== 'object') return null;
    if (!r.configHash || typeof r.configHash !== 'string') return null;
    if (!Array.isArray(r.origins) || !r.origins.length) return null;
    if (!r.metrics || !r.metrics.mean || !r.metrics.worst) return null;
    return {
      schema: 1,
      appVersion: typeof r.appVersion === 'string' ? r.appVersion : '3.0.0',
      algorithmVersion: 'lab-1',
      datasetVersion: typeof r.datasetVersion === 'string' ? r.datasetVersion : '',
      createdAt: isFiniteNumber(r.createdAt) ? r.createdAt : 0,
      config: r.config,
      configHash: r.configHash,
      origins: r.origins,
      metrics: r.metrics,
      baseline: typeof r.baseline === 'string' ? r.baseline : '',
      intervalMeta: r.intervalMeta || null,
      durationMs: isFiniteNumber(r.durationMs) ? r.durationMs : 0
    };
  }

  function list() {
    var raw = core.readJSON(KEY, [], function (v) { return Array.isArray(v); });
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var rec = normalizeRecord(raw[i]);
      if (rec) out.push(rec);
    }
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return out;
  }

  function save(record) {
    var rec = normalizeRecord(record);
    if (!rec) return { ok: false, error: '记录不合法，未保存' };
    var arr = list().filter(function (x) { return x.configHash !== rec.configHash; });
    arr.unshift(rec);
    while (arr.length > MAX) arr.pop();
    core.writeJSON(KEY, arr);
    return { ok: true, count: arr.length };
  }

  function clear() {
    core.writeJSON(KEY, []);
  }

  function exportJSON(record) {
    var rec = normalizeRecord(record);
    if (!rec) return null;
    return JSON.stringify({
      app: 'tsoj-lab',
      schema: 1,
      exportedAt: Date.now(),
      record: rec
    }, null, 2);
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) {
      return { ok: false, error: '不是合法 JSON' };
    }
    if (!data || data.app !== 'tsoj-lab') return { ok: false, error: '不是 TSOJ 实验文件' };
    if (data.schema !== 1) return { ok: false, error: 'schema 不支持：' + data.schema };
    var rec = normalizeRecord(data.record);
    if (!rec) return { ok: false, error: '记录字段不完整或算法版本不匹配' };
    var res = save(rec);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, record: rec, count: res.count };
  }

  TSJ.appLabStorage = {
    MAX: MAX,
    list: list,
    save: save,
    clear: clear,
    exportJSON: exportJSON,
    importJSON: importJSON,
    normalizeRecord: normalizeRecord
  };
})(typeof window !== 'undefined' ? window : this);
