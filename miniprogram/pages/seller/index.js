'use strict';
// 果农工作台 → 果乡发布站（P13 行程 / 果农工作台重构）。设计文档 3.2。
// 发布入口 + 我的发布列表（名称 / 节气+水果标签 / 发布状态 / 编辑 / 下架）。
const farmtown = require('../../lib/farmtown-service');
const townInfo = require('../../lib/town-info');
const i18n = require('../../lib/i18n');

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

// 退出工作台：身份切回游客（游客视角才是小程序的默认界面）
function leaveAsTourist() {
  try {
    const store = require('../../../lib/store');
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
    // 隐藏微信系统自带的"回到首页"小房子（本页已有明确的"回到游客"按钮；基础库 2.8.0+ 支持，低版本静默跳过）
    if (typeof wx.hideHomeButton === 'function') { try { wx.hideHomeButton(); } catch (error) { /* 忽略 */ } }
    this.setData({ fontClass: fontClass(), L: i18n.labels(['sl_waking', 'sl_retry', 'sl_date', 'sl_location', 'sl_experience', 'sl_intro', 'sl_transport', 'sl_contact', 'sl_more', 'sl_less', 'sl_back_tourist', 'sl_title', 'sl_mine', 'sl_edit', 'sl_unpublish', 'sl_empty', 'loading', 'sl_region', 'sl_address', 'sl_open_date', 'sl_open_time', 'pub_name']) });
    this.loadMine();
  },
  retryLoad: function () { this.loadMine(); },
  loadMine: function () {
    const self = this;
    this.setData({ loading: true, error: '', waking: false });
    farmtown.myTowns({ onRetry: function () { self.setData({ waking: true }); } }).then(function (towns) {
      const list = (towns || []).map(function (t) {
        return Object.assign({}, t, { statusText: t.published ? '已发布' : '已下架' });
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
      title: '下架果乡名片',
      content: '下架后游客在地图上将看不到它，确定吗？',
      confirmColor: '#C0392B',
      success: function (res) {
        if (!res.confirm) return;
        farmtown.unpublishTown(id).then(function () {
          self.loadMine();
          wx.showToast({ title: '已下架', icon: 'none' });
        }).catch(function () { wx.showToast({ title: '下架失败', icon: 'none' }); });
      }
    });
  }
});

// 卡片渲染用字段：缺的留空，模板里"空值整项不渲染"，所以不会留多余空白。
function decorateTown(t) {
  const region = [t.province, t.city, t.county].filter(Boolean).join(' · ');
  const intro = String(t.polishedDescription || t.description || '').trim();
  return Object.assign({}, t, {
    region: region,
    locationText: String(t.locationName || '').trim(),
    wechat: t ? (t.wechat || '') : (town.wechat || ''),
    phone: t ? (t.phone || '') : (town.phone || ''),
    address: t.address || '',
    openDateText: townInfo.windowLabels(t).dateRange,
    openTimeText: townInfo.windowLabels(t).timeRange,
    dateText: String(t.activityDate || '').trim(),
    experienceList: Array.isArray(t.experiences) ? t.experiences : [],
    intro: intro,
    introLong: intro.replace(/\s/g, '').length > 120,
    transport: String(t.transport || '').trim(),
    contact: String(t.contact || '').trim()
  });
}
