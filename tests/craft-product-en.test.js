'use strict';
// 2026-10-13 回归：英文模式下「手艺成品名」不许出现汉字。
//
// 背景（体检报告 5.2）：i18n.js 的 product_* 键与当前 42 门手艺课对不上，只有青梅酱/桑葚酱命中，
// 其余 40 个在英文模式回退显示中文原名。回退发生在页面代码里，词典缺键不会报错、只会静默露中文：
//   · miniprogram/packageFruit/pages/fruit-note/fruit-note.js  productKey = 'product_' + category.learn.product
//   · miniprogram/packageMore/craft-lesson/craft-lesson.js      productKey = 'product_' + learn.product
// 所以这里两头都锁：① 词典对 42 个 craftProduct 逐个命中且英文侧无汉字；② 真跑一遍手艺小课堂页，
// 看英文模式下页面实际拿到的 product 字段。产品清单直接从数据源取，不手抄，免得两边再漂移。
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageFile } = require('./helpers/page-path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const world = require('../miniprogram/data/world-fruit-culture');
const fruitCulture = require('../miniprogram/data/fruit-culture');

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const original = { wx: global.wx, Page: global.Page };
const clone = value => JSON.parse(JSON.stringify(value));

// 产品清单 = world-fruit-culture.js 里 craft 维度的 learn.product（即页面查键用的 craftProduct）
const craftProducts = [...new Set(Object.values(world).flat()
  .filter(category => category.cat === 'craft' && category.learn && category.learn.product)
  .map(category => category.learn.product))];

function definition(name, basename) {
  let result;
  global.Page = value => { result = value; };
  const filename = pageFile(name, basename);
  delete require.cache[require.resolve(filename)];
  require(filename);
  return result;
}
function instance(source) {
  return Object.assign({}, source, { data: clone(source.data), setData(patch) { Object.assign(this.data, patch); } });
}
function language(value) { store.saveSettings({ language: value }); i18n.invalidateLang(); }

test.beforeEach(() => {
  const memory = new Map();
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    setNavigationBarTitle() {}, showToast() {}
  };
  i18n.invalidateLang();
});
test.after(() => { global.wx = original.wx; global.Page = original.Page; i18n.invalidateLang(); });

test('each craft product has a [中文, English] pair whose Chinese side is the product name itself', () => {
  // 数量变了说明产品清单动过，英文名要跟着重新核对（这正是 40 个中文名漏在外面的成因）
  assert.equal(craftProducts.length, 42, '手艺产品数已不是 42，需重新核对 product_* 英文名');
  craftProducts.forEach(product => {
    const entry = i18n.dict['product_' + product];
    assert.ok(Array.isArray(entry), '词典缺 product_' + product + '（英文模式会回退成中文名）');
    assert.equal(entry.length, 2, 'product_' + product + ' 必须是两元素数组');
    assert.equal(entry[0], product, 'product_' + product + ' 的中文侧必须与 craftProduct 逐字一致');
    assert.ok(typeof entry[1] === 'string' && entry[1].trim(), 'product_' + product + ' 的英文侧不许为空');
  });
});

test('English product names contain no Chinese characters; Chinese mode is unchanged', () => {
  language('en');
  const leaked = craftProducts.filter(product => HAN.test(i18n.t('product_' + product)));
  assert.deepEqual(leaked, [], '这些产品在英文模式仍显示中文名：' + leaked.join('、'));
  craftProducts.forEach(product => assert.doesNotMatch(i18n.dict['product_' + product][1], HAN, 'product_' + product + ' 的英文侧含汉字'));
  language('zh');
  craftProducts.forEach(product => assert.equal(i18n.t('product_' + product), product, '中文模式必须仍是中文原名'));
});

test('the craft lesson page shows no Chinese product name in English mode, for every fruit', () => {
  const source = definition('packageMore', 'craft-lesson/craft-lesson');
  const fruits = fruitCulture.seasons
    .flatMap(season => fruitCulture.fruitsForSeason(season.id))
    .filter(fruit => (fruit.categories || []).some(category => category.cat === 'craft' && category.learn));
  // 48 个水果共用 42 个 craftProduct（甘蔗/葡萄/柚/冬枣/橙各有两个季节版本），两个方向都要对严
  const usedProducts = [...new Set(fruits.map(fruit => fruit.categories.find(category => category.cat === 'craft').learn.product))];
  assert.deepEqual(usedProducts.slice().sort(), craftProducts.slice().sort(), '页面实际用到的产品名应与 world-fruit-culture 的 42 个 craftProduct 完全一致');
  for (const lang of ['en', 'zh']) {
    language(lang);
    fruits.forEach(fruit => {
      const craft = fruit.categories.find(category => category.cat === 'craft');
      const page = instance(source);
      assert.doesNotThrow(() => page.onLoad({ fruit: fruit.fullId }), fruit.fullId + ' 在 ' + lang + ' 模式加载不应报错');
      assert.ok(page.data.learnView, fruit.fullId + ' 应给出 learnView');
      if (lang === 'en') {
        assert.doesNotMatch(page.data.learnView.product, HAN, fruit.fullId + ' 的手艺成品名在英文模式仍含汉字：' + page.data.learnView.product);
        assert.equal(page.data.learnView.product, i18n.dict['product_' + craft.learn.product][1], fruit.fullId + ' 应取词典英文侧');
      } else {
        assert.equal(page.data.learnView.product, craft.learn.product, fruit.fullId + ' 中文模式必须逐字不改');
      }
    });
  }
});
