/**
 * assets/js/charts/diagnostics.js —— 诊断图与统计量
 *
 * 这里同时提供纯函数（ACF/PACF/加性分解），实验室与课程演示共用同一实现，
 * 避免“图表算一套、实验算一套”导致数值漂移。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var charts = TSJ.charts || (TSJ.charts = {});

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function mean(arr) {
    var s = 0, n = 0;
    for (var i = 0; i < arr.length; i++) if (finite(arr[i])) { s += arr[i]; n++; }
    return n ? s / n : NaN;
  }

  /**
   * 自相关函数（默认有偏估计，样本少时需在文案中说明）。
   */
  function acf(series, lags) {
    var x = series.filter(finite);
    var n = x.length;
    var m = mean(x);
    var denom = 0;
    for (var i = 0; i < n; i++) denom += (x[i] - m) * (x[i] - m);
    var out = [];
    var maxLag = Math.min(lags || 20, n - 1);
    for (var k = 0; k <= maxLag; k++) {
      var num = 0;
      for (var j = k; j < n; j++) num += (x[j] - m) * (x[j - k] - m);
      out.push(denom > 0 ? num / denom : NaN);
    }
    return out;
  }

  /** 解对称正定线性方程组（Cholesky）。失败返回 null。 */
  function solveSym(A, b) {
    var n = b.length;
    var L = [];
    for (var i = 0; i < n; i++) L.push(new Array(n).fill(0));
    for (var col = 0; col < n; col++) {
      for (var row = 0; row <= col; row++) {
        var sum = A[col][row];
        for (var k = 0; k < row; k++) sum -= L[col][k] * L[row][k];
        if (col === row) {
          if (sum <= 1e-12) return null;
          L[col][row] = Math.sqrt(sum);
        } else {
          L[col][row] = sum / L[row][row];
        }
      }
    }
    var y = [];
    for (var i2 = 0; i2 < n; i2++) {
      var s = b[i2];
      for (var k2 = 0; k2 < i2; k2++) s -= L[i2][k2] * y[k2];
      y.push(s / L[i2][i2]);
    }
    var x = new Array(n).fill(0);
    for (var i3 = n - 1; i3 >= 0; i3--) {
      var s2 = y[i3];
      for (var k3 = i3 + 1; k3 < n; k3++) s2 -= L[k3][i3] * x[k3];
      x[i3] = s2 / L[i3][i3];
    }
    return x;
  }

  /** 偏自相关（Yule-Walker + 递推）。 */
  function pacf(series, lags) {
    var r = acf(series, lags);
    var out = [1];
    var phi = [];
    for (var k = 1; k < r.length; k++) {
      var A = [], b = [];
      for (var i = 0; i < k; i++) {
        A.push([]);
        for (var j = 0; j < k; j++) A[i].push(r[Math.abs(i - j)]);
        b.push(r[i + 1]);
      }
      var coef = solveSym(A, b);
      if (!coef) { out.push(NaN); continue; }
      phi = coef;
      out.push(coef[k - 1]);
    }
    return out;
  }

  /**
   * 经典加性分解：居中移动平均估趋势，残差按相位平均得季节项。
   * 数据不足两个完整周期时返回 null，不做“降级成能画”的假图。
   */
  function decomposeAdditive(series, m) {
    if (!m || m < 2) return null;
    var n = series.length;
    if (n < 2 * m) return null;
    for (var i = 0; i < n; i++) if (!finite(series[i])) return null;
    var trend = new Array(n).fill(NaN);
    var half = Math.floor(m / 2);
    for (var t = half; t < n - half; t++) {
      var sum = 0;
      if (m % 2 === 1) {
        for (var j = -half; j <= half; j++) sum += series[t + j];
        trend[t] = sum / m;
      } else {
        // 偶数周期：两个相邻移动平均再平均，权重为 (A + 0.5*(两端))/m
        var a = 0;
        for (var j2 = -half + 1; j2 <= half - 1; j2++) a += series[t + j2];
        trend[t] = (a + 0.5 * (series[t - half] + series[t + half])) / m;
      }
    }
    var sums = [], counts = [];
    for (var p = 0; p < m; p++) { sums.push(0); counts.push(0); }
    for (var t2 = 0; t2 < n; t2++) {
      if (!finite(trend[t2])) continue;
      var ph = t2 % m;
      sums[ph] += series[t2] - trend[t2];
      counts[ph]++;
    }
    var seasonal = [];
    for (var p2 = 0; p2 < m; p2++) seasonal.push(counts[p2] ? sums[p2] / counts[p2] : 0);
    var smean = seasonal.reduce(function (a, b) { return a + b; }, 0) / m;
    for (var p3 = 0; p3 < m; p3++) seasonal[p3] -= smean;
    var detrended = [];
    var residual = [];
    for (var t3 = 0; t3 < n; t3++) {
      var tr = finite(trend[t3]) ? trend[t3] : NaN;
      detrended.push(finite(tr) ? series[t3] - tr : NaN);
      residual.push(finite(tr) ? series[t3] - tr - seasonal[t3 % m] : NaN);
    }
    return { trend: trend, seasonal: seasonal, detrended: detrended, residual: residual, period: m };
  }

  /* ---------- 渲染器 ---------- */
  function stemChart(kind, title) {
    return {
      draw: function (ctx, model, env) {
        var values = model.values || [];
        var lags = model.lags || [];
        var conf = model.conf || [];
        var n = values.length;
        var padL = 44, padR = 16, padT = 18, padB = 28;
        var plotW = Math.max(10, env.width - padL - padR);
        var plotH = Math.max(10, env.height - padT - padB);
        var maxAbs = 0.0001;
        for (var i = 0; i < n; i++) {
          if (finite(values[i])) maxAbs = Math.max(maxAbs, Math.abs(values[i]));
          if (conf[i] != null) maxAbs = Math.max(maxAbs, Math.abs(conf[i]));
        }
        function xOf(i) { return n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW; }
        function yOf(v) { return padT + (1 - (v + maxAbs) / (2 * maxAbs)) * plotH; }
        ctx.save();
        ctx.strokeStyle = env.colors.grid;
        ctx.fillStyle = env.colors.muted;
        ctx.font = '11px sans-serif';
        for (var g = 0; g <= 4; g++) {
          var v = -maxAbs + (2 * maxAbs) * (g / 4);
          var y = Math.round(yOf(v)) + 0.5;
          ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
          ctx.fillText(v.toFixed(2), 6, y + 3);
        }
        // 置信界
        if (conf.length) {
          ctx.strokeStyle = env.colors.axis;
          ctx.setLineDash([4, 3]);
          [conf[0], -conf[0]].forEach(function (c) {
            if (!finite(c)) return;
            var yy = Math.round(yOf(c)) + 0.5;
            ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
          });
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = env.colors.pred;
        ctx.lineWidth = 1.5;
        for (var k = 0; k < n; k++) {
          var val = values[k];
          if (!finite(val)) continue;
          var x = xOf(k), yv = yOf(val), zero = yOf(0);
          ctx.beginPath(); ctx.moveTo(x, zero); ctx.lineTo(x, yv); ctx.stroke();
          ctx.fillStyle = Math.abs(val) > Math.abs(conf[0] || 0) ? env.colors.baseline : env.colors.pred;
          ctx.beginPath(); ctx.arc(x, yv, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = env.colors.muted;
        ctx.textAlign = 'center';
        for (var s = 0; s < n; s += Math.max(1, Math.floor(n / 8))) ctx.fillText(String(lags[s] != null ? lags[s] : s), xOf(s), padT + plotH + 16);
        ctx.restore();
        return { xOf: xOf, yOf: yOf, n: n, indexAt: function (x) { return n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((x - padL) / plotW * (n - 1)))); }, plot: { padL: padL, padT: padT, plotW: plotW, plotH: plotH } };
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
        var v = (model.values || [])[index];
        var c = (model.conf || [])[index];
        return '<div><b>滞后 ' + ((model.lags || [])[index] != null ? (model.lags || [])[index] : index) + '</b></div>' +
          '<div>' + (model.name || '值') + ' ' + (finite(v) ? v.toFixed(3) : '—') + '</div>' +
          (finite(c) ? '<div>置信界 ±' + c.toFixed(3) + '</div>' : '');
      },
      summary: function (model) {
        var vals = (model.values || []).filter(finite);
        var over = 0;
        var c0 = (model.conf || [])[0];
        for (var i = 1; i < vals.length; i++) if (finite(c0) && Math.abs(vals[i]) > Math.abs(c0)) over++;
        return title + '：' + vals.length + ' 阶，其中 ' + over + ' 阶超出置信界（估计法与假设见图注）';
      }
    };
  }

  var decomposition = {
    draw: function (ctx, model, env) {
      var parts = model.parts || {};
      var series = model.series || [];
      var n = series.length;
      var vals = [];
      [series, parts.trend, parts.seasonal, parts.residual].forEach(function (arr) {
        (arr || []).forEach(function (v) { if (finite(v)) vals.push(v); });
      });
      var seasonalFull = new Array(n).fill(null);
      for (var i = 0; i < n; i++) seasonalFull[i] = (parts.seasonal || [])[i % parts.period];
      vals = vals.concat(seasonalFull.filter(finite));
      if (!vals.length) vals = [0, 1];
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      if (min === max) { min -= 1; max += 1; }
      var padL = 52, padR = 16, padT = 16, padB = 28;
      var plotW = Math.max(10, env.width - padL - padR);
      var plotH = Math.max(10, env.height - padT - padB);
      function xOf(i) { return n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW; }
      function yOf(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }
      function line(arr, color, dash) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.setLineDash(dash || []);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var started = false;
        for (var k = 0; k < n; k++) {
          var v = arr[k];
          if (!finite(v)) { started = false; continue; }
          var x = xOf(k), y = yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = env.colors.grid;
      for (var g = 0; g <= 4; g++) {
        var vv = min + (max - min) * (g / 4);
        var y = Math.round(yOf(vv)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.fillStyle = env.colors.muted; ctx.font = '11px sans-serif'; ctx.fillText(vv.toFixed(1), 6, y + 3);
      }
      ctx.restore();
      line(series, env.colors.history, []);
      line(parts.trend, env.colors.pred, [5, 4]);
      line(seasonalFull, env.colors.baseline, [2, 3]);
      line(parts.residual, env.colors.actual, []);
      return { xOf: xOf, yOf: yOf, n: n, indexAt: function (x) { return n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((x - padL) / plotW * (n - 1)))); }, plot: { padL: padL, padT: padT, plotW: plotW, plotH: plotH } };
    },
    tooltip: function (model, index) {
      var p = model.parts || {};
      function v(arr) { var x = (arr || [])[index]; return finite(x) ? x.toFixed(2) : '—'; }
      return '<div><b>#' + index + '</b></div><div>序列 ' + v(model.series) + '</div>' +
        '<div>趋势 ' + v(p.trend) + '</div><div>季节 ' + v(p.seasonal && p.seasonal[index % p.period] != null ? new Array(index + 1).fill(p.seasonal[index % p.period]) : []) + '</div>' +
        '<div>残差 ' + v(p.residual) + '</div>';
    },
    summary: function (model) {
      var p = model.parts || {};
      return '加性分解：周期 ' + p.period + '，趋势/季节/残差同图；数据不足两个周期会拒绝绘制。';
    }
  };

  charts.register('acf', stemChart('acf', 'ACF'));
  charts.register('pacf', stemChart('pacf', 'PACF'));
  charts.register('decomposition', decomposition);

  charts.stats = {
    mean: mean,
    acf: acf,
    pacf: pacf,
    decomposeAdditive: decomposeAdditive
  };
  TSJ.chartStats = charts.stats;
})(typeof window !== 'undefined' ? window : this);
