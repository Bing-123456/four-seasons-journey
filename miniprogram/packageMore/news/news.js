const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');
const store = require('../../lib/store');
const townInfo = require('../../lib/town-info');
const recentTown = require('../../lib/recent-town');

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

// 本页用到的词典键（原先写死在 onLoad 里那一串，2026-10-13 提成一份常量）：
// 页面首次打开（onLoad）与从别页回来 / 切语言（onShow）都要重取一次，写两遍容易改一处漏一处。
// plan_nav：「活动方案」那一块的标题，直接用结果页早就在用的那个既有键，不新造键。
const LABEL_KEYS = ['news_page_title', 'news_subtitle', 'news_empty', 'news_empty_hint', 'news_copy_phone', 'news_view_card', 'news_plan_ticket', 'news_activity_date', 'sl_location', 'sl_intro', 'sl_transport', 'sl_contact', 'sl_region', 'sl_address', 'sl_open_date', 'sl_open_time', 'pub_name', 'news_load_failed', 'sl_open_date_colon', 'sl_open_time_colon', 'sl_transport_colon', 'sl_wechat_colon', 'sl_phone_colon', 'sl_none', 'sl_waking', 'sl_retry', 'plan_nav'];

// 组装单张名片：没填的字段一律返回空串，wxml 侧整行不显示，不写「暂无」。
// 2026-10-12 第12 轮：映射本身抽到 lib/town-info.js 的 cardFor（行程页抽屉「① 去哪」共用同一套
// 字段名与取值兜底），本页只是转发，输出与原来的 toCard 逐字一致。
function toCard(town, origin) {
  return townInfo.cardFor(town, origin, farmtown.validTownLocation);
}

Page({
  data: { cards: [], loaded: false, empty: false, countLabel: '', loadFailed: false, waking: false },
  onLoad: function () {
    i18n.applyNav('news_page_title');
    // 2026-10-11：联系方式两行（微信号 / 手机号）与开关门日期、开关门时间、交通指引三行的全角冒号
    // 原先是 wxml 硬编码中文，英文模式会露中文；改用词典里已有的 *_colon / sl_none 键，中文侧逐字不变。
    // sl_waking / sl_retry 也一并补上：这两行一直在用，但原先漏在列表外，渲染成空。
    this.setData({ L: i18n.labels(LABEL_KEYS) });
    this.load();
  },
  onShow: function () {
    const bar = this.getTabBar && this.getTabBar(); if (bar) bar.applyLang && bar.applyLang();
    // 2026-10-13：onLoad 只在页面首次打开时取一次词典，切语言后再回来这里重取一次，
    // 否则标签会停在旧语言（英文模式露中文）。
    this.setData({ L: i18n.labels(LABEL_KEYS) });
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
    // 切回本页自动重新取一次：保证"发布后回来就是最新"（2026-10-10）
    this.load();
  },
  onPullDownRefresh: function () {
    return this.load().then(() => wx.stopPullDownRefresh());
  },
  retry: function () { this.load(); },
  load: function () {
    this.setData({ waking: true });
    const self = this;
    return farmtown.listTowns().then(function (towns) {
      const day = today();
      const origin = townInfo.readOrigin();
      // 只显示「果农今天发布」的名片，按 createdAt 倒序，最多 MAX_CARDS 张。
      // ① 只比日期前 10 位（防 createdAt 带时间/时区导致等号失败）
      let todayTowns = (towns || []).filter(function (t) { return t && t.published !== false && String(t.createdAt || '').slice(0, 10) === day; });
      // ② 严格「今天」为空时，退而显示「最近 24 小时内发布」的（容错服务端与手机时区不一致）
      if (!todayTowns.length) {
        const cutoff = Date.now() - 24 * 3600 * 1000;
        todayTowns = (towns || []).filter(function (t) {
          if (!t || t.published === false) return false;
          const ts = Date.parse(String(t.createdAt || '').slice(0, 10));
          return ts && ts >= cutoff;
        });
      }
        todayTowns = todayTowns.slice()
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      // 2026-10-12：果农刚发布 / 保存的那张提到最前（createdAt 只到日期，同一天发布的几张排序会「平手」，
      // 新发布的反而落到最后）。其余项顺序一字不动；本机没记住该 id、或它在今天这批里找不到时，
      // promote 原样返回 → 顺序与改动前逐项一致（不报错、不空白）。放在截断前，张数上限仍是 MAX_CARDS。
      todayTowns = recentTown.promote(todayTowns).slice(0, MAX_CARDS);
      writeNewsCount(todayTowns.length, day);
      self.setData({
        cards: todayTowns.map(function (t) { return toCard(t, origin); }),
        loaded: true, loadFailed: false, waking: false,
        empty: todayTowns.length === 0,
        // i18n 不支持插值，副标题的计数在页内拼（i18n 只放纯文案）。
        countLabel: i18n.getLang() === 'en'
          ? self.data.L.news_subtitle + ' ' + todayTowns.length + ' · orchard cards'
          : self.data.L.news_subtitle + ' ' + todayTowns.length + ' 张果乡名片'
      });
    }).catch(function (error) {
      // 2026-10-11 诊断用：以前这里把真实错误吞掉了，页面只显示「加载异常，下拉重试」、Console 却是干净的，
      // 导致没法定位（服务端接口实测正常）。只加日志，不改任何行为。
      console.error('[news] listTowns failed:', error);
      self.setData({ cards: [], loaded: true, empty: true, loadFailed: true, waking: false, countLabel: i18n.t('news_load_failed') });   // ③ 失败要看得见，不再假装 0 张
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
