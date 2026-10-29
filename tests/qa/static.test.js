/**
 * static.test.js —— 静态审计（纯静态、无浏览器）
 *
 * 覆盖：语法检查、模块化违规、外部依赖、Math.random、脚本加载顺序、
 *       CSS class 覆盖率、localStorage 键名与异常处理、编辑器转义。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, JS_DIR } = require('./helpers/engine');

/**
 * 引擎与数据层（顺序即 index.html 加载顺序）
 * v3.0 新增 content/*（课程与方法详情）、charts/*（图表内核）、lab/*（实验室引擎）。
 */
const ENGINE_NAMES = ['datasets', 'problems', 'methods', 'judge', 'editor', 'chart'];
const CONTENT_NAMES = ['content/references', 'content/courses', 'content/method-details', 'content/content', 'content/glossary'];
const CHART_NAMES = ['charts/core', 'charts/series', 'charts/diagnostics'];
const LAB_NAMES = ['lab/config', 'lab/adapters', 'lab/stats', 'lab/runner'];
const ENGINE_FILES = ENGINE_NAMES.map((n) => path.join(JS_DIR, n + '.js'));
const CONTENT_FILES = CONTENT_NAMES.map((n) => path.join(JS_DIR, n + '.js'));
const CHART_FILES = CHART_NAMES.map((n) => path.join(JS_DIR, n + '.js'));
const LAB_FILES = LAB_NAMES.map((n) => path.join(JS_DIR, n + '.js'));
/**
 * app 层文件（顺序即加载顺序）：
 *   util → core → schema → store → storage → lifecycle → ui → a11y → theme
 *   → views → problem → pages → lab-storage → lab-panels → lab-live
 *   → studio-storage → studio-report → studio-csv → studio → achievements
 *   → dashboard → learn → method-detail → lab → library → glossary → boards
 *   → cmdk → app.js
 */
const APP_NAMES = [
  'util', 'core', 'schema', 'store', 'storage', 'lifecycle', 'ui', 'a11y', 'theme',
  'views', 'problem', 'pages', 'lab-storage', 'lab-panels', 'lab-live',
  'studio-storage', 'studio-report', 'studio-csv', 'studio', 'achievements',
  'dashboard', 'learn', 'method-detail', 'lab', 'library', 'glossary', 'boards', 'cmdk'
];
const APP_FILES = APP_NAMES.map((n) => path.join(JS_DIR, 'app', n + '.js'))
  .concat([path.join(JS_DIR, 'app.js')]);
/** 全部参与静态审计的脚本（顺序即 index.html 的加载顺序） */
const JS_FILES = ENGINE_FILES.concat(CONTENT_FILES, CHART_FILES, LAB_FILES, APP_FILES);
const ALL_JS = JS_FILES;
const read = (p) => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index.html'));
/** v3.0 样式拆成 tokens / legacy / components / pages，审计必须覆盖全部样式表 */
const CSS_FILES = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
  .map((m) => path.join(ROOT, m[1].split('?')[0]));
const css = CSS_FILES.map(read).join('\n');
const jsAll = JS_FILES.map(read).join('\n');
/** app 层源码拼接（存储/归一化/转义等审计跨文件进行） */
const appAll = APP_FILES.map(read).join('\n');
const appLineCounts = APP_FILES.map((f) => [path.relative(ROOT, f), read(f).split('\n').length - 1]);

test('node --check：所有 js 语法合法（含 tests/selftest.js）', () => {
  const files = ALL_JS.concat([path.join(ROOT, 'tests', 'selftest.js')]);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, path.basename(f) + ' 语法错误：' + r.stderr);
  }
});

test('app 层全部文件都 ≤350 行（可维护性上限）', () => {
  const over = appLineCounts.filter(([, n]) => n > 350).map(([f, n]) => f + '=' + n);
  assert.deepEqual(over, [], '以下文件超过 350 行：' + over.join(', '));
});

test('无 ESM 痕迹：无 import/export、无 type="module"', () => {
  for (const f of ALL_JS) {
    const src = read(f);
    assert.ok(!/^\s*(import|export)\s/m.test(src), path.basename(f) + ' 含 import/export');
  }
  assert.equal(html.indexOf('type="module"'), -1, 'index.html 使用了 type="module"');
  assert.equal(html.indexOf('nomodule'), -1);
});

