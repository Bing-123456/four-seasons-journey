const catalog = require('../../data/catalog');
const fruitCulture = require('../../data/fruit-culture');
const solarTerms = require('../../data/solar-term-notes');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const cloudImg = require('../../lib/cloud-images');

// 第1 轮 · 抽屉四段的数据装配（依据 final-design-3pages.html「状态与边界」）。
// 游戏只读本机存档判断每日次数，不改动 lib/challenge-game.js / lib/match-game.js。
// 2026-10-07（第5 轮）：编号与顺序按设计稿第②屏改为 01 农谚问答 / 02 农事转盘 / 03 文脉连连。
const GAMES = {
  quiz: { no: '01', key: 'quiz' },
  challenge: { no: '02', key: 'challenge' },
  match: { no: '03', key: 'match' }
};
// 每日上限（与游戏模块保持一致，只用于抽屉里的「今日剩余」文案，不参与游戏判定）
const CHALLENGE_DAILY_LIMIT = 6;   // lib/challenge-game.js 的 DAILY_LIMIT
const MATCH_DAILY_LIMIT = 2;       // lib/match-game.js 的 DAILY_LIMIT
const QUIZ_DAILY_ROUNDS = 2;       // lib/playground-controller.js：roundsDone >= 2 即当天答完
const QUESTIONS_PER_ROUND = 6;     // data/fruit-quiz.js 的 buildRound：每局不足 6 题会补齐到 6 题

// 海报文字距底：收起 140px（设计稿值）；展开 = 量出来的抽屉真实高度 + 20px；量不到时兜底 400px
const COPY_CLOSED = 140;
const COPY_FALLBACK = 400;

function dayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function readRaw(key) {
  try { const v = wx.getStorageSync(key); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

// 今日快讯条数：由 packageMore/news 页取数后写入本机（带日期，跨天自动失效）。
// 发现页据此显示真实条数，同时不引入 farmtown-service 依赖（tests/discover-blank.test.js 有断言）。
const NEWS_COUNT_KEY = 'guayouji.news.today.';
function readNewsCount() {
  const cache = readRaw(NEWS_COUNT_KEY + store.capturePartition());
  if (!cache || cache.date !== dayKey()) return -1;   // -1 = 今天还没取过数，走中性文案
  const n = Number(cache.count);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

// 海报日期行（设计稿①：「秋分 · 第 15 天 ｜ 距霜降 8 天」）。
// 数字全部由 data/solar-term-notes.js 按公历时段推算，不写死。
function buildTermLine() {
  const t = solarTerms.termProgress();
  if (!t) return '';
  if (i18n.getLang() === 'en') {
    return t.nameEn + ' · day ' + t.dayIndex + '  |  ' + t.daysToNext + ' days to ' + t.nextEn;
  }
  return t.name + ' · 第 ' + t.dayIndex + ' 天 ｜ 距' + t.nextName + ' ' + t.daysToNext + ' 天';
}

// 知识库全部水果（按 season 顺序拼一遍，每项都带 fullId/seasonId）
function allFruits() {
  const out = [];
  (fruitCulture.seasons || []).forEach(function (s) {
    (fruitCulture.fruitsForSeason(s.id) || []).forEach(function (f) { out.push(f); });
  });
  return out;
}

// 今日推荐水果（2026-10-08 第16 轮按用户要求改）：
// 原先只取「当季第一个」，一整个季节都不变；现在按「距 1970-01-01 的天数」在全部水果里循环 ——
// 每天推一个、全部遍历完再从头开始，且同一天内稳定（不是随机，换天必换）。
function buildSeasonFruit(page) {
  const list = allFruits();
  if (!list.length) return null;
  const days = Math.floor((Date.now() - new Date(1970, 0, 1).getTime()) / 86400000);
  const index = ((days % list.length) + list.length) % list.length;
  const fruit = list[index];
  return fruit || null;
}

// 游戏三行状态：按设计稿显示「今日剩余额度」，数字来自真实上限与本机进度；跨天自动归零。
// 顺序固定 01 农谚问答 / 02 农事转盘 / 03 文脉连连；有未打完的一局时给个记号。
function gameSlots(page) {
  const L = page.data.L || i18n.labels(['drawer_game_today_done', 'drawer_game_left_rounds', 'drawer_game_left_spins', 'drawer_game_left_questions', 'drawer_game_resume_chip']);
  const en = i18n.getLang() === 'en';
  const today = dayKey();
  const partition = store.capturePartition();
  const wheel = readRaw('guayouji.challenge.v2.' + partition);
  const wheelToday = wheel && wheel.lastPlayDate === today ? Number(wheel.playedToday) || 0 : 0;
  const match = readRaw('guayouji.match.v1.' + partition);
  const matchToday = match && match.lastPlayDate === today ? Number(match.playedToday) || 0 : 0;
  const quiz = store.getQuizProgress(partition, today);
  const quizDone = Number(quiz.roundsDone) || 0;

  const roundsText = function (left) {
    if (left <= 0) return en ? 'Done for today' : L.drawer_game_today_done;
    return en ? left + ' rounds left' : L.drawer_game_left_rounds + ' ' + left + ' 局';
  };
  const spinsText = function (left) {
    if (left <= 0) return en ? 'Done for today' : L.drawer_game_today_done;
    return en ? left + ' spins left' : L.drawer_game_left_spins + ' ' + left + ' 次';
  };
  // 问答的剩余题数要扣掉「当前这一局已经答掉的题」（2026-10-08 第17 轮）：
  // 以前只按整局算，所以答了 1 题抽屉还说"剩余 12 题"，和游戏里的题号/得分对不上。
  const snap = quiz.round && Array.isArray(quiz.round.ids) && quiz.round.ids.length ? quiz.round : null;
  const answeredThisRound = snap ? (snap.index || 0) + (snap.answered ? 1 : 0) : 0;
  const questionsText = function (leftRounds, answered) {
    if (leftRounds <= 0) return en ? 'Done for today' : L.drawer_game_today_done;
    const left = Math.max(0, leftRounds * QUESTIONS_PER_ROUND - (answered || 0));
    if (left <= 0) return en ? 'Done for today' : L.drawer_game_today_done;
    return en ? left + ' questions left' : L.drawer_game_left_questions + ' ' + left + ' 题';
  };
  const slot = function (key, name, left, limit, text, resume) {
    return { key: key, no: GAMES[key].no, name: name, state: text, left: left, chip: left > 0 && resume ? L.drawer_game_resume_chip : '' };
  };
  // 连连看：「已经连了至少一条线、但这一局还没连完」也算进行中（以前要打完一整局才显示）；
  // 这一局的进度存在 currentRound（见 lib/match-game.js，连中一对就写盘，整局结束清空）。
  const matchRound = match && match.currentRound && typeof match.currentRound === 'object' ? match.currentRound : null;
  const matchMatchedCount = matchRound ? Object.keys(matchRound.matched || {}).length : 0;
  const quizLeft = QUIZ_DAILY_ROUNDS - quizDone;
  const wheelLeft = CHALLENGE_DAILY_LIMIT - wheelToday;
  const matchLeft = MATCH_DAILY_LIMIT - matchToday;
  return [
    // 小标 = 「还有没打完的一局」：问答按"这一局已答题数>0"，连连看按"已连≥1 对但没连完"，
    // 另外都保留原来的口径（当天已经打过一局但额度还有）—— 两者取或，不会把原有现象改掉。
    slot('quiz', i18n.t('game_quiz'), quizLeft, QUIZ_DAILY_ROUNDS, questionsText(quizLeft, answeredThisRound),
      (!!snap && answeredThisRound > 0) || (quizDone > 0 && quizLeft > 0)),
    slot('challenge', i18n.t('game_challenge'), wheelLeft, CHALLENGE_DAILY_LIMIT, spinsText(wheelLeft), wheelToday > 0 && wheelLeft > 0),
    slot('match', i18n.t('game_match'), matchLeft, MATCH_DAILY_LIMIT, roundsText(matchLeft),
      (matchMatchedCount > 0 && matchMatchedCount < 4) || (matchToday > 0 && matchLeft > 0))
  ];
}

// 票的展示格式化（日期时间「10月12日 周一 · 09:00」/ 距出发「距出发 3 天」/ 交通工具「自驾」）
// 与行程页共用 lib/ticket-format.js，保证两处显示一致（2026-10-07 第9 轮抽出）。
const ticketFormat = require('../../lib/ticket-format');

function buildDrawer(page, labels) {
  const en = i18n.getLang() === 'en';
  // 冷启动时 page.data.L 还没赋值（同一次 setData 里才写入），所以由调用方把新词典传进来，
  // 否则四段里所有走 i18n 的文案第一次渲染会是 undefined。
  const L = labels || page.data.L || {};
  const fruit = buildSeasonFruit(page);
  const slots = gameSlots(page);
  const allDone = slots.every(s => s.left <= 0);
  // 行程那一行读的是「票夹」里的票（pages/route 写的就是这一份），
  // 不是旧的路由引擎（store.getRoute 已不再被票夹写入，读它会永远显示"还没有行程"）。
  const tickets = (store.getTickets && store.getTickets()) || [];
  const planned = (tickets || []).filter(function (t) { return t && t.status !== 'visited'; })
    .sort(function (a, b) { return String(a.dateTime).localeCompare(String(b.dateTime)); });
  const nextTicket = planned[0];
  return {
    season: {
      // 设计稿第②屏：「今日推荐水果：柿子」+「看它的水果文化 · 六个板块」
      title: fruit ? (L.drawer_season_prefix + (en ? fruit.nameEn || fruit.name : fruit.name)) : (en ? 'Reveal after Frost’s Descent' : L.drawer_season_none),
      sub: fruit ? (en ? 'See its fruit culture · six dimensions' : L.drawer_season_sub) : (en ? 'Tap to open the almanac' : L.drawer_season_none_sub || '')
    },
    game: { sub: allDone ? (en ? 'Today’s rounds are done' : L.drawer_game_today_done) : (en ? 'Pick a round to play' : ''), slots: slots },
    // 设计稿第②屏：「您的今日行程：洛川王大爷苹果园」+「10月12日 周六 · 09:00 ｜ 自驾」
    route: nextTicket
      ? { title: i18n.t(String(nextTicket.dateTime || '').slice(0, 10) === (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }()) ? 'drawer_route_today' : (String(nextTicket.dateTime || '').slice(0, 10) > (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }()) ? 'drawer_route_upcoming' : 'drawer_route_past')) + (nextTicket.destName || ''), sub: ticketFormat.whenLabel(nextTicket.dateTime) + ' ｜ ' + ticketFormat.transportLabel(nextTicket.transport) }
      : { title: en ? 'No trip yet' : L.drawer_route_empty, sub: en ? 'Plan one now' : '' },
    news: (function () {
      const count = readNewsCount();
      return {
        title: en ? 'Fruit news today' : L.drawer_news_title,
        // 设计稿第②屏：「果农今天新发布了 2 张果乡名片」；条数取真实值，没取到就说没取到
        sub: count > 0
          ? (L.drawer_news_posted + ' ' + count + (en ? ' new today' : ' 张果乡名片'))
          : (count === 0
            ? (en ? 'No grower post today' : L.drawer_news_empty)
            : (en ? 'See what’s new today' : L.drawer_news_check))
      };
    })()
  };
}

Page({
  // 2026-10-07：三图自动轮播与活动预约整套删除，发现页只留设计稿那张柿子海报（不再轮播）。
  // 海报文案走 i18n 的 home_poster_title，图片走 cloud-images.js 的 orchard-garden-banner。
  // 第5 轮：这一页改成 navigationStyle:custom（标题浮在照片上），所以要自己算状态栏高度。
  // 第8 轮：头像挪到左边和「发现」并排（右上角让给胶囊按钮），所以这一行可以和导航带同高。
  data: { poster: { image: '', imageBg: '' }, termLine: '', statusBarHeight: 20, navTop: 64, season: 'summer', drawerOpen: false, gameOpen: true, copyBottom: 140, drawer: { season: { title: '', sub: '' }, game: { sub: '', slots: [] }, route: { title: '', sub: '' }, news: { title: '', sub: '' } } },
  onLoad: function () { i18n.applyNav('app_name');
    // 自定义导航：状态栏高度 + 44px 导航带；「发现」+头像整行左对齐，落在导航带里、避开右上角胶囊。
    let info = {};
    try {
      info = (wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})) || {};
    } catch (e) { info = {}; }
    const statusBarHeight = Number(info.statusBarHeight) || 20;
    this.setData({ statusBarHeight: statusBarHeight, navTop: statusBarHeight });
    this.refresh();
    // 一打开先选身份（游客/果农）；游客必须先定制打招呼小水果，再进入后面内容。
    const identity = store.getIdentity();
    // 10.6：不再"身份是果农就自动跳回工作台"——那会让用户点系统小房子回到首页时被弹回工作台（第一次闪跳、第二次才好）。
    // 进工作台只走主动入口：openSeller() / 我的页的 switchRole()。
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
    // 兜底：这是游客页，若身份还停在"果农"（例如从工作台直接回到首页），切回游客
    try {
      const store = require('../../lib/store');
      if (store.getIdentity && store.getIdentity().role === 'farmer') {
        store.saveIdentity({ role: 'tourist', roleChosen: true });
      }
    } catch (error) { /* 忽略 */ }
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });     const bar = this.getTabBar(); if (bar) { bar.setData({ selected: 0 }); if (bar.applyLang) bar.applyLang(); }
    const identity = store.getIdentity();
    // 10.6：进入工作台只走主动入口（openSeller / 我的页 switchRole），不再自动跳转。
    this._farmerRedirecting = false;
    // 定制完打招呼小水果后才放行欢迎页；未完成定制则继续停留。
    this.setData({ identity, welcomeVisible: this.shouldWelcome(identity), welcomeCompanion: store.getCompanion() });
    this.refresh();
  },
  refresh: function () {
    const profile = store.getProfile();
    const season = catalog.seasons.find(item => item.id === profile.season) || catalog.seasons[0];
    const L = i18n.labels(['app_name','home_news','news_term','news_story','note_verify','resume_text','resume_open','farmer_studio','farmer_studio_sub','home_tagline1','home_brand_welcome','home_tagline2','home_poster_title','tab_discover','search_local_web','welcome_title','welcome_caption','welcome_customize','role_title','role_note','role_tourist','role_farmer','role_tourist_desc','role_farmer_desc','collapse_full','expand_full','id_glyph_traveler','id_glyph_farmer','id_search_aria','id_search_title','id_bag_aria','id_bag_title','id_bag_sub','id_bag_go','id_farmer_aria','drawer_handle','drawer_seg_season','drawer_seg_game','drawer_seg_route','drawer_seg_news','drawer_game_title','drawer_game_fresh','drawer_game_today_done','drawer_game_used_up','drawer_game_resume','drawer_season_none','drawer_route_empty','drawer_news_empty','drawer_news_none','drawer_news_title','drawer_news_count','drawer_news_check','drawer_season_prefix','drawer_season_sub','drawer_news_posted','drawer_route_today','drawer_game_left_rounds','drawer_game_left_spins','drawer_game_left_questions','drawer_game_resume_chip','rt_transport_self','rt_transport_share','rt_transport_public']);
    this.setData({
      L, season: season.id,
      termLine: buildTermLine(),
      poster: {
        image: cloudImg.img('illustrations/orchard-garden-banner'),
        imageBg: cloudImg.imgBg('illustrations/orchard-garden-banner-bg')
      },
      savedRoute: store.getRoute(),
      identity: store.getIdentity(),
      companionMini: store.getCompanion(),
      drawer: buildDrawer(this, L),
      roleSelectVisible: this.data.roleSelectVisible === undefined ? !store.getIdentity().roleChosen : this.data.roleSelectVisible
    });
  },
  // 主图加载失败时回退到底层 bg（本地小图），避免整块留白。
  onPosterError: function () {
    const poster = this.data.poster || {};
    if (poster.imageBg) this.setData({ 'poster.image': poster.imageBg });
  },
  // 抽屉开合（2026-10-08 第17 轮）：海报上那一大段字要跟着一起上滑 ——
  // 抽屉高度是跟内容走的（还会随字号大/特大变化），所以这里量一次抽屉面板的真实高度，
  // 把文字的 bottom 设成「抽屉高 + 20px」；CSS 上有 .3s 过渡，两者同速上滑。
  setDrawer: function (open) {
    const self = this;
    this.setData({ drawerOpen: open });
    if (!open) { this.setData({ copyBottom: COPY_CLOSED }); return; }
    if (typeof this.createSelectorQuery !== 'function') { this.setData({ copyBottom: COPY_FALLBACK }); return; }
    try {
      this.createSelectorQuery().select('.drawer-panel').boundingClientRect(function (rect) {
        // 面板自身高度 = 内容高度，不受外层 max-height 过渡影响，所以什么时候量都准
        const h = rect && rect.height ? rect.height : 0;
        self.setData({ copyBottom: h ? Math.round(h + 20) : COPY_FALLBACK });
      }).exec();
    } catch (e) {
      this.setData({ copyBottom: COPY_FALLBACK });
    }
  },
  toggleDrawer: function () { this.setDrawer(!this.data.drawerOpen); },
  // 上滑展开 / 下滑收回（设计稿把手文案就是「上滑看今天的果事」，所以手势要真的能用；
  // 位移不超过 20px 时不处理，交给 bindtap 当点按切换）。
  onHandleTouchStart: function (event) {
    const t = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    this._handleTouchY = t && Number.isFinite(t.clientY) ? t.clientY : null;
  },
  onHandleTouchEnd: function (event) {
    const t = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]);
    const start = this._handleTouchY;
    this._handleTouchY = null;
    if (start === null || !t || !Number.isFinite(t.clientY)) return;
    const dy = t.clientY - start;
    if (dy <= -20) this.setDrawer(true);
    else if (dy >= 20) this.setDrawer(false);
  },
  // 抽屉四段直达（2026-10-08 第14 轮按用户要求改）：
  //   四时 → 该推荐水果的文化页（★水果文化页读的参数名是 fruit，不是 id，之前传错所以进的是空页）
  //   游戏 → 只做折叠/展开那三行（箭头 ⌄ / ›），不再跳游戏页
  //   行程 → 行程页（票夹）；快讯 → 今日快讯页
  openDrawerSeg: function (event) {
    const seg = event.currentTarget.dataset.seg;
    if (seg === 'season') {
      const fruit = buildSeasonFruit(this);
      // ★水果文化页的 findFruit() 认的是 fullId（形如 autumn-persimmon），不是 fruit.id（persimmon）：
      //   参数名与取值两处都要对，否则页面会落到「内容还没有收录」。传法与 pages/calendar 保持一致。
      const fullId = fruit && (fruit.fullId || (fruit.seasonId && fruit.id ? fruit.seasonId + '-' + fruit.id : ''));
      if (fullId) {
        wx.navigateTo({
          url: '/packageFruit/pages/fruit-detail/fruit-detail?fruit=' + encodeURIComponent(fullId),
          fail: function () { wx.switchTab({ url: '/pages/calendar/calendar' }); }
        });
      } else {
        wx.switchTab({ url: '/pages/calendar/calendar' });
      }
      return;
    }
    if (seg === 'route') {
      wx.switchTab({ url: '/pages/route/route', fail: function () { wx.navigateTo({ url: '/pages/route/route' }); } });
      return;
    }
    if (seg === 'news') { wx.navigateTo({ url: '/packageMore/news/news' }); return; }
  },
  // 游戏段：点一下折叠/展开下面三行，箭头跟着变（展开 ⌄、收起 ›）
  toggleGameSection: function () { this.setData({ gameOpen: !this.data.gameOpen }); },
  openDrawerGameHub: function () { wx.switchTab({ url: '/pages/learn/learn' }); },
  // 01/02/03 直达对应游戏页（playground 读 query.game：quiz / challenge / match）
  openGame: function (event) {
    const key = event.currentTarget.dataset.game;
    const game = GAMES[key] ? key : 'quiz';
    wx.navigateTo({
      url: '/pages/playground/playground?game=' + game,
      fail: function () { wx.switchTab({ url: '/pages/learn/learn' }); }
    });
  },
  onShareAppMessage: function (event) {
    return { title: i18n.t('home_share_title'), path: '/pages/index/index' };
  },

  openSearch: function () { wx.navigateTo({ url: '/packageMore/search/search' }); },
  openRoute: function () { wx.switchTab({ url: '/pages/route/route' }); }
});
