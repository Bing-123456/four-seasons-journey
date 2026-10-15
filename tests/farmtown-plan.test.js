'use strict';
// 果乡名片带活动方案（方案 B：跟名片一起存到服务端）的服务端守卫。
// 方案原先只暂存在果农手机上（miniprogram/lib/plan-draft.js），「我的发布」卡片只能在本机看到；
// 现在它跟着 /api/farmtown/create|update 一起存，由 publicTown / 列表原样返回。
// 这份测试盯住四件事（对应验收 4 的四条）：
//   ① 带 plan 建 / 改 → 存进云数据库、重启后读得回来（响应、my、list、detail 都带）；
//   ② 不带 plan → 一切照旧：响应与库里都没有 plan 这个键（老记录与改造前逐字一致）；
//   ③ plan 形状 / 类型 / 长度不合法 → 按既有风格处理：当「没传」，接口不报错、名片照旧存下来；
//   ④ 老记录（压根没有 plan 字段）读取不报错，字段与改造前一致。
// 桩与 tests/farmtown.test.js 同一套（真 SDK 签名：doc(id).set 是 upsert、不接受 _id）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createFarmtownService } = require('../server/farmtown');
const { InputError } = require('../server/validation');

// 本文件全程不碰真实云环境：显式清掉可能存在的环境变量，数据库一律用 stub。
delete process.env.TCB_ENV_ID;
delete process.env.TCB_ACCESS_KEY;
delete process.env.FARMTWON_DATA_FILE;

const DB = { envId: 'env-test', accessKey: 'ak-test' };

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

const TOWN_BODY = {
  name: '山东莱阳 · 老张梨园', province: '山东', city: '烟台市', county: '莱阳市', fruit: '梨',
  experiences: ['采摘', '观光'], description: '老梨园三十年树龄，秋分后采摘，鸭梨脆甜多汁。',
  address: '莱阳市照旺庄镇老张梨园', openDate: '2026-09-01', openTime: '08:00',
  closeDate: '2026-10-20', closeTime: '18:00', wechat: 'laozhang', phone: '13800000000',
  location: { latitude: 36.97, longitude: 120.71 }
};

// 一份合规的方案：标题一条、步骤 4 条（形状与客户端 draftFrom 存下来的那份一致）。
const PLAN = {
  title: '梨园秋分小课堂',
  steps: [
    '到园先集合，带客人绕园走一圈，讲这梨与当下的时令。',
    '说清采摘范围与方式，发下小筐，各自去挑合乎标准的梨。',
    '摘够后坐下歇一歇，尝梨、称重、装袋，当场结清。',
    '照手艺小课堂的做法熬一小罐梨膏，写下日期带走。'
  ]
};
const planBody = extra => Object.assign({}, TOWN_BODY, { plan: PLAN }, extra || {});

// 老记录：库里 / 旧 /tmp 文件里就是这份形状（没有任何 plan 字段），字段与改造前逐字一致。
// ownerId 按 farmtown.js 的同一套算法从 token 推出来（owner-of-<sha256 前 16 位>），这样
// 「老名片补一份方案」走的就是普通的 update，不是特判出来的另一条路径。
const LEGACY_TOKEN = 'legacy-token';
const LEGACY_TOWN = {
  id: 'townoldcard', favId: 'fruit-town:townoldcard', published: true,
  ownerId: 'owner-' + createHash('sha256').update(LEGACY_TOKEN).digest('hex').slice(0, 16),
  createdAt: '2026-09-30', polishedDescription: '', image: '',
  name: '江西南丰 · 旧名片蜜桔园', province: '江西', city: '抚州市', county: '南丰县', fruit: '蜜桔',
  term: '秋分', experiences: ['采摘'], description: '迁移前的旧记录。', address: '南丰县某村',
  openDate: '2026-09-01', openTime: '08:00', closeDate: '2026-10-01', closeTime: '18:00',
  wechat: '', phone: '', location: { latitude: 27.22, longitude: 116.53 }
};
// 老记录读出来的公开字段（LEGACY_TOWN 减去 ownerId / storedAt，逐字照改造前的行为写死）：
// 这份名单里没有 plan —— 老记录不会因为这次改动多出任何字段。
const LEGACY_KEYS = ['address', 'city', 'closeDate', 'closeTime', 'county', 'createdAt', 'description',
  'experiences', 'favId', 'fruit', 'id', 'image', 'location', 'name', 'openDate', 'openTime', 'phone',
  'polishedDescription', 'province', 'published', 'term', 'wechat'].sort();

// ---- ① 带 plan 建 / 改：存得住、读得回 ----

