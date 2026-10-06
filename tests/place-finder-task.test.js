'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: turn } = require('node:timers/promises');
const store = require('../miniprogram/lib/store');
const booking = require('../miniprogram/lib/booking-service');
const i18n = require('../miniprogram/lib/i18n');
const original = { wx: global.wx, Page: global.Page, ensure: booking.ensureClient, credential: booking.getCredential };
let memory, requests, pages, credential, toast;
const taskId = '12345678-1234-1234-1234-123456789abc';
function page() {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/packageMore/place-finder/place-finder'); delete require.cache[file]; require(file);
  const instance = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  pages.push(instance); instance.onLoad(); return instance;
}
function answer(instance) {
  for (const [qid, oid] of [['fruits', '柿子'], ['activity', 'pick'], ['timing', 'soon']]) instance.toggleOption({ currentTarget: { dataset: { qid, oid } } });
}
function answerActivity(instance, fruitId, activityId) {
  // 先清空（page 的 onLoad 会从存储恢复上一次 persist 的答案，避免多选再次点击被取消）。
  instance.setData({ answers: {} });
  instance.toggleOption({ currentTarget: { dataset: { qid: 'fruits', oid: fruitId } } });
  instance.toggleOption({ currentTarget: { dataset: { qid: 'activity', oid: activityId } } });
}
// 默认后端带内置 token，generate 会先发网络请求；离线兜底在请求失败后才触发。
// 这里模拟请求失败，回到本地灵感地，返回页面实例。
async function localFinder(fruitId, activityId) {
  const finder = page(); answerActivity(finder, fruitId, activityId); finder.generate(); await turn();
  assert.ok(requests.length >= 1, '应有一次推荐请求');
  requests[requests.length - 1].fail({ errMsg: 'offline' });
  return finder;
}
function snapshot(status, places = []) { return { taskId, status, places, expiresAt: Date.now() + 60000, virtual: true }; }
const generatedPlace = { id: 'place-1', fruit: '柿子', name: '柿树山居', intro: '秋园采摘慢时光', virtual: true, month: 9, year: 2026, inSeason: true, harvestMonths: [9, 10, 11], image: '', imageStatus: 'failed' };
function reply(index, data, statusCode = 200) { requests[index].success({ statusCode, data }); }

test.beforeEach(() => {
  memory = new Map(); requests = []; pages = []; credential = 'a'.repeat(64); toast = '';
  global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, structuredClone(value)), removeStorageSync: key => memory.delete(key), setNavigationBarTitle() {}, showToast: value => { toast = value.title; }, request: options => requests.push(options) };
  booking.ensureClient = async (role, options) => { assert.equal(role, 'visitor'); assert.equal(options.allowDemoIdentity, true); return credential; };
  booking.getCredential = () => credential;
  store.saveSettings({ useAI: true }); i18n.invalidateLang();
});
test.afterEach(() => { pages.forEach(instance => instance.onUnload()); });
test.after(() => { global.wx = original.wx; global.Page = original.Page; booking.ensureClient = original.ensure; booking.getCredential = original.credential; });

