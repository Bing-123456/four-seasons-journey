'use strict';
// 果乡发布被服务端拒时，响应体里机器可读的 code / field / max / reason 必须跟着 Error 一起到页面（2026-10-16）。
// 背景：lib/media-service.js 的 handleResponse 原来只做 new Error(data.error)，这三个字段被吞在请求层，
// 页面只能从中文文案里反推是哪一栏、上限多少（publish-flow.js 的 rejectReason 第二路）。
// 这份测试盯住三件事：
//   ① 服务端给了 code / field / max / reason → 抛出的 Error 上带得到，且 message 仍是 error 原文一字不改；
//   ② 服务端只给 error（老回执）→ 照旧抛、照旧认，且不凭空长出这几个字段（没传就不挂）；
//   ③ 只有文案那一路（从中文反推字段与上限）仍然通 —— 结构化字段是增强，不是替代。
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const media = require('../miniprogram/lib/media-service');
const publishFlow = require('../miniprogram/pages/seller/publish/publish-flow');

const token = 'a'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
let memory, reply;

test.beforeEach(() => {
  memory = new Map(); reply = { statusCode: 200, data: {} };
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    // 与真实 wx.request 一样：只回 statusCode + data，成功/失败由 lib/media-service.js 的 handleResponse 判。
    request: options => { if (options.success) options.success(reply); }
  };
  store.exitDemo(); store.clearAll();
  store.saveSession({ token, expiresAt: Date.now() + 600000 }, store.getSettings().apiBase);
});
test.after(() => { delete global.wx; });

// 走真实请求层：capture 拿连接上下文 → request 发出去 → 把抛出的 Error 接回来（不 resolve 就说明没抛）。
function send() {
  return media.request(media.capture(), 'POST', '/api/farmtown/create', {}).then(
    () => { throw new Error('本该被拒绝，却成功了'); },
    error => error
  );
}

test('①服务端带 code / field / max / reason 时，Error 上带得到这三个字段，message 是 error 原文', async () => {
  reply = { statusCode: 400, data: { error: '果乡名称过长（最多 60 字）', code: 'invalid_farmtown', field: 'name', max: 60, reason: 'too_long' } };
  const error = await send();
  assert.ok(error instanceof Error);
  assert.equal(error.message, '果乡名称过长（最多 60 字）', 'message 一字不改');
  assert.equal(error.code, 'invalid_farmtown');
  assert.equal(error.field, 'name');
  assert.equal(error.max, 60);
  assert.equal(error.reason, 'too_long');
  assert.equal(error.retryable, false, '其余逻辑照旧：400 不重试');
  // 页面这一侧优先读结构化字段：不用从中文文案里反推也知道是哪一栏、上限多少。
  assert.deepEqual(publishFlow.rejectReason(error), { field: 'name', max: 60, tooLong: true });
  assert.equal(publishFlow.failureMessage(error, false), '果乡名称过长（最多 60 字）');
});

test('①之二 data 是 JSON 字符串（老中转形状）时同样带得到', async () => {
  reply = { statusCode: 400, data: JSON.stringify({ error: '当季水果过长（最多 30 字）', code: 'invalid_farmtown', field: 'fruit', max: 30, reason: 'too_long' }) };
  const error = await send();
  assert.equal(error.message, '当季水果过长（最多 30 字）');
  assert.equal(error.field, 'fruit'); assert.equal(error.max, 30); assert.equal(error.reason, 'too_long');
  assert.deepEqual(publishFlow.rejectReason(error), { field: 'fruit', max: 30, tooLong: true });
});

test('②只回 { error } 时照旧工作：不崩、message 照旧，且不多挂字段', async () => {
  reply = { statusCode: 400, data: { error: '服务暂时不可用' } };
  const error = await send();
  assert.equal(error.message, '服务暂时不可用');
  for (const key of ['code', 'field', 'max', 'reason']) assert.equal(key in error, false, key + ' 没传就不该挂上去');
  assert.equal(publishFlow.failureMessage(error, false), '发布失败', '认不出的原因沿用原来那句通用文案');
});

test('②之二没有任何 error 文案时照旧给兜底那句（429 / 500 的重试标记也不动）', async () => {
  reply = { statusCode: 429, data: {} };
  const error = await send();
  assert.equal(error.message, '请求过于频繁，请稍后重试');
  assert.equal(error.retryable, true);
  assert.equal('field' in error, false);
});

test('③只有中文文案那一路（从文案反推字段与上限）仍然通', async () => {
  reply = { statusCode: 400, data: { error: '果乡介绍过长（最多 600 字）' } };
  const error = await send();
  // 兜底那一路照旧认得出：结构化字段缺席时从文案里取字段与上限。
  assert.deepEqual(publishFlow.rejectReason(error), { field: 'description', max: 600, tooLong: true });
  assert.deepEqual(publishFlow.rejectReason(new Error('果乡名称未填写或过长')), { field: 'name', max: 60, tooLong: false });
  assert.equal(publishFlow.rejectReason(new Error('省份过长（最多 20 字）')), null);
});
