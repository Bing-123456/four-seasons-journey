'use strict';

// 水果文化内容页：四时链图点某一分类进入；含详解正文、果灵朗读、收藏爱心。
// 页面高度随内容自然伸展，不留空白。
const fruitCulture = require('../../data/fruit-culture');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const NOTE_LABELS = ['fn_sources', 'avatar_fallback', 'fruit_note_back', 'note_verify_short', 'fn_invalid_title', 'fn_back', 'fn_learn_a', 'fn_fav_on', 'fn_fav_off', 'fn_fav_aria'];

Page({
  data: { fruit: null, cat: '', catLabel: '', fav: false, companion: null, L: {} },
  onLoad: function (options) { i18n.applyNav('nav_fruit_note');
    this.setData({ L: i18n.labels(NOTE_LABELS) });
    const fruit = fruitCulture.findFruit(options && options.fruit ? decodeURIComponent(options.fruit) : '');
    const cat = options && options.cat ? options.cat : '';
    if (!fruit || !cat) { this.setData({ invalid: true }); return; }
    let category = (fruit.categories || []).find(item => item.cat === cat);
    if (!category) { this.setData({ invalid: true }); return; }
    if (category.detail && category.detail.startsWith(category.text) && category.detail.length > category.text.length) {
      category = Object.assign({}, category, { detail: category.detail.slice(category.text.length).trim() });
    }
    const favId = fruit.seasonId + '-' + fruit.id + ':' + cat;
    const productKey = 'product_' + (category.learn ? category.learn.product : '');
    if (category.learn && i18n.dict[productKey]) category = Object.assign({}, category, { learn: Object.assign({}, category.learn, { product: i18n.t(productKey) }) });
    const nameKey = 'fruit_' + fruit.id;
    const fruitView = i18n.dict[nameKey] ? Object.assign({}, fruit, { name: i18n.t(nameKey) }) : fruit;
    this.setData({
      fruit: fruitView, cat, category,
      favId,
      catLabel: i18n.t(fruit.world ? ('cat_' + cat + '_world') : ('cat_' + cat)),
      fav: store.getKnowledgeFavorites().indexOf(favId) !== -1,
      companion: store.getCompanion()
    });
    try { store.logEvent('fruit_note_open', { placeId: fruit.seasonId + '-' + fruit.id, mode: cat }); } catch (error) {}
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
    // 10.2 / P17②：从别处（如「记收获」）收藏或取消后返回本页，收藏态要立刻跟着变，
    // 不能等到重新进入分类页才刷新。
    const favId = this.data.favId;
    this.setData({
      companion: store.getCompanion(),
      fav: favId ? store.getKnowledgeFavorites().indexOf(favId) !== -1 : false
    });
  },
  onUnload: function () { this._disposed = true; },
  // ---- 收藏：点击变红实心，取消恢复空心 ----
  toggleFavorite: function () {
    try {
      const added = store.toggleKnowledgeFavorite(this.data.favId);
      this.setData({ fav: added });
      wx.showToast({ title: added ? '已收藏，可在「我的 → 文化收藏」回看' : '已取消收藏', icon: 'none' });
    } catch (error) { wx.showToast({ title: error.message || '收藏失败', icon: 'none' }); }
  },
  copySource: function (event) { const source = (this.data.category.sources || [])[Number(event.currentTarget.dataset.index)]; if (source) wx.setClipboardData({ data: source.url }); },
  goCraftLesson: function () {
    const full = this.data.fruit.seasonId + '-' + this.data.fruit.id;
    wx.navigateTo({ url: '/packageMore/craft-lesson/craft-lesson?fruit=' + encodeURIComponent(full) });
  },
  back: function () { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/calendar/calendar' }) }); },
  noop: function () {}
});
