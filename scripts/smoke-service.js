'use strict';
// Explicit live acceptance: uses configured provider quota and public bundled fruit photos.
// Run on the server with --server-env to load its private admin token without printing it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.cwd();
if (process.argv.includes('--server-env')) require(path.join(root, 'server/env')).loadEnv(path.join(root, '.env'));
const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const url = new URL(base);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Use HTTPS or a local proxy');
const headers = { 'content-type': 'application/json' };
if (process.env.API_TOKEN) headers.authorization = 'Bearer ' + process.env.API_TOKEN;
const report = { startedAt: new Date().toISOString(), base, tests: [] };
async function call(endpoint, body) {
  const response = await fetch(base + endpoint, { method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(50000) });
  const data = await response.json();
  assert.ok(response.ok, endpoint + ': HTTP ' + response.status + ' ' + (data.code || ''));
  return data;
}
async function check(name, action) {
  const start = Date.now();
  try { report.tests.push({ name, passed: true, ...await action(), elapsedMs: Date.now() - start }); }
  catch (error) { report.tests.push({ name, passed: false, error: error.message, elapsedMs: Date.now() - start }); }
  console.log(JSON.stringify(report.tests.at(-1)));
}
async function cloud(endpoint, input) {
  const result = await call('/api/' + endpoint, input);
  assert.equal(result.mode, 'openai-compatible', endpoint + ': fallback ' + (result.fallbackReason || result.mode));
  assert.equal(result.fallbackReason, undefined);
  return result;
}
async function poll(endpoint, taskId) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const state = await call(endpoint + '/' + encodeURIComponent(taskId));
    if (state.status === 'failed') throw Error(state.message || 'Image task failed');
    if (state.status === 'succeeded') {
      assert.match(state.imageUrl, /^https:\/\//);
      const image = await fetch(state.imageUrl, { signal: AbortSignal.timeout(20000) });
      assert.equal(image.status, 200, 'Result image must be downloadable');
      const bytes = (await image.arrayBuffer()).byteLength;
      assert.ok(bytes > 1000);
      return { status: state.status, downloadable: true, imageBytes: bytes };
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw Error('Image task exceeded 150 seconds');
}
(async () => {
  await check('health-authenticated', async () => {
    const h = await call('/health'); assert.equal(h.auth.authenticated, true);
    return { model: h.model.configured, vision: h.vision.configured, image: h.image.configured, ink: h.inkPainting.configured, speech: h.speech.configured, asr: h.asr.configured };
  });
  await check('profile', async () => {
    const r = await cloud('profile', { text: '3个人自驾，2026年10月2日9点出发，游玩4小时，总预算300元，喜欢历史文化' });
    assert.equal(r.profile.partySize, 3); assert.equal(r.profile.budget, 300); return { mode: r.mode };
  });
  await check('grounded-ask', async () => {
    const r = await cloud('ask', { question: '西瓜栽培技艺是哪个级别的非遗？', placeId: 'summer-culture' });
    assert.equal(r.unanswerable, false); assert.ok(r.evidenceIds.includes('f-watermelon-heritage')); return { mode: r.mode };
  });
  await check('fruit-story', async () => { const r = await cloud('fruit-story', { keyword: '苹果', language: 'zh' }); return { mode: r.mode }; });
  await check('translate', async () => { const r = await cloud('translate', { blocks: ['秋天的苹果熟了。'], target: 'en' }); assert.equal(r.items.length, 1); assert.equal(r.translated, true); return { mode: r.mode }; });
  await check('seller-insight', async () => {
    const r = await cloud('seller-insight', {
      batch: { name: '接口验收样例', crop: '苹果', region: ['河南省','郑州市','中牟县'], areaMu: 1, harvestStart: '2026-09-25', harvestEnd: '2026-09-30', deadline: '2026-10-01', reception: { enabled: true, capacity: 10, staff: 2 } },
      risk: { status: 'attention', label: '需要关注', windowDays: 7, remainingKg: 30, supplyKg: 100, expectedSalesKg: 70, pendingKg: 0 },
      weather: { available: false }, tourism: { totalTrips: 0, totalParties: 0 }, culture: [], limits: { maxCapacity: 10, maxBudget: 300 }
    }); assert.equal(r.status, 'attention'); assert.ok(r.planSteps.length >= 3); return { mode: r.mode };
  });
  const photo = { mimeType: 'image/jpeg', base64: fs.readFileSync(path.join(root, 'miniprogram/assets/lingbao-apple-real.jpg')).toString('base64') };
  await check('identify-fruit', async () => { const r = await cloud('identify-fruit', photo); assert.equal(r.identified, true); assert.equal(r.fruit, '苹果'); return { fruit: r.fruit, mode: r.mode }; });
  await check('ink-painting-complete', async () => { const r = await call('/api/ink-painting', { keyword: '霜降摘柿' }); return poll('/api/ink-painting', r.taskId); });
  await check('companion-photo-complete', async () => {
    const upload = await call('/api/companion/uploads', { ...photo, confirmed: true });
    const r = await call('/api/companion/generations', { resourceId: upload.resourceId, style: 'fruit-line-art', requestId: 'smoke-' + Date.now() });
    return poll('/api/companion/generations', r.taskId);
  });
  report.finishedAt = new Date().toISOString(); report.passed = report.tests.every(t => t.passed);
  const output = process.env.SMOKE_REPORT || path.join(root, 'test-results/service-smoke.json');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.passed ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
