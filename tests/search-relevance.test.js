'use strict';

// P16 评审修改：果灵搜索页「生成的答案与问题没有逻辑关系」。
// 根因与修复：
// ① 单字别名子串匹配把「凤梨/梅雨/苹果手机」等无关词当成水果 → 复合词剔除 + 别名排斥词；
// ② 无水果命中时用「问题前四字」碰农谚原文并渲染一张没有正文的答案卡 → 改为只列相关农谚，
//    不再伪造答案卡；素材不足时诚实显示提示。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const original = { wx: global.wx, Page: global.Page };

function buildPage() {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/packageMore/search/search.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  page.onLoad();
  return page;
}

test.beforeEach(() => {
  global.wx = { getStorageSync: () => undefined, setStorageSync() {}, showToast() {}, navigateTo() {}, switchTab() {} };
  store.exitDemo(); store.clearAll();
});
test.after(() => { global.wx = original.wx; global.Page = original.Page; });

test('compound words that merely contain a fruit name no longer trigger an unrelated answer', () => {
  const page = buildPage();
  page.finishSearch('苹果手机好用吗');
  assert.equal(page.data.result, null, 'no answer card for the phone sense of 苹果');
  assert.equal(page.data.empty, true, 'the page honestly reports no match instead');
  page.finishSearch('梅雨季节水果容易坏吗');
  assert.equal(page.data.result, null, '梅雨 is weather, not the plum fruit');
  assert.equal(page.data.empty, true);
});

test('凤梨 questions answer with 菠萝 instead of dragging in 秋梨', () => {
  const page = buildPage();
  page.finishSearch('凤梨和菠萝的区别');
  assert.ok(page.data.result, 'a comparable answer is produced');
  const names = page.data.matched.map(item => item.name);
  assert.ok(names.includes('菠萝'), '菠萝 is matched');
  assert.ok(!names.includes('秋梨'), 'the 梨 alias is blocked inside 凤梨');
});

test('real fruit questions keep their grounded answers', () => {
  const page = buildPage();
  page.finishSearch('如何挑选西瓜');
  assert.ok(page.data.result);
  assert.ok(page.data.answerBlocks.length >= 3);
  assert.ok(page.data.answerBlocks.some(block => block.text.includes('西瓜')));
  page.finishSearch('李子和杏子有什么区别');
  assert.ok(page.data.matched.some(item => item.name === '李子'));
  assert.ok(page.data.matched.some(item => item.name === '杏'));
});

test('proverb-only matches no longer fabricate an empty answer card', () => {
  const page = buildPage();
  page.finishSearch('种瓜点豆要注意什么');
  assert.equal(page.data.result, null, 'no answer card without composed blocks');
  assert.equal(page.data.empty, false);
  assert.ok(page.data.proverbs.length > 0, 'related proverbs are still listed');
  page.finishSearch('今天天气怎么样');
  assert.equal(page.data.result, null);
  assert.equal(page.data.empty, true);
  assert.match(page.data.emptyNote, /换个关键词/);
});
