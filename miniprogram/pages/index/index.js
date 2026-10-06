const catalog = require('../../data/catalog');
const fruitCulture = require('../../data/fruit-culture');
const store = require('../../lib/store');
const learning = require('../../data/learning');
const content = require('../content-view');
const farmActivities = require('../../data/farm-activities');
const i18n = require('../../lib/i18n');
const booking = require('../../lib/booking-service');
const sellerCore = require('../../lib/seller-core');
const { mergeActivities } = require('../../lib/home-carousel');
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
  data: { bookingVisible: false, bookingActivity: null, bookingDate: '', bookingPeople: '1', bookingBusy: false, bookingError: '', myBookings: [], featureIndex: 0, featureSideMargin: 28, season: 'summer', forecastPosters: [], drawerOpen: false, drawer: { season: { title: '', sub: '' }, game: { sub: '', slots: [] }, route: { title: '', sub: '' }, news: { title: '', sub: '' } } },
  onReady: function () { this.layoutCarousel(); },
  onResize: function () { this.layoutCarousel(); },
  layoutCarousel: function () {},
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
    this.loadActivities();
  },
  refresh: function () {
    const profile = store.getProfile();
    const season = catalog.seasons.find(item => item.id === profile.season) || catalog.seasons[0];
    const en = i18n.getLang() === 'en';
    // 活动信息使用原生文字，插画只负责呈现果物，保证缩放与英文排版可读。
    const L = i18n.labels(['home_news','news_term','news_story','note_verify','resume_text','resume_open','farmer_studio','farmer_studio_sub','home_tagline1','home_brand_welcome','home_tagline2','tab_discover','search_local_web','welcome_title','welcome_caption','welcome_customize','role_title','role_note','role_tourist','role_farmer','role_tourist_desc','role_farmer_desc','collapse_full','expand_full','id_glyph_traveler','id_glyph_farmer','id_search_aria','id_search_title','id_bag_aria','id_bag_title','id_bag_sub','id_bag_go','id_farmer_aria','drawer_handle','drawer_seg_season','drawer_seg_game','drawer_seg_route','drawer_seg_news','drawer_game_title','drawer_game_fresh','drawer_game_today_done','drawer_game_used_up','drawer_game_resume','drawer_season_none','drawer_route_empty','drawer_news_empty','drawer_news_none']);
    const forecastPosters = [
      { id: 'poster-loquat', bookable: false, image: cloudImg.img('illustrations/home-carousel/activity-loquat'), imageBg: cloudImg.imgBg('illustrations/home-carousel/activity-loquat'), title: en ? 'Loquat syrup' : '枇杷熬膏', place: en ? 'Foothill loquat orchard' : '山脚枇杷园', description: en ? 'Freshly picked loquats, slowly simmered into syrup.' : '枇杷采摘，慢熬一盏润心膏。', date: en ? 'Apr 25 · Booking unavailable' : '4月25日 · 活动示例' },
      { id: 'poster-plum', bookable: false, image: cloudImg.img('illustrations/home-carousel/activity-plum'), imageBg: cloudImg.imgBg('illustrations/home-carousel/activity-plum'), title: en ? 'Green plum preserves' : '青梅封坛', place: en ? 'Hillside plum orchard' : '后山梅子园', description: en ? 'Gather green plums and preserve a little spring.' : '青梅采摘，封存一整个春天。', date: en ? 'May 5 · Booking unavailable' : '5月5日 · 活动示例' },
      { id: 'poster-mulberry', bookable: false, image: cloudImg.img('illustrations/home-carousel/activity-mulberry'), imageBg: cloudImg.imgBg('illustrations/home-carousel/activity-mulberry'), title: en ? 'Mulberry jam' : '桑葚果酱', place: en ? 'Orchard' : '果园', description: en ? 'Pick mulberries and jar their purple sweetness.' : '桑葚采摘，酿一罐紫红的甜。', date: en ? 'May 15 · Booking unavailable' : '5月15日 · 活动示例' }
    ];
    this.setData({
      L, season: season.id, isEnglish: en,
      visualCopy: { eventAction: en ? 'View activity' : '查看活动' },
      forecastPosters,
      bookingCopy: en ? { mine: 'My bookings', title: 'Activity booking', date: 'Visit date', people: 'Party size', reserve: 'Confirm booking', cancel: 'Cancel booking', close: 'Done', sample: 'Activity inspiration. No verified organiser has opened booking.', empty: 'No bookings yet', confirmed: 'Confirmed', cancelled: 'Cancelled', unavailable: 'Demo mode does not place real bookings', loading: 'Loading…' } : { mine: '我的预约', title: '活动预约', date: '到访日期', people: '同行人数', reserve: '确认预约', cancel: '取消预约', close: '完成', sample: '活动灵感示例，暂无主办方开放真实预约。', empty: '暂无预约记录', confirmed: '已确认', cancelled: '已取消', unavailable: '演示账户不提交真实预约', loading: '加载中…' },
      savedRoute: store.getRoute(),
      identity: store.getIdentity(),
      companionMini: store.getCompanion(),
      drawer: buildDrawer(this),
      roleSelectVisible: this.data.roleSelectVisible === undefined ? !store.getIdentity().roleChosen : this.data.roleSelectVisible
    }, () => this.layoutCarousel());
  },
  // 主图加载失败时回退到底层 bg（本地小图），避免整块留白。
  onPosterError: function (event) {
    const idx = Number(event.currentTarget.dataset.idx);
    const item = this.data.forecastPosters[idx];
    if (item && item.imageBg) this.setData({ ['forecastPosters[' + idx + '].image']: item.imageBg });
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
  loadActivities: function () {
    if (store.isDemoMode()) return Promise.resolve();
    const partition = store.capturePartition(); const apiBase = store.getSettings().apiBase;
    return booking.listActivities().then(result => { if (partition !== store.capturePartition() || apiBase !== store.getSettings().apiBase) return; const real = result.activities.map(item => ({ ...item, bookable: true, image: cloudImg.img('illustrations/orchard-garden-banner'), imageBg: cloudImg.imgBg('illustrations/orchard-garden-banner-bg'), place: item.location, date: item.startDate + ' — ' + item.endDate })); this.setData(mergeActivities(this.data.forecastPosters, this.data.featureIndex, real)); }).catch(() => {});
  },
  openBooking: function (event) {
    const activity = this.data.forecastPosters.find(item => item.id === event.currentTarget.dataset.id);
    if (!activity) return;
    this._bookingRequestId = booking.requestId();
    this.setData({ bookingVisible: true, bookingActivity: activity, bookingDate: activity.startDate && activity.startDate > sellerCore.today() ? activity.startDate : sellerCore.today(), bookingPeople: '1', bookingError: '', myBookings: [] });
    this.loadMyBookings();
  },
  openMyBookings: function () { this.setData({ bookingVisible: true, bookingActivity: null, bookingError: '', myBookings: [] }); this.loadMyBookings(); },
  loadMyBookings: function () {
    if (store.isDemoMode()) { this.setData({ myBookings: [], bookingError: this.data.bookingCopy.unavailable }); return Promise.resolve(); }
    const partition = store.capturePartition();
    return booking.listBookings().then(result => { if (partition === store.capturePartition()) this.setData({ myBookings: result.bookings.slice().reverse() }); }).catch(error => { if (partition === store.capturePartition()) this.setData({ bookingError: error.message }); });
  },
  closeBooking: function () { if (!this.data.bookingBusy) this.setData({ bookingVisible: false }); },
  bookingInput: function (event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); this._bookingRequestId = booking.requestId(); },
  confirmBooking: function () {
    if (this.data.bookingBusy || !this.data.bookingActivity || !this.data.bookingActivity.bookable) return;
    const partition = store.capturePartition();
    this.setData({ bookingBusy: true, bookingError: '' });
    return booking.reserve({ requestId: this._bookingRequestId, activityId: this.data.bookingActivity.id, date: this.data.bookingDate, people: Number(this.data.bookingPeople) }).then(() => this.loadMyBookings()).catch(error => { if (partition === store.capturePartition()) this.setData({ bookingError: error.message }); }).finally(() => { if (partition === store.capturePartition()) this.setData({ bookingBusy: false }); });
  },
  cancelBooking: function (event) {
    if (this.data.bookingBusy) return;
    const partition = store.capturePartition(); this.setData({ bookingBusy: true, bookingError: '' });
    return booking.cancel(event.currentTarget.dataset.id).then(() => this.loadMyBookings()).catch(error => { if (partition === store.capturePartition()) this.setData({ bookingError: error.message }); }).finally(() => { if (partition === store.capturePartition()) this.setData({ bookingBusy: false }); });
  },
  onShareAppMessage: function (event) {
    return { title: i18n.t('home_share_title'), path: '/pages/index/index' };
  },

  openSearch: function () { wx.navigateTo({ url: '/packageMore/search/search' }); },
  changeFeature: function (event) {
    const current = Number(event.detail.current);
    if (Number.isInteger(current) && current >= 0 && current < this.data.forecastPosters.length && current !== this.data.featureIndex) this.setData({ featureIndex: current });
  },
  selectFeature: function (event) { this.changeFeature({ detail: { current: event.currentTarget.dataset.index } }); },
  openRoute: function () { wx.switchTab({ url: '/pages/route/route' }); }
});
