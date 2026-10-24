/**
 * assets/js/charts/series.js —— 序列图渲染器（预测 / 残差 / 指标对比）
 *
 * 所有渲染器遵循同一约定：
 *   draw(ctx, model, env) -> geom
 *   focus(ctx, model, geom, index, env)  // 只画高亮层，可重复调用
 *   tooltip(model, index) -> html
 *   summary(model) -> 文本
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var charts = TSJ.charts || (TSJ.charts = {});
  var core = charts;

  /* ---------- 公共工具 ---------- */
  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function allValues(model) {
    var out = [];
    var keys = ['history', 'actual', 'prediction', 'baseline'];
    for (var i = 0; i < keys.length; i++) {
      var arr = model[keys[i]] || [];
      for (var j = 0; j < arr.length; j++) if (finite(arr[j])) out.push(arr[j]);
    }
    var iv = model.intervals || [];
    for (var k = 0; k < iv.length; k++) {
      var lo = iv[k].lower || [];
      var hi = iv[k].upper || [];
      for (var a = 0; a < lo.length; a++) if (finite(lo[a])) out.push(lo[a]);
      for (var b = 0; b < hi.length; b++) if (finite(hi[b])) out.push(hi[b]);
    }
    return out;
  }

  function pickIndices(model, maxPoints) {
    var n = model.n || 0;
    if (!n) return [];
    var max = maxPoints || model.maxPoints || 1200;
    if (n <= max) {
      var all = [];
      for (var i = 0; i < n; i++) all.push(i);
      return all;
    }
    var buckets = Math.max(2, Math.floor(max / 2));
    var size = n / buckets;
    var picked = {};
    function mark(i) { if (i >= 0 && i < n) picked[i] = true; }
    var keys = ['history', 'actual', 'prediction', 'baseline'];
    for (var b = 0; b < buckets; b++) {
      var lo = Math.floor(b * size);
      var hi = Math.min(n - 1, Math.floor((b + 1) * size) - 1);
      if (hi < lo) hi = lo;
      var minI = -1, maxI = -1, minV = Infinity, maxV = -Infinity;
      for (var j = lo; j <= hi; j++) {
        for (var k = 0; k < keys.length; k++) {
          var v = (model[keys[k]] || [])[j];
          if (!finite(v)) continue;
          if (v < minV) { minV = v; minI = j; }
          if (v > maxV) { maxV = v; maxI = j; }
        }
      }
      mark(lo); mark(hi);
      if (minI >= 0) mark(minI);
      if (maxI >= 0) mark(maxI);
    }
    mark(0); mark(n - 1);
    var out = [];
    for (var p = 0; p < n; p++) if (picked[p]) out.push(p);
    return out;
  }

  function scales(model, env, indices) {
    var vals = allValues(model);
    if (!vals.length) vals = [0, 1];
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (min === max) {
      var pad = Math.max(1, Math.abs(min) * 0.05);
      min -= pad; max += pad;
    } else {
      var span = max - min;
      min -= span * 0.06;
      max += span * 0.06;
    }
    var padL = 52, padR = 16, padT = 16, padB = 30;
    var plotW = Math.max(10, env.width - padL - padR);
    var plotH = Math.max(10, env.height - padT - padB);
    var n = model.n || 0;
    function xOf(i) {
      if (n <= 1) return padL + plotW / 2;
      return padL + (i / (n - 1)) * plotW;
    }
    function yOf(v) {
      return padT + (1 - (v - min) / (max - min)) * plotH;
    }
    function indexAt(x) {
      if (n <= 1) return 0;
      var t = (x - padL) / plotW;
      var i = Math.round(t * (n - 1));
      return Math.max(0, Math.min(n - 1, i));
    }
    return { min: min, max: max, padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH, xOf: xOf, yOf: yOf, indexAt: indexAt };
  }

  function drawGrid(ctx, sc, env) {
    ctx.save();
    ctx.strokeStyle = env.colors.grid;
    ctx.fillStyle = env.colors.muted;
    ctx.lineWidth = 1;
    ctx.font = '11px ' + (global.getComputedStyle ? getComputedStyle(doc().documentElement).getPropertyValue('--v3-sans') : 'sans-serif');
    var lines = 4;
    for (var i = 0; i <= lines; i++) {
      var v = sc.min + (sc.max - sc.min) * (i / lines);
      var y = Math.round(sc.yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sc.padL, y);
      ctx.lineTo(sc.padL + sc.plotW, y);
      ctx.stroke();
      ctx.fillText(fmt(v), 6, y + 3);
    }
    ctx.restore();
  }

  function doc() { return global.document; }

  function fmt(v) {
    if (!finite(v)) return '-';
    var a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function drawSplits(ctx, sc, model, env) {
    var splits = model.splits || [];
    ctx.save();
    ctx.strokeStyle = env.colors.axis;
    ctx.setLineDash([4, 4]);
    ctx.fillStyle = env.colors.muted;
    ctx.font = '11px sans-serif';
    for (var i = 0; i < splits.length; i++) {
      var s = splits[i];
      var x = Math.round(sc.xOf(s.index)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, sc.padT);
      ctx.lineTo(x, sc.padT + sc.plotH);
      ctx.stroke();
      ctx.fillText(s.label || s.role || 'split', x + 4, sc.padT + 12);
    }
    ctx.restore();
  }

  function linePath(ctx, sc, indices, values, xOf, yOf) {
    ctx.beginPath();
    var started = false;
    for (var k = 0; k < indices.length; k++) {
      var i = indices[k];
      var v = values[i];
      if (!finite(v)) { started = false; continue; }
      var x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
  }

  function drawSeriesLine(ctx, sc, indices, values, color, style) {
    if (!indices.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = style === 'pred' ? 2 : 1.6;
    ctx.setLineDash(style === 'pred' ? [6, 4] : style === 'baseline' ? [2, 3] : []);
    linePath(ctx, sc, indices, values, sc.xOf, sc.yOf);
    ctx.stroke();
    ctx.restore();
  }

  function drawIntervals(ctx, sc, model, env) {
    var iv = model.intervals || [];
    if (!iv.length) return;
    var indices = model.__indices || [];
    ctx.save();
    for (var k = 0; k < iv.length; k++) {
      var level = iv[k];
      var lower = level.lower || [];
      var upper = level.upper || [];
      ctx.fillStyle = level.level >= 90 ? env.colors.interval : 'rgba(125,211,252,.10)';
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var hi = upper[idx];
        if (!finite(hi)) continue;
        var x = sc.xOf(idx), y = sc.yOf(hi);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      for (var j = indices.length - 1; j >= 0; j--) {
        var idx2 = indices[j];
        var lo = lower[idx2];
        if (!finite(lo)) continue;
        ctx.lineTo(sc.xOf(idx2), sc.yOf(lo));
      }
      if (started) {
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function legendItems(model) {
    var out = [];
    if ((model.history || []).length) out.push(['history', '历史']);
    if ((model.actual || []).length) out.push(['actual', '真值']);
    if ((model.prediction || []).length) out.push(['pred', '预测']);
    if ((model.baseline || []).length) out.push(['baseline', '基线']);
    if ((model.intervals || []).length) out.push(['interval', '区间']);
    return out;
  }

  /* ---------- forecast ---------- */
  var forecast = {
    draw: function (ctx, model, env) {
      model = model || { n: 0 };
      var indices = pickIndices(model, model.maxPoints);
      model.__indices = indices;
      var sc = scales(model, env, indices);
      drawGrid(ctx, sc, env);
      drawIntervals(ctx, sc, model, env);
      drawSplits(ctx, sc, model, env);
      drawSeriesLine(ctx, sc, indices, model.history || [], env.colors.history, 'history');
      drawSeriesLine(ctx, sc, indices, model.actual || [], env.colors.actual, 'actual');
      drawSeriesLine(ctx, sc, indices, model.prediction || [], env.colors.pred, 'pred');
      drawSeriesLine(ctx, sc, indices, model.baseline || [], env.colors.baseline, 'baseline');
      if (env.unit) {
        ctx.save();
        ctx.fillStyle = env.colors.muted;
        ctx.font = '11px sans-serif';
        ctx.fillText('单位：' + env.unit, sc.padL, 12);
        ctx.restore();
      }
      return { xOf: sc.xOf, yOf: sc.yOf, indexAt: sc.indexAt, n: model.n || 0, plot: sc, indices: indices };
    },
    focus: function (ctx, model, geom, index, env) {
      if (!geom || index < 0) return;
      ctx.save();
      ctx.strokeStyle = env.colors.text;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      var x = Math.round(geom.xOf(index)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, geom.plot.padT);
      ctx.lineTo(x, geom.plot.padT + geom.plot.plotH);
      ctx.stroke();
      ctx.restore();
    },
    tooltip: function (model, index) {
      function val(arr) { var v = (arr || [])[index]; return finite(v) ? v.toFixed(2) : '—'; }
      var iv = (model.intervals || []).map(function (x) {
        var lo = (x.lower || [])[index], hi = (x.upper || [])[index];
        return finite(lo) && finite(hi) ? x.level + '%: [' + lo.toFixed(1) + ', ' + hi.toFixed(1) + ']' : null;
      }).filter(Boolean).join('<br>');
      return '<div><b>#' + index + '</b></div>' +
        '<div>历史 ' + val(model.history) + '</div>' +
        '<div>真值 ' + val(model.actual) + '</div>' +
        '<div>预测 ' + val(model.prediction) + '</div>' +
        '<div>基线 ' + val(model.baseline) + '</div>' +
        (iv ? '<div>' + iv + '</div>' : '');
    },
    summary: function (model) {
      var n = (model && model.n) || 0;
      var miss = 0;
      var keys = ['history', 'actual', 'prediction'];
      for (var i = 0; i < keys.length; i++) {
        var arr = model[keys[i]] || [];
        for (var j = 0; j < arr.length; j++) if (arr[j] == null) miss++;
      }
      return '样本 ' + n + ' 个' + (miss ? '，缺失/未覆盖 ' + miss + ' 点' : '') +
        ((model.splits || []).length ? '，切分线 ' + model.splits.length + ' 条' : '');
    }
  };

  /* ---------- residual ---------- */
  var residual = {
    draw: function (ctx, model, env) {
      model = model || { residuals: [] };
      var residuals = model.residuals || [];
      var n = residuals.length;
      var vals = residuals.filter(finite);
      var min = vals.length ? Math.min.apply(null, vals) : -1;
      var max = vals.length ? Math.max.apply(null, vals) : 1;
      if (min === max) { min -= 1; max += 1; }
      var padL = 52, padR = 16, padT = 16, padB = 28;
      var plotW = Math.max(10, env.width - padL - padR);
      var plotH = Math.max(10, env.height - padT - padB);
      function xOf(i) { return n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW; }
      function yOf(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }
      function indexAt(x) {
        if (n <= 1) return 0;
        var t = (x - padL) / plotW;
        return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
      }
      // 网格与零线
      ctx.save();
      ctx.strokeStyle = env.colors.grid;
      for (var g = 0; g <= 4; g++) {
        var v = min + (max - min) * (g / 4);
        var y = Math.round(yOf(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.fillStyle = env.colors.muted; ctx.font = '11px sans-serif';
        ctx.fillText(fmt(v), 6, y + 3);
      }
      ctx.strokeStyle = env.colors.axis;
      ctx.setLineDash([4, 4]);
      var zy = Math.round(yOf(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(padL + plotW, zy); ctx.stroke();
      ctx.setLineDash([]);
      // 残差柱
      ctx.fillStyle = env.colors.pred;
      for (var i = 0; i < n; i++) {
        var r = residuals[i];
        if (!finite(r)) continue;
        var x = xOf(i), y = yOf(r);
        ctx.fillRect(x - 1, Math.min(y, zy), 2, Math.max(1, Math.abs(y - zy)));
      }
      ctx.restore();
      return { xOf: xOf, yOf: yOf, indexAt: indexAt, n: n, plot: { padL: padL, padT: padT, plotW: plotW, plotH: plotH } };
    },
    focus: function (ctx, model, geom, index, env) {
      if (!geom || index < 0) return;
      ctx.save();
      ctx.strokeStyle = env.colors.text;
      ctx.setLineDash([3, 3]);
      var x = Math.round(geom.xOf(index)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, geom.plot.padT); ctx.lineTo(x, geom.plot.padT + geom.plot.plotH); ctx.stroke();
      ctx.restore();
    },
    tooltip: function (model, index) {
      var r = (model.residuals || [])[index];
      return '<div><b>#' + index + '</b></div><div>残差 ' + (finite(r) ? r.toFixed(3) : '—') + '</div>';
    },
    summary: function (model) {
      var rs = (model && model.residuals || []).filter(finite);
      if (!rs.length) return '无残差数据';
      var mean = rs.reduce(function (a, b) { return a + b; }, 0) / rs.length;
      return '残差 ' + rs.length + ' 个，均值 ' + mean.toFixed(3) + '，零线已标出';
    }
  };

  /* ---------- metrics 对比 ---------- */
  var metrics = {
    draw: function (ctx, model, env) {
      model = model || { labels: [], series: [] };
      var labels = model.labels || [];
      var series = model.series || [];
      var max = 0;
      series.forEach(function (s) { (s.values || []).forEach(function (v) { if (finite(v) && v > max) max = v; }); });
      if (max <= 0) max = 1;
      var padL = 52, padR = 16, padT = 16, padB = 42;
      var plotW = Math.max(10, env.width - padL - padR);
      var plotH = Math.max(10, env.height - padT - padB);
      function yOf(v) { return padT + (1 - v / max) * plotH; }
      ctx.save();
      ctx.strokeStyle = env.colors.grid;
      ctx.fillStyle = env.colors.muted;
      ctx.font = '11px sans-serif';
      for (var g = 0; g <= 4; g++) {
        var v = max * (g / 4);
        var y = Math.round(yOf(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.fillText(fmt(v), 6, y + 3);
      }
      var groupW = plotW / Math.max(1, labels.length);
      var barW = Math.max(4, (groupW - 8) / Math.max(1, series.length));
      var palette = [env.colors.pred, env.colors.baseline, env.colors.history, env.colors.actual];
      series.forEach(function (s, si) {
        ctx.fillStyle = palette[si % palette.length];
        (s.values || []).forEach(function (v, i) {
          if (!finite(v)) return;
          var x = padL + i * groupW + 4 + si * barW;
          var y = yOf(v);
          ctx.fillRect(x, y, barW - 2, padT + plotH - y);
        });
      });
      ctx.fillStyle = env.colors.muted;
      labels.forEach(function (l, i) {
        var x = padL + i * groupW + groupW / 2;
        ctx.textAlign = 'center';
        ctx.fillText(String(l).slice(0, 10), x, padT + plotH + 16);
      });
      ctx.restore();
      return { n: labels.length, indexAt: function () { return -1; }, xOf: function () { return 0; }, yOf: yOf, plot: { padL: padL, padT: padT, plotW: plotW, plotH: plotH } };
    },
    tooltip: function (model, index) {
      var rows = (model.series || []).map(function (s) {
        var v = (s.values || [])[index];
        return '<div>' + s.name + ' ' + (finite(v) ? v.toFixed(3) : '—') + '</div>';
      }).join('');
      return '<div><b>' + (model.labels || [])[index] + '</b></div>' + rows;
    },
    summary: function (model) {
      return '对比 ' + ((model.labels || []).length) + ' 组 × ' + ((model.series || []).length) + ' 个指标';
    }
  };

  charts.register('forecast', forecast);
  charts.register('residual', residual);
  charts.register('metrics', metrics);
  TSJ.chartV2 = { forecast: forecast, residual: residual, metrics: metrics };
})(typeof window !== 'undefined' ? window : this);
