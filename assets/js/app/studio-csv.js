/**
 * assets/js/app/studio-csv.js —— 模型工坊：上传自己的 CSV 数据（v3.7）
 * 加载顺序：… app/studio-report → app/studio-csv → app/studio.js　挂载点：window.TSJ.appStudioCsv
 *
 * 支持形态（自动嗅探，全部只读本地文件，FileReader，零依赖）：
 *   - 单列数值：每行一个数（可带表头，自动跳过非数值行）
 *   - 两列「时间,数值」或「数值,时间」：时间列被忽略，取数值列
 *   - 逗号/分号/制表符分隔；分号或制表符分隔时支持逗号小数（1,5 → 1.5）
 *     —— 纯逗号分隔的文件里逗号一律当分隔符，避免「1,5」被误读成两列
 * 校验：至少 72 个有效数值点（否则 train 装不下）；季节周期自动估（自相关最高滞后的约数），
 *       也允许用户在工坊里手动改（返回值里的 season 只是初始建议）。
 * 持久化：tsoj:studioCsv:v1 存最近一份（原始数值 + 名称），刷新不丢；导出/分享不含他人数据。
 */
(function (global) {
  'use strict';

  var TSJ = global.TSJ || (global.TSJ = {});
  var core = TSJ.appCore;
  var KEY = core.STORE.studioCsv;
  var MIN_POINTS = 72;
  var MAX_POINTS = 5000;

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  /** 把一个单元格文本解析成数值；解析不了返回 null。 */
  function parseCell(tok) {
    var s = String(tok == null ? '' : tok).trim().replace(/^"|"$/g, '');
    if (!s) return null;
    // 逗号小数：仅当整体形如 123,45 且不含分隔歧义时尝试
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    var n = Number(s);
    // 允许 .5 / 5. 这类省略整数或小数位的写法（部分工具链的默认导出格式）
    return /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) && isFinite(n) ? n : null;
  }

  /** 嗅探分隔符：分号 / 制表符优先（它们不可能是小数分隔符），都没有才用逗号。 */
  function sniffSep(line) {
    if (line.indexOf(';') >= 0) return ';';
    if (line.indexOf('\t') >= 0) return '\t';
    return ',';
  }

  /**
   * 解析 CSV 文本 → { ok, values, name?, warnings[] }。
   * @param {string} text 原始文本
   * @param {string} [fileName] 文件名（用作数据集名）
   */
  function parse(text, fileName) {
    var warnings = [];
    var lines = String(text || '').split(/\r\n|\r|\n/);
    // 去掉首尾空行
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return { ok: false, error: '文件是空的。', warnings: warnings };

    var sep = sniffSep(lines[0]);
    var headerSkipped = false;
    var colIndex = -1;      // -1 = 未定（单列或首行嗅探）
    var values = [];
    var skipped = 0;

    for (var i = 0; i < lines.length; i++) {
      var toks = lines[i].split(sep);
      // 首个非空行若是纯表头（无任何可解析数值），跳过并尝试定位数值列
      if (colIndex < 0) {
        var numericAt = [];
        for (var c = 0; c < toks.length; c++) {
          if (parseCell(toks[c]) !== null) numericAt.push(c);
        }
        if (numericAt.length === 0) {
          if (!headerSkipped) { headerSkipped = true; continue; }   // 表头行
          continue;                                                // 空行/杂行
        }
        // 数值列选择：两列时把「单调递增」的那列当时间索引丢掉；都不单调则约定时间在前、取最后一列
        if (numericAt.length >= 2) {
          var first = numericAt[0], last = numericAt[numericAt.length - 1];
          if (numericAt.length === 2) {
            var monoFirst = isMonotonicColumn(lines, i, sep, first);
            var monoLast = isMonotonicColumn(lines, i, sep, last);
            if (monoFirst && !monoLast) colIndex = last;
            else if (monoLast && !monoFirst) colIndex = first;
            else colIndex = last;
          } else {
            colIndex = last;
            warnings.push('检测到 ' + numericAt.length + ' 个数值列，已取最后一列（其余列被忽略）。');
          }
        } else {
          colIndex = numericAt[0];
        }
      }
      var v = parseCell(toks[colIndex]);
      if (v === null) { skipped++; continue; }
      values.push(v);
      if (values.length >= MAX_POINTS) { warnings.push('已截取前 ' + MAX_POINTS + ' 个点（文件更长）。'); break; }
    }

    if (values.length < MIN_POINTS) {
      return {
        ok: false,
        error: '有效数值只有 ' + values.length + ' 个（需要至少 ' + MIN_POINTS +
          ' 点才能装下 train/val/test 三段）。',
        warnings: warnings
      };
    }
    if (skipped > 0) warnings.push('跳过了 ' + skipped + ' 行无法解析的内容。');
    return {
      ok: true,
      values: values,
      name: String(fileName || '我的数据').replace(/\.[^.]+$/, '').slice(0, 24) || '我的数据',
      warnings: warnings,
      season: guessSeason(values)
    };
  }

  /**
   * 某列是否「像时间索引」：从 start 行起采样最多 50 个有效数值，
   * 要求非递减且至少 3 个点（避免把两行数据误判成时间列）。
   */
  function isMonotonicColumn(lines, start, sep, col) {
    var prev = null, seen = 0;
    for (var k = start; k < lines.length && seen < 50; k++) {
      var v = parseCell(lines[k].split(sep)[col]);
      if (v === null) continue;
      // v <= prev：常数列不是时间索引（否则「值,时间」两列会取错数据列）
      if (prev !== null && v <= prev) return false;
      prev = v;
      seen++;
    }
    return seen >= 3;
  }

  /**
   * 粗估季节周期：一阶差分去掉趋势后，在 7/12/24/52/365 这些常见周期里
   * 取正自相关最高者；最高相关 < 0.25 时返回 1（不假设季节）。
   * 不用「全滞后绝对值最大」——半周期（如 24 的 12）反相相关也是 1，
   * 会让 24 小时数据被误判成 12。
   */
  function guessSeason(values) {
    var n = Math.min(values.length, 1500);
    var d = [];
    for (var i = 1; i < n; i++) d.push(values[i] - values[i - 1]);
    n = d.length;
    if (n < 30) return 1;
    var mu = 0;
    for (i = 0; i < n; i++) mu += d[i];
    mu /= n;
    var g0 = 0;
    for (i = 0; i < n; i++) g0 += Math.pow(d[i] - mu, 2);
    if (!(g0 > 1e-12)) return 1;   // 差分近常数 → 纯趋势，没有可识别周期
    var common = [7, 12, 24, 52, 365];
    var best = 1, bestR = 0;
    for (var c = 0; c < common.length; c++) {
      var lag = common[c];
      if (lag > Math.floor(n / 2)) continue;   // 至少两个完整周期才可信
      var acc = 0, cnt = 0;
      for (i = 0; i + lag < n; i++) { acc += (d[i] - mu) * (d[i + lag] - mu); cnt++; }
      var r = (acc / cnt) / (g0 / n);   // 按对数归一，跨 lag 可比
      if (r > bestR) { bestR = r; best = common[c]; }
    }
    return bestR >= 0.25 ? best : 1;
  }

  /** 注册为 TSJ.datasets 里的临时数据集（id 固定 'my-csv'，重复上传覆盖）。 */
  function register(parsed, seasonOverride) {
    if (!parsed || !parsed.ok) return null;
    var season = isFiniteNumber(seasonOverride) && seasonOverride > 1 ? Math.round(seasonOverride) : (parsed.season || 1);
    var freq = season === 365 ? 'D' : season === 52 ? 'W' : season === 12 ? 'M' : season === 24 ? 'H' : season === 7 ? 'D' : 'D';
    var ds = {
      id: 'my-csv',
      name: parsed.name + '（上传）',
      unit: '',
      freq: freq,
      season: season,
      desc: '用户上传的 CSV 数据（本地保存，仅当前浏览器可见）',
      values: parsed.values
    };
    var list = TSJ.datasets || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === 'my-csv') { list[i] = ds; persist(); return ds; }
    }
    list.push(ds);
    TSJ.datasets = list;
    persist();
    return ds;
  }

  /** 读文件并解析+注册。done({ok, ds?, error?, warnings})。 */
  function upload(file, seasonOverride, done) {
    var cb = typeof done === 'function' ? done : function () {};
    if (!file) { cb({ ok: false, error: '没有选择文件。' }); return; }
    if (file.size > 2 * 1024 * 1024) { cb({ ok: false, error: '文件超过 2MB（限 5000 点以内）。' }); return; }
    var reader = new global.FileReader();
    reader.onerror = function () { cb({ ok: false, error: '读取文件失败。' }); };
    reader.onload = function () {
      var parsed = parse(String(reader.result || ''), file.name);
      if (!parsed.ok) { cb({ ok: false, error: parsed.error, warnings: parsed.warnings }); return; }
      var ds = register(parsed, seasonOverride);
      cb({ ok: true, ds: ds, warnings: parsed.warnings });
    };
    reader.readAsText(file, 'utf-8');
  }

  /** 启动时恢复最近上传（存在则注册回 TSJ.datasets）。 */
  function restore() {
    var saved = core.readJSON(KEY, null, function (v) {
      return v && typeof v === 'object' && Array.isArray(v.values);
    });
    if (!saved || !saved.values || saved.values.length < MIN_POINTS) return null;
    return register({ ok: true, values: saved.values, name: saved.name || '我的数据', season: saved.season || 1 }, saved.season);
  }

  function persist() {
    var ds = null;
    for (var i = 0; i < (TSJ.datasets || []).length; i++) {
      if (TSJ.datasets[i].id === 'my-csv') ds = TSJ.datasets[i];
    }
    if (!ds) return;
    core.writeJSON(KEY, { values: ds.values, name: ds.name, season: ds.season });
  }

  function remove() {
    TSJ.datasets = (TSJ.datasets || []).filter(function (d) { return d.id !== 'my-csv'; });
    try { global.localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
  }

  /**
   * 工坊页装配：启动恢复上次 CSV + 重建数据集下拉 + 绑定上传按钮。
   * 由 app/studio.js 的 render 调用一次（DOM 就绪后）。
   * @param {Object} hooks { onDatasetChanged: Function } 上传成功后回调（重画拆分等）
   */
  function setupPanel(hooks) {
    var doc = global.document;
    function rebuildOptions(selectId) {
      var sel = doc.getElementById('studioDataset');
      if (!sel) return;
      var keep = selectId || sel.value;
      sel.innerHTML = (TSJ.datasets || []).map(function (d) {
        return '<option value="' + d.id + '">' + core.esc(d.name) + '（' + d.values.length + ' 点 · ' + d.freq + '）</option>';
      }).join('');
      sel.value = keep;
    }
    // 恢复上次上传
    var ds = restore();
    if (ds) {
      rebuildOptions(ds.id);
      var hint = doc.getElementById('studioCsvHint');
      if (hint) hint.textContent = '已恢复上次上传：' + ds.name + '（' + ds.values.length + ' 点）';
    }
    // 绑定上传
    var input = doc.getElementById('studioCsvFile');
    if (input) {
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.value = '';   // 允许重复选同一文件
        if (!f) return;
        upload(f, null, function (r) {
          var toast = TSJ.appA11y ? TSJ.appA11y.toast : function () {};
          if (!r.ok) { toast('CSV 导入失败：' + r.error, 'err'); return; }
          rebuildOptions('my-csv');
          var h = doc.getElementById('studioCsvHint');
          if (h) h.textContent = r.ds.name + '（' + r.ds.values.length + ' 点 · 季节 ' + r.ds.season + '）';
          (r.warnings || []).forEach(function (w) { toast(w, 'warn'); });
          toast('已导入 ' + r.ds.values.length + ' 个点，季节周期估为 ' + r.ds.season, 'ok');
          if (hooks && typeof hooks.onDatasetChanged === 'function') hooks.onDatasetChanged();
        });
      });
    }
    return { rebuildOptions: rebuildOptions };
  }

  TSJ.appStudioCsv = {
    setupPanel: setupPanel,
    MIN_POINTS: MIN_POINTS,
    parse: parse,
    guessSeason: guessSeason,
    register: register,
    upload: upload,
    restore: restore,
    remove: remove
  };
})(typeof window !== 'undefined' ? window : this);
