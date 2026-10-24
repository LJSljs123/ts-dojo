/**
 * assets/js/app/storage.js —— 进度导出 / 导入 / 清空（T05）
 *
 * 加载顺序：core → store → storage → ui → a11y → views → pages → app.js
 * 挂载点：window.TSJ.appStorage
 *
 * 导出文件结构：
 *   { schema: 1, app: 'tsoj', exportedAt: <ms>, data: { progress, drafts, submissions }, hash }
 *   hash = FNV-1a(JSON.stringify(data))，用于识别「文件被手工改过」。
 *
 * 导入校验顺序（任一失败都给出具体原因，且**不动现有数据**）：
 *   JSON 合法 → app === 'tsoj' → schema ≤ 当前版本 → hash 匹配 → 字段白名单归一化。
 *
 * 清空只删 `tsoj:` 前缀的键，绝不 localStorage.clear()（同源下可能有别的页面数据）。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var schema = TSJ.appSchema;
  var store = TSJ.appStore;

  var MAX_FILE_BYTES = 4 * 1024 * 1024;   // 4MB：超过直接拒绝，避免把主线程读死

  /**
   * 生成导出包（纯函数，便于测试）。
   * @returns {Object} { schema, app, exportedAt, data, hash }
   */
  function buildBundle() {
    var data = {
      progress: store.state.progress,
      drafts: store.state.drafts,
      submissions: store.state.submissions
    };
    return {
      schema: core.CURRENT_SCHEMA,
      app: 'tsoj',
      exportedAt: Date.now(),
      data: data,
      hash: core.fnv1a(JSON.stringify(data))
    };
  }

  /** 导出文件名：tsoj-progress-YYYYMMDD.json */
  function exportFileName(ts) {
    return 'tsoj-progress-' + core.fmtDateStamp(ts) + '.json';
  }

  /**
   * 触发浏览器下载（Blob + a.download）。
   * @returns {string} 实际写入文件的内容（测试可直接比对）
   */
  function exportProgress() {
    var text = JSON.stringify(buildBundle(), null, 2);
    try {
      var blob = new global.Blob([text], { type: 'application/json' });
      var url = global.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(Date.now());
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      global.setTimeout(function () {
        try { global.URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 0);
    } catch (e) {
      return text;   // 下载不可用（极少见）时至少把内容交给调用方
    }
    return text;
  }

  /**
   * 校验并解析导入文本。
   * @param {string} text 文件内容
   * @returns {{ok: boolean, reason: string, data: ?Object, schema: number, counts: ?Object}}
   */
  function parseBundle(text) {
    var fail = function (reason) {
      return { ok: false, reason: reason, data: null, schema: -1, counts: null };
    };

    if (typeof text !== 'string' || text.length === 0) return fail('文件是空的，没有可导入的内容。');
    if (text.length > MAX_FILE_BYTES) return fail('文件超过 4MB，不像是本程序导出的进度文件。');

    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return fail('文件不是合法的 JSON，无法解析。');
    }
    if (!core.isPlainObject(obj)) return fail('文件内容不是一个对象，无法解析。');

    if (obj.app !== 'tsoj') {
      return fail('这不是 TSOJ 的进度文件（缺少 app: "tsoj" 标记）。');
    }

    var ver = Number(obj.schema);
    if (!isFinite(ver) || ver < 0) {
      return fail('文件缺少合法的 schema 版本号。');
    }
    if (ver > core.CURRENT_SCHEMA) {
      return fail('文件版本过新（schema ' + ver + '），当前程序只支持到 schema ' +
        core.CURRENT_SCHEMA + '。请升级后再导入。');
    }

    if (!core.isPlainObject(obj.data)) return fail('文件缺少 data 字段，内容不完整。');

    var expect = core.fnv1a(JSON.stringify(obj.data));
    if (typeof obj.hash !== 'string' || obj.hash !== expect) {
      return fail('校验失败：内容与校验码不一致（文件可能被修改过）。');
    }

    // 字段白名单归一化：只接受 progress / drafts / submissions 三个键
    var data = {
      progress: schema.normalizeProgress(obj.data.progress),
      drafts: schema.normalizeDrafts(obj.data.drafts),
      submissions: schema.normalizeSubmissions(obj.data.submissions)
    };
    var counts = {
      progress: Object.keys(data.progress).length,
      drafts: Object.keys(data.drafts).length,
      submissions: data.submissions.length
    };
    return { ok: true, reason: '', data: data, schema: ver, counts: counts };
  }

  /**
   * 把解析后的数据合并进当前状态并落盘。
   * @param {Object} data { progress, drafts, submissions }
   * @returns {{progress: number, drafts: number, submissions: number}} 合并后的条目数
   */
  function applyImport(data) {
    var st = store.state;
    st.progress = store.mergeProgressForImport(st.progress, data.progress || {});
    // 草稿：导入值优先（用户是在「恢复备份」，备份里的代码即他的最新意图），未覆盖的题保留本机草稿
    var id;
    for (id in data.drafts) {
      if (Object.prototype.hasOwnProperty.call(data.drafts, id)) st.drafts[id] = data.drafts[id];
    }
    st.submissions = store.mergeSubmissions(st.submissions, data.submissions || []);
    store.saveProgress();
    store.saveDrafts();
    store.saveSubmissions();
    return {
      progress: Object.keys(st.progress).length,
      drafts: Object.keys(st.drafts).length,
      submissions: st.submissions.length
    };
  }

  /**
   * 读取用户选择的文件并导入。
   * @param {File} file 文件对象
   * @param {Function} done function(result) —— result: {ok, reason, counts}
   */
  function importFile(file, done) {
    var cb = typeof done === 'function' ? done : function () {};
    if (!file) { cb({ ok: false, reason: '没有选择文件。', counts: null }); return; }
    if (typeof global.FileReader !== 'function') {
      cb({ ok: false, reason: '当前浏览器不支持读取本地文件。', counts: null });
      return;
    }
    var reader = new global.FileReader();
    reader.onerror = function () {
      cb({ ok: false, reason: '读取文件失败，请重试。', counts: null });
    };
    reader.onload = function () {
      var parsed;
      try {
        parsed = parseBundle(String(reader.result || ''));
      } catch (e) {
        cb({ ok: false, reason: '解析文件时出错：' + ((e && e.message) || String(e)), counts: null });
        return;
      }
      if (!parsed.ok) { cb({ ok: false, reason: parsed.reason, counts: null }); return; }
      var counts = applyImport(parsed.data);
      cb({ ok: true, reason: '', counts: counts, schema: parsed.schema });
    };
    reader.readAsText(file, 'utf-8');
  }

  /**
   * 清空所有 tsoj:* 键（不动其它同源数据）。
   * @returns {string[]} 被删除的键
   */
  function clearAll() {
    var keys = [];
    try {
      var n = global.localStorage.length;
      for (var i = 0; i < n; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(core.STORAGE_PREFIX) === 0) keys.push(k);
      }
      for (var j = 0; j < keys.length; j++) global.localStorage.removeItem(keys[j]);
    } catch (e) {
      return keys;
    }
    store.resetState();
    return keys;
  }

  /**
   * 监听跨标签页的 storage 事件：同步 state 并通知 app 重渲染当前视图。
   * 只有我们自己的键变化才处理（其它页面的键与我们无关）。
   * @returns {Function} 解绑函数
   */
  function bindStorageSync() {
    if (typeof global.addEventListener !== 'function') return function () {};
    /** 处理 storage 事件。 */
    function onStorage(ev) {
      if (!ev) return;
      var key = ev.key;
      // key === null 表示 storage.clear()（别的页面整体清空）
      if (key !== null && String(key).indexOf(core.STORAGE_PREFIX) !== 0) return;
      var changed = store.reloadFromStorage();
      store.notifyExternal(key === null ? 'clear' : String(key).slice(core.STORAGE_PREFIX.length));
      if (changed && TSJ.appStore.updateScoreChip) TSJ.appStore.updateScoreChip();
    }
    global.addEventListener('storage', onStorage);
    return function () { global.removeEventListener('storage', onStorage); };
  }

  TSJ.appStorage = {
    buildBundle: buildBundle,
    exportFileName: exportFileName,
    exportProgress: exportProgress,
    parseBundle: parseBundle,
    applyImport: applyImport,
    importFile: importFile,
    clearAll: clearAll,
    bindStorageSync: bindStorageSync
  };
})(typeof window !== 'undefined' ? window : this);
