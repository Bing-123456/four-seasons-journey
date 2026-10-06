'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');
const { createTransport } = require('../server/provider');
const { createInkPaintingService } = require('../server/ink-painting');
const { createDashScopeText2ImageAdapter } = require('../server/image-provider');

async function fixture(t, options = {}) {
  const server = createServer({ ...options, config: { ...readConfig({}), ...options.config } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return async (path, body, token = '') => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
}

function photo(size = 24576) {
  const bytes = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return { base64: bytes.toString('base64'), mimeType: 'image/png' };
}

test('translation route returns parsed translations and honest originals on fallback', async t => {
  const online = await fixture(t, { config: { provider: 'openai-compatible' }, transport: async ({ task, prompt }) => { assert.equal(task, 'translate'); assert.equal(prompt.maxTokens, 8192); return { items: ['Watermelon'] }; } });
  const result = await online('/api/translate', { blocks: ['西瓜'], target: 'en' });
  assert.equal(result.status, 200); assert.deepEqual(result.body.items, ['Watermelon']); assert.equal(result.body.translated, true);
  const offline = await fixture(t);
  const fallback = await offline('/api/translate', { blocks: ['西瓜'] });
  assert.deepEqual(fallback.body.items, ['西瓜']); assert.equal(fallback.body.translated, false);
  assert.equal(fallback.body.fallbackReason, 'model_disabled');
});

test('ink painting passes a real prompt through the production adapter and caches completed results', async t => {
  let polls = 0;
  const adapter = createDashScopeText2ImageAdapter({ apiKey: 'test', transport: async (_base, pathname, _options, payload) => {
    if (payload) {
      assert.equal(pathname, '/api/v1/services/aigc/text2image/image-synthesis');
      assert.match(payload.input.prompt, /中国传统水墨.*农耕文化主题：麦田/);
      return { output: { task_id: 'provider-id' } };
    }
    polls++;
    if (polls > 1) throw new Error('provider unavailable');
    return { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://images.example/ink.png' }] } };
  } });
  const request = await fixture(t, { inkAdapter: adapter, config: { requestsPerMinute: 1 } });
  const job = await request('/api/ink-painting', { keyword: '麦田' });
  assert.equal(job.status, 202); assert.equal(job.body.status, 'queued');
  const first = await request('/api/ink-painting/' + job.body.taskId);
  const again = await request('/api/ink-painting/' + job.body.taskId);
  assert.equal(first.status, 200); assert.equal(first.body.status, 'succeeded');
  assert.deepEqual(again.body, first.body); assert.equal(polls, 1);
  assert.equal((await request('/api/ink-painting', { keyword: '果园' })).status, 429);
});

test('ink tasks are private to their paired session and sessions have separate submission quotas', async t => {
  const codes = [];
  const request = await fixture(t, {
    config: { token: 'a-management-token-123456789', requestsPerMinute: 1 },
    onPairingCode: value => codes.push(value.code),
    inkAdapter: { create: async () => 'provider-id', status: async () => ({ status: 'generating' }) }
  });
  const first = (await request('/api/pair', { code: codes.at(-1) })).body.token;
  const second = (await request('/api/pair', { code: codes.at(-1) })).body.token;
  const job = await request('/api/ink-painting', { keyword: '麦田' }, first);
  assert.equal((await request('/api/ink-painting/' + job.body.taskId, undefined, second)).status, 404);
  assert.equal((await request('/api/ink-painting/' + job.body.taskId, undefined, first)).status, 200);
  assert.equal((await request('/api/ink-painting', { keyword: '果园' }, second)).status, 202);
});

test('ink provider errors are retryable and never leak upstream details', async () => {
  let attempts = 0;
  const service = createInkPaintingService({ create: async () => 'provider-id', status: async () => {
    if (attempts++ === 0) throw new Error('Bearer private-provider-key');
    return { status: 'succeeded', imageUrl: 'https://images.example/ink.png' };
  } });
  const job = await service.submit({ keyword: '果园' });
  await assert.rejects(service.status(job.taskId), error => error.code === 'image_provider_unavailable' && error.status === 502 && !error.message.includes('private'));
  assert.equal((await service.status(job.taskId)).status, 'succeeded');
});

test('vision and image endpoints reject invalid URL configuration at startup', () => {
  for (const key of ['VISION_BASE_URL', 'DASHSCOPE_BASE_URL']) for (const value of ['http://provider.example', 'https://user:password@provider.example', 'https://localhost']) {
    assert.throws(() => readConfig({ [key]: value }));
  }
});
