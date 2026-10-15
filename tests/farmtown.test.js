'use strict';
// 果乡名片存储根治回归（10.11 事故防回归）：
// 老方案把名片写在容器 /tmp 的 JSON 文件里，每次部署/重启即清空 —— 实测 list 从 9 掉到 1，
// 果农自己发布的名片一重启就永久丢失。这份测试盯住四件事：
//   ① 写入后从云数据库读回（重启不丢）；
//   ② 库为空时启动 / 反复请求都**不再自动播种**演示果乡（SEED_TOWNS 与 seedIfEmpty 已删），
//      而库里**已经存在**的演示果乡（旧数据 / 迁移进来的）照旧读得回；
//   ③ 数据库未配置或不可用时接口不崩，退回文件方案；
//   ④ 对外 HTTP 契约（路由 / 状态码 / 字段 / 错误 code）与改造前一致。
// mock 刻意模拟真实 @cloudbase/node-sdk 签名：doc(id).get() 返回 { data: [数组] }、
// doc(id).set() 是 upsert（不存在则创建）且**不接受 _id**（真 SDK 会报「不能更新_id的值」）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFarmtownService } = require('../server/farmtown');
const { createServer } = require('../server/app');
const { readConfig } = require('../server/config');
const { InputError } = require('../server/validation');

// 本文件全程不碰真实云环境：显式清掉可能存在的 TCB_* / 数据文件环境变量，数据库一律用 stub。
delete process.env.TCB_ENV_ID;
delete process.env.TCB_ACCESS_KEY;
delete process.env.FARMTWON_DATA_FILE;

const DB = { sdk: null, envId: 'env-test', accessKey: 'ak-test' };

