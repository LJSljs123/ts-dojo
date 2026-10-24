/**
 * assets/js/app/lifecycle.js —— 路由级生命周期（Scope）
 *
 * 目标：把「事件监听 / 定时器 / ResizeObserver / 子销毁器」统一登记到当前路由的
 * Scope 上，路由切换时一次性销毁。这样图表 hover、实验室轮询、抽屉监听都不会
 * 跨页面累积，也不用再靠“猜测某个全局变量还在不在”来防泄漏。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /**
   * 创建一个可统一销毁的作用域。
   * @returns {Object} Scope
   */
  function createScope(name) {
    var disposers = [];
    var children = [];
    var destroyed = false;

    function listen(target, type, handler, options) {
      if (!target || !target.addEventListener) return function () {};
      target.addEventListener(type, handler, options);
      var off = function () {
        target.removeEventListener(type, handler, options);
      };
      disposers.push(off);
      return off;
    }

    function timeout(fn, ms) {
      var id = global.setTimeout(function () {
        var i = disposers.indexOf(clear);
        if (i >= 0) disposers.splice(i, 1);
        if (!destroyed) fn();
      }, ms);
      function clear() { global.clearTimeout(id); }
      disposers.push(clear);
      return clear;
    }

    function interval(fn, ms) {
      var id = global.setInterval(function () {
        if (!destroyed) fn();
      }, ms);
      function clear() { global.clearInterval(id); }
      disposers.push(clear);
      return clear;
    }

    function own(child) {
      if (!child) return child;
      if (typeof child === 'function') {
        disposers.push(child);
        return child;
      }
      if (typeof child.destroy === 'function') {
        children.push(child);
        return child;
      }
      return child;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (var i = 0; i < children.length; i++) {
        try { children[i].destroy(); } catch (e) { /* 单个子项失败不应阻断其他销毁 */ }
      }
      children.length = 0;
      for (var j = 0; j < disposers.length; j++) {
        try { disposers[j](); } catch (e2) { /* 同上 */ }
      }
      disposers.length = 0;
    }

    return {
      name: name || 'scope',
      listen: listen,
      timeout: timeout,
      interval: interval,
      own: own,
      destroy: destroy,
      isDestroyed: function () { return destroyed; }
    };
  }

  TSJ.appLifecycle = { createScope: createScope };
})(typeof window !== 'undefined' ? window : this);
