'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const geo = require('../miniprogram/lib/geo');
const store = require('../miniprogram/lib/store');
const clone = value => JSON.parse(JSON.stringify(value));
const museum = catalog.places.find(place => place.id === 'summer-culture');
const venueIds = catalog.places.filter(place => place.routeEligible).map(place => place.id);
const origin = { name: museum.name, address: museum.address, latitude: museum.location.latitude, longitude: museum.location.longitude, coordinateSystem: 'gcj02', source: 'catalog' };
const profile = patch => Object.assign(clone(catalog.defaultProfile), { origin: clone(origin), date: '2026-09-22' }, patch);

test('catalog distinguishes public venues, cultural topics and history with sourced coordinates and unknown business fields', () => {
  assert.ok(catalog.facts.length >= 16); assert.ok(catalog.dataVersion);
  const sourceIds = new Set(catalog.sources.map(source => source.id));
  const factIds = new Set(catalog.facts.map(fact => fact.id));
  assert.equal(factIds.size, catalog.facts.length); assert.equal(sourceIds.size, catalog.sources.length);
  catalog.facts.forEach(fact => { assert.ok(fact.sourceIds.length); fact.sourceIds.forEach(id => assert.ok(sourceIds.has(id))); assert.ok(fact.text.trim()); });
  catalog.places.forEach(place => {
    assert.equal(place.demo, false); assert.ok(['venue', 'topic', 'historical'].includes(place.type));
    assert.ok(place.factIds.length); place.factIds.forEach(id => assert.ok(factIds.has(id)));
    assert.equal(place.capacity, null, 'no live capacity source is connected');
    assert.ok(place.price === null || Number.isFinite(place.price) && place.price >= 0);
    if (place.price !== null) { assert.ok(place.priceSourceIds.length); place.priceSourceIds.forEach(id => assert.ok(sourceIds.has(id))); }
    if (place.routeEligible) {
      assert.equal(place.type, 'venue'); assert.equal(geo.validLocation(place.location), true);
      assert.ok(place.location.sourceUrl && place.location.checkedAt && place.location.precision);
      assert.equal(place.location.original.coordinateSystem, 'wgs84'); assert.equal(place.location.coordinateSystem, 'gcj02');
      // 2026-10-09：小程序不再内置实拍图（本地图已全部移除），改为"有图才要求署名"。
      if (place.image) assert.ok(place.image.sourceUrl && place.image.creator && place.image.licenseUrl);
    } else assert.equal(place.location, null, 'reading topics must not masquerade as navigable venues');
  });
  assert.ok(venueIds.length >= 2); assert.ok(catalog.places.some(place => place.type === 'historical'));
});

test('natural-language profile preserves consent, explicit origin and editable missing conditions', () => {
  const parsed = core.parseProfile('2026年10月3日，上午九点半出发，三个人自驾，玩四小时，总预算三百元。带娃喜欢自然和文化，少走路。', profile({ optInSupport: false }));
  assert.equal(parsed.profile.date, '2026-10-03'); assert.equal(parsed.profile.season, 'autumn');
  assert.equal(parsed.profile.startTime, '09:30'); assert.equal(parsed.profile.partySize, 3);
  assert.equal(parsed.profile.duration, 240); assert.equal(parsed.profile.budget, 300);
  assert.deepEqual(parsed.missingFields, []); assert.equal(parsed.profile.optInSupport, false); assert.deepEqual(parsed.profile.origin, origin);
  assert.ok(parsed.profile.interests.includes('family')); assert.equal(parsed.mode, 'local-rules');
  assert.equal(core.parseProfile('3个人，人均预算五十元').profile.budget, 150);
  assert.ok(core.parseProfile('人均预算50元').missingFields.includes('budget'));
  assert.equal(core.parseProfile('不想看文化，只想拍照').profile.interests.includes('culture'), false);
  assert.ok(core.parseProfile('下周六去').missingFields.includes('date')); assert.throws(() => core.parseProfile(null), /描述/);
});

