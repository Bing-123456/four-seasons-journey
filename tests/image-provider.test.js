'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: turn } = require('node:timers/promises');
const { createDashScopeImageAdapter, createDashScopeText2ImageAdapter, MODEL } = require('../server/image-provider');
const result = image => ({ output: { choices: [{ message: { role: 'assistant', content: [{ image: image || 'https://result.example/fruit.png' }] } }] } });
function fakeTransport(script) {
  const calls = [];
  const transport = async (base, pathname, options, payload) => { calls.push({ base, pathname, options, payload }); return script(pathname, payload); };
  transport.calls = calls; return transport;
}
async function resource(adapter) { return adapter.upload({ bytes: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' }); }
async function finished(adapter, id) {
  for (let i = 0; i < 20; i += 1) { const state = await adapter.status(id); if (['succeeded', 'failed'].includes(state.status)) return state; await turn(); }
  throw new Error('task did not settle');
}

test('Qwen edit receives the confirmed photo, one subject instructions and a white background request', async () => {
  const transport = fakeTransport(() => result());
  const adapter = createDashScopeImageAdapter({ apiKey: 'test', transport });
  const id = await adapter.create({ resource: await resource(adapter) });
  assert.equal((await finished(adapter, id)).status, 'succeeded');
  const call = transport.calls[0];
  assert.equal(call.pathname, '/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(call.payload.model, MODEL); assert.equal(MODEL, 'qwen-image-edit-max');
  assert.equal(call.options.extraHeaders, undefined, 'synchronous Qwen endpoint must not receive Wanx async header');
  assert.equal(call.options.timeoutMs, 100000);
  const message = call.payload.input.messages[0];
  assert.equal(message.role, 'user'); assert.match(message.content[0].image, /^data:image\/jpeg;base64,/);
  assert.match(message.content[1].text, /一个水果/); assert.match(message.content[1].text, /纯白/); assert.match(message.content[1].text, /严格保留/);
  assert.equal(call.payload.parameters.n, 1); assert.equal(call.payload.parameters.prompt_extend, false);
  assert.equal(call.payload.parameters.size, '1024*1024'); assert.match(call.payload.parameters.negative_prompt, /原照片背景/);
});

test('slow synchronous generation remains a fast asynchronous task with idempotent status reads', async () => {
  let complete;
  const transport = fakeTransport(() => new Promise(resolve => { complete = resolve; }));
  const adapter = createDashScopeImageAdapter({ apiKey: 'test', transport });
  const uploaded = await resource(adapter);
  const id = await adapter.create({ resource: uploaded, requestId: 'same-request' });
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal((await adapter.status(id)).status, 'generating');
  assert.equal(await adapter.create({ resource: uploaded, requestId: 'same-request' }), id);
  assert.equal(transport.calls.length, 1);
  complete(result());
  const state = await finished(adapter, id); assert.equal(state.status, 'succeeded'); assert.equal(state.imageUrl, 'https://result.example/fruit.png');
  for (let i = 0; i < 4; i += 1) assert.deepEqual(await adapter.status(id), state);
  assert.equal(transport.calls.length, 1);
});

test('provider HTTP errors and invalid responses become explicit failed tasks, not fake images', async () => {
  for (const script of [() => { throw new Error('http429'); }, () => ({}), () => result('http://result.example/unsafe.png'), () => ({ output: { choices: [{ message: { content: [{ text: 'no image' }] } }] } })]) {
    const adapter = createDashScopeImageAdapter({ apiKey: 'test', transport: fakeTransport(script) });
    const id = await adapter.create({ resource: await resource(adapter) });
    assert.deepEqual(await finished(adapter, id), { status: 'failed' });
  }
});

test('missing API key disables the adapter; invalid or expired resources cannot trigger a generation', async () => {
  assert.equal(createDashScopeImageAdapter({}), null);
  let now = 1000;
  const transport = fakeTransport(() => result());
  const adapter = createDashScopeImageAdapter({ apiKey: 'test', transport, now: () => now, ttl: 100 });
  await assert.rejects(adapter.create({ resource: 'https://untrusted.example/arbitrary.png' }), /invalid_resource/);
  const uploaded = await resource(adapter); now = 1101;
  await assert.rejects(adapter.create({ resource: uploaded }), /invalid_resource/); assert.equal(transport.calls.length, 0);
});

test('concurrent jobs, completed job storage and TTL are bounded', async () => {
  let now = 1000, complete;
  const adapter = createDashScopeImageAdapter({ apiKey: 'test', now: () => now, ttl: 100, maxConcurrent: 1, maxJobs: 1, transport: fakeTransport(() => new Promise(resolve => { complete = resolve; })) });
  const uploaded = await resource(adapter);
  const id = await adapter.create({ resource: uploaded });
  await assert.rejects(adapter.create({ resource: uploaded }), /server_busy/);
  complete(result()); await finished(adapter, id);
  await assert.rejects(adapter.create({ resource: uploaded }), /server_busy/);
  now = 1101; await assert.rejects(adapter.status(id), /expired/);
  const replacement = await resource(adapter), next = await adapter.create({ resource: replacement });
  assert.notEqual(next, id); complete(result()); await finished(adapter, next);
});

test('idempotency identifier cannot be reused with a different photo', async () => {
  const adapter = createDashScopeImageAdapter({ apiKey: 'test', transport: fakeTransport(() => result()) });
  const first = await resource(adapter), second = await resource(adapter);
  await adapter.create({ resource: first, requestId: 'same-request' });
  await assert.rejects(adapter.create({ resource: second, requestId: 'same-request' }), /request_conflict/);
});

test('keyword text-to-image keeps its existing Wanx async protocol unchanged', async () => {
  const transport = fakeTransport((pathname) => pathname.startsWith('/api/v1/tasks/') ? { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://result.example/ink.png' }] } } : { output: { task_id: 'wanx-id' } });
  const adapter = createDashScopeText2ImageAdapter({ apiKey: 'test', transport });
  assert.equal(await adapter.create({ prompt: '秋日采柿' }), 'wanx-id');
  assert.deepEqual(await adapter.status('wanx-id'), { status: 'succeeded', imageUrl: 'https://result.example/ink.png' });
  const call = transport.calls[0]; assert.equal(call.payload.model, 'wanx2.1-t2i-turbo'); assert.deepEqual(call.payload.parameters, { size: '768*768', n: 1 }); assert.equal(call.options.extraHeaders['X-DashScope-Async'], 'enable');
});