test('带 plan 建名片：存进云数据库同一份文档，重启后 my / list / detail 都带得回来', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-plan-persist-');
  const opts = Object.assign({ file: path.join(dir, 'store.json') }, DB, { sdk: stub.sdk });
  const first = createFarmtownService(opts);

  const created = await first.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.town.plan, PLAN, 'create 的响应里就要带这份方案（原话，不加工）');
  const id = created.body.town.id;
  assert.deepEqual(stub.docs.get(id).plan, PLAN, '方案与名片同一条文档落库，不是第二张表');

  // 新进程 = 新容器：同一个库、全新的 /tmp 文件
  const second = createFarmtownService(opts);
  const mine = await second.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns[0].plan, PLAN, '「我的发布」读回来仍是这份方案');
  const list = await second.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.deepEqual(list.body.towns.find(town => town.id === id).plan, PLAN, '公开列表也带方案');
  const detail = await second.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } });
  assert.deepEqual(detail.body.town.plan, PLAN, '详情也带方案');
  assert.ok(!('ownerId' in detail.body.town) && !('storedAt' in detail.body.town), '内部字段照旧不外泄');
});

test('带 plan 改名片：换掉原来那份；改完重启仍读得回新方案', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-plan-update-');
  const opts = Object.assign({ file: path.join(dir, 'store.json') }, DB, { sdk: stub.sdk });
  const svc = createFarmtownService(opts);
  const id = (await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-a' })).body.town.id;

  const next = { title: '霜降摘梨半天场', steps: PLAN.steps.slice(0, 3) };
  const updated = await svc.dispatch({
    method: 'POST', path: '/api/farmtown/update',
    body: Object.assign({}, TOWN_BODY, { id: id, name: '改名后的梨园', plan: next }), owner: 'token-a'
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.town.plan, next, 'update 换掉的是这一整份方案');

  const restarted = createFarmtownService(opts);
  const mine = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns[0].plan, next);
  assert.equal(mine.body.towns[0].name, '改名后的梨园', '其它字段语义一个字没动');
});

// ---- ② 不带 plan：一切照旧 ----

test('不带 plan 建名片：响应与库里都没有 plan 这个键，其它字段与改造前逐字一致', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-none-'), 'x.json') }, DB, { sdk: stub.sdk }));

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: TOWN_BODY, owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.ok(!('plan' in created.body.town), '没传方案就不该凭空多出 plan 键');
  const id = created.body.town.id;
  assert.ok(!('plan' in stub.docs.get(id)), '库里这条记录也没有 plan 键');

  ['city', 'county', 'fruit', 'experiences', 'description', 'wechat', 'phone', 'term', 'location',
    'address', 'openDate', 'openTime', 'closeDate', 'closeTime'].forEach(key => assert.ok(key in created.body.town, '缺字段 ' + key));

  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  const detail = await svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } });
  assert.ok(!('plan' in mine.body.towns[0]) && !('plan' in list.body.towns.find(town => town.id === id)) && !('plan' in detail.body.town));
});

// 库里**已经存在**的演示果乡（id 前缀 townseed + ownerId='seed'）。服务端已不再自动播种（SEED_TOWNS /
// seedIfEmpty 已删），这类老记录只能像线上那样「本来就躺在库里」——由测试直接写进数据库桩，故意不带 plan 键。
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

test('库里已有的 8 个演示果乡照旧没有 plan（老数据不被补字段，且照旧读得回）', async t => {
  const stub = createSdkStub();
  seedExistingTowns(stub);                      // 老记录本来就躺在库里，不是自动播种出来的
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-seed-'), 'x.json') }, DB, { sdk: stub.sdk }));
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.body.towns.length, 8, '库里那 8 条老记录照旧读得回');
  list.body.towns.forEach(town => assert.ok(!('plan' in town), '演示果乡 ' + town.id + ' 不该有 plan'));
});

// ---- ③ 形状 / 类型 / 长度不合法：当「没传」，不报错 ----

