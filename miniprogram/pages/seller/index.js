'use strict';
// 果农工作台 → 果乡发布站（P13 行程 / 果农工作台重构）。设计文档 3.2。
// 发布入口 + 我的发布列表（名称 / 节气+水果标签 / 发布状态 / 编辑 / 下架）。
const farmtown = require('../../lib/farmtown-service');
const townInfo = require('../../lib/town-info');
const i18n = require('../../lib/i18n');
const termNameEn = require('../../lib/term-name-en');
const fruitNameEn = require('../../lib/fruit-name-en');
// 失败原因那套映射只有一份，在发布链路里（哪一栏 / 超了多少字 → 对应语言的文案），这里复用同一个函数，
// 不另写一套；认不出原因时仍用本页原来那句「下架失败」。
const publishFlow = require('./publish/publish-flow');

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

// 体验标签（存档值永远是中文）：键表的词典中文侧就是存档值，页面里不写死中文；
// 中文模式取回原值、逐字不变，英文模式取英文名，词典里没有的标签原样返回（不空白、不乱编）。
const EXP_KEYS = ['sl_exp_pick', 'sl_exp_sightseeing', 'sl_exp_craft', 'sl_exp_food', 'sl_exp_culture'];
const EXP_KEY_BY_ZH = {};
EXP_KEYS.forEach(function (key) { EXP_KEY_BY_ZH[i18n.dict[key][0]] = key; });
function experienceLabel(name) {
  const key = EXP_KEY_BY_ZH[name];
  return key ? i18n.t(key) : name;
}

// 退出工作台：身份切回游客（游客视角才是小程序的默认界面）
function leaveAsTourist() {
  try {
    const store = require('../../lib/store');
    store.saveIdentity({ role: 'tourist', roleChosen: true });
  } catch (error) { /* 切不动也不能卡住导航 */ }
}

Page({
  data: {
    fontClass: 'fs-normal',
    myTowns: [],
  expandedId: '',
    loading: true,
    error: '',
    waking: false,
    L: {}
  },
  // 离开果农工作台时（返回、切 tabBar、点微信系统右上角"回到首页"小房子都会触发）：
  // 身份切回游客，避免回到游客页后又被带回工作台。任何异常都不阻断导航。
  // 工作台里的明确出口：点一下即以"游客"身份回到起始页（小房子已隐藏，这是最直观的退路）
  // 卡片内展开/收起（不跳页）
  toggleIntro: function (event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  backToTourist: function () {
    leaveAsTourist();
    if (typeof wx.reLaunch === 'function') wx.reLaunch({ url: '/pages/index/index' });
    else wx.switchTab({ url: '/pages/index/index' });
  },
  onHide: function () { leaveAsTourist(); },
  onUnload: function () { leaveAsTourist(); },
  onShow: function () {
    i18n.applyNav('sl_title');
    // 隐藏微信系统自带的"回到首页"小房子（本页已有明确的"回到游客"按钮；基础库 2.8.0+ 支持，低版本静默跳过）
    if (typeof wx.hideHomeButton === 'function') { try { wx.hideHomeButton(); } catch (error) { /* 忽略 */ } }
    this.setData({ fontClass: fontClass(), L: i18n.labels(['sl_waking', 'sl_retry', 'sl_date', 'sl_location', 'sl_experience', 'sl_intro', 'sl_my_plan', 'sl_transport', 'sl_contact', 'sl_more', 'sl_less', 'sl_back_tourist', 'sl_title', 'sl_mine', 'sl_edit', 'sl_unpublish', 'sl_empty', 'loading', 'sl_region', 'sl_address', 'sl_open_date', 'sl_open_time', 'pub_name', 'sl_plan_entry', 'sl_plan_entry_hint', 'sl_publish_new', 'sl_date_colon', 'sl_open_date_colon', 'sl_open_time_colon', 'sl_transport_colon', 'sl_wechat_colon', 'sl_phone_colon', 'sl_none']) });
    this.loadMine();
  },
  retryLoad: function () { this.loadMine(); },
  loadMine: function () {
    const self = this;
    this.setData({ loading: true, error: '', waking: false });
    farmtown.myTowns({ onRetry: function () { self.setData({ waking: true }); } }).then(function (towns) {
      const list = (towns || []).map(function (t) {
        return Object.assign({}, t, { statusText: t.published ? i18n.t('sl_status_on') : i18n.t('sl_status_off') });
      });
      self.setData({ myTowns: list.map(decorateTown), loading: false, waking: false });
    }).catch(function () {
      self.setData({ loading: false, waking: false, error: i18n.t('rt_load_failed') });
    });
  },
  publishNew: function () { wx.navigateTo({ url: '/pages/seller/publish/publish' }); },
  editTown: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/seller/publish/publish?id=' + id });
  },
  unpublishTown: function (e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: i18n.t('sl_unpublish_title'),
      content: i18n.t('sl_unpublish_body'),
      confirmColor: '#C0392B',
      success: function (res) {
        if (!res.confirm) return;
        farmtown.unpublishTown(id).then(function () {
          self.loadMine();
          wx.showToast({ title: i18n.t('sl_status_off'), icon: 'none' });
        }).catch(function (error) { wx.showToast({ title: publishFlow.failureMessage(error, false, 'sl_unpublish_failed'), icon: 'none' }); });
      }
    });
  }
});

