'use strict';
// 行程页重构（P13）：四时果乡漫游。
// 节气横向滚动 + 原生地图 + 果乡卡片列表；点击卡片进果乡详情，收藏进「我的节气手账」。
// 卡片字段：果园名称、【节气·水果】、距离你多少公里、标签【采摘/观光】。
const solar = require('../../data/solar-term-notes');
const store = require('../../lib/store');
const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');

const TERMS = solar.TERMS.map(t => t.name);

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}
function favSet() {
  const favs = store.getKnowledgeFavorites(store.capturePartition());
  const set = {};
  (this.data.fruitTowns || []).forEach(t => { set[t.id] = favs.indexOf(t.favId) !== -1; });
  return set;
}
// 两坐标点的大圆距离（公里），用于展示「距你多少公里」。
function haversineKm(a, b) {
  const R = 6371;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}
function distanceLabel(km) {
  if (km == null || !Number.isFinite(km)) return '距离未知';
  if (km < 1) return '距你 <1 公里';
  if (km < 100) return '距你 ' + km.toFixed(1) + ' 公里';
  return '距你 ' + Math.round(km) + ' 公里';
}

Page({
  data: {
    fontClass: 'fs-normal',
    terms: TERMS,
    currentTerm: '',
    fruitTowns: [],
    markers: [],
    mapCenter: { latitude: 34, longitude: 108 },
    mapScale: 4,
    highlightId: '',
    selectedTown: null,
    routeTitle: '',
    loading: false,
    error: ''
  },
  onLoad: function () {
    const term = solar.currentTerm(new Date()).name;
    this.setData({ currentTerm: term });
    this.applyNav();
    this.loadTowns(term);
  },
  onShow: function () {
    this.setData({ fontClass: fontClass() });
    this.applyNav();
    const bar = this.getTabBar && this.getTabBar(); if (bar) bar.setData({ selected: 3 });
    if (this.data.currentTerm) this.loadTowns(this.data.currentTerm);
  },
  // 导航栏统一显示 App 名，页面内大标题显示「行程」，中英切换时同步更新。
  applyNav: function () {
    this.setData({ routeTitle: i18n.t('tab_route'), L: i18n.labels(['rt_journal', 'rt_empty', 'rt_view_detail', 'loading']) });
    if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: i18n.t('app_name') });
  },
  // 读取一次手机位置并缓存，用于计算「距你多少公里」；失败/拒绝缓存为 null，不再重复弹授权。
  getUserLocation: function () {
    const self = this;
    if (self._userLocation) return Promise.resolve(self._userLocation);
    if (self._userLocation === false) return Promise.resolve(null);
    return new Promise(function (resolve) {
      if (typeof wx === 'undefined' || !wx.getLocation) { self._userLocation = false; resolve(null); return; }
      // 首次定位前先说明用途，用户确认后才真正请求；取消/失败统一按「距离未知」兜底。
      wx.showModal({
        title: i18n.t('loc_perm_title'),
        content: i18n.t('loc_perm_desc'),
        confirmText: i18n.t('loc_perm_allow'),
        cancelText: i18n.t('loc_perm_later'),
        success: function (modal) {
          if (!modal.confirm) { self._userLocation = false; resolve(null); return; }
          wx.getLocation({
            type: 'gcj02',
            success: function (res) {
              if (Number.isFinite(res.latitude) && Number.isFinite(res.longitude)) {
                self._userLocation = { latitude: res.latitude, longitude: res.longitude };
              } else {
                self._userLocation = false;
              }
              resolve(self._userLocation === false ? null : self._userLocation);
            },
            fail: function () { self._userLocation = false; resolve(null); }
          });
        },
        fail: function () { self._userLocation = false; resolve(null); }
      });
    });
  },
  loadTowns: function (term, done) {
    const self = this;
    this.setData({ loading: true, error: '' });
    Promise.all([farmtown.listTowns(term), self.getUserLocation()]).then(function (results) {
      const towns = results[0];
      const userLoc = results[1];
      const favs = store.getKnowledgeFavorites(store.capturePartition());
      const favorited = {};
      const annotated = towns.map(function (t) {
        favorited[t.id] = favs.indexOf(t.favId) !== -1;
        const dist = userLoc && farmtown.validTownLocation(t.location) ? haversineKm(userLoc, t.location) : null;
        return Object.assign({}, t, { distanceText: distanceLabel(dist) });
      });
      // 只给有有效坐标的果乡打点；后端缺失坐标时默认写死 (0,0)，validTownLocation 已一并排除。
      const mappable = annotated.filter(function (t) { return farmtown.validTownLocation(t.location); });
      const markers = mappable.map(function (t, i) {
        return {
          id: i + 1, townId: t.id,
          latitude: t.location.latitude, longitude: t.location.longitude,
          width: 20, height: 20
        };
      });
      const patch = { fruitTowns: annotated, favorited: favorited, markers: markers, loading: false };
      // 地图居中：取有效坐标质心，避免一直停在写死的 (34,108) 看不到点位。
      if (mappable.length) {
        const sumLat = mappable.reduce(function (s, t) { return s + t.location.latitude; }, 0);
        const sumLng = mappable.reduce(function (s, t) { return s + t.location.longitude; }, 0);
        patch.mapCenter = { latitude: sumLat / mappable.length, longitude: sumLng / mappable.length };
      }
      self.setData(patch);
      if (done) done();
    }).catch(function () {
      self.setData({ loading: false, error: '果乡数据加载失败，请在「我的」检查云端连接' });
      if (done) done();
    });
  },
  selectTerm: function (e) {
    const term = e.currentTarget.dataset.term;
    if (term === this.data.currentTerm) return;
    this.setData({ currentTerm: term, highlightId: '', selectedTown: null });
    this.loadTowns(term);
  },
  onMarkerTap: function (e) {
    const id = e.detail.markerId;
    const marker = this.data.markers.find(function (m) { return m.id === id; });
    if (!marker) return;
    const town = this.data.fruitTowns.find(function (t) { return t.id === marker.townId; });
    this.setData({ highlightId: marker.townId, selectedTown: town || null });
  },
  closePopup: function () { this.setData({ selectedTown: null }); },
  openTown: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/packageFruit/pages/fruit-town/fruit-town?id=' + id });
  },
  toggleFavorite: function (e) {
    const id = e.currentTarget.dataset.id;
    const town = this.data.fruitTowns.find(function (t) { return t.id === id; });
    if (!town) return;
    try {
      const favs = store.getKnowledgeFavorites(store.capturePartition());
      const isFav = favs.indexOf(town.favId) !== -1;
      store.toggleKnowledgeFavorite(town.favId, store.capturePartition());
      const favorited = Object.assign({}, this.data.favorited);
      favorited[id] = !isFav;
      this.setData({ favorited: favorited });
      wx.showToast({ title: isFav ? '已取消收藏' : '已收藏到手账', icon: 'none' });
    } catch (err) { wx.showToast({ title: '收藏失败', icon: 'none' }); }
  },
  openJournal: function () { wx.navigateTo({ url: '/pages/season-journal/season-journal' }); }
});
