/**
 * chart.js —— 纯 Canvas 折线图 + 指针悬停读数
 *
 * drawSeries(canvas, { values, testStart, predictions, height, unit })
 *   - values      完整序列（历史 + 测试区间）
 *   - testStart   测试区间起点下标（画半透明高亮带）
 *   - predictions 预测值数组（从 testStart 开始，与测试区间重叠绘制）
 *   - height      CSS 高度（px），宽度自适应父容器
 *
 * 画完会把几何信息挂到 canvas.__tsjGeom（xOf / yOf / n / testStart / values / predictions / padL / padR），
 * 供 attachChartHover 做「最近索引」反查 —— 这样 hover 逻辑不需要知道任何绘制细节。
 *
 * 特性：devicePixelRatio 适配、水平网格线 + y 轴刻度、虚线预测、窗口 resize 自动重绘、指针悬停十字线 + tooltip。
 * 挂载点：window.TSJ.drawSeries / TSJ.attachChartHover
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
    bandEdgeHot: 'rgba(45, 212, 191, 0.75)',
    predict: '#a5b4fc',
    actual: '#8a97a8',
    cross: 'rgba(165, 180, 252, 0.55)',
    tipBg: 'rgba(8, 12, 17, 0.94)',
    tipBorder: 'rgba(139, 156, 255, 0.45)'
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
   * 真正的绘制过程。绘制结束时把几何信息写入 canvas.__tsjGeom。
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
    if (n === 0) {
      canvas.__tsjGeom = null;
      return;
    }

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

    var testStart = (typeof opts.testStart === 'number') ? opts.testStart : n;

    // ---- 测试区间高亮带 ----
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

    // ---- 几何信息（hover 反查用）----
    canvas.__tsjGeom = {
      xOf: xOf,
      yOf: yOf,
      n: n,
      testStart: testStart,
      values: values,
      predictions: preds,
      padL: PAD.left,
      padR: PAD.right,
      plotW: plotW,
      plotH: plotH,
      height: height,
      width: cssWidth,
      span: span
    };
  }

  /**
   * 在已绘制的图上叠加「十字线 + tooltip」。
   * @param {HTMLCanvasElement} canvas 画布
   * @param {Object} g canvas.__tsjGeom
   * @param {number} idx 最近索引
   */
  function drawHover(canvas, g, idx) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var dpr = global.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var x = g.xOf(idx);
    var v = g.values[idx];
    var y = g.yOf(v);
    var inTest = idx >= g.testStart;
    var pIdx = idx - g.testStart;
    var hasPred = g.predictions && pIdx >= 0 && pIdx < g.predictions.length;
    var predVal = hasPred ? g.predictions[pIdx] : null;

    // 测试区间描边加重（让「哪一段是考你的」一眼可见）
    if (g.testStart < g.n) {
      var bx = g.xOf(Math.max(0, g.testStart));
      ctx.strokeStyle = inTest ? COLOR.bandEdgeHot : COLOR.bandEdge;
      ctx.lineWidth = inTest ? 2 : 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(bx) + 0.5, PAD.top);
      ctx.lineTo(Math.round(bx) + 0.5, PAD.top + g.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 十字线
    ctx.strokeStyle = COLOR.cross;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, PAD.top);
    ctx.lineTo(Math.round(x) + 0.5, PAD.top + g.plotH);
    ctx.moveTo(PAD.left, Math.round(y) + 0.5);
    ctx.lineTo(PAD.left + g.plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // 真值点
    ctx.fillStyle = COLOR.actual;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // 预测点
    if (hasPred) {
      ctx.fillStyle = COLOR.predict;
      ctx.beginPath();
      ctx.arc(x, g.yOf(predVal), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // tooltip
    var lines = [
      '#' + idx + (inTest ? ' · 测试区间' : ' · 历史'),
      '真值 ' + axisLabel(v, g.span)
    ];
    if (hasPred) {
      lines.push('预测 ' + axisLabel(predVal, g.span));
      lines.push('差值 ' + (predVal - v >= 0 ? '+' : '') + axisLabel(predVal - v, g.span));
    }

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    var boxW = 0;
    var i;
    for (i = 0; i < lines.length; i++) boxW = Math.max(boxW, ctx.measureText(lines[i]).width);
    boxW += 16;
    var boxH = lines.length * 15 + 10;
    var bxPos = x + 12;
    if (bxPos + boxW > PAD.left + g.plotW) bxPos = x - 12 - boxW;
    if (bxPos < PAD.left) bxPos = PAD.left + 2;
    var byPos = Math.max(PAD.top, Math.min(y - boxH / 2, PAD.top + g.plotH - boxH));

    ctx.fillStyle = COLOR.tipBg;
    ctx.strokeStyle = COLOR.tipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bxPos, byPos, boxW, boxH, 6);
    else ctx.rect(bxPos, byPos, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#c8d4e0' : (i === 3 ? COLOR.predict : '#a5b2c1');
      ctx.fillText(lines[i], bxPos + 8, byPos + 6 + i * 15);
    }
    return { index: idx, lines: lines, values: { actual: v, predicted: predVal } };
  }

  /**
   * 给图表挂上指针悬停读数。
   * 返回的 destroy() 必须被调用（路由切换时），否则 pointermove 监听会累积。
   *
   * @param {HTMLCanvasElement} canvas 画布
   * @returns {{destroy: Function, index: Function}} 句柄
   */
  function attachChartHover(canvas) {
    if (!canvas || typeof canvas.addEventListener !== 'function') {
      return { destroy: function () {}, index: function () { return -1; }, tip: function () { return null; } };
    }
    var idx = -1;
    var destroyed = false;
    /** 最近一次 tooltip 的内容（供测试与调试读取；移出画布后为 null） */
    var lastTip = null;

    /** 重绘：先画基础图，再叠加 hover 层。 */
    function redraw() {
      if (destroyed) return;
      var opts = canvas.__tsjChart;
      if (!opts) return;
      paint(canvas, opts);
      var g = canvas.__tsjGeom;
      if (!g || g.n === 0 || idx < 0 || idx >= g.n) {
        lastTip = null;
        return;
      }
      lastTip = drawHover(canvas, g, idx);
    }

    /** 指针移动：找最近索引。 */
    function onMove(ev) {
      var g = canvas.__tsjGeom;
      if (!g || g.n === 0) return;
      var rect = canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var lo = g.padL - 6;
      var hi = g.padL + g.plotW + 6;
      if (x < lo || x > hi) {
        if (idx !== -1) { idx = -1; redraw(); }
        return;
      }
      var raw = g.n <= 1 ? 0 : ((x - g.padL) / g.plotW) * (g.n - 1);
      var next = Math.round(raw);
      if (next < 0) next = 0;
      if (next > g.n - 1) next = g.n - 1;
      if (next !== idx) { idx = next; redraw(); }
    }

    /** 指针离开：隐藏十字线。 */
    function onLeave() {
      if (idx === -1) return;
      idx = -1;
      redraw();
    }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onLeave);

    return {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('pointercancel', onLeave);
        idx = -1;
        // 把 hover 层擦掉，只留基础图
        var opts = canvas.__tsjChart;
        if (opts) paint(canvas, opts);
      },
      index: function () { return idx; },
      /** 当前 tooltip 内容：{ index, lines, values } 或 null */
      tip: function () { return lastTip; }
    };
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
  TSJ.attachChartHover = attachChartHover;
  TSJ.redrawCharts = redrawAll;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      drawSeries: drawSeries,
      attachChartHover: attachChartHover,
      redrawCharts: redrawAll
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