test('无外部依赖：没有 http(s):// / //cdn / @import / url() 外链', () => {
  const check = (name, src) => {
  const hits = [];
  // 只拦「会真正发起加载」的写法；references.js 里的 https 字符串是内容数据，不是依赖
  const re = /(src\s*=\s*["']https?:|href\s*=\s*["']https?:|@import|url\(\s*["']?https?:)/g;
    let m;
    while ((m = re.exec(src)) !== null) hits.push(m[0] + ' @' + m.index);
    assert.equal(hits.length, 0, name + ' 含外部引用：' + hits.join(', '));
  };
  check('index.html', html);
  check('style.css', css);
  check('assets/js/*', jsAll);
  // 字体只能用系统字体
  assert.ok(!/@font-face/.test(css), 'style.css 含 @font-face（需要外部字体文件）');
});

test('无 Math.random（数据集必须确定性可复现）', () => {
  for (const f of JS_FILES) {
    assert.equal(read(f).indexOf('Math.random'), -1, path.basename(f) + ' 使用了 Math.random');
  }
});

test('script 加载顺序与 window.TSJ.* 依赖一致，且 app.js 在 body 末尾', () => {
  // 去掉 ?v= 缓存破坏参数后再比较，版本号变化不应影响顺序断言
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1].split('?')[0]);
  assert.deepEqual(order, [
    'assets/js/datasets.js',
    'assets/js/problems.js',
    'assets/js/methods.js',
    'assets/js/content/references.js',
    'assets/js/content/courses.js',
    'assets/js/content/method-details.js',
    'assets/js/content/content.js',
    'assets/js/content/glossary.js',
    'assets/js/judge.js',
    'assets/js/editor.js',
    'assets/js/chart.js',
    'assets/js/charts/core.js',
    'assets/js/charts/series.js',
    'assets/js/charts/diagnostics.js',
    'assets/js/lab/config.js',
    'assets/js/lab/adapters.js',
    'assets/js/lab/stats.js',
    'assets/js/lab/runner.js',
    'assets/js/app/util.js',
    'assets/js/app/core.js',
    'assets/js/app/schema.js',
    'assets/js/app/store.js',
    'assets/js/app/storage.js',
    'assets/js/app/lifecycle.js',
    'assets/js/app/ui.js',
    'assets/js/app/a11y.js',
    'assets/js/app/theme.js',
    'assets/js/app/views.js',
    'assets/js/app/problem-extras.js',
    'assets/js/app/problem.js',
    'assets/js/app/pages.js',
    'assets/js/app/lab-storage.js',
    'assets/js/app/lab-panels.js',
    'assets/js/app/lab-live.js',
    'assets/js/app/studio-storage.js',
    'assets/js/app/studio-report.js',
    'assets/js/app/studio-csv.js',
    'assets/js/app/studio.js',
    'assets/js/app/achievements.js',
    'assets/js/app/dashboard.js',
    'assets/js/app/learn.js',
    'assets/js/app/method-detail.js',
    'assets/js/app/lab.js',
    'assets/js/app/library.js',
    'assets/js/app/glossary.js',
    'assets/js/app/boards.js',
    'assets/js/app/cmdk.js',
    'assets/js/app/links.js',
    'assets/js/app/router.js',
    'assets/js/app.js',
  ]);
  // 每个文件必须真实存在
  for (const rel of order) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' 不存在');
  // app.js 是最后一个脚本，且之后没有 <script>（保证 init() 执行时 #view 已存在）
  const appIdx = html.indexOf('assets/js/app.js');
  assert.ok(appIdx > html.indexOf('id="view"'), 'app.js 必须在 #view 之后加载');
  assert.ok(appIdx < html.indexOf('</body>'), 'app.js 应在 </body> 之前');
  assert.equal(html.slice(appIdx).indexOf('<script'), -1, 'app.js 之后不应再有 script');
});

test('依赖方向：引擎层不得引用 app 层；app 层只能引用**更早加载**的命名空间', () => {
  // 1) 引擎文件（datasets/problems/judge/editor/chart）不能反向依赖应用层
  for (const f of ENGINE_FILES) {
    const src = read(f);
    assert.ok(!/TSJ\.app(Core|Store|Ui|Views)?\b/.test(src), path.basename(f) + ' 反向依赖了应用层');
    assert.ok(!/TSJ\.renderProblem|TSJ\.route\b/.test(src), path.basename(f) + ' 反向依赖了应用层');
  }
  // 2) app 层按固定顺序加载，每个文件只能引用排在自己前面的命名空间
  //    顺序与 APP_NAMES 一致：… studio 系 → achievements → dashboard → learn … → cmdk → app
  const namespaces = [
    'TSJ.appUtil', 'TSJ.appCore', 'TSJ.appSchema', 'TSJ.appStore', 'TSJ.appStorage',
    'TSJ.appLifecycle', 'TSJ.appUi', 'TSJ.appA11y', 'TSJ.appTheme', 'TSJ.appViews',
    'TSJ.appProblem', 'TSJ.appPages', 'TSJ.appLabStorage', 'TSJ.appLabPanels',
    'TSJ.appStudioStorage', 'TSJ.appStudioReport', 'TSJ.appStudioCsv', 'TSJ.appStudio',
    'TSJ.appAchievements', 'TSJ.appDashboard', 'TSJ.appLearn', 'TSJ.appMethodDetail',
    'TSJ.appLab', 'TSJ.appLibrary', 'TSJ.appGlossary', 'TSJ.appBoards', 'TSJ.appCmdk', 'TSJ.app',
  ];
  APP_FILES.forEach((file, idx) => {
    const src = read(file);
    for (let j = idx + 1; j < namespaces.length; j++) {
      const later = namespaces[j];
      // 用「后面不能再接字母」的边界判断，避免 TSJ.app 误匹配 TSJ.appCore / TSJ.appStore
      const re = new RegExp(later.replace('.', '\\.') + '(?![A-Za-z])');
      assert.ok(
        !re.test(src),
        path.relative(ROOT, file) + ' 引用了更晚加载的 ' + later + '（会形成反向依赖 / 循环依赖）'
      );
    }
  });
});

