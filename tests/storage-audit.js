/**
 * tests/storage-audit.js —— localStorage 输出安全的静态审计
 *
 *   node tests/storage-audit.js
 *
 * 背景：`file://` 下 localStorage 属于共享的不透明源，同目录任意本地页面都能写入。
 * 因此 app.js 里凡是「从 storage 读出的字段」在拼进 innerHTML 之前，必须：
 *   1. 先归一化（toScore / toCount / toTime / toText）—— 数字字段做 Number() 归一；
 *   2. 再转义（esc）—— 防止被当成标签执行。
 *
 * 本脚本把这条约定固化成可回归的断言，并且**先在一段人造的「有缺陷代码」上验证扫描器本身有效**
 * （避免出现「扫描器永远返回 0 命中」的假绿）：
 *   - 不存在 `+ rec.best +` / `+ s.score +` 这类裸插值；
 *   - `html.push(...)` / innerHTML 行里出现的 storage 字段都被 esc() 或归一化函数包住；
 *   - 字段被当作条件（`rec.passed === true`、`rec.passed ?`）不算插值。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/** app 层源码（按加载顺序拼接后整体审计）：util → core → schema → store → storage → ui → a11y
 *  → views → problem → pages → boards → app.js */
const APP_FILES = [
  'app/util.js', 'app/core.js', 'app/schema.js', 'app/store.js', 'app/storage.js',
  'app/ui.js', 'app/a11y.js', 'app/views.js', 'app/problem.js', 'app/pages.js',
  'app/boards.js', 'app.js',
];
const SRC = APP_FILES
  .map((rel) => fs.readFileSync(path.join(ROOT, 'assets', 'js', rel), 'utf8'))
  .join('\n');

/** storage 里可能出现的字段名 */
const FIELDS = ['best', 'score', 'at', 'title', 'problemId', 'metric', 'verdict', 'passed', 'attempts'];
/** 允许的包装函数：转义 或 归一化（归一化后的数字 / 纯文本可以安全落地） */
const WRAPPERS = ['esc', 'toScore', 'toCount', 'toTime', 'toText', 'fmtTime', 'fmtNum', 'Number'];

const RAW_RE = new RegExp('\\+\\s*(?:rec|s|state\\.progress\\[[^\\]]+\\])\\.(?:' + FIELDS.join('|') + ')\\s*\\+', 'g');
const FIELD_RE = new RegExp('\\b(?:rec|s|row)\\.(?:' + FIELDS.join('|') + ')\\b', 'g');
/** 字段后面紧跟这些记号时，说明它被当作条件用，而不是被拼进 HTML */
const CONDITION_RE = /^\s*(===|!==|\?|&&|\|\|)/;

let failures = 0;

/**
 * 断言。
 * @param {boolean} ok 是否通过
 * @param {string} msg 说明
 */
function check(ok, msg) {
  if (ok) {
    console.log('  ✓ ' + msg);
  } else {
    failures++;
    console.log('  ✗ ' + msg);
  }
}

/**
 * 找出某个下标所在的最内层调用名（向前扫到第一个未配对的 '('）。
 * @param {string} line 一行源码
 * @param {number} idx 字段起始下标
 * @returns {string} 调用名（找不到则空串）
 */
function enclosingCall(line, idx) {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = /([A-Za-z_$][\w$.]*)\s*$/.exec(line.slice(0, i));
        return m ? m[1] : '';
      }
      depth--;
    }
  }
  return '';
}

/**
 * 扫描一段源码，返回违规点。
 * @param {string} src 源码
 * @returns {{raw: string[], naked: string[]}}
 */
function scanSource(src) {
  const raw = [];
  const naked = [];
  src.split('\n').forEach((line, i) => {
    const m0 = line.match(RAW_RE);
    if (m0) raw.push('L' + (i + 1) + ': ' + m0.join(','));

    if (line.indexOf('html.push(') === -1 && line.indexOf('innerHTML') === -1) return;
    FIELD_RE.lastIndex = 0;
    let m;
    while ((m = FIELD_RE.exec(line)) !== null) {
      const rest = line.slice(m.index + m[0].length);
      if (CONDITION_RE.test(rest)) continue;   // 只做条件判断，不落地到 HTML
      const tail = enclosingCall(line, m.index).split('.').pop();
      if (WRAPPERS.indexOf(tail) === -1) {
        naked.push('L' + (i + 1) + ' ' + m[0] + '（外层是 ' + (tail || '无') + '）');
      }
    }
  });
  return { raw, naked };
}

