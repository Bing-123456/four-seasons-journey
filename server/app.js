'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { readConfig, isLoopback } = require('./config');
const { createAuth } = require('./auth');
const { createTransport } = require('./provider');
const { createTasks } = require('./tasks');
const { createCompanionService } = require('./companion');
const { createInkPaintingService } = require('./ink-painting');
const { createArtifactStore } = require('./artifacts');
const { createPlaceRecommendService } = require('./place-recommend');
const { createBookingService } = require('./bookings');
const { createSpeechService } = require('./speech');
const { createAsrService } = require('./asr');
const { createChatService } = require('./chat');
const nodeOs = require('node:os');
const nodePath = require('node:path');
const { request: validateRequest, InputError } = require('./validation');

const ROUTES = { '/api/profile': 'profile', '/api/ask': 'ask', '/api/seller-insight': 'sellerInsight', '/api/identify-fruit': 'identifyFruit', '/api/fruit-story': 'fruitStory', '/api/translate': 'translate' };

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      request.resume();
      reject(new InputError('请使用 application/json', 'unsupported_media_type', 415)); return;
    }
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new InputError('请求内容过大', 'body_too_large', 413));
        chunks.length = 0;
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > maxBytes) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new InputError('请求 JSON 无效', 'invalid_json')); }
    });
    request.on('error', () => reject(new InputError('请求中断', 'request_aborted')));
    request.on('aborted', () => reject(new InputError('请求中断', 'request_aborted')));
  });
}

