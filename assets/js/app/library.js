/**
 * assets/js/app/library.js —— 方法库（知识库）页面：#/methods
 * 加载顺序：… app/pages → app/library → app/boards → app.js　挂载点：window.TSJ.appLibrary
 * 数据来自 assets/js/methods.js（内容层，只读）：本文件只做「筛选 → 卡片」的映射，不改写任何文案。
 * 约定：数量一律现算（不写死）；搜索 / 层 / 只看能练的 三者取交集；formula 按纯文本渲染
 * （内含 * + Σ，不能当 Markdown 解析）；可见文案一律过 esc()；展开态用 aria-expanded，
 * 标题可 Tab 聚焦 + Enter/Space 切换。
 */
(function (global) {
  'use strict';
  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore, $ = core.$, $$ = core.$$, esc = core.esc;
  var TIER_MARK = { deep: 'DL', foundation: 'FM', eval: 'EVAL' };   // 标题旁小标：深度学习 / 基础模型 / 评估方法论
  var MAX_TAGS = 3;                               // 收起态最多显示的标签数，超出折叠为 +N
  var view = { query: '', tier: 'all', onlyPractice: false, open: {} };   // 每次进入重建为默认态

  /* ---------- 1. 现算的计数 ---------- */
  function allMethods() { return TSJ.methods || []; }
  function allTiers() { return TSJ.methodTiers || []; }

  /** 某层的卡片数；'all' 返回总数。 */
  function countOf(tierId) {
    if (tierId === 'all') return allMethods().length;
    return allMethods().filter(function (m) { return m.tier === tierId; }).length;
  }

  /** 有对应题目的方法数（「只看能练的」的计数）。 */
  function practiceCount() {
    return allMethods().filter(function (m) { return !!m.practice; }).length;
  }

  /** 层 id → 中文名（未知 id 原样返回）。 */
  function tierName(id) {
    var tiers = allTiers();
    for (var i = 0; i < tiers.length; i++) if (tiers[i].id === id) return tiers[i].name;
    return id;
  }

  /* ---------- 2. 筛选（三者取交集） ---------- */
  /** 层 + 开关 + 搜索词取交集；搜索覆盖 name / title / venue / tags / idea，大小写不敏感。 */
  function matches(m) {
    if (view.tier !== 'all' && m.tier !== view.tier) return false;
    if (view.onlyPractice && !m.practice) return false;
    var q = String(view.query || '').trim().toLowerCase();
    if (!q) return true;
    var tags = (m.tags && m.tags.length) ? m.tags.join(' ') : '';
    return [m.name, m.title, m.venue, tags, m.idea].join(' \n ').toLowerCase().indexOf(q) >= 0;
  }

  /** 一键清除所有筛选条件，回到默认态（29 张卡片）。 */
  function clearFilters() {
    view.query = '';
    view.tier = 'all';
    view.onlyPractice = false;
    var input = $('#methodSearch'), box = $('#onlyPractice');
    if (input) input.value = '';
    if (box) box.checked = false;
    paintChips();
    paintList();
  }

  /** 同步「清除筛选」按钮的可见性（有筛选才出现）。 */
  function syncClearBtn() {
    var btn = $('#btnMethodClear');
    if (!btn) return;
    var on = String(view.query || '').trim() !== '' || view.tier !== 'all' || view.onlyPractice;
    if (on) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  /* ---------- 3. 卡片 ---------- */
  /** 「检索原文」：不硬编码论文 URL（会失效），统一用 Bing 搜标题，新窗口打开。 */
  function srcHtml(m) {
    var url = 'https://www.bing.com/search?q=' + encodeURIComponent(String(m.title || ''));
    return '<a class="btn btn-ghost mc-src" href="' + esc(url) + '"' +
      ' target="_blank" rel="noopener noreferrer">检索原文</a>';
  }

  /** 底部操作区：有题 → 去练；无题但可跑 → 暂无对应题目；沙箱跑不了 → 明说。 */
  function actionHtml(m) {
    if (m.practice) {
      return '<a class="btn btn-primary mc-practice" href="#/problem/' + esc(m.practice) +
        '">去练这道题</a>\n      ' + srcHtml(m);
    }
    var note = (m.runnable === false) ? '沙箱跑不了，仅供选型参考' : '暂无对应题目';
    return '<span class="mc-note">' + note + '</span>\n      ' + srcHtml(m);
  }

  /** 展开区：左「核心思想 + 关键式子」，右「适用 + 局限」，窄屏由 CSS 堆叠。 */
  function bodyHtml(m) {
    var out = ['    <div class="mc-grid">', '      <div class="mc-col">',
      '        <div class="mc-block"><div class="mc-label">核心思想</div><p class="mc-text">' + esc(m.idea) + '</p></div>'];
    if (m.formula) {
      out.push('        <div class="mc-block"><div class="mc-label">关键式子</div>' +
        '<pre class="mc-formula">' + esc(m.formula) + '</pre></div>');
    }
    out.push('      </div>', '      <div class="mc-col">',
      '        <div class="mc-block"><div class="mc-label">适用</div><p class="mc-text">' + esc(m.when) + '</p></div>',
      '        <div class="mc-block"><div class="mc-label">局限</div><p class="mc-text">' + esc(m.limit) + '</p></div>',
      '      </div>', '    </div>', '    <div class="mc-actions">', '      ' + actionHtml(m), '    </div>');
    return out.join('\n');
  }

  /** 单张卡片（默认收起；展开内容按需生成，避免一次渲染 29 份长文本）。 */
  function cardHtml(m) {
    var open = view.open[m.id] === true;
    var tags = m.tags || [];
    var mark = TIER_MARK[m.tier];
    var head = ['  <div class="mc-head">',
      '    <div class="mc-title" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') +
        '" aria-controls="mc-body-' + esc(m.id) + '">' + esc(m.name) + '</div>',
      '    <span class="mc-badge">' + esc(m.venue) + '</span>',
      '    <span class="mc-tier">' + esc(tierName(m.tier)) + '</span>'];
    if (mark) head.push('    <span class="mc-mark">' + esc(mark) + '</span>');
    for (var t = 0; t < tags.length && t < MAX_TAGS; t++) {
      head.push('    <span class="tag">' + esc(tags[t]) + '</span>');
    }
    if (tags.length > MAX_TAGS) head.push('    <span class="mc-more">+' + (tags.length - MAX_TAGS) + '</span>');
    head.push('  </div>');
    return '<article class="mcard' + (open ? ' mcard-open' : '') + '" data-mid="' + esc(m.id) +
      '" data-tier="' + esc(m.tier) + '">\n' + head.join('\n') +
      '\n  <div class="mc-body" id="mc-body-' + esc(m.id) + '"' + (open ? '' : ' hidden') + '>' +
      (open ? bodyHtml(m) : '') + '</div>\n</article>';
  }

  /* ---------- 4. 渲染与绑定 ---------- */
  /** 层筛选 chips（数量现算）。 */
  function chipsHtml() {
    var tiers = allTiers();
    var out = ['  <button type="button" class="chip chip-on" data-tier="all">全部(' + countOf('all') + ')</button>'];
    for (var i = 0; i < tiers.length; i++) {
      out.push('  <button type="button" class="chip" data-tier="' + esc(tiers[i].id) + '">' +
        esc(tiers[i].name) + '(' + countOf(tiers[i].id) + ')</button>');
    }
    return out.join('\n');
  }

  /** 同步 chip 选中态（不重绘列表）。 */
  function paintChips() {
    var root = $('#view');
    if (!root) return;
    var chips = $$('.chip[data-tier]', root);
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList[chips[i].getAttribute('data-tier') === view.tier ? 'add' : 'remove']('chip-on');
    }
  }

  /** 重绘卡片列表区（空态带「清除筛选」）。 */
  function paintList() {
    var host = $('#methodList');
    if (!host) return;
    var list = allMethods();
    var out = [], shown = 0;
    for (var i = 0; i < list.length; i++) {
      if (!matches(list[i])) continue;
      shown++;
      out.push(cardHtml(list[i]));
    }
    if (shown === 0) {
      out.push('<div class="empty"><span class="empty-icon">◌</span>没有匹配的方法。<br>' +
        '<button type="button" class="btn" data-clear="1">清除筛选</button></div>');
    }
    host.innerHTML = '<div class="mcards">\n' + out.join('\n') + '\n</div>';
    bindCards(host);
    var clears = $$('[data-clear]', host);
    for (var c = 0; c < clears.length; c++) clears[c].addEventListener('click', clearFilters);
    syncClearBtn();
  }

  /** 展开 / 收起一张卡片（首次展开才生成内容）。 */
  function toggleCard(titleEl) {
    var card = titleEl.closest ? titleEl.closest('.mcard') : null;
    if (!card) return;
    var id = card.getAttribute('data-mid');
    var body = card.querySelector('.mc-body');
    var m = TSJ.methodsById ? TSJ.methodsById(id) : null;
    if (!m || !body) return;
    if (card.classList.contains('mcard-open')) {
      card.classList.remove('mcard-open');
      titleEl.setAttribute('aria-expanded', 'false');
      body.setAttribute('hidden', '');
      view.open[id] = false;
      return;
    }
    if (!body.innerHTML) body.innerHTML = bodyHtml(m);
    card.classList.add('mcard-open');
    titleEl.setAttribute('aria-expanded', 'true');
    body.removeAttribute('hidden');
    view.open[id] = true;
  }

  /** 绑定卡片的点击 / Enter / Space 展开。 */
  function bindCards(host) {
    var titles = $$('.mc-title', host);
    for (var i = 0; i < titles.length; i++) {
      titles[i].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          toggleCard(this);
        }
      });
    }
    /*
     * 点击热区：整行（.mc-head）都可展开，而不是只有标题文字。
     * 出处徽标和标签占了半行，用户自然会点它们——只绑标题会让「点了没反应」。
     * 行内若将来出现按钮 / 链接，必须放行，否则会连展带跳。
     */
    var heads = $$('.mc-head', host);
    for (var k = 0; k < heads.length; k++) {
      heads[k].addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('a,button,input,select,textarea')) return;
        var title = this.querySelector('.mc-title');
        if (title) toggleCard(title);
      });
    }
  }

  /** 绑定页面外壳（搜索框 / 层 chips / 只看能练的 / 清除筛选）。 */
  function bindShell(root) {
    var input = $('#methodSearch', root);
    if (input) {
      input.addEventListener('input', core.debounce(function () {
        view.query = input.value;
        paintList();
      }, 120));
    }
    var chips = $$('.chip[data-tier]', root);
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        view.tier = this.getAttribute('data-tier');
        paintChips();
        paintList();
      });
    }
    var box = $('#onlyPractice', root);
    if (box) {
      box.addEventListener('change', function () {
        view.onlyPractice = box.checked === true;
        paintList();
      });
    }
    var btnClear = $('#btnMethodClear', root);
    if (btnClear) btnClear.addEventListener('click', clearFilters);
  }

  /** 渲染方法库页面（路由入口，每次进入都回到默认态）。 */
  function renderMethods() {
    var root = $('#view');
    if (!root) return;
    view = { query: '', tier: 'all', onlyPractice: false, open: {} };
    root.innerHTML = ['<div class="page">', '<div class="page-head">', '<h1>方法库</h1>',
      '<p class="sub">' + allMethods().length + ' 个方法 · ' + allTiers().length +
        ' 个层次 · ' + practiceCount() + ' 个可练</p>', '</div>', '<div class="toolbar-row">',
      '  <input type="search" class="search-input" id="methodSearch" value=""' +
        ' placeholder="搜索方法名 / 论文标题 / 标签 / 出处" aria-label="搜索方法">',
      '  <button type="button" class="btn btn-clear" id="btnMethodClear" hidden>清除筛选</button>',
      '</div>', '<div class="filters" role="group" aria-label="按层次筛选">', chipsHtml(), '</div>',
      '<div class="switch-row"><label class="switch-label" for="onlyPractice">' +
        '<input type="checkbox" class="switch-input" id="onlyPractice">' +
        '<span>只看能练的（' + practiceCount() + '）</span></label></div>',
      '<div id="methodList"></div>', '</div>'].join('\n');
    bindShell(root);
    paintList();
  }

  TSJ.appLibrary = {
    renderMethods: renderMethods,
    countOf: countOf,
    practiceCount: practiceCount,
    matches: matches
  };
})(typeof window !== 'undefined' ? window : this);
