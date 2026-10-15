'use strict';
// 果乡名片「删除」接口回归（2026-10-15 新增 POST /api/farmtown/delete，body { id }）。
// 在「只有下架、没有删除」时期，果农下架过的名片会永远留在库里；验收用的两张模拟名片
// （townaafabfaa / townaaacacba）也删不掉。这份测试盯住五件事：
//   ① 删自己的 → 200，之后 list / detail / my 三处都找不到，云数据库里那条文档也真的没了；
//   ② 删别人的 → 按 update / unpublish 同一套归属口径被拒（404 not_found，不放宽、不外泄）；
//   ③ 删演示果乡（库里**已经存在**的 id 以 townseed 开头、或 ownerId === 'seed' 的老记录）→ 403 forbidden，
//      谁都删不动（服务端已不再自动播种，这批老记录靠这道保护锁着，不会被谁误删）；
//   ④ 删不存在的 id → 与 unpublish 一致的 404 not_found（不静默成功），删两次第二次就是 404；
//   ⑤ 云数据库与文件两条路径都走得通，且 HTTP 层（app.js 的前缀转发）不需要改动就已接线。
// 桩法照 tests/farmtown.test.js：mock 刻意模拟真实 @cloudbase/node-sdk 签名，
// 删文档用 doc(id).remove()（与 server/community.js:331 的 deletePost 同款调用）。
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

const DB = { envId: 'env-test', accessKey: 'ak-test' };

// 与 farmtown.test.js 同款 SDK 桩，只多一个 remove()：真签名 doc(id).remove() 删掉该文档、返回 { deleted: 1 }。
function createSdkStub(options = {}) {
  const docs = new Map();
  const state = Object.assign({ failInit: '', failGet: '', failSet: '', failRemove: '', setCount: 0, removeCount: 0 }, options);
  const clone = value => JSON.parse(JSON.stringify(value));
  const readAll = () => Array.from(docs.entries())
    .map(([id, doc]) => Object.assign({ _id: id }, clone(doc)))
    .sort((a, b) => (Number(a.storedAt) || 0) - (Number(b.storedAt) || 0));
  function queryOf() {
    const q = { orderBy: () => q, limit: () => q, get: async () => {
      if (state.failGet) throw new Error(state.failGet);
      return { data: readAll() };
    } };
    return q;
  }
  const collection = {
    doc: id => ({
      set: async data => {
        state.setCount += 1;
        if (state.failSet) throw new Error(state.failSet);
        if (data && Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('不能更新_id的值');
        docs.set(id, clone(data));
        return { updated: 1, upsertedId: id };
      },
      get: async () => ({ data: docs.has(id) ? [Object.assign({ _id: id }, clone(docs.get(id)))] : [] }),
      remove: async () => {
        state.removeCount += 1;
        if (state.failRemove) throw new Error(state.failRemove);
        const had = docs.delete(id);
        return { deleted: had ? 1 : 0 };
      }
    }),
    orderBy: () => queryOf(),
    limit: () => queryOf(),
    get: async () => queryOf().get()
  };
  const app = { database: () => ({ collection: () => collection, createCollection: async () => {} }) };
  return {
    sdk: { init: () => { if (state.failInit) throw new Error(state.failInit); return app; } },
    docs: docs,
    state: state,
    rows: () => Array.from(docs.values())
  };
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* 清理失败不影响结论 */ } });
  return dir;
}

const TOWN_BODY = {
  name: '山东莱阳 · 老张梨园', province: '山东', city: '烟台市', county: '莱阳市', fruit: '梨',
  experiences: ['采摘', '观光'], description: '老梨园三十年树龄，秋分后采摘，鸭梨脆甜多汁。',
  address: '莱阳市照旺庄镇老张梨园', openDate: '2026-09-01', openTime: '08:00',
  closeDate: '2026-10-20', closeTime: '18:00', wechat: 'laozhang', phone: '13800000000',
  location: { latitude: 36.97, longitude: 120.71 }
};

