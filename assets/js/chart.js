/**
 * chart.js —— 纯 Canvas 折线图
 *
 * drawSeries(canvas, { values, testStart, predictions, height, unit })
 *   - values      完整序列（历史 + 测试区间）
 *   - testStart   测试区间起点下标（画半透明高亮带）
 *   - predictions 预测值数组（从 testStart 开始，与测试区间重叠绘制）
 *   - height      CSS 高度（px），宽度自适应父容器
 *
 * 特性：devicePixelRatio 适配、3~5 条水平网格线 + y 轴刻度、虚线预测、窗口 resize 自动重绘。
 * 挂载点：window.TSJ.drawSeries
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  var COLOR = {
    bg: '#131a22',
    grid: '#1f2833',
    axis: '#2a3542',
    text: '#6f7d8d',
    history: '#3fb6a8',
    band: 'rgba(45, 212, 191, 0.09)',
    bandEdge: 'rgba(45, 212, 191, 0.35)',
    predict: '#a5b4fc',
    actual: '#8a97a8'
  };

  var PAD = { left: 52, right: 14, top: 12, bottom: 20 };
  var DEFAULT_HEIGHT = 180;

  /**
   * 把数值格式化成适合坐标轴显示的短标签。
   * @param {number} v 值
   * @param {number} span 值域跨度
   * @returns {string}
   */
  function axisLabel(v, span) {
    var a = Math.abs(v);
    if (span >= 10000 || a >= 10000) return (v / 1000).toFixed(span >= 100000 ? 0 : 1) + 'k';
    if (span >= 100) return v.toFixed(0);
    if (span >= 10) return v.toFixed(1);
    if (span >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  /**
   * 绘制折线图。
   * @param {HTMLCanvasElement} canvas 画布
   * @param {Object} opts 配置
   */
  function drawSeries(canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    var options = opts || {};
    canvas.__tsjChart = options;
    canvas.setAttribute('data-tsj-chart', '1');
    paint(canvas, options);
  }

  /**
   * 真正的绘制过程。
   * @param {HTMLCanvasElement} canvas 画布
   * @param {Object} opts 配置
   */
  function paint(canvas, opts) {
    var values = opts.values || [];
    var preds = opts.predictions || null;
    var height = opts.height || DEFAULT_HEIGHT;
    var dpr = global.devicePixelRatio || 1;

    var cssWidth = canvas.clientWidth || canvas.parentNode && canvas.parentNode.clientWidth || 520;
    if (cssWidth <= 0) cssWidth = 520;

    canvas.style.height = height + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    // 背景
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, cssWidth, height);

    var plotW = Math.max(1, cssWidth - PAD.left - PAD.right);
    var plotH = Math.max(1, height - PAD.top - PAD.bottom);
    var n = values.length;
    if (n === 0) return;

    // ---- 值域 ----
    var min = Infinity;
    var max = -Infinity;
    var i;
    for (i = 0; i < n; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    if (preds) {
      for (i = 0; i < preds.length; i++) {
        if (preds[i] < min) min = preds[i];
        if (preds[i] > max) max = preds[i];
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max - min < 1e-9) { max = min + 1; min = min - 1; }
    var span = max - min;
    var yMin = min - span * 0.08;
    var yMax = max + span * 0.08;
    var ySpan = yMax - yMin;

    /**
     * x 坐标：按下标映射。
     * @param {number} idx 下标
     * @returns {number}
     */
    function xOf(idx) {
      if (n <= 1) return PAD.left + plotW / 2;
      return PAD.left + (idx / (n - 1)) * plotW;
    }

    /**
     * y 坐标：按值映射。
     * @param {number} v 值
     * @returns {number}
     */
    function yOf(v) {
      return PAD.top + plotH - ((v - yMin) / ySpan) * plotH;
    }

    // ---- 测试区间高亮带 ----
    var testStart = (typeof opts.testStart === 'number') ? opts.testStart : n;
    if (testStart < n) {
      var bx = xOf(Math.max(0, testStart));
      ctx.fillStyle = COLOR.band;
      ctx.fillRect(bx, PAD.top, PAD.left + plotW - bx, plotH);
      ctx.strokeStyle = COLOR.bandEdge;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(bx) + 0.5, PAD.top);
      ctx.lineTo(Math.round(bx) + 0.5, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- 水平网格线 + y 轴刻度 ----
    var gridCount = 4;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= gridCount; g++) {
      var ratio = g / gridCount;
      var y = PAD.top + plotH * (1 - ratio);
      ctx.strokeStyle = COLOR.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillStyle = COLOR.text;
      ctx.fillText(axisLabel(yMin + ySpan * ratio, span), PAD.left - 8, y);
    }

    // ---- x 轴 ----
    ctx.strokeStyle = COLOR.axis;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top + plotH + 0.5);
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH + 0.5);
    ctx.stroke();

    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'left';
    ctx.fillText('0', PAD.left, height - 8);
    ctx.textAlign = 'right';
    ctx.fillText(String(n - 1), PAD.left + plotW, height - 8);
    if (testStart > 0 && testStart < n) {
      ctx.textAlign = 'center';
      ctx.fillText('测试区间', xOf(testStart) + (PAD.left + plotW - xOf(testStart)) / 2, height - 8);
    }

    // ---- 历史折线 ----
    var histEnd = Math.min(n, testStart);
    ctx.strokeStyle = COLOR.history;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (i = 0; i < histEnd; i++) {
      var hx = xOf(i);
      var hy = yOf(values[i]);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.stroke();

    // ---- 测试区间真实值（淡色）----
    if (testStart < n) {
      ctx.strokeStyle = COLOR.actual;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (i = Math.max(0, testStart - 1); i < n; i++) {
        var ax = xOf(i);
        var ay = yOf(values[i]);
        if (i === Math.max(0, testStart - 1)) ctx.moveTo(ax, ay);
        else ctx.lineTo(ax, ay);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- 预测折线（虚线强调色）----
    if (preds && preds.length > 0) {
      ctx.strokeStyle = COLOR.predict;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      var anchor = Math.max(0, testStart - 1);
      ctx.moveTo(xOf(anchor), yOf(values[anchor]));
      for (i = 0; i < preds.length; i++) {
        var px = xOf(testStart + i);
        if (px > PAD.left + plotW) break;
        ctx.lineTo(px, yOf(preds[i]));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // 预测点
      ctx.fillStyle = COLOR.predict;
      for (i = 0; i < preds.length; i++) {
        var cx = xOf(testStart + i);
        if (cx > PAD.left + plotW) break;
        ctx.beginPath();
        ctx.arc(cx, yOf(preds[i]), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 重绘页面上所有图表（窗口尺寸变化时调用）。
   */
  function redrawAll() {
    if (typeof document === 'undefined') return;
    var list = document.querySelectorAll('canvas[data-tsj-chart]');
    for (var i = 0; i < list.length; i++) {
      var canvas = list[i];
      if (canvas.__tsjChart && canvas.clientWidth > 0) {
        paint(canvas, canvas.__tsjChart);
      }
    }
  }

  var resizeTimer = 0;
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('resize', function () {
      if (resizeTimer) global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(redrawAll, 110);
    });
  }

  TSJ.drawSeries = drawSeries;
  TSJ.redrawCharts = redrawAll;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { drawSeries: drawSeries, redrawCharts: redrawAll };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
