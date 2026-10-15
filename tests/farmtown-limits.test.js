'use strict';
// 果乡资料字段上限放宽 + 失败原因可机器读的回执（2026-10-16）。
// 背景：名称 ≤20 字 / 水果 ≤10 字 / 介绍 ≤200 字 把英文果农挡在门外 ——
// 「Sunny Hill Fruit Farm」21 字、「Luochuan Wang Family Apple Orchard」34 字都发不出去，
// 而页面只弹一句通用的「发布失败」，果农不知道要改哪一栏。
// 这份测试盯住两件事：
//   ① 上限放宽到 60 / 30 / 600（只放宽不收紧：老字面值照旧能过、老数据照旧读得回）；
//   ② 超限/缺字段的 400 响应在原有 error 文案（一字不改）与 code 之外，多带 field / max / reason，
//      其余错误（省份过长这类没点名 field 的、404 / 403 / 容量）照旧往上抛，改动面不外溢。
// 桩与 tests/farmtown.test.js 同一套（真 SDK 签名：doc(id).set 是 upsert、不接受 _id）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFarmtownService } = require('../server/farmtown');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');

// 本文件全程不碰真实云环境：显式清掉可能存在的 TCB_* / 数据文件环境变量，数据库一律用 stub。
delete process.env.TCB_ENV_ID;
delete process.env.TCB_ACCESS_KEY;
delete process.env.FARMTWON_DATA_FILE;

const DB = { sdk: null, envId: 'env-test', accessKey: 'ak-test' };

function createSdkStub() {
  const docs = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const readAll = () => Array.from(docs.entries())
    .map(([id, doc]) => Object.assign({ _id: id }, clone(doc)))
    .sort((a, b) => (Number(a.storedAt) || 0) - (Number(b.storedAt) || 0));
  function queryOf(filter) {
    const q = {
      orderBy: () => q,
      limit: () => q,
      get: async () => ({ data: readAll().filter(row => !filter || Object.keys(filter).every(key => row[key] === filter[key])) })
    };
    return q;
  }
  const collection = {
    doc: id => ({
      set: async data => {
        if (data && Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('不能更新_id的值');
        docs.set(id, clone(data));
        return { updated: 1, upsertedId: id };
      },
      get: async () => ({ data: docs.has(id) ? [Object.assign({ _id: id }, clone(docs.get(id)))] : [] })
    }),
    orderBy: () => queryOf(null),
    limit: () => queryOf(null),
    where: filter => queryOf(filter),
    get: async () => queryOf(null).get()
  };
  const app = { database: () => ({ collection: () => collection, createCollection: async () => {} }) };
  return { sdk: { init: () => app }, docs: docs };
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* 清理失败不影响结论 */ } });
  return dir;
}

function service(t, prefix, stub) {
  return createFarmtownService(Object.assign({ file: path.join(tempDir(t, prefix), 'store.json') }, DB, { sdk: stub.sdk }));
}

const TOWN_BODY = {
  name: '山东莱阳 · 老张梨园', province: '山东', city: '烟台市', county: '莱阳市', fruit: '梨',
  experiences: ['采摘', '观光'], description: '老梨园三十年树龄，秋分后采摘，鸭梨脆甜多汁。',
  address: '莱阳市照旺庄镇老张梨园', openDate: '2026-09-01', openTime: '08:00',
  closeDate: '2026-10-20', closeTime: '18:00', wechat: 'laozhang', phone: '13800000000',
  location: { latitude: 36.97, longitude: 120.71 }
};
const body = patch => Object.assign({}, TOWN_BODY, patch);

async function create(svc, patch, owner) {
  return svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: body(patch), owner: owner || 'token-a' });
}

// ---- ① 上限：新口径内的最大值照收，超一格就拒 ----

test('上限放宽到 60 / 30 / 600：新口径内的最大值照收（英文店名也进得来了）', async t => {
  const svc = service(t, 'farmtown-max-ok-', createSdkStub());
  const ok = await create(svc, {
    name: 'N'.repeat(60), fruit: 'F'.repeat(30), description: 'D'.repeat(600)
  }, 'token-a');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.town.name.length, 60);
  assert.equal(ok.body.town.fruit.length, 30);
  assert.equal(ok.body.town.description.length, 600);

  // 「旧口径放不下、新口径放得下」的真实英文样本：这 3 个字面值原来一个都发不出去。
  const english = await create(svc, {
    name: 'Sunny Hill Fruit Farm', fruit: 'Apples and pears', description: 'A family orchard on the sunny hill, third generation.'
  }, 'token-b');
  assert.equal(english.status, 200, '21 字的英文店名必须过');
  assert.equal((await create(svc, { name: 'Luochuan Wang Family Apple Orchard' }, 'token-c')).status, 200, '34 字的英文店名必须过');
});

