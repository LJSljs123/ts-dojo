/**
 * tools/stamp-assets.js —— 把 index.html 里 52 处 `?v=` 换成资源内容的哈希
 *
 * 为什么不用手写版本号：项目从 v3.5 走到 v3.10，index.html 里的引用全都还挂着
 * `?v=3.5.0`。手写版本号忘改一次，浏览器就会把旧的 chart.js 从缓存里端出来，
 * `TSJ.drawParts is not a function` 静默吞掉 P18 的分量预览——而单文件版看不出来，
 * 因为它是内联的。内容哈希不可能忘记：它由文件本身算出来。
 *
 * 用法：
 *   node tools/stamp-assets.js          # 重新打标（会改写 index.html）
 *   node tools/stamp-assets.js --check  # 只检查，过期则退出码 1
 *   require('./tools/stamp-assets')     # 测试里复用 stamp()
 *
 * 原则：只改 `?v=` 的值，不动引用顺序、不增删标签。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

/**
 * 匹配 `<script src="...">` 与 `<link href="...">`。
 * 分三段捕获：前缀（含引号）、路径、引号，token 单独一段，便于精确重写。
 */
const REF = /(\s(?:src|href)=")([^"?:]+)(?:\?v=([0-9a-zA-Z.]*))?(")/g;

/**
 * 资源内容的短哈希（8 位十六进制）。
 *
 * 必须先按 LF 归一化：`core.autocrlf=true` 的机器上，一次 `git checkout` 就会把
 * 整个工作区改成 CRLF——字节变了、内容没变。若直接对字节算哈希，一次 checkout
 * 就能让 52 处 token 全部「过期」，跑一遍打标工具又生成一个空改动提交。
 * 归一化之后，token 只随语义内容变化。
 */
function hashOf(abs) {
  const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 8);
}

/** 扫出 index.html 里所有本地资源引用（跳过外链与锚点）。 */
function scan(html) {
  const out = [];
  let m;
  REF.lastIndex = 0;
  while ((m = REF.exec(html))) {
    const ref = m[2];
    if (/^(?:https?:)?\/\//.test(ref) || ref.charAt(0) === '#') continue;
    out.push({
      ref: ref,
      token: m[3] || '',
      start: m.index,
      end: m.index + m[0].length,
      head: m[1],
      tail: m[4]
    });
  }
  return out;
}

/**
 * 算出打过标的 HTML。
 * @returns {{html:string, changes:Array, missing:string[], total:number}}
 */
function stamp(html) {
  const refs = scan(html);
  const changes = [];
  const missing = [];
  let out = html;
  // 从后往前替换：前面的替换不会让后面的索引失效
  for (let i = refs.length - 1; i >= 0; i--) {
    const r = refs[i];
    const abs = path.join(ROOT, r.ref);
    if (!fs.existsSync(abs)) {
      missing.push(r.ref);
      continue;
    }
    const want = hashOf(abs);
    if (r.token === want) continue;
    changes.push({ ref: r.ref, from: r.token, to: want });
    out = out.slice(0, r.start) + r.head + r.ref + '?v=' + want + r.tail + out.slice(r.end);
  }
  changes.reverse();
  missing.reverse();
  return { html: out, changes: changes, missing: missing, total: refs.length };
}

if (require.main === module) {
  const check = process.argv.indexOf('--check') >= 0;
  const src = fs.readFileSync(INDEX, 'utf8');
  const res = stamp(src);

  if (res.missing.length) {
    console.error('index.html 引用了不存在的资源：');
    res.missing.forEach((r) => console.error('  ' + r));
    process.exit(2);
  }
  if (!res.changes.length) {
    console.log('index.html 的 ' + res.total + ' 处 ?v= 均与资源内容一致 ✓');
    process.exit(0);
  }
  if (check) {
    console.error('?v= 已过期（' + res.changes.length + '/' + res.total + ' 处），请运行 node tools/stamp-assets.js');
    res.changes.forEach((c) => console.error('  ' + c.ref + '  ' + (c.from || '(无)') + ' → ' + c.to));
    process.exit(1);
  }
  fs.writeFileSync(INDEX, res.html);
  console.log('重新打标 ' + res.changes.length + '/' + res.total + ' 处：');
  res.changes.forEach((c) => console.log('  ' + c.ref + '  ' + (c.from || '(无)') + ' → ' + c.to));
}

module.exports = { stamp: stamp, scan: scan, hashOf: hashOf, INDEX: INDEX, ROOT: ROOT };
