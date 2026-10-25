/**
 * assets/js/app/cmdk.js —— 全局命令面板（Ctrl/Cmd + K，v3.5）
 * 加载顺序：… app/boards → app/cmdk → app.js　挂载点：window.TSJ.appCmdk
 *
 * 一个输入框直达全站：题目 / 方法 / 课程 / 术语 + 快捷动作（随机一题、切主题）。
 * 复用 a11y.openModal 的焦点陷阱与 ESC 关闭；无依赖、无构建，数据全部来自内存索引。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var esc = core.esc;
  var a11y = TSJ.appA11y;

  var MAX_RESULTS = 12;
  var items = [];        // 当前展示的条目 { icon, label, sub, hash?, act? }
  var active = 0;

  /** 面板当前是否打开（以 a11y 的弹层状态 + 面板特征节点判断）。 */
  function isOpen() {
    return !!(a11y.modalOpen() && global.document.getElementById('cmdkInput'));
  }

  /* ---------- 索引构建 ---------- */
  /** 收集全部可跳转条目（内存即索引，量级 ~180，无需防抖）。 */
  function buildIndex() {
    var out = [];
    out.push({ icon: '🎲', label: '随机一题（优先未通过）', act: 'random' });
    out.push({ icon: '🌗', label: '切换深浅主题', act: 'theme' });
    out.push({ icon: '🧪', label: '打开可视化实验室', hash: '#/lab' });
    out.push({ icon: '🛠️', label: '打开模型工坊（自己搓模型跑实验）', hash: '#/studio' });
    var i;
    for (i = 0; i < (TSJ.problems || []).length; i++) {
      var p = TSJ.problems[i];
      out.push({ icon: '📝', label: '#' + p.index + ' ' + p.title, sub: '题库 · ' + p.difficulty,
        hay: (p.id + ' ' + p.title + ' ' + p.tags.join(' ')).toLowerCase(), hash: '#/problem/' + p.id });
    }
    for (i = 0; i < (TSJ.methods || []).length; i++) {
      var m = TSJ.methods[i];
      out.push({ icon: '📚', label: m.name, sub: '方法库 · ' + (m.venue || ''),
        hay: (m.name + ' ' + (m.title || '')).toLowerCase(), hash: '#/methods/' + m.id });
    }
    for (i = 0; i < (TSJ.courses || []).length; i++) {
      var c = TSJ.courses[i];
      out.push({ icon: '🎓', label: c.index + '. ' + c.title, sub: '课程 · 约 ' + c.minutes + ' 分钟',
        hay: (c.title + ' ' + c.summary).toLowerCase(), hash: '#/learn/' + c.id });
    }
    for (i = 0; i < (TSJ.glossary || []).length; i++) {
      var t = TSJ.glossary[i];
      out.push({ icon: '📖', label: t.term, sub: '术语 · ' + (t.en || ''),
        hay: (t.term + ' ' + t.en + ' ' + t.def).toLowerCase(), hash: '#/glossary' });
    }
    return out;
  }

  /** 过滤：无关键词给动作 + 未通过的题；有关键词按「前缀命中 > 包含」排序。 */
  function filter(q) {
    var all = buildIndex();
    var query = String(q || '').trim().toLowerCase();
    var i;
    if (!query) {
      var quick = all.slice(0, 2);
      for (i = 0; i < (TSJ.problems || []).length && quick.length < 8; i++) {
        var rec = TSJ.appStore.state.progress[TSJ.problems[i].id];
        if (!rec || rec.passed !== true) {
          var p = TSJ.problems[i];
          quick.push({ icon: '📝', label: '#' + p.index + ' ' + p.title, sub: '题库 · 未通过', hash: '#/problem/' + p.id });
        }
      }
      return quick;
    }
    var scored = [];
    for (i = 2; i < all.length; i++) {           // 跳过两个动作项（有关键词时只搜目标）
      var it = all[i];
      var hay = it.hay || (it.label + ' ' + (it.sub || '')).toLowerCase();
      var at = hay.indexOf(query);
      if (at < 0) continue;
      scored.push({ it: it, score: at === 0 ? 0 : (it.label.toLowerCase().indexOf(query) === 0 ? 1 : 2) });
    }
    scored.sort(function (a, b) { return a.score - b.score; });
    return scored.slice(0, MAX_RESULTS).map(function (s) { return s.it; });
  }

  /* ---------- 渲染 ---------- */
  function listHtml() {
    if (!items.length) {
      return '<div class="cmdk-empty">没有匹配的条目 —— 试试题号、方法名或「随机」。</div>';
    }
    return items.map(function (it, i) {
      return '<button type="button" class="cmdk-item' + (i === active ? ' cmdk-active' : '') +
        '" data-idx="' + i + '"><span class="cmdk-icon">' + it.icon + '</span>' +
        '<span class="cmdk-main"><span class="cmdk-label">' + esc(it.label) + '</span>' +
        (it.sub ? '<span class="cmdk-sub">' + esc(it.sub) + '</span>' : '') + '</span>' +
        '<span class="cmdk-go">↵</span></button>';
    }).join('');
  }

  function paint(root, q) {
    items = filter(q);
    active = 0;
    var host = core.$('#cmdkResults', root);
    if (host) host.innerHTML = listHtml();
  }

  /** 执行选中项：导航或动作，然后收面板。 */
  function runItem(root, idx) {
    var it = items[idx];
    if (!it) return;
    a11y.closeModal();
    if (it.act === 'theme') { TSJ.appTheme.toggle(); return; }
    if (it.act === 'random') { TSJ.appViews.goRandom(); return; }
    if (it.hash) global.location.hash = it.hash;
  }

  /* ---------- 打开 / 绑定 ---------- */
  function openPalette() {
    var root = a11y.modalOpen() ? global.document.getElementById('overlay') : null;
    var input = root ? core.$('#cmdkInput', root) : null;
    if (input) { paint(root, input.value); return; }   // 已打开：聚焦回输入框即可
    a11y.openModal({
      label: '命令面板',
      html: '<div class="cmdk">' +
        '<input id="cmdkInput" class="cmdk-input" type="text" autocomplete="off" spellcheck="false"' +
        ' placeholder="跳转到题目 / 方法 / 课程 / 术语，或输入命令…" aria-label="搜索或跳转">' +
        '<div id="cmdkResults" class="cmdk-results" role="listbox" aria-label="结果"></div>' +
        '<div class="cmdk-foot"><span>↑↓ 选择</span><span>↵ 跳转</span><span>ESC 关闭</span></div></div>'
    });
    root = a11y.modalOpen() ? global.document.getElementById('overlay') : null;
    input = core.$('#cmdkInput', root);
    if (!input) return;
    paint(root, '');

    input.addEventListener('input', function () { paint(root, input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!items.length) return;
        active = ev.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
        var host = core.$('#cmdkResults', root);
        var btns = core.$$('.cmdk-item', host);
        for (var i = 0; i < btns.length; i++) {
          btns[i].classList[Number(btns[i].getAttribute('data-idx')) === active ? 'add' : 'remove']('cmdk-active');
        }
        if (btns[active]) btns[active].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        runItem(root, active);
      }
    });
    var host = core.$('#cmdkResults', root);
    if (host) {
      host.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.cmdk-item') : null;
        if (btn) runItem(root, Number(btn.getAttribute('data-idx')));
      });
    }
  }

  /** 安装全局快捷键（应用启动时调用一次；监听随页面生存，无需解绑）。Ctrl/Cmd+K 切换开关。 */
  function install() {
    global.document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault();
        if (isOpen()) a11y.closeModal();
        else openPalette();
      }
    });
  }

  TSJ.appCmdk = { install: install, openPalette: openPalette, filter: filter };
})(typeof window !== 'undefined' ? window : this);