test('app.js 在脚本末尾同步 init()（依赖 body 末尾加载，而非 DOMContentLoaded）', () => {
  const src = read(path.join(JS_DIR, 'app.js'));
  assert.match(src, /\n\s{2}init\(\);\n/, 'app.js 应在 IIFE 末尾调用 init()');
  // 记录现状：没有 DOMContentLoaded 监听。当前靠「脚本位于 body 末尾」保证 DOM 就绪，
  // 若将来把 <script> 移到 <head> 或改成 async，会直接白屏（见报告 P2-3）。
  assert.equal(src.indexOf('DOMContentLoaded'), -1, '现状为同步 init，若改为 DOMContentLoaded 请同步更新用例');
});

test('CSS 覆盖率：JS/HTML 里出现的 class 都能在样式表中找到定义（30+ 个动态 class）', () => {
  const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  // 仅语义标记、样式由父选择器或 svg 属性负责，允许无独立定义；
  // tsc-* 是「分享卡」导出的自包含 HTML 文档内部样式（样式内嵌在导出文件里，不在本站样式表）
  const ALLOW = new Set(['tsj-editor-host', 'brand-logo', 'tsc-card', 'tsc-sub', 'tsc-foot']);

  const used = new Map();
  for (const f of ALL_JS.concat([path.join(ROOT, 'index.html')])) {
    const src = read(f);
    const name = path.basename(f);
    for (const m of src.matchAll(/class=\\?["']([^"'\\]*)/g)) {
      for (const tok of m[1].split(/\s+/)) {
        if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(tok) && !used.has(tok)) used.set(tok, name);
      }
    }
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([A-Za-z][\w-]*)'/g)) {
      if (!used.has(m[1])) used.set(m[1], name);
    }
  }
  // 运行时拼接的 class（DIFF_CLASS / verdict / vm-* / g1..g3 等）单独补上
  for (const c of [
    'chip-on', 'verdict-wa', 'verdict-ac', 'verdict-re', 'verdict-tle',
    'vm-ac', 'vm-re', 'vm-tle', 'vm-wa', 'diff-ru', 'diff-pu', 'diff-ti', 'diff-ch',
    'g1', 'g2', 'g3', 'rank-me', 'rank-you', 'warn', 'bad', 'best', 'mine', 'done',
    'cur', 'on', 'hidden', 'dragging', 'ed-ln-err', 'tok-kw', 'tok-str', 'tok-num', 'tok-com', 'tok-bi',
  ]) {
    if (!used.has(c)) used.set(c, 'runtime');
  }

  assert.ok(used.size >= 30, '抽查的 class 数量太少：' + used.size);
  const missing = [...used].filter(([c]) => !defined.has(c) && !ALLOW.has(c)).map(([c, f]) => c + '(' + f + ')');
  assert.deepEqual(missing, [], '样式表缺少定义：' + missing.join(', '));
});

