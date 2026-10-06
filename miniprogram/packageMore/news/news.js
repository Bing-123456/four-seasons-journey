const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');

// 第 2 轮 · 今日快讯页（依据 mockups/final-design-3pages.html）
// 只显示「果农今天发布」的果乡名片，最多 2 张；字段严格对应果农表单，不新增任何知识内容。

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
  const byFruit = FRUIT_ART[town.fruit];
  if (byFruit) return '/assets/fruit-art/' + byFruit + '.jpg';
  const byTerm = TERM_ART[town.term];
  return '/assets/fruit-art/' + (byTerm || 'autumn-persimmon') + '.jpg';
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 两坐标点的大圆距离（公里）——算法与 pages/route/route.js 保持一致（该页为 Page 模块，无法 import 复用）。
function haversineKm(a, b) {
  const R = 6371;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 组装单张名片：没填的字段一律返回空串，wxml 侧整行不显示，不写「暂无」。
function toCard(town, origin) {
  const place = [town.province, town.city, town.county]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('');
  let distance = '';
  if (farmtown.validTownLocation(town.location) && origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)) {
    const km = haversineKm(origin, town.location);
    if (Number.isFinite(km)) {
      distance = i18n.getLang() === 'en'
        ? (km < 1 ? 'Within 1 km' : km < 100 ? km.toFixed(1) + ' km away' : Math.round(km) + ' km away')
        : (km < 1 ? '距你 <1 公里' : km < 100 ? '距你 ' + km.toFixed(1) + ' 公里' : '距你 ' + Math.round(km) + ' 公里');
    }
  }
  return {
    id: town.id,
    name: town.name || '',
    termLabel: town.term && town.fruit ? town.term + ' · ' + town.fruit : (town.fruit || town.term || ''),
    experiences: Array.isArray(town.experiences) ? town.experiences.slice(0, 3) : [],
    region: place,
    distance: distance,
    // 正文优先用润色稿，为空时回退果农原文
    intro: town.polishedDescription || town.description || '',
    transport: town.transport || '',
    contact: town.contact || '',
    art: artFor(town)
  };
}

Page({
  data: { cards: [], loaded: false, empty: false, countLabel: '' },
  onLoad: function () {
    i18n.applyNav('news_page_title');
    this.setData({ L: i18n.labels(['news_page_title', 'news_subtitle', 'news_empty', 'news_empty_hint', 'news_copy_wechat', 'news_view_card', 'news_plan_ticket']) });
    this.load();
  },
  onShow: function () {
    const bar = this.getTabBar && this.getTabBar(); if (bar) bar.applyLang && bar.applyLang();
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
  },
  onPullDownRefresh: function () {
    return this.load().then(() => wx.stopPullDownRefresh());
  },
  load: function () {
    const self = this;
    return farmtown.listTowns().then(function (towns) {
      const day = today();
      const origin = readOrigin();
      // 只显示「果农今天发布」的名片，按 createdAt 倒序，取最近 2 张。
      const todayTowns = (towns || []).filter(function (t) { return t && t.published !== false && t.createdAt === day; })
        .slice()
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
        .slice(0, 2);
      self.setData({
        cards: todayTowns.map(function (t) { return toCard(t, origin); }),
        loaded: true,
        empty: todayTowns.length === 0,
        // i18n 不支持插值，副标题的计数在页内拼（i18n 只放纯文案）。
        countLabel: i18n.getLang() === 'en'
          ? self.data.L.news_subtitle + ' ' + todayTowns.length + ' · orchard cards'
          : self.data.L.news_subtitle + ' ' + todayTowns.length + ' 张果乡名片'
      });
    }).catch(function () {
      self.setData({ cards: [], loaded: true, empty: true, countLabel: self.data.L.news_subtitle + ' 0' });
    });
  },
  copyContact: function (event) {
    const contact = event.currentTarget.dataset.contact || '';
    if (!contact) return;
    wx.setClipboardData({ data: contact, fail: function () { wx.showToast({ title: i18n.t('news_copy_failed'), icon: 'none' }); } });
  },
  viewCard: function (event) {
    wx.navigateTo({ url: '/packageFruit/pages/fruit-town/fruit-town?id=' + event.currentTarget.dataset.id });
  },
  // 「排一张票」：切到行程页（票夹与抽屉在第 3 轮实现，本轮只负责切页）。
  planTicket: function (event) {
    const id = event.currentTarget.dataset.id || '';
    wx.switchTab({ url: '/pages/route/route', success: function () { if (id) getApp().pendingPlanTownId = id; } });
  }
});

// 读取本机已有位置（若用户已授权过）；未授权则距离留空，不弹权限框。
function readOrigin() {
  try {
    const store = require('../../lib/store');
    const o = store.getProfile && store.getProfile().origin;
    if (o && Number.isFinite(o.latitude) && Number.isFinite(o.longitude)) return o;
  } catch (e) { /* 位置不可用时仅隐藏距离，不影响名片展示 */ }
  return null;
}