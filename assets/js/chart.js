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

  /* 深色兜底色板：正常情况下每次绘制都从 CSS 变量读取（跟随深浅主题），
     只有在无 DOM / 变量缺失时才用这里的硬编码值。 */
  var FALLBACK = {
    bg: 'transparent',
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
    tipBorder: 'rgba(139, 156, 255, 0.45)',
    tipText: '#a5b2c1',
    tipTitle: '#c8d4e0'
  };

  /** 读取文档根上的 CSS 变量（主题切换后取值自动跟随）。 */
  function cssVar(name, fallback) {
    if (!global.document || !global.document.documentElement || !global.getComputedStyle) return fallback;
    var v = global.getComputedStyle(global.document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  /** 读取带透明度的 CSS 颜色变量：tokens 里没有的衍生色（区间带等）按主题手动给出。 */
  function palette() {
    var light = !!(global.document && global.document.documentElement &&
      global.document.documentElement.getAttribute('data-theme') === 'light');
    return {
      bg: FALLBACK.bg,
      grid: cssVar('--v3-chart-grid', FALLBACK.grid),
      axis: cssVar('--v3-line', FALLBACK.axis),
      text: cssVar('--v3-chart-axis', FALLBACK.text),
      history: cssVar('--v3-chart-history', FALLBACK.history),
      band: light ? 'rgba(3, 105, 161, 0.08)' : 'rgba(45, 212, 191, 0.09)',
      bandEdge: light ? 'rgba(3, 105, 161, 0.45)' : FALLBACK.bandEdge,
      bandEdgeHot: light ? 'rgba(3, 105, 161, 0.85)' : FALLBACK.bandEdgeHot,
      predict: cssVar('--v3-chart-pred', FALLBACK.predict),
      actual: cssVar('--v3-chart-actual', FALLBACK.actual),
      cross: light ? 'rgba(3, 105, 161, 0.5)' : FALLBACK.cross,
      tipBg: light ? 'rgba(255, 255, 255, 0.96)' : FALLBACK.tipBg,
      tipBorder: light ? 'rgba(3, 105, 161, 0.35)' : FALLBACK.tipBorder,
      tipText: light ? '#475569' : FALLBACK.tipText,
      tipTitle: light ? '#0f172a' : FALLBACK.tipTitle,
      font: cssVar('--v3-mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
    };
  }

  var PAD = { left: 52, right: 14, top: 14, bottom: 22 };
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
   * 「整洁刻度」：把值域扩展到 1/2/5×10^k 的整数倍，让网格线落在好读的数字上。
   * @param {number} rawMin 数据最小值（已含少量呼吸空间）
   * @param {number} rawMax 数据最大值
   * @returns {{min:number, max:number}} 对齐后的值域
   */
  function niceDomain(rawMin, rawMax) {
    var span = rawMax - rawMin;
    if (!(span > 0) || !isFinite(span)) return { min: rawMin, max: rawMax };
    var step = Math.pow(10, Math.floor(Math.log(span / 4) / Math.LN10));
    var err = span / 4 / step;
    var mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    step *= mult;
    return {
      min: Math.floor(rawMin / step) * step,
      max: Math.ceil(rawMax / step) * step
    };
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
    var C = palette();

    var cssWidth = canvas.clientWidth || canvas.parentNode && canvas.parentNode.clientWidth || 520;
    if (cssWidth <= 0) cssWidth = 520;

    canvas.style.height = height + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    var plotW = Math.max(1, cssWidth - PAD.left - PAD.right);
    var plotH = Math.max(1, height - PAD.top - PAD.bottom);
    var n = values.length;
    if (n === 0) {
      canvas.__tsjGeom = null;
      return;
    }

    // ---- 值域（对齐整洁刻度） ----
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
    var dom = niceDomain(min - (max - min) * 0.04, max + (max - min) * 0.04);
    var yMin = dom.min;
    var yMax = dom.max;
    var ySpan = yMax - yMin || 1;
    var span = max - min;

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
      ctx.fillStyle = C.band;
      ctx.fillRect(bx, PAD.top, PAD.left + plotW - bx, plotH);
      ctx.strokeStyle = C.bandEdge;
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
    ctx.font = '11px ' + C.font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= gridCount; g++) {
      var ratio = g / gridCount;
      var y = PAD.top + plotH * (1 - ratio);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillStyle = C.text;
      ctx.fillText(axisLabel(yMin + ySpan * ratio, span), PAD.left - 8, y);
    }

    // ---- x 轴 ----
    ctx.strokeStyle = C.axis;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top + plotH + 0.5);
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH + 0.5);
    ctx.stroke();

    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.fillText('0', PAD.left, height - 8);
    ctx.textAlign = 'right';
    ctx.fillText(String(n - 1), PAD.left + plotW, height - 8);
    if (testStart > 0 && testStart < n) {
      ctx.textAlign = 'center';
      ctx.fillText('测试区间', xOf(testStart) + (PAD.left + plotW - xOf(testStart)) / 2, height - 8);
    }

    // ---- 历史折线（下方渐变面积增强体量感） ----
    var histEnd = Math.min(n, testStart);
    ctx.strokeStyle = C.history;
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
    if (histEnd > 1) {
      var baseY = PAD.top + plotH;
      var grad = ctx.createLinearGradient(0, PAD.top, 0, baseY);
      grad.addColorStop(0, hexAlpha(C.history, 0.22));
      grad.addColorStop(1, hexAlpha(C.history, 0.02));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(xOf(0), baseY);
      for (i = 0; i < histEnd; i++) ctx.lineTo(xOf(i), yOf(values[i]));
      ctx.lineTo(xOf(histEnd - 1), baseY);
      ctx.closePath();
      ctx.fill();
    }

    // ---- 测试区间真实值（淡色）----
    if (testStart < n) {
      ctx.strokeStyle = C.actual;
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

    // ---- 预测折线（虚线强调色 + 空心端点）----
    if (preds && preds.length > 0) {
      ctx.strokeStyle = C.predict;
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

      // 预测点：空心圆（填充底色 + 彩色描边，和实线历史点区分）
      for (i = 0; i < preds.length; i++) {
        var cx = xOf(testStart + i);
        if (cx > PAD.left + plotW) break;
        var cy = yOf(preds[i]);
        ctx.beginPath();
        ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = canvasCardBg();
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = C.predict;
        ctx.stroke();
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

  /** 图表所在卡片的底色（空心点填充用，避免点里露出页面背景）。 */
  function canvasCardBg() {
    return cssVar('--v3-panel-2', cssVar('--v3-panel', '#131a22'));
  }

  /** 给 #rrggbb 颜色加透明度（渐变用）；非 # 格式原样返回。 */
  function hexAlpha(color, alpha) {
    if (typeof color !== 'string' || color.charAt(0) !== '#' || color.length !== 7) return color;
    var r = parseInt(color.slice(1, 3), 16);
    var g = parseInt(color.slice(3, 5), 16);
    var b = parseInt(color.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
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
    var C = palette();

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
      ctx.strokeStyle = inTest ? C.bandEdgeHot : C.bandEdge;
      ctx.lineWidth = inTest ? 2 : 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(bx) + 0.5, PAD.top);
      ctx.lineTo(Math.round(bx) + 0.5, PAD.top + g.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 十字线
    ctx.strokeStyle = C.cross;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, PAD.top);
    ctx.lineTo(Math.round(x) + 0.5, PAD.top + g.plotH);
    ctx.moveTo(PAD.left, Math.round(y) + 0.5);
    ctx.lineTo(PAD.left + g.plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    /** 悬停高亮点：彩色实心 + 底色描边，任何底色上都立得住。 */
    function dot(px, py, color) {
      ctx.beginPath();
      ctx.arc(px, py, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = canvasCardBg();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // 真值点
    dot(x, y, C.actual);

    // 预测点
    if (hasPred) dot(x, g.yOf(predVal), C.predict);

    // tooltip
    var lines = [
      '#' + idx + (inTest ? ' · 测试区间' : ' · 历史'),
      '真值 ' + axisLabel(v, g.span)
    ];
    if (hasPred) {
      lines.push('预测 ' + axisLabel(predVal, g.span));
      lines.push('差值 ' + (predVal - v >= 0 ? '+' : '') + axisLabel(predVal - v, g.span));
    }

    ctx.font = '11px ' + C.font;
    var boxW = 0;
    var i;
    for (i = 0; i < lines.length; i++) boxW = Math.max(boxW, ctx.measureText(lines[i]).width);
    boxW += 16;
    var boxH = lines.length * 15 + 10;
    var bxPos = x + 12;
    if (bxPos + boxW > PAD.left + g.plotW) bxPos = x - 12 - boxW;
    if (bxPos < PAD.left) bxPos = PAD.left + 2;
    var byPos = Math.max(PAD.top, Math.min(y - boxH / 2, PAD.top + g.plotH - boxH));

    ctx.fillStyle = C.tipBg;
    ctx.strokeStyle = C.tipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bxPos, byPos, boxW, boxH, 6);
    else ctx.rect(bxPos, byPos, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? C.tipTitle : (i === 3 ? C.predict : C.tipText);
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

  /*
   * 主题切换重绘：颜色从 CSS 变量读取后，「切换深浅主题」本身不会触发画布重绘，
   * 图表会停留在旧主题的配色上，直到下一次 resize / 路由切换。
   * 这里观察 documentElement 的 data-theme 属性，变化时把 v1 图表（redrawAll）
   * 与 v3 图表内核（TSJ.charts.redrawAll，见 charts/core.js）一起重画。
   */
  if (typeof global.document !== 'undefined' && typeof global.MutationObserver === 'function' &&
      global.document.documentElement) {
    var themeObserver = new global.MutationObserver(function () {
      if (resizeTimer) global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(function () {
        redrawAll();
        if (TSJ.charts && typeof TSJ.charts.redrawAll === 'function') TSJ.charts.redrawAll();
      }, 60);
    });
    themeObserver.observe(global.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
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