test('plan 形状不合法 → 按既有风格当「没传」：接口 200、库里没有 plan，其它字段照旧存下来', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-bad-'), 'x.json') }, DB, { sdk: stub.sdk }));

  // v59：上限放宽成 标题 ≤120 / 每条步骤 ≤270（只放宽不收紧，英文长方案才存得下），
  // 这里跟着改成新口径的越界样本。
  const longTitle = '梨'.repeat(121);           // 标题 > 120
  const longStep = '步'.repeat(271);            // 单步 > 270
  const bad = [
    ['plan 是字符串', '梨园方案'],
    ['plan 是数组', []],
    ['plan 是 null', null],
    ['plan 是数字', 42],
    ['标题为空', { title: '   ', steps: PLAN.steps }],
    ['标题超过 120 字', { title: longTitle, steps: PLAN.steps }],
    ['标题不是字符串', { title: 123, steps: PLAN.steps }],
    ['steps 不是数组', { title: '方案', steps: '第一步' }],
    ['steps 只有 2 条', { title: '方案', steps: PLAN.steps.slice(0, 2) }],
    ['steps 有 7 条', { title: '方案', steps: PLAN.steps.concat(['五', '六', '七']) }],
    ['单步超过 270 字', { title: '方案', steps: [PLAN.steps[0], longStep, PLAN.steps[2]] }],
    ['单步不是字符串', { title: '方案', steps: [PLAN.steps[0], { text: '第二步' }, PLAN.steps[2]] }],
    ['单步是空白串', { title: '方案', steps: [PLAN.steps[0], '   ', PLAN.steps[2]] }]
  ];

  for (const [label, plan] of bad) {
    const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody({ plan }), owner: 'token-a' });
    assert.equal(created.status, 200, label + '：不该让发布失败');
    assert.ok(!('plan' in created.body.town), label + '：不合法就该当没传（响应里没有 plan）');
    assert.ok(!('plan' in stub.docs.get(created.body.town.id)), label + '：库里也不该留下半份方案');
    assert.equal(created.body.town.name, TOWN_BODY.name, label + '：名片本身照旧存下来');
    assert.deepEqual(created.body.town.experiences, TOWN_BODY.experiences, label + '：其它字段不受影响');
  }

  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.equal(mine.body.towns.length, bad.length, '每一次都真的建出了一张名片');
  mine.body.towns.forEach(town => assert.ok(!('plan' in town)));
});

test('update 传了不合法的 plan：当没传，原来那份方案照旧在（不清空、不报错）', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-badup-'), 'x.json') }, DB, { sdk: stub.sdk }));
  const id = (await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-a' })).body.town.id;

  const updated = await svc.dispatch({
    method: 'POST', path: '/api/farmtown/update',
    body: Object.assign({}, TOWN_BODY, { id: id, plan: { title: '只有一步', steps: ['就这一步'] } }), owner: 'token-a'
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.town.plan, PLAN, '不合法的方案 = 没传：老的那份不动，也不报错');
});

test('update 不带 plan：原来那份方案照旧（其它字段照改）', async t => {
  const stub = createSdkStub();
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-keep-'), 'x.json') }, DB, { sdk: stub.sdk }));
  const id = (await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-a' })).body.town.id;

  const updated = await svc.dispatch({
    method: 'POST', path: '/api/farmtown/update',
    body: Object.assign({}, TOWN_BODY, { id: id, name: '只改了名字的梨园' }), owner: 'token-a'
  });
  assert.equal(updated.body.town.name, '只改了名字的梨园');
  assert.deepEqual(updated.body.town.plan, PLAN, '其它字段的既有语义照旧：没传的字段保持原值');
});

// ---- ④ 老记录（没有 plan）读取不报错 ----

test('老记录（没有 plan 字段）读取不报错：公开字段与改造前逐字一致', async t => {
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-plan-legacy-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, towns: [LEGACY_TOWN] }), 'utf8');
  const svc = createFarmtownService(Object.assign({ file: file }, DB, { sdk: stub.sdk }));

  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.towns.map(town => town.id), ['townoldcard']);
  assert.deepEqual(Object.keys(list.body.towns[0]).sort(), LEGACY_KEYS, '老记录的字段不多不少，与改造前一致');
  assert.ok(!('plan' in list.body.towns[0]));

  const detail = await svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: 'townoldcard' } });
  assert.equal(detail.status, 200);
  assert.ok(!('plan' in detail.body.town));

  // 老记录上补一份方案 = 正常的 update，不是特殊路径
  const updated = await svc.dispatch({
    method: 'POST', path: '/api/farmtown/update',
    body: Object.assign({}, LEGACY_TOWN, { plan: PLAN }), owner: LEGACY_TOKEN
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.town.plan, PLAN, '老名片也能补上方案');
  assert.deepEqual(updated.body.town.experiences, LEGACY_TOWN.experiences);
});

