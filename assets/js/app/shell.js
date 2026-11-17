/**
 * assets/js/app/shell.js —— 顶栏「更多」菜单、命令面板入口、快捷键说明
 *
 * 11 个导航项在常见笔记本宽度下会把后面的「学习报告 / 学习路径」裁掉，
 * 且滚动条被藏起来，用户不知道后面还有页。主栏目只留常用入口，其余进「更多」。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var $ = core.$;

  function isTypingTarget(el) {
    if (!el || el === document.body) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (typeof el.closest === 'function' && el.closest('.tsj-editor-host, .editor-host, [contenteditable="true"]')) {
      return true;
    }
    return false;
  }

  function closeMore() {
    var btn = $('#btnNavMore');
    var menu = $('#navMoreMenu');
    if (!btn || !menu) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function toggleMore() {
    var btn = $('#btnNavMore');
    var menu = $('#navMoreMenu');
    if (!btn || !menu) return;
    var open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var first = menu.querySelector('a');
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
    }
  }

  function syncMoreState() {
    var btn = $('#btnNavMore');
    var menu = $('#navMoreMenu');
    if (!btn || !menu) return;
    var on = !!menu.querySelector('a[aria-current="page"]');
    btn.classList.toggle('is-current', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }

  function wrapSetActiveNav() {
    var store = TSJ.appStore;
    if (!store || typeof store.setActiveNav !== 'function' || store.setActiveNav._tsojWrapped) return;
    var prev = store.setActiveNav;
    function wrapped(name) {
      prev(name);
      syncMoreState();
    }
    wrapped._tsojWrapped = true;
    store.setActiveNav = wrapped;
  }

  function showShortcuts() {
    var a11y = TSJ.appA11y;
    var rows = [
      ['Ctrl / ⌘ + K', '打开命令面板，搜索题目、方法、课程、术语'],
      ['?', '打开本快捷键说明'],
      ['Ctrl / ⌘ + Enter', '在题目页运行当前代码（不记成绩）'],
      ['Ctrl / ⌘ + S', '保存当前题目的代码草稿'],
      ['Esc', '关闭弹层或收起菜单']
    ];
    var body = rows.map(function (r) {
      return '<div class="ks-row"><kbd>' + core.esc(r[0]) + '</kbd><span>' + core.esc(r[1]) + '</span></div>';
    }).join('');
    a11y.openModal({
      label: '键盘快捷键',
      initialFocus: '#ksClose',
      html: '<div class="modal modal-keys">' +
        '<h2>键盘快捷键</h2>' +
        '<p>在输入框或代码编辑器里打字时，这些快捷键不会抢键。</p>' +
        '<div class="ks-list">' + body + '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-primary" id="ksClose">知道了</button></div>' +
        '</div>'
    });
    var close = $('#ksClose');
    if (close) close.addEventListener('click', function () { a11y.closeModal(); });
  }

  function install(scope) {
    wrapSetActiveNav();
    syncMoreState();

    var moreBtn = $('#btnNavMore');
    var moreMenu = $('#navMoreMenu');
    if (moreBtn && moreMenu && scope) {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
      scope.listen(moreBtn, 'click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleMore();
      });
      scope.listen(moreMenu, 'click', function (ev) {
        if (ev.target && ev.target.tagName === 'A') closeMore();
      });
      scope.listen(document, 'click', function (ev) {
        var wrap = $('#navMore');
        if (!wrap || moreMenu.hidden) return;
        if (wrap.contains(ev.target)) return;
        closeMore();
      });
    }

    function openCmdk() {
      closeMore();
      if (TSJ.appCmdk && typeof TSJ.appCmdk.openPalette === 'function') TSJ.appCmdk.openPalette();
    }
    function openKeys() {
      closeMore();
      showShortcuts();
    }

    var cmdkBtn = $('#btnCmdk');
    if (cmdkBtn && scope) scope.listen(cmdkBtn, 'click', openCmdk);
    var drawerCmdk = $('#btnDrawerCmdk');
    if (drawerCmdk && scope) scope.listen(drawerCmdk, 'click', openCmdk);
    var drawerKeys = $('#btnDrawerKeys');
    if (drawerKeys && scope) scope.listen(drawerKeys, 'click', openKeys);
    var moreKeys = $('#btnMoreKeys');
    if (moreKeys && scope) scope.listen(moreKeys, 'click', openKeys);
    var moreOnb = $('#btnMoreOnboard');
    if (moreOnb && scope) {
      scope.listen(moreOnb, 'click', function () {
        closeMore();
        if (TSJ.appOnboarding) {
          // 允许再看一次：清标记后弹出
          core.writeJSON(core.STORE.onboarded, false);
          TSJ.appOnboarding.show();
        }
      });
    }

    if (scope) {
      scope.listen(document, 'keydown', function (ev) {
        if (ev.key === 'Escape' || ev.key === 'Esc') closeMore();
        if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isTypingTarget(ev.target)) return;
        if (TSJ.appA11y && TSJ.appA11y.modalOpen()) return;
        var ask = ev.key === '?' || (ev.key === '/' && ev.shiftKey);
        if (!ask) return;
        ev.preventDefault();
        showShortcuts();
      });
    }
  }

  TSJ.appShell = { install: install, showShortcuts: showShortcuts, closeMore: closeMore };
})(typeof window !== 'undefined' ? window : this);
