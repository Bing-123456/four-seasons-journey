'use strict';
// 果乡名片服务（P13 果农工作台 / 行程重构）：提供果乡名片的增删改查与 AI 润色。
//
// 【2026-10-11 存储根治】原方案沿用 bookings.js 的 JSON 文件方案（默认 /tmp/guayouji-farmtown.json），
// 但云容器的 /tmp 每次部署/重启即清空 —— 实测部署 guayouji-server-058 前后打同一个 /api/farmtown/list，
// 条数从 9 掉到 1，果农自己发布的名片一重启就永久丢失。现改为云数据库集合 farmtown_towns，
// 写法照 server/community.js（@cloudbase/node-sdk：db.collection(...)、doc(id).set(...)、orderBy(...)、
// createCollection，时间戳用 Date.now()）：
//   · 一个果乡一条文档，文档 _id 就是果乡 id（doc(id).set 在该 SDK 里是 upsert：merge:false + upsert:true）；
//   · 数据库未配置 / 连不上 / 读写失败 → 自动退回原文件方案，接口不崩、报错口径与旧版一致；
//   · 【2026-10-17 变更】**不再自动播种演示果乡**：库里没有名片时就是没有，启动 / 首个请求都不会再凭空
//     造出 townseeda…townseedh 那 8 张（此前会在库为空时灌入；只取消自动造数据，演示果乡本身不删：
//     库里/migrated 旧数据里已经存在的演示果乡照旧读得回，也照旧受删除接口保护，见下方 remove()）；
//   · 库为空而旧 /tmp 文件还有记录时，启动顺带迁移进库（迁移失败只记日志，不影响启动）；
//   · 对外契约（/api/farmtown/list、detail、my、create、update、unpublish、polish 的请求/响应字段、
//     状态码、错误 code）与改造前逐字一致；dispatch 由同步改为返回 Promise，调用方 await 即可。
//     【2026-10-15 新增】第 7 条路由 POST /api/farmtown/delete（body {id}）：删自己的名片，权限/归属同 unpublish，
//     演示种子（townseed* / ownerId='seed'）403 forbidden 不许删；不存在 → 404 not_found（口径同 unpublish）。
//     【2026-10-16】果乡资料三项上限放宽（名称 20→60、水果 10→30、介绍 200→600，只放宽不收紧），
//     超限/缺字段的 400 响应在原有 error 文案与 code 之外多带 field / max / reason（见下方 dispatch）。
//     【2026-10-18】果乡名片新增**可选**字段 activityDate（可去日期）：create / update 落库，
//     list / detail / my 读回一并带上（走的是同一个 publicTown，不多写第二套白名单）；
//     老名片没有这个键照旧读得回、也不补假值（缺省空串，客户端整行不显示）。
//
// 节气按「水果 → 所属季节 → 代表节气」自动推导，缺省回退当前节气。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, createHash } = require('node:crypto');
const { InputError } = require('./validation');

const COLLECTION = 'farmtown_towns';
const SEED_OWNER = 'seed';
// 演示种子的 id 前缀（townseeda…townseedh）。删除接口靠它认出「不许删的演示名片」——
// 本服务已不再自动播种（见文件头）：这道判断守的是库里 / 迁移旧数据里**已经存在**的演示果乡。
const SEED_ID_PREFIX = 'townseed';
// 一次读回的上限：单个果农最多 100 张名片，这里给全库一个兜底上限（CloudBase 单次 get 上限 1000）。
const READ_LIMIT = 1000;