function service(t, stub, prefix) {
  return createFarmtownService(Object.assign(
    { file: path.join(tempDir(t, prefix), 'store.json') }, DB, { sdk: stub.sdk }
  ));
}

// 库里**已经存在**的演示果乡（id 前缀 townseed + ownerId='seed'）。服务端已不再自动播种（SEED_TOWNS /
// seedIfEmpty 已删），所以这类老记录只能像线上那样「本来就躺在库里」——由测试直接写进数据库桩。
// 删除接口靠 isSeedTown() 认出它们（server/farmtown.js:406-408），这份测试钉住这道保护照旧自立。
const SEED_IDS = ['townseeda', 'townseedb', 'townseedc', 'townseedd', 'townseede', 'townseedf', 'townseedg', 'townseedh'];
function seedExistingTowns(stub) {
  SEED_IDS.forEach((id, index) => {
    stub.docs.set(id, {
      id: id, favId: 'fruit-town:' + id, ownerId: 'seed', storedAt: index + 1, published: true,
      createdAt: '2026-10-13', polishedDescription: '', image: '', name: '演示果乡 ' + id,
      province: '陕西', city: '演示市', county: '演示县', fruit: '苹果', term: '秋分',
      experiences: ['采摘'], description: '演示果乡（老记录照旧读得回）。',
      transport: '自驾：演示路线', contact: '', location: { latitude: 0, longitude: 0 }
    });
  });
}

// ---- ① 删自己的：成功，之后 list / detail / my 三处都找不到 ----

test('删除自己的名片：200，之后 list / detail / my 都找不到，云数据库文档也真的没了', async t => {
  const stub = createSdkStub();
  const svc = service(t, stub, 'farmtown-del-mine-');
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;
  assert.equal(stub.docs.has(id), true, '发布后库里确实有这条');

  const removed = await svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' });
  assert.equal(removed.status, 200);
  assert.deepEqual(Object.keys(removed.body), ['town'], '响应形状照 unpublish：只有 town 一个键');
  assert.equal(removed.body.town.id, id, '返回被删掉的那一张，客户端据此确认删的是哪张');
  assert.equal(stub.state.removeCount, 1, '走的必须是 doc(id).remove()，不是改写文档');
  assert.equal(stub.docs.has(id), false, '云数据库里的文档真的删掉了');
  assert.equal(stub.docs.size, 0, '库里就这一张，删掉之后是空的（不再自动播种演示果乡）');

  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.ok(!list.body.towns.some(town => town.id === id), '公开列表里找不到');
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } }),
    error => error.status === 404 && error.code === 'not_found',
    '详情也查不到了'
  );
  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns, [], '「我的发布」里也没了');

  // 重启（新进程 / 新容器）后仍然是删掉的状态 —— 删除是真的落库，不是只改了内存缓存。
  const restarted = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-del-restart-'), 'store.json') }, DB, { sdk: stub.sdk }));
  const afterRestart = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.ok(!afterRestart.body.towns.some(town => town.id === id), '重启后也不会「复活」');
});

test('先下架再删除：下架过的名片照样删得掉（线上两张验收名片就是先下架的状态）', async t => {
  const stub = createSdkStub();
  const svc = service(t, stub, 'farmtown-del-unpublished-');
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;
  await svc.dispatch({ method: 'POST', path: '/api/farmtown/unpublish', body: { id: id }, owner: 'token-a' });

  const removed = await svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.town.published, false, '返回的是下架时的状态，不改写历史字段');
  assert.equal(stub.docs.has(id), false);
});

// ---- ② 删别人的：按既有归属口径被拒 ----