function createSdkStub(options = {}) {
  const docs = new Map();
  const state = Object.assign({ failInit: '', failGet: '', failSet: '', setCount: 0, createdCollections: 0 }, options);
  const clone = value => JSON.parse(JSON.stringify(value));
  const readAll = () => Array.from(docs.entries())
    .map(([id, doc]) => Object.assign({ _id: id }, clone(doc)))
    .sort((a, b) => (Number(a.storedAt) || 0) - (Number(b.storedAt) || 0));
  function queryOf(filter) {
    const q = {
      orderBy: () => q,
      limit: () => q,
      get: async () => {
        if (state.failGet) throw new Error(state.failGet);
        const rows = readAll().filter(row => !filter || Object.keys(filter).every(key => row[key] === filter[key]));
        return { data: rows };
      }
    };
    return q;
  }
  const collection = {
    doc: id => ({
      // 真签名：doc(id).set() = 替换更新（不存在则创建），payload 带 _id 直接报错。
      set: async data => {
        state.setCount += 1;
        if (state.failSet) throw new Error(state.failSet);
        if (data && Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('不能更新_id的值');
        docs.set(id, clone(data));
        return { updated: 1, upsertedId: id };
      },
      // 真签名：doc(id).get() 返回 { data: [文档数组] }
      get: async () => ({ data: docs.has(id) ? [Object.assign({ _id: id }, clone(docs.get(id)))] : [] })
    }),
    orderBy: () => { if (state.failOrderBy) throw new Error(state.failOrderBy); return queryOf(null); },
    limit: () => queryOf(null),
    where: filter => queryOf(filter),
    get: async () => queryOf(null).get()
  };
  const app = {
    database: () => ({
      collection: () => collection,
      createCollection: async () => { state.createdCollections += 1; }
    })
  };
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

const LEGACY_TOWN = {
  id: 'townoldcard', favId: 'fruit-town:townoldcard', ownerId: 'owner-legacy', published: true,
  createdAt: '2026-09-30', polishedDescription: '', image: '',
  name: '江西南丰 · 旧名片蜜桔园', province: '江西', city: '抚州市', county: '南丰县', fruit: '蜜桔',
  term: '秋分', experiences: ['采摘'], description: '迁移前的旧记录。', address: '南丰县某村',
  openDate: '2026-09-01', openTime: '08:00', closeDate: '2026-10-01', closeTime: '18:00',
  wechat: '', phone: '', location: { latitude: 27.22, longitude: 116.53 }
};

// 库里**已经存在**的演示果乡（id 前缀 townseed + ownerId='seed'）：自动播种删掉之后，这类老记录只能像
// 线上那样「本来就躺在库里」——由测试直接写进数据库桩，不再靠服务端自己造。形状照线上真实那 8 条抄：
// 公开字段恰好 17 个（含老记录才有的 contact / transport），内部字段 ownerId / storedAt 由 publicTown 剥掉。
// 省份也照线上：只有 townseedd（浙江仙居 · 杨梅园）是浙江，供「按省份过滤」那条断言使用。
const SEED_IDS = ['townseeda', 'townseedb', 'townseedc', 'townseedd', 'townseede', 'townseedf', 'townseedg', 'townseedh'];
const SEED_NAMES = ['陕西洛川 · 王大爷苹果园', '河南灵宝 · 寺河山苹果园', '山东烟台 · 樱桃园', '浙江仙居 · 杨梅园',
  '广东增城 · 荔枝园', '四川蒲江 · 猕猴桃园', '云南蒙自 · 石榴园', '新疆阿克苏 · 苹果园'];
const SEED_PROVINCES = ['陕西', '河南', '山东', '浙江', '广东', '四川', '云南', '新疆'];
function seedExistingTowns(stub) {
  SEED_IDS.forEach((id, index) => {
    stub.docs.set(id, {
      id: id, favId: 'fruit-town:' + id, ownerId: 'seed', storedAt: index + 1, published: true,
      createdAt: '2026-10-13', polishedDescription: '', image: '',
      name: SEED_NAMES[index], province: SEED_PROVINCES[index], city: '演示市', county: '演示县',
      fruit: '苹果', term: '秋分', experiences: ['采摘'], description: '演示果乡（老记录照旧读得回）。',
      transport: '自驾：演示路线', contact: '', location: { latitude: 0, longitude: 0 }
    });
  });
}

test('云数据库持久化：发布的名片重启后仍在，不再随容器 /tmp 清空而丢失', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-persist-');
  const first = createFarmtownService(Object.assign({ file: path.join(dir, 'first.json') }, DB, { sdk: stub.sdk }));
  const created = await first.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  assert.equal(created.status, 200);
  const id = created.body.town.id;
  assert.ok(stub.docs.has(id), '名片必须落进云数据库，且文档 _id 就是果乡 id');
  assert.equal(stub.docs.get(id).name, TOWN_BODY.name);
  assert.equal(typeof stub.docs.get(id).storedAt, 'number', '写库时带 Date.now() 时间戳，供列表排序');

  // 新进程 = 新容器：同一个库、全新的 /tmp 文件（模拟部署后 /tmp 被清空）
  const second = createFarmtownService(Object.assign({ file: path.join(dir, 'second.json') }, DB, { sdk: stub.sdk }));
  const list = await second.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.status, 200);
  assert.equal(list.body.towns.length, 1, '库里只有刚发布的这 1 张（不再自动播种演示果乡）');
  assert.ok(list.body.towns.some(town => town.id === id && town.name === TOWN_BODY.name));
  assert.ok(!fs.existsSync(path.join(dir, 'second.json')), '数据库可用时不该再写 /tmp 文件');
});

// 原用例「播种幂等：重启 / 重复调用 seedIfEmpty / 并发播种都只有 8 个种子」只在验证「会自动播种」这一行为，
// 播种被删后该行为已不存在 → 改写成它的反面（本次改动的核心断言），并补上「已有数据照旧能读」。
test('库为空时启动 / 反复请求都不再自动播种演示果乡；库里已有的老记录照旧读得回', async t => {
  const stub = createSdkStub();
  const opts = Object.assign({ file: path.join(tempDir(t, 'farmtown-empty-'), 'store.json') }, DB, { sdk: stub.sdk });

  // 空库：启动 + 反复读列表，一条记录都不该被凭空造出来。
  const empty = createFarmtownService(opts);
  const first = await empty.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.towns, [], '库为空时 /list 就是空数组，不再凭空长出 8 个演示果乡');
  assert.deepEqual((await empty.dispatch({ method: 'GET', path: '/api/farmtown/list' })).body.towns, [], '反复请求也不会补种');
  assert.equal(stub.docs.size, 0, '库里一条文档都没有');
  assert.equal(stub.state.setCount, 0, '启动 / 读列表一个写库动作都不做（播种写库已随之删掉）');
  assert.equal(empty.seedIfEmpty, undefined, '不再有播种入口（SEED_TOWNS / seedIfEmpty 已删）');

  // 换个进程重来（新容器 / 重启）：空库照样是空的，不会「一重启就长回来」。
  const restarted = createFarmtownService(opts);
  assert.deepEqual((await restarted.dispatch({ method: 'GET', path: '/api/farmtown/list' })).body.towns, []);

  // 已有数据照旧能读：库里本来躺着的演示果乡（townseed 前缀 + ownerId='seed'）不受影响，只是不再自动造新的。
  const legacyStub = createSdkStub();
  seedExistingTowns(legacyStub);
  const withLegacy = createFarmtownService(Object.assign(
    { file: path.join(tempDir(t, 'farmtown-legacy-'), 'store.json') }, DB, { sdk: legacyStub.sdk }
  ));
  const list = await withLegacy.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.body.towns.length, 8, '库里已有的 8 条演示果乡照旧读得回');
  assert.deepEqual(list.body.towns.map(town => town.id), SEED_IDS, '旧记录的 id 与顺序照旧');
});