test('route requires explicit real origin and does not fabricate a public-transit timetable', () => {
  assert.deepEqual(core.profileErrors(catalog.defaultProfile), []);
  assert.equal(catalog.defaultProfile.origin, null);
  assert.match(core.generateRoute(catalog.defaultProfile).reason, /真实出发/);
  for (const bad of [{ ...origin, coordinateSystem: 'wgs84' }, { ...origin, latitude: 100 }, { ...origin, name: '' }, { ...origin, source: 'inferred' }]) {
    assert.ok(core.profileErrors(profile({ origin: bad })).length); assert.equal(core.generateRoute(profile({ origin: bad })).ok, false);
  }
  assert.match(core.generateRoute(profile({ transport: 'public' })).reason, /公交.*班次/);
  const remote = { ...origin, name: '北京测试起点', latitude: 39.9, longitude: 116.4, source: 'user' };
  assert.match(core.generateRoute(profile({ origin: remote, duration: 720 })).reason, /距离过远/);
});

test('route accounts for every leg and return but keeps unverified total cost unknown', () => {
  const p = profile(); const route = core.generateRoute(p);
  assert.equal(route.ok, true); assert.deepEqual(core.validateRoute(route, p), { valid: true, errors: [] });
  assert.equal(route.mode, 'estimated'); assert.equal(route.dataVersion, catalog.dataVersion);
  assert.equal(route.totalMinutes, route.visitMinutes + route.travelMinutes + route.waitMinutes);
  assert.equal(route.travelMinutes, route.stops.reduce((sum, stop) => sum + stop.travelMinutes, 0) + route.returnMinutes);
  assert.equal(route.totalCost, null); assert.equal(route.transportCost, null); assert.equal(route.returnCost, null); assert.equal(route.budgetStatus, 'partial');
  assert.equal(route.knownCost, route.stops.reduce((sum, stop) => sum + (stop.cost === null ? 0 : stop.cost), 0));
  assert.ok(route.stops.some(stop => stop.cost === null));
  assert.ok(route.warnings.some(warning => /不保证全程预算/.test(warning)));
  let from = p.origin;
  route.stops.forEach(stop => {
    const place = catalog.places.find(item => item.id === stop.placeId);
    assert.equal(place.routeEligible, true); assert.equal(stop.estimated, true);
    assert.equal(stop.travelMinutes, geo.estimateLeg(from, place.location, p).minutes);
    assert.equal(stop.cost, place.price === null ? null : place.price * p.partySize);
    from = place.location;
  });
  assert.equal(route.returnMinutes, geo.estimateLeg(from, p.origin, p).minutes);
  assert.ok(route.totalMinutes <= p.duration); assert.ok(route.returnMinutes > 0);
});

test('constraint matrix yields independently validated physical routes or explicit no-solution', () => {
  let successes = 0; let failures = 0;
  for (const season of ['summer', 'autumn']) for (const transport of ['drive', 'walk', 'public', 'bike']) for (const budget of [0, 20, 80, 250]) for (const partySize of [1, 3, 9, 20]) for (const duration of [30, 90, 240]) {
    const p = profile({ season, transport, budget, partySize, duration });
    const route = core.generateRoute(p);
    if (route.ok) {
      successes++; assert.deepEqual(core.validateRoute(route, p), { valid: true, errors: [] });
      assert.ok(route.stops.every(stop => venueIds.includes(stop.placeId)));
      assert.ok(route.knownCost <= budget); assert.equal(route.totalCost, null);
    } else { failures++; assert.ok(route.reason); assert.deepEqual(route.stops, []); }
  }
  assert.ok(successes > 30); assert.ok(failures > 30);
});

