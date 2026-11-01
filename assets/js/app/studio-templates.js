/**
 * assets/js/app/studio-templates.js —— 模型工坊示例模板（v3.11）
 * 加载顺序：… app/studio-csv → app/studio-templates → app/studio.js
 * 挂载点：window.TSJ.appStudioTemplates
 *
 * 模板是数据不是逻辑：从 studio.js 拆出来让工坊主文件守住 350 行。
 * STARTER 教「训练写在 predict 里」；COV 教「协变量怎么进模型」（配合 ctx.promoDays）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 基础示例：SES + 网格搜索 α（只用 history 内部做一步回测选参）。 */
  var STARTER = [
    'function predict(history, horizon, ctx) {',
    '  // 你的模型：在 history 上「训练」，再预测 horizon 步。',
    '  // 示例：SES + 网格搜索 α（只用 history 内部做一步回测选参，绝不碰 val/test）',
    '  var best = { a: 0.3, err: Infinity };',
    '  for (var a = 0.05; a <= 0.95; a += 0.05) {',
    '    var err = 0, level = history[0];',
    '    for (var i = 1; i < history.length - 1; i++) {',
    '      var oneStep = level;                    // 用 i 之前的状态预测 i',
    '      level = a * history[i] + (1 - a) * level;',
    '      err += Math.pow(history[i + 1] - oneStep, 2);',
    '    }',
    '    if (err < best.err) best = { a: a, err: err };',
    '  }',
    '  var level = history[0];                     // 用选好的 α 在全部 history 上重新平滑',
    '  for (var j = 1; j < history.length; j++) level = best.a * history[j] + (1 - best.a) * level;',
    '  var out = [];',
    '  for (var h = 0; h < horizon; h++) out.push(level);',
    '  return out;',
    '}'
  ].join('\n');

  /**
   * 协变量示例：季节朴素 × 促销提升系数（retail_daily + ctx.promoDays）。
   * 教三件事：未来促销日是已知信息（直接查表）；提升系数从历史估（不拍脑袋）；
   * history 下标就是绝对天序，ctx.promoDays 与它对齐。
   */
  var COV = [
    'function predict(history, horizon, ctx) {',
    '  var m = ctx.season > 1 ? ctx.season : 7;',
    '  var promo = ctx.promoDays || [];            // 已知促销日历（绝对下标，含未来）',
    '  var n = history.length;                     // history[i] 就是序列第 i 天',
    '',
    '  // 1) 从历史估「促销提升系数」：促销日均量 ÷ 非促销日均量（不是拍脑袋）',
    '  var promoSum = 0, promoN = 0, baseSum = 0, baseN = 0;',
    '  for (var i = 0; i < n; i++) {',
    '    if (promo.indexOf(i) >= 0) { promoSum += history[i]; promoN++; }',
    '    else { baseSum += history[i]; baseN++; }',
    '  }',
    '  var lift = (promoN > 0 && baseN > 0 && baseSum > 0) ? (promoSum / promoN) / (baseSum / baseN) : 1;',
    '  if (lift < 1) lift = 1;                     // 促销不会压低销量：钳到 ≥1',
    '  if (lift > 5) lift = 5;                     // 防极端样本把系数带飞',
    '',
    '  // 2) 基线：上周同日（季节朴素），再按未来各日是否促销乘上提升系数',
    '  var out = [];',
    '  for (var h = 1; h <= horizon; h++) {',
    '    var abs = n + h - 1;                      // 未来这一天的绝对下标',
    '    var base = history[n - m + ((abs % m) + m) % m];   // 上周同日',
    '    out.push(base * (promo.indexOf(abs) >= 0 ? lift : 1));',
    '  }',
    '  return out;',
    '}'
  ].join('\n');

  TSJ.appStudioTemplates = { STARTER: STARTER, COV: COV };
})(typeof window !== 'undefined' ? window : this);
