'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setImmediate: turn } = require('node:timers/promises');
const catalog = require('../miniprogram/data/catalog');
const store = require('../miniprogram/lib/store');
const service = require('../miniprogram/lib/service');
const clone = value => JSON.parse(JSON.stringify(value));
const original = { wx: global.wx, Page: global.Page, parse: service.parseProfile };
let calls;
function loadPage(name, filename) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages', name, (filename || name) + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data), getTabBar: () => ({ setData() {} }),
    setData(patch, callback) { for (const [key, value] of Object.entries(patch)) { const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data; for (const part of parts.slice(0, -1)) target = target[part]; target[parts.at(-1)] = value; } if (callback) callback(); }
  });
}
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
test.beforeEach(() => {
  const state = new Map();
  calls = { navigation: [], menus: [], locations: [], requests: [], titles: [] };
  global.wx = {
    getStorageSync: key => state.get(key), setStorageSync: (key, value) => state.set(key, clone(value)), removeStorageSync: key => state.delete(key),
    navigateTo: input => calls.navigation.push(input.url), switchTab: input => calls.navigation.push(input.url),
    showActionSheet: input => calls.menus.push(input), chooseLocation: input => calls.locations.push(input),
    setNavigationBarTitle: input => calls.titles.push(input.title), showToast() {}, pageScrollTo() {},
    request: input => { calls.requests.push(input); input.fail({ errMsg: 'test offline' }); }
  };
  store.clearAll();
});
test.afterEach(() => { service.parseProfile = original.parse; });
test.after(() => { global.wx = original.wx; global.Page = original.Page; });

test('late profile response never replaces a budget edited while parsing', async () => {
  let complete;
  service.parseProfile = () => new Promise(resolve => { complete = resolve; });
  const page = loadPage('profile'); page.onLoad();
  const previous = clone(page.data.profile);
  page.onTextInput(event({}, '两个人自驾四小时')); page.parse();
  page.setField(event({ field: 'budget' }, '450'));
  complete({ profile: previous, missingFields: [], mode: 'openai-compatible' }); await turn();
  assert.equal(page.data.profile.budget, '450');
  assert.equal(page.data.parsing, false);
  assert.match(page.data.status, /保留新设置/);
});

test('profile parsing preserves the locally chosen origin even if a server returns another origin', async () => {
  const origin = { name: '测试起点', address: '测试夹具', latitude: 34.7, longitude: 113.6, coordinateSystem: 'gcj02', source: 'user' };
  const page = loadPage('profile'); page.onLoad(); page.setData({ 'profile.origin': origin, text: '两个人' });
  service.parseProfile = async () => ({ profile: Object.assign({}, page.data.profile, { origin: null }), missingFields: [], mode: 'openai-compatible' });
  page.parse(); await turn();
  assert.deepEqual(page.data.profile.origin, origin);
});

test('origin chooser lists only route eligible places and reports map failure without inventing a point', () => {
  const page = loadPage('profile'); page.onLoad();
  assert.ok(page.data.originOptions.every(place => place.routeEligible && place.location));
  page.chooseOrigin(); const menu = calls.menus[0];
  assert.equal(menu.itemList.length, page.data.originOptions.length + 1);
  menu.success({ tapIndex: page.data.originOptions.length });
  calls.locations[0].fail({ errMsg: 'chooseLocation:fail denied' });
  assert.match(page.data.error, /从已核实/);
  assert.ok(page.data.profile.origin == null);
});

