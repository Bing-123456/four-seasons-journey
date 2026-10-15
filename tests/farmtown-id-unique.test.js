'use strict';
// 防回归：新名片的 id 必须「只用本仓库的合法字符、且不损失熵」。
// 背景（2026-10-14 修的既有 bug，server/farmtown.js normalize()）：
//   原写法 'town' + randomBytes(4).toString('hex').replace(/[^a-z]/g, 'a').slice(0, 10)
//   那个 replace 把十六进制里的 0-9 全换成 a —— 4 字节随机只剩十几个位真正可用，
//   实测 13 连建撞 id 概率 19.5%（20 万次抽样）；而 upsert() 按 id 去重 →
//   果农连发多张名片会「少一张」，tests/farmtown-plan.test.js 那条用例偶发红。
//   修复 = 用 newTownId()：town + 8 位取自 a-z 的小写字母（26^8 ≈ 2.1e11 种，≈37.6 位，比 32 位十六进制还多）。
//   为什么不直接用十六进制（0-9a-z）？因为 townId「只含小写字母」是本仓库的既有约定：
//   favIdOf() 会把非 a-z 的字符去掉，客户端收藏键校验也只认 [a-z]（miniprogram/lib/store.js:305）——
//   townId 一旦带数字，fav 键会既互相撞车、又不再等于 'fruit-town:<id>'（乡野手记按这个等式匹配收藏的果乡）。
//   所以这里同时钉住「不撞 id」与「favId 等式不变」两件事。
//
// 本文件两把锁：
//   ① 连建 20 张：id 全不重复、张数正确、entropy 真的用到了字母表，favId 等式与客户端校验都照旧。
//      为了不靠运气，这里把 crypto.randomBytes 换成确定性计数器桩（第 k 次调用给末字节 k）：
//      旧写法会把这 20 个 id 全部塌成 townaaaaaaaa → 这个用例必然红；新写法必然绿，不抖。
//   ② 老数据兼容（不做迁移）：老形状的 id（只含 a-f、甚至就是塌陷的 townaaaaaaaa）
//      照旧能当 id 用：显式传进来的 id 原样保留、detail / update 都找得到。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 本文件全程不碰真实云环境：显式清掉可能存在的环境变量，数据库一律用 stub。
delete process.env.TCB_ENV_ID;
delete process.env.TCB_ACCESS_KEY;
delete process.env.FARMTWON_DATA_FILE;

const DB = { envId: 'env-test', accessKey: 'ak-test' };

// ── 确定性随机桩 ──
// farmtown.js 是「加载时解构」randomBytes 的，所以必须在 require 之前换掉；换完立刻还原真实实现，
// 免得影响本进程里别的东西（本文件本身不需要真随机）。
// 桩的输出：第 k 次调用 = size 字节，末字节为 k、其余为 0 —— 同一轮里每个 k 必然不同，
// 而旧写法（hex → replace(/[^a-z]/g,'a')）会把这些末字节（十六进制数字）全塌成 a，于是 id 全撞在一起。
const crypto = require('node:crypto');
const realRandomBytes = crypto.randomBytes;
let draws = 0;
crypto.randomBytes = size => {
  draws += 1;
  const buf = Buffer.alloc(size, 0);
  let rest = draws;
  for (let i = size - 1; i >= 0 && rest > 0; i -= 1) { buf[i] = rest & 0xff; rest = Math.floor(rest / 256); }
  return buf;
};
const { createFarmtownService, favIdOf } = require('../server/farmtown');
crypto.randomBytes = realRandomBytes;

function createSdkStub() {
  const docs = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const readAll = () => Array.from(docs.entries())
    .map(([id, doc]) => Object.assign({ _id: id }, clone(doc)))
    .sort((a, b) => (Number(a.storedAt) || 0) - (Number(b.storedAt) || 0));
  const query = () => ({
    orderBy: () => query(),
    limit: () => query(),
    get: async () => ({ data: readAll() })
  });
  const collection = {
    doc: id => ({
      set: async data => {
        if (data && Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('不能更新_id的值');
        docs.set(id, clone(data));
        return { updated: 1, upsertedId: id };
      },
      get: async () => ({ data: docs.has(id) ? [Object.assign({ _id: id }, clone(docs.get(id)))] : [] })
    }),
    orderBy: () => query(),
    limit: () => query(),
    get: async () => query().get()
  };
  return {
    sdk: { init: () => ({ database: () => ({ collection: () => collection, createCollection: async () => {} }) }) },
    docs: docs
  };
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* 清理失败不影响结论 */ } });
  return dir;
}

