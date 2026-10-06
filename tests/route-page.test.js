'use strict';
// 行程模块重构后（P13，「四时果乡漫游」+ 果乡详情）的页面行为测试。
// 真实加载 route / fruit-town 页面与 farmtown-service，用内存 storage 与
// wx.request 桩返回种子果乡数据，不依赖真机或云托管。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const store = require('../miniprogram/lib/store');
const solar = require('../miniprogram/data/solar-term-notes');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = v => JSON.parse(JSON.stringify(v));
const wait = (ms = 35) => new Promise(r => setTimeout(r, ms));

const SAMPLE_TOWNS = [
  { id: 'town-luochuan', favId: 'fruit-town:townluochuan', name: '陕西洛川·王大爷苹果园', term: '秋分', fruit: '苹果', province: '陕西', city: '延安市', county: '洛川县', description: '黄土高原上的老果园', experiences: ['采摘', '观光'], transport: '自驾约20分钟', location: { latitude: 35.76, longitude: 109.43 }, published: true },
  { id: 'town-lingbao', favId: 'fruit-town:townlingbao', name: '河南灵宝·寺河山苹果园', term: '霜降', fruit: '苹果', province: '河南', city: '三门峡市', county: '灵宝市', description: '高山苹果', experiences: ['采摘'], transport: '自驾约40分钟', location: { latitude: 34.52, longitude: 110.88 }, published: true }
];

function responder(url) {
  if (url.includes('/api/farmtown/list')) return { towns: SAMPLE_TOWNS };
  if (url.includes('/api/farmtown/detail')) return { town: SAMPLE_TOWNS[0] };
  if (url.includes('/api/chat')) return { answer: '苹果在霜降后糖分积累，民间有“霜降苹果甜”的说法。' };
  return { error: 'not found' };
}

let memory;
let calls;
function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (k, v) => memory.set(k, clone(v)),
    removeStorageSync: k => memory.delete(k),
    navigateTo: o => calls.navigation.push(o.url),
    navigateBack: () => calls.navigation.push('navigateBack'),
    showToast: o => calls.toasts.push(o),
    showModal: o => { calls.modals.push(o); o.success && o.success({ confirm: true }); },
    openLocation: o => calls.locations.push(o),
    setNavigationBarTitle: () => {},
    request: (opts) => {
      calls.requests.push(opts.url);
      const result = responder(opts.url || '');
      if (result instanceof Error) { opts.fail && opts.fail({ errMsg: result.message }); return; }
      opts.success && opts.success({ statusCode: 200, data: result });
    }
  };
}

function makePage(name) {
  let definition;
  global.Page = value => { definition = value; };
  const base = name === 'fruit-town' ? '../miniprogram/packageFruit/pages' : '../miniprogram/pages';
  const file = path.resolve(__dirname, base, name, name + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback.call(this);
    }
  });
}

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], modals: [], locations: [], requests: [] };
  mockWx();
  store.clearAll();
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('route overview loads current term and fruit towns with markers', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    assert.equal(subject.data.currentTerm, solar.currentTerm(new Date()).name);
    assert.equal(subject.data.fruitTowns.length, 2);
    assert.equal(subject.data.markers.length, 2);
    assert.equal(subject.data.markers[0].latitude, SAMPLE_TOWNS[0].location.latitude);
    assert.equal(subject.data.markers[0].townId, SAMPLE_TOWNS[0].id);
    assert.ok(subject.data.favorited && typeof subject.data.favorited === 'object');
  });
});

test('selectTerm switches term and reloads, marker tap highlights its card', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.selectTerm({ currentTarget: { dataset: { term: '谷雨' } } });
    assert.equal(subject.data.currentTerm, '谷雨');
    return wait();
  }).then(() => {
    assert.equal(subject.data.fruitTowns.length, 2);
    const markerId = subject.data.markers[0].id;
    subject.onMarkerTap({ detail: { markerId } });
    assert.equal(subject.data.highlightId, subject.data.markers[0].townId);
  });
});

test('openTown navigates to fruit-town, openJournal to season-journal', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.openTown({ currentTarget: { dataset: { id: 'town-luochuan' } } });
    assert.equal(calls.navigation.at(-1), '/packageFruit/pages/fruit-town/fruit-town?id=town-luochuan');
    subject.openJournal();
    assert.equal(calls.navigation.at(-1), '/packageMore/season-journal/season-journal');
  });
});

test('toggleFavorite updates local state and persists via store', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    assert.equal(subject.data.favorited['town-luochuan'], false);
    subject.toggleFavorite({ currentTarget: { dataset: { id: 'town-luochuan' } } });
    assert.equal(subject.data.favorited['town-luochuan'], true);
    assert.ok(store.getKnowledgeFavorites('personal').includes('fruit-town:townluochuan'));
    assert.match(calls.toasts.at(-1).title, /已收藏/);
    subject.toggleFavorite({ currentTarget: { dataset: { id: 'town-luochuan' } } });
    assert.equal(subject.data.favorited['town-luochuan'], false);
  });
});