test('库为空且旧 /tmp 文件还有记录：启动时迁移进库；迁移失败也不影响启动', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-migrate-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, towns: [LEGACY_TOWN] }), 'utf8');
  const svc = createFarmtownService(Object.assign({ file: file }, DB, { sdk: stub.sdk }));
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.towns.map(town => town.id), ['townoldcard'], '旧记录按原 id 迁入，且不再灌种子');
  assert.ok(stub.docs.has('townoldcard'), '旧记录确实进了云数据库');

  // 迁移写失败（数据库只读/抖动）→ 启动照常，退回文件方案仍能读到旧记录
  const broken = createSdkStub({ failSet: 'write refused' });
  const file2 = path.join(dir, 'guayouji-farmtown-2.json');
  fs.writeFileSync(file2, JSON.stringify({ version: 1, towns: [LEGACY_TOWN] }), 'utf8');
  const svc2 = createFarmtownService(Object.assign({ file: file2 }, DB, { sdk: broken.sdk }));
  const list2 = await svc2.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list2.status, 200);
  assert.deepEqual(list2.body.towns.map(town => town.id), ['townoldcard']);
});

test('数据库未配置：退回文件方案，接口照旧可用、不再自动播种、文件格式与改造前一致', async t => {
  const dir = tempDir(t, 'farmtown-file-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  const svc = createFarmtownService({ file: file });
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.status, 200);
  assert.equal(list.body.towns.length, 0, '与改造前不同（正是本次改动）：文件为空时不再灌入 8 个演示果乡');

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.ok(fs.existsSync(file), '退回文件方案时仍要落盘');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.towns.length, 1);
  assert.ok(saved.towns.every(town => !('storedAt' in town)), '内部排序字段 storedAt 不写进文件（回滚旧代码仍能读）');

  const restarted = createFarmtownService({ file: file });
  const again = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(again.body.towns.length, 1, '文件方案下重启也能读回（本地/离线兜底）');
});

test('数据库不可用：初始化失败 / 读库抖动 / 写库失败都不打崩接口，退回文件方案', async t => {
  const dir = tempDir(t, 'farmtown-down-');

  const initFail = createSdkStub({ failInit: 'connect ECONNREFUSED' });
  const a = createFarmtownService(Object.assign({ file: path.join(dir, 'a.json') }, DB, { sdk: initFail.sdk }));
  const listA = await a.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(listA.status, 200);
  assert.equal(listA.body.towns.length, 0, '退回文件方案，且不再自动播种');
  assert.equal((await a.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' })).status, 200, '写接口也不能崩');

  const readFail = createSdkStub({ failGet: 'database timeout' });
  const b = createFarmtownService(Object.assign({ file: path.join(dir, 'b.json') }, DB, { sdk: readFail.sdk }));
  assert.equal((await b.dispatch({ method: 'GET', path: '/api/farmtown/list' })).body.towns.length, 0);
  await assert.rejects(
    () => b.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: 'missing' } }),
    error => error instanceof InputError && error.status === 404 && error.code === 'not_found',
    '数据库不可用也不能把「查不到」变成 500'
  );

  const writeFail = createSdkStub({ failSet: 'write timeout' });
  const c = createFarmtownService(Object.assign({ file: path.join(dir, 'c.json') }, DB, { sdk: writeFail.sdk }));
  const createdC = await c.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-c' });
  assert.equal(createdC.status, 200);
  const mine = await c.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-c' });
  assert.equal(mine.body.towns.length, 1);
  const savedC = JSON.parse(fs.readFileSync(path.join(dir, 'c.json'), 'utf8'));
  assert.ok(savedC.towns.some(town => town.id === createdC.body.town.id), '本次退回文件，果农填的东西不白填');
});

