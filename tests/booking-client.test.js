'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const booking = require('../miniprogram/lib/booking-service');
const previousWx = global.wx;
let memory; let requests;
test.beforeEach(() => { memory = new Map(); requests = []; global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, structuredClone(value)), removeStorageSync: key => memory.delete(key), request: options => requests.push(options) }; store.exitDemo(); store.clearAll(); });
test.after(() => { global.wx = previousWx; });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('simultaneous booking identity requests share one registration and remain separate by role', async () => {
  const one = booking.ensureClient('visitor'); const two = booking.ensureClient('visitor'); assert.equal(requests.length, 1);
  requests[0].success({ statusCode: 201, data: { role: 'visitor', credential: 'a'.repeat(64) } });
  assert.deepEqual(await Promise.all([one, two]), ['a'.repeat(64), 'a'.repeat(64)]);
  const seller = booking.ensureClient('seller'); assert.equal(requests.length, 2); requests[1].success({ statusCode: 201, data: { role: 'seller', credential: 'b'.repeat(64) } }); await seller;
  assert.equal(booking.getCredential('visitor'), 'a'.repeat(64)); assert.equal(booking.getCredential('seller'), 'b'.repeat(64));
  const pending = booking.listBookings(); await tick(); assert.equal(requests[2].header['X-Booking-Client'], 'a'.repeat(64)); requests[2].success({ statusCode: 200, data: { bookings: [] } }); await pending;
});
test('late identity response cannot save credentials into another account or another API base', async () => {
  const pending = booking.ensureClient('visitor'); const rejection = assert.rejects(pending, /账户或服务器/);
  store.enterDemo(); requests[0].success({ statusCode: 201, data: { credential: 'a'.repeat(64) } }); await rejection; assert.equal(booking.getCredential('visitor'), '');
  store.exitDemo(); assert.equal(booking.getCredential('visitor'), '');
});
test('demo creative identity is allowed explicitly but real publication and bookings are blocked', async () => {
  store.enterDemo(); await assert.rejects(booking.ensureClient('visitor'), /演示/); assert.equal(requests.length, 0);
  const creative = booking.ensureClient('visitor', { allowDemoIdentity: true }); requests[0].success({ statusCode: 201, data: { role: 'visitor', credential: 'c'.repeat(64) } }); await creative;
  await assert.rejects(booking.reserve({}), /演示/); await assert.rejects(booking.listActivities(), /演示/); await assert.rejects(booking.publish({}), /演示/); assert.equal(requests.length, 1);
  store.exitDemo(); assert.equal(booking.getCredential('visitor'), '');
});

test('demo creative registration binds the personal custom endpoint and its token', async () => {
  const apiBase = 'https://custom-booking.example/api';
  store.saveSettings({ apiBase, useAI: true }); store.saveSession({ token: 'd'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase); store.enterDemo();
  assert.notEqual(store.getSettings().apiBase, apiBase);
  const pending = booking.ensureClient('visitor', { allowDemoIdentity: true });
  assert.equal(requests[0].url, apiBase + '/api/booking-clients'); assert.equal(requests[0].header.authorization, 'Bearer ' + 'd'.repeat(64));
  requests[0].success({ statusCode: 201, data: { credential: 'e'.repeat(64) } }); await pending;
  assert.equal(booking.getCredential('visitor'), 'e'.repeat(64));
  assert.ok(memory.has('guayouji.booking-client.v1:demo:' + apiBase + ':visitor'));
});
test('same-host token rotation rejects old registration and does not share its pending promise', async () => {
  const apiBase = 'https://token-rotation.example';
  store.saveSettings({ apiBase }); store.saveSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  const old = booking.ensureClient('visitor'); const rejected = assert.rejects(old, /账户或服务器/);
  store.saveSession({ token: 'b'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  const fresh = booking.ensureClient('visitor'); assert.equal(requests.length, 2); assert.equal(requests[1].header.authorization, 'Bearer ' + 'b'.repeat(64));
  requests[0].success({ statusCode: 201, data: { credential: 'c'.repeat(64) } }); await rejected;
  assert.equal(booking.getCredential('visitor'), '');
  requests[1].success({ statusCode: 201, data: { credential: 'd'.repeat(64) } }); await fresh; assert.equal(booking.getCredential('visitor'), 'd'.repeat(64));
  const list = booking.listBookings(); await tick(); const listRejected = assert.rejects(list, /账户或服务器/);
  store.saveSession({ token: 'e'.repeat(64), expiresAt: Date.now() + 60000 }, apiBase);
  requests[2].success({ statusCode: 200, data: { bookings: [{ id: 'old-context' }] } }); await listRejected;
});