test('删别人的名片：按 update / unpublish 同一套归属口径被拒（404 not_found），名片原封不动', async t => {
  const stub = createSdkStub();
  const svc = service(t, stub, 'farmtown-del-other-');
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;

  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'someone-else' }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡不存在或无权删除',
    '口径与「果乡不存在或无权修改/下架」同款：404 not_found，且不外泄「这张名片存在」'
  );
  assert.equal(stub.state.removeCount, 0, '没走到删除这一步');
  assert.equal(stub.docs.has(id), true, '别人的名片一张都不能少');
  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.equal(mine.body.towns.length, 1);
  assert.equal(mine.body.towns[0].id, id);
});

// ---- ③ 删种子：被拒 ----

test('删演示果乡名片：一律 403 forbidden，库里已有的 8 条老记录一个都删不掉', async t => {
  const stub = createSdkStub();
  seedExistingTowns(stub);                                             // 老记录本来就躺在库里
  const svc = service(t, stub, 'farmtown-del-seed-');
  const list0 = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(stub.docs.size, SEED_IDS.length);
  assert.equal(list0.body.towns.length, SEED_IDS.length, '库里那 8 条老记录照旧读得回');

  for (const id of SEED_IDS) {
    await assert.rejects(
      () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' }),
      error => error.status === 403 && error.code === 'forbidden' && error.message === '演示果乡不能删除',
      '演示果乡 ' + id + ' 必须拦住（403 forbidden，口径照 community.js 的「只能删除自己的动态」）'
    );
  }
  // 顺序口径：先看存不存在、再看是不是种子。所以「种子的形状但库里没有」仍按第 ④ 条报 404 ——
  // 403 只对**真实存在的**演示名片生效，不会因为 id 长得像种子就报一个跟 unpublish 不一致的错。
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: 'townseedzzzzzz' }, owner: 'token-a' }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡不存在或无权删除'
  );
  // 反过来：老客户端带着种子 id 来删，也一样是 403（种子判定不看请求方是谁、拿的什么 token）。
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: 'townseedb' }, owner: 'seed' }),
    error => error.status === 403 && error.code === 'forbidden'
  );
  assert.equal(stub.state.removeCount, 0, '一次删除都没执行');
  assert.equal(stub.docs.size, SEED_IDS.length, '8 个演示果乡一个不少');
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.body.towns.length, SEED_IDS.length);
});

// ---- ④ 删不存在的 id：与 unpublish 一致的 404 ----

test('删不存在的 id：与 unpublish 同款 404 not_found（不静默成功），删两次第二次就是 404', async t => {
  const stub = createSdkStub();
  const svc = service(t, stub, 'farmtown-del-missing-');
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: 'townnosuchid' }, owner: 'token-a' }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡不存在或无权删除'
  );
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: {}, owner: 'token-a' }),
    error => error.status === 404 && error.code === 'not_found',
    'body 里没有 id 也是同一个口径，不抛 500'
  );

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;
  assert.equal((await svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' })).status, 200);
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' }),
    error => error.status === 404 && error.code === 'not_found',
    '删两次：第二次 404（与 unpublish 一样不幂等成功）'
  );

  // 路由白名单的既有口径不变：别的动作 / 别的路径仍是「果乡接口不存在」。
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/delete', query: { id: id } }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡接口不存在',
    '删除只认 POST'
  );
});

// ---- ⑤ 两条存储路径 + HTTP 层接线 ----

