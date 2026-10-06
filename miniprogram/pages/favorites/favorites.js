'use strict';

// 我的收藏：文化收藏与旅游地收藏分开展示（?type=knowledge 默认 / ?type=places）。
const store = require('../../lib/store');
const catalog = require('../../data/catalog');
const contentView = require('../content-view');
const fruitCulture = require('../../data/fruit-culture');
const i18n = require('../../lib/i18n');

const knowledgeName = id => {
  const match = /^([a-z-]+)-([a-z-]+):([a-z]+)$/.exec(id || '');
  if (!match) return id;
  const fruit = fruitCulture.findFruit(match[1] + '-' + match[2]);
  const cat = fruitCulture.CATEGORIES.find(item => item.id === match[3]);
  const labelKey = fruit && fruit.world ? ('cat_' + cat.id + '_world') : ('cat_' + cat.id);
  return (fruit ? fruit.name : match[2]) + ' · ' + (cat ? i18n.t(labelKey) : match[3]);
};

Page({
  data: { knowledge: [], places: [], pageType: 'knowledge', L: {} },
  onLoad: function (options) { i18n.applyNav('nav_favorites');
    const pageType = options && options.type === 'places' ? 'places' : 'knowledge';
    this.setData({ pageType, L: i18n.labels(['fav_page_knowledge','fav_page_places','fav_page_knowledge_intro','fav_page_places_intro','fav_knowledge_title','fav_places_title','fav_knowledge_count','fav_places_count','fav_knowledge_empty','fav_places_empty','remove']) });
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 this.refresh(); },
  refresh: function () {
    const ids = store.getKnowledgeFavorites();
    const placeIds = store.getFavorites();
    this.setData({
      knowledge: ids.map(id => ({ id, name: knowledgeName(id) })),
      places: catalog.places.filter(place => placeIds.indexOf(place.id) >= 0).map(place => contentView.placeView(place))
    });
  },
  removeKnowledge: function (event) {
    try { store.toggleKnowledgeFavorite(event.currentTarget.dataset.id); this.refresh(); }
    catch (error) { wx.showToast({ title: error.message || i18n.t('remove_fail'), icon: 'none' }); }
  },
  openKnowledge: function (event) {
    const id = String(event.currentTarget.dataset.id || '');
    const separator = id.lastIndexOf(':');
    const fruit = id.slice(0, separator), category = id.slice(separator + 1);
    if (separator < 0 || !fruitCulture.findFruit(fruit) || !fruitCulture.CATEGORIES.some(item => item.id === category)) return;
    wx.navigateTo({ url: '/pages/fruit-note/fruit-note?fruit=' + encodeURIComponent(fruit) + '&cat=' + encodeURIComponent(category) });
  },
  openPlace: function (event) { wx.navigateTo({ url: '/pages/culture/culture?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  removePlace: function (event) {
    try { store.toggleFavorite(event.currentTarget.dataset.id); this.refresh(); }
    catch (error) { wx.showToast({ title: error.message || i18n.t('remove_fail'), icon: 'none' }); }
  }
});