test('home sheds the hero blocks and the search box; the Guoling search entry stays on the almanac bottom', () => {
  const page = loadPage('index'); page.onShow();
  assert.equal(typeof page.openMill, 'undefined', 'mill handler left home with the old blocks');
  const home = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/index/index.wxml'), 'utf8');
  assert.doesNotMatch(home, /id="guoling-search"/, 'Guoling search box removed from home page per 26.10.2 plan');
  assert.match(home, /id="farming-forecast"/, 'auto-rotating farm forecast block is present');
  assert.doesNotMatch(home, /id="journal-entry"/, 'daily-read shortcut removed per 26.10.5 plan');
  assert.match(home, /id="role-tourist"/, 'first-run role selection is present');
  assert.doesNotMatch(home, /id="farmer-entry"/, 'farmer workbench card removed from home');
  assert.doesNotMatch(home, /id="profile-bag"/, 'personal recommendation shortcut removed per 26.10.5 plan');
  const almanac = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/calendar/calendar.wxml'), 'utf8');
  assert.match(almanac, /id="guoling-search"/, 'the Guoling search entry stays on the almanac page');
  const learnMarkup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/learn/learn.wxml'), 'utf8');
  assert.match(learnMarkup, /<demo-notice id="demo-mode-notice"/, 'learn page carries the demo banner like every page');
  assert.match(learnMarkup, /id="game-quiz"/, 'proverb quiz stays');
  assert.match(learnMarkup, /id="game-challenge"/, 'farming challenge entry is present');
  assert.match(learnMarkup, /id="game-match"/, 'culture match entry is present');
  assert.doesNotMatch(learnMarkup, /hands_on|learn-mill/, 'hands-on workshop block removed per plan');
  const playground = loadPage('playground'); playground.onLoad({ game: 'quiz' }); playground.onShow();
  assert.ok(playground.data.quiz.some(question => question.fruitId), 'the activity detail retains fruit questions and unlock targets');
});

test('retired tea URL cannot select an undocumented exhibit', () => {
  const page = loadPage('heritage', 'index'); page.onLoad({ id: 'tea-set' });
  assert.equal(page.data.artifact.id, 'grain-mill'); assert.equal(page.data.started, false);
});

test('favorites use attributed real photos and text cards for topics with no photo', () => {
  const photographed = catalog.places.find(place => place.image && place.image.src);
  const topic = catalog.places.find(place => place.type === 'topic' && !place.image);
  assert.ok(photographed && topic);
  store.toggleFavorite(photographed.id); store.toggleFavorite(topic.id);
  const page = loadPage('mine'); page.onShow();
  const photoCard = page.data.favorites.find(place => place.id === photographed.id);
  const textCard = page.data.favorites.find(place => place.id === topic.id);
  assert.equal(photoCard.imageView.src, photographed.image.src);
  assert.match(photoCard.imageView.credit, /CC BY-SA/);
  assert.equal(textCard.imageView, null);
  assert.equal(textCard.initial, topic.name.slice(0, 1));
  const mineWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/mine/mine.wxml'), 'utf8');
  assert.doesNotMatch(mineWxml, /\/assets\/henan-/);
  // 收藏入口移到统计位（文化收藏 / 旅游地收藏），两类收藏分开展示。
  assert.match(mineWxml, /openPlaceFavorites/);
  assert.match(mineWxml, /openKnowledgeFavorites/);
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/favorites/favorites.wxml'), 'utf8');
  // 收藏列表页：有图地点显示缩略图，无图主题显示首字卡片；按 type 只展示一类。
  assert.match(wxml, /item\.imageView\.src/);
  assert.match(wxml, /monogram/);
  assert.match(wxml, /pageType !== 'places'/);
  assert.match(wxml, /<demo-notice id="demo-mode-notice"/);
  const favJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/favorites/favorites.js'), 'utf8');
  assert.match(favJs, /type=places/, 'places collection opens its own view');
  assert.doesNotMatch(wxml, /去「四时」继续逛/, 'browse-again button removed per plan');
});

test('origin shortcuts select catalog places without opening a map and menus refresh stale page options', () => {
  const page = loadPage('profile'); page.onLoad();
  const venue = catalog.places.find(place => place.routeEligible);
  page.setData({ originOptions: [] });
  page.chooseQuickOrigin(event({ id: venue.id }));
  assert.equal(page.data.profile.origin.name, venue.name);
  assert.equal(page.data.profile.origin.source, 'catalog');
  assert.equal(calls.locations.length, 0); assert.equal(calls.menus.length, 0);
  page.chooseOrigin(); page.chooseOrigin();
  assert.equal(calls.menus.length, 1, 'duplicate taps must not open duplicate menus');
  assert.equal(calls.menus[0].itemList.length, catalog.places.filter(place => place.routeEligible).length + 1);
  assert.equal(page.data.originOptions.length, 2);
  calls.menus[0].fail({ errMsg: 'showActionSheet:fail cancel' });
  page.chooseOrigin(); assert.equal(calls.menus.length, 2, 'cancel leaves the chooser available');
});

