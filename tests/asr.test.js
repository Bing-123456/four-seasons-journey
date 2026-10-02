'use strict';

// 服务端语音识别（/api/asr，qwen3-asr-flash）。
// 覆盖：请求体形状、响应解析、音频校验、错误分级、可用性上报。
// 关键纪律：provider 调用成功但没听出内容（asr_empty）与 provider 挂了
// （asr_unavailable）必须分开报——否则「模型没听清」会被当成「服务故障」计入监控。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAsrAdapter, createAsrService, MAX_AUDIO_BYTES } = require('../server/asr');

const MP3 = Buffer.concat([Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000'), Buffer.alloc(64, 7)]).toString('base64');
const WAV = (() => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.write('data', 36); header.writeUInt32LE(0, 40);
  return Buffer.concat([header, Buffer.alloc(64, 1)]).toString('base64');
})();

test('the adapter sends the documented multimodal request and reads the nested text', async () => {
  const requests = [];
  const adapter = createAsrAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen3-asr-flash' }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return { ok: true, json: async () => ({ output: { choices: [{ message: { content: [{ text: ' 中牟的西瓜栽培技艺 ' }] } }] } }) };
    }
  });
  const result = await adapter.transcribe({ audio: MP3, format: 'mp3', language: 'zh' });
  assert.equal(result.text, '中牟的西瓜栽培技艺');
  assert.equal(requests[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'qwen3-asr-flash');
  // audio 必须是 base64 Data URL；parameters.asr_options 是外层字段，写成顶层不生效。
  assert.equal(body.input.messages[0].content[0].audio, 'data:audio/mpeg;base64,' + MP3);
  assert.deepEqual(body.parameters, { asr_options: { language: 'zh', enable_itn: true } });
  assert.equal(body.asr_options, undefined, 'asr_options must live inside parameters');
});

test('a wav recording is declared with its own media type', async () => {
  let body;
  const adapter = createAsrAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com' }, {
    fetch: async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ output: { choices: [{ message: { content: [{ text: '好' }] } }] } }) }; }
  });
  await adapter.transcribe({ audio: WAV, format: 'wav', language: 'yue' });
  assert.ok(body.input.messages[0].content[0].audio.startsWith('data:audio/wav;base64,'));
  assert.equal(body.parameters.asr_options.language, 'yue');
});

test('no api key disables the adapter and the service says so instead of failing silently', async () => {
  assert.equal(createAsrAdapter(null), null);
  assert.equal(createAsrAdapter({ apiKey: '' }), null);
  const service = createAsrService(null);
  assert.equal(service.inspect().configured, false);
  assert.equal(service.inspect().availability, 'disabled');
  await assert.rejects(service.transcribe({ audio: MP3, format: 'mp3' }), error => {
    assert.equal(error.code, 'asr_disabled');
    assert.equal(error.status, 503);
    assert.match(error.message, /键盘/);
    return true;
  });
});

test('audio payloads are validated before any provider call', async () => {
  let calls = 0;
  const service = createAsrService({ async transcribe() { calls++; return { text: 'x' }; } });
  const bad = [
    [null, 'asr_invalid'],
    [[], 'asr_invalid'],
    [{ audio: MP3, format: 'ogg' }, 'asr_invalid'],
    [{ audio: MP3, format: 'mp3', language: 'fr' }, 'asr_invalid'],
    [{ format: 'mp3' }, 'asr_invalid'],
    [{ audio: '', format: 'mp3' }, 'asr_invalid'],
    [{ audio: 'not base64!!', format: 'mp3' }, 'asr_invalid'],
    [{ audio: Buffer.from('这不是音频，只是一段中文文本占位内容').toString('base64'), format: 'mp3' }, 'asr_invalid']
  ];
  for (const [body, code] of bad) {
    await assert.rejects(service.transcribe(body), error => {
      assert.equal(error.code, code, JSON.stringify(body));
      return true;
    });
  }
  const huge = Buffer.concat([Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000'), Buffer.alloc(MAX_AUDIO_BYTES, 3)]).toString('base64');
  await assert.rejects(service.transcribe({ audio: huge, format: 'mp3' }), error => {
    assert.equal(error.code, 'body_too_large');
    assert.equal(error.status, 413);
    return true;
  });
  assert.equal(calls, 0, 'invalid audio must never reach the provider');
});

test('"heard nothing" and "provider failed" are different errors with different statuses', async () => {
  const quiet = createAsrService({ async transcribe() { return { text: '   ' }; } });
  await assert.rejects(quiet.transcribe({ audio: MP3, format: 'mp3' }), error => {
    assert.equal(error.code, 'asr_empty');
    assert.equal(error.status, 422);
    return true;
  });
  assert.equal(quiet.inspect().availability, 'last-call-succeeded', 'an empty transcript still means the provider answered');

  const broken = createAsrService({ async transcribe() { throw new Error('asr_provider'); } });
  await assert.rejects(broken.transcribe({ audio: MP3, format: 'mp3' }), error => {
    assert.equal(error.code, 'asr_unavailable');
    assert.equal(error.status, 502);
    return true;
  });
  assert.equal(broken.inspect().availability, 'last-call-failed');
  assert.ok(broken.inspect().lastCheckedAt > 0);
});

test('a successful call echoes the language and format back and reports readiness', async () => {
  const service = createAsrService({ async transcribe(input) { assert.equal(input.format, 'wav'); return { text: '好' }; } });
  assert.equal(service.inspect().availability, 'not-checked');
  const result = await service.transcribe({ audio: WAV, format: 'wav', language: 'en' });
  assert.deepEqual(result, { text: '好', language: 'en', format: 'wav' });
  const status = service.inspect();
  assert.equal(status.availability, 'last-call-succeeded');
  assert.equal(status.configured, true);
  // 语言表只保留与本产品相关的三档，避免把 provider 的完整语言清单透出去。
  assert.deepEqual(status.languages, ['zh', 'yue', 'en']);
  assert.equal(status.maxSeconds, 60);
});

test('the adapter reports provider failures instead of returning empty text', async () => {
  const adapter = createAsrAdapter({ apiKey: 'test', baseUrl: 'https://dashscope.aliyuncs.com' }, { fetch: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(adapter.transcribe({ audio: MP3, format: 'mp3', language: 'zh' }), /asr_provider/);
});