test('对外契约逐条不变：路由、状态码、字段、错误 code 与改造前一致', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-contract-'), 'x.json') }, DB, { sdk: stub.sdk }));

  // 自动播种已删：空库的公开列表就是空数组（这是本次改动的对外可见结果）。
  const empty = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(empty.status, 200);
  assert.deepEqual(Object.keys(empty.body), ['towns']);
  assert.deepEqual(empty.body.towns, [], '库为空时不再凭空长出 8 个演示果乡');

  // 库里**已经存在**的演示果乡（老记录）照旧读得回：公开字段与改造前逐字一致（不多不少）。
  // 用独立的一份库（本来就躺着 8 条）来钉字段集合，免得把「老数据的形状」和「新建名片的形状」混在一起。
  const legacy = createSdkStub();
  seedExistingTowns(legacy);
  const legacySvc = createFarmtownService(Object.assign(
    { file: path.join(tempDir(t, 'farmtown-contract-legacy-'), 'y.json') }, DB, { sdk: legacy.sdk }
  ));
  const list = await legacySvc.dispatch({ method: 'GET', path: '/api/farmtown/list', query: { province: '浙江' } });
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.body), ['towns']);
  assert.equal(list.body.towns.length, 1, '按省份过滤仍生效');
  const seed = list.body.towns[0];
  assert.deepEqual(Object.keys(seed).sort(), ['city', 'contact', 'county', 'createdAt', 'description', 'experiences',
    'favId', 'fruit', 'id', 'image', 'location', 'name', 'polishedDescription', 'province', 'published', 'term',
    'transport'].sort(), '演示果乡的公开字段与改造前逐字一致（不多不少）');

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.deepEqual(Object.keys(created.body), ['town']);
  const id = created.body.town.id;
  const town = created.body.town;
  ['id', 'favId', 'name', 'province', 'city', 'county', 'fruit', 'experiences', 'description', 'wechat',
    'phone', 'term', 'location', 'address', 'openDate', 'openTime', 'closeDate', 'closeTime',
    'published', 'createdAt', 'polishedDescription', 'image'].forEach(key => assert.ok(key in town, '缺字段 ' + key));
  assert.ok(!('ownerId' in town), 'ownerId 不得外泄');
  assert.ok(!('storedAt' in town), 'storedAt 是内部排序字段，不得外泄');

  const detail = await svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } });
  assert.equal(detail.status, 200);
  assert.deepEqual(Object.keys(detail.body), ['town']);
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: 'missing' } }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡不存在或已下架'
  );
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/unknown' }),
    error => error.status === 404 && error.code === 'not_found' && error.message === '果乡接口不存在'
  );

  const updated = await svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id, name: '改名后的梨园' }), owner: 'token-a' });
  assert.equal(updated.body.town.name, '改名后的梨园');
  assert.equal(updated.body.town.id, id, 'update 不改 id');
  await assert.rejects(
    () => svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id }), owner: 'someone-else' }),
    error => error.status === 404 && error.message === '果乡不存在或无权修改'
  );

  const unpublished = await svc.dispatch({ method: 'POST', path: '/api/farmtown/unpublish', body: { id: id }, owner: 'token-a' });
  assert.equal(unpublished.body.town.published, false);
  const afterList = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.ok(!afterList.body.towns.some(item => item.id === id), '下架后不出现在公开列表');
  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.equal(mine.body.towns.length, 1);
  assert.equal(mine.body.towns[0].published, false);

  assert.equal(typeof svc.polish, 'function');
  assert.equal(svc.seedIfEmpty, undefined, '播种入口已删（不再自动造演示数据）');
  assert.equal(typeof svc._state, 'function');
  assert.equal(svc._state().version, 1, '_state 仍是同步可用、结构不变');
});

