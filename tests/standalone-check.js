/**
 * tests/standalone-check.js —— 单文件版产物校验
 *
 * 三件事：
 *   1. 产物存在，且与「按当前源码重新内联」的结果逐字一致（防止改了源码忘记重新生成）；
 *   2. 不含任何外部资源引用（script src / link href），否则在 srcdoc / 沙箱 iframe 里会白屏；
 *   3. 关键命名空间都在（防止内联时漏文件）。
 *
 * 用法：node tests/standalone-check.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'ts-dojo-standalone.html');

/** 与 tools/build-standalone.js 完全一致的内联逻辑（保持同步）。 */
function buildInMemory() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
    '<style>\n' + fs.readFileSync(path.join(ROOT, href.split('?')[0]), 'utf8') + '\n</style>');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    '<script>\n' + fs.readFileSync(path.join(ROOT, src.split('?')[0]), 'utf8')
      .replace(/<\/script/gi, '<\\/script') + '\n</script>');
  return html;
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['✓', name]);
  } catch (e) {
    results.push(['✗', name + ' → ' + e.message]);
  }
}

check('产物存在', () => {
  assert.ok(fs.existsSync(OUT), 'ts-dojo-standalone.html 不存在，请先运行 node tools/build-standalone.js');
});

check('产物与当前源码一致（未过期）', () => {
  const disk = fs.readFileSync(OUT, 'utf8');
  const expect = buildInMemory();
  assert.equal(disk.length, expect.length, '长度不一致，说明源码改过但没重新生成');
  assert.equal(disk, expect, '内容不一致，请重新运行 node tools/build-standalone.js');
});

check('无外部资源引用', () => {
  const html = fs.readFileSync(OUT, 'utf8');
  const refs = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs, [], '仍有外部引用：' + refs.join(', '));
});

check('19 个脚本全部内联，关键命名空间齐全', () => {
  const html = fs.readFileSync(OUT, 'utf8');
  const inlineCount = (html.match(/<script>/g) || []).length;
  assert.ok(inlineCount >= 20, '内联脚本数量偏少：' + inlineCount + '（应为 19 个模块 + 启动自检）');
  ['TSJ.datasets', 'TSJ.problems', 'TSJ.methods', 'TSJ.judge', 'TSJ.createEditor', 'TSJ.drawSeries',
    'TSJ.appCore', 'TSJ.appStore', 'TSJ.appStorage', 'TSJ.appViews', 'TSJ.appProblem',
    'TSJ.appPages', 'TSJ.appLibrary', 'TSJ.appBoards', 'TSJ.app'].forEach((ns) => {
    assert.ok(html.indexOf(ns) >= 0, '缺少命名空间：' + ns);
  });
});

check('内联后没有裸 </script> 提前截断', () => {
  const html = fs.readFileSync(OUT, 'utf8');
  // 每个内联脚本块内部不应再出现未转义的 </script（除块自身的结束标签外）
  const blocks = html.split('<script>').slice(1);
  blocks.forEach((b, i) => {
    const end = b.indexOf('</script>');
    assert.ok(end >= 0, '第 ' + (i + 1) + ' 个脚本块没有结束标签');
    assert.equal(b.slice(0, end).indexOf('</script'), -1, '第 ' + (i + 1) + ' 个脚本块内部有裸 </script');
  });
});

let failed = 0;
results.forEach(([mark, text]) => {
  if (mark === '✗') failed++;
  console.log('  ' + mark + ' ' + text);
});
console.log('');
console.log(failed === 0 ? 'IS_PASS: YES' : 'IS_PASS: NO（' + failed + ' 项失败）');
process.exitCode = failed === 0 ? 0 : 1;