test('超一格被拒：60 / 30 / 600 之外一格返回 400，error 文案仍是原来那句、另带 field 与 max', async t => {
  const svc = service(t, 'farmtown-max-bad-', createSdkStub());

  const name = await create(svc, { name: 'N'.repeat(61) }, 'token-a');
  assert.deepEqual(name, { status: 400, body: {
    error: '果乡名称过长（最多 60 字）', code: 'invalid_farmtown', field: 'name', max: 60, reason: 'too_long'
  } });

  const fruit = await create(svc, { fruit: 'F'.repeat(31) }, 'token-b');
  assert.deepEqual(fruit, { status: 400, body: {
    error: '当季水果过长（最多 30 字）', code: 'invalid_farmtown', field: 'fruit', max: 30, reason: 'too_long'
  } });

  const description = await create(svc, { description: 'D'.repeat(601) }, 'token-c');
  assert.deepEqual(description, { status: 400, body: {
    error: '果乡介绍过长（最多 600 字）', code: 'invalid_farmtown', field: 'description', max: 600, reason: 'too_long'
  } });
});

test('缺字段也带 field 与 reason=required，文案照旧是「未填写或过长」那句', async t => {
  const svc = service(t, 'farmtown-required-', createSdkStub());
  const missing = await create(svc, { name: '   ' }, 'token-a');
  assert.deepEqual(missing, { status: 400, body: {
    error: '果乡名称未填写或过长', code: 'invalid_farmtown', field: 'name', reason: 'required'
  } });
  assert.equal('max' in missing.body, false, '「没填」不该带 max（没有上限这回事）');
});

test('改动面不外溢：没点名 field 的字段与 404 / 容量错误照旧往上抛（服务层契约不变）', async t => {
  const svc = service(t, 'farmtown-scope-', createSdkStub());
  // 省份不在这次放宽的三项里：超限照旧抛错，不转成响应、也不带 field
  await assert.rejects(
    () => create(svc, { province: '省'.repeat(21) }, 'token-a'),
    error => error.message === '省份过长（最多 20 字）' && !error.field && !error.max
  );
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: 'missing' } }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡不存在或已下架'
  );
  // 老数据照旧读得回：文件里的旧记录（名称 20 字以内）重启后还在
  const dir = tempDir(t, 'farmtown-legacy-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, towns: [Object.assign({}, TOWN_BODY, {
    id: 'townlegacy', favId: 'fruit-town:townlegacy', ownerId: 'owner-legacy', published: true,
    createdAt: '2026-09-30', polishedDescription: '', image: '', term: '秋分', location: { latitude: 36.97, longitude: 120.71 }
  })] }));
  const legacy = createFarmtownService({ file: file, sdk: null, envId: '', accessKey: '' });
  const list = await legacy.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.ok(list.body.towns.some(town => town.id === 'townlegacy'), '老数据照旧读得回');
});

// ---- ② HTTP 层：被拒时响应里真的带 field（客户端拿得到的那一份）----

test('HTTP 层：超限的 400 响应体里带 field / max / reason，error 文案逐字不变', async t => {
  const dir = tempDir(t, 'farmtown-limit-http-');
  const config = Object.assign(readConfig({ PORT: '0' }), { cloudbase: { envId: '', accessKey: '' } });
  const server = createServer({ config: config, farmtownFile: path.join(dir, 'guayouji-farmtown.json') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, payload) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token-a' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const LONG_EN = 'Sunny Hill Fruit Farm And Orchard Of The Wang Family In Luochuan';
  assert.ok(LONG_EN.length > 60, '样本要真的超 60 字，实际 ' + LONG_EN.length + ' 字');
  const tooLong = await call('/api/farmtown/create', body({ name: LONG_EN }));
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, '果乡名称过长（最多 60 字）', '原有 error 文案一个字不许动');
  assert.equal(tooLong.body.code, 'invalid_farmtown', '原有 code 照旧');
  assert.equal(tooLong.body.field, 'name');
  assert.equal(tooLong.body.max, 60);
  assert.equal(tooLong.body.reason, 'too_long');

  // 21 字的英文店名现在真的发得出去（原来 20 字上限直接 400）
  const ok = await call('/api/farmtown/create', body({ name: 'Sunny Hill Fruit Farm' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.town.name, 'Sunny Hill Fruit Farm');
});
