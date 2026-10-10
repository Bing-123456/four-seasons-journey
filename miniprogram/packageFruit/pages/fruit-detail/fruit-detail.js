const CN_NUMBERS = ['一', '二', '三', '四', '五', '六'];
const fruitCulture = require('../../../data/fruit-culture');
const store = require('../../../lib/store');
const i18n = require('../../../lib/i18n');
Page({
  data: { fruit: null, invalid: false, knowledgeFavorites: [], activeCat: '', L: {} },
  onLoad: function (options) {
    this._fruitId = options && options.fruit || '';
    this.render();
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 if (this._fruitId) this.render(); },
  render: function () {
    const labels = i18n.labels(['fn_invalid_title','fn_back','fruit_note_short','cal_fav_aria','fn_read']);
    const fruit = fruitCulture.findFruit(this._fruitId);
    if (!fruit) { this.setData({ invalid: true, L: labels }); return; }
    const favorites = store.getKnowledgeFavorites();
    const nameKey = 'fruit_' + fruit.id;
    const name = i18n.dict[nameKey] ? i18n.t(nameKey) : fruit.name;
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: name });
    this.setData({
      invalid: false, L: labels, knowledgeFavorites: favorites,
      fruit: Object.assign({}, fruit, { name, seasonName: i18n.t('season_name_' + fruit.seasonId), categories: fruit.categories.map((item, index) => {
        const favId = fruit.fullId + ':' + item.cat;
        // 目录页预览：摘要句之外的正文开头，让 01-06 每节内容与重写后的正文同步、对应小标题。
        const body = item.detail && item.detail.startsWith(item.text) ? item.detail.slice(item.text.length).trim() : (item.detail || '');
        const preview = (body || item.text).slice(0, 96) + (body.length > 96 ? '…' : '');
        const labelKey = fruit.world ? ('cat_' + item.cat + '_world') : ('cat_' + item.cat);
        return Object.assign({}, item, { label: i18n.t(labelKey), favId, fav: favorites.includes(favId), preview, num: i18n.getLang() === 'en' ? String(index + 1) : CN_NUMBERS[index] });
      }) })
    });
  },
  // 10.2 / P22：手风琴——点一条展开变宽、其余同步收窄；再点已展开的那条则收起。
  toggleAccordion: function (event) {
    const cat = event.currentTarget.dataset.cat;
    this.setData({ activeCat: this.data.activeCat === cat ? '' : cat });
  },
  openCategory: function (event) {
    const cat = event.currentTarget.dataset.cat;
    if (!this.data.fruit || !this.data.fruit.categories.some(item => item.cat === cat)) return;
    wx.navigateTo({ url: '/packageMore/fruit-note/fruit-note?fruit=' + encodeURIComponent(this._fruitId) + '&cat=' + encodeURIComponent(cat) });
  },
  toggleFavorite: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.fruit || !this.data.fruit.categories.some(item => item.favId === id)) return;
    try {
      const added = store.toggleKnowledgeFavorite(id);
      this.render();
      wx.showToast({ title: i18n.t(added ? 'cal_fav_added' : 'cal_fav_removed'), icon: 'none' });
    } catch (error) { wx.showToast({ title: error.message || i18n.t('fav_fail'), icon: 'none' }); }
  },
  back: function () {
    if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages/calendar/calendar' });
  }
});
