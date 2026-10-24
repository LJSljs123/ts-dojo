/**
 * assets/js/app/schema.js —— 字段归一化：把「不可信的存储值」变成「可信的内存值」
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → app.js
 * 挂载点：window.TSJ.appSchema
 *
 * 为什么单独一个文件：localStorage 在 file:// 下是共享的不透明源，同目录任意页面都能写入，
 * 所以「读出来 → 逐字段归一化」是应用层最需要被审计的一段逻辑，独立成文件便于审查与回归。
 * 归一化只做三件事：类型收敛、取值夹取、丢弃非法结构；**不做**业务判断（通过线除外）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;

  /** 允许出现在提交记录里的 verdict 取值 */
  var VERDICTS = ['AC', 'WA', 'RE', 'TLE'];

  /**
   * 归一化 verdict：白名单外一律 WA。
   * @param {*} v 原始值
   * @returns {string}
   */
  function normVerdict(v) {
    var u = core.toText(v).toUpperCase();
    return VERDICTS.indexOf(u) >= 0 ? u : 'WA';
  }

  /**
   * 归一化进度表：只保留「纯对象」记录，并把每个字段强制成安全类型。
   *
   * `passed` 额外做一致性校验：必须同时满足「记录里标记为 true」与「最高分达到该题通过线」。
   * 否则一条被篡改成 `{best: "<img ...>", passed: true}` 的记录会在界面上显示成
   * 「已通过 · 最高分 0」并解锁题解 —— 归一化后 best=0，passed 自然回落为 false。
   *
   * @param {*} raw readJSON 读出的原始值
   * @returns {Object} { [problemId]: { best, passed, attempts, lastVerdict, lastAt } }
   */
  function normalizeProgress(raw) {
    var out = {};
    if (!core.isPlainObject(raw)) return out;
    var ids = Object.keys(raw);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var rec = raw[id];
      if (!core.isPlainObject(rec)) continue;
      var best = core.toScore(rec.best);
      var passLine = 60;
      var prob = TSJ.findProblem(id);
      if (prob && prob.passScore > 0) passLine = prob.passScore;
      out[id] = {
        best: best,
        passed: rec.passed === true && best >= passLine,
        attempts: core.toCount(rec.attempts),
        lastVerdict: core.toText(rec.lastVerdict),
        lastAt: core.toTime(rec.lastAt)
      };
    }
    return out;
  }

  /**
   * 归一化草稿表：只保留字符串值（代码），其余丢弃。
   * @param {*} raw 原始值
   * @returns {Object} { [problemId]: code }
   */
  function normalizeDrafts(raw) {
    var out = {};
    if (!core.isPlainObject(raw)) return out;
    var ids = Object.keys(raw);
    for (var i = 0; i < ids.length; i++) {
      var code = raw[ids[i]];
      if (typeof code === 'string') out[ids[i]] = code;
    }
    return out;
  }

  /**
   * 归一化逐测试点明细（提交详情用）。
   * @param {*} raw 原始数组
   * @returns {Array<Object>} [{ index, verdict, score, yourMetric, bestBaseline, baselineName }]
   */
  function normalizeCases(raw) {
    var out = [];
    if (!core.isArrayValue(raw)) return out;
    var n = Math.min(raw.length, core.MAX_CASES);
    for (var i = 0; i < n; i++) {
      var c = raw[i];
      if (!core.isPlainObject(c)) continue;
      out.push({
        index: core.toCount(c.index),
        verdict: normVerdict(c.verdict),
        score: core.toScore(c.score),
        yourMetric: core.toMetric(c.yourMetric),
        bestBaseline: core.toMetric(c.bestBaseline),
        baselineName: core.toText(c.baselineName)
      });
    }
    return out;
  }

  /**
   * 归一化提交记录：必须是数组，逐项校验并强制类型。
   * 缺少 id 的旧记录（T05 之前的格式）按「legacy-时间-题号-序号」补一个稳定 id，保证详情路由可访问。
   *
   * @param {*} raw 原始数组
   * @returns {Array<Object>}
   */
  function normalizeSubmissions(raw) {
    var out = [];
    if (!core.isArrayValue(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!core.isPlainObject(s)) continue;
      var at = core.toTime(s.at);
      var pid = core.toText(s.problemId);
      var id = core.toText(s.id);
      if (!id) id = 'legacy-' + at + '-' + (pid || 'unknown') + '-' + i;
      out.push({
        id: id,
        at: at,
        problemId: pid,
        title: core.toText(s.title),
        score: core.toScore(s.score),
        verdict: normVerdict(s.verdict),
        passed: s.passed === true,
        metric: core.toText(s.metric),
        code: core.truncateCode(s.code),
        cases: normalizeCases(s.cases),
        degraded: s.degraded === true
      });
    }
    return out;
  }

  TSJ.appSchema = {
    VERDICTS: VERDICTS,
    normVerdict: normVerdict,
    normalizeProgress: normalizeProgress,
    normalizeDrafts: normalizeDrafts,
    normalizeCases: normalizeCases,
    normalizeSubmissions: normalizeSubmissions
  };
})(typeof window !== 'undefined' ? window : this);
