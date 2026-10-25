/**
 * assets/js/app/ui.js —— 通用渲染件：Markdown、结果面板、逐测试点、预测曲线、判题按钮态、分栏拖拽
 *
 * 加载顺序：core → store → storage → ui → a11y → views → pages → app.js；挂载点 TSJ.appUi。
 * 约定：所有 DOM 查询限定在 `#view` 作用域内（`$('#x', view)`）—— 旧实现用全局
 * `$('#btnSolution')` / `$('#resultPanel')`，路由切换后会摸到新页面的节点。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var judge = TSJ.judge;

  var $ = core.$;
  var esc = core.esc;
  var fmtNum = core.fmtNum;

  /* ---------- 1. 极简 Markdown ---------- */
  /** 行内元素：`code` / **bold** / *italic*。 */
  function mdInline(s) {
    var t = esc(s);
    // 术语链接：[[term:id]] / [[term:id|别名]] → 术语表（题面与提示里可点）
    t = t.replace(/\[\[term:([a-z0-9\-]+)(?:\|([^\]\n]+))?\]\]/gi, function (_, id, label) {
      var w = (TSJ.glossary || []).filter(function (x) { return x.id === id; })[0];
      return w ? '<a class="md-term" href="#/glossary" title="术语表：' + esc(w.term) + '">' + esc(label || w.term) + '</a>' : (label || id);
    });
    t = t.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return t;
  }
  /** 极简 Markdown 渲染：标题、无序/有序列表、代码块、引用、分隔线、段落。 */
  function md(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var listTag = null;
    var i = 0;

    /** 关闭当前列表。 */
    function closeList() { if (listTag) { out.push('</' + listTag + '>'); listTag = null; } }

    /** 判断一行是否开启新块。 */
    function isBlockStart(line) {
      return /^\s*$/.test(line) ||
        /^```/.test(line) ||
        /^#{1,4}\s+/.test(line) ||
        /^---+\s*$/.test(line) ||
        /^\s*[-*]\s+/.test(line) ||
        /^\s*\d+\.\s+/.test(line) ||
        /^>\s?/.test(line);
    }

    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        closeList();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束围栏
        out.push('<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (/^\s*$/.test(line)) { closeList(); i++; continue; }   // 空行

      // 标题
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        closeList();
        var lv = h[1].length;
        out.push('<h' + lv + ' class="md-h">' + mdInline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr class="md-hr">'); i++; continue; }   // 分隔线

      // 引用
      var q = /^>\s?(.*)$/.exec(line);
      if (q) {
        closeList();
        var qbuf = [q[1]];
        i++;
        while (i < lines.length && /^>\s?/.test(lines[i])) { qbuf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<div class="md-quote">' + mdInline(qbuf.join(' ')) + '</div>');
        continue;
      }

      // 列表
      var ul = /^\s*[-*]\s+(.*)$/.exec(line);
      var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ul || ol) {
        var want = ul ? 'ul' : 'ol';
        if (listTag !== want) { closeList(); out.push('<' + want + ' class="md-list">'); listTag = want; }
        out.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
        i++;
        continue;
      }

      // 段落：合并连续非块起始行
      closeList();
      var pbuf = [line];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) { pbuf.push(lines[i]); i++; }
      out.push('<p class="md-p">' + mdInline(pbuf.join(' ')) + '</p>');
    }

    closeList();
    return out.join('\n');
  }

  /* ---------- 2. 判题按钮态 ---------- */
  /** 当前环境是否允许提交（无沙箱时禁止提交，避免死循环锁死界面）。 */
  function canSubmit() {
    return typeof judge.canUseSandbox === 'function' ? judge.canUseSandbox() : true;
  }

  /** 切换「判题中」按钮态。 只在令牌仍然有效时执行 —— 否则会把新页面的按钮改成「判题中…」或提前解禁。 */
  function setBusy(busy, token) {
    if (token !== undefined && token !== store.state.judgeToken) return;
    var view = $('#view');
    if (!view) return;
    var sandboxOk = canSubmit();
    var btnRun = $('#btnRun', view);
    var btnSubmit = $('#btnSubmit', view);
    if (btnRun) btnRun.disabled = busy || !sandboxOk;
    if (btnSubmit) {
      btnSubmit.disabled = busy || !sandboxOk;
      btnSubmit.textContent = busy ? '判题中…' : '提交判题';
      if (!sandboxOk) btnSubmit.title = judge.SANDBOX_REFUSED_REASON || '当前环境无法创建判题沙箱';
    }
  }

  /* ---------- 3. 逐测试点列表（结果面板与提交详情共用） ---------- */
  /** verdict → 迷你标签 class */
  function verdictMiniClass(v) {
    return v === 'AC' ? 'vm-ac' : v === 'RE' ? 'vm-re' : v === 'TLE' ? 'vm-tle' : 'vm-wa';
  }

  /**
   * 渲染逐测试点列表。
   * @param {Array} cases 测试点数组（judge 的 res.cases 或落盘的 cases 快照）
   * @param {boolean} withOrigin 是否显示「（origin #N）」
   * @returns {string} HTML
   */
  function renderCaseList(cases, withOrigin) {
    var list = core.isArrayValue(cases) ? cases : [];
    if (list.length === 0) return '';
    var html = ['<div class="cases">'];
    for (var i = 0; i < list.length; i++) {
      var cs = list[i] || {};
      var vm = verdictMiniClass(cs.verdict);
      html.push('<div class="case">\n  <span class="verdict-mini ' + vm + '">' + esc(cs.verdict) + '</span>' +
        '  <span class="case-idx">测试点 ' + (i + 1) +
        (withOrigin && list.length > 1 ? '（origin #' + esc(core.toCount(cs.index) + 1) + '）' : '') + '</span>' +
        '  <span class="case-metric">你 ' + fmtNum(cs.yourMetric) + ' / 基线 ' + fmtNum(cs.bestBaseline) + '</span>' +
        '  <span class="case-score">' + esc(core.toScore(cs.score)) + '</span>');
      if (cs.error) html.push('  <span class="case-err">' + esc(cs.error) + '</span>');
      html.push('</div>');
    }
    html.push('</div>');
    return html.join('\n');
  }

  /* ---------- 4. 结果面板 ---------- */
  /** 渲染「前置守卫」提示（数据不足 / 沙箱不可用 / 已取消）。 这类报告不进入评分流程，因此不显示任何分数与逐测试点。 */
  function renderGuardNotice(res) {
    var view = $('#view');
    var host = view ? $('#resultPanel', view) : null;
    if (!host) return;
    host.innerHTML = '<div class="notice">' + esc((res && res.message) || '判题未能开始。') + '</div>';
  }

  /** 渲染判题结果面板。 */
  function renderResult(res, p) {
    var view = $('#view');
    var host = view ? $('#resultPanel', view) : null;
    if (!host) return;

    // 数据/配置缺陷、沙箱不可用、会话取消：只给提示，不给分数（避免出现「0 分」的误导）
    if (res && (res.dataError || res.refused || res.aborted)) {
      renderGuardNotice(res);
      return;
    }

    if (!res) {
      host.innerHTML = '<div class="result-empty">' +
        '写一个 <code>predict(history, horizon, ctx)</code> 函数，<br>' +
        '点「提交判题」或按 <code>Ctrl/⌘ + Enter</code> 开始评测。<br>' +
        '<span style="color:#4d5a68">通过线 ' + p.passScore + ' 分 · 需全部测试点达标</span>' +
        '</div>';
      return;
    }

    var html = [];

    // ---- 头部：环形分 + verdict ----
    var VERDICT_VIEW = { AC: ['verdict-ac', '通过 AC'], RE: ['verdict-re', '运行时错误 RE'], TLE: ['verdict-tle', '超时 TLE'] };
    var vv = VERDICT_VIEW[res.verdict] || ['verdict-wa', '未通过 WA'];
    var verdictClass = vv[0];
    var verdictText = vv[1];

    var ringClass = res.score >= p.passScore ? '' : (res.score >= 40 ? ' warn' : ' bad');
    var circumference = 2 * Math.PI * 30;
    var offset = circumference * (1 - Math.max(0, Math.min(100, res.score)) / 100);

    html.push('<div class="result-head">\n  <div class="ring-wrap">\n    <svg class="ring" viewBox="0 0 72 72" aria-hidden="true">');
    html.push('      <circle class="ring-bg" cx="36" cy="36" r="30"></circle>' +
      '<circle class="ring-fg' + ringClass + '" cx="36" cy="36" r="30" ' +
      'stroke-dasharray="' + circumference.toFixed(2) + '" ' +
      'stroke-dashoffset="' + offset.toFixed(2) + '"></circle>');
    html.push('    </svg>\n    <div class="ring-label"><b>' + esc(res.score) + '</b><span>SCORE</span></div>');
    html.push('  </div>\n  <div class="result-summary">\n    <div class="verdict ' + verdictClass + '">' + verdictText + '</div>' +
      '<div class="result-sub">' + esc(res.metricLabel || '') + ' · ' +
      (res.cases.length > 1 ? res.cases.length + ' 个测试点取平均' : '单测试点') + '</div>' +
      '<div class="result-sub dim">通过线 ' + p.passScore + ' 分 · 阈值 ' +
      p.threshold + ' × 最优基线</div>');
    html.push('  </div>\n</div>');

    // ---- 错误信息 ----
    if (res.verdict === 'RE' || res.verdict === 'TLE') {
      var firstCase = null;
      for (var i = 0; i < res.cases.length; i++) {
        if (res.cases[i].verdict === 'RE' || res.cases[i].verdict === 'TLE') { firstCase = res.cases[i]; break; }
      }
      var errText = (firstCase && firstCase.error) || res.message || '未知错误';
      var lineText = (firstCase && firstCase.line) ? ('第 ' + firstCase.line + ' 行') : '行号未知';
      html.push('<div class="err-box">' + esc(errText) +
        '<div class="err-meta">位置：' + esc(lineText) + '</div></div>');
    } else if (res.verdict === 'WA' && res.message) {
      html.push('<div class="result-sub" style="margin-bottom:10px">' + esc(res.message) + '</div>');
    }

    // ---- 逐测试点 ----
    if (res.cases.length > 0) html.push(renderCaseList(res.cases, true));

    // ---- 指标对比条（以最后一个测试点为例）----
    if (res.cases.length > 0 && isFinite(res.cases[res.cases.length - 1].yourMetric)) {
      var last = res.cases[res.cases.length - 1];
      var names = [];
      var values = {};
      var k;
      for (k in last.allBaselines) {
        if (Object.prototype.hasOwnProperty.call(last.allBaselines, k)) {
          names.push(k);
          values[k] = last.allBaselines[k];
        }
      }
      values.__mine = last.yourMetric;
      var maxVal = 0;
      for (k in values) {
        if (Object.prototype.hasOwnProperty.call(values, k) && isFinite(values[k]) && values[k] > maxVal) {
          maxVal = values[k];
        }
      }
      if (maxVal <= 0) maxVal = 1;

      html.push('<div class="bars">');
      html.push('  <div class="bars-title">指标对比 · ' + esc(res.metricLabel || '') +
        '（越短越好，黄色为最优基线）</div>');
      html.push('  <div class="bar-row">\n    <span class="bar-label mine">你的预测</span>');
      html.push('    <span class="bar-track"><span class="bar-fill mine" style="width:' +
        Math.min(100, (values.__mine / maxVal) * 100).toFixed(1) + '%"></span></span>');
      html.push('    <span class="bar-val">' + fmtNum(values.__mine) + '</span>\n  </div>');

      for (var n = 0; n < names.length; n++) {
        var nm = names[n];
        var isBest = nm === last.baselineName;
        html.push('  <div class="bar-row">\n    <span class="bar-label">' + esc(judge.baselineLabels[nm] || nm) + '</span>');
        html.push('    <span class="bar-track"><span class="bar-fill' + (isBest ? ' best' : '') +
          '" style="width:' + Math.min(100, (values[nm] / maxVal) * 100).toFixed(1) + '%"></span></span>');
        html.push('    <span class="bar-val">' + fmtNum(values[nm]) + '</span>\n  </div>');
      }
      html.push('</div>');
    }

    host.innerHTML = html.join('\n');
  }

  /** 把最后一个测试点的预测画到预览图上（hover 绑定由 views 负责，paint 后几何信息自动更新）。 */
  function paintPrediction(res, p, ds) {
    if (!res || !res.cases || res.cases.length === 0) return;
    var last = res.cases[res.cases.length - 1];
    if (!last || !last.predictions) return;
    var view = $('#view');
    var canvas = view ? $('#seriesChart', view) : null;
    if (!canvas) return;
    TSJ.drawSeries(canvas, {
      values: ds.values,
      testStart: ds.values.length - p.horizon,
      predictions: last.predictions,
      height: 190
    });
  }

  /* ---------- 5. 左右分栏拖拽 ---------- */
  function bindSplitter(view) {
    var layout = $('#problemLayout', view);
    var splitter = $('#splitter', view);
    if (!layout || !splitter) return;

    var dragging = false;
    /** 拖拽中：按指针在 layout 内的横向比例设置分栏宽度（限 28%~68%）。 */
    function onMove(ev) {
      if (!dragging) return;
      var rect = layout.getBoundingClientRect();
      if (rect.width <= 0) return;
      var pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(28, Math.min(68, pct));
      layout.style.setProperty('--split', pct.toFixed(2) + '%');
    }

    splitter.addEventListener('pointerdown', function (ev) {
      dragging = true;
      try { splitter.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      document.body.classList.add('dragging');
      ev.preventDefault();
    });
    splitter.addEventListener('pointermove', onMove);

    /** 结束拖拽。 */
    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('dragging');
      if (typeof TSJ.redrawCharts === 'function') TSJ.redrawCharts();
    }

    splitter.addEventListener('pointerup', stopDrag);
    splitter.addEventListener('pointercancel', stopDrag);
    splitter.addEventListener('lostpointercapture', stopDrag);
  }

  TSJ.appUi = {
    mdInline: mdInline,
    md: md,
    canSubmit: canSubmit,
    setBusy: setBusy,
    verdictMiniClass: verdictMiniClass,
    renderCaseList: renderCaseList,
    renderGuardNotice: renderGuardNotice,
    renderResult: renderResult,
    paintPrediction: paintPrediction,
    bindSplitter: bindSplitter
  };
})(typeof window !== 'undefined' ? window : this);