const digest = value => createHash('sha256').update(String(value)).digest('hex');
// extra 只用来挂机器可读的附加信息（field / max / reason），error 文案与 code 一个字都不动。
function fail(message, code = 'invalid_farmtown', status = 400, extra) {
  const error = new InputError(message, code, status);
  if (extra) Object.assign(error, extra);
  throw error;
}
// 2026-10-16 放宽果乡资料的三项上限（只放宽不收紧）：英文店名 / 水果名 / 介绍天然比中文长 ——
// 「Sunny Hill Fruit Farm」21 字、「Luochuan Wang Family Apple Orchard」34 字，旧口径 20 字直接把英文果农挡在门外。
// 老数据照旧读得回、老客户端照旧存得进，中文侧照旧能用，只是能写更长。
// 客户端的本地预校验用同一套数值（miniprogram/pages/seller/publish/publish-flow.js 的 FIELD_MAX）。
const NAME_MAX = 60;
const FRUIT_MAX = 30;
const DESC_MAX = 600;
// field 是给客户端认「哪一栏错了」的机器可读字段（只有下面这 3 个字段带），reason 区分「没填」与「超限」。
// 不点名 field 的字段（省份 / 具体位置 / 开关门时间…）保持原样：只带文案，不附任何新字段。
function text(value, label, max, optional, field) {
  const extra = field ? { field: field } : null;
  if (typeof value !== 'string' || !value.trim()) {
    if (optional) return '';
    if (extra) extra.reason = 'required';
    fail(label + '未填写或过长', 'invalid_farmtown', 400, extra);
  }
  value = value.trim();
  if (value.length > max) {
    if (extra) { extra.reason = 'too_long'; extra.max = max; }
    fail(label + '过长（最多 ' + max + ' 字）', 'invalid_farmtown', 400, extra);
  }
  return value;
}
function arrOf(value, label, maxEach, maxCount, allowed) {
  if (!Array.isArray(value)) fail(label + '格式不正确');
  const out = value.map(item => text(item, label, maxEach, false));
  if (allowed) { const set = new Set(allowed); const bad = out.find(item => !set.has(item)); if (bad) fail('不支持的' + label + '：' + bad); }
  if (out.length > maxCount) fail(label + '最多选 ' + maxCount + ' 个');
  return out;
}

// 水果 → 季节 → 代表节气（用于自动计算果乡所属节气）。
let fruitCulture, solarTermNotes;
try { fruitCulture = require('./miniprogram/data/fruit-culture'); } catch (error) { fruitCulture = require('../miniprogram/data/fruit-culture'); }
try { solarTermNotes = require('./miniprogram/data/solar-term-notes'); } catch (error) { solarTermNotes = require('../miniprogram/data/solar-term-notes'); }
const SEASON_TERM = { spring: '谷雨', summer: '夏至', autumn: '秋分', winter: '大寒' };
function termForFruit(fruit) {
  const name = String(fruit || '').trim();
  const season = (fruitCulture.seasons || []).find(s => (fruitCulture.seasonFruits(s) || []).some(f => f.name === name));
  if (season && SEASON_TERM[season.id]) return SEASON_TERM[season.id];
  return solarTermNotes.currentTerm(new Date());
}

// 收藏键：store.toggleKnowledgeFavorite 的校验要求小写+连字符…冒号…小写字母。
// 果乡名片的收藏键统一为 `fruit-town:<townId>`，townId 本身只含小写字母。
function favIdOf(townId) { return 'fruit-town:' + townId.replace(/[^a-z]/g, ''); }

// 新名片 id：town + 8 位小写字母（前缀 / 长度与改造前一致；老 id 只含 a-f，是这 8 位小写字母的子集，照旧能用）。
// 2026-10-14 修「id 太容易撞」：原写法 randomBytes(4).toString('hex').replace(/[^a-z]/g, 'a') 把十六进制里的
// 0-9 全换成 a，4 字节随机只剩十几个位真正可用（实测 13 连建撞 id 概率 19.5%）；而 upsert() 按 id 去重，
// 于是果农连发多张名片会「少一张」、测试偶发红。
// 这里不取十六进制：8 位取自 a-z ⇒ 26^8 ≈ 2.1e11 种（≈37.6 位），比 32 位十六进制还多，而且保住了 townId
// 「只含小写字母」这条既有约定 —— favIdOf() 只保留 a-z，客户端收藏键校验也只认 [a-z]（miniprogram/lib/store.js:305）：
// townId 一旦带数字，favId 会既互相撞车、又不再等于 'fruit-town:<id>'（乡野手记正是按这个等式匹配收藏的果乡）。
const ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function newTownId() {
  const bytes = randomBytes(8);
  let id = 'town';
  for (let i = 0; i < 8; i += 1) id += ID_LETTERS[bytes[i] % ID_LETTERS.length];
  return id;
}

