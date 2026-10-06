'use strict';

// 手艺小课堂：四时链图「传统手工技艺 → 点击学习制作xx酱」的目标页面。
// 内容取自 fruit-culture 每种水果的 learn 字段（产品/食材/工序），分三步互动阅读。
const fruitCulture = require('../../data/fruit-culture');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

// 与内容对不上的通用工序小标题（48 门课的默认模板），展示时隐藏；自拟标题保留。
const GENERIC_STEP_TITLES = ['准备与辨认', '处理与制作', '观察与记录', '保存与分享', '完成与检查'];

Page({
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  data: { fruit: null, learn: null, learnView: null, step: 0, favorite: false, L: {} },
  onLoad: function (options) { i18n.applyNav('cl_kicker');
    const fullId = options && options.fruit ? decodeURIComponent(options.fruit) : '';
    const fruit = fruitCulture.findFruit(fullId);
    const craft = fruit ? (fruit.categories || []).find(item => item.cat === 'craft') : null;
    const learn = craft && craft.learn ? craft.learn : null;
    if (!learn) { this.setData({ invalid: true, L: i18n.labels(['craft_back']) }); return; }
    // WXML 绑定用首字图形，提前算好。
    learn.ingredients = (learn.ingredients || []).map(item => Object.assign({}, item, { glyph: (item.name || '·')[0] }));
    // 评审 9.28②：通用模板小标题与各课内容不对应，改为纯序号；青梅酱等自拟标题保留。
    learn.steps = (learn.steps || []).map((step, index) => ({ num: index + 1, title: GENERIC_STEP_TITLES.indexOf(step.title) === -1 ? step.title : '', text: step.text }));
    const nameKey = 'fruit_' + fruit.id;
    const fruitView = i18n.dict[nameKey] ? Object.assign({}, fruit, { name: i18n.t(nameKey), seasonName: i18n.dict['season_name_' + fruit.seasonId] ? i18n.t('season_name_' + fruit.seasonId) : fruit.seasonName }) : fruit;
    const productKey = 'product_' + learn.product;
    const learnView = i18n.dict[productKey] ? Object.assign({}, learn, { product: i18n.t(productKey) }) : learn;
    this.setData({
      fruit: fruitView, learn, learnView,
      favorite: this.isFav(fruit),
      L: i18n.labels(['craft_step_ingredients', 'craft_step_craft', 'craft_step_done', 'craft_choose_two', 'craft_next_craft', 'craft_next_done', 'craft_save', 'craft_saved', 'craft_back', 'craft_restart', 'craft_finish_title', 'craft_empty_title', 'craft_steps_title', 'craft_done_note','cl_kicker','cl_title_a','craft_share_community'])
    });
  },
  isFav: function (fruit) {
    if (!fruit) return false;
    try { return store.getKnowledgeFavorites().indexOf(fruit.seasonId + '-' + fruit.id + ':craft') !== -1; } catch (error) { return false; }
  },
  goStep: function (event) { this.setData({ step: Number(event.currentTarget.dataset.step) || 0 }); },
  nextStep: function () { this.setData({ step: Math.min(2, this.data.step + 1) }); },
  restart: function () { this.setData({ step: 0 }); },
  saveKnowledge: function () {
    const fruit = this.data.fruit;
    if (!fruit) return;
    const id = fruit.seasonId + '-' + fruit.id + ':craft';
    try {
      const added = store.toggleKnowledgeFavorite(id);
      this.setData({ favorite: this.isFav(fruit) });
      wx.showToast({ title: added ? i18n.t('craft_fav_added') : i18n.t('cal_fav_removed'), icon: 'none' });
    } catch (error) { wx.showToast({ title: error.message || i18n.t('fav_fail'), icon: 'none' }); }
  },
  back: function () { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/calendar/calendar' }) }); },
  shareToCommunity: function () { wx.navigateTo({ url: '/pages/community/community' }); },
  noop: function () {}
});
