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

test('normal photos exceed text limits and use independently configured vision with parsed JSON', async t => {
  let calls = 0;
  const config = readConfig({ VISION_API_KEY: 'vision-test-key' });
  const transport = createTransport(config, async (url, options) => {
    calls++;
    assert.match(url, /compatible-mode\/v1\/chat\/completions$/);
    assert.equal(options.headers.authorization, 'Bearer vision-test-key');
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
    assert.equal(payload.response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"fruit":"西瓜","confidence":"high"}\n```' } }] }));
  });
  const request = await fixture(t, { config, transport });
  const initial = (await request('/health')).body;
  assert.equal(initial.model.availability, 'disabled');
  assert.equal(initial.vision.availability, 'not-checked');
  const result = await request('/api/identify-fruit', photo());
  assert.equal(result.status, 200);
  assert.equal(result.body.fruit, '西瓜');
  assert.equal(result.body.identified, true);
  assert.equal(result.body.mode, 'openai-compatible');
  assert.equal(calls, 1);
  const health = (await request('/health')).body;
  assert.equal(health.vision.availability, 'last-call-succeeded');
  assert.equal(health.model.availability, 'disabled');
  assert.ok(!JSON.stringify(health).includes('vision-test-key'));
});

test('missing vision cannot silently discard the picture and ask the text model', async t => {
  let calls = 0;
  const request = await fixture(t, { config: { provider: 'openai-compatible' }, transport: async () => { calls++; return { fruit: '西瓜' }; } });
  const result = await request('/api/identify-fruit', photo());
  assert.equal(result.body.identified, false);
  assert.equal(result.body.fallbackReason, 'vision_disabled');
  assert.equal(calls, 0);
  assert.equal((await request('/health')).body.model.availability, 'not-checked');
});

test('vision validates decoded size and image type before any upstream request', async t => {
  let calls = 0;
  const request = await fixture(t, { config: readConfig({ DASHSCOPE_API_KEY: 'test' }), transport: async () => { calls++; return { fruit: 'unknown' }; } });
  for (const body of [{ ...photo(), base64: 'not-image' }, { ...photo(), mimeType: 'image/jpeg' }, { ...photo(), base64: Buffer.from('not a PNG').toString('base64') }]) {
    assert.equal((await request('/api/identify-fruit', body)).status, 400);
  }
  assert.equal((await request('/api/identify-fruit', photo(2 * 1024 * 1024 + 1))).status, 413);
  assert.equal(calls, 0);
});

test('vision timeout aborts upstream, frees the slot and keeps text health independent', async t => {
  let aborted = false;
  const request = await fixture(t, {
    config: { maxConcurrent: 1, vision: { apiKey: 'test', timeoutMs: 15 } },
    transport: ({ signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true; }))
  });
  const result = await request('/api/identify-fruit', photo());
  assert.equal(result.body.fallbackReason, 'model_timeout'); assert.equal(aborted, true);
  assert.equal((await request('/health')).body.vision.availability, 'last-call-failed');
  assert.equal((await request('/api/profile', { text: '两个人' })).status, 200);
});

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
