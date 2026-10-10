'use strict';
// 果乡名片数据接口封装（P13 行程 / 果农工作台重构）。
// 复用 media-service 的 capture + request，与小程序其它接口走同一云托管通道。
const media = require('./media-service');

function call(method, path, body) {
  const ctx = media.capture();
  return media.request(ctx, method, path, body);
}

async function listTowns(term) {
  const path = '/api/farmtown/list' + (term ? '?term=' + encodeURIComponent(term) : '');
  const res = await call('GET', path);
  return (res && res.towns) || [];
}
async function getTown(id) {
  const res = await call('GET', '/api/farmtown/detail?id=' + encodeURIComponent(id));
  return (res && res.town) || null;
}
// 只给"果农工作台"用的加载：云托管缩容到 0 后再访问需要冷启动，
// 失败一次就等 1.2 秒自动重试一次（最多两次），其它接口不受影响。
async function myTowns(hooks) {
  try {
    return await myTownsOnce();
  } catch (error) {
    if (hooks && typeof hooks.onRetry === 'function') { try { hooks.onRetry(); } catch (e) { /* 忽略 */ } }
    await new Promise(function (resolve) { setTimeout(resolve, 1200); });
    return myTownsOnce();
  }
}

async function myTownsOnce() {
  const res = await call('GET', '/api/farmtown/my');
  return (res && res.towns) || [];
}
async function createTown(form) {
  const res = await call('POST', '/api/farmtown/create', form);
  return (res && res.town) || null;
}
async function updateTown(form) {
  const res = await call('POST', '/api/farmtown/update', form);
  return (res && res.town) || null;
}
async function unpublishTown(id) {
  const res = await call('POST', '/api/farmtown/unpublish', { id });
  return (res && res.town) || null;
}
// 本地润色兜底：只做"整理"（去空白、收标点、补句号），绝不新增事实、不编故事。
// 返回 { text, source }：source = 'server'（真 AI）| 'local' | 'local-short'
function localPolish(description) {
  const raw = String(description || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 8) return { text: raw, source: 'local-short' };
  const text = raw
    .replace(/[。！？；]{2,}/g, function (m) { return m.charAt(0); })
    .replace(/[，,]{2,}/g, '，')
    .replace(/\s*([，。！？；：])/g, '$1');
  return { text: /[。！？]$/.test(text) ? text : text + '。', source: 'local' };
}

// 服务端可能用不同字段名返回结果，这里全部兼容；拿到可用文本才算成功
function pickPolished(res) {
  if (!res || typeof res !== 'object') return '';
  const list = [res.polishedText, res.text, res.result, res.content,
    res.data && res.data.polishedText, res.data && res.data.text, res.data && res.data.result];
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] === 'string' && list[i].trim()) return list[i].trim();
  }
  return '';
}

// 润色：优先真 AI；服务端没给出可用结果时退到本地整理，并如实标注来源（不冒充 AI）
async function polishDescription(description, fruit) {
  const fallback = localPolish(description);
  try {
    const res = await call('POST', '/api/farmtown-polish', { description, fruit });
    const text = pickPolished(res);
    if (text && text !== String(description || '').trim()) return { text: text, source: 'server' };
    return fallback;
  } catch (error) {
    return fallback;
  }
}

// 当季水果文化导览：走果灵 /api/chat；失败返回 null，由页面回退知识库静态内容。
async function cultureText(term, fruit) {
  try {
    const res = await call('POST', '/api/chat', {
      question: '请为来' + (term || '当季') + '游览的游客，写一段关于「' + (fruit || '当地水果') + '」的当季水果文化导览词，100字以内，通俗温暖，不编造农谚与具体数字。',
      history: [],
      contexts: []
    });
    if (res && typeof res.answer === 'string' && res.answer.trim()) return res.answer.trim();
  } catch (error) {}
  return null;
}

// 有效坐标判定：果乡名片打点/导航/表单共用。
// 后端 normalize() 在缺失坐标时默认写死 {latitude:0, longitude:0}，0 是有限数且满足经纬度范围，
// 因此必须显式排除 (0,0)，否则会把无效点位当成合法坐标。
function validTownLocation(location) {
  return !!location
    && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180
    && (location.latitude !== 0 || location.longitude !== 0);
}

module.exports = {
  listTowns, getTown, myTowns, createTown, updateTown, unpublishTown,
  polishDescription, localPolish, cultureText, validTownLocation
};
