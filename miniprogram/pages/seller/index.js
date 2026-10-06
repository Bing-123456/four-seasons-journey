'use strict';
// 果农工作台 → 果乡发布站（P13 行程 / 果农工作台重构）。设计文档 3.2。
// 发布入口 + 我的发布列表（名称 / 节气+水果标签 / 发布状态 / 编辑 / 下架）。
const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

Page({
  data: {
    fontClass: 'fs-normal',
    myTowns: [],
    loading: true,
    error: '',
    L: {}
  },
  onShow: function () {
    this.setData({ fontClass: fontClass(), L: i18n.labels(['sl_title', 'sl_mine', 'sl_edit', 'sl_unpublish', 'sl_empty', 'loading']) });
    this.loadMine();
  },
  loadMine: function () {
    const self = this;
    this.setData({ loading: true, error: '' });
    farmtown.myTowns().then(function (towns) {
      const list = (towns || []).map(function (t) {
        return Object.assign({}, t, { statusText: t.published ? '已发布' : '已下架' });
      });
      self.setData({ myTowns: list, loading: false });
    }).catch(function () {
      self.setData({ loading: false, error: '果乡数据加载失败，请在「我的」检查云端连接' });
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
