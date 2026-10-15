'use strict';

// 2026-10-11 用户要求：English 下「水果卡」上的水果名要英文（截图里解锁弹窗写的是「葡萄」）。
// 处理：解锁弹窗 + 水果卡轮播都改走 lib/playground-controller.js 的 fruitDisplayName()，
// 它复用伴宠页已有的 comp_fruit_<模板id> 英文键 —— 同一个水果在三处显示同一个英文名。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const map = new Map();
global.wx = { getStorageSync: key => map.get(key), setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key), showToast() {}, navigateTo() {}, getWindowInfo: () => ({ pixelRatio: 2 }) };

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const templates = require('../miniprogram/data/companion-templates').templates;
const controller = require('../miniprogram/packageGame/lib/playground-controller');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

test.beforeEach(() => { map.clear(); store.exitDemo(); store.clearAll(); useLang('zh'); });

test('the six fruit templates all have an English name in the shared key set', () => {
  assert.equal(templates.length, 6, '水果模板共 6 个');
  const EXPECT = { watermelon: 'Watermelon', strawberry: 'Strawberry', apple: 'Apple', pear: 'Pear', grape: 'Grapes', kiwi: 'Kiwifruit' };
  templates.forEach(t => {
    const entry = i18n.dict['comp_fruit_' + t.id];
    assert.ok(Array.isArray(entry) && entry.length === 2, t.id + ' 缺 comp_fruit_ 键');
    assert.equal(entry[0], t.name, t.id + ' 中文侧应与模板名一致');
    assert.equal(entry[1], EXPECT[t.id], t.id + ' 英文名与约定不一致');
  });
});

test('fruitDisplayName follows the language and never goes blank', () => {
  const display = controller.fruitDisplayName;
  useLang('zh');
  assert.equal(display('grape', '葡萄'), '葡萄');
  assert.equal(display('pear', '梨'), '梨');
  useLang('en');
  assert.equal(display('grape', '葡萄'), 'Grapes', '用户截图那个：葡萄 → Grapes');
  assert.equal(display('pear', '梨'), 'Pear');
  assert.equal(display('kiwi', '猕猴桃'), 'Kiwifruit');
  assert.equal(display('watermelon', '西瓜'), 'Watermelon');
  assert.equal(display('unknown-id', '未知果'), '未知果', '查不到就原样，不许空白');
  assert.equal(display('grape', ''), 'Grapes');
  assert.equal(display('', ''), '');
});

test('both fruit-card call sites go through fruitDisplayName', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/lib/playground-controller.js'), 'utf8');
  assert.match(src, /unlockCelebration: \{ name: fruitDisplayName\(question\.fruitId, question\.fruit\)/, '解锁弹窗走按语言取名');
  assert.match(src, /const cards = list\.map\(item => \(\{ id: item\.id, name: fruitDisplayName\(item\.id, item\.name\)/, '水果卡轮播走按语言取名');
  assert.doesNotMatch(src, /unlockCelebration: \{ name: question\.fruit,/, '旧的直接取中文名的写法不该再出现');
});