test('weekday closures and exclusions are respected while real venues work across cultural seasons', () => {
  const monday = core.generateRoute(profile({ date: '2026-09-21' }));
  assert.equal(monday.ok, true); assert.ok(monday.stops.every(stop => stop.placeId !== museum.id));
  assert.equal(core.generateRoute(profile({ date: '2026-09-21' }), { excludedIds: venueIds.filter(id => id !== museum.id) }).ok, false);
  const summer = core.generateRoute(profile({ season: 'summer' })); const autumn = core.generateRoute(profile({ season: 'autumn' }));
  assert.equal(summer.ok, true); assert.equal(autumn.ok, true);
  assert.deepEqual(summer.stops.map(stop => stop.placeId), autumn.stops.map(stop => stop.placeId));
  assert.equal(core.generateRoute(profile(), { excludedIds: venueIds }).ok, false);
  const withoutMuseum = core.generateRoute(profile(), { excludedIds: [museum.id] });
  assert.equal(withoutMuseum.ok, true); assert.ok(withoutMuseum.stops.every(stop => stop.placeId !== museum.id));
  for (const patch of [{ date: '2026-02-30' }, { startTime: '25:00' }, { startTime: '23:00' }, { partySize: 21 }, { budget: -1 }, { duration: 29 }]) assert.equal(core.generateRoute(profile(patch)).ok, false);
});

test('known hours, fees and capacities constrain synthetic fixtures without converting null to zero', () => {
  // Mutate in-memory test fixtures only; production public records remain unchanged.
  const saved = { openMinutes: museum.openMinutes, closeMinutes: museum.closeMinutes, price: museum.price, capacity: museum.capacity };
  const options = { excludedIds: venueIds.filter(id => id !== museum.id) };
  try {
    Object.assign(museum, { openMinutes: 600, closeMinutes: 720, price: 10, capacity: 2 });
    const p = profile({ budget: 20, duration: 360 }); const route = core.generateRoute(p, options);
    assert.equal(route.ok, true); assert.equal(route.waitMinutes, 60); assert.equal(route.knownCost, 20);
    assert.equal(route.stops[0].arrival, '10:00'); assert.equal(route.totalCost, null);
    assert.equal(core.generateRoute(profile({ budget: 19, duration: 360 }), options).ok, false);
    museum.capacity = 1; assert.equal(core.generateRoute(p, options).ok, false);
    museum.capacity = null; assert.equal(core.generateRoute(p, options).ok, true);
    museum.closeMinutes = 660; assert.equal(core.generateRoute(p, options).ok, false);
  } finally { Object.assign(museum, saved); }
});

test('daylight planning window rejects overnight visits without claiming verified opening hours', () => {
  for (const startTime of ['00:00', '05:00', '08:59', '17:00', '23:00']) {
    const result = core.generateRoute(profile({ startTime, duration: 720 }));
    assert.equal(result.ok, false); assert.match(result.reason, /白天参观建议/); assert.match(result.reason, /不是场馆开放时间承诺/);
  }
  const options = { excludedIds: venueIds.filter(id => id !== museum.id) };
  const late = core.generateRoute(profile({ startTime: '15:30', duration: 720 }), options);
  assert.equal(late.ok, true); assert.ok(late.endTime <= '17:00');
  assert.ok(late.warnings.some(warning => /规划建议.*不是营业时段/.test(warning)));
  assert.equal(core.generateRoute(profile({ startTime: '16:00', duration: 720 }), options).ok, false);
});

test('validator rejects tampered costs, elapsed times, spatial data, facts, version and duplicate stops', () => {
  const p = profile(); const route = core.generateRoute(p); assert.equal(route.ok, true);
  const mutations = [
    r => { r.totalCost = 0; }, r => { r.totalMinutes -= r.returnMinutes; }, r => { r.knownCost += 10; },
    r => { r.stops[0].arrival = '00:00'; }, r => { r.stops[0].cost = 10; }, r => { r.returnMinutes = 0; },
    r => { r.stops[0].factId = 'f-kiwi-case'; }, r => { r.stops.push(clone(r.stops[0])); }, r => { r.stops.push(null); },
    r => { r.excludedIds = [r.stops[0].placeId]; }, r => { r.stops[0].placeId = 'autumn-orchard'; },
    r => { r.stops[0].name = '1893百年古法传承园'; }, r => { r.stops[0].straightDistanceKm += 5; },
    r => { r.stops[0].travelMode = 'live-navigation'; }, r => { r.stops[0].estimated = false; }, r => { r.dataVersion = 'outdated'; }
  ];
  mutations.forEach((mutate, index) => { const changed = clone(route); mutate(changed); assert.equal(core.validateRoute(changed, p).valid, false, 'mutation ' + index); });
  assert.equal(core.validateRoute(route, profile({ origin: { ...origin, latitude: origin.latitude + 0.1 } })).valid, false);
});

