'use strict';
const { pageFile } = require('./helpers/page-path');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const original = { wx: global.wx, Page: global.Page };
const clone = value => JSON.parse(JSON.stringify(value));

function page(name) {
  let definition;
  global.Page = value => { definition = value; };
  const file = pageFile(name);
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  });
}

function language(value) {
  store.saveSettings({ language: value });
  i18n.invalidateLang();
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

test('route language changes restore summary units and localize the saved trip without rewriting it', () => {
  const venue = catalog.places.find(item => item.routeEligible);
  const profile = Object.assign({}, clone(catalog.defaultProfile), {
    season: 'autumn', date: '2026-09-22', transport: 'drive', duration: 360,
    origin: Object.assign({ name: venue.name, address: venue.address, source: 'catalog' }, venue.location)
  });
  store.saveProfile(profile);
  const savedRoute = core.generateRoute(profile);
  assert.equal(savedRoute.ok, true);
  store.saveRoute(savedRoute);
  const before = clone(store.getRoute());
  const route = page('route');
  language('en'); route.onShow();
  assert.equal(route.data.dateLabel, 'Sep 22 · Tue');
  assert.equal(route.data.seasonTitle, 'Autumn Frost Fruits');
  assert.equal(route.data.transportLabel, 'Drive');
  assert.match(route.data.durationLabel, /^(\d+h(?: \d+ min)?|\d+ min)$/);
  assert.equal(route.data.L.rt_per_person_b, ' guests');
  assert.equal(route.data.L.rt_stops_unit, ' stops');
  assert.equal(route.data.L.rt_roundtrip, 'round trip included');
  assert.equal(route.data.L.rt_min, ' min');
  language('zh'); route.onShow();
  assert.equal(route.data.dateLabel, '9月22日 · 周二');
  assert.equal(route.data.seasonTitle, '霜天凝果');
  assert.equal(route.data.transportLabel, '自驾');
  assert.equal(route.data.L.rt_stops_unit, ' 站');
  assert.deepEqual(store.getRoute(), before);
});

test('search page drops the EN translation toggle and answers stay Chinese-only', () => {
  const fs = require('node:fs');
  for (const lang of ['zh', 'en']) {
    language(lang);
    const search = page('search'); search.onLoad();
    // 「EN英文译文」切换控件已删除：标签不再注入，页面数据不再保存英文态。
    assert.equal(search.data.L.fn_show_en, undefined);
    assert.equal(search.data.L.fn_show_zh, undefined);
    assert.equal('answerEn' in search.data, false);
    assert.equal('answerTranslating' in search.data, false);
    assert.equal(typeof search.toggleAnswerEn, 'undefined');
    assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageMore/search/search.wxml'), 'utf8'), /en-toggle|toggleAnswerEn|fn_show_en/);
  }
});
