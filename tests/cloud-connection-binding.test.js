'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const service = require('../miniprogram/lib/service');
const previousWx = global.wx;
let requests;
const apiBase = 'https://custom-text.example/api';
function pair(token) { store.saveSession({ token: token.repeat(64), expiresAt: Date.now() + 60000 }, apiBase); }
test.beforeEach(() => { const memory = new Map(); requests = []; global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, structuredClone(value)), removeStorageSync: key => memory.delete(key), request: options => requests.push(options) }; store.exitDemo(); store.clearAll(); store.saveSettings({ apiBase, useAI: true }); pair('a'); });
test.after(() => { global.wx = previousWx; });
test('demo translation and health send the custom server token only to its bound host', async () => {
  store.enterDemo(); assert.notEqual(store.getSettings().apiBase, apiBase);
  const translated = service.translate(['西瓜'], 'en');
  assert.equal(requests[0].url, apiBase + '/api/translate'); assert.equal(requests[0].header.authorization, 'Bearer ' + 'a'.repeat(64));
  requests[0].success({ statusCode: 200, data: { translated: true, items: ['Watermelon'] } }); assert.deepEqual(await translated, ['Watermelon']);
  const health = service.getHealth(); assert.equal(requests[1].url, apiBase + '/health'); assert.equal(requests[1].header.authorization, 'Bearer ' + 'a'.repeat(64));
  requests[1].success({ statusCode: 200, data: { ok: true, auth: { required: true, authenticated: true }, model: { configured: true } } }); await health;
});
test('translation ignores late success after token rotation and does not clear the replacement session', async () => {
  const translated = service.translate(['西瓜'], 'en'); const rejected = assert.rejects(translated, /连接或账户已变更/);
  pair('b'); requests[0].success({ statusCode: 200, data: { translated: true, items: ['stale result'] } }); await rejected;
  assert.equal(store.getCloudConnection().token, 'b'.repeat(64));
});
test('AI toggle remains a local decision while enabled requests use the bound custom connection', async () => {
  store.saveSettings({ useAI: false }); await service.parseProfile('两个人', store.getProfile()); assert.equal(requests.length, 0);
  store.saveSettings({ useAI: true }); store.enterDemo();
  const result = service.parseProfile('两个人', store.getProfile()); assert.equal(requests[0].url, apiBase + '/api/profile'); assert.equal(requests[0].header.authorization, 'Bearer ' + 'a'.repeat(64));
  requests[0].fail({ errMsg: 'offline' }); await result;
});