test('geo uses consistent coordinate systems and increasing plausible travel times', () => {
  const other = catalog.places.find(place => place.id === 'dahecun-museum').location;
  const distance = geo.distanceKm(origin, other);
  assert.ok(distance > 6 && distance < 7); assert.ok(Math.abs(distance - geo.distanceKm(other, origin)) < 1e-10);
  assert.equal(geo.distanceKm(origin, origin), 0);
  assert.throws(() => geo.distanceKm({ ...origin, coordinateSystem: 'wgs84' }, other), /GCJ/);
  const drive = geo.estimateLeg(origin, other, profile({ transport: 'drive' }));
  const bike = geo.estimateLeg(origin, other, profile({ transport: 'bike' }));
  const walk = geo.estimateLeg(origin, other, profile({ transport: 'walk' }));
  assert.ok(drive.minutes < bike.minutes && bike.minutes < walk.minutes);
  assert.ok(walk.minutes >= distance / 6 * 60); assert.equal(drive.cost, null); assert.equal(drive.mode, 'distance-estimate');
});

test('malformed persisted exclusion data is rejected without throwing during validation or read', () => {
  const p = profile(); const route = core.generateRoute(p);
  for (const excludedIds of [{ bad: true }, 'summer-culture', null, 42, [null], ['unknown-place']]) {
    const damaged = { ...clone(route), excludedIds };
    let result;
    assert.doesNotThrow(() => { result = core.validateRoute(damaged, p); }, 'invalid exclusions: ' + JSON.stringify(excludedIds));
    assert.equal(result.valid, false);
  }
  const previousWx = global.wx;
  const disk = { version: 2, profile: p, route: { ...clone(route), excludedIds: { bad: true } } };
  global.wx = { getStorageSync: () => disk };
  try { assert.doesNotThrow(() => { assert.equal(store.getRoute(), null); }); }
  finally { if (previousWx === undefined) delete global.wx; else global.wx = previousWx; }
});

test('an older version-two profile missing origin recovers as unselected instead of crashing', () => {
  const previousWx = global.wx; const oldProfile = clone(catalog.defaultProfile); delete oldProfile.origin;
  global.wx = { getStorageSync: () => ({ version: 2, profile: oldProfile }) };
  try {
    let restored;
    assert.doesNotThrow(() => { restored = store.getProfile(); });
    assert.equal(restored.origin, null); assert.deepEqual(core.profileErrors(restored), []);
  } finally { if (previousWx === undefined) delete global.wx; else global.wx = previousWx; }
});