test('update / unpublish 也落库：重启后拿到的是新值，不是启动时的旧缓存', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-write-');
  const opts = Object.assign({ file: path.join(dir, 'store.json') }, DB, { sdk: stub.sdk });
  const first = createFarmtownService(opts);
  const created = await first.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  const id = created.body.town.id;
  await first.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id, name: '改名后的梨园' }), owner: 'token-a' });
  await first.dispatch({ method: 'POST', path: '/api/farmtown/unpublish', body: { id: id }, owner: 'token-a' });

  const restarted = createFarmtownService(opts);
  const mine = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.equal(mine.body.towns.length, 1);
  assert.equal(mine.body.towns[0].name, '改名后的梨园');
  assert.equal(mine.body.towns[0].published, false);
});

test('HTTP 层接线不变：/api/farmtown/* 走通（app.js 已 await 异步 dispatch）', async t => {
  const dir = tempDir(t, 'farmtown-http-');
  const config = Object.assign(readConfig({ PORT: '0' }), { cloudbase: { envId: '', accessKey: '' } });
  const server = createServer({ config: config, farmtownFile: path.join(dir, 'guayouji-farmtown.json') });
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

  const list = await call('/api/farmtown/list');
  assert.equal(list.status, 200);
  assert.equal(list.body.towns.length, 0, '空库：HTTP 层也不再有 8 个自动播种的演示果乡');

  const created = await call('/api/farmtown/create', TOWN_BODY, owner);
  assert.equal(created.status, 200);
  const id = created.body.town.id;
  assert.equal((await call('/api/farmtown/detail?id=' + id)).body.town.id, id);
  assert.equal((await call('/api/farmtown/my', undefined, owner)).body.towns.length, 1);
  assert.equal((await call('/api/farmtown/unpublish', { id: id }, owner)).body.town.published, false);

  const gone = await call('/api/farmtown/detail?id=' + id);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, 'not_found');
});

// ---- 2026-10-18 ① /api/farmtown-polish 的 HTTP 接线（原来必 500）----
// 根因：app.js 把 farmtown.polish() 当成 dispatch 那种 { status, body } 结果取字段，
// 而它返回的是**响应体本身** { polishedText } → status / body 都是 undefined →
// writeHead(undefined) 抛 ERR_HTTP_INVALID_STATUS_CODE → catch 兜成 500 internal_error。
// 这里从 HTTP 层钉住「200 + { polishedText }」这个对外契约（路径、字段名、状态码一个字不改）。
test('/api/farmtown-polish：模型可用时返回 200 与 { polishedText }（字段契约不变）', async t => {
  const dir = tempDir(t, 'farmtown-polish-');
  const config = Object.assign(readConfig({
    PORT: '0', MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'stub-model',
    OPENAI_API_KEY: 'stub-key', OPENAI_BASE_URL: 'https://api.example.com/v1'
  }), { cloudbase: { envId: '', accessKey: '' } });
  // 假的模型通道：响应形状照 server/chat.js 取正文那一处（data.choices[0].message.content）。
  const chatFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '润色后的果乡文案。' } }] }) });
  const server = createServer({ config: config, chatFetch: chatFetch, farmtownFile: path.join(dir, 'guayouji-farmtown.json') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const response = await fetch(base + '/api/farmtown-polish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: '我家果园在塬上，种了三十年苹果。', fruit: '苹果', term: '秋分', region: '陕西省延安市洛川县',
      address: '凤栖镇××路8号', openDate: '2026-10-01', openTime: '09:00', closeDate: '2026-11-30', closeTime: '17:00',
      experiences: ['采摘', '观光']
    })
  });
  assert.equal(response.status, 200, '不再是 500 internal_error');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['polishedText'], '响应体只有 polishedText 一个字段（契约不变）');
  assert.equal(body.polishedText, '润色后的果乡文案。');
});

