/**
 * studio-csv.test.js —— 模型工坊 CSV 解析（纯函数，不需要浏览器）
 *
 * 覆盖：单列 / 时间+数值 / 数值+时间 / 分号+逗号小数 / 点数下限 / 截断 / 季节估计 / 脏行跳过。
 * 这些用例锁住 parse() 的列序嗅探与校验口径——它是工坊「用自己的数据」的唯一入口。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..', '..');

/** app 层脚本以 IIFE + `this` 挂全局，用 vm 在全局上下文里执行才能共享 TSJ。 */
function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

delete globalThis.TSJ;
load('assets/js/app/util.js');
load('assets/js/app/core.js');
load('assets/js/app/studio-csv.js');
const csv = globalThis.TSJ.appStudioCsv;

function series(n, f) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(f(i));
  return out;
}

test('单列 + 表头：表头被跳过，数值逐行读入', () => {
  const text = 'value\n' + series(100, (i) => 100 + i).join('\n');
  const r = csv.parse(text, 'load.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 100);
  assert.equal(r.values[0], 100);
  assert.equal(r.values[99], 199);
  assert.equal(r.name, 'load');
});

test('两列「时间,数值」：日期字符串列被忽略，取数值列', () => {
  const rows = ['date,load'];
  for (let i = 0; i < 100; i++) {
    rows.push('2020-01-' + String((i % 28) + 1).padStart(2, '0') + ',' + (200 + i));
  }
  const r = csv.parse(rows.join('\n'), 'daily.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 100);
  assert.equal(r.values[0], 200);
  assert.equal(r.values[99], 299);
});

test('两列「数值,时间」：单调递增的时间列被识别并丢弃', () => {
  const rows = ['load,ts'];
  for (let i = 0; i < 100; i++) {
    rows.push((200 + (i % 7) * 3) + ',' + (1600000000 + i * 3600));   // 数值波动、时间严格递增
  }
  const r = csv.parse(rows.join('\n'), 'x.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 100);
  assert.equal(r.values[0], 200);
  assert.equal(r.values[1], 203);
});

test('分号分隔 + 逗号小数：1,5 解析为 1.5，时间列被丢弃', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(i + ';' + (100 + i / 10).toFixed(1).replace('.', ','));
  const r = csv.parse(rows.join('\n'), 'eu.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 100);
  assert.equal(r.values[0], 100);
  assert.equal(r.values[99], 109.9);
});

test('有效点不足 72：拒绝并给出明确原因', () => {
  const r = csv.parse('1\n2\n3\n', 'tiny.csv');
  assert.equal(r.ok, false);
  assert.match(r.error, /72/);
});

test('超过 5000 点：截取前 5000 并警告', () => {
  const r = csv.parse(series(6000, (i) => i).join('\n'), 'big.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 5000);
  assert.ok(r.warnings.some((w) => w.indexOf('5000') >= 0), '应提示已截断：' + r.warnings.join('|'));
});

test('无法解析的行被跳过并计入警告', () => {
  const rows = series(100, (i) => 100 + i);
  rows[10] = 'n/a';
  const r = csv.parse(rows.join('\n'), 'dirty.csv');
  assert.equal(r.ok, true);
  assert.equal(r.values.length, 99);
  assert.ok(r.warnings.some((w) => w.indexOf('跳过') >= 0), '应提示跳过行：' + r.warnings.join('|'));
});

test('季节周期估计：24 小时强周期被认出来', () => {
  const vals = series(240, (i) => 100 + 10 * Math.sin((2 * Math.PI * i) / 24));
  const r = csv.parse(vals.join('\n'), 'season.csv');
  assert.equal(r.ok, true);
  assert.equal(r.season, 24);
});

test('季节周期估计：纯趋势序列不强行套周期', () => {
  const vals = series(240, (i) => 100 + i);
  assert.equal(csv.guessSeason(vals), 1);
});

test('空文件：明确报错而不是抛异常', () => {
  const r = csv.parse('   \n\n', 'empty.csv');
  assert.equal(r.ok, false);
  assert.match(r.error, /空/);
});