test('数据库不可用退回文件方案时，plan 照旧存得住、读得回', async t => {
  const dir = tempDir(t, 'farmtown-plan-file-');
  const file = path.join(dir, 'guayouji-farmtown.json');
  const svc = createFarmtownService({ file: file });   // 没配 TCB_* → 走文件方案
  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-a' });
  assert.equal(created.status, 200);
  const id = created.body.town.id;

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.towns.find(town => town.id === id).plan, PLAN, '文件方案下方案也在名片里（storedAt 是唯一不写盘的那个字段）');
  assert.ok(saved.towns.every(town => !('storedAt' in town)));

  const restarted = createFarmtownService({ file: file });
  const mine = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns[0].plan, PLAN);
});

test('无方案的请求照旧能读能写：list / my / detail 的响应外壳一个字没变', async t => {
  const svc = createFarmtownService(Object.assign({ file: path.join(tempDir(t, 'farmtown-plan-shell-'), 'x.json') }, DB, { sdk: createSdkStub().sdk }));
  const list = await svc.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.deepEqual(Object.keys(list.body), ['towns']);
  const mine = await svc.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'nobody' });
  assert.deepEqual(Object.keys(mine.body), ['towns']);
  await assert.rejects(
    () => svc.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: 'missing' } }),
    error => error instanceof InputError && error.status === 404 && error.code === 'not_found'
  );
});

// ---- ⑤ v59：英文口径的长方案（每条 120+ 字符）照旧存得住、读得回 ----
// 背景：英文活动方案的步骤天然比中文长（server/tasks.js 的英文输出指令要求每条 ≤220 字符），
// 旧口径（标题 ≤60 / 每条 ≤90）会把整份英文方案当「没传」丢掉 → 英文用户的「我的方案」整块不显示。
// 放宽后只影响「接受更长的方案」，中文侧照旧、老数据照旧。
const EN_PLAN = {
  title: 'Apple drying workshop weekend',
  steps: [
    'Meet at the gate, walk the picking rows with your guests and agree on the picking scope and method before anyone starts.',
    'Hand out small baskets and let each guest pick their own fruit; weigh and bag it on site instead of promising a fixed weight.',
    'Run the craft class from the notes you were given: guests wash, slice and dry the fruit while you watch the heat and the packing.',
    'Finish around the fruit-ticket game, then send everyone home with the jar or the dried tray they made, dated and labelled.'
  ]
};

test('v59 英文长方案（每条 120+ 字符，旧口径会整份丢掉）现在存得住、读得回、列表里也带得回来', async t => {
  EN_PLAN.steps.forEach(step => assert.ok(step.length > 90 && step.length <= 270, '采样要落在「旧口径超限、新口径内」：' + step.length));
  const stub = createSdkStub();
  const dir = tempDir(t, 'farmtown-plan-en-');
  const opts = Object.assign({ file: path.join(dir, 'store.json') }, DB, { sdk: stub.sdk });
  const svc = createFarmtownService(opts);

  const created = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody({ plan: EN_PLAN }), owner: 'token-a' });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.town.plan, EN_PLAN, '英文长方案要原样存住（不再被当「没传」）');
  const id = created.body.town.id;
  assert.deepEqual(stub.docs.get(id).plan, EN_PLAN, '库里也是这一整份，没被截断');

  // 新进程 = 新容器：同一个库、全新的 /tmp 文件
  const restarted = createFarmtownService(opts);
  const mine = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/my', owner: 'token-a' });
  assert.deepEqual(mine.body.towns[0].plan, EN_PLAN, '「我的发布」读回来仍是这份英文方案');
  const list = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/list' });
  assert.deepEqual(list.body.towns.find(town => town.id === id).plan, EN_PLAN, '公开列表也带得回来');
  const detail = await restarted.dispatch({ method: 'GET', path: '/api/farmtown/detail', query: { id: id } });
  assert.deepEqual(detail.body.town.plan, EN_PLAN, '详情也带得回来');

  // 新口径的边界：正好 270 字符的单步收得下；中文侧的老样本照旧存得住（只放宽不收紧）
  const atLimit = { title: 'Apple drying weekend', steps: ['a'.repeat(270), 'b'.repeat(120), 'c'.repeat(120)] };
  const boundary = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody({ plan: atLimit }), owner: 'token-b' });
  assert.equal(boundary.status, 200);
  assert.deepEqual(boundary.body.town.plan, atLimit, '270 字符的单步正好在口径内，收得下');
  const chinese = await svc.dispatch({ method: 'POST', path: '/api/farmtown/create', body: planBody(), owner: 'token-c' });
  assert.deepEqual(chinese.body.town.plan, PLAN, '中文侧（每条 ≤90 字）照旧原样存住');
  assert.equal(chinese.body.town.plan.title, '梨园秋分小课堂', '中文标题一字未变');
});
