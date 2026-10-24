/**
 * assets/js/app/learn.js —— 课程地图与模块页
 *
 * 课程内容全部来自 content/*，本模块只负责渲染、进度与出口链接。
 * 演示分三级：sandbox 跳实验室、concept 显示流程说明，不冒充运行。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var content = TSJ.content;
  var esc = core.esc;
  var KEY = core.STORE.courseProgress;

  function readProgress() {
    return core.readJSON(KEY, {}, function (v) {
      return v && typeof v === 'object' && !Array.isArray(v);
    });
  }

  function writeProgress(p) { core.writeJSON(KEY, p); }

  function progressOf(p, id) { return !!(p && p[id] && p[id].done); }

  function doneCount(p) {
    var n = 0;
    for (var i = 0; i < TSJ.courses.length; i++) if (progressOf(p, TSJ.courses[i].id)) n++;
    return n;
  }

  function moduleCard(c, p) {
    var done = progressOf(p, c.id);
    var prereq = (c.prereq || []).map(function (id) {
      var pc = content.course(id);
      return pc ? pc.title : id;
    });
    return [
      '<article class="course-module">',
      '  <div class="course-num">' + c.index + '</div>',
      '  <div>',
      '    <h3><a href="#/learn/' + encodeURIComponent(c.id) + '">' + esc(c.title) + '</a></h3>',
      '    <p>' + esc(c.summary) + '</p>',
      '    <div class="course-tags">',
      '      <span class="ds-badge">' + esc(c.level) + '</span>',
      '      <span class="ds-badge">约 ' + c.minutes + ' 分钟</span>',
      prereq.length ? '<span class="ds-badge">先修：' + esc(prereq.join('、')) + '</span>' : '<span class="ds-badge">无先修</span>',
      done ? '<span class="ds-badge ds-badge-ok">已完成</span>' : '<span class="ds-badge">未完成</span>',
      '    </div>',
      '  </div>',
      '</article>'
    ].join('\n');
  }

  function renderMap(scope) {
    var p = readProgress();
    var host = document.getElementById('view');
    var html = [
      '<div class="wk-hero"><div class="wk-hero-main">',
      '  <div class="wk-kicker">课程地图</div>',
      '  <h1>时序预测完整学习路径</h1>',
      '  <p>8 个模块覆盖数据基础、经典统计、机器学习、深度学习、概率预测、基础模型、评测与业务实践。先修关系明确，每个模块都有演示、练习与可核查来源。</p>',
      '  <div class="wk-cta-row">',
      '    <a class="ds-btn ds-btn-primary" href="#/learn/m1">从第 1 模块开始</a>',
      '    <a class="ds-btn" href="#/lab">进入可视化实验室</a>',
      '  </div>',
      '</div>',
      '<div class="wk-side-stack">',
      '  <div class="ds-card"><h2 class="ds-card-title">学习进度</h2><p class="ds-card-sub">完成度只保存在本机。</p>',
      '  <div class="wk-metric-grid"><div class="wk-metric"><span>已完成模块</span><b>' + doneCount(p) + ' / ' + TSJ.courses.length + '</b><small>点击模块内「标记完成」更新</small></div></div>',
      '</div></div></div>',
      '<div class="course-map">'
    ];
    var sorted = TSJ.courses.slice().sort(function (a, b) { return a.index - b.index; });
    for (var i = 0; i < sorted.length; i++) html.push(moduleCard(sorted[i], p));
    html.push('</div>');
    host.innerHTML = html.join('\n');
    TSJ.appA11y.setTitle('课程地图');
  }

  function demoPanel(c) {
    if (!c.demo) return '';
    if (c.demo.kind === 'sandbox') {
      var preset = c.demo.id ? '?demo=' + encodeURIComponent(c.demo.id) : '';
      return [
        '<div class="course-panel"><h3>交互演示</h3>',
        '<p>该演示在实验室中用内置方法实时计算，不执行你的代码，也不使用测试真值调参。</p>',
        '<p><a class="ds-btn ds-btn-primary" href="#/lab' + preset + '">' + esc(c.demo.label || '打开演示') + '</a></p>',
        '</div>'
      ].join('\n');
    }
    return [
      '<div class="course-panel"><h3>引导演示（概念级）</h3>',
      '<p>' + esc(c.demo.label || '') + '</p>',
      '<ol><li>输入序列 → 缩放 / 分 patch / token 化</li><li>预训练权重前向推理</li><li>输出分位数 / 区间</li><li>用基线与校准检查评估，不轻信零样本分数</li></ol>',
      '<p class="md-note"><span>⚠</span><span>概念级：浏览器不下载权重、不训练基础模型；此处只说明流程与边界。</span></p>',
      '</div>'
    ].join('\n');
  }

  function exercisePanel(c) {
    var problems = (c.exercise && c.exercise.problemIds || []).map(function (id) {
      var p = TSJ.findProblem(id);
      return p ? '<li><a href="#/problem/' + encodeURIComponent(id) + '">' + esc(p.title) + '</a></li>' : '';
    }).join('');
    return [
      '<div class="course-panel"><h3>练习与产出</h3>',
      '<p>' + esc((c.exercise && c.exercise.output) || '') + '</p>',
      problems ? '<ul>' + problems + '</ul>' : '<p>本模块以文字产出为主，不绑定具体判题题。</p>',
      '</div>'
    ].join('\n');
  }

  function renderModule(id, scope) {
    var c = content.course(id);
    var host = document.getElementById('view');
    if (!c) {
      host.innerHTML = '<div class="ds-empty"><strong>模块不存在</strong><span>这个课程 ID 没有对应内容。</span><a class="ds-btn" href="#/learn">返回课程地图</a></div>';
      TSJ.appA11y.setTitle('模块不存在');
      return;
    }
    var p = readProgress();
    var done = progressOf(p, c.id);
    var next = content.nextCourse(c.id);
    var prev = content.prevCourse(c.id);
    var html = [
      '<div class="crumb"><a href="#/learn">课程地图</a> / <span>' + esc(c.title) + '</span></div>',
      '<article class="course-article">',
      '  <h1>' + esc(c.index + '. ' + c.title) + '</h1>',
      '  <p class="ds-card-sub">' + esc(c.summary) + '</p>',
      '  <div class="course-tags"><span class="ds-badge">' + esc(c.level) + '</span><span class="ds-badge">约 ' + c.minutes + ' 分钟</span>' +
      (done ? '<span class="ds-badge ds-badge-ok">已完成</span>' : '<span class="ds-badge">未完成</span>') + '</div>',
      content.renderCourseBody(c),
      demoPanel(c),
      exercisePanel(c),
      '<div class="course-panel"><h3>反例与常见错误</h3><ul>' +
      (c.counterexamples || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>',
      '<div class="course-panel"><h3>参考来源</h3>' + content.referenceListHtml(c.referenceIds) + '</div>',
      '<div class="course-panel"><h3>完成度</h3><p>标记完成只写入本机，不参与排行榜。</p>',
      '  <button class="ds-btn ' + (done ? '' : 'ds-btn-primary') + '" id="btnCourseDone" data-done="' + (done ? '1' : '0') + '">' + (done ? '取消完成标记' : '标记本模块完成') + '</button>',
      '</div>',
      '<div class="wk-cta-row">',
      prev ? '<a class="ds-btn" href="#/learn/' + encodeURIComponent(prev.id) + '">上一课：' + esc(prev.title) + '</a>' : '',
      next ? '<a class="ds-btn ds-btn-primary" href="#/learn/' + encodeURIComponent(next.id) + '">下一课：' + esc(next.title) + '</a>' : '<a class="ds-btn ds-btn-primary" href="#/lab">进入实验室</a>',
      '</div>',
      '</article>'
    ].join('\n');
    host.innerHTML = html;

    var btn = document.getElementById('btnCourseDone');
    if (btn) {
      btn.addEventListener('click', function () {
        var prog = readProgress();
        var isDone = btn.getAttribute('data-done') === '1';
        if (isDone) delete prog[c.id];
        else prog[c.id] = { done: true, at: Date.now() };
        writeProgress(prog);
        TSJ.appA11y.toast(isDone ? '已取消完成标记' : '已标记完成：' + c.title, 'ok');
        renderModule(c.id, scope);
      });
    }
    TSJ.appA11y.setTitle(c.title + ' · 课程');
  }

  TSJ.appLearn = { renderMap: renderMap, renderModule: renderModule, readProgress: readProgress, doneCount: doneCount };
})(typeof window !== 'undefined' ? window : this);
