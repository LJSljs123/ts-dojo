/**
 * assets/js/app/pages.js —— 纯展示型页面：提交记录 / 提交详情 / 排行榜 / 学习路径
 *
 * 加载顺序：util → core → schema → store → storage → ui → a11y → views → problem → pages → app.js
 * 挂载点：window.TSJ.appPages
 *
 * 这些页面没有编辑器、没有判题会话，只是「状态 → HTML」的映射；刷新入口由 app.js 用
 * bindRefresh() 注入，避免反向依赖。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var store = TSJ.appStore;
  var storage = TSJ.appStorage;
  var ui = TSJ.appUi;
  var a11y = TSJ.appA11y;
  var problems = TSJ.problems;

  var $ = core.$;
  var esc = core.esc;
  var toScore = core.toScore;
  var fmtTime = core.fmtTime;
  var DIFF_CLASS = core.DIFF_CLASS;

  /** 由 app.js 注入的「重渲染当前视图」入口 */
  var refresh = null;

  /** 注入刷新入口。 */
  function bindRefresh(fn) {
    refresh = typeof fn === 'function' ? fn : null;
  }

  /** 触发刷新（未注入时静默忽略）。 */
  function doRefresh() {
    if (refresh) refresh();
  }

  /** verdict → 中文标签与 class。 */
  function verdictInfo(v) {
    if (v === 'AC') return { cls: 'verdict-ac', text: 'AC 通过' };
    if (v === 'RE') return { cls: 'verdict-re', text: 'RE 运行错误' };
    if (v === 'TLE') return { cls: 'verdict-tle', text: 'TLE 超时' };
    return { cls: 'verdict-wa', text: 'WA 未通过' };
  }

  /* ---------- 1. 提交记录页 ---------- */
  /** 渲染提交记录列表 + 存储操作条（导出 / 导入 / 清空）。 */
  function renderSubmissions() {
    var html = [];
    html.push('<div class="page">\n<div class="page-head"><h1>提交记录</h1>');
    html.push('<p class="sub">本地保存最近 120 条记录（含代码快照与逐测试点，可点开复盘）</p></div>');

    html.push('<div class="store-bar" role="group" aria-label="进度管理">');
    html.push('  <button type="button" class="btn" id="btnExport" title="把进度导出成 JSON 文件">导出进度</button>');
    html.push('  <button type="button" class="btn" id="btnImport" title="从 JSON 文件导入并合并进度">导入进度</button>');
    html.push('  <button type="button" class="btn btn-danger" id="btnClear" title="删除本机所有 TSOJ 进度">清空进度</button>');
    html.push('  <input type="file" id="importFile" class="hidden" accept="application/json,.json" aria-hidden="true" tabindex="-1">');
    html.push('</div>');

    if (store.state.submissions.length === 0) {
      html.push('<div class="empty"><span class="empty-icon">◌</span>还没有提交记录。<br>' +
        '<a href="#/problems">去题库挑一道题</a></div>');
    } else {
      html.push('<div class="table-wrap list-table"><table class="ptable"><thead><tr>');
      html.push('<th style="width:150px">时间</th><th>题目</th>\n<th class="num" style="width:80px">分数</th>');
      html.push('<th style="width:120px">结果</th>\n<th style="width:90px">指标</th>\n</tr></thead><tbody>');

      var cards = [];
      for (var i = 0; i < store.state.submissions.length; i++) {
        var s = store.state.submissions[i];
        var info = verdictInfo(s.verdict);
        var sid = esc(s.id);
        html.push('<tr class="srow" tabindex="0" data-sid="' + sid + '">\n<td class="idx">' + esc(fmtTime(s.at)) + '</td>');
        html.push('<td><a class="p-title" href="#/submission/' + sid + '">' + esc(s.title) + '</a></td>');
        html.push('<td class="num">' + esc(toScore(s.score)) + '</td>');
        html.push('<td><span class="' + info.cls + '" style="font-size:12.5px;font-weight:600">' + esc(info.text) + '</span></td>');
        html.push('<td class="num">' + esc(s.metric || '') + '</td>\n</tr>');

        cards.push('<article class="pcard srow-card" tabindex="0" data-sid="' + sid + '">');
        cards.push('  <div class="pc-head"><span class="pc-idx">' + esc(toScore(s.score)) + ' 分</span>' +
          '<a class="p-title" href="#/submission/' + sid + '">' + esc(s.title) + '</a></div>');
        cards.push('  <div class="pc-foot"><span class="' + info.cls + '">' + esc(info.text) + '</span>' +
          '<span class="pc-stat">' + esc(fmtTime(s.at)) + '</span>' +
          '<span class="pc-stat">' + esc(s.metric || '') + '</span></div>');
        cards.push('</article>');
      }

      html.push('</tbody></table></div>');
      html.push('<div class="pcards">' + cards.join('\n') + '</div>');
    }

    html.push('</div>');
    var view = $('#view');
    view.innerHTML = html.join('\n');
    bindStoreBar(view);
    bindSubmissionRows(view);
  }

  /** 绑定导出 / 导入 / 清空。 */
  function bindStoreBar(view) {
    var btnExport = $('#btnExport', view);
    var btnImport = $('#btnImport', view);
    var btnClear = $('#btnClear', view);
    var fileInput = $('#importFile', view);

    if (btnExport) {
      btnExport.addEventListener('click', function () {
        storage.exportProgress();
        a11y.toast('已导出进度文件', 'ok');
      });
    }
    if (btnImport && fileInput) {
      btnImport.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';   // 允许重复选同一个文件
        if (!file) return;
        storage.importFile(file, function (result) {
          if (!result.ok) {
            a11y.toast('导入失败：' + result.reason, 'err');
            return;
          }
          var verNote = '';
          if (result.appVersion && core.compareVersion(result.appVersion, core.VERSION) > 0) {
            verNote = ' · ⚠ 备份来自更新版本 v' + result.appVersion + '（当前 v' + core.VERSION + '），部分数据可能无法识别';
          } else if (result.appVersion) {
            verNote = ' · v' + result.appVersion;
          }
          a11y.toast('导入成功：进度 ' + result.counts.progress + ' 题 · 草稿 ' +
            result.counts.drafts + ' 份 · 提交 ' + result.counts.submissions + ' 条' + verNote, 'ok');
          doRefresh();
        });
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        a11y.confirmDanger({
          title: '清空本机进度？',
          body: '将删除本机所有 TSOJ 数据：各题最高分、提交记录、代码草稿、引导标记。此操作不可撤销。',
          hint: '建议先「导出进度」留一份备份。',
          confirmText: '确认清空',
          idPrefix: 'clear',
          onConfirm: function () {
            var keys = storage.clearAll();
            a11y.toast('已清空 ' + keys.length + ' 项本地数据', 'ok');
            store.updateScoreChip();
            doRefresh();
          }
        });
      });
    }
  }

  /** 绑定提交记录行 / 卡片：点击或 Enter 打开详情。 */
  function bindSubmissionRows(view) {
    var rows = core.$$('.srow', view);
    for (var i = 0; i < rows.length; i++) {
      rows[i].addEventListener('click', function (ev) {
        if (ev.target && ev.target.tagName === 'A') return;
        global.location.hash = '#/submission/' + this.getAttribute('data-sid');
      });
      rows[i].addEventListener('keydown', function (ev) {
        if (ev.target && ev.target.tagName === 'A') return;
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          global.location.hash = '#/submission/' + this.getAttribute('data-sid');
        }
      });
    }
  }

  /* ---------- 2. 提交详情页 ---------- */
  /** 按 id 找提交记录。 */
  function findSubmission(id) {
    for (var i = 0; i < store.state.submissions.length; i++) {
      if (store.state.submissions[i].id === id) return store.state.submissions[i];
    }
    return null;
  }

  /**
   * 渲染提交详情：题目 / 时间 / 分数 / verdict / 逐测试点 / 只读代码快照。
   * @param {string} id 提交记录 id
   */
  function renderSubmissionDetail(id) {
    var view = $('#view');
    var s = findSubmission(id);

    if (!s) {
      view.innerHTML = '<div class="page"><div class="empty"><span class="empty-icon">◌</span>' +
        '找不到这条提交记录（可能已被清空或来自其它浏览器）。<br>' +
        '<a href="#/submissions">返回提交记录</a></div></div>';
      return;
    }

    var info = verdictInfo(s.verdict);
    var p = TSJ.findProblem(s.problemId);
    var html = [];

    html.push('<div class="page detail-page">');
    html.push('<div class="crumb"><a href="#/submissions">提交记录</a> / 详情</div>');
    html.push('<div class="page-head"><h1>' + esc(s.title || (p ? p.title : '未知题目')) + '</h1>');
    html.push('<p class="sub">提交于 ' + esc(fmtTime(s.at)) + ' · 记录 ' + esc(s.id) + '</p></div>');

    html.push('<div class="detail-head">');
    html.push('  <div class="detail-score"><b>' + esc(toScore(s.score)) + '</b><span>分</span></div>');
    html.push('  <div class="detail-meta">');
    html.push('    <div class="verdict ' + info.cls + '">' + esc(info.text) + '</div>');
    html.push('    <div class="result-sub">指标 ' + esc(s.metric || '—') +
      ' · 通过线 ' + (p ? esc(p.passScore) : '—') + ' 分</div>');
    if (s.degraded) html.push('    <div class="result-sub dim">该次判题在降级沙箱中执行</div>');
    html.push('  </div>');
    html.push('  <div class="detail-actions">');
    if (p) html.push('    <a class="btn" href="#/problem/' + esc(p.id) + '">回到题目</a>');
    html.push('    <a class="btn btn-ghost" href="#/submissions">返回提交记录</a>');
    html.push('  </div>\n</div>');

    // 逐测试点
    html.push('<h2 class="section-title">逐测试点</h2>');
    if (s.cases.length === 0) {
      html.push('<div class="notice">这条记录没有逐测试点明细（早于 v1 的记录只有总分）。</div>');
    } else {
      html.push(ui.renderCaseList(s.cases, false));
    }

    // 代码快照（只读、已转义、带语法高亮）
    html.push('<h2 class="section-title">提交时的代码</h2>');
    if (!s.code) {
      html.push('<div class="notice">这条记录没有代码快照（早于 v1 的记录只存了成绩）。</div>');
    } else {
      html.push('<pre class="detail-code" tabindex="0" aria-label="提交时的代码"><code>' +
        (TSJ.highlightCode ? TSJ.highlightCode(s.code) : esc(s.code)) + '</code></pre>');
      html.push('<p class="sub dim">代码快照最多保存 20KB，超出部分未保存。</p>');
    }

    html.push('</div>');
    view.innerHTML = html.join('\n');
  }

  TSJ.appPages = {
    bindRefresh: bindRefresh,
    verdictInfo: verdictInfo,
    renderSubmissions: renderSubmissions,
    findSubmission: findSubmission,
    renderSubmissionDetail: renderSubmissionDetail
  };
})(typeof window !== 'undefined' ? window : this);
