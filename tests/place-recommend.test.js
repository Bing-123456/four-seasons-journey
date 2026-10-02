'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: turn } = require('node:timers/promises');
const { createPlaceRecommendService, validatePlaceBody, buildPlans, parsePlaces } = require('../server/place-recommend');
const SEPTEMBER = Date.parse('2026-09-26T00:00:00Z');
const input = (patch = {}) => ({ fruits: ['柿子'], activity: 'pick', timing: 'soon', requestId: 'request-0001', ...patch });
function output(plans) { return { places: plans.map((plan, index) => ({ fruit: plan.fruit, name: plan.fruit + '山居' + index, intro: plan.canHarvest ? '秋园采摘慢时光' : plan.experience === 'orchard-view' ? '树影之下留一张照片' : '果酱手作留住香甜' })) }; }
const transport = async ({ prompt }) => output(JSON.parse(prompt.user).plans);
const artifacts = { persistFromUrl: async (_, key) => '/artifacts/' + key + '.png' };
const successAdapter = () => ({ create: async ({ requestId }) => requestId, status: async () => ({ status: 'succeeded', imageUrl: 'https://example.test/fruit.png' }) });
function service(adapter = successAdapter(), extra = {}) { return createPlaceRecommendService(adapter, { transport, artifacts, now: () => SEPTEMBER, pollMs: 0, ...extra }); }
async function until(read, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) { const result = await read(); if (predicate(result)) return result; await turn(); }
  throw new Error('Condition did not settle');
}
const done = value => ['succeeded', 'partial', 'failed'].includes(value.status);

test('all questions and bounded identifiers are validated before a model request', () => {
  for (const patch of [{ fruits: [] }, { fruits: ['未知水果'] }, { activity: '' }, { timing: 'yesterday' }, { requestId: 'short' }, { other: true }, { fruits: Array(13).fill('青梅') }]) assert.throws(() => validatePlaceBody(input(patch)));
  assert.deepEqual(validatePlaceBody(input({ fruits: ['青梅', '青梅'] })).fruits, ['青梅']);
});

test('fruits, activity and actual month determine harvest eligibility, priority, alternatives and year rollover', () => {
  const soon = buildPlans(input({ fruits: ['青梅', '柿子', '冬枣', '砂糖橘', '秋梨'] }), SEPTEMBER);
  assert.deepEqual(soon.map(plan => plan.fruit), ['柿子', '冬枣', '秋梨', '青梅']);
  assert.equal(soon[3].canHarvest, false); assert.equal(soon[3].experience, 'fruit-workshop');
  assert.equal(buildPlans(input({ fruits: ['冬枣'], timing: 'next' }), Date.parse('2026-10-26T00:00:00Z'))[0].inSeason, false);
  const january = buildPlans(input({ fruits: ['砂糖橘'], timing: 'next' }), Date.parse('2026-12-26T00:00:00Z'))[0];
  assert.equal(january.month, 1); assert.equal(january.year, 2027); assert.equal(january.canHarvest, true);
  assert.equal(buildPlans(input({ activity: 'photo' }), SEPTEMBER)[0].experience, 'orchard-view');
  assert.equal(buildPlans(input({ fruits: ['青梅'], activity: 'taste' }), SEPTEMBER)[0].experience, 'preserved-taste');
  const unset = buildPlans(input({ timing: 'unset' }), SEPTEMBER)[0];
  assert.equal(unset.month, null); assert.equal(unset.canHarvest, false); assert.equal(unset.experience, 'harvest-planning');
});

