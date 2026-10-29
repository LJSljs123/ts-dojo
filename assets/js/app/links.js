/**
 * assets/js/app/links.js —— 站内链接的点击语义
 *
 * 为什么需要单独一个模块（不是「顺手加个拦截」）：
 *
 *   应用用 hash 做路由，全站靠 `<a href="#/problems">` 跳转。普通页面里这是
 *   **同文档片段导航**，浏览器只改片段、不重新加载。但在 `srcdoc` / 不透明源
 *   环境里（预览面板、文档阅读器把 HTML 塞进 `<iframe srcdoc="...">`），
 *   文档自己的 URL 是 `about:srcdoc` —— **它没有 base URL**，片段要按父页面的
 *   base 解析，于是 `#/problems` 变成 `file:///.../host.html#/problems`：
 *   那是另一个 URL，浏览器执行**真实导航**，把 iframe 指向宿主页面。
 *
 *   结果：点任何站内链接，应用整个被卸载（`window.TSJ` 消失），用户看到的是
 *   「点哪个都没反应」。（已实测：点击后 iframe URL 从 `about:srcdoc#/` 变成
 *   宿主页地址，`TSJ` 从 60 个键掉到 2 个。）
 *
 * 修法：接管 `#` 链接的点击，改成给 `location.hash` 赋值。
 *   `location.hash = '#/x'` 只改**当前 URL 的片段**，不做相对解析、不触发导航，
 *   在 srcdoc 里同样安全（实测：URL 变 `about:srcdoc#/problems`，视图正常渲染）。
 *
 * 第二件事：`#view`（「跳到主要内容」）这类**非路由锚点**。
 *   路由把 `#view` 解析成未知视图，兜底渲染成题库 —— 点跳转链接会被带到题库。
 *   这里按锚点语义处理：滚动 + 聚焦，**不碰 hash**。
 *
 * 边界（都不接管，交给浏览器默认行为）：
 *   - 带修饰键 / 非左键（用户想新标签页打开）；
 *   - `target` 不是 `_self`；
 *   - `download` 属性；
 *   - 外部链接（`href` 不以 `#` 开头）；
 *   - 找不到目标元素的自定义锚点。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /** 接管点击时排除的修饰键（保留「新标签页 / 新窗口」的原生行为）。 */
  function isPlainClick(ev) {
    return ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
  }

  /**
   * 处理一次点击。返回 true 表示已接管（调用方应 preventDefault）。
   *
   * @param {MouseEvent} ev 点击事件
   * @returns {boolean} 是否接管
   */
  function handle(ev) {
    if (ev.defaultPrevented || !isPlainClick(ev)) return false;
    var target = ev.target;
    if (!target || typeof target.closest !== 'function') return false;

    var a = target.closest('a[href]');
    if (!a) return false;
    if (a.hasAttribute('download')) return false;
    var t = a.getAttribute('target');
    if (t && t !== '_self') return false;

    var href = (a.getAttribute('href') || '').trim();
    if (href.charAt(0) !== '#') return false;

    // 路由链接：交给 router.navigate —— 它**先渲染再同步地址栏**。
    // 不能只写 `location.hash = href`：在不透明源（sandbox 无 allow-same-origin）里
    // 这句既不抛错也不生效，于是没有 hashchange、没有渲染，表现就是「点了没反应」。
    if (href.indexOf('#/') === 0 || href === '#') {
      ev.preventDefault();
      if (href === '#') { global.scrollTo(0, 0); return true; }
      if (TSJ.appRouter && typeof TSJ.appRouter.navigate === 'function') {
        TSJ.appRouter.navigate(href);
      } else if (global.location.hash !== href) {
        global.location.hash = href;
      }
      return true;
    }

    // 非路由锚点（如 #view）：滚动 + 聚焦，不改 hash（否则会被当成路由）
    var el = null;
    try { el = global.document.getElementById(href.slice(1)); } catch (e) { el = null; }
    if (!el) return false;
    ev.preventDefault();
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { el.focus(); } catch (e) { /* 忽略：元素不可聚焦时仅滚动 */ }
    return true;
  }

  /** 绑定一次（重复调用不会重复绑定）。 */
  function bind() {
    if (bind.done) return;
    bind.done = true;
    global.document.addEventListener('click', handle, false);
  }

  TSJ.appLinks = { bind: bind, handle: handle };
})(window);