// 「我的方案」：跟名片一起存到服务端的那份活动方案（发布时从本机暂存送上去的）。
// 老名片 / 方案丢了 → 这一块整个不渲染（hasPlan=false），卡片原来那些内容一个字不动。
// 只摆存下来的原话：方案名一条，步骤按顺序一条一行，编号在模板里加（{{stepIndex + 1}}.），不复述、不改写。
function planView(t) {
  const plan = t && t.plan && typeof t.plan === 'object' && !Array.isArray(t.plan) ? t.plan : null;
  if (!plan) return { planTitle: '', planSteps: [], hasPlan: false };
  const planTitle = typeof plan.title === 'string' ? plan.title.trim() : '';
  const planSteps = (Array.isArray(plan.steps) ? plan.steps : [])
    .map(function (step) { return String(step).trim(); })
    .filter(Boolean);
  return { planTitle: planTitle, planSteps: planSteps, hasPlan: !!(planTitle && planSteps.length) };
}

// 卡片渲染用字段：缺的留空，模板里"空值整项不渲染"，所以不会留多余空白。
function decorateTown(t) {
  const region = [t.province, t.city, t.county].filter(Boolean).join(' · ');
  const intro = String(t.polishedDescription || t.description || '').trim();
  const plan = planView(t);
  return Object.assign({}, t, {
    region: region,
    // 节气 + 水果这一行是数据驱动的中文：英文模式走 term-name-en / fruit-name-en，中文模式逐字不变。
    metaLine: termNameEn.termEn(t.term, i18n.getLang()) + ' · ' + fruitNameEn.nameEn(t.fruit),
    locationText: String(t.locationName || '').trim(),
    wechat: t ? (t.wechat || '') : (town.wechat || ''),
    phone: t ? (t.phone || '') : (town.phone || ''),
    address: t.address || '',
    openDateText: townInfo.windowLabels(t).dateRange,
    openTimeText: townInfo.windowLabels(t).timeRange,
    dateText: String(t.activityDate || '').trim(),
    experienceList: Array.isArray(t.experiences) ? t.experiences.map(experienceLabel) : [],
    intro: intro,
    introLong: intro.replace(/\s/g, '').length > 120,
    transport: String(t.transport || '').trim(),
    contact: String(t.contact || '').trim(),
    planTitle: plan.planTitle,
    planSteps: plan.planSteps,
    hasPlan: plan.hasPlan
  });
}