test('cultural retrieval cites exact evidence and refuses unsupported or live assumptions', () => {
  const heritage = core.answerQuestion('中牟西瓜栽培技艺是省级非遗吗？');
  assert.equal(heritage.unanswerable, false); assert.match(heritage.answer, /市级/); assert.deepEqual(heritage.sourceIds, ['S4']);
  assert.deepEqual(core.answerQuestion('西瓜龙舞是什么非遗？').evidenceIds, ['f-dragon-name']);
  ['1893年老瓜田是谁创办的？', '四膜一布是什么百年古法？', '今年猕猴桃几月采摘？', '明天这个果园有什么活动？', '为什么西瓜会成为非遗？', '这里的天气怎么样？', '量子物理怎么解释？', '猕猴桃是哪里的国家级非遗？', '剪纸是不是省级非遗？'].forEach(question => {
    const answer = core.answerQuestion(question, 'summer-culture'); assert.equal(answer.unanswerable, true, question); assert.deepEqual(answer.sourceIds, []); assert.deepEqual(answer.evidenceIds, []);
  });
  const calendar = core.answerQuestion('猕猴桃采摘时段是农历吗？');
  assert.match(calendar.answer, /农历/); assert.match(calendar.answer, /2026/); assert.deepEqual(calendar.sourceIds, ['S5']);
  assert.equal(core.answerQuestion('讲讲这里的文化', 'autumn-culture').unanswerable, false);
  assert.deepEqual(core.answerQuestion('采摘时间是公历还是农历？', 'autumn-orchard').evidenceIds, ['f-kiwi-calendar']);
  assert.equal(core.answerQuestion('介绍', 'unknown').unanswerable, true);
});

test('store preserves isolated copies and valid references without reviving reservations', () => {
  store.clearAll(); const p = profile(); store.saveProfile(p); p.interests.push('photo'); p.origin.name = 'changed';
  assert.deepEqual(store.getProfile().interests, ['culture', 'nature']); assert.equal(store.getProfile().origin.name, museum.name);
  assert.throws(() => store.saveProfile(profile({ budget: NaN })));
  const route = core.generateRoute(profile()); store.saveRoute(route); assert.equal(store.getRoute().ok, true);
  const fetched = store.getRoute(); fetched.totalCost = 0; assert.equal(store.getRoute().totalCost, null); assert.throws(() => store.saveRoute(fetched));
  assert.deepEqual(store.toggleFavorite(museum.id), [museum.id]); assert.deepEqual(store.toggleFavorite(museum.id), []); assert.throws(() => store.toggleFavorite('unknown'));
  assert.throws(() => store.addIntent({ placeId: museum.id, partySize: 2 }), /不提供体验预约/); assert.deepEqual(store.getIntents(), []);
  store.saveSettings({ useAI: false, apiBase: 'https://example.com/api/' });
  assert.deepEqual(store.getSettings(), { useAI: false, apiBase: 'https://example.com/api', language: 'zh', paired: false, sessionExpiresAt: null });
  assert.throws(() => store.saveSettings({ apiBase: 'https://user:secret@example.com' })); assert.throws(() => store.saveSettings({ useAI: 'true' }));
  store.logEvent('route_generated', { season: 'summer', phone: '13800000000', latitude: 30, note: 'private' }); assert.deepEqual(store.getEvents()[0].details, { season: 'summer' });
  store.clearAll(); assert.deepEqual(store.getEvents(), []); assert.equal(store.getRoute(), null); assert.deepEqual(store.getProfile(), catalog.defaultProfile);
});

test('wx persistence survives reload, filters corrupted fields and surfaces write failures', () => {
  const disk = {}; const previousWx = global.wx;
  global.wx = { getStorageSync: key => disk[key], setStorageSync: (key, value) => { disk[key] = clone(value); }, removeStorageSync: key => { delete disk[key]; } };
  try {
    store.saveProfile(profile({ budget: 250 })); store.toggleFavorite('autumn-culture');
    const key = Object.keys(disk)[0]; delete require.cache[require.resolve('../miniprogram/lib/store')]; const reloaded = require('../miniprogram/lib/store');
    assert.equal(reloaded.getProfile().budget, 250); assert.deepEqual(reloaded.getFavorites(), ['autumn-culture']);
    disk[key].profile = { budget: 'corrupt' }; disk[key].favorites = ['unknown', museum.id, museum.id]; disk[key].route = { ok: true, stops: [null] }; disk[key].intents = [{ placeId: museum.id, partySize: -2 }];
    assert.deepEqual(reloaded.getProfile(), catalog.defaultProfile); assert.deepEqual(reloaded.getFavorites(), [museum.id]); assert.equal(reloaded.getRoute(), null); assert.deepEqual(reloaded.getIntents(), []);
    wx.setStorageSync = () => { throw new Error('quota'); }; assert.throws(() => reloaded.saveProfile(profile()), /保存失败/);
    wx.setStorageSync = (k, value) => { disk[k] = value; }; disk.unrelated = { keep: true }; reloaded.clearAll(); assert.deepEqual(disk.unrelated, { keep: true }); assert.equal(disk[key], undefined);
  } finally { if (previousWx === undefined) delete global.wx; else global.wx = previousWx; store.clearAll(); }
});

