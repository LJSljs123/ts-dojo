/**
 * assets/js/app/util.js —— 通用工具：转义、DOM 查询、格式化、防抖
 *
 * 加载顺序：util → core → store → storage → ui → a11y → views → problem → pages → app.js
 * 挂载点：window.TSJ.appUtil（core.js 会再导出一份，保持 core.esc / core.$ 这类调用点不变）
 *
 * 这里只放「与业务无关的纯工具」，不含任何状态、不读写存储。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /**
   * querySelector 简写（建议总传入 root，把查询限制在 #view 内）。
   * @param {string} sel 选择器
   * @param {Element|Document} [root] 根节点
   * @returns {Element|null}
   */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /**
   * querySelectorAll → 真数组（便于 forEach / map）。
   * @param {string} sel 选择器
   * @param {Element|Document} [root] 根节点
   * @returns {Element[]}
   */
  function $$(sel, root) {
    var list = (root || document).querySelectorAll(sel);
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  /**
   * HTML 转义（拼进 innerHTML 的文本一律先过这里）。
   * @param {*} s 任意值
   * @returns {string}
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 数字格式化（用于指标展示）：大数少小数，小数多小数。
   * @param {*} v 值
   * @returns {string}
   */
  function fmtNum(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 10000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    return v.toFixed(4);
  }

  /**
   * 时间格式化：YYYY-MM-DD HH:mm。非法时间戳返回占位符。
   * @param {number} ts 毫秒时间戳
   * @returns {string}
   */
  function fmtTime(ts) {
    if (!isFinite(ts) || ts <= 0) return '—';
    var d = new Date(ts);
    /** 补零。 */
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * 文件名里的日期戳：YYYYMMDD。
   * @param {number} [ts] 毫秒时间戳（缺省用当前时间）
   * @returns {string}
   */
  function fmtDateStamp(ts) {
    var d = new Date(isFinite(ts) && ts > 0 ? ts : Date.now());
    /** 补零。 */
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  /**
   * 简单防抖（最后一次调用后 wait 毫秒执行）。
   * @param {Function} fn 目标函数
   * @param {number} wait 毫秒
   * @returns {Function}
   */
  function debounce(fn, wait) {
    var timer = 0;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        timer = 0;
        fn.apply(self, args);
      }, wait);
    };
  }

  TSJ.appUtil = {
    $: $,
    $$: $$,
    esc: esc,
    fmtNum: fmtNum,
    fmtTime: fmtTime,
    fmtDateStamp: fmtDateStamp,
    debounce: debounce
  };
})(typeof window !== 'undefined' ? window : this);
