/**
 * tools/build-standalone.js —— 把模块化版本打包成「单文件 HTML」
 *
 * 用途：源码是 17 个 js + 1 个 css（便于维护），但有些宿主环境会把页面塞进
 * srcdoc / 沙箱 iframe / 只转发 HTML 的预览器，此时相对路径全部失效 → 白屏。
 * 单文件版把 CSS 与全部脚本内联，任何「能显示 HTML」的地方都能跑。
 *
 * 用法：node tools/build-standalone.js
 * 产物：ts-dojo-standalone.html（与 index.html 同级）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'ts-dojo-standalone.html');

/**
 * 内联一段 JS 时，必须拆开 `</script`，否则浏览器会提前结束脚本块。
 * 替换成 `<\/script`：在字符串 / 正则里语义等价，出现在代码结构里则不可能。
 * @param {string} code 源码
 * @returns {string}
 */
function guardScriptEnd(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** 读取并内联全部资源。 */
function build() {
  let html = fs.readFileSync(SRC, 'utf8');
  let inlinedCss = 0;
  let inlinedJs = 0;

  // 1) 样式表 → <style>
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
    const file = path.join(ROOT, href.split('?')[0]);
    const css = fs.readFileSync(file, 'utf8');
    inlinedCss++;
    return '<style>\n' + css + '\n</style>';
  });

  // 2) 外部脚本 → 内联脚本（保持原有顺序，顺序即依赖顺序）
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    const file = path.join(ROOT, src.split('?')[0]);
    const js = fs.readFileSync(file, 'utf8');
    inlinedJs++;
    return '<script>\n' + guardScriptEnd(js) + '\n</script>';
  });

  // 3) 单文件版不需要 noscript 之外的任何外链，检查一遍有没有漏网
  const leftovers = [...html.matchAll(/(?:src|href)="(?!data:|#)([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('http') && u !== '');

  fs.writeFileSync(OUT, html, 'utf8');
  const size = fs.statSync(OUT).size;
  console.log('已生成 ' + path.relative(ROOT, OUT));
  console.log('  内联样式表 ' + inlinedCss + ' 个 · 内联脚本 ' + inlinedJs + ' 个');
  console.log('  体积 ' + (size / 1024).toFixed(1) + ' KB');
  if (leftovers.length) {
    console.log('  ⚠ 仍有外部引用（若为 <a href> 可忽略）：' + leftovers.join(', '));
  } else {
    console.log('  ✓ 无任何外部资源引用');
  }
}

build();
