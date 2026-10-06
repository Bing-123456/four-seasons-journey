'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile, rename, stat, readdir, unlink } = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { InputError } = require('./validation');

// Provider-documented system voices; dialects are synthesized, never relabeled Mandarin.
// 2026-10-02：qwen3-tts-flash 免费额度耗尽，全部方言统一切换 cosyvoice-v3-flash（同一把 DashScope key）。
// 方言指令必须用固定格式「请用X话表达。」，X ∈ 官方支持列表（河南话/东北话/上海话/四川话/广东话…）。
const VOICES = Object.freeze({
  mandarin: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3' },
  henan: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', instruction: '请用河南话表达。' },
  dongbei: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', instruction: '请用东北话表达。' },
  shanghai: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', instruction: '请用上海话表达。' },
  sichuan: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', instruction: '请用四川话表达。' },
  cantonese: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', instruction: '请用广东话表达。' },
  english: { model: 'cosyvoice-v3-flash', voice: 'longanhuan_v3', language_hints: ['en'] }
});
const LIMIT = 12 * 1024 * 1024;
const MAX_AGE = 7 * 86400000;
const FILE = /^[a-f0-9]{64}\.(wav|mp3)$/;
async function boundedBytes(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) throw new Error('speech_download');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > LIMIT) throw new Error('speech_size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// DashScope streams WAV with placeholder chunk sizes (0x7fffffff…). Mobile
// players (WeChat InnerAudioContext on iOS) read the data-chunk size to plan
// playback and stay silent on such files. Rewrite both sizes with the real
// byte counts; leave anything we cannot parse untouched.
function finalizeWavHeader(bytes) {
  let offset = 12, dataPos = -1;
  while (offset + 8 <= bytes.length) {
    if (bytes.toString('ascii', offset, offset + 4) === 'data') { dataPos = offset + 8; break; }
    const size = bytes.readUInt32LE(offset + 4);
    if (!size || size > bytes.length) break;
    offset += 8 + size + (size & 1);
  }
  if (dataPos !== -1 && dataPos < bytes.length) {
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.writeUInt32LE(bytes.length - dataPos, dataPos - 4);
  }
  return bytes;
}

// qwen3-tts-flash 返回 24kHz PCM WAV，部分真机（尤其 iOS）解码失败。
// 在云托管容器里用 ffmpeg 转码成 MP3；如果 ffmpeg 不可用（测试环境）则回退 WAV。
async function wavToMp3(wavBytes) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 'mp3', '-acodec', 'libmp3lame', '-b:a', '128k', '-ar', '24000', '-ac', '1', 'pipe:1']);
    const chunks = [];
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', code => {
      if (code !== 0) return reject(new Error('mp3_encode_failed'));
      const mp3 = Buffer.concat(chunks);
      if (!mp3.length) return reject(new Error('mp3_empty'));
      resolve(mp3);
    });
    ffmpeg.on('error', reject);
    ffmpeg.stdin.write(wavBytes);
    ffmpeg.stdin.end();
  });
}

