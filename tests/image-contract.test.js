'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { createServer } = require('../server/app'); const { readConfig } = require('../server/config');
const { createCompanionService } = require('../server/companion');
const { createClient } = require('../miniprogram/lib/companion-api');
test('production image endpoints disabled before receiving uploads; text health independent', async t => {
  const server = createServer({ config: readConfig({ PORT: '0' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const health = await (await fetch(base + '/health')).json(); assert.equal(health.image.configured, false); assert.equal(health.image.uploadEnabled, false);
  for (const endpoint of ['/api/companion/uploads', '/api/companion/generations']) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'not an accepted photo' });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'image_provider_disabled');
  }
});
test('test adapter enforces ownership, consent, image type, idempotency and real job states', async () => {
  let calls = 0, stage = 'queued';
  const service = createCompanionService({ upload: async () => 'private-reference', create: async () => { calls++; return 'provider-job'; }, status: async () => ({ status: stage, imageUrl: 'https://example.com/fruit.png' }) });
  const image = { confirmed: true, mimeType: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') };
  await assert.rejects(service.upload({ ...image, confirmed: false }, 'a'));
  await assert.rejects(service.upload({ ...image, mimeType: 'image/jpeg' }, 'a'));
  const upload = await service.upload(image, 'a');
  const body = { resourceId: upload.resourceId, style: 'fruit-line-art', requestId: 'test-request-1' };
  await assert.rejects(service.generate(body, 'b'), /不存在/);
  const job = await service.generate(body, 'a'); assert.equal(job.status, 'queued');
  assert.equal((await service.generate(body, 'a')).taskId, job.taskId); assert.equal(calls, 1);
  for (const status of ['queued', 'generating', 'succeeded']) { stage = status; assert.equal((await service.status(job.taskId, 'a')).status, status); }
  stage = 'failed';
  assert.equal((await service.status(job.taskId, 'a')).status, 'succeeded', 'a completed result survives a later provider outage');
  await assert.rejects(service.status(job.taskId, 'b'), /不存在/);
});
test('unconfigured and demo clients produce zero uploads and zero fake tasks', async () => {
  let calls = 0; const transport = async () => { calls++; };
  for (const options of [{ transport }, { transport, enabled: true, isDemo: () => true }]) {
    const client = createClient(options); assert.equal((await client.generate({}, true, 'test')).status, 'disabled');
    assert.equal(client.state().taskId, null); await client.poll();
  }
  assert.equal(calls, 0);
});
test('client exercises future upload confirmation, queued/generating/success/error without production simulator', async () => {
  let status = 'generating'; const calls = [];
  const client = createClient({ enabled: true, transport: async (method, url) => { calls.push(url); if (url.endsWith('/uploads')) return { resourceId: 'resource' }; if (method === 'POST') return { taskId: 'task', status: 'queued' }; return { status, imageUrl: 'https://example.com/fruit.png' }; } });
  assert.equal((await client.generate({}, false, 'test')).status, 'awaiting-confirmation'); assert.equal(calls.length, 0);
  assert.equal((await client.generate({}, true, 'test')).status, 'queued'); assert.equal((await client.poll()).status, 'generating');
  status = 'succeeded'; assert.equal((await client.poll()).status, 'succeeded'); client.clear(); assert.equal(client.state().taskId, null);
  const broken = createClient({ enabled: true, transport: async () => { throw Error('timeout'); } });
  assert.equal((await broken.generate({}, true, 'test')).status, 'failed');
});

test('late image response after mode switch clears busy state and cannot create a task', async () => {
  let demo = false, finish, calls = 0;
  const client = createClient({ enabled: true, isDemo: () => demo, transport: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = client.generate({}, true, 'test-request'); demo = true; finish({ resourceId: 'r' });
  assert.equal((await pending).status, 'disabled'); assert.equal(calls, 1); assert.equal(client.state().taskId, null);
});
test('idempotent completed task can be polled for the saved result', async () => {
  const client = createClient({ enabled: true, transport: async (method, path) => path.endsWith('/uploads') ? { resourceId: 'r' } : method === 'POST' ? { taskId: 't', status: 'succeeded' } : { status: 'succeeded', imageUrl: 'https://example.com/a.png' } });
  assert.equal((await client.generate({}, true, 'test-request')).status, 'generating');
  assert.equal((await client.poll()).status, 'succeeded');
});
