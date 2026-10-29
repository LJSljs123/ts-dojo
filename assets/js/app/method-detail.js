/**
 * assets/js/app/method-detail.js —— 方法详情页 #/methods/:id
 *
 * 卡片字段仍来自 methods.js；本页只追加详情层与出口，不复制方法卡内容。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var content = TSJ.content;
  var esc = core.esc;

  var RUN_LABEL = {
    sandbox: { text: '可沙箱运行', cls: 'ds-badge-ok' },
    precomputed: { text: '预计算演示', cls: 'ds-badge-accent' },
    concept: { text: '概念级不可沙箱运行', cls: 'ds-badge-warn' }
  };

  function practiceButton(m) {
    if (!m.practice) return '<span class="ds-badge">暂无对应题目</span>';
    var p = TSJ.findProblem(m.practice);
    if (!p) return '<span class="ds-badge ds-badge-err">题目不存在：' + esc(m.practice) + '</span>';
    return '<a class="ds-btn ds-btn-primary" href="#/problem/' + encodeURIComponent(m.practice) + '">去练这道题</a>';
  }

  /** v3.1：方法已在实验室白名单内时给一个直达出口（不预设参数，避免“看起来像一键最优”）。 */
  function labButton(m) {
    if (!TSJ.labConfig || !TSJ.labConfig.METHODS[m.id]) {
      return '<span class="ds-badge">实验室未收录该方法</span>';
    }
    return '<a class="ds-btn" href="#/lab">去实验室对比该方法</a>';
  }

  function render(id, scope) {
    var m = TSJ.methodsById(id);
    var host = document.getElementById('view');
    if (!m) {
      // 用 hash 赋值而不是 location.replace('#/methods')：
      // replace 会按 base URL 解析片段，在 srcdoc / 不透明源里等于导航到宿主页（应用被卸载）
      if (global.location) global.location.hash = '#/methods';
      host.innerHTML = '<div class="ds-empty"><strong>方法不存在</strong><span>已返回方法库。</span><a class="ds-btn" href="#/methods">返回方法库</a></div>';
      TSJ.appA11y.setTitle('方法不存在');
      return;
    }
    var d = content.methodDetail(id) || {};
    var run = RUN_LABEL[d.runLevel] || RUN_LABEL.concept;
    var problems = TSJ.problems.filter(function (p) { return p.tags && p.tags.indexOf(m.name) >= 0; }).slice(0, 6);

    var html = [
      '<div class="crumb"><a href="#/methods">方法库</a> / <span>' + esc(m.name) + '</span></div>',
      '<div class="method-layout"><div>',
      '  <h1>' + esc(m.name) + '</h1>',
      '  <p class="ds-card-sub">' + esc(m.title) + ' · ' + esc(m.venue) + '</p>',
      '  <div class="course-tags"><span class="ds-badge ' + run.cls + '">' + run.text + '</span>' +
      m.tags.map(function (t) { return '<span class="ds-badge">' + esc(t) + '</span>'; }).join('') + '</div>',

      '  <div class="method-section"><h2>核心思想</h2><p>' + esc(m.idea) + '</p></div>',
      '  <div class="method-section"><h2>直觉解释</h2><p>' + esc(d.intuition || '') + '</p></div>',
      '  <div class="method-section"><h2>关键式子</h2><div class="md-formula"><div>' + esc(m.formula) + '</div></div></div>',
      '  <div class="method-section"><h2>什么时候用</h2><p>' + esc(m.when) + '</p></div>',
      '  <div class="method-section"><h2>假设与复杂度</h2><ul>' +
      (d.assumptions || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
      (d.complexity ? '<li>复杂度：' + esc(d.complexity) + '</li>' : '') + '</ul></div>',
      '  <div class="method-section"><h2>局限与反例</h2><p>' + esc(m.limit) + '</p><ul>' +
      (d.limitations || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
      '</ul><p><b>反例：</b>' + esc(d.counterexample || '') + '</p></div>',
      '  <div class="method-section"><h2>数值小例</h2><p>' + esc(d.workedExample || '') + '</p></div>',
      '  <div class="method-section"><h2>相关题目</h2>' +
      (problems.length ? '<ul>' + problems.map(function (p) {
        return '<li><a href="#/problem/' + encodeURIComponent(p.id) + '">' + esc(p.title) + '</a></li>';
      }).join('') + '</ul>' : '<p>暂无按标签匹配的题目。</p>') + '</div>',
      '  <div class="method-section"><h2>参考来源</h2>' + content.referenceListHtml(d.referenceIds || []) + '</div>',
      '</div>',
      '<aside class="method-aside">',
      '  <div class="ds-card"><h2 class="ds-card-title">出口</h2><div class="method-facts">',
      '    <div class="method-fact"><span>对应题目</span><b>' + (m.practice ? esc(m.practice) : '无') + '</b></div>',
      '    <div class="method-fact"><span>运行级别</span><b>' + run.text + '</b></div>',
      '    <div class="method-fact"><span>方法层次</span><b>' + esc(m.tier) + '</b></div>',
      '  </div>' + practiceButton(m),
      '  ' + labButton(m),
      '  <p><a class="ds-btn" href="#/methods">返回方法库</a></p></div>',
      '  <div class="ds-card"><h2 class="ds-card-title">方法卡字段</h2><div class="method-facts">',
      '    <div class="method-fact"><span>发表处</span><b>' + esc(m.venue) + '</b></div>',
      '    <div class="method-fact"><span>作者</span><b>' + esc(m.authors || '—') + '</b></div>',
      '    <div class="method-fact"><span>年份</span><b>' + esc(m.year || '—') + '</b></div>',
      '  </div></div>',
      '</aside></div>'
    ].join('\n');
    host.innerHTML = html;
    if (TSJ.appAchievements) TSJ.appAchievements.onMethodView(id);
    TSJ.appA11y.setTitle(m.name + ' · 方法详情');
  }

  TSJ.appMethodDetail = { render: render };
})(typeof window !== 'undefined' ? window : this);
