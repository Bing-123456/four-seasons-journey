'use strict';
// 我的节气手账（P13 行程 / 果农工作台重构）。设计文档 2.4。
// 地图点亮已收藏省份 + 果乡列表（按节气排序）+ 生成足迹图（Canvas2D 分享图）。
const store = require('../../lib/store');
const farmtown = require('../../lib/farmtown-service');
const journal = require('../../lib/season-journal');
const solar = require('../../data/solar-term-notes');
const i18n = require('../../lib/i18n');

const TERM_ORDER = solar.TERMS.map(t => t.name);
function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

Page({
  data: {
    fontClass: 'fs-normal',
    favoritedTowns: [],
    litProvinces: [],
    posterPath: '',
    posterReady: false,
    loading: true,
    error: '',
    L: {}
  },
  onShow: function () {
    this.setData({ fontClass: fontClass(), L: i18n.labels(['sj_title', 'sj_gen_poster', 'sj_save', 'sj_close', 'sj_empty', 'loading']) });
    this.loadFavorites();
  },
  loadFavorites: function () {
    const self = this;
    this.setData({ loading: true, error: '' });
    const favs = store.getKnowledgeFavorites(store.capturePartition());
    const favSet = {};
    favs.forEach(function (f) { if (/^fruit-town:/.test(f)) favSet[f.replace('fruit-town:', '')] = true; });
    const ids = Object.keys(favSet);
    if (!ids.length) {
      this.setData({ favoritedTowns: [], litProvinces: [], loading: false });
      return;
    }
    // 一次性拉取全部已发布果乡，按 favId 匹配，避免逐个请求。
    farmtown.listTowns('').then(function (towns) {
      const matched = towns.filter(function (t) { return favSet[t.id]; });
      matched.sort(function (a, b) { return TERM_ORDER.indexOf(a.term) - TERM_ORDER.indexOf(b.term); });
      const provinces = {};
      matched.forEach(function (t) { if (t.province) provinces[t.province] = true; });
      self.setData({ favoritedTowns: matched, litProvinces: Object.keys(provinces), loading: false });
      self.renderMap();
    }).catch(function () {
      self.setData({ loading: false, error: '果乡数据加载失败，请在「我的」检查云端连接' });
    });
  },
  renderMap: function () {
    const self = this;
    const query = wx.createSelectorQuery();
    query.select('#mapCanvas').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      const info = res[0];
      const canvas = info.node;
      const ratio = journal.dpr();
      canvas.width = info.width * ratio;
      canvas.height = info.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      journal.drawMap(ctx, { x: 20, y: 10, w: info.width - 40, h: info.height - 20 }, self.data.litProvinces);
    });
  },
  openTown: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/packageFruit/pages/fruit-town/fruit-town?id=' + id });
  },
  generatePoster: function () {
    const self = this;
    const query = wx.createSelectorQuery();
    query.select('#posterCanvas').fields({ node: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) { wx.showToast({ title: '海报画布不可用', icon: 'none' }); return; }
      const canvas = res[0].node;
      const ratio = journal.dpr();
      const size = journal.posterSize();
      canvas.width = size.width * ratio;
      canvas.height = size.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      journal.drawPoster(ctx, { towns: self.data.favoritedTowns, litProvinces: self.data.litProvinces });
      wx.canvasToTempFilePath({
        canvas: canvas,
        success: function (r) { self.setData({ posterPath: r.tempFilePath, posterReady: true }); },
        fail: function () { wx.showToast({ title: '生成足迹图失败', icon: 'none' }); }
      });
    });
  },
  savePoster: function () {
    const path = this.data.posterPath;
    if (!path) return;
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: function () { wx.showToast({ title: '已保存到相册', icon: 'none' }); },
      fail: function (err) {
        if (err && err.errMsg && err.errMsg.indexOf('auth') !== -1) wx.showToast({ title: '请授权保存到相册', icon: 'none' });
        else wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },
  closePoster: function () { this.setData({ posterReady: false }); },
  goBack: function () { wx.navigateBack({ delta: 1 }); },
  noop: function () {}
});
