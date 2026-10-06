'use strict';
// 果乡名片服务（P13 果农工作台 / 行程重构）：提供果乡名片的增删改查与 AI 润色。
// 存储沿用 bookings.js 的 JSON 文件方案，路径 /tmp/guayouji-farmtown.json。
// 节气按「水果 → 所属季节 → 代表节气」自动推导，缺省回退当前节气。
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { InputError } = require('./validation');

const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(String(value)).digest('hex');
function fail(message, code = 'invalid_farmtown', status = 400) { throw new InputError(message, code, status); }
function text(value, label, max, optional) {
  if (typeof value !== 'string' || !value.trim()) { if (optional) return ''; fail(label + '未填写或过长'); }
  value = value.trim();
  if (value.length > max) fail(label + '过长（最多 ' + max + ' 字）');
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

const EXPERIENCES = ['采摘', '观光', '手作', '餐饮', '文化讲解'];

function createFarmtownService(options = {}) {
  const file = options.file || process.env.FARMTWON_DATA_FILE || path.join(require('node:os').tmpdir(), 'guayouji-farmtown.json');
  const now = options.now || (() => Date.now());
  const today = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
  const chat = options.chat || null;

  let state = { version: 1, towns: [] };
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && Array.isArray(saved.towns)) state = { version: 1, towns: saved.towns };
    } catch (error) { /* 损坏则按空库重建 */ }
  }

  function commit(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); state = next; }
    catch (error) { try { fs.unlinkSync(temp); } catch (_) {} throw error; }
  }

  // 仅当库为空时播种演示数据，让「四时果乡漫游」地图一上来就有内容。
  function seedIfEmpty() {
    if (state.towns.length) return;
    const seeds = [
      { name: '陕西洛川 · 王大爷苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果', term: '秋分', experiences: ['采摘', '观光', '文化讲解'], description: '黄土高原上的老果园，三代人种苹果。霜降后苹果最甜，欢迎来园里走走。', transport: '自驾：从洛川县城出发约 20 分钟', contact: '', location: { latitude: 35.76, longitude: 109.43 } },
      { name: '河南灵宝 · 寺河山苹果园', province: '河南', city: '三门峡市', county: '灵宝市', fruit: '苹果', term: '霜降', experiences: ['采摘', '观光'], description: '寺河山的高山苹果，昼夜温差大，果面全红、肉质细脆。', transport: '自驾：灵宝市区出发约 40 分钟', contact: '', location: { latitude: 34.52, longitude: 110.88 } },
      { name: '山东烟台 · 樱桃园', province: '山东', city: '烟台市', county: '栖霞市', fruit: '樱桃', term: '谷雨', experiences: ['采摘', '观光'], description: '胶东半岛的大樱桃，谷雨前后成熟，果大汁多。', transport: '自驾：烟台市区出发约 50 分钟', contact: '', location: { latitude: 37.32, longitude: 120.95 } },
      { name: '浙江仙居 · 杨梅园', province: '浙江', city: '台州市', county: '仙居县', fruit: '杨梅', term: '夏至', experiences: ['采摘', '文化讲解'], description: '仙居东魁杨梅，夏至前后最盛，紫黑多汁、酸甜适口。', transport: '自驾：仙居县城出发约 30 分钟', contact: '', location: { latitude: 28.85, longitude: 120.73 } },
      { name: '广东增城 · 荔枝园', province: '广东', city: '广州市', county: '增城区', fruit: '荔枝', term: '夏至', experiences: ['采摘', '观光', '文化讲解'], description: '增城荔枝名扬古今，桂味糯米糍令人回味，盛夏最旺。', transport: '自驾：广州市区出发约 1 小时', contact: '', location: { latitude: 23.27, longitude: 113.81 } },
      { name: '四川蒲江 · 猕猴桃园', province: '四川', city: '成都市', county: '蒲江县', fruit: '猕猴桃', term: '秋分', experiences: ['采摘', '观光'], description: '蒲江红心猕猴桃，秋分前后采摘，软糯清甜。', transport: '自驾：成都市区出发约 1 小时', contact: '', location: { latitude: 30.2, longitude: 103.5 } },
      { name: '云南蒙自 · 石榴园', province: '云南', city: '红河州', county: '蒙自市', fruit: '石榴', term: '秋分', experiences: ['采摘', '观光'], description: '蒙自甜石榴，皮薄粒大、汁多味甜，秋分红透枝头。', transport: '自驾：蒙自市区出发约 25 分钟', contact: '', location: { latitude: 23.38, longitude: 103.38 } },
      { name: '新疆阿克苏 · 苹果园', province: '新疆', city: '阿克苏地区', county: '阿克苏市', fruit: '苹果', term: '霜降', experiences: ['观光', '文化讲解'], description: '阿克苏冰糖心苹果，霜降后糖心最足，雪山滋养的甜。', transport: '自驾：阿克苏市区出发约 30 分钟', contact: '', location: { latitude: 41.17, longitude: 80.27 } }
    ];
    const towns = seeds.map(item => {
      const id = 'town' + randomBytes(4).toString('hex').replace(/[^a-z0-9]/g, 'a').slice(0, 10);
      return Object.assign({ id, favId: '', ownerId: 'seed', published: true, createdAt: today(), polishedDescription: '', image: '' }, item);
    });
    towns.forEach(town => { town.favId = favIdOf(town.id); });
    commit({ version: 1, towns });
  }

  function publicTown(town) {
    const { ownerId, ...visible } = town;
    return visible;
  }
  function ownerIdOf(token) { return 'owner-' + digest(String(token || 'anonymous')).slice(0, 16); }

  function normalize(input) {
    const id = input.id || ('town' + randomBytes(4).toString('hex').replace(/[^a-z]/g, 'a').slice(0, 10));
    const name = text(input.name, '果乡名称', 20);
    const province = text(input.province, '省份', 20);
    const city = text(input.city, '城市', 20, true);
    const county = text(input.county, '区县', 20, true);
    const fruit = text(input.fruit, '当季水果', 10);
    const experiences = arrOf(input.experiences || [], '体验标签', 6, 3, EXPERIENCES);
    const description = text(input.description, '果乡介绍', 200, true);
    const transport = text(input.transport, '交通指引', 100, true);
    const contact = text(input.contact, '联系方式', 50, true);
    const term = text(input.term, '节气', 6, true) || termForFruit(fruit);
    let location = { latitude: 0, longitude: 0 };
    if (input.location && Number.isFinite(Number(input.location.latitude)) && Number.isFinite(Number(input.location.longitude))) {
      location = { latitude: Number(input.location.latitude), longitude: Number(input.location.longitude) };
    }
    return { id, name, province, city, county, fruit, experiences, description, transport, contact, term, location };
  }

  function list(query = {}) {
    seedIfEmpty();
    let towns = state.towns.filter(item => item.published);
    if (query.term) towns = towns.filter(item => item.term === query.term);
    if (query.province) towns = towns.filter(item => item.province === query.province);
    return { towns: towns.map(publicTown) };
  }
  function detail(query = {}) {
    seedIfEmpty();
    const town = state.towns.find(item => item.id === query.id && item.published);
    if (!town) fail('果乡不存在或已下架', 'not_found', 404);
    return { town: publicTown(town) };
  }
  function my(owner) {
    const ownerId = ownerIdOf(owner);
    return { towns: state.towns.filter(item => item.ownerId === ownerId).map(publicTown) };
  }
  function create(body, owner) {
    const input = normalize(body);
    const ownerId = ownerIdOf(owner);
    if (state.towns.filter(item => item.ownerId === ownerId).length >= 100) fail('最多发布 100 个果乡名片', 'capacity', 503);
    const town = Object.assign(input, { favId: favIdOf(input.id), ownerId, published: true, createdAt: today(), polishedDescription: '', image: '' });
    const next = copy(state); next.towns = next.towns.concat(town); commit(next);
    return { town: publicTown(town) };
  }
  function update(body, owner) {
    const ownerId = ownerIdOf(owner);
    const existing = state.towns.find(item => item.id === body.id && item.ownerId === ownerId);
    if (!existing) fail('果乡不存在或无权修改', 'not_found', 404);
    const input = normalize(Object.assign({}, existing, body));
    const updated = Object.assign({}, existing, input, { favId: favIdOf(input.id), ownerId });
    const next = copy(state); next.towns = next.towns.map(item => item.id === updated.id ? updated : item); commit(next);
    return { town: publicTown(updated) };
  }
  function unpublish(body, owner) {
    const ownerId = ownerIdOf(owner);
    const existing = state.towns.find(item => item.id === body.id && item.ownerId === ownerId);
    if (!existing) fail('果乡不存在或无权下架', 'not_found', 404);
    const updated = Object.assign({}, existing, { published: false });
    const next = copy(state); next.towns = next.towns.map(item => item.id === updated.id ? updated : item); commit(next);
    return { town: publicTown(updated) };
  }

  async function polish(body) {
    if (!chat || typeof chat.polish !== 'function') throw new InputError('润色服务未配置', 'model_disabled', 503);
    const description = text(body.description, '果乡介绍', 200, true);
    if (!description) throw new InputError('请先填写果乡介绍', 'invalid_input', 400);
    const term = text(body.term, '节气', 6, true) || termForFruit(body.fruit);
    const fruit = text(body.fruit, '当季水果', 10, true);
    try {
      const result = await chat.polish({ description, term, fruit });
      return { polishedText: text(result && result.polishedText, '润色结果', 300) || description };
    } catch (error) {
      throw new InputError('润色服务暂不可用', 'model_unavailable', 502);
    }
  }

  function dispatch({ method, path: route, query = {}, body = {}, owner }) {
    if (method === 'GET' && route === '/api/farmtown/list') return { status: 200, body: list(query) };
    if (method === 'GET' && route === '/api/farmtown/detail') return { status: 200, body: detail(query) };
    if (method === 'GET' && route === '/api/farmtown/my') return { status: 200, body: my(owner) };
    if (method === 'POST' && route === '/api/farmtown/create') return { status: 200, body: create(body, owner) };
    if (method === 'POST' && route === '/api/farmtown/update') return { status: 200, body: update(body, owner) };
    if (method === 'POST' && route === '/api/farmtown/unpublish') return { status: 200, body: unpublish(body, owner) };
    fail('果乡接口不存在', 'not_found', 404);
  }

  return { dispatch, polish, seedIfEmpty, _state: () => state };
}
module.exports = { createFarmtownService, favIdOf, termForFruit, EXPERIENCES };
