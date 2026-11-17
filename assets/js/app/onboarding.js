/**
 * assets/js/app/onboarding.js —— 首次进入引导
 *
 * 从 problem.js 抽出：引导属于整站第一课，不是某道题的附属弹层。
 * 关闭方式（主按钮、链到课程/第 1 题、ESC、「先四处看看」）都会记下已看过，
 * 避免下次进来再挡一次。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var a11y = TSJ.appA11y;
  var STORE = core.STORE;
  var $ = core.$;

  function isDone() {
    return core.readJSON(STORE.onboarded, false, function (v) { return typeof v === 'boolean'; }) === true;
  }

  function markDone() {
    if (!isDone()) core.writeJSON(STORE.onboarded, true);
  }

  /** 首次进入时的简短引导（弹层：焦点陷阱 + ESC 关闭 + 关闭后焦点回 #view）。 */
  function show() {
    if (isDone()) return;
    var html = [
      '<div class="modal modal-onboard">',
      '  <p class="onb-kicker">TSOJ · 时间序列预测在线判题</p>',
      '  <h2>欢迎来到时序竞技场</h2>',
      '  <div class="modal-flow">',
      '    <span class="flow-step">写 predict 函数</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">提交</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">打败基线得分</span><span class="flow-arrow">→</span>',
      '    <span class="flow-step">解锁题解</span>',
      '  </div>',
      '  <p>每道题只要实现一个函数：</p>',
      '  <p><code>predict(history, horizon, ctx) → number[]</code></p>',
      '  <ul>',
      '    <li>得分由「你的误差 ÷ 最优基线误差」决定，误差比越小分越高</li>',
      '    <li>误差比 = 0.5 得满分 100，等于阈值恰好得 60 分，≥ 2 得 0 分</li>',
      '    <li>全部测试点达标才算通过，通过后可查看参考实现</li>',
      '    <li>代码与成绩都存在浏览器本地，随时可以继续</li>',
      '  </ul>',
      '  <div class="modal-actions modal-actions-stack">',
      '    <a class="btn btn-primary" id="onbLesson" href="#/learn/m0">开始零基础第一课</a>',
      '    <a class="btn" id="onbProblem" href="#/problem/p1-naive">先做第 1 题</a>',
      '  </div>',
      '  <p class="onb-later"><button type="button" class="btn btn-ghost" id="onbLater">先四处看看</button></p>',
      '  <p class="onb-hint">之后可用 Ctrl / ⌘ + K 搜索全站，按 ? 查看快捷键。</p>',
      '</div>'
    ].join('\n');

    a11y.openModal({
      html: html,
      label: '欢迎来到时序竞技场',
      initialFocus: '#onbLesson',
      onClose: markDone
    });

    function finish() { markDone(); a11y.closeModal(); }
    var later = $('#onbLater');
    if (later) later.addEventListener('click', finish);
    // 课程 / 第 1 题是站内链接：由 links.js 导航，路由切换会关弹层并触发 onClose。
    // 这里再记一次，避免个别宿主只关弹层不走 onClose。
    ['onbLesson', 'onbProblem'].forEach(function (id) {
      var el = $('#' + id);
      if (el) el.addEventListener('click', markDone);
    });
  }

  TSJ.appOnboarding = { show: show, isDone: isDone, markDone: markDone };
})(typeof window !== 'undefined' ? window : this);
