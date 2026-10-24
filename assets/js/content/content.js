/**
 * assets/js/content/content.js —— 内容索引、安全渲染与完整性校验
 *
 * 这里不直接操作 DOM：只输出 HTML 字符串与校验结果，页面模块负责插入。
 * Markdown 是受控子集，先转义再解析，禁止裸 HTML / 任意链接 / 任意属性。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var methods = TSJ.methods || [];
  var courses = TSJ.courses || [];
  var references = TSJ.references || [];
  var refIndex = TSJ.referenceIndex || {};
  var methodDetails = TSJ.methodDetails || {};

  var VALID_RUN_LEVEL = { sandbox: true, precomputed: true, concept: true };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function indexBy(list, key) {
    var out = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i][key] != null) out[list[i][key]] = list[i];
    }
    return out;
  }

  var courseIndex = indexBy(courses, 'id');
  var methodIndex = indexBy(methods, 'id');

  /* ---------- 索引与查询 ---------- */
  function course(id) { return courseIndex[id] || null; }

  function nextCourse(id) {
    var sorted = courses.slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].id === id && sorted[i + 1]) return sorted[i + 1];
    }
    return null;
  }

  function prevCourse(id) {
    var sorted = courses.slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].id === id && i > 0) return sorted[i - 1];
    }
    return null;
  }

  function methodDetail(id) { return methodDetails[id] || null; }

  function referencesFor(ids) {
    var out = [];
    var list = ids || [];
    for (var i = 0; i < list.length; i++) {
      var r = refIndex[list[i]];
      if (r) out.push(r);
    }
    return out;
  }

  function formulaIndexFor(c) {
    var out = {};
    var fs = (c && c.formulas) || [];
    for (var i = 0; i < fs.length; i++) if (fs[i] && fs[i].id) out[fs[i].id] = fs[i];
    return out;
  }

  /* ---------- 受控 Markdown ---------- */
  function inline(text, ctx) {
    var s = esc(text);
    // 占位符：先替换成不易冲突的 token，避免被转义破坏
    s = s.replace(/\[\[ref:([a-z0-9\-]+)\]\]/gi, function (_, id) {
      var r = refIndex[id];
      if (!r) return '<span class="ds-badge ds-badge-err">缺失引用 ' + esc(id) + '</span>';
      return '<sup class="md-ref"><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer"' +
        ' title="' + esc(r.title + ' · ' + r.venue) + '">[' + esc(r.id) + ']</a></sup>';
    });
    s = s.replace(/\[\[method:([a-z0-9\-]+)\]\]/gi, function (_, id) {
      var m = methodIndex[id];
      if (!m) return '<span class="ds-badge ds-badge-err">缺失方法 ' + esc(id) + '</span>';
      return '<a href="#/methods/' + encodeURIComponent(id) + '">' + esc(m.title) + '</a>';
    });
    s = s.replace(/\[\[formula:([a-z0-9\-]+)\]\]/gi, function (_, id) {
      var f = ctx && ctx.formulas ? ctx.formulas[id] : null;
      if (!f) return '<span class="ds-badge ds-badge-err">缺失公式 ' + esc(id) + '</span>';
      return formulaHtml(f);
    });
    // 行内代码
    s = s.replace(/`([^`\n]+)`/g, function (_, code) { return '<code>' + code + '</code>'; });
    // 粗体 / 斜体（保守匹配，不跨嵌套）
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }

  function formulaHtml(f) {
    return '<div class="md-formula"><div>' + esc(f.text) + '</div>' +
      '<small style="color:var(--v3-muted)">符号：' + esc(f.variables || '') + '</small>' +
      (f.example ? '<small style="color:var(--v3-text-dim)">小例：' + esc(f.example) + '</small>' : '') +
      '</div>';
  }

  function renderMarkdown(md, ctx) {
    var lines = String(md == null ? '' : md).split('\n');
    var html = [];
    var para = [];
    var listType = null;
    var inCode = false;
    var codeBuf = [];

    function flushPara() {
      if (!para.length) return;
      html.push('<p>' + para.map(function (l) { return inline(l, ctx); }).join('<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!listType) return;
      html.push('</' + listType + '>');
      listType = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^```/.test(line)) {
        if (inCode) {
          html.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = [];
          inCode = false;
        } else {
          flushPara(); flushList();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (!line.trim()) { flushPara(); flushList(); continue; }

      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        var level = h[1].length + 1; // 页面里已有 H1，正文从 H2 起
        html.push('<h' + level + '>' + inline(h[2], ctx) + '</h' + level + '>');
        continue;
      }

      if (/^&gt;|^>/.test(line)) {
        flushPara(); flushList();
        html.push('<blockquote>' + inline(line.replace(/^>\s?/, ''), ctx) + '</blockquote>');
        continue;
      }

      var ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listType !== 'ul') { flushList(); html.push('<ul>'); listType = 'ul'; }
        html.push('<li>' + inline(ul[1], ctx) + '</li>');
        continue;
      }

      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (listType !== 'ol') { flushList(); html.push('<ol>'); listType = 'ol'; }
        html.push('<li>' + inline(ol[1], ctx) + '</li>');
        continue;
      }

      para.push(line);
    }

    if (inCode) html.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
    flushPara(); flushList();
    return html.join('\n');
  }

  function renderCourseBody(c) {
    var html = renderMarkdown(c.body, { formulas: formulaIndexFor(c) });
    // 公式统一在正文后集中展示，避免课程作者忘记写 [[formula:id]] 占位符
    if (c.formulas && c.formulas.length) {
      html += '<div class="course-panel"><h3>关键公式与数值小例</h3>' +
        c.formulas.map(formulaHtml).join('') + '</div>';
    }
    return html;
  }

  function referenceListHtml(ids) {
    var refs = referencesFor(ids);
    if (!refs.length) return '<div class="ds-empty"><strong>暂无引用</strong><span>该内容未声明外部来源。</span></div>';
    var items = refs.map(function (r) {
      return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(r.title) + '</a> · ' + esc(r.authors) + ' · ' + esc(r.year) + ' · ' + esc(r.venue) +
        ' · 核查于 ' + esc(r.checkedAt) + '</li>';
    });
    return '<ul class="course-refs">' + items.join('') + '</ul>';
  }

  /* ---------- 完整性校验 ---------- */
  function validate() {
    var errors = [];

    if (courses.length !== 8) errors.push('课程模块应为 8 个，实际 ' + courses.length);

    var ids = {};
    courses.forEach(function (c) {
      if (!c.id) errors.push('存在没有 id 的课程');
      if (ids[c.id]) errors.push('课程 id 重复：' + c.id);
      ids[c.id] = true;
      if (!c.title) errors.push(c.id + ' 缺少 title');
      if (!c.summary || c.summary.length < 10) errors.push(c.id + ' summary 过短');
      if (!c.body || c.body.length < 300) errors.push(c.id + ' 正文过短，不足以构成一个模块');
      if (!Array.isArray(c.topics) || c.topics.length < 3) errors.push(c.id + ' 核心主题少于 3 个');
      (c.formulas || []).forEach(function (f) {
        if (!f.id || !f.text || !f.variables || !f.example) {
          errors.push(c.id + ' 公式字段不完整：' + (f && f.id));
        }
      });
      if (!c.demo || !c.demo.id) errors.push(c.id + ' 缺少演示');
      if (!c.exercise || !c.exercise.output) errors.push(c.id + ' 缺少练习产出');
      (c.exercise && c.exercise.problemIds || []).forEach(function (pid) {
        if (!TSJ.findProblem || !TSJ.findProblem(pid)) errors.push(c.id + ' 练习引用了不存在的题目：' + pid);
      });
      (c.referenceIds || []).forEach(function (rid) {
        if (!refIndex[rid]) errors.push(c.id + ' 引用了不存在的来源：' + rid);
      });
      (c.prereq || []).forEach(function (p) {
        if (!courseIndex[p]) errors.push(c.id + ' 先修不存在：' + p);
      });
    });

    // 先修无环
    courses.forEach(function (c) { visit(c.id, [], errors); });
    function visit(id, stack, errs) {
      if (stack.indexOf(id) >= 0) { errs.push('课程先修存在环：' + stack.concat(id).join(' -> ')); return; }
      var c = courseIndex[id];
      if (!c) return;
      (c.prereq || []).forEach(function (p) { visit(p, stack.concat(id), errs); });
    }

    // 方法详情必须覆盖所有方法卡，且引用/级别合法
    var methodIds = methods.map(function (m) { return m.id; });
    methodIds.forEach(function (id) {
      var d = methodDetails[id];
      if (!d) { errors.push('方法缺少详情：' + id); return; }
      if (!VALID_RUN_LEVEL[d.runLevel]) errors.push(id + ' runLevel 非法：' + d.runLevel);
      if (!d.intuition || d.intuition.length < 10) errors.push(id + ' 直觉描述过短');
      if (!Array.isArray(d.assumptions) || !d.assumptions.length) errors.push(id + ' 缺少假设');
      if (!Array.isArray(d.limitations) || !d.limitations.length) errors.push(id + ' 缺少局限');
      if (!d.workedExample) errors.push(id + ' 缺少数值小例');
      if (!d.counterexample) errors.push(id + ' 缺少反例');
      (d.referenceIds || []).forEach(function (rid) {
        if (!refIndex[rid]) errors.push(id + ' 引用了不存在的来源：' + rid);
      });
      var m = methodIndex[id];
      if (m && m.runnable === false && d.runLevel === 'sandbox') {
        errors.push(id + ' 方法卡标注不可运行，详情却标为 sandbox');
      }
    });

    Object.keys(methodDetails).forEach(function (id) {
      if (!methodIndex[id]) errors.push('方法详情指向不存在的方法卡：' + id);
    });

    // 引用表自身
    var seen = {};
    references.forEach(function (r) {
      if (!r.id || seen[r.id]) errors.push('引用 id 缺失或重复：' + r.id);
      seen[r.id] = true;
      if (!/^https:\/\//.test(r.url || '')) errors.push(r.id + ' URL 必须为 https');
      if (!r.checkedAt) errors.push(r.id + ' 缺少核查日期');
    });

    return errors;
  }

  TSJ.content = {
    esc: esc,
    courses: courses,
    course: course,
    nextCourse: nextCourse,
    prevCourse: prevCourse,
    methodDetail: methodDetail,
    referencesFor: referencesFor,
    renderMarkdown: renderMarkdown,
    renderCourseBody: renderCourseBody,
    referenceListHtml: referenceListHtml,
    validate: validate
  };
})(typeof window !== 'undefined' ? window : this);
