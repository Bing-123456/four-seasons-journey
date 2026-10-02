'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const core = require('../miniprogram/lib/core');
const service = require('../miniprogram/lib/service');
const catalog = require('../miniprogram/data/catalog');
const PERSONAL = 'guayouji.prototype.v1';
const DEMO = 'guayouji.demo.v1';
const MODE = 'guayouji.active-mode.v1';
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t) {
  const previousWx = global.wx;
  const disk = new Map(); let requests = 0;
  global.wx = { getStorageSync: key => disk.get(key), setStorageSync: (key, value) => disk.set(key, clone(value)), removeStorageSync: key => disk.delete(key), request: () => { requests++; throw new Error('demo must not send network requests'); } };
  store.exitDemo(); store.clearAll();
  t.after(() => { store.exitDemo(); store.clearAll(); global.wx = previousWx; });
  return { disk, requests: () => requests };
}
function personalState() {
  store.saveProfile({ ...catalog.defaultProfile, budget: 375, partySize: 3 });
  store.saveSettings({ useAI: true, apiBase: 'https://personal-backend.example' });
  store.saveSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://personal-backend.example');
  store.toggleFavorite('dahecun-museum');
  store.logEvent('personal_visit', { placeId: 'dahecun-museum', simulated: false });
}

test('demo account seeds real references with explicitly synthetic behavior and preserves the entire personal store', async t => {
  const env = fixture(t); personalState();
  const original = clone(env.disk.get(PERSONAL));
  const summary = store.enterDemo();
  assert.equal(summary.active, true); assert.equal(summary.simulated, true); assert.equal(summary.excludeFromTraining, true); assert.match(summary.personaLabel, /模拟旅客/);
  assert.equal(summary.routeStops, 2); assert.equal(summary.favoritesCount, 3); assert.equal(summary.completedLessons, 2);
  const route = store.getRoute(); assert.equal(core.validateRoute(route, store.getProfile()).valid, true); assert.equal(route.totalCost, null); assert.equal(route.simulated, true);
  assert.ok(route.stops.every(stop => catalog.places.some(place => place.id === stop.placeId && place.routeEligible && place.demo === false)));
  assert.ok(store.getFavorites().every(id => catalog.places.some(place => place.id === id && place.demo === false)));
  assert.deepEqual(store.getIntents(), []);
  assert.ok(store.getEvents().length >= 5); assert.ok(store.getEvents().every(event => event.details.simulated === true && event.details.scenarioId && event.details.personaLabel));
  assert.equal(store.getSettings().useAI, true, 'demo mirrors the device-level default'); assert.equal(store.getSettings().paired, false);
  // 云端连接为设备级：演示账户复用个人分区配对会话（token 不落入演示存储）。
  assert.equal(store.getSessionToken(), 'a'.repeat(64));
  assert.ok(!JSON.stringify(env.disk.get(DEMO)).includes('a'.repeat(64)), 'token stays out of the demo partition');
  assert.ok(!JSON.stringify(env.disk.get(DEMO)).includes('personal-backend'));
  const answer = await service.answerQuestion('瓜豆酱的原料是什么？', 'summer-kitchen'); assert.equal(answer.unanswerable, false); assert.equal(env.requests(), 1, 'demo text AI rides the device-level pairing now');
  await assert.rejects(service.pair('12345678'), /退出演示/); assert.equal(env.requests(), 1);
  assert.deepEqual(env.disk.get(PERSONAL), original);
  store.exitDemo();
  assert.deepEqual(env.disk.get(PERSONAL), original); assert.equal(store.getProfile().budget, 375); assert.equal(store.getSettings().useAI, true); assert.equal(store.getSessionToken(), 'a'.repeat(64));
});

test('demo changes stay isolated, repeated entry preserves progress and reset is deterministic', t => {
  const env = fixture(t); personalState(); const original = clone(env.disk.get(PERSONAL));
  store.enterDemo(); const initial = clone(env.disk.get(DEMO));
  store.saveProfile({ ...store.getProfile(), budget: 800 }); store.toggleFavorite('summer-kitchen');
  store.logEvent('workshop_complete', { simulated: false, placeId: 'summer-kitchen', ok: true });
  assert.equal(store.getEvents().at(-1).details.simulated, true);
  assert.ok(store.getEvents().at(-1).details.scenarioId); assert.equal(store.getProfile().budget, 800);
  store.enterDemo(); assert.equal(store.getProfile().budget, 800);
  assert.throws(() => store.saveSettings({ useAI: true }), /退出演示/);
  assert.throws(() => store.saveSession({ token: 'b'.repeat(64), expiresAt: Date.now() + 10000 }, store.getSettings().apiBase), /退出演示/);
  store.resetDemo(); assert.deepEqual(env.disk.get(DEMO), initial);
  store.resetDemo(); assert.deepEqual(env.disk.get(DEMO), initial);
  assert.deepEqual(env.disk.get(PERSONAL), original);
  store.exitDemo(); assert.equal(store.getProfile().budget, 375); assert.deepEqual(store.getFavorites(), ['dahecun-museum']);
});

test('clearing demo data cannot erase personal records and reset restores the presentation', t => {
  const env = fixture(t); personalState(); const original = clone(env.disk.get(PERSONAL));
  store.enterDemo(); store.clearAll();
  assert.equal(env.disk.has(DEMO), false); assert.equal(store.isDemoMode(), true); assert.deepEqual(store.getFavorites(), []);
  assert.deepEqual(env.disk.get(PERSONAL), original);
  store.resetDemo(); assert.equal(store.getDemoSummary().routeStops, 2);
  store.exitDemo(); assert.deepEqual(env.disk.get(PERSONAL), original);
  store.clearAll(); assert.equal(env.disk.has(PERSONAL), false); assert.equal(env.disk.has(DEMO), true);
});

test('demo activation failure leaves the personal account and mode unchanged', t => {
  const env = fixture(t); personalState(); const original = clone(env.disk.get(PERSONAL));
  const setter = wx.setStorageSync;
  wx.setStorageSync = (key, value) => { if (key === DEMO) throw new Error('quota'); setter(key, value); };
  assert.throws(() => store.enterDemo(), /保存失败/);
  assert.equal(env.disk.get(MODE), 'personal'); assert.equal(store.isDemoMode(), false); assert.deepEqual(env.disk.get(PERSONAL), original);
});

test('demo can be entered before any personal record exists and exits to untouched defaults', t => {
  const env = fixture(t);
  assert.equal(env.disk.has(PERSONAL), false); store.enterDemo(); store.exitDemo();
  assert.equal(env.disk.has(PERSONAL), false); assert.deepEqual(store.getProfile(), catalog.defaultProfile); assert.equal(store.getSettings().useAI, true);
});
