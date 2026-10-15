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
const ACTIVITY = { requestId: 'publish-availability-1', batchId: 'batch-availability-1', title: '果园采摘体验', description: '现场观察果实成熟状态与采摘方法。', location: '测试果园集合点', startDate: '2026-09-27', endDate: '2026-09-30', capacityPerDay: 8 };
// 逐日余量只回聚合数：每天恰好这 6 个字段，不含姓名 / 联系方式 / 提交编号。
const ROW_KEYS = ['capacityPerDay', 'date', 'full', 'past', 'remaining', 'used'];

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guayouji-booking-availability-'));
  const file = path.join(dir, 'bookings.json');
  let nowValue = NOW;
  let server; let base;
  async function close() {
    if (!server || !server.listening) return;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  async function start() {
    server = createServer({
      config: { ...readConfig({ API_TOKEN, REQUESTS_PER_MINUTE: '1000' }), provider: 'disabled' },
      bookingFile: file, speechDir: path.join(dir, 'speech'), now: () => nowValue, onPairingCode() {},
      transport: async () => { throw new Error('本文件不调用模型'); }
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
  async function publish(credential, overrides = {}) {
    const result = await request('/api/booking-activities', { credential, body: { ...ACTIVITY, ...overrides } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.activity;
  }
  async function reserve(credential, activity, body) {
    return request('/api/bookings', { credential, body: { activityId: activity.id, ...body } });
  }
  const availability = (credential, activityId) => request('/api/booking-availability?activityId=' + encodeURIComponent(activityId), { credential });
  t.after(async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await start();
  return { request, register, publish, reserve, availability, file, restart: async nextNow => { if (nextNow) nowValue = nextNow; await close(); await start(); } };
}

test('availability reports remaining slots for every day of a published activity', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller');
  const visitorA = await f.register('visitor'); const visitorB = await f.register('visitor');
  const activity = await f.publish(seller);
  assert.equal((await f.reserve(visitorA, activity, { requestId: 'visitor-a-date-1', date: '2026-09-27', people: 2 })).status, 201);
  assert.equal((await f.reserve(visitorB, activity, { requestId: 'visitor-b-date-1', date: '2026-09-27', people: 3 })).status, 201);
  const second = await f.reserve(visitorB, activity, { requestId: 'visitor-b-date-2', date: '2026-09-28', people: 4 });
  assert.equal(second.status, 201);

  const result = await f.availability(visitorA, activity.id);
  assert.equal(result.status, 200);
  assert.equal(result.body.available, true);
  assert.equal(result.body.source, 'confirmed-bookings');
  assert.equal(result.body.activityId, activity.id);
  assert.equal(result.body.capacityPerDay, 8);
  assert.deepEqual(result.body.days, [
    { date: '2026-09-27', capacityPerDay: 8, used: 5, remaining: 3, full: false, past: false },
    { date: '2026-09-28', capacityPerDay: 8, used: 4, remaining: 4, full: false, past: false },
    { date: '2026-09-29', capacityPerDay: 8, used: 0, remaining: 8, full: false, past: false },
    { date: '2026-09-30', capacityPerDay: 8, used: 0, remaining: 8, full: false, past: false }
  ]);
  assert.ok(result.body.days.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(ROW_KEYS)), '每天只有聚合字段');
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes(visitorA) && !serialized.includes(visitorB), '不泄漏其他游客凭据');
  assert.ok(!/ownerId|requestId|hash|createdAt/.test(serialized), '不泄漏所有者与内部编号');

  assert.equal((await f.request('/api/bookings/' + second.body.booking.id + '/cancel', { credential: visitorB, body: {} })).status, 200);
  const afterCancel = await f.availability(visitorB, activity.id);
  assert.deepEqual(afterCancel.body.days.map(row => ({ date: row.date, used: row.used, remaining: row.remaining })), [
    { date: '2026-09-27', used: 5, remaining: 3 },
    { date: '2026-09-28', used: 0, remaining: 8 },
    { date: '2026-09-29', used: 0, remaining: 8 },
    { date: '2026-09-30', used: 0, remaining: 8 }
  ], '取消后的名额立即释放，只统计 confirmed');
});

test('a day booked to exactly capacity is reported full with zero remaining', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller'); const visitor = await f.register('visitor');
  const activity = await f.publish(seller);
  assert.equal((await f.reserve(visitor, activity, { requestId: 'fill-exactly', date: '2026-09-28', people: 8 })).status, 201);
  const result = await f.availability(visitor, activity.id);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.days.map(row => ({ date: row.date, used: row.used, remaining: row.remaining, full: row.full })), [
    { date: '2026-09-27', used: 0, remaining: 8, full: false },
    { date: '2026-09-28', used: 8, remaining: 0, full: true },
    { date: '2026-09-29', used: 0, remaining: 8, full: false },
    { date: '2026-09-30', used: 0, remaining: 8, full: false }
  ]);
});

test('a full day matches the booking guard and never reports negative remaining', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller'); const visitorA = await f.register('visitor'); const visitorB = await f.register('visitor');
  const activity = await f.publish(seller);
  assert.equal((await f.reserve(visitorA, activity, { requestId: 'visitor-a-full', date: '2026-09-27', people: 8 })).status, 201);
  const rejected = await f.reserve(visitorB, activity, { requestId: 'visitor-b-after-full', date: '2026-09-27', people: 1 });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.code, 'booking_full');
  assert.deepEqual((await f.availability(visitorB, activity.id)).body.days[0], { date: '2026-09-27', capacityPerDay: 8, used: 8, remaining: 0, full: true, past: false });
  // 台账被外部改大（例如人工补录）时仍按同一口径求和，余量夹到 0 不变负。
  const saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  saved.bookings.find(item => item.date === '2026-09-27').people = 12;
  fs.writeFileSync(f.file, JSON.stringify(saved));
  await f.restart();
  const inflated = await f.availability(visitorA, activity.id);
  assert.deepEqual(inflated.body.days[0], { date: '2026-09-27', capacityPerDay: 8, used: 12, remaining: 0, full: true, past: false });
});

