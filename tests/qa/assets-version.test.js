/**
 * A 组：发布级产物的一致性（多文件版）
 *
 *   1. 每个本地资源引用都带 ?v=，且 token 等于该文件内容的哈希；
 *   2. 引用的资源都真实存在（没有 404）；
 *   3. 引用数量与脚本/样式表数量自洽（防止正则失效后「零处全部一致」的假绿）。
 *
 * 为什么要有这组：index.html 里 52 处 `?v=` 一路停在 3.5.0，而项目已经走到
 * v3.10。老访客的浏览器会命中旧缓存——拿到没有 drawParts 的 chart.js，
 * P18 的分量预览就静默消失。单文件版查不出这个问题，因为它是内联的。
 *
 * 过期时的修法只有一条：node tools/stamp-assets.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const stampAssets = require('../../tools/stamp-assets.js');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const REFS = stampAssets.scan(HTML);

test('A01 index.html 的每个本地资源引用都带 ?v=，且 token 等于内容哈希', () => {
  const bare = REFS.filter((r) => !r.token).map((r) => r.ref);
  assert.deepEqual(bare, [], '这些引用没有 ?v= 缓存破坏参数：' + JSON.stringify(bare));

  const res = stampAssets.stamp(HTML);
  assert.deepEqual(
    res.changes.map((c) => c.ref + ' ' + c.from + '→' + c.to),
    [],
    '?v= 已过期，请运行 node tools/stamp-assets.js'
  );
});

test('A02 引用的资源都存在', () => {
  const missing = REFS.map((r) => r.ref).filter((r) => !fs.existsSync(path.join(ROOT, r)));
  assert.deepEqual(missing, [], 'index.html 引用了不存在的资源：' + JSON.stringify(missing));
});

test('A03 引用数量与脚本/样式表数量自洽', () => {
  const js = REFS.filter((r) => /\.js$/.test(r.ref));
  const css = REFS.filter((r) => /\.css$/.test(r.ref));
  console.log('    引用 ' + REFS.length + ' 处：' + js.length + ' 个 js + ' + css.length + ' 个 css');

  // 下界：防止正则被改坏后「扫不到引用 → 三条用例全绿」的假象
  assert.ok(js.length >= 40, '脚本引用只有 ' + js.length + ' 个，正则可能失效');
  assert.ok(css.length >= 3, '样式表引用只有 ' + css.length + ' 个，正则可能失效');
  assert.equal(js.length + css.length, REFS.length, '出现了既非 .js 也非 .css 的引用');

  // 与源码目录对账：assets 下每个 .js / .css 都必须被 index.html 引用
  const listed = new Set(REFS.map((r) => r.ref.replace(/\\/g, '/')));
  const onDisk = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (/\.(js|css)$/.test(name)) {
        onDisk.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    }
  })(path.join(ROOT, 'assets'));
  const orphan = onDisk.filter((f) => !listed.has(f));
  assert.deepEqual(orphan, [], '这些文件存在但没有被 index.html 引用：' + JSON.stringify(orphan));
});
