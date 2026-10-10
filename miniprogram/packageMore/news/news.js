const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');
const store = require('../../lib/store');
const townInfo = require('../../lib/town-info');

// 第 2 轮 · 今日快讯页（依据 mockups/final-design-3pages.html）
// 只显示「果农今天发布」的果乡名片，字段严格对应果农表单，不新增任何知识内容。
// 2026-10-07：张数上限从写死的 2 改成常量 MAX_CARDS（用户要求「以后快讯要支持多条」）。
const MAX_CARDS = 20;
// 发现页抽屉的「快讯」副标题要显示真实条数，而发现页不引 farmtown-service（有测试断言），
// 所以由本页取数后把「当日条数」写进本机，供发现页读取；跨天自动失效。
const NEWS_COUNT_KEY = 'guayouji.news.today.';

// 插画取图、地区文字、距离改用 lib/town-info.js（与行程页共用同一套规则，2026-10-07 第9 轮抽出）

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 把「今天发布了几条」写给发现页抽屉用（写失败只影响那个副标题，不影响本页展示）。
function writeNewsCount(count, day) {
  try { wx.setStorageSync(NEWS_COUNT_KEY + store.capturePartition(), { date: day, count: count }); } catch (e) { /* 忽略 */ }
}

// 组装单张名片：没填的字段一律返回空串，wxml 侧整行不显示，不写「暂无」。
function toCard(town, origin) {
  const place = townInfo.regionLabel(town);
  const distance = townInfo.distanceLabel(town, origin, farmtown.validTownLocation);
  return {
    id: town.id,
    name: town.name || '',
    termLabel: town.term && town.fruit ? town.term + ' · ' + town.fruit : (town.fruit || town.term || ''),
    // 果农自填的可去日期；没填就是空串，wxml 侧整行不显示（不出现「暂无」）
    activityDate: town.activityDate || '',
    experiences: Array.isArray(town.experiences) ? town.experiences.slice(0, 3) : [],
    region: place,
    wechat: t ? (t.wechat || '') : (town.wechat || ''),
    phone: t ? (t.phone || '') : (town.phone || ''),
      address: town.address || '',
      openDateText: townInfo.windowLabels(town).dateRange,
      openTimeText: townInfo.windowLabels(town).timeRange,
    distance: distance,
    // 正文优先用润色稿，为空时回退果农原文
    intro: town.polishedDescription || town.description || '',
    transport: town.transport || '',
    contact: town.contact || '',
    art: townInfo.artFor(town)
  };
}

Page({
  data: { cards: [], loaded: false, empty: false, countLabel: '' },
  onLoad: function () {
    i18n.applyNav('news_page_title');
    this.setData({ L: i18n.labels(['news_page_title', 'news_subtitle', 'news_empty', 'news_empty_hint', 'news_copy_phone', 'news_view_card', 'news_plan_ticket', 'news_activity_date', 'sl_location', 'sl_intro', 'sl_transport', 'sl_contact', 'sl_region', 'sl_address', 'sl_open_date', 'sl_open_time', 'pub_name']) });
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
      const origin = townInfo.readOrigin();
      // 只显示「果农今天发布」的名片，按 createdAt 倒序，最多 MAX_CARDS 张。
      const todayTowns = (towns || []).filter(function (t) { return t && t.published !== false && t.createdAt === day; })
        .slice()
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
        .slice(0, MAX_CARDS);
      writeNewsCount(todayTowns.length, day);
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

// 本机位置读取改用 lib/town-info.js 的 readOrigin（未授权时返回 null，距离整行不显示）。
