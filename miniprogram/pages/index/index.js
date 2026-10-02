const catalog = require('../../data/catalog');
const store = require('../../lib/store');
const learning = require('../../data/learning');
const content = require('../content-view');
const solarTermNotes = require('../../data/solar-term-notes');
const farmActivities = require('../../data/farm-activities');
const farmerStories = require('../../data/farmer-stories');
const i18n = require('../../lib/i18n');
const booking = require('../../lib/booking-service');
const sellerCore = require('../../lib/seller-core');
const { carouselLayout, mergeActivities } = require('../../lib/home-carousel');

// 个性化推荐：按用户兴趣与条目标签的重合度排序。
function personalize(places, profile) {
  const interests = Array.isArray(profile.interests) ? profile.interests : [];
  if (!interests.length) return places;
  return places.slice().sort((a, b) => {
    const score = place => (place.tags || []).filter(tag => interests.includes(tag)).length;
    return score(b) - score(a);
  });
}

Page({
  data: { bookingVisible: false, bookingActivity: null, bookingDate: '', bookingPeople: '1', bookingBusy: false, bookingError: '', myBookings: [], featureIndex: 0, featureSideMargin: 28, season: 'summer', termNote: null, seasonStory: null, forecastPosters: [], termExpanded: false, storyExpanded: false, storyText: '' },
  onReady: function () { this.layoutCarousel(); },
  onResize: function () { this.layoutCarousel(); },
  layoutCarousel: function () {
    // wx.nextTick 在部分测试环境缺失，降级为直接执行（查询本身异步，无需强制等下一帧）。
    if (typeof this.createSelectorQuery !== 'function') return;
    const run = () => {
      const query = this.createSelectorQuery();
      query.select('.feature-swiper').boundingClientRect();
      query.select('.home-shortcuts').boundingClientRect();
      query.exec(([rect, shortcuts]) => {
        if (!rect || !rect.width || !shortcuts || !shortcuts.width) return;
        const { sideMargin } = carouselLayout(rect.width, shortcuts.width);
        if (this.data.featureSideMargin !== sideMargin) this.setData({ featureSideMargin: sideMargin });
      });
    };
    if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(run);
    else run();
  },
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
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });     const bar = this.getTabBar(); if (bar) bar.setData({ selected: 0 });
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
    void personalize;
    const termNote = solarTermNotes.currentTerm();
    const en = i18n.getLang() === 'en';
    const seasonStory = farmerStories.storyForSeason(season.id) || { fruit: en ? 'F' : '果农', name: en ? 'Story coming soon' : '故事整理中', place: '—', text: en ? 'More farmer stories will arrive soon.' : '更多老农口述故事将陆续上架。' };
    // 活动信息使用原生文字，插画只负责呈现果物，保证缩放与英文排版可读。
    const L = i18n.labels(['home_news','news_term','news_story','note_verify','resume_text','resume_open','farmer_studio','farmer_studio_sub','home_tagline1','home_tagline2','search_local_web','welcome_title','welcome_caption','welcome_customize','role_title','role_note','role_tourist','role_farmer','role_tourist_desc','role_farmer_desc','collapse_full','expand_full','id_glyph_traveler','id_glyph_farmer','id_search_aria','id_search_title','id_bag_aria','id_bag_title','id_bag_sub','id_bag_go','id_farmer_aria']);
    const forecastPosters = [
      { id: 'poster-plum', bookable: false, image: '/assets/illustrations/cover-plum.jpg', imageBg: '/assets/illustrations/cover-plum-bg.jpg', title: en ? 'Green plum preserves' : '青梅封坛', place: en ? 'Hillside plum orchard' : '后山梅子园', description: en ? 'Gather green plums and preserve a little spring.' : '青梅采摘，封存一整个春天。', date: en ? 'May 5 · Booking unavailable' : '5月5日 · 活动示例' },
      { id: 'poster-loquat', bookable: false, image: '/assets/illustrations/cover-loquat.jpg', imageBg: '/assets/illustrations/cover-loquat-bg.jpg', title: en ? 'Loquat syrup' : '枇杷熬膏', place: en ? 'Foothill loquat orchard' : '山脚枇杷园', description: en ? 'Freshly picked loquats, slowly simmered into syrup.' : '枇杷采摘，慢熬一盏润心膏。', date: en ? 'Apr 25 · Booking unavailable' : '4月25日 · 活动示例' },
      { id: 'poster-peach', bookable: false, image: '/assets/illustrations/cover-peach.jpg', imageBg: '/assets/illustrations/cover-peach-bg.jpg', title: en ? 'Peach jam' : '桃子果酱', place: en ? 'Peach Creek orchard' : '桃溪果园', description: en ? 'Pick peaches and jar a spoonful of summer sweetness.' : '桃子采摘，封存一勺夏天的甜。', date: en ? 'May 25 · Booking unavailable' : '5月25日 · 活动示例' }
    ];
    this.setData({
      L, season: season.id, isEnglish: en,
      visualCopy: { journal: en ? 'SEASONAL PICKS' : '今日发现', events: en ? 'ORCHARD ACTIVITIES' : '农事活动', eventAction: en ? 'View activity' : '查看活动', illustration: en ? 'Chinese-style fruit illustration' : '国风果物插画', collection: en ? 'RECOMMENDATIONS' : '个性推荐', reading: en ? 'READ & EXPLORE' : '每日一读', readingTitle: en ? 'Seasonal stories' : '节气与故事' },
      forecastPosters,
      bookingCopy: en ? { mine: 'My bookings', title: 'Activity booking', date: 'Visit date', people: 'Party size', reserve: 'Confirm booking', cancel: 'Cancel booking', close: 'Done', sample: 'Activity inspiration. No verified organiser has opened booking.', empty: 'No bookings yet', confirmed: 'Confirmed', cancelled: 'Cancelled', unavailable: 'Demo mode does not place real bookings', loading: 'Loading…' } : { mine: '我的预约', title: '活动预约', date: '到访日期', people: '同行人数', reserve: '确认预约', cancel: '取消预约', close: '完成', sample: '活动灵感示例，暂无主办方开放真实预约。', empty: '暂无预约记录', confirmed: '已确认', cancelled: '已取消', unavailable: '演示账户不提交真实预约', loading: '加载中…' },
      termNote: termNote ? (i18n.getLang() === 'en' ? Object.assign({}, termNote, { name: termNote.enName || termNote.name, headline: termNote.enHeadline || termNote.headline, text: termNote.enText || termNote.text }) : termNote) : null,
      seasonStory, storyText: seasonStory.text,
      savedRoute: store.getRoute(),
      identity: store.getIdentity(),
      companionMini: store.getCompanion(),
      roleSelectVisible: this.data.roleSelectVisible === undefined ? !store.getIdentity().roleChosen : this.data.roleSelectVisible
    }, () => this.layoutCarousel());
  },
  loadActivities: function () {
    if (store.isDemoMode()) return Promise.resolve();
    const partition = store.capturePartition(); const apiBase = store.getSettings().apiBase;
    return booking.listActivities().then(result => { if (partition !== store.capturePartition() || apiBase !== store.getSettings().apiBase) return; const real = result.activities.map(item => ({ ...item, bookable: true, image: '/assets/illustrations/orchard-garden-banner.jpg', imageBg: '/assets/illustrations/orchard-garden-banner-bg.jpg', place: item.location, date: item.startDate + ' — ' + item.endDate })); this.setData(mergeActivities(this.data.forecastPosters, this.data.featureIndex, real)); }).catch(() => {});
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
  toggleTerm: function () { this.setData({ termExpanded: !this.data.termExpanded }); },
  toggleStory: function () { this.setData({ storyExpanded: !this.data.storyExpanded }); },
  onShareAppMessage: function () {
    return { title: i18n.t('home_share_title'), path: '/pages/index/index' };
  },
  openSearch: function () { wx.navigateTo({ url: '/pages/search/search' }); },
  openJournal: function () { wx.navigateTo({ url: '/pages/journal/journal' }); },
  changeFeature: function (event) {
    const current = Number(event.detail.current);
    if (Number.isInteger(current) && current >= 0 && current < this.data.forecastPosters.length && current !== this.data.featureIndex) this.setData({ featureIndex: current });
  },
  selectFeature: function (event) { this.changeFeature({ detail: { current: event.currentTarget.dataset.index } }); },
  openPlaceFinder: function () { wx.navigateTo({ url: '/pages/place-finder/place-finder' }); },
  openRoute: function () { wx.switchTab({ url: '/pages/route/route' }); }
});