// 一份必填字段齐全的名片请求体（与 tests/farmtown.test.js / farmtown-plan.test.js 同一套）。
const TOWN_BODY = {
  name: '山东莱阳 · 老张梨园', province: '山东', city: '烟台市', county: '莱阳市', fruit: '梨',
  experiences: ['采摘', '观光'], description: '老梨园三十年树龄，秋分后采摘，鸭梨脆甜多汁。',
  address: '莱阳市照旺庄镇老张梨园', openDate: '2026-09-01', openTime: '08:00',
  closeDate: '2026-10-20', closeTime: '18:00', wechat: 'laozhang', phone: '13800000000',
  location: { latitude: 36.97, longitude: 120.71 }
};
const body = extra => Object.assign({}, TOWN_BODY, extra || {});

// ---- ① 连建 20 张：id 全不重复、张数正确（旧写法在这里必然塌陷成同一个 id）----

test('连建 20 张名片：id 全不重复、张数正确（id 生成不损失熵，favId 等式照旧）', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign(
    { file: path.join(tempDir(t, 'farmtown-id-unique-'), 'x.json') }, DB, { sdk: stub.sdk }
  ));

  const ids = [];
  for (let i = 1; i <= 20; i += 1) {
    const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: body({ name: '第 ' + i + ' 号梨园' }), owner: 'token-a' });
    assert.equal(created.status, 200, '第 ' + i + ' 张：发布不该失败');
    ids.push(created.body.town.id);
  }

  assert.equal(new Set(ids).size, 20, '20 张名片的 id 必须两两不同（旧写法会全部塌成 townaaaaaaaa）');
  ids.forEach(id => assert.match(id, /^town[a-z]{8}$/, 'id 形状不变：town + 8 位小写字母，实际拿到 ' + id));
  // 熵的守卫：旧写法把 hex 的 0-9 全换成 a，实际只用到 a-f 里很少几个字母（a 占 11/16）；
  // 正常实现下这 20 个 id 会铺开一大片字母（桩下为 b..u 加 town / a，共 25 个不同字符），远多于 6。
  const letters = new Set(ids.join('').split(''));
  assert.ok(letters.size >= 10, 'id 的随机位必须真的用到字母表（实际只用到 ' + letters.size + ' 个不同字符：' + Array.from(letters).sort().join('') + '）');

  // favId 的等式与格式是既有对外口径，不能因为换了 id 生成方式而变。
  ids.forEach(id => {
    assert.equal(favIdOf(id), 'fruit-town:' + id, '收藏键仍是 fruit-town:<id>（乡野手记按这个等式匹配收藏的果乡）');
    assert.match(favIdOf(id), /^[a-z-]+-[a-z-]+:[a-z]+$/, '收藏键仍满足客户端 store.toggleKnowledgeFavorite 的校验');
  });

  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.equal(mine.body.towns.length, 20, '20 次发布 = 20 张名片，一张都不能被同 id 覆盖掉');
  assert.equal(new Set(mine.body.towns.map(town => town.id)).size, 20, '「我的发布」里也没有重复 id');
  assert.equal(new Set(mine.body.towns.map(town => town.favId)).size, 20, '20 个收藏键同样两两不同（不会串味）');

  // 自动播种已删（server/farmtown.js 不再造 townseeda…townseedh）：库里就该只有这 20 张，没有多出来的种子。
  const createdIds = Array.from(stub.docs.keys());
  assert.equal(createdIds.length, 20, '云数据库里就是 20 条各自独立的文档（不再自动播种演示果乡）');
  assert.equal(stub.docs.size, 20, '库里 = 刚发布的 20 张，一张不多一张不少');
});

// ---- ② 老数据兼容：老形状的 id 照旧能用，显式传进来的 id 一个字符都不改 ----

test('老形状 id 照旧可用：显式 id 原样保留，老名片 detail / update 都找得到（不做迁移）', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign(
    { file: path.join(tempDir(t, 'farmtown-id-legacy-'), 'x.json') }, DB, { sdk: stub.sdk }
  ));
  // 两个都是「旧写法真实产出过」的 id：正常的老 id（只含 a-f）与塌陷到极致的 townaaaaaaaa。
  const legacyIds = ['townaeabdaca', 'townaaaaaaaa'];

  for (const legacyId of legacyIds) {
    const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: body({ id: legacyId, name: '老名片 ' + legacyId }), owner: 'token-a' });
    assert.equal(created.status, 200);
    assert.equal(created.body.town.id, legacyId, '果农 / 老客户端带上来的 id 原样保留，不重写');

    const detail = await svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: legacyId } });
    assert.equal(detail.body.town.id, legacyId, '老 id 照旧查得到详情');

    const updated = await svc.dispatch({ method: 'POST', path: '/api/farmtown/update', body: body({ id: legacyId, name: '改名后的老名片' }), owner: 'token-a' });
    assert.equal(updated.body.town.id, legacyId, 'update 不改 id');
    assert.equal(updated.body.town.name, '改名后的老名片');
  }

  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns.map(town => town.id).sort(), legacyIds.slice().sort(), '两张老 id 名片各是一张，没有被互相覆盖');
});
