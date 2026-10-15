'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBookingService } = require('../server/bookings');
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'guayouji-booking-test-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'bookings.json'); const options = { file, now: () => Date.parse('2026-09-26T00:00:00+08:00') };
  const service = createBookingService(options);
  const call = (method, route, credential, body, query) => service.dispatch({ method, path: route, credential, body, query }).body;
  const register = role => call('POST', '/api/booking-clients', '', { role }).credential;
  const seller = register('seller'); const visitor = register('visitor');
  const activity = { requestId: 'publish-a', batchId: 'batch-a', title: '园中采摘', description: '真实果园活动', location: '园区门口集合', startDate: '2026-09-26', endDate: '2026-10-02', capacityPerDay: 5 };
  return { file, options, service, call, register, seller, visitor, activity };
}
test('random capabilities isolate roles and records, independent of the shared API credential', t => {
  const f = fixture(t); const other = f.register('seller'); assert.notEqual(f.seller, other); assert.match(f.seller, /^[a-f0-9]{64}$/);
  const { activity } = f.call('POST', '/api/booking-activities', f.seller, f.activity);
  assert.throws(() => f.call('POST', '/api/booking-activities', f.visitor, f.activity), /无权/);
  assert.throws(() => f.call('POST', '/api/booking-activities', other, { ...f.activity, id: activity.id, requestId: 'overwrite' }), /不存在/);
  assert.throws(() => f.call('GET', '/api/booking-summary', 'shared-api-token'), /身份/);
  assert.equal(f.call('GET', '/api/booking-summary', other).activities.length, 0);
  assert.equal(f.call('GET', '/api/booking-activities', f.visitor).activities[0].ownerId, undefined);
  const disk = fs.readFileSync(f.file, 'utf8'); assert.ok(!disk.includes(f.seller)); assert.ok(!disk.includes(f.visitor));
});
test('cross-device reservations aggregate only corresponding seller, batch and activity date', t => {
  const f = fixture(t); const visitor2 = f.register('visitor'); const { activity } = f.call('POST', '/api/booking-activities', f.seller, f.activity);
  const reserve = (credential, requestId, date, people) => f.call('POST', '/api/bookings', credential, { requestId, activityId: activity.id, date, people });
  reserve(f.visitor, 'one', '2026-09-27', 2); reserve(visitor2, 'two', '2026-09-27', 3); reserve(visitor2, 'three', '2026-09-28', 4);
  const stats = f.call('GET', '/api/booking-summary', f.seller, null, { batchId: 'batch-a' });
  assert.equal(stats.totalTrips, 3); assert.equal(stats.totalParties, 9); assert.equal(stats.byDate.length, 2); assert.equal(stats.byDate[0].people, 5); assert.equal(stats.byDate[1].people, 4);
  assert.equal(f.call('GET', '/api/booking-summary', f.seller, null, { batchId: 'wrong-batch' }).totalParties, 0);
  assert.equal(f.call('GET', '/api/bookings', f.visitor).bookings.length, 1);
});
test('booking retries are idempotent, conflicts rejected and cancellation restores exact capacity', t => {
  const f = fixture(t); const { activity } = f.call('POST', '/api/booking-activities', f.seller, f.activity); const other = f.register('visitor');
  const payload = { activityId: activity.id, requestId: 'same', date: '2026-09-27', people: 5 };
  const first = f.call('POST', '/api/bookings', f.visitor, payload).booking; const retry = f.call('POST', '/api/bookings', f.visitor, payload).booking; assert.equal(first.id, retry.id);
  assert.throws(() => f.call('POST', '/api/bookings', f.visitor, { ...payload, people: 4 }), /同一提交编号/);
  assert.throws(() => f.call('POST', '/api/bookings', f.visitor, { ...payload, requestId: 'duplicate' }), /当天已有/);
  assert.throws(() => f.call('POST', '/api/bookings', other, { ...payload, people: 1 }), /名额不足/);
  assert.throws(() => f.call('POST', '/api/bookings/' + first.id + '/cancel', other, {}), /不存在/);
  f.call('POST', '/api/bookings/' + first.id + '/cancel', f.visitor, {}); f.call('POST', '/api/bookings/' + first.id + '/cancel', f.visitor, {});
  assert.equal(f.call('GET', '/api/booking-summary', f.seller).totalParties, 0);
  assert.equal(f.call('POST', '/api/bookings', f.visitor, payload).booking.status, 'cancelled');
  assert.equal(f.call('POST', '/api/bookings', other, { ...payload, people: 5 }).booking.status, 'confirmed');
});
test('activities persist through restart including ownership, retries and closed activity reservations', t => {
  const f = fixture(t); const { activity } = f.call('POST', '/api/booking-activities', f.seller, f.activity);
  const { booking } = f.call('POST', '/api/bookings', f.visitor, { activityId: activity.id, requestId: 'reserve', date: '2026-09-27', people: 2 });
  f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, id: activity.id, requestId: 'close', published: false });
  const restarted = createBookingService(f.options);
  assert.equal(restarted.summary(f.seller).totalParties, 2);
  assert.equal(restarted.dispatch({ method: 'GET', path: '/api/booking-activities', credential: f.visitor }).body.activities.length, 0);
  assert.equal(restarted.dispatch({ method: 'POST', path: '/api/booking-activities', credential: f.seller, body: f.activity }).body.activity.id, activity.id);
  assert.equal(restarted.summary(f.seller).activities.length, 1);
  assert.equal(restarted.dispatch({ method: 'POST', path: '/api/bookings/' + booking.id + '/cancel', credential: f.visitor, body: {} }).body.booking.status, 'cancelled');
});
test('calendar, integer capacity, publishing edits and booking dates are checked server-side', t => {
  const f = fixture(t);
  for (const patch of [{ startDate: '2026-02-30' }, { capacityPerDay: 0 }, { capacityPerDay: 2.5 }, { endDate: '2026-09-20' }]) assert.throws(() => f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, ...patch }));
  const { activity } = f.call('POST', '/api/booking-activities', f.seller, f.activity);
  const base = { requestId: 'invalid', activityId: activity.id, date: '2026-09-27', people: 2 };
  for (const patch of [{ date: '2026-09-25' }, { date: '2026-10-03' }, { people: 0 }, { people: 2.5 }, { people: 21 }]) assert.throws(() => f.call('POST', '/api/bookings', f.visitor, { ...base, ...patch }));
  f.call('POST', '/api/bookings', f.visitor, base);
  assert.throws(() => f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, id: activity.id, requestId: 'reduce', capacityPerDay: 1 }), /容量/);
  assert.throws(() => f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, id: activity.id, requestId: 'exclude', startDate: '2026-09-28' }), /日期区间/);
});
test('write failure does not mutate the live booking ledger', t => {
  const f = fixture(t); const folder = path.dirname(f.file); fs.renameSync(folder, folder + '-moved'); fs.writeFileSync(folder, 'blocked directory');
  t.after(() => { fs.rmSync(folder, { force: true }); fs.renameSync(folder + '-moved', folder); });
  assert.throws(() => f.call('POST', '/api/booking-activities', f.seller, f.activity));
  assert.equal(f.service.summary(f.seller).activities.length, 0);
});

