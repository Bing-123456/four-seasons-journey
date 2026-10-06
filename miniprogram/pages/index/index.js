const catalog = require('../../data/catalog');
const fruitCulture = require('../../data/fruit-culture');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const cloudImg = require('../../lib/cloud-images');

// 第1 轮 · 抽屉四段的数据装配（依据 final-design-3pages.html「状态与边界」）。
// 游戏只读本机存档判断每日次数，不改动 lib/challenge-game.js / lib/match-game.js。
const GAMES = {
  challenge: { no: '01', key: 'challenge' },
  match: { no: '02', key: 'match' },
  quiz: { no: '03', key: 'quiz' }
};
const DAILY_LIMIT = 6;
const QUIZ_DAILY_LIMIT = 3;

function dayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function readRaw(key) {
  try { const v = wx.getStorageSync(key); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

// 当季首果：取当前所选节令的第一个水果；无推荐时返回 null（走空态文案）。
function buildSeasonFruit(page) {
  const seasonId = page.data.season;
  const fruits = fruitCulture.fruitsForSeason(seasonId) || [];
  return fruits.length ? fruits[0] : null;
}

// 游戏三格状态：进度存档里 playedToday / roundsDone 判断；跨天自动归零。
function gameSlots(page) {
  const L = page.data.L || i18n.labels(['drawer_game_fresh', 'drawer_game_today_done', 'drawer_game_used_up', 'drawer_game_resume']);
  const today = dayKey();
  const partition = store.capturePartition();
  const wheel = readRaw('guayouji.challenge.v2.' + partition);
  const wheelToday = wheel && wheel.lastPlayDate === today ? Number(wheel.playedToday) || 0 : 0;
  const match = readRaw('guayouji.match.v1.' + partition);
  const matchToday = match && match.lastPlayDate === today ? Number(match.playedToday) || 0 : 0;
  const quiz = store.getQuizProgress(partition, today);
  const quizDone = Number(quiz.roundsDone) || 0;

  const state = function (played, limit) {
    if (played > 0 && played < limit) return i18n.getLang() === 'en' ? 'Resume' : L.drawer_game_resume;
    if (played >= limit) return i18n.getLang() === 'en' ? 'All used up today' : L.drawer_game_used_up;
    return L.drawer_game_fresh;
  };
  const done = function (played, limit) {
    if (played > 0 && played < limit) return '';
    return played >= limit ? L.drawer_game_today_done : L.drawer_game_fresh;
  };
  return [
    { key: 'challenge', no: GAMES.challenge.no, name: i18n.t('game_challenge'), state: state(wheelToday, DAILY_LIMIT) + done(wheelToday, DAILY_LIMIT) },
    { key: 'match', no: GAMES.match.no, name: i18n.t('game_match'), state: state(matchToday, DAILY_LIMIT) + done(matchToday, DAILY_LIMIT) },
    { key: 'quiz', no: GAMES.quiz.no, name: i18n.t('game_quiz'), state: state(quizDone, QUIZ_DAILY_LIMIT) + done(quizDone, QUIZ_DAILY_LIMIT) }
  ];
}

function buildDrawer(page) {
  const en = i18n.getLang() === 'en';
  const L = page.data.L || {};
  const fruit = buildSeasonFruit(page);
  const savedRoute = store.getRoute();
  const slots = gameSlots(page);
  const allDone = slots.every(s => /用完|Done|used up|All used/.test(s.state) || s.state.indexOf('已完成') >= 0 || s.state.indexOf('All used') >= 0);
  return {
    season: {
      title: fruit ? (en ? fruit.nameEn || fruit.name : fruit.name) : (en ? 'Reveal after Frost’s Descent' : L.drawer_season_none),
      sub: fruit ? (en ? 'Fruit culture · six dimensions' : '水果文化 · 六维') : (en ? 'Tap to open the almanac' : L.drawer_season_none_sub || '')
    },
    game: { sub: allDone ? (en ? 'Today’s rounds are done' : L.drawer_game_today_done) : (en ? 'Pick a round to play' : ''), slots: slots },
    route: savedRoute && savedRoute.stops && savedRoute.stops.length
      ? { title: en ? 'Next stop ready' : '下一站已就绪', sub: en ? 'Open your trip' : '打开行程看详情' }
      : { title: en ? 'No trip yet' : L.drawer_route_empty, sub: en ? 'Plan one now' : '' },
    news: { title: en ? 'No new post today' : L.drawer_news_none, sub: en ? 'Growers post here' : '果农今天还没有发布' }
  };
}

Page({
  // 2026-10-07：三图自动轮播与活动预约整套删除，发现页只留设计稿那张柿子海报（不再轮播）。
  // 海报文案走 i18n 的 home_poster_title，图片走 cloud-images.js 的 orchard-garden-banner。
  data: { poster: { image: '', imageBg: '' }, season: 'summer', drawerOpen: false, drawer: { season: { title: '', sub: '' }, game: { sub: '', slots: [] }, route: { title: '', sub: '' }, news: { title: '', sub: '' } } },
  onLoad: function () { i18n.applyNav('app_name');
    this.refresh();
    // 一打开先选身份（游客/果农）；游客必须先定制打招呼小水果，再进入后面内容。
    const identity = store.getIdentity();
    if (identity.roleChosen && identity.role === 'farmer') { this.resumeFarmer(); return; }
    this.setData({
      welcomeVisible: this.shouldWelcome(identity),
      welcomeCompanion: store.getCompanion(),
      identity,
      roleSelectVisible: !identity.roleChosen
    });
  },
  shouldWelcome: function (identity) {
    return !!(identity.roleChosen && identity.role !== 'farmer' && !identity.greetingCustomized);
  },
  openCompanion: function () { wx.navigateTo({ url: '/pages/companion/companion?gate=1' }); },
  skipWelcome: function () { this.setData({ welcomeVisible: false }); },
  chooseRole: function (event) {
    const role = event.currentTarget.dataset.role;
    if (!['tourist', 'farmer'].includes(role)) return;
    try { store.saveIdentity({ role, roleChosen: true }); } catch (error) { /* 角色保存失败不打断浏览 */ }
    const identity = store.getIdentity();
    this.setData({ identity, roleSelectVisible: false });
    // 果农直接进入工作台；游客需先定制打招呼小水果（欢迎页常驻直到保存完成）。
    if (role === 'farmer') this.resumeFarmer();
    else if (!identity.greetingCustomized) this.setData({ welcomeVisible: true, welcomeCompanion: store.getCompanion() });
  },
  resumeFarmer: function () { if (this._farmerRedirecting) return; this._farmerRedirecting = true; const open = wx.reLaunch || wx.navigateTo; open.call(wx, { url: '/pages/seller/index', fail: () => { this._farmerRedirecting = false; } }); },
  openSeller: function () { wx.navigateTo({ url: '/pages/seller/index' }); },
  goRoutePlan: function () { wx.switchTab({ url: '/pages/route/route' }); },
  noop: function () {},
  onShow: function () {
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });     const bar = this.getTabBar(); if (bar) { bar.setData({ selected: 0 }); if (bar.applyLang) bar.applyLang(); }
    const identity = store.getIdentity();
    if (identity.roleChosen && identity.role === 'farmer') { this.resumeFarmer(); return; }
    this._farmerRedirecting = false;
    // 定制完打招呼小水果后才放行欢迎页；未完成定制则继续停留。
    this.setData({ identity, welcomeVisible: this.shouldWelcome(identity), welcomeCompanion: store.getCompanion() });
    this.refresh();
  },
  refresh: function () {
    const profile = store.getProfile();
    const season = catalog.seasons.find(item => item.id === profile.season) || catalog.seasons[0];
    const L = i18n.labels(['home_news','news_term','news_story','note_verify','resume_text','resume_open','farmer_studio','farmer_studio_sub','home_tagline1','home_brand_welcome','home_tagline2','home_poster_title','tab_discover','search_local_web','welcome_title','welcome_caption','welcome_customize','role_title','role_note','role_tourist','role_farmer','role_tourist_desc','role_farmer_desc','collapse_full','expand_full','id_glyph_traveler','id_glyph_farmer','id_search_aria','id_search_title','id_bag_aria','id_bag_title','id_bag_sub','id_bag_go','id_farmer_aria','drawer_handle','drawer_seg_season','drawer_seg_game','drawer_seg_route','drawer_seg_news','drawer_game_title','drawer_game_fresh','drawer_game_today_done','drawer_game_used_up','drawer_game_resume','drawer_season_none','drawer_route_empty','drawer_news_empty','drawer_news_none']);
    this.setData({
      L, season: season.id,
      poster: {
        image: cloudImg.img('illustrations/orchard-garden-banner'),
        imageBg: cloudImg.imgBg('illustrations/orchard-garden-banner-bg')
      },
      savedRoute: store.getRoute(),
      identity: store.getIdentity(),
      companionMini: store.getCompanion(),
      drawer: buildDrawer(this),
      roleSelectVisible: this.data.roleSelectVisible === undefined ? !store.getIdentity().roleChosen : this.data.roleSelectVisible
    });
  },
  // 主图加载失败时回退到底层 bg（本地小图），避免整块留白。
  onPosterError: function () {
    const poster = this.data.poster || {};
    if (poster.imageBg) this.setData({ 'poster.image': poster.imageBg });
  },
  toggleDrawer: function () { this.setData({ drawerOpen: !this.data.drawerOpen }); },
  // 抽屉三段直达（快讯段本轮不跳转，待 pages/news 建成后接入）。
  openDrawerSeg: function (event) {
    const seg = event.currentTarget.dataset.seg;
    if (seg === 'season') {
      const fruit = buildSeasonFruit(this);
      if (fruit) wx.navigateTo({ url: '/packageFruit/pages/fruit-detail/fruit-detail?id=' + fruit.id + '&cat=folk' });
      else wx.switchTab({ url: '/pages/calendar/calendar' });
      return;
    }
    if (seg === 'route') { wx.switchTab({ url: '/pages/route/route' }); return; }
    if (seg === 'news') { this.setData({ drawerOpen: false }); return; }
  },
  openDrawerGameHub: function () { wx.switchTab({ url: '/pages/learn/learn' }); },
  // 01/02/03 直达对应游戏：有未完成的一局就续玩，否则开局。
  openGame: function (event) {
    const key = event.currentTarget.dataset.game;
    if (!key || GAMES[key]) wx.switchTab({ url: '/pages/learn/learn', success: () => { if (key) wx.navigateTo({ url: '/pages/playground/playground?game=' + key }); } });
  },
  onShareAppMessage: function (event) {
    return { title: i18n.t('home_share_title'), path: '/pages/index/index' };
  },

  openSearch: function () { wx.navigateTo({ url: '/packageMore/search/search' }); },
  openRoute: function () { wx.switchTab({ url: '/pages/route/route' }); }
});
