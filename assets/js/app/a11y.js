/**
 * assets/js/app/a11y.js —— 可访问性基础件（T11）：弹层焦点管理、提示播报、页面标题
 *
 * 加载顺序：core → store → storage → ui → a11y → views → pages → app.js
 * 挂载点：window.TSJ.appA11y
 *
 * 约定：
 *   1. 所有弹层都复用 index.html 里的 `#overlay`（role="dialog" aria-modal="true"），
 *      打开时把 `#view` 与 `.topbar` 设为 inert，关闭时恢复；
 *   2. Tab 只在弹层内循环（焦点陷阱），ESC 关闭，关闭后焦点回到 `#view`；
 *   3. 轻提示走 `#toast`（role="status"），不做打断式弹窗。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;

  /** 可聚焦选择器（Tab 循环用） */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var overlay = null;
  var background = [];
  var isOpen = false;
  var onKeyDownBound = null;
  var closeCallback = null;
  var returnFocus = null;
  var toastTimer = 0;

  /** 取弹层容器。 */
  function getOverlay() {
    if (!overlay) overlay = document.getElementById('overlay');
    return overlay;
  }

  /** 收集容器内当前可聚焦元素（过滤不可见的）。 */
  function focusables(root) {
    var list = core.$$(FOCUSABLE, root);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getClientRects().length > 0 || el === document.activeElement) out.push(el);
    }
    return out;
  }

  /**
   * 把弹层以外的内容设为 inert（不支持 inert 的内核退化为 aria-hidden）。
   * @param {boolean} on 是否启用
   */
  function setBackgroundInert(on) {
    if (!background.length) {
      var view = document.getElementById('view');
      var topbar = document.querySelector('.topbar');
      if (view) background.push(view);
      if (topbar) background.push(topbar);
    }
    for (var i = 0; i < background.length; i++) {
      var el = background[i];
      if (on) {
        try { el.inert = true; } catch (e) { /* 老内核 */ }
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      } else {
        try { el.inert = false; } catch (e) { /* 老内核 */ }
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    }
  }

  /**
   * 焦点陷阱：Tab / Shift+Tab 在弹层内首尾循环。
   * @param {KeyboardEvent} ev 键盘事件
   */
  function trapTab(ev) {
    var ov = getOverlay();
    if (!ov) return;
    var list = focusables(ov);
    if (list.length === 0) { ev.preventDefault(); return; }
    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;
    if (ev.shiftKey) {
      if (active === first || !ov.contains(active)) {
        ev.preventDefault();
        last.focus();
      }
    } else if (active === last || !ov.contains(active)) {
      ev.preventDefault();
      first.focus();
    }
  }

  /** 关闭弹层并把焦点交还触发元素（无触发元素时回退到 #view）。 */
  function closeModal() {
    var ov = getOverlay();
    if (!ov || !isOpen) return;
    isOpen = false;
    ov.classList.add('hidden');
    ov.innerHTML = '';
    ov.removeAttribute('aria-label');
    if (onKeyDownBound) {
      document.removeEventListener('keydown', onKeyDownBound, true);
      onKeyDownBound = null;
    }
    setBackgroundInert(false);
    // 焦点必须回到「打开弹层的那个按钮」，而不是页面顶部：
    // 一律回 #view 会让键盘用户按完 Esc 就丢了位置，得从头 Tab 一遍。
    var back = returnFocus;
    returnFocus = null;
    if (!back || !document.contains(back) || typeof back.focus !== 'function') back = null;
    if (back) {
      try { back.focus(); } catch (e) { back = null; }
    }
    if (!back) focusView();
    var cb = closeCallback;
    closeCallback = null;
    if (typeof cb === 'function') cb();
  }

  /**
   * 打开弹层。
   * @param {Object} opts { html, label, onClose, initialFocus }
   * @returns {Object} { close }
   */
  function openModal(opts) {
    var ov = getOverlay();
    var options = opts || {};
    if (!ov) return { close: function () {} };

    // 若已有弹层，先收掉（保证同时只有一个 dialog）
    if (isOpen) closeModal();

    // 记下触发者：关闭时把焦点还回去。必须在设 inert 之前取，
    // inert 会先把 activeElement 打成 body。
    var active = document.activeElement;
    returnFocus = active && active !== document.body && active !== document.documentElement ? active : null;

    ov.innerHTML = String(options.html == null ? '' : options.html);
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    if (options.label) ov.setAttribute('aria-label', String(options.label));
    ov.classList.remove('hidden');
    isOpen = true;
    closeCallback = typeof options.onClose === 'function' ? options.onClose : null;
    setBackgroundInert(true);

    /** 全局键盘处理：ESC 关闭 + Tab 陷阱。 */
    onKeyDownBound = function (ev) {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        closeModal();
        return;
      }
      if (ev.key === 'Tab') trapTab(ev);
    };
    document.addEventListener('keydown', onKeyDownBound, true);

    var target = null;
    if (options.initialFocus) target = core.$(options.initialFocus, ov);
    if (!target) {
      var list = focusables(ov);
      target = list.length ? list[0] : null;
    }
    if (target) {
      try { target.focus(); } catch (e) { /* ignore */ }
    } else {
      try { ov.focus(); } catch (e) { /* ignore */ }
    }
    return { close: closeModal, root: ov };
  }

  /** 当前是否有弹层打开。 */
  function modalOpen() {
    return isOpen;
  }

  /**
   * 轻提示（role="status"，2.6s 后自动消失）。
   * @param {string} msg 文案
   * @param {string} [kind] 'ok' | 'warn' | 'err'
   */
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(msg == null ? '' : msg);
    el.className = 'toast toast-show' + (kind ? ' toast-' + kind : '');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      toastTimer = 0;
      el.className = 'toast';
    }, 2600);
  }

  /**
   * 更新页面标题。
   * @param {string} name 当前视图名（题目名 / 题库 / 提交记录 …）
   */
  function setTitle(name) {
    var suffix = '时序竞技场 TSOJ';
    document.title = name ? (name + ' · ' + suffix) : suffix;
  }

  /** 让 #view 获得焦点（路由切换后调用，读屏用户能感知内容已更新）。 */
  function focusView() {
    var view = document.getElementById('view');
    if (!view) return;
    if (!view.hasAttribute('tabindex')) view.setAttribute('tabindex', '-1');
    try { view.focus(); } catch (e) { /* ignore */ }
  }

  /**
   * 危险操作确认弹层（「清空本机进度」「清空实验记录」共用）。
   *
   * 抽出来的理由：两处原本各写一份几乎一样的 modal HTML，区别只在文案和
   * 确认后的回调。危险操作的口径必须全站一致——用户不会记得「这个清空有
   * 确认、那个没有」。id 前缀可传，是为了不破坏既有的 `#clearCancel` 选择器。
   *
   * @param {Object} o { title, body, hint, confirmText, idPrefix, onConfirm }
   * @returns {Object} openModal 的返回值 { close, root }
   */
  function confirmDanger(o) {
    var opts = o || {};
    var prefix = String(opts.idPrefix || 'danger');
    var html = [
      '<div class="modal">',
      '  <h2>' + core.esc(opts.title || '确认操作？') + '</h2>',
      '  <p>' + core.esc(opts.body || '') + '</p>',
      opts.hint ? '  <p>' + core.esc(opts.hint) + '</p>' : '',
      '  <div class="modal-actions">',
      '    <button type="button" class="btn" id="' + prefix + 'Cancel">取消</button>',
      '    <button type="button" class="btn btn-danger" id="' + prefix + 'Confirm">' +
        core.esc(opts.confirmText || '确认') + '</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    var handle = openModal({ html: html, label: opts.title || '确认操作', initialFocus: '#' + prefix + 'Cancel' });
    var cancel = document.getElementById(prefix + 'Cancel');
    var confirm = document.getElementById(prefix + 'Confirm');
    if (cancel) cancel.addEventListener('click', function () { closeModal(); });
    if (confirm) {
      confirm.addEventListener('click', function () {
        closeModal();
        if (typeof opts.onConfirm === 'function') opts.onConfirm();
      });
    }
    return handle;
  }

  TSJ.appA11y = {
    openModal: openModal,
    closeModal: closeModal,
    confirmDanger: confirmDanger,
    modalOpen: modalOpen,
    toast: toast,
    setTitle: setTitle,
    focusView: focusView,
    setBackgroundInert: setBackgroundInert
  };
})(typeof window !== 'undefined' ? window : this);
