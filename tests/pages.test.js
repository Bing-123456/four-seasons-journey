'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { setImmediate: nextTurn } = require('node:timers/promises');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const store = require('../miniprogram/lib/store');
const service = require('../miniprogram/lib/service');

const originalWx = global.wx;
const originalPage = global.Page;
let calls;
let modalConfirm;
const clone = value => JSON.parse(JSON.stringify(value));
const venue = catalog.places.find(place => place.routeEligible);
const origin = { name: venue.name, address: venue.address, latitude: venue.location.latitude, longitude: venue.location.longitude, coordinateSystem: 'gcj02', source: 'catalog' };
const event = (dataset, value) => ({ currentTarget: { dataset: dataset || {} }, detail: { value } });

// This is a Page-controller harness, not a renderer. Every network request is mocked.
function loadPage(name) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages', name, name + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    getTabBar: () => ({ setData: value => calls.tabs.push(value) }),
    setData(patch) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.split('.');
        let destination = this.data;
        parts.slice(0, -1).forEach(part => { destination = destination[part]; });
        destination[parts[parts.length - 1]] = value;
      });
    }
  });
  return page;
}

test.beforeEach(() => {
  const memory = new Map();
  calls = { network: [], navigation: [], clipboard: [], modal: [], toasts: [], tabs: [] };
  modalConfirm = true;
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    request: options => { calls.network.push(options); options.fail({ errMsg: 'request:fail network disabled in tests' }); },
    navigateTo: options => calls.navigation.push(options.url),
    switchTab: options => calls.navigation.push(options.url),
    showToast: options => calls.toasts.push(options),
    setClipboardData: options => calls.clipboard.push(options.data),
    showModal: options => { calls.modal.push(options); options.success({ confirm: modalConfirm }); }
  };
  store.clearAll();
  store.saveSettings({ useAI: false });
  store.saveProfile(Object.assign({}, store.getProfile(), { origin: clone(origin), duration: 360, interests: ['culture', 'nature', 'photo'] }));
});

test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('profile parses editable autumn conditions, discloses defaults, and builds a valid trip', async () => {
  const page = loadPage('profile');
  page.onLoad();
  page.useExample(event({ index: 1 }));
  page.parse();
  assert.equal(page.data.parsing, true);
  await nextTurn();
  assert.equal(page.data.parsing, false);
  assert.equal(page.data.profile.season, 'autumn');
  assert.equal(page.data.profile.date, catalog.defaultProfile.date, 'unmentioned date stays user-confirmable, not a invented seasonal date');
  assert.equal(page.data.profile.partySize, 3);
  assert.equal(page.data.profile.budget, 300);
  assert.match(page.data.status, /本地规则/);
  assert.match(page.data.missingNotice, /日期/);
  page.setField(event({ field: 'budget' }, '240'));
  page.createRoute();
  assert.equal(calls.navigation[calls.navigation.length - 1], '/pages/route/route');
  assert.equal(store.getProfile().budget, 240);
  assert.equal(core.validateRoute(store.getRoute(), store.getProfile()).valid, true);
  assert.equal(calls.network.length, 0);
});

test('profile rejects invalid party sizes and removes the old route when new conditions have no solution', () => {
  const page = loadPage('profile'); page.onLoad(); page.createRoute();
  assert.equal(store.getRoute().ok, true);
  page.setField(event({ field: 'partySize' }, '0')); page.createRoute();
  assert.match(page.data.error, /1–20/);
  page.setField(event({ field: 'partySize' }, '2'));
  page.setField(event({ field: 'duration' }, '30'));
  page.createRoute();
  assert.equal(store.getRoute(), null);
  assert.match(page.data.error, /时间|起点/);
  assert.equal(page.data.building, false);
});

