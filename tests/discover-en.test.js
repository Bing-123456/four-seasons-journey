'use strict';

// 2026-10-11（用户报的两个问题）：
//  ①「发现」页抽屉：English 下 Season/Games 后面的句子被标签压住 —— 因为 .drawer-tag 写死 24px 窄列
//    （刚好放 2 个汉字），英文标签更宽就溢出压过去；Trips/News 短所以看着正常。
//  ②「Today's fruit: 桑葚」在英文下果名仍是中文 —— 原代码用果对象自带的 fruit.nameEn，
//    而这批对象有的没这个字段；改用 lib/fruit-name-en.js（42 果全覆盖）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const map = new Map();
global.wx = { getStorageSync: key => map.get(key), setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key) };

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const fruitNameEn = require('../miniprogram/lib/fruit-name-en');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

test.beforeEach(() => { map.clear(); store.exitDemo(); store.clearAll(); useLang('zh'); });

test('the drawer label column no longer has a fixed 24px width', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/index/index.wxss'), 'utf8');
  const rule = (wxss.match(/\.drawer-tag\{[^}]*\}/) || [''])[0];
  assert.ok(rule, '.drawer-tag 规则要在');
  // 去掉 min-width 后再看，避免把 min-width:24px 误判成写死的 width:24px
  assert.doesNotMatch(rule.replace(/min-width:24px/g, ''), /width:24px/, '不能再写死 24px（英文标签比它宽会压字）');
  assert.match(rule, /width:auto/, '改为自适应宽度');
  assert.match(rule, /min-width:24px/, '保留最小宽度，中文模式视觉不变');
  assert.match(rule, /white-space:nowrap/, '标签不许换行');
});

test('the season row uses the shared fruit-name helper instead of a maybe-missing nameEn', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/index/index.js'), 'utf8');
  assert.match(src, /const fruitNameEn = require\('\.\.\/\.\.\/lib\/fruit-name-en'\)/, '要引入果名表');
  assert.match(src, /en \? fruitNameEn\.nameEn\(fruit\.name\) : fruit\.name/, '英文模式走果名表');
  assert.doesNotMatch(src, /en \? fruit\.nameEn \|\| fruit\.name/, '不再依赖可能缺失的 fruit.nameEn');
});

test('the season fruit name is English in English mode (the 桑葚 case from the screenshot)', () => {
  useLang('zh');
  assert.equal(fruitNameEn.nameEn('桑葚'), '桑葚');
  useLang('en');
  assert.equal(fruitNameEn.nameEn('桑葚'), 'Mulberry', '截图那个：桑葚 → Mulberry');
  assert.equal(fruitNameEn.nameEn('柿子'), 'Persimmon');
  assert.equal(fruitNameEn.nameEn('查不到'), '查不到', '查不到原样返回，不许空白');
});
