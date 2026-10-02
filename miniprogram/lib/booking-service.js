'use strict';
const store = require('./store');
const pending = {};
function context(role) { const cloud = store.getCloudConnection(); return { role: role || 'visitor', partition: store.capturePartition(), apiBase: cloud.apiBase.replace(/\/$/, ''), token: cloud.token }; }
function key(ctx) { return 'guayouji.booking-client.v1:' + ctx.partition + ':' + ctx.apiBase + ':' + ctx.role; }
function same(ctx) { const cloud = store.getCloudConnection(); return ctx.partition === store.capturePartition() && ctx.apiBase === cloud.apiBase.replace(/\/$/, '') && ctx.token === cloud.token; }
function getCredential(role) { try { const value = wx.getStorageSync(key(context(role))); return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : ''; } catch (_) { return ''; } }
function request(ctx, path, body, method, credential, options) {
  return new Promise((resolve, reject) => {
    if (ctx.partition === 'demo' && !(options && options.allowDemoIdentity && path === '/api/booking-clients')) { reject(new Error('演示账户不发布活动或提交真实预约')); return; }
    if (!same(ctx)) { reject(new Error('账户或服务器已切换，请重试')); return; }
    const header = { 'content-type': 'application/json' }; const token = ctx.token;
    if (token) header.authorization = 'Bearer ' + token;
    if (credential) header['X-Booking-Client'] = credential;
    wx.request({ url: ctx.apiBase + path, method: method || 'POST', data: body, header, timeout: 20000,
      success(response) { if (!same(ctx)) { reject(new Error('账户或服务器已切换，请重试')); return; } if (response.statusCode >= 200 && response.statusCode < 300 && response.data) resolve(response.data); else { const error = new Error(response.data && response.data.error || '预约服务暂时不可用'); error.code = response.data && response.data.code; if (error.code === 'booking_unauthorized' && wx.getStorageSync(key(ctx)) === credential) wx.removeStorageSync(key(ctx)); reject(error); } },
      fail() { reject(new Error('预约服务连接失败，请稍后重试')); }
    });
  });
}
function ensureClient(role, options) {
  const ctx = context(role); if (ctx.partition === 'demo' && !(options && options.allowDemoIdentity)) return Promise.reject(new Error('演示账户不连接真实预约服务'));
  const saved = getCredential(role); if (saved) return Promise.resolve(saved);
  const storageKey = key(ctx);
  if (!pending[storageKey] || pending[storageKey].token !== ctx.token) {
    const entry = { token: ctx.token };
    entry.promise = request(ctx, '/api/booking-clients', { role: ctx.role }, 'POST', '', options).then(result => { if (!same(ctx)) throw new Error('账户或服务器已切换，请重试'); if (!/^[a-f0-9]{64}$/.test(result.credential || '')) throw new Error('预约身份响应无效'); wx.setStorageSync(storageKey, result.credential); return result.credential; }).finally(() => { if (pending[storageKey] === entry) delete pending[storageKey]; });
    pending[storageKey] = entry;
  }
  return pending[storageKey].promise;
}
function call(role, path, body, method) { const ctx = context(role); return ensureClient(role).then(credential => request(ctx, path, body, method, credential)); }
let sequence = 0;
function requestId() { return 'request-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2); }
module.exports = { getCredential, ensureClient, requestId,
  listActivities: () => call('visitor', '/api/booking-activities', undefined, 'GET'),
  listBookings: () => call('visitor', '/api/bookings', undefined, 'GET'),
  reserve: body => call('visitor', '/api/bookings', body),
  cancel: id => call('visitor', '/api/bookings/' + encodeURIComponent(id) + '/cancel', {}),
  publish: body => call('seller', '/api/booking-activities', body),
  summary: batchId => call('seller', '/api/booking-summary?batchId=' + encodeURIComponent(batchId || ''), undefined, 'GET')
};