function createServer(options = {}) {
  const config = options.config || readConfig();
  if (!isLoopback(config.host) && (!config.token || config.token.length < 24)) throw new Error('对外监听必须配置至少 24 字符的 API_TOKEN');
  // 双路径兼容：部署包里内置数据在 server/miniprogram/，主项目开发结构在 ../miniprogram/。
  function dualPath(rel) {
    try { return require('./miniprogram/' + rel); } catch (error) { return require('../miniprogram/' + rel); }
  }
  const catalog = options.catalog || dualPath('data/catalog');
  const core = options.core || dualPath('lib/core');
  const transport = options.transport || createTransport(config);
  const tasks = createTasks({ config, catalog, core, transport });
  const artifactDir = process.env.ARTIFACT_DIR || nodePath.join(nodeOs.tmpdir(), 'guayouji-artifacts');
  const artifacts = createArtifactStore(artifactDir);
  const images = createCompanionService(options.imageAdapter, { artifacts });
  const ink = createInkPaintingService(options.inkAdapter, { artifacts });
  const placeRecommend = createPlaceRecommendService(options.inkAdapter, { artifacts, transport: config.provider === 'disabled' ? null : transport, timeoutMs: config.timeoutMs, now: options.now });
  const bookings = createBookingService({ file: options.bookingFile || process.env.BOOKING_DATA_FILE || nodePath.join(nodeOs.tmpdir(), 'guayouji-bookings.json'), now: options.now });
  const speech = createSpeechService(options.speechAdapter, { dir: options.speechDir || nodePath.join(artifactDir, 'speech'), now: options.now });
  speech.purge();
  const asr = createAsrService(options.asrAdapter, { now: options.now });
  const chat = createChatService(config, options.chatFetch || globalThis.fetch);
  const auth = createAuth(config, { now: options.now, onPairingCode: options.onPairingCode });
  const rateWindows = new Map();
  let inFlight = 0;
  let modelStatus = { configured: config.provider !== 'disabled', availability: config.provider === 'disabled' ? 'disabled' : 'not-checked', lastCheckedAt: null };
  const visionConfigured = !!(config.vision && config.vision.apiKey);
  let visionStatus = { configured: visionConfigured, availability: visionConfigured ? 'not-checked' : 'disabled', lastCheckedAt: null, uploadEnabled: visionConfigured, maxImageBytes: 2 * 1024 * 1024 };

  function rateAllowed(request, polling = false) {
    // nginx-facing requests share one socket address; paired sessions retain individual quotas.
    const address = (polling ? 'poll:' : 'submit:') + (auth.required ? createHash('sha256').update(request.headers.authorization || '').digest('hex') : request.socket.remoteAddress || 'unknown');
    const now = Date.now();
    let window = rateWindows.get(address);
    if (!window || now - window.start >= 60000) {
      window = { start: now, count: 0 };
      rateWindows.set(address, window);
    }
    if (rateWindows.size > 1024) {
      for (const [key, value] of rateWindows) if (now - value.start >= 60000) rateWindows.delete(key);
      if (rateWindows.size > 1024) rateWindows.delete(rateWindows.keys().next().value);
    }
    window.count += 1;
    return window.count <= (polling ? 120 : config.requestsPerMinute);
  }

  function requestOrigin(request) {
    const proto = request.headers['x-forwarded-proto'] === 'https' || request.socket.encrypted ? 'https' : 'http';
    const host = String(request.headers.host || 'localhost');
    if (!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.test(host)) throw new InputError('服务地址无效');
    return proto + '://' + host;
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    const origin = request.headers.origin;
    if (origin) {
      let allowed = false;
      try { const url = new URL(origin); allowed = ['http:', 'https:'].includes(url.protocol) && isLoopback(url.hostname); } catch {}
      if (!allowed) { response.writeHead(403); response.end(JSON.stringify({ error: '此来源未获允许', code: 'origin_denied' })); return; }
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Booking-Client');
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    const send = (status, body) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status); response.end(JSON.stringify(body)); } };
    let acquired = false;
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && path === '/health') {
        send(200, { ok: true, provider: config.provider, configured: config.provider !== 'disabled', auth: auth.inspect(request), model: { ...modelStatus }, vision: { ...visionStatus }, image: { ...images.capabilities }, inkPainting: { ...ink.capabilities }, speech: speech.inspect(), asr: asr.inspect(), chat: chat.capabilities, placeRecommend: placeRecommend.capabilities, bookings: { configured: true } }); return;
      }
      if (request.method === 'POST' && path === '/api/pair') {
        const body = await readBody(request, Math.min(config.maxBodyBytes, 512));
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'code')) throw new InputError('配对请求格式无效');
        send(200, auth.pair(body.code, request.socket.remoteAddress || 'unknown')); return;
      }
      if (/^\/api\/(booking-clients|booking-activities|booking-summary|bookings)(\/|$)/.test(path)) {
        if (!auth.inspect(request).authenticated) throw new InputError('服务连接已过期', 'unauthorized', 401);
        if (!rateAllowed(request, request.method === 'GET')) throw new InputError('请求过于频繁', 'rate_limited', 429);
        const result = bookings.dispatch({ method: request.method, path, credential: request.headers['x-booking-client'], body: request.method === 'POST' ? await readBody(request, 8192) : undefined, query: Object.fromEntries(new URL(request.url, 'http://localhost').searchParams) });
        send(result.status, result.body); return;
      }
      if (path === '/api/place-recommend' || path.startsWith('/api/place-recommend/')) {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('开发会话未配对或已过期', 'unauthorized', 401); }
        if (!rateAllowed(request, request.method === 'GET')) throw new InputError('请求过于频繁', 'rate_limited', 429);
        const client = bookings.authenticate(request.headers['x-booking-client']);
        const owner = client.id;
        const task = path.match(/^\/api\/place-recommend\/([a-f0-9-]{36})(\/retry)?$/);
        if (request.method === 'POST' && path === '/api/place-recommend') { send(202, await placeRecommend.submit(await readBody(request, 2048), owner)); return; }
        if (task && !task[2] && request.method === 'GET') { send(200, await placeRecommend.status(task[1], owner)); return; }
        if (task && task[2] && request.method === 'POST') { send(202, await placeRecommend.retry(task[1], await readBody(request, 2048), owner)); return; }
        throw new InputError('推荐接口不存在', 'not_found', 404);
      }
      if (path === '/api/speech' && request.method === 'POST') {
        if (!auth.inspect(request).authenticated) throw new InputError('服务连接已过期', 'unauthorized', 401);
        if (!rateAllowed(request)) throw new InputError('请求过于频繁', 'rate_limited', 429);
        const result = await speech.submit(await readBody(request, 8192));
        send(result.status === 'succeeded' ? 200 : 202, result); return;
      }
      const speechTask = path.match(/^\/api\/speech\/([a-f0-9-]{36})$/);
      if (speechTask && request.method === 'GET') {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('服务连接已过期', 'unauthorized', 401); }
        if (!rateAllowed(request, true)) throw new InputError('请求过于频繁', 'rate_limited', 429);
        send(200, await speech.status(speechTask[1])); return;
      }
      if (path === '/api/asr' && request.method === 'POST') {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('服务连接已过期', 'unauthorized', 401); }
        if (!rateAllowed(request)) throw new InputError('请求过于频繁', 'rate_limited', 429);
        // 录音走 base64 JSON（wx.request 可直接发），上限 3 MB：
        // 解码后音频 ≤ 1.5 MB，1.5 MB 的 base64 约 2.0 MB，余量约 1 MB。
        send(200, await asr.transcribe(await readBody(request, 3 * 1024 * 1024))); return;
      }
      if (path === '/api/chat' && request.method === 'POST') {
        if (!auth.inspect(request).authenticated) throw new InputError('服务连接已过期', 'unauthorized', 401);
        if (!rateAllowed(request)) throw new InputError('请求过于频繁', 'rate_limited', 429);
        send(200, await chat.answer(await readBody(request, 24576))); return;
      }
      const audioFile = path.match(/^\/speech\/([a-f0-9]{64}\.(?:mp3|wav))$/);
      if (audioFile && request.method === 'GET') {
        const audio = await speech.read(audioFile[1]);
        if (!audio) throw new InputError('音频已过期，请重新朗读', 'not_found', 404);
        response.setHeader('content-type', audio.contentType); response.setHeader('cache-control', 'public, max-age=86400');
        response.writeHead(200); response.end(audio.bytes); return;
      }
      if (path === '/api/ink-painting' && request.method === 'POST') {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('开发会话未配对或已过期', 'unauthorized', 401); }
        if (!rateAllowed(request)) throw new InputError('请求过于频繁', 'rate_limited', 429);
        if (inFlight >= config.maxConcurrent) throw new InputError('图片服务忙', 'server_busy', 503);
        inFlight += 1; acquired = true;
        const body = await readBody(request, 2048);
        send(202, await ink.submit(body, images.owner(request))); return;
      }
      const artifactFile = path.match(/^\/artifacts\/([a-z0-9-]{6,80}\.png)$/);
      if (artifactFile && request.method === 'GET') {
        const artifact = await artifacts.read(artifactFile[1]);
        if (!artifact) { send(404, { error: '文件不存在或已过期', code: 'not_found' }); return; }
        response.setHeader('content-type', artifact.contentType);
        response.setHeader('cache-control', 'public, max-age=86400');
        if (!response.destroyed && !response.writableEnded) { response.writeHead(200); response.end(artifact.bytes); }
        return;
      }
      const inkTask = path.match(/^\/api\/ink-painting\/([a-f0-9-]{36})$/);
      if (inkTask && request.method === 'GET') {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('开发会话未配对或已过期', 'unauthorized', 401); }
        if (!rateAllowed(request, true)) throw new InputError('查询过于频繁', 'rate_limited', 429);
        if (inFlight >= config.maxConcurrent) throw new InputError('图片服务忙', 'server_busy', 503);
        inFlight += 1; acquired = true;
        send(200, await ink.status(inkTask[1], images.owner(request), requestOrigin(request))); return;
      }
      if (path.startsWith('/api/companion/')) {
        if (!auth.inspect(request).authenticated) { request.resume(); throw new InputError('开发会话未配对或已过期', 'unauthorized', 401); }
        // Reject before decoding or persisting image bytes when disabled.
        if (!images.capabilities.configured) { request.resume(); images.ready(); }
        if (!rateAllowed(request, request.method === 'GET')) throw new InputError('请求过于频繁', 'rate_limited', 429);
        const owner = images.owner(request);
        const task = path.match(/^\/api\/companion\/generations\/([a-f0-9-]{36})$/);
        if (request.method === 'GET' && task) {
          if (inFlight >= config.maxConcurrent) throw new InputError('图片服务忙', 'server_busy', 503);
          inFlight += 1; acquired = true;
          send(200, await images.status(task[1], owner, requestOrigin(request))); return;
        }
        if (request.method !== 'POST') throw new InputError('接口方法不支持', 'method_not_allowed', 405);
        if (!['/api/companion/uploads', '/api/companion/generations'].includes(path)) throw new InputError('接口不存在', 'not_found', 404);
        if (inFlight >= config.maxConcurrent) throw new InputError('图片服务忙', 'server_busy', 503);
        inFlight += 1; acquired = true;
        const body = await readBody(request, path.endsWith('/uploads') ? 3 * 1024 * 1024 : 2048);
        send(202, path.endsWith('/uploads') ? await images.upload(body, owner) : await images.generate(body, owner)); return;
      }
      if (!ROUTES[path]) throw new InputError('接口不存在', 'not_found', 404);
      if (request.method !== 'POST') throw new InputError('请使用 POST', 'method_not_allowed', 405);
      if (!auth.inspect(request).authenticated) throw new InputError('开发会话未配对或已过期，请重新配对', 'unauthorized', 401);
      if (!rateAllowed(request)) { response.setHeader('retry-after', '60'); throw new InputError('请求过于频繁，请稍后重试', 'rate_limited', 429); }
      if (inFlight >= config.maxConcurrent) throw new InputError('模型服务忙，请稍后重试', 'server_busy', 503);
      inFlight += 1;
      acquired = true;
      const body = await readBody(request, path === '/api/identify-fruit' ? 3 * 1024 * 1024 : config.maxBodyBytes);
      const input = validateRequest(path, body, catalog);
      if (path === '/api/seller-insight') {
        // Never trust locally fabricated visitor counts as reservations.
        input.tourism = request.headers['x-booking-client'] && input.batch.id ? bookings.summary(request.headers['x-booking-client'], input.batch.id) : { available: false, source: 'no-booking-identity', totalTrips: 0, totalParties: 0, top: [] };
      }
      const result = await tasks.run(ROUTES[path], input);
      if (ROUTES[path] === 'identifyFruit') {
        if (result.mode === 'openai-compatible') visionStatus = { ...visionStatus, availability: 'last-call-succeeded', lastCheckedAt: Date.now() };
        else if (visionConfigured && result.fallbackReason) visionStatus = { ...visionStatus, availability: 'last-call-failed', lastCheckedAt: Date.now() };
      } else if (result.mode === 'openai-compatible') modelStatus = { configured: true, availability: 'last-call-succeeded', lastCheckedAt: Date.now() };
      else if (config.provider !== 'disabled' && result.fallbackReason) modelStatus = { configured: true, availability: 'last-call-failed', lastCheckedAt: Date.now() };
      send(200, result);
    } catch (error) {
      request.resume();
      if (error instanceof InputError && error.status === 429) response.setHeader('retry-after', '60');
      send(error instanceof InputError ? error.status : 500, {
        error: error instanceof InputError ? error.message : '服务暂时不可用',
        code: error instanceof InputError ? error.code : 'internal_error'
      });
    } finally { if (acquired) inFlight -= 1; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.once('listening', () => auth.rotate());
  return server;
}

module.exports = { createServer };
