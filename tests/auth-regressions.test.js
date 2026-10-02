'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');
const catalog = require('../miniprogram/data/catalog');
const store = require('../miniprogram/lib/store');
const service = require('../miniprogram/lib/service');
const KEY = 'guayouji.prototype.v1';
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(t, remote = true, overrides = {}) {
  let clock = Date.now();
  const codes = []; const requests = []; const memory = new Map();
  const oldWx = global.wx;
  const config = { ...readConfig({}), host: remote ? '0.0.0.0' : '127.0.0.1', token: remote ? 'test-only-server-management-secret-123456789' : '', sessionTtlMs: 5000, ...overrides.config };
  const server = createServer({ config, now: () => clock, onPairingCode: info => codes.push(info), transport: overrides.transport });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = 'http://127.0.0.1:' + server.address().port;
  global.wx = {
    getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, clone(value)), removeStorageSync: key => memory.delete(key),
    request: async options => {
      try {
        const response = await fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : JSON.stringify(options.data) });
        requests.push({ path: new URL(options.url).pathname, status: response.status, headers: options.header, input: options.data });
        options.success({ statusCode: response.status, data: await response.json() });
      } catch (error) { options.fail({ errMsg: error.message }); }
    }
  };
  store.clearAll(); store.saveSettings({ apiBase });
  t.after(async () => { global.wx = oldWx; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { codes, requests, memory, config, apiBase, advance: amount => { clock += amount; } };
}

test('real client pairs with protected server, sends short session, distinguishes health and auth', async t => {
  const env = await fixture(t);
  assert.equal(store.getSettings().useAI, true, 'cloud helper is on by default now');
  const initial = await service.getHealth();
  assert.equal(initial.ok, true); assert.equal(initial.auth.authenticated, false); assert.equal(initial.model.availability, 'disabled');
  store.saveSettings({ useAI: true });
  const denied = await service.parseProfile('两个人', store.getProfile());
  assert.match(denied.fallbackReason, /重新配对/);
  assert.equal(env.requests.at(-1).status, 401);
  const firstCode = env.codes[0].code;
  const settings = await service.pair(firstCode);
  assert.equal(settings.paired, true);
  assert.equal('token' in settings, false); assert.equal('session' in settings, false);
  assert.ok(!JSON.stringify(settings).includes(store.getSessionToken()));
  const health = await service.getHealth();
  assert.equal(health.auth.mode, 'paired-session'); assert.equal(health.auth.authenticated, true);
  const profile = await service.parseProfile('两个人', store.getProfile());
  assert.equal(profile.profile.partySize, 2);
  const request = env.requests.at(-1);
  assert.equal(request.status, 200); assert.match(request.headers.authorization, /^Bearer [a-f0-9]{64}$/);
  assert.notEqual(request.headers.authorization, 'Bearer ' + env.config.token);
  await assert.rejects(service.pair(firstCode), /已使用/);
  assert.equal(store.getSettings().paired, true, 'wrong pairing attempt must not invalidate an existing session');
});

test('expired session is refused and cleared; switching backend never reuses its session', async t => {
  const env = await fixture(t);
  await service.pair(env.codes[0].code); store.saveSettings({ useAI: true });
  env.advance(6000);
  const result = await service.parseProfile('两个人', store.getProfile());
  assert.match(result.fallbackReason, /已过期/); assert.equal(store.getSessionToken(), '');
  await service.pair(env.codes.at(-1).code);
  store.saveSettings({ apiBase: 'https://different.example' });
  assert.equal(store.getSessionToken(), ''); assert.equal(store.getSettings().paired, false);
});

test('configured model status changes only after an authenticated actual task, not health or pairing', async t => {
  let calls = 0;
  const env = await fixture(t, true, { config: { provider: 'openai-compatible' }, transport: async () => { calls++; return { changes: [{ field: 'partySize', value: 2, evidenceSpan: '两个人' }] }; } });
  assert.equal((await service.getHealth()).model.availability, 'not-checked');
  await service.pair(env.codes[0].code);
  assert.equal(calls, 0); assert.equal((await service.getHealth()).model.availability, 'not-checked');
  store.saveSettings({ useAI: true });
  assert.equal((await service.parseProfile('两个人', store.getProfile())).mode, 'openai-compatible');
  assert.equal(calls, 1); assert.equal((await service.getHealth()).model.availability, 'last-call-succeeded');
});

test('one-time code expires and repeated guesses are throttled before model calls', async t => {
  const env = await fixture(t);
  const code = env.codes[0].code;
  env.advance(300001);
  await assert.rejects(service.pair(code), /过期/);
  assert.equal(env.codes.length, 2);
  for (let i = 0; i < 4; i++) await assert.rejects(service.pair('00000000'), /无效/);
  await assert.rejects(service.pair(env.codes.at(-1).code), /尝试过多/);
  assert.equal(env.requests.at(-1).status, 429);
});

test('loopback development remains usable without pairing and cloud AI is on by default', async t => {
  const env = await fixture(t, false);
  const health = await service.getHealth();
  assert.equal(health.auth.required, false); assert.equal(health.auth.authenticated, true);
  const before = env.requests.length;
  await service.parseProfile('两个人', store.getProfile());
  assert.equal(env.requests.length, before + 1, 'default-on helper sends input without extra setup');
  store.saveSettings({ useAI: false });
  await service.parseProfile('两个人', store.getProfile());
  assert.equal(env.requests.at(-1).status, 200); assert.equal(env.codes.length, 0);
});

test('schema migration removes fictional business data and sessions, retains safe settings', async t => {
  const env = await fixture(t, false);
  env.memory.set(KEY, { version: 1, profile: clone(catalog.defaultProfile), route: { old: true }, favorites: ['summer-culture'], intents: [{ partySize: 99 }], activities: [{ title: 'old' }], events: [{ type: 'old' }], settings: { apiBase: env.apiBase, useAI: true, session: { token: 'a'.repeat(64), expiresAt: Date.now() + 100000 } } });
  assert.equal(store.getSettings().useAI, true, 'migrated state lands on the built-in default'); assert.equal(env.memory.get(KEY).version, 2);
  assert.equal(store.getRoute(), null); assert.deepEqual(store.getFavorites(), []); assert.deepEqual(store.getIntents(), []); assert.deepEqual(store.getEvents(), []);
  assert.equal(store.getSessionToken(), '');
  assert.throws(() => store.addIntent({ placeId: catalog.places[0].id, partySize: 1 }), /不提供体验预约/);
  if ('origin' in catalog.defaultProfile) assert.equal(store.getProfile().origin, null);
});

test('event schema retains exclusion, refusal and versions but drops free text, tokens and coordinates', async t => {
  await fixture(t, false);
  const details = { excludedIds: ['museum', 'museum', 'invalid id'], unanswerable: true, simulated: false, requestId: 'request-1', requestVersion: 'v2', modelVersion: 'deepseek-official', sourceVersion: '2026-09-22', question: 'private text', token: 'secret', latitude: 34.7 };
  store.logEvent('ask', details);
  assert.deepEqual(store.getEvents()[0].details, { excludedIds: ['museum'], unanswerable: true, simulated: false, requestId: 'request-1', requestVersion: 'v2', modelVersion: 'deepseek-official', sourceVersion: '2026-09-22' });
});

test('precise selected origin is omitted from profile request and preserved locally', async t => {
  const env = await fixture(t, false);
  if (!Object.prototype.hasOwnProperty.call(catalog.defaultProfile, 'origin')) { t.skip('origin schema is not yet available'); return; }
  store.saveSettings({ useAI: true });
  const origin = { name: '我的起点', address: '由用户选择', latitude: 34.759, longitude: 113.695, coordinateSystem: 'gcj02', source: 'user' };
  const base = { ...store.getProfile(), origin };
  const result = await service.parseProfile('两个人', base);
  const sent = env.requests.at(-1).input;
  assert.equal(sent.base.origin, null); assert.ok(!JSON.stringify(sent).includes('34.759'));
  assert.deepEqual(result.profile.origin, origin);
});

test('cloud toggle switches directly without a dialog and clear data restores the built-in default', async t => {
  await fixture(t, false);
  const oldPage = global.Page;
  let definition;
  global.Page = value => { definition = value; };
  const pagePath = require.resolve('../miniprogram/pages/mine/mine');
  delete require.cache[pagePath]; require(pagePath);
  t.after(() => { global.Page = oldPage; delete require.cache[pagePath]; });
  const page = { ...definition, data: clone(definition.data), setData(value) { Object.assign(this.data, value); } };
  let dialogs = 0;
  global.wx.showModal = () => { dialogs += 1; };
  page.toggleAI({ detail: { value: true } });
  assert.equal(store.getSettings().useAI, true); assert.equal(dialogs, 0, 'no confirmation friction');
  page.toggleAI({ detail: { value: false } });
  assert.equal(store.getSettings().useAI, false);
  store.clearAll(); assert.equal(store.getSettings().useAI, true, 'clear data restores the built-in default');
});

test('plain HTTP is confined to canonical loopback or RFC1918 development addresses', async t => {
  await fixture(t, false);
  for (const apiBase of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787', 'http://10.1.2.3', 'http://172.16.0.1:8787', 'http://172.31.255.254', 'http://192.168.1.50/api', 'https://public.example/api']) {
    assert.doesNotThrow(() => store.saveSettings({ apiBase }), apiBase);
    assert.equal(store.getSettings().apiBase, apiBase);
  }
  for (const apiBase of ['http://public.example', 'http://8.8.8.8', 'http://172.15.0.1', 'http://172.32.0.1', 'http://169.254.1.2', 'http://localhost.example', 'http://2130706433', 'http://010.0.0.1', 'http://0172.16.0.1', 'http://192.168.1.999', 'http://10.0.0.1:65536', 'https://user:password@example.com']) assert.throws(() => store.saveSettings({ apiBase }), /HTTPS/);
});

test('a late request 401 cannot clear a newer session on a different backend or the same backend', async t => {
  await fixture(t, false);
  store.saveSettings({ apiBase: 'https://backend-a.example', useAI: true });
  store.saveSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://backend-a.example');
  let pending;
  global.wx.request = options => { pending = options; };
  const oldCall = service.parseProfile('两个人', store.getProfile());
  store.saveSettings({ apiBase: 'https://backend-b.example' });
  store.saveSession({ token: 'b'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://backend-b.example');
  pending.success({ statusCode: 401, data: { code: 'unauthorized' } });
  await oldCall;
  assert.equal(store.getSessionToken(), 'b'.repeat(64));
  const anotherOldCall = service.parseProfile('两个人', store.getProfile());
  store.saveSession({ token: 'c'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://backend-b.example');
  pending.success({ statusCode: 401, data: { code: 'unauthorized' } });
  await anotherOldCall;
  assert.equal(store.getSessionToken(), 'c'.repeat(64));
});

test('late unauthenticated health from an old backend never removes a new pairing', async t => {
  await fixture(t, false);
  store.saveSettings({ apiBase: 'https://backend-a.example' });
  store.saveSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://backend-a.example');
  let pending;
  global.wx.request = options => { pending = options; };
  const oldHealth = service.getHealth();
  store.saveSettings({ apiBase: 'https://backend-b.example' });
  store.saveSession({ token: 'b'.repeat(64), expiresAt: Date.now() + 60000 }, 'https://backend-b.example');
  pending.success({ statusCode: 200, data: { ok: true, auth: { required: true, authenticated: false }, model: { configured: true } } });
  await oldHealth;
  assert.equal(store.getSessionToken(), 'b'.repeat(64));
});