const EXPERIENCES = ['采摘', '观光', '手作', '餐饮', '文化讲解'];

// 活动方案（2026-10-12）：这份方案原先只暂存在果农手机上（miniprogram/lib/plan-draft.js），
// 现在跟果乡名片一起存服务端 —— 果乡名片是它的唯一出处，「我的发布」卡片才显示得出来。
// 形状固定为一个紧凑对象 { title, steps[] }：title 一条，steps 3~6 条。
// 上限沿用仓库既有口径（server/validation.js 的 INSIGHT_CAPS：中文方案标题 40 字、每条步骤 90 字，
// 英文侧标题 120、每条步骤 270）—— 标题这里给到 120 字、每条给到 270 字，只放宽不收紧，
// 老客户端照旧存得进来。
// v59：英文活动方案的步骤天然比中文长（那条英文输出指令要求每条 ≤220 字符、备选 ≤300），
// 若仍按 90 字卡，整份方案会被当「没传」丢掉 → 英文用户的「我的方案」整块不显示。
// 这里不按语言分流（town payload 里也没有 lang）：只放宽不收紧，中文侧照旧存得下、老数据照旧读得回。
const PLAN_TITLE_MAX = 120;
const PLAN_STEP_MAX = 270;
const PLAN_STEPS_MIN = 3;
const PLAN_STEPS_MAX = 6;
// 附加信息不该让发布失败：没传 / 类型长度不合法一律当「没传」（返回 null），名片照旧存下来。
// 这一条与本文件其它字段的口径一致：`polish` 里不合法的体验标签也是 try/catch 当没传（第 364 行），
// 只有果乡资料本身的必填项缺失才 fail()。老记录压根没有 plan 字段，读取时与改造前逐字一致。
function planOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > PLAN_TITLE_MAX) return null;
  if (!Array.isArray(value.steps) || value.steps.length < PLAN_STEPS_MIN || value.steps.length > PLAN_STEPS_MAX) return null;
  const steps = [];
  for (const item of value.steps) {
    const step = typeof item === 'string' ? item.trim() : '';
    if (!step || step.length > PLAN_STEP_MAX) return null;
    steps.push(step);
  }
  return { title: title, steps: steps };
}

