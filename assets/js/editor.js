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
 *   - Ctrl/Cmd + Enter 触发运行
 *   - markError(line) 标注错误行
 *   - 高亮用 requestAnimationFrame 节流
 *
 * 挂载点：window.TSJ.createEditor(container, { value, onChange, onRun })
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
   * 把源码转成带 span 的高亮 HTML。
   * @param {string} code 源码
   * @returns {string} HTML 片段
   */
  function highlightCode(code) {
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
      if (m.index > last) out += escapeHtml(src.slice(last, m.index));

      var cls = '';
      if (m[1]) cls = 'tok-com';
      else if (m[2]) cls = 'tok-str';
      else if (m[3]) cls = 'tok-num';
      else if (m[4]) {
        if (KEYWORD_SET[m[4]]) cls = 'tok-kw';
        else if (BUILTIN_SET[m[4]]) cls = 'tok-bi';
      }

      out += cls
        ? '<span class="' + cls + '">' + escapeHtml(text) + '</span>'
        : escapeHtml(text);

      last = m.index + text.length;
    }

    out += escapeHtml(src.slice(last));
    // 末尾换行时补一个换行，保证最后一个空行也有高度
    if (src.length > 0 && src.charAt(src.length - 1) === '\n') out += '\n';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 编辑器组件
   * ------------------------------------------------------------------ */

  var LINE_HEIGHT = 20;   // 必须与 CSS 中 --ed-line 一致
  var PAD_TOP = 10;       // 必须与 CSS 中 padding 一致

  /** 需要自动配对/包裹的括号对 */
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  /** 输入这些字符后回车要多缩进一级 */
  var INDENT_TRIGGERS = { '(': true, '[': true, '{': true };

  /**
   * 创建编辑器。
   * @param {HTMLElement} container 容器
   * @param {Object} [options] { value, onChange, onRun }
   * @returns {{getValue: Function, setValue: Function, focus: Function, markError: Function, clearError: Function, destroy: Function}}
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

    ta.value = initial;

    /* ---------- 渲染 ---------- */

    /** 重绘高亮层 */
    function paintHighlight() {
      codeEl.innerHTML = highlightCode(ta.value);
      syncScroll();
    }

    /** 重绘行号栏 */
    function paintGutter() {
      var lines = ta.value.split('\n');
      var html = [];
      for (var i = 0; i < lines.length; i++) {
        var cls = 'ed-ln';
        if (errorLine === i + 1) cls += ' ed-ln-err';
        html.push('<div class="' + cls + '">' + (i + 1) + '</div>');
      }
      gutterInner.innerHTML = html.join('');
      lineCount = lines.length;
      syncScroll();
    }

    /** 滚动同步：高亮层与行号栏跟随 textarea */
    function syncScroll() {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutterInner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
    }

    /** 高亮当前光标所在行号 */
    function markCurrentLine() {
      var pos = ta.selectionStart;
      var line = ta.value.slice(0, pos).split('\n').length;
      var nodes = gutterInner.children;
      for (var i = 0; i < nodes.length; i++) {
        if (i + 1 === line) nodes[i].classList.add('cur');
        else nodes[i].classList.remove('cur');
      }
    }

    /** 用 requestAnimationFrame 节流的重绘调度 */
    function schedulePaint() {
      if (rafId) return;
      rafId = global.requestAnimationFrame(function () {
        rafId = 0;
        if (destroyed) return;
        paintHighlight();
        paintGutter();
        markCurrentLine();
      });
    }

    /** 立即全量刷新 */
    function refresh() {
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

    /** 取某一行（0 基）的缩进字符串 */
    function indentOfLine(lineIndex) {
      var lines = ta.value.split('\n');
      var line = lines[lineIndex] || '';
      var m = /^[ \t]*/.exec(line);
      return m ? m[0] : '';
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

      // Ctrl / Cmd + Enter：运行
      if ((ev.ctrlKey || ev.metaKey) && (key === 'Enter' || key === '\n')) {
        ev.preventDefault();
        if (typeof opts.onRun === 'function') opts.onRun();
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

      if (PAIRS[key] && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        if (handlePair(key)) {
          ev.preventDefault();
          schedulePaint();
          emitChange();
        }
      }
    });

    // 点击 / 选中变化时更新当前行高亮
    ta.addEventListener('click', markCurrentLine);
    ta.addEventListener('keyup', markCurrentLine);
    ta.addEventListener('focus', markCurrentLine);

    /* ---------- 生命周期 ---------- */

    refresh();

    /**
     * 标注错误行（1 基）。
     * @param {number} line 行号
     */
    function markError(line) {
      errorLine = line || 0;
      paintGutter();
      if (!errorLine) return;
      var target = (errorLine - 1) * LINE_HEIGHT + PAD_TOP;
      var viewTop = ta.scrollTop;
      var viewBottom = viewTop + ta.clientHeight;
      if (target < viewTop || target > viewBottom - LINE_HEIGHT * 2) {
        ta.scrollTop = Math.max(0, target - ta.clientHeight / 2);
        syncScroll();
      }
    }

    /** 清除错误行标注 */
    function clearError() {
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
        refresh();
        emitChange();
      },
      /** 聚焦编辑器 */
      focus: function () { ta.focus(); },
      /** 标注错误行 */
      markError: markError,
      /** 清除错误标注 */
      clearError: clearError,
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
    module.exports = { createEditor: createEditor, highlightCode: highlightCode, escapeHtml: escapeHtml };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
