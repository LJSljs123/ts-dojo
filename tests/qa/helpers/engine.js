/**
 * helpers/engine.js —— 在 Node 里加载「经典脚本」形式的 TSJ 源码。
 *
 * 说明：assets/js/*.js 都是 `(function (global) {...})(typeof globalThis !== 'undefined' ? globalThis : this)`
 * 形式，挂到 globalThis.TSJ 上，并在末尾 `module.exports = ...`。
 * 因此 Node 里**不需要** window 桩：globalThis 就是它们眼中的 window。
 * 唯一需要注意的是模块缓存：要「重新生成数据集」必须清缓存。
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // ts-dojo/
const JS_DIR = path.join(ROOT, 'assets', 'js');

const MODULES = ['datasets', 'problems', 'judge', 'editor', 'chart'];

function fileOf(name) {
  return path.join(JS_DIR, name + '.js');
}

/**
 * 清掉 TSJ 相关模块缓存并重置命名空间。
 */
function resetEngine() {
  for (const name of MODULES) {
    try {
      delete require.cache[require.resolve(fileOf(name))];
    } catch (e) {
      /* 未加载过则忽略 */
    }
  }
  delete globalThis.TSJ;
}

/**
 * 加载引擎（默认复用已有实例）。
 * @param {{fresh?: boolean}} [opts]
 * @returns {{judge: Object, TSJ: Object, datasets: Array, problems: Array, ROOT: string}}
 */
function loadEngine(opts) {
  const fresh = !!(opts && opts.fresh);
  if (fresh || !globalThis.TSJ || !globalThis.TSJ.judge) resetEngine();
  if (!globalThis.TSJ) globalThis.TSJ = {};
  require(fileOf('datasets'));
  require(fileOf('problems'));
  const judge = require(fileOf('judge'));
  const TSJ = globalThis.TSJ;
  return {
    judge,
    TSJ,
    datasets: TSJ.datasets,
    problems: TSJ.problems,
    ROOT,
    findDataset: TSJ.findDataset,
    findProblem: TSJ.findProblem,
  };
}

/**
 * 造一个「临时题目」，用来对判题器做受控实验。
 * @param {Object} over 覆盖字段
 * @param {number[]} values 数据集序列
 * @returns {{problem: Object, dataset: Object}}
 */
function makeCase(over, values) {
  const problem = Object.assign(
    {
      id: 'qa-tmp',
      index: 0,
      title: 'QA 临时题目',
      difficulty: '入门',
      tags: [],
      points: 100,
      passScore: 60,
      dataset: 'qa',
      mode: 'holdout',
      horizon: 4,
      metric: 'mse',
      baselines: ['naive'],
      threshold: 0.9,
    },
    over || {}
  );
  const dataset = {
    id: 'qa',
    name: 'QA 数据集',
    unit: 'u',
    freq: 'D',
    season: (over && over.season) || 4,
    desc: '',
    values: values.slice(),
  };
  return { problem, dataset };
}

/** 用参考解字符串包一层，得到「合法但无意义」的提交 */
const NAIVE_CODE = [
  'function predict(history, horizon, ctx) {',
  '  var last = history[history.length - 1];',
  '  var out = [];',
  '  for (var i = 0; i < horizon; i++) out.push(last);',
  '  return out;',
  '}',
].join('\n');

module.exports = { ROOT, JS_DIR, fileOf, loadEngine, resetEngine, makeCase, NAIVE_CODE };