test('slow map opening shows progress, blocks repeated taps and clears on cancel or success', () => {
  const page = loadPage('profile'); page.onLoad();
  page.chooseMapOrigin();
  assert.equal(page.data.originBusy, true); assert.match(page.data.originStatus, /正在打开/);
  page.chooseMapOrigin(); page.chooseOrigin(); page.chooseQuickOrigin(event({ id: 'summer-culture' }));
  assert.equal(calls.locations.length, 1); assert.equal(calls.menus.length, 0);
  assert.equal(page.data.profile.origin, null);
  calls.locations[0].fail({ errMsg: 'chooseLocation:fail cancel' }); calls.locations[0].complete();
  assert.equal(page.data.originBusy, false); assert.equal(page.data.profile.origin, null);
  assert.match(page.data.originStatus, /取消/); assert.equal(page.data.error, '');
  page.chooseMapOrigin(); assert.equal(calls.locations.length, 2);
  calls.locations[1].success({ name: '地图起点测试', address: '测试夹具', latitude: 34.7, longitude: 113.6 }); calls.locations[1].complete();
  assert.equal(page.data.originBusy, false); assert.equal(page.data.profile.origin.name, '地图起点测试');
  page.chooseMapOrigin(); calls.locations[2].fail({ errMsg: 'chooseLocation:fail unavailable' });
  assert.equal(page.data.originBusy, false); assert.equal(page.data.profile.origin.name, '地图起点测试');
  assert.match(page.data.error, /快捷|文化地点/);
});


test('campaign illustrations are packaged JPEGs and native titles remain bilingual', () => {
  const home = loadPage('index'); home.onShow();
  assert.deepEqual(home.data.forecastPosters.map(item => item.title), ['枇杷熬膏', '青梅封坛', '桑葚果酱']);
  for (const item of home.data.forecastPosters) {
    const file = path.resolve(__dirname, '../miniprogram', item.image.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), item.image + ' packaged');
    const bytes = fs.readFileSync(file);
    const isWebp = bytes.slice(0, 4).toString() === 'RIFF' && bytes.slice(8, 12).toString() === 'WEBP';
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    assert.ok(isWebp || isJpeg, item.image + ' must be a valid webp/jpeg illustration');
    assert.ok(bytes.length > 1000, 'illustration must contain image data');
    assert.ok(item.description && item.date && item.place);
  }
  const ids = home.data.forecastPosters.map(item => item.id);
  try {
    store.saveSettings({ language: 'en' }); require('../miniprogram/lib/i18n').invalidateLang(); home.refresh();
    assert.deepEqual(home.data.forecastPosters.map(item => item.id), ids);
    assert.deepEqual(home.data.forecastPosters.map(item => item.title), ['Loquat syrup', 'Green plum preserves', 'Mulberry jam']);
    assert.ok(home.data.forecastPosters.every(item => /Booking unavailable/.test(item.date) && item.bookable === false));
    home.openBooking({ currentTarget: { dataset: { id: ids[0] } } }); assert.equal(home.data.bookingActivity.bookable, false); assert.equal(home.data.bookingVisible, true);
    home.goRoutePlan(); assert.equal(calls.navigation.at(-1), '/pages/route/route');
  } finally { store.saveSettings({ language: 'zh' }); require('../miniprogram/lib/i18n').invalidateLang(); }
});

test('live activities never inherit the fruit or date printed on campaign posters', async () => {
  const booking = require('../miniprogram/lib/booking-service');
  const previous = booking.listActivities;
  try {
    booking.listActivities = async () => ({ activities: [{ id: 'live-pear', title: '秋梨采摘', location: '梨园', startDate: '2026-10-01', endDate: '2026-10-03' }] });
    const home = loadPage('index'); home.refresh();
    await home.loadActivities();
    const activity = home.data.forecastPosters.find(item => item.id === 'live-pear');
    assert.equal(activity.image, '/assets/illustrations/orchard-garden-banner.jpg');
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram', activity.image.replace(/^\//, ''))), 'activity banner packaged');
    assert.equal(activity.title, '秋梨采摘');
    assert.equal(activity.place, '梨园');
    assert.equal(activity.date, '2026-10-01 — 2026-10-03');
    assert.equal(home.data.forecastPosters.filter(item => !item.bookable).length, 3);
    const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/index/index.wxml'), 'utf8');
    assert.match(markup, /wx:if="\{\{item\.bookable\}\}" class="activity-cover-copy"/);
    // 轮播防黑边：底层预烘焙模糊底图铺满（不依赖运行时 CSS filter），上层完整显示。
    assert.match(markup, /class="feature-image feature-image-bg"[^>]*src="\{\{item\.imageBg \|\| item\.image\}\}"[^>]*mode="aspectFill"/);
    assert.match(markup, /class="feature-image feature-image-main"[^>]*mode="aspectFit"/);
    for (const poster of home.data.forecastPosters.filter(item => !item.bookable)) {
      assert.ok(poster.imageBg, poster.id + ' has pre-baked background');
      assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram', poster.imageBg.replace(/^\//, ''))), poster.imageBg + ' packaged');
    }
  } finally { booking.listActivities = previous; }
});