test('dates before today are flagged past, consistent with the booking date window', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller'); const visitor = await f.register('visitor');
  const activity = await f.publish(seller, { requestId: 'publish-past-window', startDate: '2026-09-20', endDate: '2026-09-28' });
  const result = await f.availability(visitor, activity.id);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.days.map(row => row.date), ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
  assert.deepEqual(result.body.days.map(row => row.past), [true, true, true, true, true, true, false, false, false]);
  const past = await f.reserve(visitor, activity, { requestId: 'past-date', date: '2026-09-25', people: 1 });
  assert.equal(past.status, 400); assert.match(past.body.error, /尚未过去/);
  const ended = await f.request('/api/booking-activities', { credential: seller, body: { ...ACTIVITY, requestId: 'publish-ended', startDate: '2026-09-01', endDate: '2026-09-20' } });
  assert.equal(ended.status, 400, '整段已过去的活动无法发布');
  // 活动结束后仍是已发布状态：全部日期标 past，前端据此整体置灰。
  await f.restart(Date.parse('2026-10-10T10:00:00+08:00'));
  const closed = await f.availability(visitor, activity.id);
  assert.equal(closed.status, 200);
  assert.ok(closed.body.days.every(row => row.past), '结束后的活动整天都不可点');
});

test('unpublished or unknown activities are hidden from visitors', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller'); const visitor = await f.register('visitor');
  const draft = await f.publish(seller, { requestId: 'publish-draft', published: false });
  const hidden = await f.availability(visitor, draft.id);
  assert.equal(hidden.status, 404); assert.equal(hidden.body.code, 'not_found');
  const unknown = await f.availability(visitor, '00000000-0000-4000-8000-000000000000');
  assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'not_found');
  const missing = await f.availability(visitor, '');
  assert.equal(missing.status, 400); assert.equal(missing.body.code, 'invalid_booking');
  assert.equal((await f.reserve(visitor, draft, { requestId: 'draft-date', date: '2026-09-27', people: 1 })).status, 404, '下架活动同样不可预约');
});

test('availability requires a visitor credential and stays read-only', async t => {
  const f = await fixture(t);
  const seller = await f.register('seller'); const visitor = await f.register('visitor');
  const activity = await f.publish(seller);
  assert.equal((await f.availability(undefined, activity.id)).status, 401, '缺少 X-Booking-Client');
  assert.equal((await f.availability(API_TOKEN, activity.id)).status, 401, '共享 API_TOKEN 不是预约身份');
  const sellerView = await f.availability(seller, activity.id);
  assert.equal(sellerView.status, 403); assert.equal(sellerView.body.code, 'booking_forbidden');
  assert.equal((await f.request('/api/booking-availability?activityId=' + activity.id, { credential: visitor, token: '' })).status, 401, '未配对的开发会话');
  assert.equal((await f.request('/api/booking-availability?activityId=' + activity.id, { credential: visitor, body: {} })).status, 404, '只读接口不接受 POST');
});
