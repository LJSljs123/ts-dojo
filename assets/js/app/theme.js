/**
 * assets/js/app/theme.js —— 主题解析（system / light / dark）
 *
 * 只用经典 script 与 localStorage，不引入框架。system 通过 matchMedia 监听，
 * 并在路由 Scope 销毁时解绑；主题写入前做白名单校验，坏值回退为 system。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var doc = global.document;
  var core = TSJ.appCore;

  var VALID = { system: true, light: true, dark: true };
  var listeners = [];
  var media = null;
  var mediaHandler = null;
  var current = 'system';

  function readStored() {
    if (!core || typeof core.readJSON !== 'function') return 'system';
    var v = core.readJSON(core.STORE.theme, 'system', function (x) {
      return typeof x === 'string' && VALID[x] === true;
    });
    return VALID[v] ? v : 'system';
  }

  function systemPrefersLight() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function resolve(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return systemPrefersLight() ? 'light' : 'dark';
  }

  function apply(theme) {
    current = VALID[theme] ? theme : 'system';
    var resolved = resolve(current);
    if (doc && doc.documentElement) {
      doc.documentElement.setAttribute('data-theme', resolved);
      doc.documentElement.setAttribute('data-theme-mode', current);
    }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](resolved, current); } catch (e) { /* 观察者异常不影响主题切换 */ }
    }
  }

  function set(theme) {
    if (!VALID[theme]) return current;
    if (core && typeof core.writeJSON === 'function') core.writeJSON(core.STORE.theme, theme);
    apply(theme);
    return current;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /** 监听系统主题变化；返回解绑函数。 */
  function watchSystem() {
    if (!global.matchMedia) return function () {};
    media = global.matchMedia('(prefers-color-scheme: light)');
    mediaHandler = function () {
      if (current === 'system') apply('system');
    };
    if (media.addEventListener) media.addEventListener('change', mediaHandler);
    else if (media.addListener) media.addListener(mediaHandler);
    return function () {
      if (!media) return;
      if (media.removeEventListener) media.removeEventListener('change', mediaHandler);
      else if (media.removeListener) media.removeListener(mediaHandler);
      media = null;
      mediaHandler = null;
    };
  }

  function init() {
    apply(readStored());
  }

  TSJ.appTheme = {
    init: init,
    get: function () { return current; },
    resolved: function () { return resolve(current); },
    set: set,
    toggle: function () {
      return set(resolve(current) === 'dark' ? 'light' : 'dark');
    },
    onChange: onChange,
    watchSystem: watchSystem
  };
})(typeof window !== 'undefined' ? window : this);
