'use strict';
// 果乡名片的展示小工具（今日快讯页与行程页共用）：插画取图、地区文字、距离。
// 2026-10-07 第9 轮抽出：原先 news.js 里有一份，行程页的候选池与「在哪儿」也要用同一套规则。
const i18n = require('./i18n');

// 中文水果名 → assets/fruit-art 插画（按季节-水果命名，缺图时回退节气插画）
const FRUIT_ART = {
  苹果: 'autumn-apple', 樱桃: 'spring-cherry', 枇杷: 'spring-loquat', 桑葚: 'spring-mulberry',
  草莓: 'spring-strawberry-w', 葡萄: 'summer-grape-w', 荔枝: 'summer-lychee', 桃: 'summer-peach',
  杏: 'summer-apricot-w', 杨梅: 'summer-bayberry', 柠檬: 'summer-lemon', 芒果: 'spring-mango',
  香蕉: 'spring-banana', 菠萝: 'summer-pineapple', 火龙果: 'summer-dragon-fruit',
  柿子: 'autumn-persimmon', 石榴: 'autumn-pomegranate', 冬枣: 'autumn-winter-jujube-w',
  柑橘: 'winter-mandarin', 橙子: 'winter-navel-orange', 柚子: 'winter-pomelo-w',
  佛手柑: 'winter-carambola-w', 红枣: 'autumn-jujube', 山楂: 'autumn-hawthorn',
  无花果: 'autumn-fig', 猕猴桃: 'autumn-kiwi-w', 甘蔗: 'winter-sugarcane',
  椰子: 'summer-coconut', 莲雾: 'summer-wampee', 人参果: 'summer-passion-fruit',
  杨桃: 'winter-starfruit',
  莲雾果: 'summer-wampee', 金橘: 'winter-kumquat', 橘子: 'winter-tangerine',
  哈密瓜: 'summer-hami-melon', 椰枣: 'winter-dates-w', 龙眼: 'summer-longan',
  莽山柑: 'summer-mangosteen'
};
// 缺图时按节气回退（仍取自既有 assets/fruit-art，不新增图片）
const TERM_ART = {
  春分: 'spring-cherry', 清明: 'spring-cherry', 谷雨: 'spring-plum', 立夏: 'spring-mulberry',
  小满: 'spring-loquat', 芒种: 'spring-plum', 夏至: 'summer-peach', 小暑: 'summer-grape-w',
  大暑: 'summer-watermelon', 立秋: 'autumn-fig', 处暑: 'autumn-fig', 白露: 'autumn-persimmon',
  秋分: 'autumn-persimmon', 寒露: 'autumn-apple', 霜降: 'autumn-apple',
  立冬: 'winter-mandarin', 小雪: 'winter-mandarin', 大雪: 'winter-tangerine', 冬至: 'winter-kumquat'
};

function artFor(town) {
  const byFruit = FRUIT_ART[town && town.fruit];
  if (byFruit) return '/assets/fruit-art/' + byFruit + '.jpg';
  const byTerm = TERM_ART[town && town.term];
  return '/assets/fruit-art/' + (byTerm || 'autumn-persimmon') + '.jpg';
}

// 省市区去重拼一行（有的名片省市同名）
// 开关门日期/时间（2026-10-08 新增）：分别拼成两行文字，供「我的发布」「今日快讯」共用
function windowLabels(town) {
  const d1 = (town && town.openDate) || '';
  const d2 = (town && town.closeDate) || '';
  const t1 = (town && town.openTime) || '';
  const t2 = (town && town.closeTime) || '';
  return {
    dateRange: (d1 && d2) ? (d1 + ' - ' + d2) : '',
    timeRange: (t1 && t2) ? (t1 + ' - ' + t2) : ''
  };
}

function regionLabel(town) {
  const parts = [town && town.province, town && town.city, town && town.county].filter(Boolean);
  return parts.filter(function (v, i) { return parts.indexOf(v) === i; }).join('');
}

// 两坐标点的大圆距离（公里）——与 pages/route 的算法一致
function haversineKm(a, b) {
  const R = 6371;
  const rad = function (d) { return d * Math.PI / 180; };
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 读取本机已有位置（若用户已授权过）；未授权时返回 null，调用方隐藏距离，不弹权限框。
function readOrigin() {
  try {
    const store = require('./store');
    const o = store.getProfile && store.getProfile().origin;
    if (o && Number.isFinite(o.latitude) && Number.isFinite(o.longitude)) return o;
  } catch (e) { /* 位置不可用时仅隐藏距离 */ }
  return null;
}

// 「距你 X 公里」；名片位置无效（0,0）或没有本机位置时返回空串（整行不显示）。
function distanceLabel(town, origin, validLocation) {
  const valid = typeof validLocation === 'function' ? validLocation : function (loc) {
    return !!(loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && (loc.latitude !== 0 || loc.longitude !== 0));
  };
  if (!town || !valid(town.location) || !origin) return '';
  const km = haversineKm(origin, town.location);
  if (!Number.isFinite(km)) return '';
  return i18n.getLang() === 'en'
    ? (km < 1 ? 'Within 1 km' : km < 100 ? km.toFixed(1) + ' km away' : Math.round(km) + ' km away')
    : (km < 1 ? '距你 <1 公里' : km < 100 ? '距你 ' + km.toFixed(1) + ' 公里' : '距你 ' + Math.round(km) + ' 公里');
}

module.exports = {
  windowLabels, artFor, regionLabel, haversineKm, readOrigin, distanceLabel, FRUIT_ART, TERM_ART };