test('requires both answers and falls back to fruit-consistent local ideas when a request fails (9.27/9.28 feedback)', async () => {
  const finder = page(); finder.generate(); assert.ok(toast); assert.equal(requests.length, 0);
  answer(finder); finder.generate(); await turn();
  assert.equal(requests[0].header['X-Booking-Client'], credential);
  assert.equal(requests[0].data.timing, 'unset', '评审 9.28④：出游时间题已删，固定提交 unset');
  assert.equal(finder.data.questions.length, 2, '只剩水果与玩法两道题');
  requests[0].fail({ errMsg: 'offline' });
  assert.equal(finder.data.busy, false);
  assert.ok(finder.data.places.length >= 1);
  assert.equal(finder.data.places.every(place => place.local), true);
  assert.equal(finder.data.places.every(place => place.fruits === undefined), true);
  assert.match(finder.data.places[0].name, /柿/, '评审 9.28①：本地灵感地与所选水果一致');
  assert.match(finder.data.places[0].image, /\/assets\/fruit-art\//, '评审 9.28②：本地灵感地配所选水果的插画');
  assert.match(finder.data.places[0].monthsText, /月/, '评审 9.28③：果期文案为自然语言区间');
  assert.match(finder.data.note, /云端未就绪/);
});

test('G22 three play methods yield three distinct local results and never empty (offline fallback)', async () => {
  const expectations = {
    pick: { must: /自采/, forbid: /取景|拍照|品尝|现做|现尝/ },
    photo: { must: /取景|拍照/, forbid: /自采|现做|现尝/ },
    taste: { must: /品尝|现做|现尝/, forbid: /自采|取景|拍照/ }
  };
  for (const activity of ['pick', 'photo', 'taste']) {
    const finder = await localFinder('柿子', activity);
    assert.ok(finder.data.places.length >= 1, '结果不为空');
    const intro = finder.data.places[0].intro;
    assert.match(intro, /柿/, '结果来自所选水果');
    assert.match(intro, expectations[activity].must, '玩法 ' + activity + ' 的体验文案正确');
    assert.doesNotMatch(intro, expectations[activity].forbid, '玩法 ' + activity + ' 不含其他玩法文案');
  }
});

test('G22 activity filter degrades gracefully when a fruit has no place for that method (offline fallback)', async () => {
  // 瓯江柑橘观景园只标 photo/taste，不标 pick；选 pick 时按玩法筛为空，应回退到水果匹配而非空结果。
  const pickFinder = await localFinder('瓯柑', 'pick');
  assert.ok(pickFinder.data.places.length >= 1);
  assert.match(pickFinder.data.places[0].name, /柑|橘/, '回退后仍返回所选水果对应的地点');
  const photoFinder = await localFinder('瓯柑', 'photo');
  assert.match(photoFinder.data.places[0].intro, /取景|拍照/);
});

test('accepted task is restored after leaving the page with identity context and polls instead of resubmitting', async () => {
  const finder = page(); answer(finder); finder.generate(); await turn(); reply(0, snapshot('queued'), 202);
  finder.onHide();
  const saved = memory.get('guayouji.place-recommend.v1.personal');
  assert.equal(saved.taskId, taskId); assert.ok(saved.ownerHint); assert.equal(JSON.stringify(saved).includes(credential), false);
  const restored = page(); restored.onShow(); await turn();
  assert.equal(requests.length, 2); assert.equal(requests[1].method, 'GET'); assert.ok(requests[1].url.endsWith(taskId));
  reply(1, snapshot('partial', [generatedPlace]));
  assert.equal(restored.data.places[0].intro, generatedPlace.intro); assert.equal(restored.data.busy, false);
  assert.equal(restored.data.places[0].imageStatus, 'failed'); assert.equal(restored.data.places[0].image, '');
});

test('a lost submission response reuses its idempotency key after re-entry', async () => {
  const finder = page(); answer(finder); finder.generate(); await turn();
  const firstId = requests[0].data.requestId; finder.onHide();
  const restored = page(); restored.generate(); await turn();
  assert.equal(requests[1].data.requestId, firstId);
});

test('changing identity does not restore another owner task', async () => {
  const finder = page(); answer(finder); finder.generate(); await turn(); reply(0, snapshot('queued'), 202); finder.onHide();
  credential = 'b'.repeat(64);
  const restored = page(); restored.onShow(); await turn();
  assert.equal(restored.data.taskId, ''); assert.equal(requests.length, 1); assert.deepEqual(restored.data.answers.fruits, ['柿子']);
});

test('late responses after leaving a page do not overwrite state in the next account', async () => {
  const finder = page(); answer(finder); finder.generate(); await turn(); finder.onHide();
  reply(0, snapshot('succeeded', [generatedPlace]));
  assert.equal(finder.data.taskId, ''); assert.deepEqual(finder.data.places, []);
});

test('failed illustration retries its existing task, with text retained and no new recommendation POST', async () => {
  const finder = page(); answer(finder); finder.generate(); await turn(); reply(0, snapshot('partial', [generatedPlace]), 202);
  finder.retryImage({ currentTarget: { dataset: { id: 'place-1' } } }); await turn();
  assert.ok(requests[1].url.endsWith(taskId + '/retry')); assert.deepEqual(requests[1].data, { placeId: 'place-1' });
  reply(1, snapshot('succeeded', [{ ...generatedPlace, imageStatus: 'succeeded', image: '/artifacts/' + taskId + '.png' }]), 202);
  assert.equal(finder.data.places[0].name, generatedPlace.name); assert.match(finder.data.places[0].image, /^https:\/\//);
  finder.generate(); await turn(); assert.notEqual(requests[2].data.requestId, requests[0].data.requestId, 'completed task does not prevent a fresh generation');
});

test('demo recommendation uses its personal cloud endpoint for requests, artifacts and task restoration', async () => {
  const apiBase = 'https://custom-recommendation.example/api';
  store.saveSettings({ apiBase, useAI: true }); store.saveSession({ token: 'c'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase); store.enterDemo();
  assert.notEqual(store.getSettings().apiBase, apiBase);
  const finder = page(); answer(finder); finder.generate(); await turn();
  assert.equal(requests[0].url, apiBase + '/api/place-recommend'); assert.equal(requests[0].header.Authorization, 'Bearer ' + 'c'.repeat(64));
  reply(0, snapshot('succeeded', [{ ...generatedPlace, imageStatus: 'succeeded', image: '/artifacts/' + taskId + '.png' }]), 202);
  assert.equal(finder.data.places[0].image, apiBase + '/artifacts/' + taskId + '.png');
  const saved = memory.get('guayouji.place-recommend.v1.demo'); assert.equal(saved.apiBase, apiBase); assert.ok(!JSON.stringify(saved).includes('c'.repeat(64)));
  finder.onHide(); const restored = page(); restored.onShow(); await turn();
  assert.equal(requests[1].url, apiBase + '/api/place-recommend/' + taskId); assert.equal(requests[1].header.Authorization, 'Bearer ' + 'c'.repeat(64));
  reply(1, snapshot('succeeded', [generatedPlace]));
});
test('same-host token rotation blocks a late recommendation response and refreshes request context', async () => {
  const apiBase = 'https://rotation-recommendation.example';
  store.saveSettings({ apiBase, useAI: true }); store.saveSession({ token: 'c'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  const finder = page(); answer(finder); finder.generate(); await turn();
  store.saveSession({ token: 'd'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  reply(0, snapshot('succeeded', [generatedPlace])); assert.deepEqual(finder.data.places, []); assert.equal(finder.data.taskId, '');
  finder.onShow(); finder.generate(); await turn(); assert.equal(requests[1].header.Authorization, 'Bearer ' + 'd'.repeat(64));
  reply(1, snapshot('succeeded', [generatedPlace])); assert.equal(finder.data.places[0].id, generatedPlace.id);
});
test('a connection change while acquiring a capability cannot dispatch to an unrelated host', async () => {
  const apiBase = 'https://old-recommendation.example';
  store.saveSettings({ apiBase, useAI: true }); store.saveSession({ token: 'c'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  let finish; booking.ensureClient = () => new Promise(resolve => { finish = resolve; });
  const finder = page(); answer(finder); finder.generate();
  store.saveSettings({ apiBase: 'https://new-recommendation.example' }); store.saveSession({ token: 'd'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://new-recommendation.example');
  finish(credential); await turn(); assert.equal(requests.length, 0);
});
