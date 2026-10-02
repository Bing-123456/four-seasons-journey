'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');
const { createTransport } = require('../server/provider');
const { loadEnv } = require('../server/env');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');

async function fixture(t, overrides = {}) {
  const config = { ...readConfig({ PORT: '0' }), ...overrides.config };
  const server = createServer({ config, transport: overrides.transport });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return async (route, body, options = {}) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body),
      ...options.fetch
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
}

test('offline health and complete local fallback do not invoke a provider', async t => {
  let calls = 0;
  const request = await fixture(t, { transport: async () => { calls++; throw new Error('must not run'); } });
  const health = await request('/health');
  assert.equal(health.body.image.configured, false);
  const { image, inkPainting, vision, speech, asr, placeRecommend, bookings, chat, ...textHealth } = health.body;
  assert.equal(inkPainting.configured, false, 'ink painting generator degrades honestly without a provider');
  assert.equal(vision.configured, false);
  assert.equal(speech.configured, false);
  assert.equal(asr.configured, false, 'voice input reports its own availability instead of hiding inside speech');
  assert.equal(placeRecommend.configured, false);
  assert.equal(bookings.configured, true);
  assert.equal(chat.chat, false, 'the chat endpoint reports its availability like the other model services');
  assert.deepEqual(textHealth, { ok: true, provider: 'disabled', configured: false, auth: { required: false, authenticated: true, mode: 'local-development', expiresAt: null }, model: { configured: false, availability: 'disabled', lastCheckedAt: null } });
  const profile = await request('/api/profile', { text: '两个人，预算200元，玩四小时，喜欢文化' });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.mode, 'local-rules');
  assert.equal(profile.body.fallbackReason, 'model_disabled');
  assert.equal(profile.body.profile.partySize, 2);
  assert.equal(calls, 0);
});

