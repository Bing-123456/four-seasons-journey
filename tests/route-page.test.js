'use strict';

// Runs the real route Page with the real store/route generator. WXML rendering,
// physical touch and native scroll behavior are checked separately in DevTools.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const store = require('../miniprogram/lib/store');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = value => JSON.parse(JSON.stringify(value));
const venue = catalog.places.find(item => item.routeEligible);
const origin = Object.assign({ name: venue.name, address: venue.address, source: 'catalog' }, venue.location);
const event = id => ({ currentTarget: { dataset: { id } }, detail: {} });
let calls;

function page(name = 'route-detail') {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages', name, name + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    getTabBar: () => ({ setData: value => calls.tabs.push(value) }),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback.call(this);
    }
  });
}

function seed(season = 'summer') {
  const profile = Object.assign({}, clone(catalog.defaultProfile), { season, date: '2026-09-22', origin, duration: 360, interests: ['culture', 'nature', 'photo'] });
  store.saveProfile(profile);
  const route = core.generateRoute(profile);
  assert.equal(route.ok, true);
  store.saveRoute(route);
  return route;
}

test.beforeEach(() => {
  const memory = new Map();
  calls = { tabs: [], navigation: [], scrolling: [], menus: [], clipboard: [], toasts: [], locations: [] };
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    switchTab: options => calls.navigation.push(options.url),
    pageScrollTo: options => calls.scrolling.push(options),
    showActionSheet: options => calls.menus.push(options),
    showToast: options => calls.toasts.push(options),
    setClipboardData: options => calls.clipboard.push(options.data),
    openLocation: options => calls.locations.push(options),
    request: () => { throw Error('Route UI should not request AI or network data'); }
  };
  store.clearAll();
  store.saveSettings({ useAI: false });
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

function assertMapMatchesStops(subject) {
  assert.ok(subject.data.routeMap && Array.isArray(subject.data.routeMap.markers));
  assert.ok(Array.isArray(subject.data.routeMap.polyline) && Array.isArray(subject.data.routeMap.includePoints));
  const ids = subject.data.stops.map(stop => stop.placeId);
  const stopMarkers = subject.data.routeMap.markers.filter(marker => marker.placeId);
  assert.deepEqual(stopMarkers.map(marker => marker.placeId), ids, 'stop markers must mirror the current stop order');
  stopMarkers.forEach((marker, index) => {
    const place = catalog.places.find(item => item.id === marker.placeId);
    assert.ok(place && place.location, 'marker place must carry sourced reference coordinates');
    assert.equal(marker.latitude, place.location.latitude);
    assert.equal(marker.longitude, place.location.longitude);
    assert.equal(marker.id, index);
  });
  if (subject.data.activeStopId) {
    const active = subject.data.routeMap.markers.find(marker => marker.placeId === subject.data.activeStopId);
    assert.ok(active && active.iconPath === '/assets/map-marker-active.png', 'expanded stop must use the active marker');
  }
  const start = { latitude: subject.data.profile.origin.latitude, longitude: subject.data.profile.origin.longitude };
  const originMarker = subject.data.routeMap.markers.find(marker => marker.id === 1000);
  if (originMarker) {
    assert.equal(originMarker.placeId, '');
    assert.equal(originMarker.latitude, start.latitude);
    assert.equal(originMarker.longitude, start.longitude);
    assert.equal(originMarker.callout.display, 'BYCLICK');
  }
  if (subject.data.routeMap.polyline.length) {
    assert.deepEqual(subject.data.routeMap.polyline[0].points, [start].concat(stopMarkers.map(marker => ({ latitude: marker.latitude, longitude: marker.longitude })), [start]));
    assert.ok(subject.data.routeMap.includePoints.length > stopMarkers.length + 1, 'fit includes padding beyond start and stops');
  }
}

test('summer and autumn route rows and native map preserve validated route order and saved profile', () => {
  for (const season of ['summer', 'autumn']) {
    const saved = seed(season);
    const subject = page(); subject.onShow();
    assertMapMatchesStops(subject);
    assert.equal(subject.data.mapVisible, true);
    assert.deepEqual(subject.data.stops.map(stop => stop.placeId), saved.stops.map(stop => stop.placeId));
    subject.data.stops.forEach((stop, index) => {
      assert.equal(stop.number, index + 1);
      assert.equal(typeof stop.displayName, 'string');
      assert.ok(stop.displayName.length);
      assert.equal(stop.arrival, saved.stops[index].arrival);
      assert.equal(stop.cost, saved.stops[index].cost);
      assert.equal(catalog.places.find(place => place.id === stop.placeId).routeEligible, true);
    });
    store.saveProfile(Object.assign({}, store.getProfile(), { partySize: 4, budget: 400 }));
    subject.refresh();
    assert.equal(subject.data.profile.partySize, saved.profileSnapshot.partySize);
    assert.equal(subject.data.route.totalCost, saved.totalCost);
  }
});

test('stop expansion, marker tap and collapse affect presentation without changing the route', () => {
  const saved = seed();
  const subject = page(); subject.onShow();
  const id = subject.data.stops.at(-1).placeId;
  if (subject.data.activeStopId === id) subject.selectStop(event(id));
  subject.selectStop(event(id));
  assert.equal(subject.data.activeStopId, id);
  const activeMarker = subject.data.routeMap.markers.find(marker => marker.placeId === id);
  assert.equal(activeMarker.iconPath, '/assets/map-marker-active.png');
  subject.selectStop(event(id));
  assert.equal(subject.data.activeStopId, '');
  subject.onMarkerTap({ detail: { markerId: activeMarker.id } });
  assert.equal(subject.data.activeStopId, id);
  assert.equal(calls.scrolling.at(-1).selector, '#stop-' + id);
  subject.toggleMap(); assert.equal(subject.data.mapVisible, false);
  subject.toggleMap(); assert.equal(subject.data.mapVisible, true);
  subject.toggleDetails(); assert.equal(subject.data.detailsVisible, true);
  assert.equal(subject.data.visitCost, null);
  assert.equal(subject.data.route.transportCost, null);
  assert.equal(subject.data.route.totalCost, null);
  assert.equal(subject.data.visitCostKnown, false);
  subject.toggleDetails(); assert.equal(subject.data.detailsVisible, false);
  assert.deepEqual(store.getRoute(), saved, 'opening details must not rewrite route costs/times');
  const scrollCount = calls.scrolling.length;
  subject.onMarkerTap({ detail: { markerId: 999 } });
  subject.selectMapStop(event('unknown-stop'));
  subject.selectStop(event('unknown-stop'));
  assert.equal(subject.data.activeStopId, id);
  assert.equal(calls.scrolling.length, scrollCount);
});

test('navigation opens a sourced reference location and reports a native map failure', () => {
  seed();
  const subject = page(); subject.onShow();
  const stop = subject.data.stops[0];
  subject.navigateToStop(event(stop.placeId));
  const opened = calls.locations.at(-1);
  const place = catalog.places.find(item => item.id === stop.placeId);
  assert.equal(opened.latitude, place.location.latitude);
  assert.equal(opened.longitude, place.location.longitude);
  assert.equal(opened.name, stop.displayName);
  assert.equal(opened.address, place.address);
  opened.fail({ errMsg: 'openLocation:fail' });
  assert.match(subject.data.error, /无法打开地图/);
  const before = calls.locations.length;
  subject.navigateToStop(event('unknown-stop'));
  assert.equal(calls.locations.length, before);
});

test('stop menu actions skip sources per plan, keep navigation and skip with cancellation safety', () => {
  seed();
  const subject = page(); subject.onShow();
  const stop = subject.data.stops.find(item => item.hasSource);
  assert.ok(stop);
  subject.openStopMenu(event(stop.placeId));
  let menu = calls.menus.at(-1);
  // 出处入口已按方案整体移除：菜单里不再出现“文化来源”。
  assert.equal(menu.itemList.some(label => /文化来源/.test(label)), false);
  const markup = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../miniprogram/pages/route-detail/route-detail.wxml'), 'utf8');
  assert.doesNotMatch(markup, /文化资料来源|source-overlay/);
  subject.openStop(event(stop.placeId));
  menu = calls.menus.at(-1);
  assert.equal(menu.itemList.some(label => /模拟到达/.test(label)), false);
  assert.equal(typeof subject.simulateArrival, 'undefined');
  subject.openStop(event(stop.placeId));
  assert.equal(calls.navigation.at(-1), '/pages/culture/culture?id=' + stop.placeId);
  const before = clone(subject.data.route);
  subject.openStopMenu(event(stop.placeId));
  menu = calls.menus.at(-1);
  if (menu.fail) menu.fail({ errMsg: 'showActionSheet:fail cancel' });
  assert.deepEqual(subject.data.route, before);
  subject.openStopMenu(event(stop.placeId));
  menu = calls.menus.at(-1);
  menu.success({ tapIndex: menu.itemList.findIndex(label => /跳过/.test(label)) });
  assert.ok(subject.data.excludedIds.includes(stop.placeId));
  assert.ok(subject.data.stops.every(item => item.placeId !== stop.placeId));
  assertMapMatchesStops(subject);
});

test('excluding the expanded stop removes stale map selection; failure and restoration keep map state consistent', () => {
  seed();
  const subject = page(); subject.onShow();
  const first = subject.data.stops[0].placeId;
  subject.selectMapStop(event(first));
  subject.excludeStop(event(first));
  assert.ok(subject.data.stops.every(stop => stop.placeId !== first));
  assert.notEqual(subject.data.activeStopId, first);
  assertMapMatchesStops(subject);
  for (const place of catalog.places.filter(item => item.routeEligible)) subject.excludeStop(event(place.id));
  assert.equal(subject.data.route.ok, false);
  assert.deepEqual(subject.data.stops, []);
  assert.deepEqual(subject.data.routeMap.markers, []);
  assert.deepEqual(subject.data.routeMap.polyline, []);
  assert.deepEqual(subject.data.routeMap.includePoints, []);
  assert.equal(subject.data.activeStopId, '');
  assert.equal(store.getRoute(), null);
  subject.resetStops();
  assert.equal(subject.data.route.ok, true);
  assert.deepEqual(subject.data.excludedIds, []);
  assertMapMatchesStops(subject);
  assert.equal(core.validateRoute(store.getRoute(), store.getProfile()).valid, true);
});

test('clearing a trip shows an honest place preview and removes old route lines, sources and expanded IDs', () => {
  seed();
  const subject = page(); subject.onShow();
  subject.selectMapStop(event(subject.data.stops[0].placeId));
  subject.viewSource({ currentTarget: { dataset: { fact: subject.data.stops[0].factId } } });
  assert.equal(subject.data.sourceVisible, true);
  store.saveRoute(null);
  subject.refresh();
  assert.equal(subject.data.route, null);
  assert.deepEqual(subject.data.stops, []);
  assert.equal(subject.data.routeMap.mode, 'preview');
  assert.deepEqual(subject.data.routeMap.markers.map(marker => marker.placeId), catalog.places.filter(place => place.routeEligible).map(place => place.id));
  assert.deepEqual(subject.data.routeMap.polyline, []);
  assert.ok(subject.data.routeMap.includePoints.length >= subject.data.routeMap.markers.length);
  assert.equal(subject.data.activeStopId, '');
  assert.equal(subject.data.sourceVisible, false);
  assert.deepEqual(subject.data.sources, []);
  seed('autumn');
  subject.refresh();
  assert.ok(subject.data.stops.every(stop => catalog.places.find(place => place.id === stop.placeId).routeEligible));
  assertMapMatchesStops(subject);
});

test('rearranging a displayed summer trip keeps its snapshot after global preferences switch to autumn, including failure and reset', () => {
  const saved = seed('summer');
  const subject = page(); subject.onShow();
  store.saveProfile(Object.assign({}, store.getProfile(), { season: 'autumn', date: '2026-10-18', partySize: 4, budget: 400 }));
  subject.regenerate();
  assert.equal(subject.data.profile.season, 'summer');
  assert.equal(subject.data.profile.partySize, saved.profileSnapshot.partySize);
  assert.ok(subject.data.stops.every(stop => catalog.places.find(place => place.id === stop.placeId).routeEligible));
  subject.excludeStop(event(subject.data.stops[0].placeId));
  assert.equal(subject.data.profile.season, 'summer');
  for (const place of catalog.places.filter(item => item.routeEligible)) subject.excludeStop(event(place.id));
  assert.equal(subject.data.route.ok, false);
  assert.equal(subject.data.profile.season, 'summer');
  assert.equal(subject.data.route.profileSnapshot.season, 'summer');
  subject.resetStops();
  assert.equal(subject.data.route.ok, true);
  assert.ok(subject.data.stops.every(stop => catalog.places.find(place => place.id === stop.placeId).routeEligible));
  assert.equal(subject.data.profile.partySize, saved.profileSnapshot.partySize);
  assert.equal(store.getProfile().season, 'autumn', 'displayed trip actions must not rewrite independent saved preferences');
  assertMapMatchesStops(subject);
});

test('a chosen origin is included without becoming an active stop when all stop details collapse', () => {
  seed();
  const profile = store.getProfile();
  profile.origin = Object.assign({}, profile.origin, { name: '自选起点测试夹具', source: 'user', latitude: profile.origin.latitude - 0.01 });
  store.saveProfile(profile);
  const saved = core.generateRoute(profile); assert.equal(saved.ok, true); store.saveRoute(saved);
  const subject = page(); subject.onShow();
  assertMapMatchesStops(subject);
  subject.selectStop(event(subject.data.activeStopId));
  assert.equal(subject.data.activeStopId, '');
  const originMarker = subject.data.routeMap.markers.find(marker => marker.id === 1000);
  assert.ok(originMarker);
  assert.equal(originMarker.callout.display, 'BYCLICK');
  assert.equal(originMarker.iconPath, '/assets/map-marker.png');
  assert.equal(subject.data.routeMap.markers.some(marker => marker.callout.display === 'ALWAYS'), false);
  const scrollCount = calls.scrolling.length;
  subject.onMarkerTap({ detail: { markerId: 1000 } });
  assert.equal(subject.data.activeStopId, '');
  assert.equal(calls.scrolling.length, scrollCount);
});


test('an empty trip still previews real cultural places without inventing a route or origin', () => {
  const subject = page(); subject.onShow();
  assert.equal(subject.data.route, null); assert.equal(store.getRoute(), null);
  assert.equal(subject.data.profile.origin, null);
  assert.equal(subject.data.routeMap.mode, 'preview');
  assert.equal(subject.data.routeMap.markers.length, 2);
  assert.deepEqual(subject.data.routeMap.polyline, []);
  for (const marker of subject.data.routeMap.markers) {
    const place = catalog.places.find(item => item.id === marker.placeId);
    assert.equal(place.routeEligible, true);
    assert.equal(marker.latitude, place.location.latitude);
    assert.equal(marker.longitude, place.location.longitude);
  }
  const marker = subject.data.routeMap.markers[0];
  subject.onPreviewMarkerTap({ detail: { markerId: marker.id } });
  assert.equal(calls.navigation.at(-1), '/pages/culture/culture?id=' + marker.placeId);
  const count = calls.navigation.length;
  subject.onPreviewMarkerTap({ detail: { markerId: 99999 } });
  subject.openPreviewPlace(event('summer-kitchen'));
  assert.equal(calls.navigation.length, count);
  assert.equal(store.getRoute(), null);
  assert.equal(store.getProfile().origin, null);
  seed(); subject.refresh();
  subject.onPreviewMarkerTap({ detail: { markerId: marker.id } });
  assert.equal(calls.navigation.length, count, 'preview navigation must not intercept an actual itinerary');
});


test('route tab selects a map stop without scrolling and opens the same stop in the full itinerary', () => {
  const saved = seed();
  const overview = page('route'); overview.onShow();
  const last = overview.data.stops.at(-1);
  const marker = overview.data.routeMap.markers.find(item => item.placeId === last.placeId);
  overview.onMarkerTap({ detail: { markerId: marker.id } });
  assert.equal(overview.data.currentStop.placeId, last.placeId);
  assert.equal(calls.scrolling.length, 0, 'the fixed overview must not scroll to a list');
  overview.openFullRoute();
  assert.equal(calls.navigation.at(-1), '/pages/route-detail/route-detail?stop=' + last.placeId);
  const detail = page('route-detail');
  detail.onLoad({ stop: last.placeId }); detail.onShow();
  assert.equal(detail.data.activeStopId, last.placeId);
  assert.deepEqual(store.getRoute(), saved);
  detail.excludeStop(event(last.placeId));
  overview.onShow();
  assert.equal(overview.data.stops.some(stop => stop.placeId === last.placeId), false);
  assert.ok(overview.data.currentStop);
  assert.equal(overview.data.currentStop.placeId, overview.data.stops[0].placeId);
});

test('the overview disables document scrolling while full itinerary preserves the editable stop list', () => {
  const fs = require('node:fs');
  const folder = path.resolve(__dirname, '../miniprogram/pages');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'route/route.json'))).disableScroll, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'route-detail/route-detail.json'))).disableScroll, false);
  const overview = fs.readFileSync(path.join(folder, 'route/route.wxml'), 'utf8');
  const detail = fs.readFileSync(path.join(folder, 'route-detail/route-detail.wxml'), 'utf8');
  assert.match(overview, /id="view-full-route"/);
  assert.doesNotMatch(overview, /wx:for="{{stops}}"/);
  assert.match(detail, /wx:for="{{stops}}"/);
  assert.match(detail, /id="recalculate-route"/);
});