test('数据库不可用：删除退回文件方案，文件里那条也没了；ownerId=seed 的迁移老记录同样不许删', async t => {
  const dir = tempDir(t, 'farmtown-del-file-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  const svc = createFarmtownService({ file: file });   // 不配数据库 → 文件方案
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;
  assert.equal((await svc.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: id }, owner: 'token-a' })).status, 200);

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 1, '文件格式与改造前逐字一致');
  assert.equal(saved.towns.length, 0, '文件里也没了那条（不再自动播种，建一张删一张 = 空）');
  assert.ok(!saved.towns.some(town => town.id === id));
  assert.ok(saved.towns.every(town => !('storedAt' in town)), '内部排序字段照旧不写进文件');
  const restarted = createFarmtownService({ file: file });
  assert.equal((await restarted.dispatch({ method: 'GET', path: '/api/farmtown/list' })).body.towns.length, 0);

  // 归属种子（ownerId === 'seed'）但 id 不是 townseed 前缀的老记录：靠 ownerId 这一半也要拦住。
  const dir2 = tempDir(t, 'farmtown-del-legacy-');
  const file2 = path.join(dir2, 'guayouji-farmtown.json');
  fs.writeFileSync(file2, JSON.stringify({ version: 1, towns: [{ id: 'towndemolegacy', ownerId: 'seed', published: true, name: '迁移进来的演示果乡' }] }), 'utf8');
  const legacy = createFarmtownService({ file: file2 });
  await assert.rejects(
    () => legacy.dispatch({ method: 'POST', path: '/api/farmtown/delete', body: { id: 'towndemolegacy' }, owner: 'token-a' }),
    error => error.status === 403 && error.code === 'forbidden',
    'ownerId === seed 一样算种子'
  );
});

test('HTTP 层接线不变：POST /api/farmtown/delete 走通（app.js 的前缀转发已覆盖，未改 app.js）', async t => {
  const dir = tempDir(t, 'farmtown-del-http-');
  const config = Object.assign(readConfig({ PORT: '0' }), { cloudbase: { envId: '', accessKey: '' } });
  // 未配数据库 → 走文件方案：把一条**已经存在**的演示果乡先写进文件（自动播种已删，老记录只能「本来就躺着」），
  // 下面才验得到「HTTP 层删演示果乡也是 403」。
  const farmtownFile = path.join(dir, 'guayouji-farmtown.json');
  fs.writeFileSync(farmtownFile, JSON.stringify({
    version: 1,
    towns: [{ id: 'townseeda', ownerId: 'seed', published: true, name: '陕西洛川 · 王大爷苹果园' }]
  }), 'utf8');
  const server = createServer({ config: config, farmtownFile: farmtownFile });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, body, headers) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const owner = { authorization: 'Bearer test-token-a' };

  const created = await call('/api/farmtown/create', TOWN_BODY, owner);
  const id = created.body.town.id;
  const removed = await call('/api/farmtown/delete', { id: id }, owner);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.town.id, id);

  const gone = await call('/api/farmtown/detail?id=' + id);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, 'not_found');

  const seed = await call('/api/farmtown/delete', { id: 'townseeda' }, owner);
  assert.equal(seed.status, 403, '种子在 HTTP 层也是 403');
  assert.equal(seed.body.code, 'forbidden');

  const other = await call('/api/farmtown/delete', { id: 'townnosuchid' }, owner);
  assert.equal(other.status, 404, '不存在的 id 在 HTTP 层是 404');
  assert.equal(other.body.code, 'not_found');
});

test('客户端封装：deleteTown(id) 就是 POST /api/farmtown/delete + { id }，写法与 unpublishTown 同款', async t => {
  const previousWx = global.wx;
  const memory = new Map(); const requests = [];
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: key => memory.delete(key),
    request: options => requests.push(options)
  };
  t.after(() => { global.wx = previousWx; });
  const store = require('../miniprogram/lib/store');
  store.exitDemo(); store.clearAll();
  const apiBase = 'https://farmtown-delete.example';
  store.saveSettings({ apiBase: apiBase });
  store.saveSession({ token: 'a'.repeat(64), expiresAt: Date.now() + 600000 }, apiBase);

  const farmtown = require('../miniprogram/lib/farmtown-service');
  assert.equal(typeof farmtown.deleteTown, 'function', 'deleteTown 必须导出');

  const pending = farmtown.deleteTown('townaafabfaa');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, apiBase + '/api/farmtown/delete');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].data, { id: 'townaafabfaa' }, 'body 就是 { id }，与 unpublishTown 同款');
  requests[0].success({ statusCode: 200, data: { town: { id: 'townaafabfaa', published: false } } });
  const town = await pending;
  assert.equal(town.id, 'townaafabfaa', '返回值仍是 res.town（与 unpublishTown 一致）');
});