test('localStorage：键名统一 tsoj:*，且没有未捕获的 JSON.parse', () => {
  // 拆分后存储层在 app/core.js、装载在 app/store.js，因此对整个 app 层拼接源码做审计
  const src = appAll;
  // 1) STORE 里所有键都以 tsoj: 开头
  const storeBlock = src.slice(src.indexOf('var STORE = {'), src.indexOf('};', src.indexOf('var STORE = {')));
  const keys = [...storeBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => s.indexOf(':') > 0);
  assert.ok(keys.length >= 5, '应至少有 5 个存储键');
  for (const k of keys) assert.match(k, /^tsoj:/, '键名未统一前缀：' + k);
  // 2) 不存在硬编码键的直接读写（必须走 STORE 常量）
  assert.equal(/localStorage\.(get|set|remove)Item\(\s*['"]/.test(src), false, '存在硬编码 localStorage 键');
  // 3) 所有 JSON.parse 都在 try 里
  assert.ok(src.indexOf('JSON.parse') > 0);
  const fnStart = src.indexOf('function readJSON');
  const fnBody = src.slice(fnStart, src.indexOf('\n  }', fnStart));
  assert.ok(fnBody.indexOf('try') > 0 && fnBody.indexOf('catch') > 0, 'readJSON 缺少 try/catch');
  assert.ok(/return fallback/.test(fnBody), 'readJSON 异常时应返回兜底值');
  // 4) 写失败（隐私模式/配额）必须静默
  const wStart = src.indexOf('function writeJSON');
  const wBody = src.slice(wStart, src.indexOf('\n  }', wStart));
  assert.ok(wBody.indexOf('try') > 0 && wBody.indexOf('catch') > 0, 'writeJSON 缺少 try/catch');
});

test('localStorage：init 装载三个键时都传了类型守卫 + 归一化函数（归一化在 app/schema.js）', () => {
  const flat = appAll.replace(/\s+/g, ' ');
  const cases = [
    ['progress', '{}', 'isPlainObject', 'normalizeProgress'],
    ['drafts', '{}', 'isPlainObject', 'normalizeDrafts'],
    ['submissions', '[]', 'isArrayValue', 'normalizeSubmissions'],
  ];
  for (const [key, empty, guard, norm] of cases) {
    const re = new RegExp(
      'readNormalized\\( ?(?:core\\.)?STORE\\.' + key + ', ' + empty.replace(/[{}[\]]/g, '\\$&') +
      ', (?:core\\.)?' + guard + ', (?:core\\.|schema\\.)?' + norm
    );
    assert.match(flat, re, key + ' 的装载缺少类型守卫或归一化');
  }
});

test('编辑器转义：<script> / </code> / <img onerror> 不会破坏高亮层结构', () => {
  const editor = require(path.join(JS_DIR, 'editor.js'));
  const payloads = [
    '<script>alert(1)</script>',
    '</code></pre><img src=x onerror=alert(1)>',
    'var s = "</code>";',
    "var s = '<script>';",
    '`</code>`',
    '<svg onload=alert(1)>',
  ];
  for (const p of payloads) {
    const out = editor.highlightCode(p);
    assert.equal(out.indexOf('<script'), -1, '出现了裸 <script：' + p);
    assert.equal(out.indexOf('</code>'), -1, '出现了裸 </code>：' + p);
    assert.equal(out.indexOf('<img'), -1, '出现了裸 <img：' + p);
    assert.equal(out.indexOf('<svg'), -1, '出现了裸 <svg：' + p);
    // 所有 < 必须属于我们自己生成的 span 标签
    const tags = [...out.matchAll(/<[^>]*>/g)].map((m) => m[0]);
    for (const t of tags) assert.match(t, /^<(\/)?span( class="tok-[a-z]+")?>$/, '出现了非预期标签：' + t);
  }
});

test('编辑器 escapeHtml 覆盖 & < >（文本节点安全）', () => {
  const editor = require(path.join(JS_DIR, 'editor.js'));
  assert.equal(editor.escapeHtml('<&>'), '&lt;&amp;&gt;');
  assert.equal(editor.escapeHtml('"quoted"'), '"quoted"'); // 文本节点无需转引号，已由调用方保证不在属性位
});

test('meta CSP 只做网络封锁：不得含 default-src / script-src / \'self\'（srcdoc 下会拦掉自身脚本）', () => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'index.html 必须声明 meta CSP');
  const policy = m[1];

  // 这一条是「防数据外传」的核心，必须保留
  assert.match(policy, /connect-src 'none'/, 'meta CSP 必须禁止 connect-src');

  /*
   * 回归背景（真实事故）：预览面板把 HTML 塞进 <iframe srcdoc> 渲染，
   * 此时文档处于「不透明源」，CSP 的 'self' 匹配不到任何 URL —— 页面自己的 17 个
   * 外部脚本会全部被拦掉，表现为整页白屏（连样式表也一起挂）。
   * 所以这里禁止出现任何基于来源的白名单指令。
   */
  assert.equal(policy.indexOf("'self'"), -1,
    "meta CSP 不能出现 'self'：srcdoc/不透明源下会拦掉页面自身的脚本与样式");
  assert.equal(/default-src/.test(policy), false, 'meta CSP 不能有 default-src（会连带限制脚本/样式来源）');
  assert.equal(/script-src/.test(policy), false, 'meta CSP 不能有 script-src（同上）');
  assert.equal(/style-src/.test(policy), false, 'meta CSP 不能有 style-src（同上）');
});