test('version-one fictional routes and booked slots are removed even when IDs were retained for source continuity', () => {
  const old = { version: 1, profile: profile(), favorites: [museum.id], route: { ok: true, stops: [{ placeId: museum.id, name: '瓜田文化书屋·演示' }] }, intents: Array.from({ length: 120 }, (_, i) => ({ id: 'old-' + i, placeId: museum.id, partySize: 1 })), activities: [{ title: '旧虚构收费活动' }], events: [{ type: 'old' }], settings: { useAI: true } };
  const previousWx = global.wx; const disk = { 'guayouji.prototype.v1': old };
  global.wx = { getStorageSync: key => disk[key], setStorageSync: (key, value) => { disk[key] = clone(value); }, removeStorageSync: key => { delete disk[key]; } };
  try {
    assert.equal(store.getRoute(), null); assert.deepEqual(store.getFavorites(), []); assert.deepEqual(store.getIntents(), []); assert.deepEqual(store.getEvents(), []);
    assert.equal(store.getSettings().useAI, true, 'migrated settings land on the built-in default'); assert.equal(store.getProfile().origin, null); assert.equal(disk['guayouji.prototype.v1'].version, 2);
    assert.throws(() => store.addIntent({ placeId: museum.id, partySize: 1 }), /不提供体验预约/); assert.deepEqual(store.cancelIntent('old-0'), []);
  } finally { if (previousWx === undefined) delete global.wx; else global.wx = previousWx; store.clearAll(); }
});

test('local product data flow carries an explicit origin through route, source reading and favorite', () => {
  store.clearAll(); store.saveSettings({ useAI: false });
  const parsed = core.parseProfile('2026年9月22日，上午9点出发，两个人自驾，预算200元，玩4小时，喜欢文化', profile());
  store.saveProfile(parsed.profile); store.saveRoute(core.generateRoute(store.getProfile()));
  const first = store.getRoute().stops[0]; const place = catalog.places.find(item => item.id === first.placeId);
  assert.ok(place && place.routeEligible); assert.deepEqual(store.getRoute().profileSnapshot.origin, origin);
  store.toggleFavorite(first.placeId); assert.deepEqual(store.getFavorites(), [first.placeId]);
  const facts = place.factIds.map(id => catalog.facts.find(fact => fact.id === id)); assert.ok(facts.every(fact => fact && fact.sourceIds.length));
  const result = core.answerQuestion('石磨盘的磨棒怎么用？', museum.id); assert.equal(result.unanswerable, false); assert.ok(result.evidenceIds.includes('f-grain-motion'));
  assert.deepEqual(store.getIntents(), []);
  store.clearAll();
});

test('route stops carry explainable multi-factor reasons', () => {
  const profile = catalog.defaultProfile;
  const route = core.generateRoute(profile);
  if (!route.ok) return;
  for (const stop of route.stops) {
    assert.ok(stop.reason && stop.reason.length >= 4, '每站有推荐理由：' + stop.reason);
    assert.doesNotMatch(stop.reason, /^匹配你的/, '理由不再只有单一的旧固定句式');
  }
  const anyFree = route.stops.find(stop => stop.cost === 0);
  const anyPaid = route.stops.find(stop => stop.cost > 0);
  if (anyFree) assert.match(anyFree.reason, /免费|分钟/, '免费站点说明免费或节奏');
  if (anyPaid) assert.ok(anyPaid.reason.length > 4);
});
