/**
 * editor.js —— 自研轻量代码编辑器
 *
 * 实现方式：透明文字的 <textarea> 覆盖在 <pre><code> 高亮层之上，
 * 两层字体 / 字号 / 行高 / padding / tab-size 完全一致，滚动同步；
 * 左侧独立行号栏，通过 transform 跟随纵向滚动。
 *
 * 能力：
 *   - 语法高亮（注释 / 字符串 / 数字 / 关键字 / 内置函数），转义 HTML 防 XSS
 *   - Tab 缩进 2 空格、Shift+Tab 反缩进、Enter 自动缩进、括号自动配对
 *   - Ctrl/Cmd + Enter 触发运行；Ctrl/Cmd + S 保存草稿（不弹浏览器保存框）
 *   - 括号匹配高亮（光标处的 ()[]{} 与它的配对项同时加 .ed-match）
 *   - markError(line) 标注错误行，并同步 aria-invalid / aria-describedby 说明
 *   - 字号 12 / 13 / 14 可切换（行高与 padding 一律运行时 getComputedStyle 读取，避免双写错位）
 *   - 超过 800 行自动降级：关闭实时语法高亮，只保留行号与纯文本，保证输入不卡
 *
 * 挂载点：window.TSJ.createEditor(container, { value, onChange, onRun, onSave, fontSize, errorHelpId })
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});

  /* ------------------------------------------------------------------ *
   * 语法高亮
   * ------------------------------------------------------------------ */

  var KEYWORDS = [
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of',
    'this', 'null', 'undefined', 'true', 'false', 'try', 'catch', 'finally', 'throw',
    'delete', 'void', 'class', 'extends', 'super', 'yield', 'async', 'await', 'default'
  ];

  var BUILTINS = [
    'Math', 'Array', 'Object', 'Number', 'String', 'Boolean', 'JSON', 'Date', 'RegExp',
    'Error', 'Map', 'Set', 'Symbol', 'isNaN', 'isFinite', 'parseFloat', 'parseInt',
    'console', 'NaN', 'Infinity',
    'abs', 'sqrt', 'pow', 'exp', 'log', 'round', 'floor', 'ceil', 'min', 'max', 'sign',
    'sin', 'cos', 'tan', 'atan2', 'PI', 'E', 'LN2',
    'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'join', 'sort',
    'reverse', 'map', 'filter', 'reduce', 'forEach', 'indexOf', 'lastIndexOf', 'some',
    'every', 'find', 'findIndex', 'includes', 'keys', 'values', 'entries', 'length',
    'fill', 'flat', 'from', 'isArray', 'toFixed', 'toPrecision', 'trim', 'split',
    'replace', 'toUpperCase', 'toLowerCase', 'charCodeAt', 'apply', 'call', 'bind'
  ];

  var KEYWORD_SET = {};
  var BUILTIN_SET = {};
  (function () {
    var i;
    for (i = 0; i < KEYWORDS.length; i++) KEYWORD_SET[KEYWORDS[i]] = true;
    for (i = 0; i < BUILTINS.length; i++) BUILTIN_SET[BUILTINS[i]] = true;
  })();

  /**
   * 转义 HTML 特殊字符，防止高亮层被注入标签。
   * @param {string} s 原始文本
   * @returns {string}
   */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** 单次扫描用的组合正则：注释 | 字符串 | 数字 | 标识符 */
  var TOKEN_RE = new RegExp([
    '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',                        // 1 注释
    '("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2 字符串
    '\\b(0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b',  // 3 数字
    '\\b([A-Za-z_$][\\w$]*)\\b'                                      // 4 标识符
  ].join('|'), 'g');

  /**
   * 转义一段源码，并把落在其中的匹配区间包成 .ed-match。
   * @param {string} src 源码
   * @param {number} from 起点
   * @param {number} to 终点
   * @param {Array<{start:number,end:number}>} marks 匹配区间
   * @returns {string} HTML
   */
  function escapeSlice(src, from, to, marks) {
    if (!marks || marks.length === 0) return escapeHtml(src.slice(from, to));
    var out = '';
    var pos = from;
    for (var i = 0; i < marks.length; i++) {
      var a = Math.max(from, marks[i].start);
      var b = Math.min(to, marks[i].end);
      if (b <= a) continue;
      if (a > pos) out += escapeHtml(src.slice(pos, a));
      out += '<span class="ed-match">' + escapeHtml(src.slice(a, b)) + '</span>';
      pos = b;
    }
    if (pos < to) out += escapeHtml(src.slice(pos, to));
    return out;
  }

  /**
   * 判断某个区间是否与任一 mark 相交。
   * @param {number} from 起点
   * @param {number} to 终点
   * @param {Array} marks 匹配区间
   * @returns {boolean}
   */
  function overlaps(from, to, marks) {
    if (!marks) return false;
    for (var i = 0; i < marks.length; i++) {
      if (from < marks[i].end && to > marks[i].start) return true;
    }
    return false;
  }

  /**
   * 把源码转成带 span 的高亮 HTML。
   * @param {string} code 源码
   * @param {Array<{start:number,end:number}>} [marks] 需要额外加 .ed-match 的字符区间
   * @returns {string} HTML 片段
   */
  function highlightCode(code, marks) {
    var src = String(code == null ? '' : code);
    var out = '';
    var last = 0;
    var m;
    TOKEN_RE.lastIndex = 0;

    while ((m = TOKEN_RE.exec(src)) !== null) {
      var text = m[0];
      if (text.length === 0) {           // 极端保护：避免零宽匹配死循环
        TOKEN_RE.lastIndex++;
        continue;
      }
      if (m.index > last) out += escapeSlice(src, last, m.index, marks);

      var cls = '';
      if (m[1]) cls = 'tok-com';
      else if (m[2]) cls = 'tok-str';
      else if (m[3]) cls = 'tok-num';
      else if (m[4]) {
        if (KEYWORD_SET[m[4]]) cls = 'tok-kw';
        else if (BUILTIN_SET[m[4]]) cls = 'tok-bi';
      }

      var inner = cls ? '<span class="' + cls + '">' + escapeHtml(text) + '</span>' : escapeHtml(text);
      if (overlaps(m.index, m.index + text.length, marks)) {
        inner = '<span class="ed-match">' + inner + '</span>';
      }
      out += inner;

      last = m.index + text.length;
    }

    out += escapeSlice(src, last, src.length, marks);
    // 末尾换行时补一个换行，保证最后一个空行也有高度
    if (src.length > 0 && src.charAt(src.length - 1) === '\n') out += '\n';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 括号匹配
   * ------------------------------------------------------------------ */

  var OPENERS = { '(': ')', '[': ']', '{': '}' };
  var CLOSERS = { ')': '(', ']': '[', '}': '{' };
  /** 输入这些字符后回车要多缩进一级 */
  var INDENT_TRIGGERS = { '(': true, '[': true, '{': true };
  /** 需要自动配对的字符 */
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

  /**
   * 若 i 处是字符串或注释的开头，返回该段之后的第一个下标（否则原样返回 i）。
   * @param {string} text 源码
   * @param {number} i 下标
   * @returns {number}
   */
  function skipLiteral(text, i) {
    var ch = text.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      var j = i + 1;
      while (j < text.length) {
        var c = text.charAt(j);
        if (c === '\\') { j += 2; continue; }
        if (c === ch) return j + 1;
        if (ch !== '`' && c === '\n') return j;   // 未闭合的普通字符串：到行尾为止
        j++;
      }
      return text.length;
    }
    if (ch === '/' && text.charAt(i + 1) === '/') {
      var k = text.indexOf('\n', i);
      return k < 0 ? text.length : k;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      var e = text.indexOf('*/', i + 2);
      return e < 0 ? text.length : e + 2;
    }
    return i;
  }

  /**
   * 从开括号向后找配对的闭括号。
   * @param {string} text 源码
   * @param {number} start 开括号下标
   * @param {string} open 开括号字符
   * @param {string} close 闭括号字符
   * @returns {number} 配对下标，找不到返回 -1
   */
  function scanForward(text, start, open, close) {
    var depth = 1;
    var i = start + 1;
    while (i < text.length) {
      var skip = skipLiteral(text, i);
      if (skip !== i) { i = skip; continue; }
      var ch = text.charAt(i);
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  /**
   * 从闭括号向前找配对的开括号。
   * @param {string} text 源码
   * @param {number} start 闭括号下标
   * @param {string} open 开括号字符
   * @param {string} close 闭括号字符
   * @returns {number} 配对下标，找不到返回 -1
   */
  function scanBackward(text, start, open, close) {
    var depth = 1;
    var i = start - 1;
    while (i >= 0) {
      var ch = text.charAt(i);
      if (ch === close) depth++;
      else if (ch === open) {
        depth--;
        if (depth === 0) return i;
      }
      i--;
    }
    return -1;
  }

  /**
   * 在光标处找括号对，返回两侧字符区间。
   * @param {string} text 源码
   * @param {number} pos 光标下标
   * @returns {?Array<{start:number,end:number}>} 两段区间（无匹配返回 null）
   */
  function findBracketPair(text, pos) {
    var candidates = [];
    if (pos < text.length) candidates.push(pos);
    if (pos > 0) candidates.push(pos - 1);
    for (var c = 0; c < candidates.length; c++) {
      var at = candidates[c];
      var ch = text.charAt(at);
      var partner = -1;
      if (OPENERS[ch]) {
        partner = scanForward(text, at, ch, OPENERS[ch]);
      } else if (CLOSERS[ch]) {
        partner = scanBackward(text, at, CLOSERS[ch], ch);
      }
      if (partner >= 0 && partner !== at) {
        return [
          { start: at, end: at + 1 },
          { start: partner, end: partner + 1 }
        ];
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 编辑器组件
   * ------------------------------------------------------------------ */

  /** 超过这个行数就关闭实时语法高亮（只保留行号与纯文本） */
  var DEGRADE_LINES = 800;
  /** 字号循环序列 */
  var FONT_SIZES = [12, 13, 14];

  /**
   * 创建编辑器。
   * @param {HTMLElement} container 容器
   * @param {Object} [options] { value, onChange, onRun, onSave, fontSize, errorHelpId }
   * @returns {Object} 编辑器句柄
   */
  function createEditor(container, options) {
    var opts = options || {};
    var initial = typeof opts.value === 'string' ? opts.value : '';

    container.classList.add('tsj-editor-host');
    container.innerHTML = [
      '<div class="tsj-editor">',
      '  <div class="ed-gutter"><div class="ed-gutter-inner"></div></div>',
      '  <div class="ed-body">',
      '    <pre class="ed-highlight" aria-hidden="true"><code></code></pre>',
      '    <textarea class="ed-input" spellcheck="false" autocapitalize="off"',
      '      autocomplete="off" autocorrect="off" wrap="off"',
      '      aria-label="代码编辑器"></textarea>',
      '  </div>',
      '</div>'
    ].join('\n');

    var root = container.querySelector('.tsj-editor');
    var gutterInner = container.querySelector('.ed-gutter-inner');
    var pre = container.querySelector('.ed-highlight');
    var codeEl = pre.querySelector('code');
    var ta = container.querySelector('.ed-input');

    var rafId = 0;
    var destroyed = false;
    var errorLine = 0;
    var lineCount = 0;
    var curLine = 0;
    var gutterKey = '';
    var matchMarks = null;
    var matchKey = '';
    /** 运行时量出来的行高与上内边距（避免与 CSS 双写错位） */
    var metrics = { lineHeight: 20, padTop: 10 };
    /** 最近一次绘制的耗时（毫秒），供性能验收读取 */
    var perf = { lastPaintMs: 0, lastLines: 0 };

    ta.value = initial;

    /* ---------- 运行时度量 ---------- */

    /** 读取 textarea 的实际行高与上内边距。 */
    function readMetrics() {
      var cs = null;
      try {
        cs = global.getComputedStyle(ta);
      } catch (e) {
        cs = null;
      }
      var lh = cs ? parseFloat(cs.lineHeight) : NaN;
      var pt = cs ? parseFloat(cs.paddingTop) : NaN;
      metrics.lineHeight = (isFinite(lh) && lh > 0) ? lh : 20;
      metrics.padTop = isFinite(pt) ? pt : 10;
      return metrics;
    }

    /** 应用字号（12 / 13 / 14），行高按 1.55 倍推导后写进 CSS 变量。 */
    function applyFontSize(size) {
      var px = FONT_SIZES.indexOf(size) >= 0 ? size : 13;
      root.style.setProperty('--ed-font', px + 'px');
      root.style.setProperty('--ed-line', Math.round(px * 1.55) + 'px');
      readMetrics();
      return px;
    }

    /* ---------- 渲染 ---------- */

    /** 当前是否处于「大文件降级」模式。 */
    function degraded() {
      return lineCount > DEGRADE_LINES;
    }

    /** 重绘高亮层（大文件只写纯文本）。 */
    function paintHighlight() {
      if (degraded()) {
        // 纯文本：textContent 天然转义，不需要扫描 token，2000 行也只有一次赋值
        codeEl.textContent = ta.value;
      } else {
        codeEl.innerHTML = highlightCode(ta.value, matchMarks);
      }
      syncScroll();
    }

    /** 重绘行号栏（行数或错误行没变就跳过，避免每次按键重建上千个节点）。 */
    function paintGutter() {
      var lines = ta.value.split('\n');
      lineCount = lines.length;
      var key = lineCount + '|' + errorLine;
      if (key === gutterKey) return;
      gutterKey = key;
      var html = [];
      for (var i = 0; i < lineCount; i++) {
        var cls = 'ed-ln';
        if (errorLine === i + 1) cls += ' ed-ln-err';
        html.push('<div class="' + cls + '">' + (i + 1) + '</div>');
      }
      gutterInner.innerHTML = html.join('');
      curLine = 0;
      syncScroll();
    }

    /** 滚动同步：高亮层与行号栏跟随 textarea */
    function syncScroll() {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutterInner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
    }

    /** 高亮当前光标所在行号（只动上一行与当前行两个节点）。 */
    function markCurrentLine() {
      var pos = ta.selectionStart;
      var line = 1;
      var value = ta.value;
      for (var i = 0; i < pos; i++) {
        if (value.charCodeAt(i) === 10) line++;
      }
      if (line === curLine) return;
      var nodes = gutterInner.children;
      if (curLine >= 1 && nodes[curLine - 1]) nodes[curLine - 1].classList.remove('cur');
      if (nodes[line - 1]) nodes[line - 1].classList.add('cur');
      curLine = line;
    }

    /** 括号匹配：光标移动后重算，变化了才重绘高亮层。 */
    function updateBracket() {
      var text = ta.value;
      var pos = ta.selectionStart;
      // 大文件不扫括号（光标附近可能是几十万字符），避免输入卡顿
      var found = degraded() ? null : findBracketPair(text, pos);
      var key = found ? (found[0].start + ':' + found[1].start) : '';
      if (key === matchKey) return;
      matchKey = key;
      matchMarks = found;
      paintHighlight();
    }

    /** 用 requestAnimationFrame 节流的重绘调度（并记录绘制耗时） */
    function schedulePaint() {
      if (rafId) return;
      rafId = global.requestAnimationFrame(function () {
        rafId = 0;
        if (destroyed) return;
        var t0 = now();
        paintHighlight();
        paintGutter();
        markCurrentLine();
        perf.lastPaintMs = now() - t0;
        perf.lastLines = lineCount;
      });
    }

    /** 单调时钟。 */
    function now() {
      return (global.performance && typeof global.performance.now === 'function')
        ? global.performance.now() : Date.now();
    }

    /** 立即全量刷新 */
    function refresh() {
      gutterKey = '';   // 强制重建行号
      paintHighlight();
      paintGutter();
      markCurrentLine();
    }

    /* ---------- 输入事件 ---------- */

    /** 通知外部值变化 */
    function emitChange() {
      if (typeof opts.onChange === 'function') opts.onChange(ta.value);
    }

    /**
     * 用 setRangeText 替换选区，保留浏览器原生撤销栈。
     * @param {string} text 插入文本
     * @param {number} start 起点
     * @param {number} end 终点
     * @param {string} [selMode] 选区模式
     */
    function replaceRange(text, start, end, selMode) {
      if (typeof ta.setRangeText === 'function') {
        ta.setRangeText(text, start, end, selMode || 'end');
      } else {
        ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + text.length;
      }
    }

    /**
     * Tab：插入 2 空格；若选中多行则整体缩进。
     * @param {boolean} backwards 是否 Shift+Tab（反缩进）
     */
    function handleTab(backwards) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var value = ta.value;

      var hasMultiLine = value.slice(start, end).indexOf('\n') >= 0;
      if (hasMultiLine) {
        var lineStart = value.lastIndexOf('\n', start - 1) + 1;
        var block = value.slice(lineStart, end);
        var lines = block.split('\n');
        for (var i = 0; i < lines.length; i++) {
          if (backwards) {
            if (lines[i].slice(0, 2) === '  ') lines[i] = lines[i].slice(2);
            else if (lines[i].charAt(0) === ' ') lines[i] = lines[i].slice(1);
          } else {
            lines[i] = '  ' + lines[i];
          }
        }
        var newBlock = lines.join('\n');
        ta.selectionStart = lineStart;
        ta.selectionEnd = end;
        replaceRange(newBlock, lineStart, end, 'select');
        ta.selectionStart = lineStart;
        ta.selectionEnd = lineStart + newBlock.length;
        return;
      }

      if (backwards) {
        var ls = value.lastIndexOf('\n', start - 1) + 1;
        var head = value.slice(ls, start);
        if (head.slice(-2) === '  ') {
          ta.selectionStart = ta.selectionEnd = start;
          replaceRange('', start - 2, start, 'end');
        } else if (head.slice(-1) === ' ') {
          ta.selectionStart = ta.selectionEnd = start;
          replaceRange('', start - 1, start, 'end');
        }
        return;
      }

      replaceRange('  ', start, end, 'end');
    }

    /**
     * Enter：保留当前行缩进；若上一行以括号结尾则再缩进一级。
     * @param {KeyboardEvent} ev 键盘事件
     */
    function handleEnter(ev) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var value = ta.value;
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      var lineText = value.slice(lineStart, start);
      var indent = (/^[ \t]*/.exec(lineText) || [''])[0];
      var trimmed = lineText.replace(/[ \t]+$/, '');
      var lastChar = trimmed.charAt(trimmed.length - 1);

      var insert = '\n' + indent;
      if (INDENT_TRIGGERS[lastChar]) insert += '  ';

      // 光标正好在成对括号中间：额外插入一行并把右括号推下去
      var nextChar = value.charAt(start);
      if (PAIRS[lastChar] && PAIRS[lastChar] === nextChar && start === end) {
        replaceRange('\n' + indent + '  \n' + indent, start, end, 'end');
        var caret = start + 1 + indent.length + 2;
        ta.selectionStart = ta.selectionEnd = caret;
        ev.preventDefault();
        return;
      }

      replaceRange(insert, start, end, 'end');
      ev.preventDefault();
    }

    /**
     * 括号 / 引号自动配对：有选区则包裹，无选区则插入成对符号。
     * @param {string} ch 输入字符
     * @returns {boolean} 是否已处理
     */
    function handlePair(ch) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var close = PAIRS[ch];

      if (start !== end) {
        var selected = ta.value.slice(start, end);
        replaceRange(ch + selected + close, start, end, 'end');
        ta.selectionStart = start + 1;
        ta.selectionEnd = end + 1;
        return true;
      }

      // 引号：如果前一个字符是同一个引号，视为闭合而不是新开
      if (ch === '"' || ch === "'" || ch === '`') {
        var prev = ta.value.charAt(start - 1);
        var next = ta.value.charAt(start);
        if (next === ch) {
          ta.selectionStart = ta.selectionEnd = start + 1;
          return true;
        }
        if (/[\w$\])]/.test(prev)) return false;
      }

      replaceRange(ch + close, start, end, 'end');
      ta.selectionStart = ta.selectionEnd = start + 1;
      return true;
    }

    /* ---------- 事件绑定 ---------- */

    ta.addEventListener('input', function () {
      schedulePaint();
      emitChange();
    });

    ta.addEventListener('scroll', syncScroll, { passive: true });

    ta.addEventListener('keydown', function (ev) {
      var key = ev.key;
      var mod = ev.ctrlKey || ev.metaKey;

      // 输入法合成中（拼音候选框开着）：一切快捷行为都必须放行，
      // 否则按 Enter 确认候选词会被劫持成换行、Tab 会打断选字。
      if (ev.isComposing || ev.keyCode === 229) return;

      // Ctrl / Cmd + Enter：运行
      if (mod && (key === 'Enter' || key === '\n')) {
        ev.preventDefault();
        if (typeof opts.onRun === 'function') opts.onRun();
        return;
      }

      // Ctrl / Cmd + S：保存草稿（必须拦住浏览器的「另存为」）
      if (mod && (key === 's' || key === 'S')) {
        ev.preventDefault();
        if (typeof opts.onSave === 'function') opts.onSave();
        return;
      }

      if (key === 'Tab') {
        ev.preventDefault();
        handleTab(ev.shiftKey);
        schedulePaint();
        emitChange();
        return;
      }

      if (key === 'Enter') {
        handleEnter(ev);
        schedulePaint();
        emitChange();
        return;
      }

      if (PAIRS[key] && !mod && !ev.altKey) {
        if (handlePair(key)) {
          ev.preventDefault();
          schedulePaint();
          emitChange();
        }
      }
    });

    // 点击 / 选中变化时更新当前行高亮与括号匹配
    ta.addEventListener('click', function () { markCurrentLine(); updateBracket(); });
    ta.addEventListener('keyup', function () { markCurrentLine(); updateBracket(); });
    ta.addEventListener('focus', function () { markCurrentLine(); updateBracket(); });

    /* ---------- 生命周期 ---------- */

    if (opts.errorHelpId) ta.setAttribute('aria-describedby', String(opts.errorHelpId));
    applyFontSize(opts.fontSize);
    readMetrics();
    refresh();

    /**
     * 写错误说明（aria-describedby 指向的元素）。
     * @param {string} text 说明
     */
    function setErrorHelp(text) {
      if (!opts.errorHelpId) return;
      var el = document.getElementById(String(opts.errorHelpId));
      if (el) el.textContent = text;
    }

    /**
     * 标注错误行（1 基）。
     * @param {number} line 行号
     */
    function markError(line) {
      errorLine = line || 0;
      paintGutter();
      if (!errorLine) return;
      ta.setAttribute('aria-invalid', 'true');
      setErrorHelp('第 ' + errorLine + ' 行有错误：上方结果面板给出了具体原因。');
      var m = readMetrics();
      var target = (errorLine - 1) * m.lineHeight + m.padTop;
      var viewTop = ta.scrollTop;
      var viewBottom = viewTop + ta.clientHeight;
      if (target < viewTop || target > viewBottom - m.lineHeight * 2) {
        ta.scrollTop = Math.max(0, target - ta.clientHeight / 2);
        syncScroll();
      }
    }

    /** 清除错误行标注 */
    function clearError() {
      ta.removeAttribute('aria-invalid');
      setErrorHelp('代码出错时会在这里说明行号与原因。');
      if (!errorLine) return;
      errorLine = 0;
      paintGutter();
    }

    return {
      /** 取当前代码 */
      getValue: function () { return ta.value; },
      /** 设置代码并重绘 */
      setValue: function (v) {
        ta.value = typeof v === 'string' ? v : '';
        errorLine = 0;
        matchMarks = null;
        matchKey = '';
        refresh();
        emitChange();
      },
      /** 聚焦编辑器 */
      focus: function () { ta.focus(); },
      /** 标注错误行 */
      markError: markError,
      /** 清除错误标注 */
      clearError: clearError,
      /** 切换字号（12 / 13 / 14） */
      setFontSize: function (size) {
        var px = applyFontSize(size);
        refresh();
        return px;
      },
      /** 当前字号 */
      getFontSize: function () {
        return parseInt(root.style.getPropertyValue('--ed-font'), 10) || 13;
      },
      /** 是否处于大文件降级模式 */
      isDegraded: function () { return degraded(); },
      /** 当前行高 / 上内边距（测试用） */
      metrics: function () { return { lineHeight: metrics.lineHeight, padTop: metrics.padTop }; },
      /** 性能观测：最近一次绘制的耗时（毫秒） */
      perf: perf,
      /** 当前括号匹配区间 */
      matchMarks: function () { return matchMarks; },
      /** 销毁：取消挂起的重绘 */
      destroy: function () {
        destroyed = true;
        if (rafId) {
          global.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      },
      /** 内部 textarea，供高级用法 */
      textarea: ta,
      /** 根节点 */
      root: root
    };
  }

  TSJ.createEditor = createEditor;
  TSJ.highlightCode = highlightCode;
  TSJ.escapeHtml = escapeHtml;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createEditor: createEditor,
      highlightCode: highlightCode,
      escapeHtml: escapeHtml,
      findBracketPair: findBracketPair
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