// 2026-10-18：活动契约新增可选字段 townId（这场活动办的是哪一家果乡）。
// 此前客户端（pages/route/route.js 的 activityForTown）只能拿名片名称 / 地址去和活动名称 / 集合地点猜，
// 改个名字就断。这里钉住三件事：创建时写入、读回时带上、老活动（压根没这个键）照旧可用。
test('activity townId: written on publish, echoed on list / summary, and legacy activities without it still work', t => {
  const f = fixture(t);
  const { activity } = f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, townId: 'townluochuan' });
  assert.equal(activity.townId, 'townluochuan', '创建时写入');
  assert.equal(f.call('GET', '/api/booking-activities', f.visitor).activities[0].townId, 'townluochuan', '游客侧列表读得回');
  assert.equal(f.call('GET', '/api/booking-summary', f.seller).activities[0].townId, 'townluochuan', '果农侧 summary 也读得回');

  // 不带 townId（老客户端）：照旧 200，存成空串，不报错
  const plain = f.call('POST', '/api/booking-activities', f.seller, { ...f.activity, requestId: 'publish-no-town', title: '另一场活动' }).activity;
  assert.equal(plain.townId, '');
  assert.equal(f.call('GET', '/api/booking-activities', f.visitor).activities.length, 2, '两场活动都在');

  // 老活动记录（磁盘上就是没有这个键）：重启后读回也不凭空多出来，客户端照旧走回退猜测
  const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  disk.activities = disk.activities.map(row => { const copy = { ...row }; delete copy.townId; return copy; });
  fs.writeFileSync(f.file, JSON.stringify(disk));
  const restarted = createBookingService(f.options);
  const listed = restarted.dispatch({ method: 'GET', path: '/api/booking-activities', credential: f.visitor }).body.activities;
  assert.equal(listed.length, 2);
  assert.ok(listed.every(row => !('townId' in row)), '老活动读回不凭空补出 townId 键');
  assert.equal(listed[0].title, '园中采摘', '其余字段与改造前逐字一致');
});
