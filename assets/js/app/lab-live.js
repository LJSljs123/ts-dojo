/**
 * assets/js/app/lab-live.js —— 实验室「实时调节」滑杆（v3.5）
 * 加载顺序：… app/lab-panels → app/lab-live → app/lab.js　挂载点：window.TSJ.appLabLive
 *
 * 职责边界：本模块只负责滑杆的「渲染 + 取值 + 数值输入框同步」；
 * 重算与落图由 app/lab.js 的回调完成（onChange）。拖动不写存储——
 * 正式记录仍走「运行实验」，但滑杆会同步进配置面板的数字输入框，
 * 保证「拖出来看到的效果 = 点运行后保存的效果」。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var esc = core.esc;

  /**
   * 渲染滑杆区 HTML。
   * @param {Object} cfg 已归一化的实验室配置（取 method 与 params）
   * @returns {string} HTML；方法无可调参数时返回空串（调用方隐藏容器）
   */
  function render(cfg) {
    var meta = TSJ.labConfig.METHODS[cfg.method];
    if (!meta) return '';
    var keys = Object.keys(meta.params);
    if (!keys.length) return '';
    var rows = keys.map(function (key) {
      var rule = meta.params[key];
      var v = cfg.params[key] != null ? cfg.params[key] : rule.def;
      return '<div class="lab-live-param">' +
        '<div class="lab-live-head"><label for="live-' + esc(key) + '">' + esc(key) + '</label>' +
        '<output id="live-' + esc(key) + '-val">' + esc(v) + '</output></div>' +
        '<input type="range" id="live-' + esc(key) + '" data-param="' + esc(key) + '"' +
        ' min="' + rule.min + '" max="' + rule.max + '" step="' + rule.step + '" value="' + esc(v) + '"' +
        ' aria-label="实时调节 ' + esc(key) + '（' + rule.min + ' 到 ' + rule.max + '，步长 ' + rule.step + '）">' +
        '</div>';
    });
    return '<div class="lab-live">' +
      '<div class="lab-live-title"><b>实时调节</b>' +
      '<span>拖动即重算本图（不写入记录）；点「运行实验」按当前滑杆值正式保存</span></div>' +
      '<div class="lab-live-grid">' + rows.join('') + '</div>' +
      '</div>';
  }

  /**
   * 绑定滑杆事件。
   * @param {Object} opts { onChange: function(params) } —— 防抖后的重算回调
   * @returns {Function} unbind（路由销毁时可调用；本次实现随 DOM 一起销毁，无需显式解绑）
   */
  function bind(opts) {
    var zone = global.document.getElementById('labLiveZone');
    if (!zone) return function () {};
    var inputs = core.$$('input[type="range"]', zone);
    if (!inputs.length) return function () {};

    /** 把当前滑杆值同步回配置面板的数字输入框（保证「所见 = 所保存」）。 */
    function syncNumberInputs() {
      inputs.forEach(function (i) {
        var el = global.document.getElementById('param-' + i.getAttribute('data-param'));
        if (el) el.value = i.value;
      });
    }

    var notify = core.debounce(function () {
      if (typeof opts.onChange === 'function') opts.onChange(currentParams());
    }, 90);

    inputs.forEach(function (i) {
      i.addEventListener('input', function () {
        var out = global.document.getElementById(i.id + '-val');
        if (out) out.textContent = i.value;
        syncNumberInputs();
        notify();
      });
    });

    return function () { /* 占位：监听随 #labLiveZone 一起被 innerHTML 重建销毁 */ };
  }

  /** 当前滑杆值（{param: number}）。 */
  function currentParams() {
    var zone = global.document.getElementById('labLiveZone');
    var out = {};
    if (!zone) return out;
    core.$$('input[type="range"]', zone).forEach(function (i) {
      var v = Number(i.value);
      if (isFinite(v)) out[i.getAttribute('data-param')] = v;
    });
    return out;
  }

  /** 清空渲染（方法切换后旧滑杆失效时调用）。 */
  function reset() {
    var zone = global.document.getElementById('labLiveZone');
    if (zone) zone.innerHTML = '';
  }

  TSJ.appLabLive = { render: render, bind: bind, currentParams: currentParams, reset: reset };
})(typeof window !== 'undefined' ? window : this);
