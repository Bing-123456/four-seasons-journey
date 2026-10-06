'use strict';

const catalog = require('../data/catalog');
const core = require('./core');
const KEY = 'guayouji.prototype.v1';
const DEMO_KEY = 'guayouji.demo.v1';
const MODE_KEY = 'guayouji.active-mode.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const memory = {};
let sequence = 0;
// 老版本默认把 127.0.0.1 写进了存量配置；真机上本机地址永远不可达。
// 真机（android/ios）自动解析为团队 VPS 地址；开发者工具（devtools）保留本机地址用于联调。
function isLoopbackApiBase(value) {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(String(value || ''));
}
function runningOnRealDevice() {
  try {
    if (typeof wx === 'undefined') return false;
    let platform = '';
    if (wx.getDeviceInfo) platform = (wx.getDeviceInfo() || {}).platform || '';
    else if (wx.getSystemInfoSync) platform = (wx.getSystemInfoSync() || {}).platform || '';
    return ['android', 'ios'].includes(platform);
  } catch (error) { return false; }
}
function effectiveApiBase(savedBase) {
  let base = validBase(savedBase) ? savedBase.replace(/\/+$/, '') : defaultSettings.apiBase;
  if (LEGACY_BACKEND_APIS.includes(base)) base = DEFAULT_BACKEND.apiBase;
  if (isLoopbackApiBase(base) && runningOnRealDevice()) base = DEFAULT_BACKEND.apiBase;
  return base;
}

// 团队线上后端直连凭证（竞赛演示内置；可在「我的」改为自己的服务地址并配对）。
// 2026-10-01 迁移至微信云托管（原开发者 VPS 已停用）。
const DEFAULT_BACKEND = { apiBase: 'https://guayouji-server-322229-5-1499093335.sh.run.tcloudbase.com', token: '99fb6493972c19271035cc64ce98d039e4cf55ab0bd1ac86b2004ef8ad5e5539' };
// 历史上用过的团队后端地址：读取时自动升级为当前地址（凭证通用）。
const LEGACY_BACKEND_APIS = ['https://guayouji.orionsheep.com', 'https://demo.orionsheep.com/guayouji'];
const defaultSettings = { apiBase: DEFAULT_BACKEND.apiBase, useAI: true, language: 'zh' };
const VERSION = 2;
const placeById = id => catalog.places.find(place => place.id === id);
const DEMO_INFO = { scenarioId: 'henan-culture-demo-v1', scenarioLabel: '河南农耕文化体验日', personaLabel: '模拟旅客 · 林小满', simulated: true, excludeFromTraining: true, seedVersion: 1 };

function rawRead(key) {
  try { return typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync(key) : memory[key]; } catch (error) { return memory[key]; }
}
function rawWrite(key, value) {
  const copied = clone(value);
  if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try { wx.setStorageSync(key, copied); } catch (error) { throw new Error('本地保存失败，请检查设备存储空间后重试。'); }
  }
  memory[key] = copied;
}
function isDemoMode() { return rawRead(MODE_KEY) === 'demo'; }
function activeKey() { return isDemoMode() ? DEMO_KEY : KEY; }
function capturePartition() { return isDemoMode() ? 'demo' : 'personal'; }
function partitionKey(partition) {
  if (partition !== 'personal' && partition !== 'demo') throw new Error('本机账户分区无效');
  return partition === 'demo' ? DEMO_KEY : KEY;
}
function defaultIdentity() { return { nickname: '', welcomeEnabled: true, role: '', roleChosen: false, greetingCustomized: false }; }