function createSpeechAdapter(config, options = {}) {
  if (!config || !config.apiKey) return null;
  const fetcher = options.fetch || fetch;
  const Socket = options.WebSocket || WebSocket;
  const voices = options.voices || VOICES;
  async function qwen(text, voice) {
    const signal = AbortSignal.timeout(config.timeoutMs || 40000);
    const response = await fetcher(config.baseUrl + '/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST', headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model: voice.model, input: { text, voice: voice.voice, language_type: voice.language_type } }), signal
    });
    if (!response.ok) throw new Error('speech_provider');
    const result = await response.json();
    const url = new URL(result.output?.audio?.url || 'invalid:');
    if (!['https:', 'http:'].includes(url.protocol) || !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new Error('speech_url');
    // DashScope can return an HTTP OSS URL; fetch the same signed resource over TLS.
    url.protocol = 'https:';
    const bytes = await boundedBytes(await fetcher(url, { signal, redirect: 'error' }));
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('speech_format');
    const wav = finalizeWavHeader(bytes);
    try { const mp3 = await wavToMp3(wav); return { bytes: mp3, format: 'mp3' }; }
    catch { return { bytes: wav, format: 'wav' }; }
  }
  function cosy(text, voice) {
    return new Promise((resolve, reject) => {
      const id = randomUUID(), chunks = []; let total = 0, done = false, started = false;
      const socket = new Socket(config.socketUrl || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', { headers: { Authorization: 'Bearer ' + config.apiKey }, maxPayload: LIMIT });
      const finish = (error) => {
        if (done) return;
        done = true; clearTimeout(timer); socket.terminate();
        if (error) reject(error); else resolve({ bytes: Buffer.concat(chunks), format: 'mp3' });
      };
      const timer = setTimeout(() => finish(new Error('speech_timeout')), config.timeoutMs || 40000);
      const send = (action, payload) => socket.send(JSON.stringify({ header: { action, task_id: id, streaming: 'duplex' }, payload }));
      socket.on('open', () => send('run-task', { task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: voice.model,
        parameters: { text_type: 'PlainText', voice: voice.voice, format: 'mp3', sample_rate: 24000, bit_rate: 128, ...(voice.instruction ? { instruction: voice.instruction } : {}), ...(voice.language_hints ? { language_hints: voice.language_hints } : {}) }, input: {} }));
      socket.on('message', (data, binary) => {
        if (done) return;
        if (binary) { total += data.length; if (total > LIMIT) return finish(new Error('speech_size')); chunks.push(Buffer.from(data)); return; }
        try {
          const event = JSON.parse(data.toString());
          if (event.header?.event === 'task-started' && !started) { started = true; send('continue-task', { input: { text } }); send('finish-task', { input: {} }); }
          if (event.header?.event === 'task-failed') finish(new Error('speech_provider'));
          if (event.header?.event === 'task-finished') finish(total ? null : new Error('speech_empty'));
        } catch { finish(new Error('speech_protocol')); }
      });
      socket.on('error', () => finish(new Error('speech_connection')));
      socket.on('close', () => { if (!done) finish(new Error('speech_incomplete')); });
    });
  }
  // websocket 偶发 task-failed/超时：cosyvoice 合成失败自动重试一次，避免用户端直接报「生成未完成」。
  return { synthesize: async (text, dialect) => {
    const voice = voices[dialect];
    if (!voice.model.startsWith('cosy')) return qwen(text, voice);
    try { return await cosy(text, voice); } catch (first) {
      try { return await cosy(text, voice); } catch { throw first; }
    }
  } };
}

