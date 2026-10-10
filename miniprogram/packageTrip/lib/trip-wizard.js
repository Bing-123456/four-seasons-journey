'use strict';
// 分步向导「定制文化行程」核心（评审 P24③）。七步：①水果文化线索 ②起点/园子 ③日期+时长
// ④同行人数 ⑤体验偏好 ⑥预算 ⑦生成。行程生成复用 core.generateRoute 的确定性链路（本地规则，
// 不由语言模型生成），见 buildRoute()。向导选择按方案第五节字段名存储：fruitTheme(水果主题名) /
// startPoint(起点坐标) / orchard(选定园子名) / date(出游日期) / duration(halfDay|fullDay|twoDays) /
// peopleCount('1'|'2'|'3'|'family'|'4plus') / preferences(偏好 id 数组) / budget(low|mid|high) /
// note(可选补充)。落两处：本机存储键 guayouji.trip-wizard.v1，以及生成路线上的 route.wizard
// 自定义字段（随 store.saveRoute 保存；core 只校验既有字段，额外字段不受影响）。
// 放在 packageTrip 分包：主包仅剩 ~12KB 体积余量（scripts/check-project.js 的 2MB 预算），
// 完整向导约 30KB 源码放不下，按 check 的「拆分子包」指引由分包承载；分包可引用主包 JS。
const catalog = require('../../data/catalog');
const fruitCulture = require('../../data/fruit-culture');
const geo = require('../../lib/geo');
const STORAGE_KEY = 'guayouji.trip-wizard.v1';
// 第 1 步水果文化钩子：方案指定五句原文；其余水果一律用通用钩子，不编造典故。
const FRUIT_HOOKS = { 西瓜: ['一口清甜，解锁消夏民俗', 'Summer folk life in one bite'], 桃子: ['桃符桃木，沾点吉祥气', 'Luck of peach wood charms'], 柿子: ['霜降吃柿，红红火火', 'Red-glow frost persimmons'], 石榴: ['千籽同房，多子多福', 'A thousand seeds, shared blessings'], 秋梨: ['一罐秋梨膏，润了秋燥', 'Pear syrup for dry autumn'] };
const GENERIC_HOOK = ['当季鲜果，正当时令', 'Seasonal fruit, right on time'];
// 第 3 步时长（方案字段）。分钟数受 core 的 30—720 与 09:00—17:00 白天窗口约束；「两天」按
// 首日全天规划（720 为 core 上限），生成后可在行程页微调再生成。
const DURATIONS = [{ id: 'halfDay', minutes: 240, label: '半天', en: 'Half day' }, { id: 'fullDay', minutes: 480, label: '一整天', en: 'Full day' }, { id: 'twoDays', minutes: 720, label: '两天', en: 'Two days' }];
// 第 4 步人数（方案五档）。映射到 core 的 1—20 整数：带娃按 2 大 1 小计 3 人，4 人以上按下限 4。
const PEOPLE = [{ id: '1', label: '1 人', en: '1 person' }, { id: '2', label: '2 人', en: '2 people' }, { id: '3', label: '3 人', en: '3 people' }, { id: 'family', label: '带娃（亲子）', en: 'With kids' }, { id: '4plus', label: '4 人以上', en: '4+ people' }];
const PARTY_SIZE = { '1': 1, '2': 2, '3': 3, family: 3, '4plus': 4 };
// 第 5 步体验偏好（方案六项），映射到 catalog.interests 评分词表（采摘/观光同属「亲近自然」，
// 手作/民俗同属「地方文化」），去重后交给生成器，最多 6 个。
const PREFERENCES = [{ id: 'pick', label: '动手采摘', en: 'Picking' }, { id: 'craft', label: '文化手作', en: 'Crafts' }, { id: 'food', label: '乡土美食', en: 'Local food' }, { id: 'sight', label: '田园观光', en: 'Sightseeing' }, { id: 'folk', label: '民俗活动', en: 'Folk customs' }, { id: 'photo', label: '拍照记录', en: 'Photos' }];
const INTEREST_BY_PREF = { pick: 'nature', craft: 'culture', food: 'food', sight: 'nature', folk: 'culture', photo: 'photo' };
const FAMILY_PRESELECT = ['sight', 'photo']; // 方案：选「带娃」自动预选亲子友好项
// 第 6 步人均预算档（方案 low/mid/high）。profile.budget 语义是团队总预算，按 人均 × 人数 换算。
const BUDGETS = [{ id: 'low', perPerson: 100, label: '100 以内', en: '≤ ¥100' }, { id: 'mid', perPerson: 300, label: '100–300', en: '¥100–300' }, { id: 'high', perPerson: 600, label: '300 以上', en: '¥300 +' }];
const OPTIONS = { durations: DURATIONS, people: PEOPLE, preferences: PREFERENCES, budgets: BUDGETS };
function optionLabel(options, id, en) { const item = options.find(o => o.id === id); return item ? (en ? item.en : item.label) : ''; }
function decorate(options, selectedId, en) { return options.map(item => ({ id: item.id, label: en ? item.en : item.label, selected: item.id === selectedId })); }
// 第 1 步水果卡片：fruitsForSeason(当季) 动态出名单（含环球果香外圈水果）。
function fruitCards(seasonId, en, selectedTheme) {
  return fruitCulture.fruitsForSeason(seasonId).map(fruit => {
    const hook = FRUIT_HOOKS[fruit.name];
    return { id: fruit.fullId, name: fruit.name, selected: fruit.name === selectedTheme, hook: hook ? hook[en ? 1 : 0] : GENERIC_HOOK[en ? 1 : 0] };
  });
}
// 第 2 步园子清单：先按水果主题名在 catalog 名称/简介里精确匹配（西瓜→中牟西瓜栽培技艺、
// 瓜豆酱；园子只作文化锚点记录，不要求带坐标）；无匹配时退回当季核心地点（place.season 与
// 主题季节一致，可规划地点排前），保证任何水果都有可选项。
function matchedOrchards(fruitName, seasonId) {
  const keyword = typeof fruitName === 'string' ? fruitName : '';
  const byName = keyword ? catalog.places.filter(place => place.demo !== true && (place.name + (place.description || '')).indexOf(keyword) !== -1) : [];
  const found = byName.length ? byName : catalog.places.filter(place => place.demo !== true && place.season === seasonId);
  return found.slice().sort((a, b) => (b.routeEligible === true) - (a.routeEligible === true)).slice(0, 4).map(place => ({ id: place.id, name: place.name, routeEligible: place.routeEligible === true }));
}
function blankWizard() { return { fruitTheme: '', startPoint: null, orchard: '', date: '', duration: 'fullDay', peopleCount: '2', preferences: [], budget: 'mid', note: '' }; }
function normalizeWizard(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const wizard = blankWizard();
  if (typeof source.fruitTheme === 'string') wizard.fruitTheme = source.fruitTheme.slice(0, 12);
  if (geo.validOrigin(source.startPoint)) wizard.startPoint = { name: source.startPoint.name, address: source.startPoint.address || '', latitude: source.startPoint.latitude, longitude: source.startPoint.longitude, coordinateSystem: 'gcj02', source: 'user' };
  if (typeof source.orchard === 'string') wizard.orchard = source.orchard.slice(0, 60);
  if (/^\d{4}-\d{2}-\d{2}$/.test(source.date || '')) wizard.date = source.date;
  if (DURATIONS.some(item => item.id === source.duration)) wizard.duration = source.duration;
  if (PEOPLE.some(item => item.id === source.peopleCount)) wizard.peopleCount = source.peopleCount;
  if (Array.isArray(source.preferences)) wizard.preferences = PREFERENCES.map(item => item.id).filter(id => source.preferences.indexOf(id) !== -1);
  if (BUDGETS.some(item => item.id === source.budget)) wizard.budget = source.budget;
  if (typeof source.note === 'string') wizard.note = source.note.slice(0, 60);
  return wizard;
}
// 人数联动（方案：带娃后偏好自动预选亲子友好项；换成其他档不强行清除）。
function applyPeopleEffect(wizardState, peopleCount) {
  const next = normalizeWizard(Object.assign({}, wizardState, { peopleCount: PEOPLE.some(item => item.id === peopleCount) ? peopleCount : '2' }));
  if (next.peopleCount === 'family') FAMILY_PRESELECT.forEach(id => { if (next.preferences.indexOf(id) === -1) next.preferences.push(id); });
  return next;
}
// 一步一问的放行条件：缺答案就不给「下一步」。
function stepValid(wizardState, step) {
  const w = normalizeWizard(wizardState);
  if (step === 1) return !!w.fruitTheme;
  if (step === 2) return !!w.startPoint && !!w.orchard;
  if (step === 3) return /^\d{4}-\d{2}-\d{2}$/.test(w.date);
  if (step === 5) return w.preferences.length > 0;
  return true; // 4/6 为单选默认选中；7 为汇总核对
}
function isoDate(offsetDays) { const day = new Date(Date.now() + offsetDays * 86400000); const pad = n => (n < 10 ? '0' : '') + n; return day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate()); }
const memory = {};
function loadWizard() { let raw = null; try { raw = typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync(STORAGE_KEY) : memory[STORAGE_KEY]; } catch (error) { raw = null; } return normalizeWizard(raw); }
function saveWizard(wizardState) {
  const value = normalizeWizard(wizardState);
  if (typeof wx !== 'undefined' && wx.setStorageSync) { try { wx.setStorageSync(STORAGE_KEY, value); } catch (error) { /* 存储失败时保留内存态 */ } }
  memory[STORAGE_KEY] = value; return value;
}
// 适配层：向导选择 → core.generateRoute 输入 profile（P07 表单不改一行）。season 沿用当前资料
// 季节（第 1 步水果名单即按它取当季，主题与季节天然一致）；startTime 固定 09:00（方案时间轴
// 模板从 09:00 到园）；duration 按 DURATIONS 分钟数（两日=720，先生成首日）；partySize 按
// PARTY_SIZE；budget = 人均档 × 人数（团队总预算）；interests = 偏好映射 + 所选园子地点标签 +
// 带娃补「亲子同行」，去重最多 6 个；transport/walking/optInSupport/origin(未选时) 沿用当前资料，
// 公交因无班次资料会被 core 拒绝，自动改自驾并写进备注；note 由向导选择拼成文旅语气备注
// （≤2000 字），末尾附用户可选的一句话补充。
function mapWizardToProfile(wizardState, baseProfile) {
  const w = normalizeWizard(wizardState);
  const base = baseProfile && typeof baseProfile === 'object' && !Array.isArray(baseProfile) ? baseProfile : catalog.defaultProfile;
  const partySize = PARTY_SIZE[w.peopleCount] || 2;
  const duration = (DURATIONS.find(item => item.id === w.duration) || DURATIONS[1]).minutes;
  const perPerson = (BUDGETS.find(item => item.id === w.budget) || BUDGETS[1]).perPerson;
  const interests = [];
  const push = id => { if (interests.indexOf(id) === -1 && catalog.interests.some(item => item.id === id)) interests.push(id); };
  w.preferences.forEach(id => push(INTEREST_BY_PREF[id]));
  if (w.peopleCount === 'family') push('family');
  const orchard = catalog.places.find(place => place.name === w.orchard);
  if (orchard && Array.isArray(orchard.tags)) orchard.tags.forEach(push);
  if (!interests.length) { push('culture'); push('nature'); }
  const transport = ['drive', 'walk', 'bike'].indexOf(base.transport) !== -1 ? base.transport : 'drive';
  const season = catalog.seasons.some(item => item.id === base.season) ? base.season : (fruitCulture.findFruitByName(w.fruitTheme) || { seasonId: 'autumn' }).seasonId;
  const origin = geo.validOrigin(w.startPoint) ? Object.assign({}, w.startPoint) : (geo.validOrigin(base.origin) ? Object.assign({}, base.origin) : null);
  const note = ['向导定制：水果 ' + (w.fruitTheme || '当季鲜果'), '园子 ' + (w.orchard || '待定'), '同行 ' + (optionLabel(PEOPLE, w.peopleCount, false) || '2 人')];
  if (base.transport === 'public') note.push('公交无班次资料，按自驾估算');
  if (w.duration === 'twoDays') note.push('两日行程先生成首日');
  if (w.note) note.push('补充：' + w.note);
  return { season, date: w.date, startTime: '09:00', duration, budget: perPerson * partySize, transport, interests: interests.slice(0, 6), partySize, note: note.join('；').slice(0, 2000), walking: base.walking === 'normal' ? 'normal' : 'easy', optInSupport: base.optInSupport === true, origin };
}
// 第 7 步汇总卡片行（在 JS 算好供 WXML 直出）。
function summaryRows(wizardState, en) {
  const w = normalizeWizard(wizardState);
  const pending = en ? 'Not chosen' : '未选';
  return [[en ? 'Fruit' : '水果主题', w.fruitTheme || pending], [en ? 'Start' : '起点', w.startPoint ? w.startPoint.name : pending], [en ? 'Orchard' : '园子', w.orchard || pending], [en ? 'Date' : '日期', w.date || pending], [en ? 'Length' : '时长', optionLabel(DURATIONS, w.duration, en)], [en ? 'Party' : '人数', optionLabel(PEOPLE, w.peopleCount, en)], [en ? 'Picks' : '偏好', w.preferences.map(id => optionLabel(PREFERENCES, id, en)).join('、') || pending], [en ? 'Budget' : '人均预算', optionLabel(BUDGETS, w.budget, en)]].map(row => ({ k: row[0], v: row[1] }));
}
// 第 7 步【生成文化行程】：与 P04/P07 完全同一套确定性生成链路——mapWizardToProfile 适配 →
// core.generateRoute → 按方案字段名挂 route.wizard → store.saveRoute（内部再走
// core.validateRoute）→ visitor-flow 采集设备级行程信号（与 route-controller.build 相同）。
// route.ok 为 false 时不写任何存储，把原因带回向导提示微调（换日期/起点/预算等）。
function buildRoute(wizardState) {
  const core = require('../../lib/core');
  const store = require('../../lib/store');
  const w = normalizeWizard(wizardState);
  for (let step = 1; step <= 6; step += 1) if (!stepValid(w, step)) return { ok: false, reason: '向导还有未完成的选择', profile: null };
  const profile = mapWizardToProfile(w, store.getProfile());
  const route = core.generateRoute(profile);
  if (!route.ok) return { ok: false, reason: route.reason, profile };
  route.wizard = { fruitTheme: w.fruitTheme, startPoint: w.startPoint, orchard: w.orchard, date: w.date, duration: w.duration, peopleCount: w.peopleCount, preferences: w.preferences.slice(), budget: w.budget, note: w.note };
  store.saveRoute(route);
  try { require('./visitor-flow').recordTrip(route); } catch (error) { /* 信号采集失败不影响行程 */ }
  try { store.logEvent('trip_wizard_generate', { season: profile.season, routeId: route.id, count: route.stops.length, mode: 'estimated', ok: true }); } catch (error) { /* 事件记录失败不影响行程 */ }
  return { ok: true, route, profile };
}
module.exports = { STORAGE_KEY, OPTIONS, FRUIT_HOOKS, fruitCards, matchedOrchards, blankWizard, normalizeWizard, applyPeopleEffect, stepValid, isoDate, loadWizard, saveWizard, mapWizardToProfile, summaryRows, buildRoute, decorate };
