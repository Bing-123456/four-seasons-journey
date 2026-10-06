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
async function myTowns() {
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
async function polishDescription(description, fruit) {
  const res = await call('POST', '/api/farmtown-polish', { description, fruit });
  return (res && res.polishedText) || description;
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
  polishDescription, cultureText, validTownLocation
};