test('model schema enforces fruit alignment, short introductions, unique names and no out-of-season harvest claims', () => {
  const plans = buildPlans(input({ fruits: ['青梅'] }), SEPTEMBER);
  assert.throws(() => parsePlaces({ places: [{ fruit: '青梅', name: '溪边梅居', intro: '一二三四五六七八九十一二三四五六' }] }, plans));
  assert.throws(() => parsePlaces({ places: [{ fruit: '青梅', name: '梅园', intro: '当季采摘鲜果' }] }, plans));
  assert.throws(() => parsePlaces({ places: [{ fruit: '青梅', name: '梅园', intro: '预约可来园品尝' }] }, plans));
  assert.throws(() => parsePlaces({ places: [{ fruit: '柿子', name: '梅园', intro: '果酱香甜' }] }, plans));
  assert.throws(() => parsePlaces({ places: [] }, plans));
  const valid = parsePlaces({ places: [{ fruit: '青梅', name: '溪边梅居', intro: '果酱手作留住香甜' }] }, plans);
  assert.equal(valid[0].virtual, true); assert.ok([...valid[0].intro].length <= 15);
});

test('submission returns before model resolution, text arrives before images, then artifacts complete', async () => {
  let resolveText, resolveImage, createCount = 0;
  const svc = service({ create: async () => { createCount += 1; return 'provider-1'; }, status: () => new Promise(resolve => { resolveImage = resolve; }) }, { transport: ({ prompt, task }) => { assert.equal(task, 'place-recommend'); return new Promise(resolve => { resolveText = () => resolve(output(JSON.parse(prompt.user).plans)); }); } });
  const submitted = await svc.submit(input(), 'alice');
  assert.equal(submitted.status, 'queued'); assert.deepEqual(submitted.places, []);
  await turn(); resolveText();
  const withText = await until(() => svc.status(submitted.taskId, 'alice'), value => value.places.length === 1 && typeof resolveImage === 'function');
  assert.equal(withText.status, 'generating-images'); assert.equal(withText.places[0].image, ''); assert.equal(createCount, 1);
  resolveImage({ status: 'succeeded', imageUrl: 'https://example.test/fruit.png' });
  const result = await until(() => svc.status(submitted.taskId, 'alice'), done);
  assert.equal(result.status, 'succeeded'); assert.match(result.places[0].image, /^\/artifacts\//);
});

test('request retries are idempotent, status polling never generates again, and owners are isolated', async () => {
  let calls = 0;
  const svc = service(successAdapter(), { transport: async request => { calls += 1; return transport(request); } });
  const first = await svc.submit(input(), 'alice');
  const repeated = await svc.submit(input(), 'alice');
  assert.equal(first.taskId, repeated.taskId);
  await assert.rejects(svc.status(first.taskId, 'bob'), error => error.status === 404);
  await assert.rejects(svc.retry(first.taskId, { placeId: 'place-1' }, 'bob'), error => error.status === 404);
  await assert.rejects(svc.submit(input({ activity: 'photo' }), 'alice'), error => error.code === 'request_conflict');
  await until(() => svc.status(first.taskId, 'alice'), done);
  for (let i = 0; i < 4; i += 1) await svc.status(first.taskId, 'alice');
  await svc.retry(first.taskId, { placeId: 'place-1' }, 'alice');
  assert.equal(calls, 1);
});

test('failed images remain explicit, single image retry keeps AI text and does not duplicate requests', async () => {
  let creates = 0, modelCalls = 0;
  const svc = service({ create: async () => String(++creates), status: async id => id === '1' ? { status: 'failed' } : { status: 'succeeded', imageUrl: 'https://example.test/image.png' } }, { transport: async request => { modelCalls += 1; return transport(request); } });
  const { taskId } = await svc.submit(input(), 'alice');
  const partial = await until(() => svc.status(taskId, 'alice'), done);
  assert.equal(partial.status, 'partial'); assert.equal(partial.places[0].imageStatus, 'failed'); assert.equal(partial.places[0].image, '');
  await svc.retry(taskId, { placeId: 'place-1' }, 'alice');
  await svc.retry(taskId, { placeId: 'place-1' }, 'alice');
  const finished = await until(() => svc.status(taskId, 'alice'), done);
  assert.equal(finished.status, 'succeeded'); assert.equal(creates, 2); assert.equal(modelCalls, 1);
  assert.equal(finished.places[0].name, partial.places[0].name);
});

test('invalid model content is retried once and never silently replaced by templates', async () => {
  let calls = 0;
  const svc = service(successAdapter(), { transport: async () => { calls += 1; return { places: [] }; } });
  const { taskId } = await svc.submit(input(), 'alice');
  const result = await until(() => svc.status(taskId, 'alice'), done);
  assert.equal(result.status, 'failed'); assert.deepEqual(result.places, []); assert.equal(calls, 2);
  const disabled = service(null, { transport: null });
  await assert.rejects(disabled.submit(input()), error => error.code === 'model_disabled');
});

test('artifact persistence failure is reported, never exposed as a temporary provider URL', async () => {
  const svc = service(successAdapter(), { artifacts: { persistFromUrl: async () => { throw new Error('disk unavailable'); } } });
  const { taskId } = await svc.submit(input(), 'alice');
  const result = await until(() => svc.status(taskId, 'alice'), done);
  assert.equal(result.status, 'partial'); assert.equal(result.places[0].image, ''); assert.equal(result.places[0].imageStatus, 'failed');
});

test('global image concurrency, owner active task limit, bounded jobs and TTL are enforced', async () => {
  let now = SEPTEMBER, active = 0, peak = 0;
  const resolutions = [];
  const svc = service({ create: async ({ requestId }) => requestId, status: async () => { active += 1; peak = Math.max(active, peak); return new Promise(resolve => resolutions.push(() => { active -= 1; resolve({ status: 'succeeded', imageUrl: 'https://example.test/image.png' }); })); } }, { now: () => now, maxJobs: 2, maxActive: 2, ttl: 500 });
  const a = await svc.submit(input({ fruits: ['柿子', '冬枣', '秋梨', '青梅'] }), 'alice');
  await assert.rejects(svc.submit(input({ requestId: 'request-other', activity: 'photo' }), 'alice'), error => error.code === 'task_in_progress');
  const b = await svc.submit(input(), 'bob');
  await assert.rejects(svc.submit(input(), 'carol'), error => error.code === 'server_busy');
  for (let i = 0; i < 10; i += 1) { await turn(); resolutions.splice(0).forEach(resolve => resolve()); }
  await until(() => svc.status(a.taskId, 'alice'), done); await until(() => svc.status(b.taskId, 'bob'), done);
  assert.equal(peak, 2);
  now += 501;
  await assert.rejects(svc.status(a.taskId, 'alice'), error => error.status === 404);
  const next = await svc.submit(input(), 'carol');
  assert.ok(next.taskId); await turn(); resolutions.splice(0).forEach(resolve => resolve());
});

test('HTTP recommendation routes require an anonymous client capability and isolate task owners', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createServer } = require('../server/app');
  const { readConfig } = require('../server/config');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guayouji-place-http-'));
  const server = createServer({ config: { ...readConfig({ PORT: '0' }), provider: 'openai-compatible' }, transport, now: () => SEPTEMBER, bookingFile: path.join(directory, 'bookings.json'), speechDir: path.join(directory, 'speech') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, body, credential) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(credential ? { 'X-Booking-Client': credential } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request('/api/place-recommend', input())).status, 401);
  const alice = (await request('/api/booking-clients', { role: 'visitor' })).body.credential;
  const bob = (await request('/api/booking-clients', { role: 'visitor' })).body.credential;
  const submitted = await request('/api/place-recommend', input(), alice);
  assert.equal(submitted.status, 202); assert.ok(submitted.body.taskId);
  const taskPath = '/api/place-recommend/' + submitted.body.taskId;
  assert.equal((await request(taskPath, undefined, bob)).status, 404);
  const result = await request(taskPath, undefined, alice);
  assert.equal(result.status, 200); assert.equal(result.body.places[0].virtual, true);
  assert.equal(result.body.status, 'partial', 'unconfigured images are explicit while generated text is retained');
  assert.equal((await request(taskPath + '/retry', { placeId: 'place-1' }, bob)).status, 404);
});