function blank() { return { version: VERSION, identity: defaultIdentity(), companion: null, avatarPath: '', fruitUnlocks: ['watermelon'], seller: null, profile: clone(catalog.defaultProfile), route: null, favorites: [], knowledgeFavorites: [], intents: [], settings: clone(defaultSettings), events: [] }; }
function read(partition) {
  const value = rawRead(partition ? partitionKey(partition) : activeKey());
  if (!value || typeof value !== 'object' || Array.isArray(value)) return blank();
  if (value.version === 1) {
    const migrated = blank();
    migrated.profile = profileValue(Object.assign({}, catalog.defaultProfile, value.profile || {}, Object.prototype.hasOwnProperty.call(catalog.defaultProfile, 'origin') ? { origin: null } : {}));
    if (value.settings && validBase(value.settings.apiBase)) migrated.settings.apiBase = value.settings.apiBase;
    write(migrated, partition);
    return migrated;
  }
  if (value.version !== VERSION) return blank();
  return Object.assign(blank(), clone(value));
}
function write(state, partition) {
  const value = clone(state);
  const target = partition || capturePartition();
  if (target === 'demo') {
    value.demo = Object.assign({}, DEMO_INFO, { dataVersion: catalog.dataVersion });
    // 演示分区固定本机资料与云端默认；仅语言作为设备级偏好跟随保存。
    const savedLanguage = value.settings && value.settings.language === 'en' ? 'en' : 'zh';
    value.settings = Object.assign(clone(defaultSettings), { language: savedLanguage });
    if (value.route) { value.route.simulated = true; value.route.scenarioId = DEMO_INFO.scenarioId; }
  }
  rawWrite(partitionKey(target), value);
}
const ROLES = ['tourist', 'farmer'];
function getIdentity(partition) {
  const value = read(partition).identity || {};
  return {
    nickname: typeof value.nickname === 'string' ? value.nickname.slice(0, 20) : '',
    welcomeEnabled: value.welcomeEnabled !== false,
    role: ROLES.includes(value.role) ? value.role : '',
    roleChosen: value.roleChosen === true,
    greetingCustomized: value.greetingCustomized === true
  };
}
function saveIdentity(patch, partition) {
  const target = partition || capturePartition();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['nickname', 'welcomeEnabled', 'role', 'roleChosen', 'greetingCustomized'].includes(key))) throw new Error('身份设置格式不正确');
  if (patch.role !== undefined && !ROLES.includes(patch.role)) throw new Error('角色不正确');
  if (patch.nickname !== undefined && (typeof patch.nickname !== 'string' || patch.nickname.trim().length > 20)) throw new Error('昵称请控制在20字以内');
  if (patch.welcomeEnabled !== undefined && typeof patch.welcomeEnabled !== 'boolean') throw new Error('欢迎动画设置无效');
  if (patch.greetingCustomized !== undefined && typeof patch.greetingCustomized !== 'boolean') throw new Error('定制状态无效');
  const state = read(target);
  state.identity = Object.assign(getIdentity(target), patch, patch.nickname === undefined ? {} : { nickname: patch.nickname.trim() });
  write(state, target); return clone(state.identity);
}
function getCompanion(partition) {
  const companion = require('./companion');
  try { return companion.normalizeConfig(read(partition).companion || companion.defaultConfig()); }
  catch (error) { return companion.defaultConfig(); }
}
function saveCompanion(config, partition) {
  const target = partition || capturePartition();
  const value = require('./companion').normalizeConfig(config);
  const state = read(target); state.companion = value;
  // 保存过伙伴即视为完成开头打招呼小水果定制。
  state.identity = Object.assign(getIdentity(target), { greetingCustomized: true });
  write(state, target); return clone(value);
}
// 用户头像：与打招呼小水果（伙伴）分开保存。改伙伴不影响头像，头像用相册照片。
const AVATAR_KEYS = { personal: 'guayouji.avatar.v1', demo: 'guayouji.avatar.demo.v1' };
function readAvatarRaw(partition) {
  const key = AVATAR_KEYS[partition || capturePartition()] || AVATAR_KEYS.personal;
  const value = rawRead(key);
  return typeof value === 'string' ? value : '';
}
function getAvatar(partition) { return readAvatarRaw(partition); }
function saveAvatar(path, partition) {
  if (typeof path !== 'string' || !path || path.length > 600 || /^https?:/i.test(path)) throw new Error('头像图片路径不正确');
  const target = partition || capturePartition();
  rawWrite(AVATAR_KEYS[target] || AVATAR_KEYS.personal, path);
  return path;
}
function clearAvatar(partition) {
  const target = partition || capturePartition();
  if (typeof wx !== 'undefined' && wx.removeStorageSync) { try { wx.removeStorageSync(AVATAR_KEYS[target] || AVATAR_KEYS.personal); } catch (error) {} }
  delete memory[AVATAR_KEYS[target] || AVATAR_KEYS.personal];
  return '';
}
// 字体大小（「我的-字体大小」设置，评审 P05①）：设备级无障碍偏好，与账号/演示分区无关。
// 三档：normal(标准) / large(大) / xlarge(特大)。app.js 的 getFontClass() 把它转成页面根容器 class。
const FONT_SCALE_KEY = 'guayouji.fontscale.v1';
const FONT_SCALES = ['normal', 'large', 'xlarge'];
function getFontScale() {
  const value = rawRead(FONT_SCALE_KEY);
  return FONT_SCALES.includes(value) ? value : 'normal';
}
function saveFontScale(value) {
  if (!FONT_SCALES.includes(value)) throw new Error('字体大小设置不正确');
  rawWrite(FONT_SCALE_KEY, value);
  return value;
}
// 定制水果解锁：初始只有西瓜；答对对应水果的农谚题后解锁。
function getFruitUnlocks(partition) {
  const value = read(partition).fruitUnlocks;
  const list = Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^[a-z-]+$/.test(id)) : [];
  return Array.from(new Set(list.concat(['watermelon'])));
}
function unlockFruit(fruitId, partition) {
  if (typeof fruitId !== 'string' || !/^[a-z-]+$/.test(fruitId)) throw new Error('水果编号不正确');
  const target = partition || capturePartition();
  const state = read(target);
  const list = Array.isArray(state.fruitUnlocks) ? state.fruitUnlocks.filter(id => typeof id === 'string') : [];
  const added = !list.includes(fruitId);
  if (added) list.push(fruitId);
  state.fruitUnlocks = Array.from(new Set(list.concat(['watermelon'])));
  write(state, target);
  return { added, unlocks: clone(state.fruitUnlocks) };
}
// 农谚问时进度（10.5 游戏③）：按「本机日期」记录当天已答完的轮数；
// 出题记录跨天保留，保证出过的题不再重复，全部出完后再洗牌重来。
function localDayKey() {
  const now = new Date();
  const pad = value => String(value).length < 2 ? '0' + value : String(value);
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}
// today 可注入（默认取本机日期），便于单元测试把「跨天」判定变成纯函数。
function normalizeQuizProgress(value, today) {
  const refDay = today || localDayKey();
  const source = value && typeof value === 'object' ? value : {};
  const fresh = !value || source.day !== refDay;
  return {
    day: refDay,
    // 跨天：当天轮数清零（第二天能重新玩）；出题记录继续保留
    roundsDone: fresh ? 0 : (Number(source.roundsDone) || 0),
    askedIds: Array.isArray(source.askedIds) ? source.askedIds.filter(id => typeof id === 'string').slice(-200) : [],
    askedProverbs: Array.isArray(source.askedProverbs) ? source.askedProverbs.filter(id => typeof id === 'string').slice(-200) : []
  };
}
function getQuizProgress(partition, today) {
  return normalizeQuizProgress(read(partition).quizProgress, today);
}
function saveQuizProgress(patch, partition) {
  const target = partition || capturePartition();
  const state = read(target);
  // 允许调用方显式注入 day（仅测试用它模拟「第二天」）；正常调用不传则按本机日期。
  const dayOverride = patch && typeof patch.day === 'string' && patch.day ? patch.day : localDayKey();
  const merged = Object.assign(normalizeQuizProgress(state.quizProgress), patch && typeof patch === 'object' ? patch : {}, { day: dayOverride });
  state.quizProgress = merged;
  write(state, target);
  return clone(merged);
}
function readPartitionField(field, partition) {
  if (!['seller', 'paintSessions', 'chatMessages'].includes(field)) throw new Error('不支持的本机数据区域');
  return clone(read(partition || capturePartition())[field] || null);
}
function writePartitionField(field, value, partition) {
  if (!['seller', 'paintSessions', 'chatMessages'].includes(field)) throw new Error('不支持的本机数据区域');
  const target = partition || capturePartition();
  const state = read(target); state[field] = clone(value); write(state, target); return clone(value);
}
function profileValue(value) {
  // The origin field was added after the first v2 development builds. Recover
  // that missing field without treating a previously chosen location as valid.
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(catalog.defaultProfile, 'origin') && value.origin === undefined) value = Object.assign({}, value, { origin: null });
  if (core.profileErrors(value).length) return clone(catalog.defaultProfile);
  const result = {};
  Object.keys(catalog.defaultProfile).forEach(key => { result[key] = clone(value[key] === undefined ? catalog.defaultProfile[key] : value[key]); });
  return result;
}
function uniqueId(prefix) { sequence += 1; return prefix + '-' + Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

function getProfile() { return profileValue(read().profile); }
function saveProfile(profile) {
  const errors = core.profileErrors(profile);
  if (errors.length) throw new Error(errors.join('；'));
  const state = read(); state.profile = profileValue(profile); write(state); return clone(state.profile);
}
function getRoute() {
  const route = read().route;
  if (!route || !route.profileSnapshot || !core.validateRoute(route, route.profileSnapshot).valid) return null;
  return clone(route);
}
function saveRoute(route) {
  const state = read();
  if (route === null) { state.route = null; write(state); return null; }
  const profile = route && route.profileSnapshot || getProfile();
  const validation = core.validateRoute(route, profile);
  if (!validation.valid) throw new Error('路线未通过校验：' + validation.errors.join('；'));
  state.route = clone(route); state.route.profileSnapshot = profileValue(profile); write(state); return clone(state.route);
}
// 票夹（第 3 轮，2026-10-07）：行程页改为车票制。
// 票 = { id, destId, destName, destLat, destLng, dateTime, transport, status, stampedAt, note }
// status: 'planned'（待用）| 'visited'（已盖章进存根）。距出发天数在页面实时算，不存字段。
// 与旧行程 getRoute/saveRoute 完全并存、互不影响。
function normalizeTickets(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (t) { return t && typeof t === 'object' && t.id && t.destId; }).map(function (t) {
    return {
      id: String(t.id),
      destId: String(t.destId),
      destName: String(t.destName || ''),
      destLat: Number.isFinite(Number(t.destLat)) ? Number(t.destLat) : null,
      destLng: Number.isFinite(Number(t.destLng)) ? Number(t.destLng) : null,
      dateTime: String(t.dateTime || ''),
      transport: String(t.transport || ''),
      status: t.status === 'visited' ? 'visited' : 'planned',
      stampedAt: t.stampedAt ? String(t.stampedAt) : '',
      note: String(t.note || '')
    };
  });
}
function getTickets(partition) {
  return normalizeTickets(read(partition).tickets);
}
function saveTickets(list, partition) {
  const target = partition || capturePartition();
  const state = read(target);
  const tickets = normalizeTickets(list);
  state.tickets = tickets;
  write(state, target);
  return clone(tickets);
}