function createSpeechService(adapter, { dir, now = Date.now } = {}) {
  const pending = new Map(); let checked = null, availability = adapter ? 'not-checked' : 'disabled';
  const MAX_JOBS = 100; const JOB_TTL = 30 * 60 * 1000;
  const jobs = new Map();
  async function read(name) {
    if (!FILE.test(name)) return null;
    try { const full = path.join(dir, name); if (now() - (await stat(full)).mtimeMs > MAX_AGE) return null;
      return { bytes: await readFile(full), contentType: name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' };
    } catch { return null; }
  }
  function validate(body) {
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1200 || !Object.hasOwn(VOICES, body.dialect)) throw new InputError('朗读文本或语言无效', 'speech_invalid');
    if (!adapter) throw new InputError('朗读服务尚未配置', 'speech_disabled', 503);
    const text = body.text.trim(), voice = VOICES[body.dialect];
    const key = createHash('sha256').update(JSON.stringify([voice, text])).digest('hex');
    const format = voice.model.startsWith('cosy') ? 'mp3' : 'wav', name = key + '.' + format;
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    return { text, voice, key, format, name, contentType, dialect: body.dialect };
  }
  async function synthesize(body) {
    const ctx = validate(body);
    const cached = await read(ctx.name);
    if (cached) return { audioUrl: '/speech/' + ctx.name, dialect: ctx.dialect, cached: true, contentType: ctx.contentType };
    if (pending.has(ctx.key)) return pending.get(ctx.key);
    if (pending.size >= 2) throw new InputError('朗读服务繁忙，请稍后再试', 'speech_busy', 503);
    const job = (async () => {
      try {
        const result = await adapter.synthesize(ctx.text, ctx.dialect);
        if (!Buffer.isBuffer(result.bytes) || !result.bytes.length || result.bytes.length > LIMIT || result.format !== ctx.format) throw new Error('speech_invalid_audio');
        await mkdir(dir, { recursive: true });
        const temp = path.join(dir, ctx.key + '.tmp');
        await writeFile(temp, result.bytes, { mode: 0o600 }); await rename(temp, path.join(dir, ctx.name));
        checked = now(); availability = 'last-call-succeeded';
        return { audioUrl: '/speech/' + ctx.name, dialect: ctx.dialect, cached: false, contentType: ctx.contentType };
      } catch { checked = now(); availability = 'last-call-failed'; throw new InputError('语音生成暂未完成，请稍后重试', 'speech_unavailable', 502); }
      finally { pending.delete(ctx.key); }
    })();
    pending.set(ctx.key, job); return job;
  }
  function purgeJobs() {
    const deadline = now();
    for (const [id, job] of jobs) if (job.expiresAt <= deadline) jobs.delete(id);
  }
  async function runJob(id, ctx) {
    try {
      const cached = await read(ctx.name);
      if (cached) {
        jobs.get(id).status = 'succeeded';
        jobs.get(id).result = { taskId: id, status: 'succeeded', audioUrl: '/speech/' + ctx.name, dialect: ctx.dialect, cached: true, contentType: ctx.contentType };
        return;
      }
      if (pending.has(ctx.key)) {
        const result = await pending.get(ctx.key);
        jobs.get(id).status = 'succeeded';
        jobs.get(id).result = { taskId: id, status: 'succeeded', ...result };
        return;
      }
      const result = await synthesize({ text: ctx.text, dialect: ctx.dialect });
      jobs.get(id).status = 'succeeded';
      jobs.get(id).result = { taskId: id, status: 'succeeded', ...result };
    } catch (error) {
      const job = jobs.get(id); if (!job) return;
      job.status = 'failed';
      job.result = { taskId: id, status: 'failed', message: error.message || '语音生成暂未完成，请稍后重试' };
    }
  }
  async function submit(body) {
    const ctx = validate(body);
    const cached = await read(ctx.name);
    if (cached) return { taskId: ctx.key, status: 'succeeded', audioUrl: '/speech/' + ctx.name, dialect: ctx.dialect, cached: true, contentType: ctx.contentType };
    purgeJobs();
    if (jobs.size >= MAX_JOBS) throw new InputError('朗读任务已满，请稍后重试', 'server_busy', 503);
    const id = randomUUID();
    jobs.set(id, { id, ctx, status: 'queued', expiresAt: now() + JOB_TTL, result: null });
    runJob(id, ctx);
    return { taskId: id, status: 'queued' };
  }
  async function status(id) {
    purgeJobs();
    const job = jobs.get(id);
    if (!job) {
      // 任务已过期但音频可能已落盘：用 key 反查拿不到方言，这里只保证在 TTL 内轮询可用。
      throw new InputError('朗读任务不存在或已过期', 'not_found', 404);
    }
    if (job.result) return { ...job.result };
    return { taskId: id, status: job.status };
  }
  async function purge() {
    try { for (const name of await readdir(dir)) if (FILE.test(name) && now() - (await stat(path.join(dir, name))).mtimeMs > MAX_AGE) await unlink(path.join(dir, name)); } catch {}
  }
  return { synthesize, submit, status, read, purge, inspect: () => ({ configured: !!adapter, availability, lastCheckedAt: checked, dialects: Object.keys(VOICES) }) };
}
module.exports = { createSpeechAdapter, createSpeechService, VOICES };