test('fruit-town detail loads town, defaults to fruit art, uses AI culture text', () => {
  const subject = makePage('fruit-town');
  subject.onLoad({ id: 'town-luochuan' });
  return wait(60).then(() => {
    assert.equal(subject.data.town.name, '陕西洛川·王大爷苹果园');
    assert.match(subject.data.imagePath, /fruit-art/);
    assert.ok(subject.data.storyText.length > 0);
    assert.equal(subject.data.cultureFrom, 'ai');
    assert.ok(subject.data.cultureText.length > 0);
    subject.openLocation();
    assert.equal(calls.locations.at(-1).latitude, 35.76);
    assert.equal(calls.locations.at(-1).name, '陕西洛川·王大爷苹果园');
    subject.goBack();
    assert.equal(calls.navigation.at(-1), 'navigateBack');
  });
});

test('fruit-town falls back to static culture when chat fails', () => {
  global.wx.request = (opts) => {
    if ((opts.url || '').includes('/api/chat')) { opts.fail && opts.fail({ errMsg: 'request:fail' }); return; }
    opts.success && opts.success({ statusCode: 200, data: responder(opts.url || '') });
  };
  const subject = makePage('fruit-town');
  subject.onLoad({ id: 'town-luochuan' });
  return wait(60).then(() => {
    assert.equal(subject.data.cultureFrom, 'static');
    assert.ok(subject.data.cultureText.length > 0);
  });
});

test('route markup and config reflect the 四时果乡漫游 redesign', () => {
  const folder = path.resolve(__dirname, '../miniprogram/pages');
  const routeJson = JSON.parse(fs.readFileSync(path.join(folder, 'route/route.json'), 'utf8'));
  assert.equal(routeJson.navigationBarTitleText, '果物四时记');
  assert.notEqual(routeJson.disableScroll, true);
  const routeWxml = fs.readFileSync(path.join(folder, 'route/route.wxml'), 'utf8');
  assert.doesNotMatch(routeWxml, /wx:for="{{stops}}"/);
  assert.match(routeWxml, /<me-entry\/>/);
  const ftWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageFruit/pages/fruit-town/fruit-town.wxml'), 'utf8');
  assert.match(ftWxml, /bindtap="openLocation"/);
});

test('route overview skips towns without a valid coordinate instead of crashing', () => {
  global.wx.request = (opts) => {
    if ((opts.url || '').includes('/api/farmtown/list')) {
      opts.success && opts.success({ statusCode: 200, data: { towns: [
        SAMPLE_TOWNS[0],
        { id: 'town-noloc', favId: 'fruit-town:townnoloc', name: '无坐标果乡', term: '秋分', fruit: '梨', province: '河南', city: '', county: '', description: '', experiences: [], transport: '', location: null, published: true },
        { id: 'town-zero', favId: 'fruit-town:townzero', name: '零坐标果乡', term: '秋分', fruit: '梨', province: '河南', city: '', county: '', description: '', experiences: [], transport: '', location: { latitude: 0, longitude: 0 }, published: true }
      ] } }); return;
    }
    opts.success && opts.success({ statusCode: 200, data: responder(opts.url || '') });
  };
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    assert.equal(subject.data.fruitTowns.length, 3, 'all towns stay in the list');
    assert.equal(subject.data.markers.length, 1, 'only the valid-coordinate town gets a marker');
    assert.equal(subject.data.markers[0].townId, 'town-luochuan');
    assert.equal(subject.data.mapCenter.latitude, SAMPLE_TOWNS[0].location.latitude);
  });
});

test('route overview computes distance labels from device location', () => {
  global.wx.getLocation = opts => opts.success({ latitude: 34.5, longitude: 109.4 });
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    assert.equal(subject.data.fruitTowns.length, 2);
    assert.ok(subject.data.fruitTowns.every(t => typeof t.distanceText === 'string'));
    assert.match(subject.data.fruitTowns[0].distanceText, /距你/);
  });
});

test('marker tap opens a bottom card and close dismisses it', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    const markerId = subject.data.markers[0].id;
    subject.onMarkerTap({ detail: { markerId } });
    assert.equal(subject.data.selectedTown.id, SAMPLE_TOWNS[0].id);
    assert.equal(subject.data.selectedTown.distanceText, subject.data.fruitTowns[0].distanceText);
    subject.closePopup();
    assert.equal(subject.data.selectedTown, null);
  });
});