function getFavorites() { const value = read().favorites; return Array.isArray(value) ? Array.from(new Set(value.filter(id => { const place = placeById(id); return place && place.demo !== true; }))) : []; }
function getKnowledgeFavorites(partition) {
  const value = read(partition).knowledgeFavorites;
  return Array.isArray(value) ? clone(value) : [];
}
function toggleKnowledgeFavorite(id, partition) {
  if (typeof id !== 'string' || !/^[a-z-]+-[a-z-]+:[a-z]+$/.test(id)) throw new Error('收藏条目不正确');
  const target = partition || capturePartition();
  const state = read(target);
  const list = Array.isArray(state.knowledgeFavorites) ? state.knowledgeFavorites : [];
  const index = list.indexOf(id);
  if (index === -1) { if (list.length >= 500) throw new Error('收藏已满，请先清理'); list.push(id); }
  else list.splice(index, 1);
  state.knowledgeFavorites = list; write(state, target);
  return index === -1;
}
function toggleFavorite(placeId) {
  if (!placeById(placeId) || placeById(placeId).demo === true) throw new Error('文化条目不存在或已下架');
  const state = read(); const favorites = getFavorites();
  state.favorites = favorites.includes(placeId) ? favorites.filter(id => id !== placeId) : favorites.concat(placeId);
  write(state); return clone(state.favorites);
}
// Compatibility only: reservations and simulated capacity have been retired.
function getIntents() { return []; }
function addIntent() { throw new Error('当前不提供体验预约或名额，请通过公开场馆渠道核实。'); }
function cancelIntent() { const state = read(); state.intents = []; write(state); return []; }
function validBase(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  const match = value.match(/^(https?):\/\/(\[::1\]|(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+)(?::(\d{1,5}))?(?:\/[a-zA-Z0-9._~/-]*)?$/);
  if (!match || match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) return false;
  const host = match[2].toLowerCase();
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : null;
  if (ip && (ip.some(part => part > 255) || host.split('.').some(part => part.length > 1 && part[0] === '0'))) return false;
  if (match[1] === 'https') return true;
  return host === 'localhost' || host === '[::1]' || !!(ip && (ip[0] === 127 || ip[0] === 10 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168));
}
function getSettings() {
  if (isDemoMode()) {
    const saved = read().settings || {};
    return Object.assign({}, defaultSettings, { language: saved.language === 'en' ? 'en' : 'zh' }, { paired: false, sessionExpiresAt: null });
  }
  const settings = read().settings || {};
  const apiBase = effectiveApiBase(settings.apiBase);
  const session = settings.session;
  const paired = !!(session && session.apiBase === apiBase && typeof session.token === 'string' && /^[a-f0-9]{64}$/.test(session.token) && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now());
  return { apiBase, useAI: typeof settings.useAI === 'boolean' ? settings.useAI : false, language: settings.language === 'en' ? 'en' : 'zh', paired, sessionExpiresAt: paired ? session.expiresAt : null };
}
// 云端连接为设备级：演示账户复用个人分区的配对会话（演示数据隔离不受影响）。
function getCloudConnection() {
  const state = read('personal');
  const settings = state.settings || {};
  let apiBase = effectiveApiBase(settings.apiBase);
  const session = settings.session;
  const paired = !!(session && session.apiBase === apiBase && typeof session.token === 'string' && /^[a-f0-9]{64}$/.test(session.token) && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now());
  // 团队后端使用内置凭证直连；自定义服务地址仍走配对会话。
  let token = paired ? session.token : (apiBase === DEFAULT_BACKEND.apiBase ? DEFAULT_BACKEND.token : '');
  // 兜底：团队后端（默认/旧地址自动升级）在未配对或 session 过期时用内置凭证直连，
  // 避免 preview/真机/体验版因拿不到会话 token 全部走离线兜底；
  // 自定义服务地址（如本地开发后端）不劫持，仍走配对会话。
  if (!token && (!apiBase || apiBase === DEFAULT_BACKEND.apiBase)) {
    apiBase = DEFAULT_BACKEND.apiBase;
    token = DEFAULT_BACKEND.token;
  }
  return { apiBase, token, paired: paired || !!token, builtIn: !paired && !!token };
}
function getSessionToken() {
  return getCloudConnection().token;
}
function saveSession(value, apiBase) {
  if (isDemoMode()) throw new Error('演示账户不连接云端，请退出演示后配对');
  if (!value || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 3600000 || apiBase !== getSettings().apiBase) throw new Error('配对会话无效，请重试');
  const state = read();
  state.settings.session = { token: value.token, expiresAt: value.expiresAt, apiBase };
  write(state);
  return getSettings();
}
function clearSession() { const state = read(); delete state.settings.session; write(state); }
function saveSettings(patch) {
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'language') && patch.language !== 'en' && patch.language !== 'zh') throw new Error('语言只支持 zh / en');
  const languageOnly = patch && Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, 'language');
  if (!languageOnly && isDemoMode()) throw new Error('演示账户固定使用本机资料，请退出演示后修改服务设置');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('服务设置格式不正确');
  if (Object.prototype.hasOwnProperty.call(patch, 'apiBase') && !validBase(patch.apiBase)) throw new Error('公网服务必须使用 HTTPS；HTTP 仅支持本机或局域网 IP 地址，地址中不能带账号、密码或查询参数');
  if (Object.prototype.hasOwnProperty.call(patch, 'useAI') && typeof patch.useAI !== 'boolean') throw new Error('AI开关格式不正确');
  const state = read(); const settings = getSettings();
  const nextBase = Object.prototype.hasOwnProperty.call(patch, 'apiBase') ? patch.apiBase.replace(/\/+$/, '') : settings.apiBase;
  const session = nextBase === settings.apiBase ? state.settings.session : null;
  const language = Object.prototype.hasOwnProperty.call(patch, 'language') ? patch.language : (settings.language === 'en' ? 'en' : 'zh');
  state.settings = { apiBase: nextBase, useAI: Object.prototype.hasOwnProperty.call(patch, 'useAI') ? patch.useAI : settings.useAI, language };
  if (session) state.settings.session = session;
  write(state); return getSettings();
}
// 2026-09-28：「文化活动构想」彻底下线，活动草案的存取逻辑一并移除。
// 原 activityValue / getActivities / saveActivity 见 git 历史（删除前提交 0bb5cf5）。
function getEvents() {
  const value = read().events;
  return Array.isArray(value) ? value.slice(-100).filter(event => event && typeof event.type === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(event.type) && typeof event.createdAt === 'string').map(event => ({ type: event.type, createdAt: event.createdAt, details: safeDetails(event.details) })) : [];
}
function safeDetails(details) {
  const result = {};
  if (!details || typeof details !== 'object') return result;
  ['season', 'placeId', 'routeId', 'count', 'mode', 'ok', 'unanswerable', 'simulated', 'scenarioId', 'scenarioLabel', 'personaLabel', 'requestId', 'requestVersion', 'modelVersion', 'sourceVersion', 'catalogVersion'].forEach(key => {
    const v = details[key];
    if (['ok', 'unanswerable', 'simulated'].includes(key)) { if (typeof v === 'boolean') result[key] = v; }
    else if (key === 'count') { if (Number.isInteger(v) && v >= 0) result[key] = v; }
    else if (typeof v === 'string' && v.length <= 250) result[key] = v;
  });
  if (Array.isArray(details.excludedIds)) result.excludedIds = Array.from(new Set(details.excludedIds.filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)))).slice(0, 50);
  return result;
}
function logEvent(type, details) {
  if (typeof type !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(type)) throw new Error('事件类型不正确');
  const metadata = isDemoMode() ? Object.assign({}, details, { simulated: true, scenarioId: DEMO_INFO.scenarioId, scenarioLabel: DEMO_INFO.scenarioLabel, personaLabel: DEMO_INFO.personaLabel }) : details;
  const state = read(); const event = { type, details: safeDetails(metadata), createdAt: new Date().toISOString() };
  state.events = getEvents().concat(event).slice(-100); write(state); return clone(event);
}
function clearAll() {
  const partition = capturePartition();
  const key = activeKey();
  if (typeof wx !== 'undefined' && wx.removeStorageSync) {
    try { wx.removeStorageSync(key); } catch (error) { throw new Error('清除本地数据失败，请重试。'); }
  } else if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try { wx.setStorageSync(key, blank()); } catch (error) { throw new Error('清除本地数据失败，请重试。'); }
  }
  delete memory[key];
  clearAvatar(partition);
  clearCompanionFiles(partition);
  return true;
}
function clearCompanionFiles(partition) {
  partitionKey(partition);
  if (typeof wx === 'undefined' || !wx.env || !wx.getFileSystemManager) return;
  const fs = wx.getFileSystemManager();
  const directory = wx.env.USER_DATA_PATH + '/companions/' + partition;
  if (!fs.accessSync || !fs.readdirSync || !fs.unlinkSync) return;
  try { fs.accessSync(directory); } catch (error) { return; }
  try {
    fs.readdirSync(directory).forEach(name => { if (/^[a-z0-9-]+\.(png|jpg)$/.test(name)) fs.unlinkSync(directory + '/' + name); });
  } catch (error) { throw new Error('记录已清除，但部分伙伴预览清理失败，请重试清除'); }
}