/* ------------------------------------------------------------------ */
console.log('\n=== 0. 扫描器自检：必须能抓到人造缺陷代码 ===');
const BAD = [
  "html.push('<span>历史最高 ' + rec.best + ' 分</span>');",
  "html.push('<td class=\"num\">' + s.score + '</td>');",
  "html.push('<td>' + s.title + '</td>');",
  "html.push('<td>' + esc(s.title) + '</td>');",
  "html.push('<td>' + (rec.passed === true ? 'ok' : 'no') + '</td>');"
].join('\n');
const badScan = scanSource(BAD);
check(badScan.raw.length === 3, '裸插值扫描命中 3 处（实际 ' + badScan.raw.length + '）');
check(badScan.naked.length === 3, '未转义插值扫描命中 3 处（实际 ' + badScan.naked.length + '）');

/* ------------------------------------------------------------------ */
console.log('\n=== 1. app.js：不存在裸插值（+ rec.best + / + s.score + …） ===');
const real = scanSource(SRC);
check(real.raw.length === 0, '没有裸插值' + (real.raw.length ? '：' + real.raw.join(' | ') : ''));

/* ------------------------------------------------------------------ */
console.log('\n=== 2. app.js：html.push / innerHTML 行里的 storage 字段都被 esc() 或归一化包住 ===');
check(real.naked.length === 0, '所有 storage 字段都过 esc()/归一化' + (real.naked.length ? '：' + real.naked.join(' | ') : ''));

/* ------------------------------------------------------------------ */
console.log('\n=== 3. readJSON 带类型守卫，装载三个键时都传了 guard ===');
check(/function readJSON\(key, fallback, guard\)/.test(SRC), 'readJSON 接受 guard 参数');
check(/typeof guard === 'function' && !guard\(val\)/.test(SRC), 'readJSON 对不合法数据做丢弃');
check(/writeJSON\(key, fallback\);\s*\/\/ 类型不符/.test(SRC), 'readJSON 丢弃时静默重写 storage');

/**
 * 生成「装载调用」的匹配式（容忍 core. 前缀与换行：拆分后调用点在 app/store.js）。
 * @param {string} key 存储键字段名
 * @param {string} empty 兜底值字面量
 * @param {string} guard 类型守卫函数名
 * @param {string} norm 归一化函数名
 * @returns {RegExp}
 */
function loadRe(key, empty, guard, norm) {
  const e = empty.replace(/[{}[\]]/g, '\\$&');
  return new RegExp(
    'readNormalized\\(\\s*(?:core\\.)?STORE\\.' + key + ',\\s*' + e +
    ',\\s*(?:core\\.)?' + guard + ',\\s*(?:core\\.|schema\\.)?' + norm
  );
}
check(loadRe('progress', '{}', 'isPlainObject', 'normalizeProgress').test(SRC), 'progress 用 isPlainObject 守卫');
check(loadRe('drafts', '{}', 'isPlainObject', 'normalizeDrafts').test(SRC), 'drafts 用 isPlainObject 守卫');
check(loadRe('submissions', '[]', 'isArrayValue', 'normalizeSubmissions').test(SRC), 'submissions 用 isArrayValue 守卫');

/* ------------------------------------------------------------------ */
console.log('\n=== 4. 归一化函数存在且会被回写 ===');
for (const fn of ['normalizeProgress', 'normalizeDrafts', 'normalizeSubmissions', 'toScore', 'toCount', 'toTime', 'toText']) {
  check(new RegExp('function ' + fn + '\\(').test(SRC), fn + ' 已定义');
}
check(/before !== after\) writeJSON\(key, normalized\)/.test(SRC), '归一化结果与原值不同时静默回写');

/* ------------------------------------------------------------------ */
console.log('\n=== 5. esc() 实现覆盖 & < > " 四个字符 ===');
const escStart = SRC.indexOf('function esc(');
const escBody = SRC.slice(escStart, escStart + 400);
for (const [ch, ent] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;']]) {
  check(escBody.indexOf('/' + ch + '/g') >= 0 && escBody.indexOf(ent) >= 0, 'esc 转义 ' + ch + ' → ' + ent);
}

console.log(failures === 0 ? '\nIS_PASS: YES' : `\nIS_PASS: NO（${failures} 项失败）`);
process.exit(failures === 0 ? 0 : 1);
