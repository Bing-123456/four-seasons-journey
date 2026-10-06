const catalog = require('../../data/catalog');
const store = require('../../lib/store');
const fruitCulture = require('../../data/fruit-culture');
const { fruitArt } = require('../../data/fruit-art');
const i18n = require('../../lib/i18n');
const stripSeason = value => String(value || '').replace(/^(spring|summer|autumn|winter)-/, '');
const fruitName = fruit => { const key = 'fruit_' + stripSeason(fruit.fullId || fruit.id).split(':')[0]; return i18n.dict[key] ? i18n.t(key) : fruit.name || ''; };
const seasonName = id => i18n.t('season_name_' + id);
// 评审 P02：核心/外围合并为同一张链图后，用红/绿描边区分本土与外来引入，图例文案内联（可改 i18n 前先放这里）。
const legendCopy = {
  zh: { native: '红边 · 本土果物', introduced: '绿边 · 外来引入' },
  en: { native: 'Red ring · Native', introduced: 'Green ring · Introduced' }
};

Page({
  data: { season: 'spring', seasons: [], seasonMeta: null, graphNodes: [], graphLines: [], legend: legendCopy.zh, companionMini: null, en: false, L: {} },
  onLoad: function () { i18n.applyNav('nav_calendar'); this.render(store.getProfile().season); },
  onShow: function () {
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });     const bar = this.getTabBar(); if (bar) { bar.setData({ selected: 1 }); if (bar.applyLang) bar.applyLang(); }
    this.render(store.getProfile().season);
  },
  onReady: function () { this.measureGraph(); },
  onResize: function () { this.measureGraph(); },
  onUnload: function () { this._disposed = true; },
  render: function (id) {
    const raw = fruitCulture.seasons.find(item => item.id === id) || fruitCulture.seasons[0];
    const en = i18n.getLang() === 'en';
    const seasonMeta = Object.assign({}, raw, { name: seasonName(raw.id), shortName: i18n.t('season_' + raw.id), centerName: en ? i18n.t('season_' + raw.id) : seasonName(raw.id) });
    const graph = this.buildGraph(seasonMeta);
    this.setData({
      season: raw.id, seasonMeta, en, companionMini: store.getCompanion(), legend: en ? legendCopy.en : legendCopy.zh,
      seasons: catalog.seasons.map(item => Object.assign({}, item, { name: seasonName(item.id), shortName: i18n.t('season_' + item.id) })),
      graphNodes: graph.nodes, graphLines: graph.lines, graphDense: graph.dense,
      L: i18n.labels(['cal_title1','fruit_locked','guoling_search_title','cal_graph_aria','id_search_aria'])
    }, () => this.measureGraph());
  },
  measureGraph: function () {
    if (!this.createSelectorQuery || this._disposed) return;
    this.createSelectorQuery().select('.graph-canvas').boundingClientRect(rect => {
      if (this._disposed || !rect || rect.width <= 0 || rect.height <= 0) return;
      if (this._graphSize && Math.abs(this._graphSize.width - rect.width) < 0.5 && Math.abs(this._graphSize.height - rect.height) < 0.5) return;
      this._graphSize = { width: rect.width, height: rect.height };
      if (this.data.seasonMeta) {
        const graph = this.buildGraph(this.data.seasonMeta);
        this.setData({ graphNodes: graph.nodes, graphLines: graph.lines, graphDense: graph.dense });
      }
    }).exec();
  },
  // 评审 P02：一季一张放射状链图——本土果物（红边）与外来引入果物（绿边）同图排布，
  // 不再拆「核心果物/外围果物」两页。fruitCulture 的 world 标记（团队定稿名单，见 fruit-culture.js
  // 的 NATIVE_NAMES）即本土/外来口径，在这里算成 originClass 供 WXML 挂样式。
  buildGraph: function (seasonMeta) {
    const all = fruitCulture.fruitsForSeason(seasonMeta.id);
    const nodes = all.map((fruit, index) => this.node(fruit, -Math.PI / 2 + index * Math.PI * 2 / all.length, !fruit.categories.length));
    const lines = this._graphSize ? nodes.map(node => {
      const dx = (node.x - 50) * this._graphSize.width / 100, dy = (node.y - 47) * this._graphSize.height / 100;
      return { id: node.id, lineStyle: 'left:50%;top:47%;width:' + Math.sqrt(dx * dx + dy * dy).toFixed(1) + 'px;transform:rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + 'deg);' };
    }) : [];
    // 评审 9.28：节点多的季节（如夏季 16 果）挂 is-dense，整体缩小避免名字互相挤压。
    return { nodes, lines, dense: all.length > 12 };
  },
  node: function (fruit, angle, locked) {
    const x = 50 + 37 * Math.cos(angle), y = 47 + 35 * Math.sin(angle);
    const id = fruit.fullId;
    // 10.2 / P02①：名字一律排在节点靠圆心的那一侧（内圈），紧贴自己的水果。
    // 早先固定挂在节点正下方，夏季 16 个果时名字互相压住、还会压到下方另一个水果，
    // 看着像标错了对象；改成沿半径朝内偏移后，每个名字都只贴着自己的那颗果。
    const inward = 74;
    const nameStyle = 'left:calc(50% + ' + (-Math.cos(angle) * inward).toFixed(1)
      + 'rpx);top:calc(50% + ' + (-Math.sin(angle) * inward).toFixed(1) + 'rpx);transform:translate(-50%,-50%);';
    return { id, name: fruitName(fruit), x, y, originClass: fruit.world ? 'introduced' : 'native', art: fruitArt(id), locked: !!locked, style: 'left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%;', nameStyle };
  },
  selectFruit: function (event) {
    const id = event.currentTarget.dataset.id;
    if (event.currentTarget.dataset.locked === '1') { wx.showToast({ title: i18n.t('fruit_locked'), icon: 'none' }); return; }
    if (!fruitCulture.findFruit(id)) return;
    wx.navigateTo({ url: '/packageFruit/pages/fruit-detail/fruit-detail?fruit=' + encodeURIComponent(id) });
  },
  choose: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.seasons.some(item => item.id === id)) return;
    const profile = store.getProfile(); profile.season = id; store.saveProfile(profile); this.render(id);
  },
  openSearch: function () { wx.navigateTo({ url: '/packageMore/search/search' }); },
  onShareAppMessage: function () { return { title: i18n.t('cal_share_title'), path: '/pages/calendar/calendar' }; }
});