function demoSeed() {
  const place = catalog.places.find(item => item.id === 'summer-culture' && item.routeEligible && item.location);
  // 演示农场：种西瓜，昨天和前天浇过水（与浇水日历一致）。
  try {
    const farm = require('./farm');
    const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    farm.plant('watermelon', 'demo', day(-1));
    farm.water(null, 'demo', day(-1));
    farm.water(null, 'demo', day(0));
  } catch (error) { /* 农场种子失败不影响演示 */ }
  if (!place) throw new Error('演示起点的真实资料暂不可用');
  const state = blank();
  state.identity = { nickname: '林小满', welcomeEnabled: true };
  state.demo = Object.assign({}, DEMO_INFO, { dataVersion: catalog.dataVersion });
  state.profile = Object.assign({}, clone(catalog.defaultProfile), { date: '2026-09-22', season: 'autumn', startTime: '09:00', duration: 240, partySize: 2, budget: 160, transport: 'drive', interests: ['culture', 'nature'], origin: { name: place.name, address: place.address, latitude: place.location.latitude, longitude: place.location.longitude, coordinateSystem: 'gcj02', source: 'catalog' } });
  const route = core.generateRoute(state.profile);
  if (!route.ok) throw new Error('演示路线暂不可用：' + route.reason);
  state.route = Object.assign(route, { id: 'demo-route-cultural-day', simulated: true, scenarioId: DEMO_INFO.scenarioId });
  state.favorites = [place.id, 'summer-kitchen', 'autumn-culture'].filter(id => { const item = placeById(id); return item && item.demo === false; });
  const entries = [
    ['route_generated', '01:00', { routeId: state.route.id, count: route.stops.length, mode: 'estimated' }],
    ['culture_read', '01:10', { placeId: 'summer-culture', count: 1 }],
    ['culture_question', '02:00', { placeId: 'summer-kitchen', unanswerable: false, mode: 'local-retrieval' }],
    ['workshop_complete', '02:20', { placeId: 'summer-kitchen', ok: true }],
    ['heritage_lesson_complete', '03:10', { placeId: 'summer-culture', ok: true, count: 4, mode: '3d' }]
  ];
  state.events = entries.map(entry => ({ type: entry[0], createdAt: '2026-09-22T' + entry[1] + ':00.000Z', details: Object.assign({ simulated: true, scenarioId: DEMO_INFO.scenarioId, scenarioLabel: DEMO_INFO.scenarioLabel, personaLabel: DEMO_INFO.personaLabel, requestVersion: 'demo-seed-v1', modelVersion: 'not-used', sourceVersion: catalog.dataVersion }, entry[2]) }));
  return state;
}
function enterDemo() {
  const existing = rawRead(DEMO_KEY);
  if (!existing || existing.version !== VERSION || !existing.demo || existing.demo.seedVersion !== DEMO_INFO.seedVersion || existing.demo.dataVersion !== catalog.dataVersion) { rawWrite(DEMO_KEY, demoSeed()); clearCompanionFiles('demo'); }
  rawWrite(MODE_KEY, 'demo');
  return getDemoSummary();
}
function exitDemo() { rawWrite(MODE_KEY, 'personal'); return { active: false }; }
function resetDemo() { rawWrite(DEMO_KEY, demoSeed()); clearCompanionFiles('demo'); return isDemoMode() ? getDemoSummary() : { active: false }; }
function getDemoSummary() {
  if (!isDemoMode()) return { active: false };
  const events = getEvents();
  const titles = { route_generated: '安排了一条郑州文化路线', culture_read: '阅读河南博物院与农耕资料', culture_question: '查阅瓜豆酱的原料与出处', workshop_complete: '完成瓜豆酱乡味小课堂', heritage_lesson_complete: '完成磨棒操作与理解练习' };
  return Object.assign({ active: true, favoritesCount: getFavorites().length, routeStops: (getRoute() || { stops: [] }).stops.length, completedLessons: events.filter(event => ['workshop_complete', 'heritage_lesson_complete'].includes(event.type) && event.details.ok).length, recent: events.slice(-6).reverse().map(event => ({ type: event.type, title: titles[event.type] || '体验记录', simulated: true, label: '模拟行为' })) }, DEMO_INFO);
}

module.exports = { capturePartition, readPartitionField, writePartitionField, getIdentity, saveIdentity, getCompanion, saveCompanion, getCloudConnection, getAvatar, saveAvatar, clearAvatar, getFontScale, saveFontScale, getFruitUnlocks, unlockFruit, getQuizProgress, saveQuizProgress, getProfile, saveProfile, getRoute, saveRoute, getTickets, saveTickets, getFavorites, toggleFavorite, getKnowledgeFavorites, toggleKnowledgeFavorite, getIntents, addIntent, cancelIntent, getSettings, saveSettings, getSessionToken, saveSession, clearSession, clearAll, logEvent, getEvents, isDemoMode, enterDemo, exitDemo, resetDemo, getDemoSummary };