test('route excludes points, clears an infeasible route, and restores all points', () => {
  store.saveRoute(core.generateRoute(store.getProfile()));
  const page = loadPage('route'); page.onShow();
  assert.equal(calls.tabs[0].selected, 3);
  const first = page.data.stops[0];
  page.viewSource(event({ fact: first.factId }));
  assert.equal(page.data.sourceVisible, true);
  page.copySource(event({ id: page.data.sources[0].id }));
  assert.match(calls.clipboard[0], /^https:\/\//);
  page.closeSource(); assert.equal(page.data.sourceVisible, false);
  page.excludeStop(event({ id: first.placeId }));
  assert.ok(page.data.stops.every(stop => stop.placeId !== first.placeId));
  for (const place of catalog.places.filter(item => item.routeEligible)) page.excludeStop(event({ id: place.id }));
  assert.equal(page.data.route.ok, false);
  assert.deepEqual(page.data.stops, []);
  assert.equal(store.getRoute(), null);
  page.resetStops();
  assert.equal(page.data.route.ok, true);
  assert.deepEqual(page.data.excludedIds, []);
  assert.equal(page.simulateArrival, undefined);
  page.openStop(event({ id: page.data.stops[0].placeId }));
  assert.match(calls.navigation[calls.navigation.length - 1], /culture\?id=/);
  assert.doesNotMatch(calls.navigation[calls.navigation.length - 1], /arrived=/);
});

test('route uses its saved profile snapshot and keeps unknown total costs null', () => {
  const profile = store.getProfile();
  store.saveRoute(core.generateRoute(profile));
  store.saveProfile(Object.assign({}, profile, { partySize: 4, budget: 400 }));
  const page = loadPage('route'); page.onShow();
  assert.equal(page.data.profile.partySize, profile.partySize);
  assert.equal(page.data.profile.budget, profile.budget);
  assert.equal(page.data.route.totalCost, null);
  assert.equal(page.data.route.transportCost, null);
});

test('culture handles unknown ids, saves favorites, cites public facts, and refuses current opening claims', async () => {
  const invalid = loadPage('culture'); invalid.onLoad({ id: 'unknown' });
  assert.equal(invalid.data.place, null); assert.match(invalid.data.error, /不存在/);
  const page = loadPage('culture'); page.onLoad({ id: 'summer-culture', arrived: '1' });
  assert.equal(page.data.arrived, undefined); assert.ok(page.data.facts.length > 0);
  page.toggleFavorite(); assert.equal(page.data.favorite, true); assert.ok(store.getFavorites().includes('summer-culture'));
  page.toggleFavorite(); assert.equal(page.data.favorite, false);
  // 快问快答：点哪条答哪条（问答一一对应）。
  page.useQuestion(event({ index: 0 })); await nextTurn();
  assert.equal(page.data.answer.unanswerable, false); assert.match(page.data.answer.answer, /裴李岗/);
  // 自由提问走资料检索；资料不足时如实说不足以回答。
  page.setData({ question: '这个果园今天开放吗？' }); page.ask(); await nextTurn();
  assert.equal(page.data.answer && page.data.answer.unanswerable === true || page.data.error, true);
  // 文化资料全部直出，不再有资料依据/引用来源折叠入口。
  const cultureMarkup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/culture/culture.wxml'), 'utf8');
  assert.doesNotMatch(cultureMarkup, /资料依据|引用来源|viewAnswerSources|fact-trans-btn/);
  assert.equal(calls.network.length, 0);
});

test('culture exposes real materials without fabricated prices, remaining slots or booking actions', () => {
  for (const place of catalog.places) {
    const page = loadPage('culture'); page.onLoad({ id: place.id });
    assert.equal(page.data.place.demo, false);
    assert.equal(page.data.remaining, undefined);
    assert.equal(page.addIntent, undefined);
    assert.equal(page.changeParty, undefined);
    if (page.data.place.imageView) {
      assert.match(page.data.place.imageView.credit, /CC BY-SA|CC BY(?!-SA)|\bCC0\b|FAL/);
      assert.ok(page.data.place.imageView.sourceUrl);
    }
  }
  const template = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/culture/culture.wxml'), 'utf8');
  assert.doesNotMatch(template, /save-intent|intent-party|place\.price|剩余.*名额|\/assets\/henan-\{\{/);
  assert.equal(store.getIntents().length, 0);
});

test('service falls back on timeout without mislabeling local retrieval as cloud AI', async () => {
  store.saveSettings({ useAI: true });
  wx.request = options => { calls.network.push(options); options.fail({ errMsg: 'request:fail timeout' }); };
  const result = await service.answerQuestion('西瓜栽培技艺是哪个级别的非遗？', 'summer-culture');
  assert.equal(result.mode, 'local-retrieval'); assert.match(result.fallbackReason, /超时/); assert.match(result.answer, /市级/);
  assert.equal(calls.network[0].timeout, 45000);
  assert.equal(calls.network[0].url, store.getSettings().apiBase + '/api/ask');
});

test('service rejects unknown citations and source/evidence mismatches', async () => {
  store.saveSettings({ useAI: true });
  const baseline = core.answerQuestion('西瓜栽培技艺是哪个级别的非遗？', 'summer-culture');
  for (const patch of [{ sourceIds: ['bad'], evidenceIds: ['bad'] }, { sourceIds: ['S5'] }]) {
    wx.request = options => options.success({ statusCode: 200, data: Object.assign({}, baseline, { mode: 'openai-compatible' }, patch) });
    const answer = await service.answerQuestion('西瓜栽培技艺是哪个级别的非遗？', 'summer-culture');
    assert.equal(answer.mode, 'local-retrieval'); assert.match(answer.fallbackReason, /校验/);
    assert.deepEqual(answer.sourceIds, ['S4']);
  }
  wx.request = options => options.success({ statusCode: 200, data: Object.assign({}, baseline, { mode: 'openai-compatible' }) });
  const answer = await service.answerQuestion('西瓜栽培技艺是哪个级别的非遗？', 'summer-culture');
  assert.equal(answer.mode, 'openai-compatible'); assert.equal(answer.fallbackReason, undefined);
});