test('all pages identify the isolated demo account and the notice refreshes on every page show', () => {
  const previousComponent = global.Component;
  let definition;
  global.Component = value => { definition = value; };
  const filename = path.resolve(__dirname, '../miniprogram/components/demo-notice/index.js');
  try {
    delete require.cache[require.resolve(filename)]; require(filename);
    const notice = Object.assign({}, definition.methods, { data: clone(definition.data), setData(patch) { Object.assign(this.data, patch); } });
    definition.lifetimes.attached.call(notice);
    assert.equal(notice.data.active, false, 'normal account must not show a banner');
    store.enterDemo(); definition.pageLifetimes.show.call(notice);
    assert.equal(notice.data.active, true);
    notice.openAccount(); assert.equal(calls.navigation.at(-1), '/pages/mine/mine');
    store.exitDemo(); definition.pageLifetimes.show.call(notice);
    assert.equal(notice.data.active, false, 'returning to a cached page refreshes the account mode');
    const app = require('../miniprogram/app.json');
    assert.equal(app.usingComponents['demo-notice'], '/components/demo-notice/index');
    for (const route of app.pages) {
      const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/' + route + '.wxml'), 'utf8');
      assert.match(markup, route === 'pages/mine/mine' ? /id="demo-summary"/ : /<demo-notice id="demo-mode-notice"/);
    }
    const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/components/demo-notice/index.wxml'), 'utf8');
    const stylesheet = fs.readFileSync(path.resolve(__dirname, '../miniprogram/components/demo-notice/index.wxss'), 'utf8');
    const i18n = require('../miniprogram/lib/i18n');
    assert.match(markup, /wx:if="{{active}}"/);
    assert.match(markup, /{{L\.comp_demo_banner}}/, 'banner text is dictionary-bound');
    assert.match(i18n.dict.comp_demo_banner[0], /使用记录为模拟/, 'zh copy keeps the simulated-records disclosure');
    assert.ok(i18n.dict.comp_demo_banner[1], 'en copy exists');
    assert.doesNotMatch(stylesheet, /position\s*:\s*fixed/);
  } finally { global.Component = previousComponent; store.exitDemo(); }
});

test('calendar link graph opens seasonal fruits and world fruits alike, and season cards drop crop names', () => {
  const fruitCulture = require('../miniprogram/data/fruit-culture');
  const page = loadPage('calendar'); page.onLoad();
  for (const [season, seasonal] of [['summer', ['桃子', '李子', '荔枝']], ['autumn', ['柿子', '秋梨', '枣', '猕猴桃']]]) {
    page.choose(event({ id: season }));
    const nodes = page.data.graphNodes;
    assert.deepEqual(nodes.slice(0, seasonal.length).map(node => node.name), seasonal, season + ' puts the specified native group first');
    assert.ok(nodes.length > seasonal.length, season + ' also shows world fruits');
    assert.equal(nodes.filter(node => node.locked).length, 0, season + ' leaves no node locked');
    for (const node of nodes) {
      const fruit = fruitCulture.findFruit(node.id);
      assert.ok(fruit, season + ' ' + node.name + ' resolves to a fruit');
      assert.equal(fruit.categories.length, 6, season + ' ' + node.name + ' carries all six categories');
      assert.ok(fruit.categories.every(item => item.text && item.detail), season + ' ' + node.name + ' fills every category');
    }
    for (const name of (season === 'summer' ? ['西瓜'] : ['石榴', '苹果'])) assert.equal(fruitCulture.fruitsForSeason(season).find(item => item.name === name).world, true);
    assert.equal(page.data.heroImage, undefined, 'the hero photo block is removed from the almanac');
  }
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/calendar/calendar.wxml'), 'utf8');
  assert.doesNotMatch(markup, /\{\{item\.crop\}\}/, 'season cards no longer list crop names');
  assert.match(markup, /is-locked/, 'the locked style stays as a fallback for content not yet written');
});
