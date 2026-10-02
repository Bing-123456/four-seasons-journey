const speechReader = require('../../lib/speech-reader');
'use strict';

// 水果文化内容页：四时链图点某一分类进入；含详解正文、果灵朗读、收藏爱心。
// 页面高度随内容自然伸展，不留空白。
const fruitCulture = require('../../data/fruit-culture');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const NOTE_LABELS = ['fn_sources', 'read_aloud', 'read_aloud_hint', 'read_play', 'read_stop', 'read_unavailable', 'avatar_fallback', 'fruit_note_back', 'note_verify_short', 'fn_invalid_title', 'fn_back', 'fn_learn_a', 'fn_fav_on', 'fn_fav_off', 'fn_fav_aria'];



function dialectList() { return speechReader.dialects(); }

Page({
  data: { fruit: null, cat: '', catLabel: '', fav: false, companion: null, dialects: [], dialect: 'mandarin', reading: false, readBusy: false, L: {} },
  onLoad: function (options) { i18n.applyNav('nav_fruit_note');
    this.setData({ dialects: dialectList(), L: i18n.labels(NOTE_LABELS) });
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
      catLabel: i18n.t('cat_' + cat),
      fav: store.getKnowledgeFavorites().indexOf(favId) !== -1,
      companion: store.getCompanion()
    });
    try { store.logEvent('fruit_note_open', { placeId: fruit.seasonId + '-' + fruit.id, mode: cat }); } catch (error) {}
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 this.setData({ companion: store.getCompanion() }); },
  onHide: function () { this.stopRead(); },
  onUnload: function () { this._disposed = true; this.stopRead(); },
  // ---- 收藏：点击变红实心，取消恢复空心 ----
  toggleFavorite: function () {
    try {
      const added = store.toggleKnowledgeFavorite(this.data.favId);
      this.setData({ fav: added });
      wx.showToast({ title: added ? '已收藏，可在「我的 → 文化收藏」回看' : '已取消收藏', icon: 'none' });
    } catch (error) { wx.showToast({ title: error.message || '收藏失败', icon: 'none' }); }
  },
  // ---- 果灵朗读 ----
  chooseDialect: function (event) {
    const active = this.data.reading || this.data.readBusy;
    this.stopRead();
    this.setData({ dialect: event.currentTarget.dataset.code });
    if (active) this.startRead();
  },
  buildScript: function () {
    const fruit = this.data.fruit, category = this.data.category;
    const text = category.text;
    const detail = category.detail || '';
    return fruit.name + '。' + this.data.catLabel + '。' + text + '。' + detail;
  },
  toggleRead: function () { if (this.data.reading || this.data.readBusy) this.stopRead(); else this.startRead(); },
  startRead: function () { return speechReader.start(this, this.buildScript()); },
  stopRead: function () { speechReader.stop(this); },
  copySource: function (event) { const source = (this.data.category.sources || [])[Number(event.currentTarget.dataset.index)]; if (source) wx.setClipboardData({ data: source.url }); },
  goCraftLesson: function () {
    const full = this.data.fruit.seasonId + '-' + this.data.fruit.id;
    wx.navigateTo({ url: '/pages/craft-lesson/craft-lesson?fruit=' + encodeURIComponent(full) });
  },
  back: function () { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/calendar/calendar' }) }); },
  noop: function () {}
});
