/**
 * tools/numbers.js —— 项目「数量口径」的唯一计算入口
 *
 * 为什么要有这个文件：README 里的题数 / 方法数 / 脚本数 / 测试条数都是手写的，
 * 每加一道题、一个方法、一条用例就会漂移。2026-10-26 一天之内就漂了三次
 * （P16 漏登记题库表、16→17 题数、218→221 测试条数）。
 *
 * 用法：
 *   node tools/numbers.js          # 打印当前口径 + README 里对不上的地方
 *   require('./tools/numbers')     # 测试里复用 compute() / checkReadme()
 *
 * 原则：只算，不改。README 的修改必须由人确认（工具只报告不一致）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** 重新加载一个内容模块（避免 require 缓存导致数字陈旧）。 */
function freshRequire(rel) {
  const file = path.join(ROOT, 'assets', 'js', rel);
  delete require.cache[require.resolve(file)];
  require(file);
}

/**
 * 从源码现算全部口径。
 *
 * 依赖的模块都是纯数据（不碰 DOM）：datasets / problems / methods / courses /
 * glossary / lab config。app 层与 chart 层不参与。
 *
 * @returns {Object} 口径对象
 */
function compute() {
  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  if (!hadWindow) global.window = global;
  delete global.TSJ;

  ['datasets', 'problems', 'methods', 'content/courses', 'content/glossary', 'lab/config']
    .forEach(freshRequire);

  const TSJ = global.TSJ;
  if (!TSJ || !TSJ.problems || !TSJ.methods) {
    throw new Error('numbers.js：内容模块没有挂到 TSJ 上，检查加载顺序');
  }

  const byTier = {};
  for (const t of TSJ.methodTiers) byTier[t.id] = 0;
  for (const m of TSJ.methods) byTier[m.tier] = (byTier[m.tier] || 0) + 1;

  const byDifficulty = {};
  for (const p of TSJ.problems) byDifficulty[p.difficulty] = (byDifficulty[p.difficulty] || 0) + 1;

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = (html.match(/<script\s+src=/g) || []).length;
  const styles = (html.match(/<link[^>]+rel="stylesheet"/g) || []).length;

  const qaDir = path.join(ROOT, 'tests', 'qa');
  let tests = 0;
  for (const f of fs.readdirSync(qaDir)) {
    if (!f.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(qaDir, f), 'utf8');
    tests += (src.match(/^test\(/gm) || []).length;
  }

  const bundlePath = path.join(ROOT, 'ts-dojo-standalone.html');
  const bundleKB = fs.existsSync(bundlePath)
    ? Math.round(fs.statSync(bundlePath).size / 1024 * 10) / 10
    : 0;

  return {
    problems: TSJ.problems.length,
    byDifficulty,
    methods: TSJ.methods.length,
    byTier,
    tiers: TSJ.methodTiers.length,
    practice: TSJ.methods.filter((m) => !!m.practice).length,
    datasets: TSJ.datasets.length,
    courses: TSJ.courses.length,
    glossary: TSJ.glossary.length,
    labMethods: Object.keys(TSJ.labConfig.METHODS).length,
    scripts,
    styles,
    tests,
    bundleKB,
  };
}

/**
 * README 里必须与源码一致的数字表述。
 *
 * 每条 claim 都是「正则 + 期望值取法」，正则必须带一个捕获组（数字）。
 * 只收**唯一语义**的表述：像「120 条提交记录上限」这种常量不进表。
 */
const CLAIMS = [
  { re: /(\d+) 道题/g, of: (n) => n.problems, label: '题数' },
  { re: /(\d+) 道练习/g, of: (n) => n.problems, label: '练习数' },
  { re: /(\d+) 个方法/g, of: (n) => n.methods, label: '方法数' },
  { re: /(\d+) 条方法/g, of: (n) => n.methods, label: '方法卡片数' },
  { re: /(\d+) 张卡片/g, of: (n) => n.methods, label: '方法卡片数（张）' },
  { re: /(\d+) 个层次/g, of: (n) => n.tiers, label: '方法分层数' },
  { re: /(\d+) 个可练/g, of: (n) => n.practice, label: '可练方法数' },
  { re: /经典统计 (\d+)/g, of: (n) => n.byTier.classic, label: '经典统计数' },
  { re: /竞赛级方法 (\d+)/g, of: (n) => n.byTier.competition, label: '竞赛级方法数' },
  { re: /顶会深度学习 (\d+)/g, of: (n) => n.byTier.deep, label: '深度方法数' },
  { re: /时序基础模型 (\d+)/g, of: (n) => n.byTier.foundation, label: '基础模型数' },
  { re: /评估方法论 (\d+)/g, of: (n) => n.byTier.eval, label: '评估方法数' },
  { re: /(\d+) 个模块/g, of: (n) => n.courses, label: '课程模块数' },
  { re: /(\d+) 模块课程/g, of: (n) => n.courses, label: '课程模块数' },
  { re: /(\d+) 条行话/g, of: (n) => n.glossary, label: '术语数' },
  { re: /(\d+) 个白名单方法/g, of: (n) => n.labMethods, label: '实验室白名单方法数' },
  { re: /(\d+) 条数据(?=[、，])/g, of: (n) => n.datasets, label: '数据集数（实验室下拉）' },
  { re: /(\d+) 条合成数据集/g, of: (n) => n.datasets, label: '合成数据集数（目录树）' },
  { re: /(\d+) 个脚本/g, of: (n) => n.scripts, label: '脚本数' },
  { re: /(\d+) 个 `<script src>`/g, of: (n) => n.scripts, label: '脚本数（script 标签）' },
  { re: /(\d+) 个 js/g, of: (n) => n.scripts, label: '脚本数（目录树）' },
  { re: /(\d+) 条用例/g, of: (n) => n.tests, label: 'QA 用例数' },
  { re: /(\d+) 课程(?= \/)/g, of: (n) => n.courses, label: '课程模块数（自测表）' },
  { re: /(\d+) 方法详情/g, of: (n) => n.methods, label: '方法详情页数' },
  { re: /(\d+) 题参考解/g, of: (n) => n.problems, label: '参考解题数' },
  { re: /(\d+) 题模板/g, of: (n) => n.problems, label: '模板题数' },
  { re: /(\d+) 条数据完整性/g, of: (n) => n.methods, label: '方法数据完整性条数' },
  { re: /tests\/qa\/\*\.test\.js（(\d+) 条）/g, of: (n) => n.tests, label: 'QA 用例数（目录树注释）' },
];

/** 体积单独处理：产物每次重建会浮动几百字节，允许 ±3KB。 */
const BUNDLE_TOLERANCE_KB = 3;

/**
 * 检查 README 里的数字是否与现算一致。
 *
 * @param {Object} n compute() 的结果
 * @param {string} [readme] README 全文（默认读文件）
 * @returns {{claim: string, line: number, text: string, expected: number}[]} 不一致项
 */
function checkReadme(n, readme) {
  const text = readme || fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const bad = [];
  for (const c of CLAIMS) {
    const expected = c.of(n);
    const re = new RegExp(c.re.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      const got = Number(m[1]);
      if (got !== expected) {
        bad.push({
          claim: c.label,
          line: text.slice(0, m.index).split('\n').length,
          text: m[0],
          expected,
        });
      }
    }
  }
  // 体积：允许浮动
  const kbRe = /约 (\d+)KB/g;
  let m;
  while ((m = kbRe.exec(text))) {
    const got = Number(m[1]);
    if (Math.abs(got - n.bundleKB) > BUNDLE_TOLERANCE_KB) {
      bad.push({
        claim: '单文件版体积',
        line: text.slice(0, m.index).split('\n').length,
        text: m[0],
        expected: Math.round(n.bundleKB),
      });
    }
  }
  return bad;
}

/** 把口径格式化成可粘贴的表格行。 */
function format(n) {
  return [
    '题数            ' + n.problems + '  ' + JSON.stringify(n.byDifficulty),
    '方法数          ' + n.methods + '  ' + JSON.stringify(n.byTier),
    '可练方法        ' + n.practice,
    '数据集          ' + n.datasets,
    '课程模块        ' + n.courses,
    '术语            ' + n.glossary,
    '实验室白名单    ' + n.labMethods,
    '脚本 / 样式表   ' + n.scripts + ' / ' + n.styles,
    'QA 用例         ' + n.tests,
    '单文件版        ' + n.bundleKB + ' KB',
  ].join('\n');
}

if (require.main === module) {
  const n = compute();
  console.log(format(n));
  const bad = checkReadme(n);
  console.log('');
  if (!bad.length) {
    console.log('README 口径一致 ✓');
  } else {
    console.log('README 有 ' + bad.length + ' 处与源码不一致：');
    for (const b of bad) {
      console.log('  README:' + b.line + '  「' + b.text + '」 → 应为 ' + b.expected + '（' + b.claim + '）');
    }
    process.exitCode = 1;
  }
}

module.exports = { ROOT, compute, checkReadme, format, CLAIMS, BUNDLE_TOLERANCE_KB };
