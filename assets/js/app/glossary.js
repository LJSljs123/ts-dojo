/**
 * assets/js/app/glossary.js —— 新手术语表页面：#/glossary
 * 加载顺序：… app/library → app/glossary → app/boards → app.js　挂载点：window.TSJ.appGlossary
 * 数据来自 assets/js/content/glossary.js（内容层，只读）：本文件只做「搜索 + 分类 → 卡片」的映射。
 * 约定与 library.js 一致：数量现算、分类与搜索取交集、可见文案一律过 esc()、
 * 空态带「清除筛选」；术语卡默认全部展开（短文本，无需折叠）。
 */
(function (global) {
  'use strict';
  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore, $ = core.$, $$ = core.$$, esc = core.esc;
  var view = { query: '', cat: 'all' };   // 每次进入重建为默认态

  function allTerms() { return TSJ.glossary || []; }
  function allCats() { return TSJ.glossaryCategories || []; }

  /** 某分类的术语数；'all' 返回总数。 */
  function countOf(catId) {
    if (catId === 'all') return allTerms().length;
    return allTerms().filter(function (t) { return t.cat === catId; }).length;
  }

  /** 分类 id → 中文名。 */
  function catName(id) {
    var cats = allCats();
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].name;
    return id;
  }

  /** 分类 + 搜索取交集；搜索覆盖 term / en / def，大小写不敏感。 */
  function matches(t) {
    if (view.cat !== 'all' && t.cat !== view.cat) return false;
    var q = String(view.query || '').trim().toLowerCase();
    if (!q) return true;
    return [t.term, t.en, t.def].join(' \n ').toLowerCase().indexOf(q) >= 0;
  }

  /* ---------- 卡片 ---------- */
  /** 术语卡内的站内跳转（课程 / 方法 / 题目三选一，id 已由内容层保证存在）。 */
  function linkHtml(t) {
    if (!t.links) return '';
    if (t.links.course) {
      return '<a class="btn btn-ghost g-link" href="#/learn/' + esc(t.links.course) + '">去看课程模块</a>';
    }
    if (t.links.method) {
      return '<a class="btn btn-ghost g-link" href="#/methods/' + esc(t.links.method) + '">去看方法卡</a>';
    }
    if (t.links.problem) {
      return '<a class="btn btn-ghost g-link" href="#/problem/' + esc(t.links.problem) + '">去做这道题</a>';
    }
    return '';
  }

  /** 相关术语（可点击锚点：点击等于把该词填进搜索框）。 */
  function seeHtml(t) {
    if (!t.see || !t.see.length) return '';
    var names = [];
    for (var i = 0; i < t.see.length; i++) {
      var other = termById(t.see[i]);
      if (other) names.push('<button type="button" class="chip chip-sm" data-seeterm="' + esc(other.id) + '">' +
        esc(other.term) + '</button>');
    }
    if (!names.length) return '';
    return '<div class="g-see"><span class="g-see-label">相关</span>' + names.join('') + '</div>';
  }

  function termById(id) {
    var list = allTerms();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function cardHtml(t) {
    return '<article class="gcard" data-gid="' + esc(t.id) + '" data-cat="' + esc(t.cat) + '">' +
      '<div class="g-head"><span class="g-term">' + esc(t.term) + '</span>' +
      '<span class="g-en">' + esc(t.en) + '</span>' +
      '<span class="g-cat">' + esc(catName(t.cat)) + '</span></div>' +
      '<p class="g-def">' + esc(t.def) + '</p>' +
      seeHtml(t) + linkHtml(t) +
      '</article>';
  }

  /* ---------- 渲染与绑定 ---------- */
  function chipsHtml() {
    var cats = allCats();
    var out = ['  <button type="button" class="chip chip-on" data-cat="all">全部(' + countOf('all') + ')</button>'];
    for (var i = 0; i < cats.length; i++) {
      out.push('  <button type="button" class="chip" data-cat="' + esc(cats[i].id) + '">' +
        esc(cats[i].name) + '(' + countOf(cats[i].id) + ')</button>');
    }
    return out.join('\n');
  }

  function paintChips() {
    var root = $('#view');
    if (!root) return;
    var chips = $$('.chip[data-cat]', root);
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList[chips[i].getAttribute('data-cat') === view.cat ? 'add' : 'remove']('chip-on');
    }
  }

  function clearFilters() {
    view.query = '';
    view.cat = 'all';
    var input = $('#glossarySearch');
    if (input) input.value = '';
    paintChips();
    paintList();
  }

  function syncClearBtn() {
    var btn = $('#btnGlossaryClear');
    if (!btn) return;
    var on = String(view.query || '').trim() !== '' || view.cat !== 'all';
    if (on) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  /** 重绘术语列表（空态带「清除筛选」）。 */
  function paintList() {
    var host = $('#glossaryList');
    if (!host) return;
    var list = allTerms();
    var out = [], shown = 0;
    for (var i = 0; i < list.length; i++) {
      if (!matches(list[i])) continue;
      shown++;
      out.push(cardHtml(list[i]));
    }
    if (shown === 0) {
      out.push('<div class="empty"><span class="empty-icon">◌</span>没有匹配的术语。<br>' +
        '<button type="button" class="btn" data-clear="1">清除筛选</button></div>');
    }
    host.innerHTML = '<div class="gcards">\n' + out.join('\n') + '\n</div>';
    var clears = $$('[data-clear]', host);
    for (var c = 0; c < clears.length; c++) clears[c].addEventListener('click', clearFilters);
    var sees = $$('[data-seeterm]', host);
    for (var s = 0; s < sees.length; s++) {
      sees[s].addEventListener('click', function () {
        var other = termById(this.getAttribute('data-seeterm'));
        var input = $('#glossarySearch');
        if (!other || !input) return;
        input.value = other.term;
        view.query = other.term;
        paintList();
        syncClearBtn();
      });
    }
    syncClearBtn();
  }

  function bindShell(root) {
    var input = $('#glossarySearch', root);
    if (input) {
      input.addEventListener('input', core.debounce(function () {
        view.query = input.value;
        paintList();
      }, 120));
    }
    var chips = $$('.chip[data-cat]', root);
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        view.cat = this.getAttribute('data-cat');
        paintChips();
        paintList();
      });
    }
    var btnClear = $('#btnGlossaryClear', root);
    if (btnClear) btnClear.addEventListener('click', clearFilters);
  }

  /** 渲染术语表页面（路由入口，每次进入都回到默认态）。 */
  function renderGlossary() {
    var root = $('#view');
    if (!root) return;
    view = { query: '', cat: 'all' };
    if (TSJ.appAchievements) TSJ.appAchievements.onGlossaryLook();   // 词典编纂者：每次进入算一次
    root.innerHTML = ['<div class="page">', '<div class="page-head">', '<h1>术语表</h1>',
      '<p class="sub">' + allTerms().length + ' 个术语 · ' + allCats().length +
        ' 个分类 · 题面与课程里的行话都在这查</p>', '</div>',
      '<div class="toolbar-row">',
      '  <input type="search" class="search-input" id="glossarySearch" value=""' +
        ' placeholder="搜中文 / 英文 / 解释里的关键词" aria-label="搜术语">',
      '  <button type="button" class="btn btn-clear" id="btnGlossaryClear" hidden>清除筛选</button>',
      '</div>', '<div class="filters" role="group" aria-label="按分类筛选">', chipsHtml(), '</div>',
      '<div id="glossaryList"></div>', '</div>'].join('\n');
    bindShell(root);
    paintList();
  }

  TSJ.appGlossary = {
    renderGlossary: renderGlossary,
    countOf: countOf,
    matches: matches
  };
})(typeof window !== 'undefined' ? window : this);
