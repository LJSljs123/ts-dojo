/**
 * assets/js/app/storage-extras.js —— v2 全量备份的 extras 合并层（v3.9）
 * 加载顺序：… app/storage → app/storage-extras → app/lifecycle
 * 挂载点：window.TSJ.appStorageExtras
 *
 * storage.js 负责导出时收集 extras 与导入时结构白名单；本模块负责「合并落盘」——
 * 各键用各自模块的归一化器深校验（appLabStorage / appStudioStorage 运行时才引用，
 * 它们加载顺序晚于本文件，函数体内访问没有问题）。
 * 合并策略：object 键浅合并（导入覆盖同名）；数组键按 id/configHash 去重取新；
 * 字符串键导入值优先。全部写失败静默（与 writeJSON 语义一致）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;

  function mergeExtras(extras) {
    var merged = 0;
    var lab = TSJ.appLabStorage, studio = TSJ.appStudioStorage;

    // 课程进度：浅合并（导入覆盖同名课程）
    if (core.isPlainObject(extras[core.STORE.courseProgress])) {
      var cur = core.readJSON(core.STORE.courseProgress, {}, core.isPlainObject);
      var inc = extras[core.STORE.courseProgress];
      for (var cid in inc) {
        if (Object.prototype.hasOwnProperty.call(inc, cid)) cur[cid] = inc[cid];
      }
      core.writeJSON(core.STORE.courseProgress, cur);
      merged++;
    }
    // 成就：按最早解锁时间合并（先解锁的算数）
    if (core.isPlainObject(extras[core.STORE.achievements])) {
      var ach = core.readJSON(core.STORE.achievements, {}, core.isPlainObject);
      var incA = extras[core.STORE.achievements];
      for (var aid in incA) {
        if (!Object.prototype.hasOwnProperty.call(incA, aid)) continue;
        var t = Number(incA[aid]);
        if (!isFinite(t) || t <= 0) continue;
        if (!isFinite(Number(ach[aid])) || t < Number(ach[aid])) ach[aid] = t;
      }
      core.writeJSON(core.STORE.achievements, ach);
      merged++;
    }
    // achMeta：方法浏览并集 + 查阅次数取大
    if (core.isPlainObject(extras[core.STORE.achMeta])) {
      var meta = core.readJSON(core.STORE.achMeta, { methods: [], looks: 0 }, core.isPlainObject);
      var incM = extras[core.STORE.achMeta];
      if (core.isArrayValue(incM.methods)) {
        for (var k = 0; k < incM.methods.length; k++) {
          if (meta.methods.indexOf(incM.methods[k]) < 0) meta.methods.push(incM.methods[k]);
        }
      }
      if (Number(incM.looks) > Number(meta.looks)) meta.looks = Number(incM.looks);
      core.writeJSON(core.STORE.achMeta, meta);
      merged++;
    }
    // 实验室记录：按 configHash 去重，createdAt 新者胜
    if (core.isArrayValue(extras[core.STORE.lab]) && lab) {
      var curLab = {};
      lab.list().forEach(function (r) { curLab[r.configHash] = r; });
      extras[core.STORE.lab].forEach(function (raw) {
        var r = lab.normalizeRecord(raw);
        if (!r) return;
        var oldR = curLab[r.configHash];
        if (!oldR || (r.createdAt || 0) >= (oldR.createdAt || 0)) curLab[r.configHash] = r;
      });
      var mergedLab = Object.keys(curLab).map(function (h) { return curLab[h]; });
      mergedLab.sort(function (x, y) { return (y.createdAt || 0) - (x.createdAt || 0); });
      while (mergedLab.length > lab.MAX) mergedLab.pop();
      core.writeJSON(core.STORE.lab, mergedLab);
      merged++;
    }
    // 工坊实验：按 id 去重，at 新者胜
    if (core.isArrayValue(extras[core.STORE.studioExp]) && studio) {
      var curExp = {};
      studio.list().forEach(function (r) { curExp[r.id] = r; });
      extras[core.STORE.studioExp].forEach(function (raw) {
        var r = studio.normalizeRecord(raw);
        if (!r) return;
        var oldE = curExp[r.id];
        if (!oldE || (r.at || 0) >= (oldE.at || 0)) curExp[r.id] = r;
      });
      var mergedExp = Object.keys(curExp).map(function (i) { return curExp[i]; });
      mergedExp.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      while (mergedExp.length > studio.MAX) mergedExp.pop();
      core.writeJSON(core.STORE.studioExp, mergedExp);
      merged++;
    }
    // 字符串草稿与上传 CSV：导入值优先
    [core.STORE.labDraft, core.STORE.studioDraft].forEach(function (k) {
      if (typeof extras[k] === 'string') { core.writeJSON(k, extras[k]); merged++; }
    });
    var csv = extras[core.STORE.studioCsv];
    if (core.isPlainObject(csv) && core.isArrayValue(csv.values)) {
      // 消毒：导入的备份 values 可能被手改成垃圾——只留有限数值并截到 5000 点
      csv = {
        values: csv.values.filter(function (x) { return typeof x === 'number' && isFinite(x); }).slice(0, 5000),
        name: typeof csv.name === 'string' ? csv.name.slice(0, 24) : '我的数据',
        season: typeof csv.season === 'number' && csv.season > 1 ? Math.round(csv.season) : 1
      };
      core.writeJSON(core.STORE.studioCsv, csv);
      if (TSJ.appStudioCsv) TSJ.appStudioCsv.restore();   // 重新注册进 TSJ.datasets（替换同名临时集）
      merged++;
    }
    return merged;
  }

  TSJ.appStorageExtras = { mergeExtras: mergeExtras };

  // 自注册到 storage（其加载早于本文件，通过注入点解除静态依赖）
  if (TSJ.appStorage && typeof TSJ.appStorage.setExtrasMerger === 'function') {
    TSJ.appStorage.setExtrasMerger(mergeExtras);
  }
})(typeof window !== 'undefined' ? window : this);
