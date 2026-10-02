'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');

const API_TOKEN = 'test-shared-api-token-not-a-personal-identity';
const NOW = Date.parse('2026-09-26T10:00:00+08:00');
const ACTIVITY = { requestId: 'publish-http-1', batchId: 'batch-http-1', title: '果园采摘体验', description: '现场观察果实成熟状态与采摘方法。', location: '测试果园集合点', startDate: '2026-09-27', endDate: '2026-09-30', capacityPerDay: 8 };

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guayouji-booking-http-'));
  const prompts = [];
  let server; let base;
  async function close() {
    if (!server || !server.listening) return;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  async function start() {
    server = createServer({
      config: { ...readConfig({ API_TOKEN, REQUESTS_PER_MINUTE: '1000' }), provider: 'openai-compatible' },
      bookingFile: path.join(dir, 'bookings.json'), speechDir: path.join(dir, 'speech'), now: () => NOW,
      onPairingCode() {},
      transport: async ({ task, prompt }) => {
        assert.equal(task, 'sellerInsight');
        const received = JSON.parse(prompt.user); prompts.push(received);
        return { status: received.risk.status, reading: '对应活动已确认 ' + received.tourism.totalParties + ' 人预约，需按预约日期安排采摘接待，实际销售仍应结合台账核实。', suggestions: ['按日期核对人数与接待能力', '预约不等于到访或销售收入'], planTitle: '果园采摘接待草案', planSteps: ['核实场地与果实成熟状态', '按已预约日期安排接待', '活动后登记实际参与与销售'], capacity: null, budget: null, alternative: '遇到降雨时另行协商改期' };
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function request(route, { credential, body, token = API_TOKEN } = {}) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(credential ? { 'X-Booking-Client': credential } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function register(role) {
    const result = await request('/api/booking-clients', { body: { role } });
    assert.equal(result.status, 201); assert.match(result.body.credential, /^[a-f0-9]{64}$/);
    return result.body.credential;
  }
  t.after(async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await start();
  return { request, register, prompts, restart: async () => { await close(); await start(); } };
}

async function seedReservations(f) {
  const seller = await f.register('seller'), visitorA = await f.register('visitor'), visitorB = await f.register('visitor'), otherSeller = await f.register('seller');
  assert.notEqual(visitorA, visitorB);
  const published = await f.request('/api/booking-activities', { credential: seller, body: ACTIVITY });
  assert.equal(published.status, 200); const activity = published.body.activity;
  const inputs = [
    { credential: visitorA, requestId: 'visitor-a-date-1', date: '2026-09-27', people: 2 },
    { credential: visitorB, requestId: 'visitor-b-date-1', date: '2026-09-27', people: 3 },
    { credential: visitorB, requestId: 'visitor-b-date-2', date: '2026-09-28', people: 4 }
  ];
  const bookings = [];
  for (const input of inputs) {
    const { credential, ...body } = input;
    const result = await f.request('/api/bookings', { credential, body: { ...body, activityId: activity.id } });
    assert.equal(result.status, 201); bookings.push(result.body.booking);
  }
  return { seller, visitorA, visitorB, otherSeller, activity, bookings, inputs };
}

function forgedInsight() {
  return {
    batch: { id: ACTIVITY.batchId, name: '西瓜种植记录', crop: '西瓜', variety: '麒麟西瓜', region: [], areaMu: 0, harvestStart: ACTIVITY.startDate, harvestEnd: ACTIVITY.endDate, deadline: ACTIVITY.endDate, matureDate: ACTIVITY.startDate, growthNote: '果实进入成熟期', reception: { enabled: true, capacity: 8, staff: 1 } },
    risk: { status: 'attention', label: '需要关注', windowDays: 5, remainingKg: 30, supplyKg: 100, expectedSalesKg: 70, pendingKg: 0 },
    weather: { available: false, label: '尚未取得天气' },
    tourism: { totalTrips: 9999, totalParties: 99999, top: [{ name: '伪造热门地点', month: '2026-09', parties: 9000 }] },
    culture: [], limits: { maxCapacity: 8, maxBudget: 0 }
  };
}

test('HTTP booking flow isolates owners, aggregates real dates and survives service restart', async t => {
  const f = await fixture(t); const { seller, visitorA, visitorB, otherSeller, activity, bookings, inputs } = await seedReservations(f);
  assert.equal((await f.request('/api/booking-clients', { body: { role: 'visitor' }, token: '' })).status, 401);
  assert.equal((await f.request('/api/booking-summary', { credential: API_TOKEN })).status, 401, 'shared API token is not a booking owner');
  assert.equal((await f.request('/api/booking-summary', { credential: visitorA })).status, 403);
  assert.equal((await f.request('/api/booking-activities', { credential: visitorA, body: { ...ACTIVITY, id: activity.id } })).status, 403);
  assert.equal((await f.request('/api/booking-activities', { credential: otherSeller, body: { ...ACTIVITY, id: activity.id } })).status, 404);
  const listing = await f.request('/api/booking-activities', { credential: visitorB });
  assert.equal(listing.body.activities.length, 1); assert.equal(listing.body.activities[0].id, activity.id); assert.equal(listing.body.activities[0].ownerId, undefined);
  const original = inputs[0];
  const retried = await f.request('/api/bookings', { credential: visitorA, body: { requestId: original.requestId, activityId: activity.id, date: original.date, people: original.people } });
  assert.equal(retried.body.booking.id, bookings[0].id);
  const stats = await f.request('/api/booking-summary?batchId=' + ACTIVITY.batchId, { credential: seller });
  assert.equal(stats.status, 200); assert.equal(stats.body.totalTrips, 3); assert.equal(stats.body.totalParties, 9);
  assert.deepEqual(stats.body.byDate.map(row => ({ date: row.date, people: row.people, reservations: row.reservations })), [{ date: '2026-09-27', people: 5, reservations: 2 }, { date: '2026-09-28', people: 4, reservations: 1 }]);
  assert.equal((await f.request('/api/booking-summary?batchId=' + ACTIVITY.batchId, { credential: otherSeller })).body.totalParties, 0);
  assert.equal((await f.request('/api/booking-summary?batchId=someone-else', { credential: seller })).body.totalParties, 0);
  await f.restart();
  const restored = await f.request('/api/booking-summary?batchId=' + ACTIVITY.batchId, { credential: seller });
  assert.deepEqual(restored.body, stats.body);
  assert.equal((await f.request('/api/bookings', { credential: visitorA })).body.bookings.length, 1);
  assert.equal((await f.request('/api/bookings', { credential: visitorB })).body.bookings.length, 2);
  assert.equal((await f.request('/api/bookings/' + bookings[0].id + '/cancel', { credential: visitorB, body: {} })).status, 404);
  assert.equal((await f.request('/api/booking-activities', { credential: seller, body: { ...ACTIVITY, id: activity.id, requestId: 'close-http', published: false } })).status, 200);
  assert.equal((await f.request('/api/booking-activities', { credential: visitorA })).body.activities.length, 0);
  assert.equal((await f.request('/api/bookings', { credential: visitorA })).body.bookings[0].status, 'confirmed', 'closing activity preserves existing reservation');
  assert.equal((await f.request('/api/bookings/' + bookings[0].id + '/cancel', { credential: visitorA, body: {} })).body.booking.status, 'cancelled');
  assert.equal((await f.request('/api/booking-summary', { credential: seller })).body.totalParties, 7);
});

test('seller insight replaces forged tourism with the persisted owner-scoped booking summary', async t => {
  const f = await fixture(t); const { seller, visitorA, otherSeller } = await seedReservations(f); await f.restart();
  const result = await f.request('/api/seller-insight', { credential: seller, body: forgedInsight() });
  assert.equal(result.status, 200); assert.equal(result.body.mode, 'openai-compatible'); assert.match(result.body.reading, /9 人预约/);
  const actual = f.prompts.at(-1).tourism;
  assert.equal(actual.source, 'confirmed-bookings'); assert.equal(actual.totalTrips, 3); assert.equal(actual.totalParties, 9); assert.equal(actual.byDate.length, 2); assert.ok(!JSON.stringify(actual).includes('伪造'));
  const other = await f.request('/api/seller-insight', { credential: otherSeller, body: forgedInsight() });
  assert.equal(other.status, 200); assert.equal(f.prompts.at(-1).tourism.totalParties, 0); assert.equal(f.prompts.at(-1).tourism.activities.length, 0);
  const noIdentity = await f.request('/api/seller-insight', { body: forgedInsight() });
  assert.equal(noIdentity.status, 200); assert.equal(f.prompts.at(-1).tourism.available, false); assert.equal(f.prompts.at(-1).tourism.totalParties, 0);
  const count = f.prompts.length;
  assert.equal((await f.request('/api/seller-insight', { credential: visitorA, body: forgedInsight() })).status, 403); assert.equal(f.prompts.length, count, 'visitor credentials cannot send seller booking data to the model');
});