function createFarmtownService(options = {}) {
  const file = options.file || process.env.FARMTWON_DATA_FILE || path.join(os.tmpdir(), 'guayouji-farmtown.json');
  const now = options.now || (() => Date.now());
  const today = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
  const chat = options.chat || null;
  // 云数据库配置：与 community.js 同一套环境变量（TCB_ENV_ID / TCB_ACCESS_KEY）。
  const envId = options.envId || process.env.TCB_ENV_ID || '';
  const accessKey = options.accessKey || process.env.TCB_ACCESS_KEY || '';
  const providedSdk = options.sdk || null;

  // 内存缓存：与改造前一样的 { version, towns }；读走缓存，写「先库、失败再落文件」。
  let state = { version: 1, towns: [] };
  let booting = null;        // 首次加载（读库 + 迁移旧文件）只做一次
  let dbApp = null;          // @cloudbase/node-sdk 的 app 实例
  let collectionReady = false;
  let dbDead = false;        // 数据库确认不可用 → 本次进程内一律退回文件方案

  const reason = error => (error && error.message) ? String(error.message) : String(error);

  // ── 文件方案：改造前的老路径，保留为数据库未配置/不可用时的退路 ──────────────────
  function readFileTowns() {
    try {
      if (!fs.existsSync(file)) return null;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      return saved && Array.isArray(saved.towns) ? saved.towns : null;
    } catch (error) { return null; } // 损坏则按空库重建（与改造前一致）
  }
  // 落盘格式与改造前逐字一致（{ version: 1, towns: [...] }）：内部用的 storedAt 不写进文件，
  // 万一要回滚到旧代码，旧代码仍能原样读这份文件。
  function fileView(towns) {
    return towns.map(town => { const visible = Object.assign({}, town); delete visible.storedAt; return visible; });
  }
  function commitFile(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, towns: fileView(next.towns) }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
      state = next;
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) {} throw error; }
  }

  // ── 云数据库层（写法照 community.js：createCollection / doc().set / orderBy / limit / get）──
  async function openCollection() {
    if (dbDead || !envId || !accessKey) return null;
    try {
      if (!dbApp) {
        let sdk = providedSdk;
        if (!sdk) { try { sdk = require('@cloudbase/node-sdk'); } catch (error) { sdk = null; } }
        if (!sdk || typeof sdk.init !== 'function') return null;
        dbApp = sdk.init({ env: envId, accessKey: accessKey });
        if (!dbApp) return null;
      }
      const db = dbApp.database();
      if (!collectionReady) {
        try { await db.createCollection(COLLECTION); } catch (error) { /* 已存在或无权限：交给后续读写报错 */ }
        collectionReady = true;
      }
      return db.collection(COLLECTION);
    } catch (error) {
      console.error('[farmtown] 云数据库连接失败，退回文件方案：' + reason(error));
      dbDead = true;
      return null;
    }
  }

  function stripRow(row) { const town = Object.assign({}, row); delete town._id; return town; }

  // 读全库：排序优先走库（照 community.js 的 orderBy），万一该字段没索引排不了，
  // 退回无序读再在内存里按写入次序排 —— 保证「先写入、后发布」的列表顺序与改造前一致。
  async function readTowns(col) {
    let rows;
    try {
      const res = await col.orderBy('storedAt', 'asc').limit(READ_LIMIT).get();
      if (res && res.code) throw new Error('database code ' + res.code);
      rows = (res && res.data) || [];
    } catch (error) {
      const res = await col.limit(READ_LIMIT).get();
      if (res && res.code) throw new Error('database code ' + res.code);
      rows = (res && res.data) || [];
    }
    return rows
      .filter(row => row && typeof row === 'object' && typeof row.id === 'string')
      .map(stripRow)
      .sort((a, b) => (Number(a.storedAt) || 0) - (Number(b.storedAt) || 0));
  }

  // 写一条果乡：doc(id).set = 替换更新（不存在则创建），_id 用果乡 id；
  // payload 里绝不能带 _id（该 SDK 会直接报「不能更新_id的值」）。
  async function writeTown(col, town) {
    const record = Object.assign({}, town);
    delete record._id;
    const res = await col.doc(town.id).set(record);
    if (res && res.code) throw new Error('database code ' + res.code);
  }

  function withStoredAt(towns, base) {
    return towns.map((town, index) => Object.assign({}, town, { storedAt: Number(town.storedAt) || (base + index) }));
  }

  async function bootstrap() {
    const legacy = readFileTowns();
    const base = now();
    const col = await openCollection();
    if (col) {
      try {
        let towns = await readTowns(col);
        if (!towns.length && legacy && legacy.length) {
          // 库为空、旧 /tmp 文件还有记录：顺带迁移进库。
          // 迁移写失败（库只读 / 抖动）**不吞**：抛给外层 catch，与「库连不上」同等处理 ——
          // 本次启动退回文件方案，旧记录照旧读得到，绝不因为写不进去就把果农的旧名片读丢。
          // （改造前这里是「吞掉异常、再靠随后那步播种写失败把流程顶到外层 catch」的副作用；
          //   播种取消后这条退路必须显式留下，见 tests/farmtown.test.js 的「迁移失败」用例。）
          for (const town of withStoredAt(legacy, base)) await writeTown(col, town);
          towns = await readTowns(col);
          console.log('[farmtown] 已把旧文件里的 ' + towns.length + ' 条果乡名片迁入云数据库');
        }
        state = { version: 1, towns: towns };
        return;
      } catch (error) {
        console.error('[farmtown] 云数据库不可用，退回文件方案：' + reason(error));
        dbDead = true;
      }
    }
    state = { version: 1, towns: legacy ? withStoredAt(legacy, base) : [] };
  }

  function ensureReady() {
    if (!booting) {
      booting = bootstrap().catch(error => {
        booting = null; // 允许下一次请求重试，不把失败的初始化永久钉住
        console.error('[farmtown] 初始化失败，本次按空库继续：' + reason(error));
      });
    }
    return booting;
  }

  function upsert(towns, town) {
    return towns.some(item => item.id === town.id)
      ? towns.map(item => item.id === town.id ? town : item)
      : towns.concat(town);
  }
  // 写一个果乡：先写云数据库；未配置/写失败则退回文件方案（保持改造前的行为，接口不崩）。
  async function save(town) {
    const col = await openCollection();
    if (col) {
      try {
        await writeTown(col, town);
        state = { version: 1, towns: upsert(state.towns, town) };
        return;
      } catch (error) {
        // 单次写失败不永久降级：下次请求仍先试数据库；本次退回文件，保证果农填的东西不白填。
        console.error('[farmtown] 云数据库写入失败，本次退回文件方案：' + reason(error));
      }
    }
    commitFile({ version: 1, towns: upsert(state.towns, town) });
  }

  // 删一个果乡（2026-10-15 新增，给「删除」接口用）：与 save 完全同一策略 ——
  // 先删云数据库；未配置 / 删失败则退回文件方案，接口不崩、不半途而废。
  // doc(id).remove() 是本仓库既有的删文档写法（server/community.js:331 的 deletePost 同款）。
  async function drop(id) {
    const without = towns => towns.filter(item => item.id !== id);
    const col = await openCollection();
    if (col) {
      try {
        const res = await col.doc(id).remove();
        if (res && res.code) throw new Error('database code ' + res.code);
        state = { version: 1, towns: without(state.towns) };
        return;
      } catch (error) {
        // 与 save 一样：单次删失败不永久降级，下次请求仍先试数据库；本次退回文件，保证「说过删掉就别再出现」。
        console.error('[farmtown] 云数据库删除失败，本次退回文件方案：' + reason(error));
      }
    }
    commitFile({ version: 1, towns: without(state.towns) });
  }

  function publicTown(town) {
    const { ownerId, storedAt, ...visible } = town;
    return visible;
  }
  function ownerIdOf(token) { return 'owner-' + digest(String(token || 'anonymous')).slice(0, 16); }

  function normalize(input) {
    const id = input.id || newTownId();
    const name = text(input.name, '果乡名称', NAME_MAX, false, 'name');
    const province = text(input.province, '省份', 20);
    // 2026-10-08 新增：具体位置（果农自己打字的详细地址）+ 开关门日期与时间；全部必填
    const address = text(input.address, '具体位置', 80);
    const openDate = text(input.openDate, '开门日期', 20);
    const openTime = text(input.openTime, '开门时间', 10);
    const closeDate = text(input.closeDate, '关门日期', 20);
    const closeTime = text(input.closeTime, '关门时间', 10);
    const city = text(input.city, '城市', 20, true);
    const county = text(input.county, '区县', 20, true);
    const fruit = text(input.fruit, '当季水果', FRUIT_MAX, false, 'fruit');
    // 2026-10-18：果农自填的「可去日期」。客户端一直在送（pages/seller/publish/publish-flow.js 的
    // townPayload 里就是 activityDate，编辑态也从详情读回来回填），但这里白名单漏了这一项 → 存不进去，
    // 快讯 / ①去哪 名片的「可去日期」那行永远是空的。可选、上限 20 与 openDate 同口径；
    // 老名片没有这个键照旧读得回，也不会被补一个假日期（缺省就是空串，模板按空串整行不显示）。
    const activityDate = text(input.activityDate, '可去日期', 20, true);
    const experiences = arrOf(input.experiences || [], '体验标签', 6, 5, EXPERIENCES);
    const description = text(input.description, '果乡介绍', DESC_MAX, false, 'description');
    const wechat = text(input.wechat, '微信号', 50, true);
    const phone = text(input.phone, '手机号', 50, true);
    const term = text(input.term, '节气', 6, true) || termForFruit(fruit);
    let location = { latitude: 0, longitude: 0 };
    if (input.location && Number.isFinite(Number(input.location.latitude)) && Number.isFinite(Number(input.location.longitude))) {
      location = { latitude: Number(input.location.latitude), longitude: Number(input.location.longitude) };
    }
    const town = { id, name, province, city, county, fruit, activityDate, experiences, description, wechat, phone, term, location, address, openDate, openTime, closeDate, closeTime };
    // 方案是唯一一个「没有就不写这一项」的字段：白名单构造照旧，老记录与不带方案的新记录
    // 都不会凭空多出 plan 键（对外字段与改造前逐字一致）。
    const plan = planOf(input.plan);
    if (plan) town.plan = plan;
    return town;
  }

  async function list(query = {}) {
    await ensureReady();
    let towns = state.towns.filter(item => item.published);
    if (query.term) towns = towns.filter(item => item.term === query.term);
    if (query.province) towns = towns.filter(item => item.province === query.province);
    return { towns: towns.map(publicTown) };
  }
  async function detail(query = {}) {
    await ensureReady();
    const town = state.towns.find(item => item.id === query.id && item.published);
    if (!town) fail('果乡不存在或已下架', 'not_found', 404);
    return { town: publicTown(town) };
  }
  async function my(owner) {
    await ensureReady();
    const ownerId = ownerIdOf(owner);
    return { towns: state.towns.filter(item => item.ownerId === ownerId).map(publicTown) };
  }
  async function create(body, owner) {
    await ensureReady();
    const input = normalize(body);
    const ownerId = ownerIdOf(owner);
    if (state.towns.filter(item => item.ownerId === ownerId).length >= 100) fail('最多发布 100 个果乡名片', 'capacity', 503);
    const town = Object.assign(input, { favId: favIdOf(input.id), ownerId, published: true, createdAt: today(), polishedDescription: '', image: '', storedAt: now() });
    await save(town);
    return { town: publicTown(town) };
  }
  async function update(body, owner) {
    await ensureReady();
    const ownerId = ownerIdOf(owner);
    const existing = state.towns.find(item => item.id === body.id && item.ownerId === ownerId);
    if (!existing) fail('果乡不存在或无权修改', 'not_found', 404);
    const input = normalize(Object.assign({}, existing, body));
    const updated = Object.assign({}, existing, input, { favId: favIdOf(input.id), ownerId, storedAt: Number(existing.storedAt) || now() });
    await save(updated);
    return { town: publicTown(updated) };
  }
  async function unpublish(body, owner) {
    await ensureReady();
    const ownerId = ownerIdOf(owner);
    const existing = state.towns.find(item => item.id === body.id && item.ownerId === ownerId);
    if (!existing) fail('果乡不存在或无权下架', 'not_found', 404);
    const updated = Object.assign({}, existing, { published: false });
    await save(updated);
    return { town: publicTown(updated) };
  }

  // 删除（2026-10-15 新增）：口径照 unpublish 抄 —— 同一套 ownerId 归属校验、同样的 404 不存在口径，
  // 只多一道种子保护：演示果乡（ownerId === 'seed'，id 也统一是 townseed 前缀）谁都不许删。
  // 【2026-10-17】自动播种取消后这道保护照旧自立、且没有任何副作用：它只读 town（ownerId / id 前缀）
  // 判一判，不写库、不造数据；守的是库里与迁移旧数据里**已经存在**的演示果乡（云端那 8 条就是靠它拦住）。
  // 种子判定必须排在归属校验**之前**：种子的 ownerId 恒为 'seed'，永远不会等于请求方的 owner-xxxx，
  // 放到后面那条分支就永远走不到 —— 只能笼统报「不存在或无权删除」，分不清「不是你的名片」和「这是演示数据」。
  // （forbidden / 403 是本仓库既有口径，见 server/community.js:312 的「只能删除自己的评论」。）
  function isSeedTown(town) {
    return town.ownerId === SEED_OWNER || String(town.id || '').indexOf(SEED_ID_PREFIX) === 0;
  }
  async function remove(body, owner) {
    await ensureReady();
    const ownerId = ownerIdOf(owner);
    const existing = state.towns.find(item => item.id === body.id);
    // 不存在的 id：与 unpublish 一致报 404，不静默成功（删两次第二次就是 404，口径统一且可回归）
    if (!existing) fail('果乡不存在或无权删除', 'not_found', 404);
    if (isSeedTown(existing)) fail('演示果乡不能删除', 'forbidden', 403);
    // 归属校验与 update / unpublish 逐字同一套：只比 ownerId，不放宽、不外泄别人的名片是否存在
    if (existing.ownerId !== ownerId) fail('果乡不存在或无权删除', 'not_found', 404);
    await drop(existing.id);
    // 响应形状照 unpublish：{ town } —— 返回被删掉的那一张，客户端据此确认删的是哪张
    return { town: publicTown(existing) };
  }

  async function polish(body) {
    if (!chat || typeof chat.polish !== 'function') throw new InputError('润色服务未配置', 'model_disabled', 503);
    const description = text(body.description, '果乡介绍', DESC_MAX);
    if (!description) throw new InputError('请先填写果乡介绍', 'invalid_input', 400);
    const term = text(body.term, '节气', 6, true) || termForFruit(body.fruit);
    const fruit = text(body.fruit, '当季水果', FRUIT_MAX, true);
    // 2026-10-10：润色要围绕"这家果园"来写 —— 把果农填的地点/具体位置/体验/时段一并交给模型
    const region = text(body.region, '所在地区', 60, true);
    const address = text(body.address, '具体位置', 80, true);
    const openDate = text(body.openDate, '开门日期', 20, true);
    const openTime = text(body.openTime, '开门时间', 10, true);
    const closeDate = text(body.closeDate, '关门日期', 20, true);
    const closeTime = text(body.closeTime, '关门时间', 10, true);
    let experiences = [];
    try { experiences = arrOf(body.experiences || [], '体验标签', 6, 5, EXPERIENCES); } catch (error) { experiences = []; }
    try {
      const result = await chat.polish({ description, term, fruit, region, address, experiences, openDate, openTime, closeDate, closeTime });
      return { polishedText: text(result && result.polishedText, '润色结果', 300) || description };
    } catch (error) {
      throw new InputError('润色服务暂不可用', 'model_unavailable', 502);
    }
  }

  // 对外契约不变：路由、状态码、响应体字段与改造前一致，只是现在返回 Promise。
  async function handle({ method, path: route, query = {}, body = {}, owner }) {
    if (method === 'GET' && route === '/api/farmtown/list') return { status: 200, body: await list(query) };
    if (method === 'GET' && route === '/api/farmtown/detail') return { status: 200, body: await detail(query) };
    if (method === 'GET' && route === '/api/farmtown/my') return { status: 200, body: await my(owner) };
    if (method === 'POST' && route === '/api/farmtown/create') return { status: 200, body: await create(body, owner) };
    if (method === 'POST' && route === '/api/farmtown/update') return { status: 200, body: await update(body, owner) };
    if (method === 'POST' && route === '/api/farmtown/unpublish') return { status: 200, body: await unpublish(body, owner) };
    // 2026-10-15 新增（第 7 条路由）：删除自己的果乡名片，body { id }
    if (method === 'POST' && route === '/api/farmtown/delete') return { status: 200, body: await remove(body, owner) };
    fail('果乡接口不存在', 'not_found', 404);
  }

  // dispatch 与 handle 只差一件事：带机器可读 field 的输入错误（果乡名称 / 当季水果 / 果乡介绍）
  // 就地转成响应返回，让 400 的响应体里多出 field / max / reason 三项。
  // 为什么不让它继续往上抛：HTTP 层（server/app.js 的 catch）只透出 error 与 code 两个字段，
  // 抛上去这两个新字段就没机会进响应体；果农这一端于是永远分不清「哪一栏、超了多少」。
  // 响应体里原有那两项逐字不变（error 文案、code、状态码都一样），不改任何既有调用方的判断。
  // 其余错误（404 / 403 / 容量 / 数据库不可用…）一个字不动，照旧往上抛。
  async function dispatch(input) {
    try {
      return await handle(input);
    } catch (error) {
      if (!(error instanceof InputError) || !error.field) throw error;
      const body = { error: error.message, code: error.code, field: error.field };
      if (error.max) body.max = error.max;
      if (error.reason) body.reason = error.reason;
      return { status: error.status, body: body };
    }
  }

  return { dispatch, polish, _state: () => state };
}
module.exports = { createFarmtownService, favIdOf, termForFruit, EXPERIENCES, COLLECTION };