// 语音输入的兜底链路里，/api/asr 是「点麦克风」必经的一跳。
// 这里守住两件事：路由只在 POST 上存在；以及录音的体积上限走自己的额度，
// 不被全局 maxBodyBytes（默认 16 KB）压死——16 kHz/24 kbps 的 mp3 约 3 KB/s，
// base64 后约 4 KB/s，**全局上限只够约 4 秒**（3 秒≈12 KB 能过，5 秒≈20 KB 必 413）。
test('voice input is reachable over HTTP and refuses non-audio payloads', async t => {
  const request = await fixture(t, { config: { maxBodyBytes: 512 } });
  const health = await request('/health');
  assert.equal(health.body.asr.configured, false);
  assert.deepEqual(health.body.asr.languages, ['zh', 'yue', 'en']);
  assert.equal(health.body.asr.maxSeconds, 60);
  const mp3 = Buffer.concat([Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000'), Buffer.alloc(4096, 7)]).toString('base64');
  assert.equal((await request('/api/asr', { audio: mp3, format: 'mp3' })).status, 503, 'valid audio reaches the (unconfigured) recognizer');
  assert.equal((await request('/api/asr', { audio: mp3, format: 'ogg' })).status, 400);
  assert.equal((await request('/api/asr', { audio: 'x', format: 'mp3' })).status, 400);
  assert.equal((await request('/api/asr', { audio: mp3, format: 'mp3' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/asr')).status, 404, 'GET is not a voice-input route');
});

test('input validation rejects malformed JSON, oversized body and wrong types', async t => {
  const request = await fixture(t, { config: { maxBodyBytes: 512 } });
  assert.equal((await request('/api/profile', '{broken', { raw: true })).status, 400);
  assert.equal((await request('/api/profile', { text: 'x'.repeat(600) })).status, 413);
  assert.equal((await request('/api/profile', { text: ['hello'] })).status, 400);
  assert.equal((await request('/api/profile', { text: 'hello', base: { budget: -1 } })).status, 400);
  assert.equal((await request('/api/profile', { text: 'hello', base: { date: '2026-02-30' } })).status, 400);
  assert.equal((await request('/api/profile', { text: 'hello', base: { startTime: '25:00' } })).status, 400);
  assert.equal((await request('/api/profile', { text: 'hello', base: { admin: true } })).status, 400);
  assert.equal((await request('/api/ask', { question: '文化', placeId: 'missing' })).status, 400);
  assert.equal((await request('/api/profile', { text: 'hello' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('validated cloud profile preserves explicit user consent settings', async t => {
  const request = await fixture(t, {
    config: { provider: 'openai-compatible' },
    transport: async ({ task }) => {
      assert.equal(task, 'profile');
      return { changes: [
        { field: 'budget', value: 250, evidenceSpan: '预算250元' },
        { field: 'transport', value: 'bike', evidenceSpan: '骑车' }
      ] };
    }
  });
  const result = await request('/api/profile', { text: '骑车，预算250元', base: catalog.defaultProfile });
  assert.equal(result.body.mode, 'openai-compatible');
  assert.equal(result.body.profile.budget, 250);
  assert.equal(result.body.profile.transport, 'bike');
  assert.equal(result.body.profile.optInSupport, false);
});

test('invalid cloud profile and provider failures fall back with honest modes', async t => {
  const request = await fixture(t, {
    config: { provider: 'openai-compatible' },
    transport: async () => ({ profile: { partySize: -99 } })
  });
  const result = await request('/api/profile', { text: '两个人' });
  assert.equal(result.body.mode, 'local-rules');
  assert.equal(result.body.profile.partySize, 2);
  assert.equal(result.body.fallbackReason, 'model_invalid_output');
});

test('timeout aborts transport and releases the concurrent request slot', async t => {
  let aborted = false;
  const request = await fixture(t, {
    config: { provider: 'openai-compatible', timeoutMs: 25, maxConcurrent: 1 },
    transport: async ({ signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); })
  });
  const result = await request('/api/profile', { text: '两个人' });
  assert.equal(result.body.mode, 'local-rules');
  assert.equal(result.body.fallbackReason, 'model_timeout');
  assert.equal(aborted, true);
  assert.equal((await request('/api/profile', { text: '三个人' })).status, 200);
});

test('unsupported cultural claims are refused without asking the provider', async t => {
  let calls = 0;
  const request = await fixture(t, {
    config: { provider: 'openai-compatible' },
    transport: async () => { calls++; return {}; }
  });
  const result = await request('/api/ask', { question: '1893年老瓜田的四膜一布古法是什么？', placeId: 'summer-culture' });
  assert.equal(result.body.unanswerable, true);
  assert.deepEqual(result.body.sourceIds, []);
  assert.equal(result.body.mode, 'local-retrieval');
  assert.equal(calls, 0);
});

test('cloud evidence selection returns only reviewed facts and valid sources', async t => {
  const question = '西瓜栽培技艺是什么级别的非遗？';
  const local = core.answerQuestion(question, 'summer-culture');
  assert.ok(local.evidenceIds.length);
  const id = local.evidenceIds[0];
  const fact = catalog.facts.find(x => x.id === id);
  const request = await fixture(t, {
    config: { provider: 'openai-compatible' },
    transport: async () => ({ evidenceIds: [id], unanswerable: false, answer: '恶意编造的千年故事' })
  });
  const result = await request('/api/ask', { question, placeId: 'summer-culture' });
  assert.equal(result.body.mode, 'openai-compatible');
  assert.equal(result.body.answer, fact.text);
  assert.deepEqual(result.body.sourceIds, fact.sourceIds);
  assert.deepEqual(result.body.evidenceIds, [id]);
  assert.equal(result.body.grounding, 'verified-evidence-selection');
});

test('a fabricated evidence ID cannot become a source citation', async t => {
  const request = await fixture(t, {
    config: { provider: 'openai-compatible' },
    transport: async () => ({ evidenceIds: ['forged-source'], unanswerable: false })
  });
  const result = await request('/api/ask', { question: '西瓜栽培技艺是什么级别的非遗？', placeId: 'summer-culture' });
  assert.equal(result.body.mode, 'local-retrieval');
  assert.equal(result.body.fallbackReason, 'model_invalid_output');
  assert.ok(!result.body.evidenceIds.includes('forged-source'));
});

test('server token protects remote enablement and health never exposes secrets', async t => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }), /API_TOKEN/);
  const token = 'test-service-token-abcdefghijklmnopqrstuvwxyz';
  const request = await fixture(t, { config: { host: '0.0.0.0', token, providerKey: 'fake-secret-key', provider: 'disabled' } });
  assert.equal((await request('/api/profile', { text: '两个人' })).status, 401);
  assert.equal((await request('/api/profile', { text: '两个人' }, { headers: { authorization: 'Bearer ' + token } })).status, 200);
  const health = await request('/health');
  assert.ok(!JSON.stringify(health.body).includes('secret'));
  assert.ok(!JSON.stringify(health.body).includes(token));
});

test('rate and concurrency limits return explicit HTTP errors', async t => {
  const rateRequest = await fixture(t, { config: { requestsPerMinute: 1 } });
  assert.equal((await rateRequest('/api/profile', { text: '两个人' })).status, 200);
  const limited = await rateRequest('/api/profile', { text: '两个人' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  let release;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const request = await fixture(t, {
    config: { provider: 'openai-compatible', maxConcurrent: 1 },
    transport: async () => new Promise(resolve => { release = () => resolve({ profile: catalog.defaultProfile }); entered(); })
  });
  const first = request('/api/profile', { text: '两个人' });
  await enteredPromise;
  assert.equal((await request('/api/profile', { text: '三个人' })).status, 503);
  release();
  assert.equal((await first).status, 200);
});

test('untrusted browser origins cannot invoke local model endpoints', async t => {
  const request = await fixture(t);
  assert.equal((await request('/api/profile', { text: '两个人' }, { headers: { origin: 'https://malicious.example' } })).status, 403);
  const allowed = await request('/api/profile', { text: '两个人' }, { headers: { origin: 'http://localhost:3000' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});

test('cloud config defaults offline, requires credentials, and disallows local model URLs', () => {
  assert.equal(readConfig({}).provider, 'disabled');
  assert.equal(readConfig({ MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'deepseek-flash' }).provider, 'disabled');
  assert.equal(readConfig({ MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'deepseek-flash', OPENAI_API_KEY: 'fake' }).provider, 'openai-compatible');
  assert.throws(() => readConfig({ MODEL_PROVIDER: 'ollama' }));
  assert.throws(() => readConfig({ OPENAI_BASE_URL: 'http://127.0.0.1:11434' }));
  assert.throws(() => readConfig({ OPENAI_BASE_URL: 'https://localhost' }));
  assert.throws(() => readConfig({ OPENAI_BASE_URL: 'https://name:password@example.com' }));
});

test('OpenAI-compatible transport uses DeepSeek JSON mode with key confined to headers', async () => {
  let calls = 0;
  const config = readConfig({ MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'deepseek-flash', OPENAI_API_KEY: 'fake-test-key' });
  const transport = createTransport(config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer fake-test-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.response_format.type, 'json_object');
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.ok(!options.body.includes('fake-test-key'));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  assert.equal(await transport({ prompt: { system: '只输出 JSON', user: 'hi' }, signal: new AbortController().signal }), '{"ok":true}');
  assert.equal(calls, 1);
});

test('dotenv reads only requested file and preserves the process environment', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guayou-env-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, '# comment\nMODEL_PROVIDER=openai-compatible\nMODEL_NAME="deepseek-flash"\nPORT=9999 # development\n');
  const env = { PORT: '8787' };
  loadEnv(file, env);
  assert.deepEqual(env, { PORT: '8787', MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'deepseek-flash' });
});
