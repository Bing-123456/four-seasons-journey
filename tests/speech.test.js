'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSpeechService, createSpeechAdapter, VOICES } = require('../server/speech');

test('speech validates dialect and caches completed audio across restarts without a second provider call', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'speech-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let count = 0;
  const adapter = { async synthesize() { count++; await new Promise(resolve => setTimeout(resolve, 10)); return { bytes: Buffer.from('RIFFtestWAVEaudio'), format: 'wav' }; } };
  const service = createSpeechService(adapter, { dir });
  const body = { text: '四时果园', dialect: 'mandarin' };
  const results = await Promise.all([service.synthesize(body), service.synthesize(body)]);
  assert.equal(count, 1); assert.equal(results[0].audioUrl, results[1].audioUrl);
  const restarted = createSpeechService(adapter, { dir });
  assert.equal((await restarted.synthesize(body)).cached, true); assert.equal(count, 1);
  assert.equal((await restarted.read(results[0].audioUrl.split('/').pop())).contentType, 'audio/wav');
  assert.equal(await restarted.read('../private.env'), null);
  await assert.rejects(service.synthesize({ text: 'x', dialect: 'unknown' }), /无效/);
  await assert.rejects(service.synthesize({ text: 'x'.repeat(1201), dialect: 'mandarin' }), /无效/);
  assert.equal(new Set(Object.values(VOICES).map(v => v.voice)).size, 6);
});

test('provider HTTP URLs are upgraded only for the expected Alibaba result storage', async () => {
  const requests = [];
  const adapter = createSpeechAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com' }, { fetch: async (url, init) => {
    requests.push(String(url));
    if (init.method) return { ok: true, json: async () => ({ output: { audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?signature=example' } } }) };
    return new Response(Buffer.from('RIFF0000WAVEdata'));
  } });
  assert.equal((await adapter.synthesize('你好', 'mandarin')).format, 'wav');
  assert.ok(requests[1].startsWith('https://dashscope-result-'));
  const invalid = createSpeechAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com' }, { fetch: async () => ({ ok: true, json: async () => ({ output: { audio: { url: 'https://127.0.0.1/secret' } } }) }) });
  await assert.rejects(invalid.synthesize('你好', 'mandarin'), /speech_url/);
});

test('streaming WAV placeholder chunk sizes are rewritten with real byte counts so mobile players can play', async () => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(0x7fffffbf, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.write('data', 36); header.writeUInt32LE(0x7fffff9b, 40);
  const wav = Buffer.concat([header, Buffer.from([1, 2, 3, 4])]);
  const adapter = createSpeechAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com' }, { fetch: async (url, init) => {
    if (init.method) return { ok: true, json: async () => ({ output: { audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?signature=example' } } }) };
    return new Response(wav);
  } });
  const result = await adapter.synthesize('你好', 'mandarin');
  assert.equal(result.bytes.readUInt32LE(4), result.bytes.length - 8, 'RIFF size is final');
  assert.equal(result.bytes.readUInt32LE(40), result.bytes.length - 44, 'data size is final');
});

test('English reader translates before speech and page cancellation prevents late playback', async t => {
  const media = require('../miniprogram/lib/media-service'), service = require('../miniprogram/lib/service'), store = require('../miniprogram/lib/store');
  const reader = require('../miniprogram/lib/speech-reader');
  const originals = { capture: media.capture, isCurrent: media.isCurrent, request: media.request, translate: service.translate, capturePartition: store.capturePartition, wx: global.wx };
  t.after(() => { Object.assign(media, { capture: originals.capture, isCurrent: originals.isCurrent, request: originals.request }); service.translate = originals.translate; store.capturePartition = originals.capturePartition; global.wx = originals.wx; });
  const calls = []; let played = 0, end;
  const speechUrl = '/speech/' + 'a'.repeat(64) + '.wav';
  const speechResult = { taskId: 'task-1', status: 'succeeded', audioUrl: speechUrl };
  const queuedResult = { taskId: 'task-1', status: 'queued' };
  function mockSpeechRequest(result) {
    return async (context, method, path, body) => {
      if (method === 'POST') { assert.equal(body.text, 'An orchard story.'); calls.push(body.dialect); return result; }
      return speechResult;
    };
  }
  media.capture = () => ({ partition: 'personal', apiBase: 'https://test.invalid' }); media.isCurrent = () => true; store.capturePartition = () => 'personal';
  service.translate = async blocks => { calls.push('translate'); return blocks.map(() => 'An orchard story.'); };
  media.request = mockSpeechRequest(speechResult);
  global.wx = { createInnerAudioContext: () => ({ onEnded(fn) { end = fn; }, onError() {}, onStop() {}, play() { played++; queueMicrotask(end); }, stop() {}, destroy() {} }), showToast() {} };
  const page = { data: { dialect: 'english' }, setData(value) { Object.assign(this.data, value); } };
  await reader.start(page, '果园故事'); assert.deepEqual(calls, ['translate', 'english']); assert.equal(played, 1);
  page._spokenTranslations = {};
  service.translate = async blocks => { assert.ok(blocks.every(block => block.length <= 600)); return blocks.map(() => 'An orchard story.'); };
  media.request = mockSpeechRequest(speechResult);
  await reader.start(page, '果园'.repeat(700));
  const beforeCancel = played;
  let resolve;
  media.request = () => new Promise(r => { resolve = r; });
  page._spokenTranslations['果园故事'] = 'An orchard story.';
  const pending = reader.start(page, '果园故事'); await Promise.resolve(); reader.stop(page);
  resolve(queuedResult); await pending;
  assert.equal(played, beforeCancel); assert.equal(page.data.readBusy, false);
  assert.equal(reader.chunks('a'.repeat(1501)).join('').length, 1501, 'long reading is not silently truncated');
});
