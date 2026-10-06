'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const original = { wx: global.wx, Page: global.Page };
const clone = value => JSON.parse(JSON.stringify(value));

function definition(name, basename = name) {
  let result;
  global.Page = value => { result = value; };
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, basename + '.js');
  delete require.cache[require.resolve(filename)];
  require(filename);
  return result;
}
function instance(source) {
  return Object.assign({}, source, { data: clone(source.data), setData(patch) { Object.assign(this.data, patch); } });
}
function language(value) {
  store.saveSettings({ language: value });
  i18n.invalidateLang();
}
function assertVisibleLabels(page, name, basename = name) {
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages', name, basename + '.wxml'), 'utf8');
  for (const key of new Set(Array.from(markup.matchAll(/\bL\.([a-zA-Z0-9_]+)/g), match => match[1]))) {
    assert.equal(typeof page.data.L[key], 'string', name + ' supplies ' + key);
    assert.ok(page.data.L[key].trim(), name + ' displays ' + key);
    assert.notEqual(page.data.L[key], key, name + ' resolves the dictionary entry ' + key);
  }
}

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

test('graph and heritage supply every visible label after loading in either language', () => {
  const graph = definition('graph');
  const heritage = definition('heritage', 'index');
  for (const lang of ['zh', 'en']) {
    language(lang);
    const graphPage = instance(graph); graphPage.onLoad({ season: 'autumn' });
    assertVisibleLabels(graphPage, 'graph');
    assert.equal(graphPage.data.L.gr_read_story, lang === 'zh' ? '读故事 ↗' : 'Read story ↗');
    const heritagePage = instance(heritage); heritagePage.onLoad();
    assertVisibleLabels(heritagePage, 'heritage', 'index');
  }
});

test('craft notes load translated product names and refresh dialect labels without reloading the module', () => {
  language('zh');
  const source = definition('fruit-note');
  for (const lang of ['zh', 'en', 'zh']) {
    language(lang);
    const page = instance(source);
    assert.doesNotThrow(() => page.onLoad({ fruit: 'spring-plum', cat: 'craft' }));
    assert.equal(page.data.category.learn.product, lang === 'zh' ? '青梅酱' : 'Green plum jam');
    assertVisibleLabels(page, 'fruit-note');
  }
});

test('an invalid fruit note still displays its explanation and back action', () => {
  const page = instance(definition('fruit-note'));
  page.onLoad({ fruit: 'missing', cat: 'craft' });
  assert.equal(page.data.invalid, true);
  assert.ok(page.data.L.fn_invalid_title);
  assert.ok(page.data.L.fn_back);
});