test('/api/farmtown-polish：模型未配置时的错误口径也不变（502 model_unavailable）', async t => {
  const dir = tempDir(t, 'farmtown-polish-off-');
  // 不带 MODEL_PROVIDER → provider = disabled → chat.polish 抛 model_disabled(503)，
  // farmtown.polish 照既有口径翻成 model_unavailable(502) —— 本次改动没碰这条路径。
  const config = Object.assign(readConfig({ PORT: '0' }), { cloudbase: { envId: '', accessKey: '' } });
  const server = createServer({ config: config, farmtownFile: path.join(dir, 'guayouji-farmtown.json') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/farmtown-polish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: '我家果园在塬上。', fruit: '苹果' })
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
  assert.equal(body.code, 'model_unavailable');
  assert.equal(body.error, '润色服务暂不可用');
});

// ---- 2026-10-18 ② activityDate（可去日期）落库 ----
// 客户端一直在送这个字段（pages/seller/publish/publish-flow.js 的 townPayload），服务端白名单漏了它 →
// 快讯 / ①去哪 名片的「可去日期」那行一直空。这里钉住：云数据库与文件两条路径都要写进去、读得回。
test('activityDate 落库：create 写进云数据库同一份文档，update 改得动，重启后 my / list / detail 都带得回来', async t => {
  const stub = createSdkStub();
  const opts = Object.assign({ file: path.join(tempDir(t, 'farmtown-date-'), 'store.json') }, DB, { sdk: stub.sdk });
  const svc = createFarmtownService(opts);

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: Object.assign({}, TOWN_BODY, { activityDate: '2026-10-05' }), owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.equal(created.body.town.activityDate, '2026-10-05', 'create 的响应里就带回来');
  const id = created.body.town.id;
  assert.equal(stub.docs.get(id).activityDate, '2026-10-05', '与名片同一条文档落库，不是丢了');

  const updated = await svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id, activityDate: '2026-10-12' }), owner: 'token-a' });
  assert.equal(updated.body.town.activityDate, '2026-10-12', 'update 改得动');

  // 新进程 = 新容器：同一个库、全新的 /tmp 文件
  const second = createFarmtownService(opts);
  assert.equal((await second.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' })).body.towns[0].activityDate, '2026-10-12', 'my 读得回');
  assert.equal((await second.dispatch({ method: 'GET', path: '/api/farmtown/list' })).body.towns.find(town => town.id === id).activityDate, '2026-10-12', '公开列表读得回');
  assert.equal((await second.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } })).body.town.activityDate, '2026-10-12', '详情读得回');
});

test('activityDate 走文件方案：写进 JSON 文件、重启也读得回', async t => {
  const file = path.join(tempDir(t, 'farmtown-date-file-'), 'guayouji-farmtown.json');
  const first = createFarmtownService({ file: file });
  const created = await first.dispatch({ method: 'POST', path: '/api/farmtown/create', body: Object.assign({}, TOWN_BODY, { activityDate: '2026-10-05' }), owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.equal(created.body.town.activityDate, '2026-10-05');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.towns[0].activityDate, '2026-10-05', '文件方案也真的落盘');

  const restarted = createFarmtownService({ file: file });
  const detail = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: created.body.town.id } });
  assert.equal(detail.body.town.activityDate, '2026-10-05', '重启后读得回');
});

test('老名片没有 activityDate：照旧读得回、不报错，也不凭空补一个日期', async t => {
  const stub = createSdkStub();
  stub.docs.set(LEGACY_TOWN.id, Object.assign({ storedAt: 1 }, LEGACY_TOWN));
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-no-date-'), 'store.json') }, DB, { sdk: stub.sdk }));

  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  const legacy = list.body.towns.find(town => town.id === LEGACY_TOWN.id);
  assert.ok(legacy, '老名片照旧读得回');
  assert.ok(!('activityDate' in legacy), '老记录不被补出 activityDate 键（没有就是没有）');
  assert.ok(!('activityDate' in (await svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: LEGACY_TOWN.id } })).body.town));

  // 不带这一项建名片（老客户端）：照旧 200，空串（与 city / county / wechat 这些可选字段同一口径），不编日期
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.equal(created.body.town.activityDate, '');
  // 传空串能把已填的日期清掉（不卡住旧值）
  const id = created.body.town.id;
  const filled = await svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id, activityDate: '2026-10-05' }), owner: 'token-a' });
  assert.equal(filled.body.town.activityDate, '2026-10-05');
  const cleared = await svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: Object.assign({}, TOWN_BODY, { id: id, activityDate: '' }), owner: 'token-a' });
  assert.equal(cleared.body.town.activityDate, '');
});
