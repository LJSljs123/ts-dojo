/**
 * assets/js/app/problem-extras.js —— 题目页的辅助区块（不参与判题）
 *
 * 两块内容：
 *   1. 分量预览：`markupParts(ds)` 出 DOM，`paintParts(view, p, ds)` 画图。
 *      P18 这类「总量里藏了两个周期」的题，总量图上两个周期是叠在一起的，
 *      不拆开就看不见——预览图是题面的证据，不是装饰。
 *   2. 相关链接：`markupRelated(p)`。方法库有「去练这道题」（method.practice → 题目），
 *      题目页却没有任何路回到方法卡或课程，是个死胡同。这里用同一份数据把回路补上。
 *
 * 单独成文件的原因：这两块都是「题面之外的辅助内容」，塞在 problem.js 里会把它顶到
 * 350 行可维护性上限（曾到 357 行）。抽出来之后 problem.js 只留两行调用。
 *
 * 加载顺序：… → app/views.js → app/problem-extras.js → app/problem.js
 * 挂载点：window.TSJ.appProblemExtras
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;

  var $ = core.$;
  var esc = core.esc;

  /** 分量预览只画最近这么多点：730 点挤进 300px，周节律会糊成一条实心带。140 = 20 个整周。 */
  var PART_WINDOW = 140;

  /**
   * 分量预览的 DOM。数据集没有 `parts` 时返回空串（大多数题走这条路）。
   * @param {Object} ds 数据集
   * @returns {string}
   */
  function markupParts(ds) {
    if (!ds || !ds.parts || !ds.parts.length) return '';
    var cells = ds.parts.map(function (x, i) {
      return '<div class="part-cell"><div class="part-name">' + esc(x.name) + ' · 周期 ' + x.period +
        '</div><canvas class="chart-canvas part-chart" data-part="' + i + '" height="120"></canvas></div>';
    });
    return '    <div class="parts-head">分量预览 · 最近 ' + PART_WINDOW +
      ' 天（右端高亮为测试区间）</div><div class="parts-strip">' + cells.join('') + '</div>';
  }

  /**
   * 画分量预览。只画形状、不挂 hover：交互主体是上面那张总量图。
   * @param {Element} view 题目页根节点
   * @param {Object} p 题目
   * @param {Object} ds 数据集
   */
  function paintParts(view, p, ds) {
    var strip = $('.parts-strip', view);
    if (!strip || !ds || !ds.parts || typeof TSJ.drawParts !== 'function') return;
    TSJ.drawParts(strip, ds.parts, {
      testStart: ds.values.length - p.horizon,
      window: PART_WINDOW
    });
  }

  /**
   * 相关链接：本题的方法卡 + 课程。
   * 两条映射都从已有数据现算，不新增任何 schema：
   *   - 方法 → 题目：`method.practice === problem.id`
   *   - 课程 → 题目：`course.exercise.problemIds` 里含 problem.id
   * @param {Object} p 题目
   * @returns {string} 无关联时返回空串
   */
  function markupRelated(p) {
    var methods = (TSJ.methods || []).filter(function (m) { return m.practice === p.id; });
    var courses = (TSJ.courses || []).filter(function (c) {
      return ((c.exercise && c.exercise.problemIds) || []).indexOf(p.id) >= 0;
    });
    if (!methods.length && !courses.length) return '';
    var chips = methods.map(function (m) {
      return '<a class="rel-chip" href="#/methods/' + m.id + '">' + esc(m.name) + '</a>';
    });
    courses.forEach(function (c) {
      chips.push('<a class="rel-chip rel-chip-course" href="#/learn/' + c.id + '">' +
        esc('m' + c.index + ' ' + c.title) + '</a>');
    });
    return '  <div class="rel-box"><span class="rel-label">继续深入</span>' + chips.join('') + '</div>';
  }

  TSJ.appProblemExtras = {
    markupParts: markupParts,
    paintParts: paintParts,
    markupRelated: markupRelated
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TSJ.appProblemExtras;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
