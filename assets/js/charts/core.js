/**
 * assets/js/charts/core.js —— v3 图表内核
 *
 * 统一管理：DPR、resize、指针/键盘、tooltip、销毁、几何信息。
 * 具体画法由 charts/series.js 与 charts/diagnostics.js 注册的渲染器完成，
 * 内核不关心是折线、扇形还是残差图。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var doc = global.document;

  TSJ.charts = TSJ.charts || {};
  var registry = TSJ.charts.renderers || (TSJ.charts.renderers = {});

  function register(kind, renderer) { registry[kind] = renderer; }

  function cssVar(name, fallback) {
    if (!doc || !doc.documentElement || !global.getComputedStyle) return fallback;
    var v = global.getComputedStyle(doc.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  /**
   * 生成显示层采样映射：按桶保留最小/最大点，避免长序列压平极值。
   * @param {number} n 原始点数
   * @param {number} maxPoints 目标桶数
   * @returns {number[]} 原始下标（升序）
   */
  function sampleMap(n, maxPoints) {
    if (!n || n <= 0) return [];
    if (!maxPoints || n <= maxPoints) {
      var all = [];
      for (var i = 0; i < n; i++) all.push(i);
      return all;
    }
    var buckets = Math.max(2, Math.floor(maxPoints));
    var size = n / buckets;
    var picked = {};
    var out = [];
    for (var b = 0; b < buckets; b++) {
      var lo = Math.floor(b * size);
      var hi = Math.min(n - 1, Math.floor((b + 1) * size) - 1);
      if (hi < lo) hi = lo;
      // 由渲染器提供 values 才能选极值，这里先给桶首尾，渲染器可再细化
      picked[lo] = true;
      picked[hi] = true;
    }
    picked[0] = true;
    picked[n - 1] = true;
    for (var k = 0; k < n; k++) if (picked[k]) out.push(k);
    return out;
  }

  function ensureTip(wrap) {
    var tip = wrap.querySelector('.chart-v2-tip');
    if (tip) return tip;
    tip = doc.createElement('div');
    tip.className = 'chart-v2-tip hidden';
    tip.setAttribute('role', 'status');
    wrap.appendChild(tip);
    return tip;
  }

  /**
   * 创建图表实例。
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   */
  function create(canvas, opts) {
    if (!canvas || !canvas.getContext) return null;
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var wrap = canvas.parentNode;
    var scope = opts.scope;
    var kind = opts.kind || 'forecast';
    var renderer = registry[kind];
    var model = null;
    var geom = null;
    var focusIndex = -1;
    var raf = null;
    var destroyed = false;
    var ro = null;

    function resize() {
      if (destroyed) return;
      var width = wrap.clientWidth || canvas.clientWidth || 320;
      var height = opts.height || 260;
      var dpr = global.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.height = height + 'px';
      draw();
    }

    function scheduleResize() {
      if (raf) global.cancelAnimationFrame(raf);
      raf = global.requestAnimationFrame(function () {
        raf = null;
        resize();
      });
    }

    function draw() {
      if (destroyed || !renderer) return;
      var width = wrap.clientWidth || canvas.clientWidth || 320;
      var height = opts.height || 260;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var dpr = global.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      geom = renderer.draw(ctx, model, {
        width: width,
        height: height,
        unit: opts.unit || '',
        ariaLabel: opts.ariaLabel || '',
        colors: {
          history: cssVar('--v3-chart-history', '#7dd3fc'),
          actual: cssVar('--v3-chart-actual', '#34d399'),
          pred: cssVar('--v3-chart-pred', '#2dd4bf'),
          baseline: cssVar('--v3-chart-baseline', '#f5b942'),
          interval: cssVar('--v3-chart-interval', 'rgba(125,211,252,.16)'),
          grid: cssVar('--v3-chart-grid', 'rgba(147,165,183,.18)'),
          axis: cssVar('--v3-chart-axis', '#8b98a9'),
          text: cssVar('--v3-text', '#e6edf5'),
          muted: cssVar('--v3-muted', '#8b98a9')
        }
      }) || null;
      canvas.__tsjGeom = geom;
      if (focusIndex >= 0) paintFocus(focusIndex, true);
    }

    function hideTip() {
      var tip = wrap.querySelector('.chart-v2-tip');
      if (tip) tip.classList.add('hidden');
    }

    function paintFocus(index, silent) {
      if (destroyed || !geom || !renderer) return;
      if (typeof renderer.focus !== 'function') return;
      renderer.focus(ctx, model, geom, index, {
        colors: {
          history: cssVar('--v3-chart-history', '#7dd3fc'),
          actual: cssVar('--v3-chart-actual', '#34d399'),
          pred: cssVar('--v3-chart-pred', '#2dd4bf'),
          baseline: cssVar('--v3-chart-baseline', '#f5b942'),
          text: cssVar('--v3-text', '#e6edf5')
        }
      });
      var tip = ensureTip(wrap);
      if (index < 0 || !renderer.tooltip) { hideTip(); return; }
      var html = renderer.tooltip(model, index);
      if (!html) { hideTip(); return; }
      tip.innerHTML = html;
      tip.classList.remove('hidden');
      var x = geom.xOf ? geom.xOf(index) : 0;
      var wrapWidth = wrap.clientWidth || 0;
      var tipWidth = tip.offsetWidth || 160;
      var left = Math.max(8, Math.min(wrapWidth - tipWidth - 8, x - tipWidth / 2));
      tip.style.left = left + 'px';
      tip.style.top = '12px';
      if (!silent && typeof opts.onInspect === 'function') opts.onInspect(index, model);
    }

    function indexFromEvent(ev) {
      if (!geom || typeof geom.indexAt !== 'function') return -1;
      var rect = canvas.getBoundingClientRect();
      var x = (ev.clientX != null ? ev.clientX : 0) - rect.left;
      return geom.indexAt(x);
    }

    function onMove(ev) {
      var idx = indexFromEvent(ev);
      if (idx < 0) { focusIndex = -1; hideTip(); return; }
      focusIndex = idx;
      paintFocus(idx);
    }

    function onLeave() {
      focusIndex = -1;
      paintFocus(-1, true);
      hideTip();
    }

    function onKey(ev) {
      if (!geom || geom.n == null) return;
      var n = geom.n;
      var next = focusIndex;
      if (ev.key === 'ArrowRight') next = focusIndex < 0 ? 0 : Math.min(n - 1, focusIndex + 1);
      else if (ev.key === 'ArrowLeft') next = focusIndex < 0 ? n - 1 : Math.max(0, focusIndex - 1);
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = n - 1;
      else if (ev.key === 'Escape') { onLeave(); return; }
      else return;
      ev.preventDefault();
      focusIndex = next;
      paintFocus(next);
    }

    // 生命周期登记：全部通过 scope 解绑
    if (scope && typeof scope.listen === 'function') {
      scope.listen(canvas, 'pointermove', onMove);
      scope.listen(canvas, 'pointerleave', onLeave);
      scope.listen(canvas, 'keydown', onKey);
      scope.listen(global, 'resize', scheduleResize);
    } else {
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('keydown', onKey);
      global.addEventListener('resize', scheduleResize);
    }

    if (global.ResizeObserver) {
      ro = new global.ResizeObserver(scheduleResize);
      ro.observe(wrap);
    }

    canvas.setAttribute('tabindex', '0');
    if (opts.ariaLabel) canvas.setAttribute('aria-label', opts.ariaLabel);

    resize();

    return {
      kind: kind,
      update: function (next) {
        model = next;
        focusIndex = -1;
        hideTip();
        draw();
      },
      resize: resize,
      focusIndex: function (i) {
        if (i == null) return focusIndex;
        focusIndex = i;
        paintFocus(i, true);
      },
      summary: function () {
        return renderer && renderer.summary ? renderer.summary(model) : '';
      },
      geometry: function () { return geom; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (ro && ro.disconnect) ro.disconnect();
        if (raf) global.cancelAnimationFrame(raf);
        hideTip();
        delete canvas.__tsjGeom;
      }
    };
  }

  TSJ.charts.register = register;
  TSJ.charts.create = create;
  TSJ.charts.sampleMap = sampleMap;
  TSJ.charts.cssVar = cssVar;
})(typeof window !== 'undefined' ? window : this);
