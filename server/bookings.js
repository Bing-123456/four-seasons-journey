'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { InputError } = require('./validation');
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(String(value)).digest('hex');
function fail(message, code = 'invalid_booking', status = 400) { throw new InputError(message, code, status); }
function text(value, label, max, optional) { if (typeof value !== 'string' || !value.trim() || value.length > max) { if (optional && (value == null || value === '')) return ''; fail(label + '未填写或过长'); } return value.trim(); }
function day(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期格式不正确'); const date = new Date(value + 'T00:00:00Z'); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('日期无效'); return value; }
function integer(value, label, max) { if (!Number.isInteger(value) || value < 1 || value > max) fail(label + '需要填写 1–' + max + ' 的整数'); return value; }
function createBookingService(options = {}) {
  const file = options.file || process.env.BOOKING_DATA_FILE || path.join(require('node:os').tmpdir(), 'guayouji-bookings.json');
  const now = options.now || (() => Date.now());
  const today = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
  let state = { version: 1, clients: [], activities: [], bookings: [], activityRequests: [] };
  if (fs.existsSync(file)) { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved.version !== 1 || !['clients', 'activities', 'bookings'].every(key => Array.isArray(saved[key]))) throw new Error('预约数据文件格式不正确'); state = { activityRequests: [], ...saved }; }
  function commit(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); state = next; } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} throw error; }
  }
  function client(credential, role) { const hash = digest(credential || ''); const found = state.clients.find(item => item.hash === hash); if (!found) fail('预约身份已失效，请重新打开页面', 'booking_unauthorized', 401); if (role && found.role !== role) fail('此身份无权执行该操作', 'booking_forbidden', 403); return found; }
  function publicActivity(activity) { const { ownerId, requestId, ...visible } = activity; return visible; }
  function register(body) { if (!body || !['visitor', 'seller'].includes(body.role)) fail('请选择游客或果农身份'); if (state.clients.length >= 100000) fail('预约身份服务已达容量', 'booking_capacity', 503); const credential = randomBytes(32).toString('hex'); const record = { id: randomUUID(), hash: digest(credential), role: body.role, createdAt: new Date(now()).toISOString() }; const next = copy(state); next.clients.push(record); commit(next); return { credential, role: body.role }; }
  function publish(owner, body) {
    if (!body || typeof body !== 'object') fail('活动内容不完整');
    const requestId = text(body.requestId, '提交编号', 100);
    const input = { batchId: text(body.batchId, '种植记录编号', 100), title: text(body.title, '活动名称', 60), description: text(body.description, '活动介绍', 300), location: text(body.location, '集合地点', 160), startDate: day(body.startDate), endDate: day(body.endDate), capacityPerDay: integer(body.capacityPerDay, '每日接待人数', 1000), published: body.published !== false };
    if (input.startDate > input.endDate || input.published && input.endDate < today() || Date.parse(input.endDate) - Date.parse(input.startDate) > 366 * 86400000) fail('活动需在有效的未来一年区间内');
    const fingerprint = digest(JSON.stringify({ ...input, id: body.id || '' }));
    const existingRequest = state.activityRequests.find(item => item.ownerId === owner.id && item.requestId === requestId);
    if (existingRequest) { if (existingRequest.fingerprint !== fingerprint) fail('同一提交编号不能用于不同活动', 'booking_conflict', 409); return publicActivity(state.activities.find(item => item.id === existingRequest.activityId)); }
    const existing = body.id ? state.activities.find(item => item.id === body.id && item.ownerId === owner.id) : null;
    if (body.id && !existing) fail('活动不存在', 'not_found', 404);
    if (!existing && state.activities.filter(item => item.ownerId === owner.id).length >= 100) fail('最多保存 100 个活动');
    if (existing) {
      const sums = {};
      state.bookings.filter(item => item.activityId === existing.id && item.status === 'confirmed').forEach(item => { sums[item.date] = (sums[item.date] || 0) + item.people; if (item.date < input.startDate || item.date > input.endDate) fail('新日期区间不能排除已有预约', 'booking_conflict', 409); });
      if (Object.values(sums).some(count => count > input.capacityPerDay)) fail('新容量不能小于已有预约人数', 'booking_conflict', 409);
    }
    const record = { ...existing, ...input, id: existing ? existing.id : randomUUID(), ownerId: owner.id, requestId, createdAt: existing ? existing.createdAt : new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
    const next = copy(state); next.activities = next.activities.filter(item => item.id !== record.id).concat(record); next.activityRequests.push({ ownerId: owner.id, requestId, fingerprint, activityId: record.id }); commit(next); return publicActivity(record);
  }
  function reserve(owner, body) {
    if (!body || typeof body !== 'object') fail('预约内容不完整');
    const requestId = text(body.requestId, '提交编号', 100); const activityId = text(body.activityId, '活动编号', 100); const date = day(body.date); const people = integer(body.people, '同行人数', 20);
    const previous = state.bookings.find(item => item.ownerId === owner.id && item.requestId === requestId);
    if (previous) { if (previous.activityId !== activityId || previous.date !== date || previous.people !== people) fail('同一提交编号不能用于不同预约', 'booking_conflict', 409); return bookingView(previous); }
    const activity = state.activities.find(item => item.id === activityId && item.published);
    if (!activity) fail('活动已下架或不存在', 'not_found', 404);
    if (date < today() || date < activity.startDate || date > activity.endDate) fail('请选择活动区间内尚未过去的日期');
    if (state.bookings.some(item => item.ownerId === owner.id && item.activityId === activityId && item.date === date && item.status === 'confirmed')) fail('当天已有预约，请先取消再调整人数', 'booking_conflict', 409);
    const used = state.bookings.filter(item => item.activityId === activityId && item.date === date && item.status === 'confirmed').reduce((sum, item) => sum + item.people, 0);
    if (used + people > activity.capacityPerDay) fail('当日剩余名额不足，请调整人数或日期', 'booking_full', 409);
    if (state.bookings.length >= 200000) fail('预约记录已达容量', 'booking_capacity', 503);
    const record = { id: randomUUID(), ownerId: owner.id, requestId, activityId, date, people, status: 'confirmed', createdAt: new Date(now()).toISOString() };
    const next = copy(state); next.bookings.push(record); commit(next); return bookingView(record);
  }
  function bookingView(booking) { const { ownerId, requestId, ...visible } = booking; const activity = state.activities.find(item => item.id === booking.activityId); return { ...visible, activityTitle: activity ? activity.title : '', location: activity ? activity.location : '' }; }
  function cancel(owner, id) { const record = state.bookings.find(item => item.id === id && item.ownerId === owner.id); if (!record) fail('预约不存在', 'not_found', 404); if (record.status === 'cancelled') return bookingView(record); const next = copy(state); const updated = next.bookings.find(item => item.id === id); updated.status = 'cancelled'; updated.cancelledAt = new Date(now()).toISOString(); commit(next); return bookingView(updated); }
  function summary(credential, batchId) {
    const owner = client(credential, 'seller');
    const activities = state.activities.filter(item => item.ownerId === owner.id && (!batchId || item.batchId === batchId));
    const ids = new Set(activities.map(item => item.id)); const bookings = state.bookings.filter(item => ids.has(item.activityId) && item.status === 'confirmed');
    const byDate = {}; bookings.forEach(item => { const key = item.activityId + ':' + item.date; const row = byDate[key] || (byDate[key] = { activityId: item.activityId, date: item.date, people: 0, reservations: 0 }); row.people += item.people; row.reservations += 1; });
    const rows = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const future = bookings.filter(item => item.date >= today());
    return { available: true, source: 'confirmed-bookings', totalTrips: future.length, totalParties: future.reduce((sum, item) => sum + item.people, 0), totalReservations: bookings.length, totalPeople: bookings.reduce((sum, item) => sum + item.people, 0), byDate: rows, top: activities.map(item => ({ name: item.title, count: future.filter(booking => booking.activityId === item.id).reduce((sum, booking) => sum + booking.people, 0) })).filter(item => item.count).sort((a, b) => b.count - a.count).slice(0, 5), activities: activities.map(item => ({ ...publicActivity(item), reservations: rows.filter(row => row.activityId === item.id) })), updatedAt: new Date(now()).toISOString() };
  }
  function dispatch({ method, path: route, credential, body, query = {} }) {
    if (method === 'POST' && route === '/api/booking-clients') return { status: 201, body: register(body) };
    const owner = client(credential);
    if (method === 'GET' && route === '/api/booking-activities') return { status: 200, body: { activities: state.activities.filter(item => item.published && item.endDate >= today()).map(publicActivity) } };
    if (method === 'POST' && route === '/api/booking-activities') { client(credential, 'seller'); return { status: 200, body: { activity: publish(owner, body) } }; }
    if (method === 'GET' && route === '/api/booking-summary') return { status: 200, body: summary(credential, query.batchId) };
    if (method === 'GET' && route === '/api/bookings') { client(credential, 'visitor'); return { status: 200, body: { bookings: state.bookings.filter(item => item.ownerId === owner.id).map(bookingView) } }; }
    if (method === 'POST' && route === '/api/bookings') { client(credential, 'visitor'); return { status: 201, body: { booking: reserve(owner, body) } }; }
    const cancellation = route.match(/^\/api\/bookings\/([a-f0-9-]{36})\/cancel$/);
    if (method === 'POST' && cancellation) { client(credential, 'visitor'); return { status: 200, body: { booking: cancel(owner, cancellation[1]) } }; }
    fail('预约接口不存在', 'not_found', 404);
  }
  return { dispatch, summary, authenticate: (credential, role) => { const owner = client(credential, role); return { id: owner.id, role: owner.role }; } };
}
module.exports = { createBookingService };
