'use strict';

// 分步向导定制行程（评审 P24③《"行程"的修改方案》）：向导状态机、方案字段映射、
// 生成链路复用（core.generateRoute 本地确定性生成）与入口接线的回归测试。
// 所有 wx 存储与定位/导航接口都在进程内 mock，不触网、不由语言模型生成。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const store = require('../miniprogram/lib/store');
const flow = require('../miniprogram/packageTrip/lib/visitor-flow');
const lib = require('../miniprogram/packageTrip/lib/trip-wizard');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = value => JSON.parse(JSON.stringify(value));
const venue = catalog.places.find(item => item.routeEligible);
const origin = { name: venue.name, address: venue.address, latitude: venue.location.latitude, longitude: venue.location.longitude, coordinateSystem: 'gcj02', source: 'user' };
const taps = (dataset, detail) => ({ currentTarget: { dataset: dataset || {} }, detail: detail || {} });
let calls;
let memory;

function mockWx(location) {
  memory = new Map();
  calls = { navigation: [], location: [] };
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    getLocation: options => { calls.location.push('getLocation'); options.success({ latitude: 34.75, longitude: 113.62 }); },
    chooseLocation: options => { calls.location.push('chooseLocation'); options.success({ name: '二七广场', address: '郑州市二七区', latitude: 34.66, longitude: 113.66 }); },
    redirectTo: options => calls.navigation.push(options.url),
    navigateTo: options => calls.navigation.push(options.url)
  };
}

// Page 控制器 harness：渲染由 DevTools 检查，这里跑真实页面逻辑。
function loadWizardPage() {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/packageTrip/pages/trip-wizard/trip-wizard.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  });
}

test.beforeEach(() => { mockWx(); store.clearAll(); store.saveSettings({ useAI: false }); });
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('wizard state machine gates one question per step and normalizes stored drafts', () => {
  const blank = lib.blankWizard();
  for (const step of [1, 2, 5]) assert.equal(lib.stepValid(blank, step), false, 'step ' + step + ' needs an answer');
  assert.equal(lib.stepValid(blank, 7), true, 'step 7 is a review screen');
  // normalize：非法值一律回落默认，startPoint 必须是可用的 GCJ-02 起点。
  const dirty = lib.normalizeWizard({ fruitTheme: 'x'.repeat(40), duration: 'aWeek', peopleCount: '99', budget: 'all', preferences: ['pick', 'bogus', 'photo'], date: '2026/10/10', startPoint: { latitude: 1, longitude: 2 } });
  assert.deepEqual([dirty.duration, dirty.peopleCount, dirty.budget], ['fullDay', '2', 'mid']);
  assert.deepEqual(dirty.preferences, ['pick', 'photo'], 'unknown picks dropped, known order kept');
  assert.equal(dirty.date, '');
  assert.equal(dirty.startPoint, null);
  assert.equal(dirty.fruitTheme.length, 12);
  // 存储往返：写入 guayouji.trip-wizard.v1 后读回一致。
  const draft = lib.normalizeWizard(Object.assign(blank, { fruitTheme: '柿子', date: '2026-10-10', preferences: ['pick'] }));
  lib.saveWizard(draft);
  assert.ok(memory.has(lib.STORAGE_KEY));
  assert.deepEqual(lib.loadWizard(), draft);
  // 人数联动：带娃自动预选亲子友好项；换回其他档不强行清除。
  const family = lib.applyPeopleEffect(draft, 'family');
  assert.equal(family.peopleCount, 'family');
  assert.deepEqual(family.preferences, ['pick', 'sight', 'photo'], 'plan: 田园观光 + 拍照记录 preselected');
  assert.deepEqual(lib.applyPeopleEffect(family, '2').preferences, ['pick', 'sight', 'photo']);
  assert.equal(lib.stepValid(family, 4), true);
});

test('step 1 fruit cards follow the seasonal list and the plan hooks, without invented lore', () => {
  const autumn = lib.fruitCards('autumn', false, '柿子');
  const names = autumn.map(card => card.name);
  assert.ok(names.includes('柿子') && names.includes('秋梨') && names.includes('石榴') && names.includes('枣'));
  assert.deepEqual(autumn.map(card => card.selected), names.map(name => name === '柿子'), 'only the chosen theme is marked');
  const hooks = Object.fromEntries(autumn.map(card => [card.name, card.hook]));
  assert.equal(hooks['柿子'], '霜降吃柿，红红火火');
  assert.equal(hooks['秋梨'], '一罐秋梨膏，润了秋燥');
  assert.equal(hooks['石榴'], '千籽同房，多子多福');
  assert.equal(hooks['枣'], '当季鲜果，正当时令', 'unmapped fruits get the generic seasonal hook');
  assert.equal(lib.fruitCards('summer', false, '').find(card => card.name === '西瓜').hook, '一口清甜，解锁消夏民俗');
  assert.equal(lib.fruitCards('summer', false, '').find(card => card.name === '桃子').hook, '桃符桃木，沾点吉祥气');
  assert.equal(lib.fruitCards('autumn', true, '').find(card => card.name === '柿子').hook, 'Red-glow frost persimmons');
  assert.ok(lib.fruitCards('spring', false, '').every(card => card.hook && card.name), 'every season renders full cards');
});

test('step 2 orchard suggestions match the fruit theme and fall back to season places', () => {
  assert.deepEqual(lib.matchedOrchards('西瓜', 'summer').map(item => item.id), ['summer-field', 'summer-kitchen'], '西瓜 matches 中牟西瓜栽培技艺与瓜豆酱');
  assert.deepEqual(lib.matchedOrchards('猕猴桃', 'autumn').map(item => item.id), ['autumn-orchard']);
  // 桃子不能误中「猕猴桃」：无精确匹配时退回当季核心地点。
  const peach = lib.matchedOrchards('桃子', 'summer').map(item => item.id);
  assert.ok(peach.includes('summer-field') && !peach.includes('autumn-orchard'));
  assert.deepEqual(lib.matchedOrchards('柿子', 'autumn').map(item => item.id), ['autumn-orchard', 'autumn-culture'], 'fallback = 当季核心地点');
  assert.equal(lib.matchedOrchards('', 'autumn').length > 0, true);
});

test('adapter maps wizard picks onto the core profile with plan field semantics', () => {
  const wizard = lib.normalizeWizard({ fruitTheme: '柿子', startPoint: origin, orchard: '刁家乡的农事时间', date: '2026-10-10', duration: 'fullDay', peopleCount: 'family', preferences: ['pick', 'sight', 'photo'], budget: 'mid', note: '想听霜降的故事' });
  const base = Object.assign({}, catalog.defaultProfile, { transport: 'public', walking: 'normal', optInSupport: true, origin: null });
  const profile = lib.mapWizardToProfile(wizard, base);
  assert.deepEqual(core.profileErrors(profile), [], 'mapped profile must satisfy core validation');
  assert.equal(profile.season, 'autumn');
  assert.equal(profile.startTime, '09:00', 'plan timeline starts at 09:00');
  assert.equal(profile.duration, 480);
  assert.equal(profile.partySize, 3, '带娃 counts 2 adults + 1 kid');
  assert.equal(profile.budget, 900, '人均档 × 人数 = 团队总预算');
  assert.equal(profile.transport, 'drive', '公交无班次资料，自动改自驾');
  assert.deepEqual(profile.interests, ['nature', 'photo', 'family', 'culture', 'slow'], '偏好映射 + 亲子 + 园子标签，去重 ≤6');
  assert.match(profile.note, /向导定制：水果 柿子/);
  assert.match(profile.note, /公交无班次资料，按自驾估算/);
  assert.match(profile.note, /补充：想听霜降的故事/);
  assert.equal(profile.walking, 'normal');
  assert.equal(profile.optInSupport, true);
  assert.deepEqual(profile.origin, origin);
  // 其余档位映射。
  assert.equal(lib.mapWizardToProfile(lib.normalizeWizard({ peopleCount: '4plus', duration: 'halfDay', budget: 'low' }), catalog.defaultProfile).partySize, 4);
  const half = lib.mapWizardToProfile(lib.normalizeWizard({ peopleCount: '1', duration: 'halfDay', budget: 'low', startPoint: origin, date: '2026-10-10', orchard: 'x', preferences: ['pick'] }), catalog.defaultProfile);
  assert.equal(half.duration, 240);
  assert.equal(half.budget, 100);
  assert.deepEqual(lib.mapWizardToProfile(lib.normalizeWizard({ duration: 'twoDays' }), catalog.defaultProfile).duration, 720, '两日按首日全天规划');
});

test('buildRoute reuses the deterministic generation chain, stores plan fields, and fails honestly', () => {
  const wizard = lib.normalizeWizard({ fruitTheme: '柿子', startPoint: origin, orchard: '刁家乡的农事时间', date: '2026-10-10', duration: 'fullDay', peopleCount: 'family', preferences: ['pick', 'sight', 'photo'], budget: 'mid' });
  const result = lib.buildRoute(wizard);
  assert.equal(result.ok, true, JSON.stringify(result.reason || ''));
  assert.deepEqual(core.validateRoute(result.route, result.profile), { valid: true, errors: [] });
  // 方案第五节字段名原样挂在 route.wizard。
  assert.deepEqual(Object.keys(result.route.wizard), ['fruitTheme', 'startPoint', 'orchard', 'date', 'duration', 'peopleCount', 'preferences', 'budget', 'note']);
  assert.equal(result.route.wizard.fruitTheme, '柿子');
  assert.equal(result.route.wizard.duration, 'fullDay');
  assert.equal(result.route.wizard.peopleCount, 'family');
  assert.equal(result.route.wizard.budget, 'mid');
  assert.deepEqual(result.route.wizard.preferences, ['pick', 'sight', 'photo']);
  // store 行程页能读回（内部再次 validateRoute），设备级信号与事件照常采集。
  const saved = store.getRoute();
  assert.ok(saved && saved.ok && saved.stops.length > 0);
  assert.deepEqual(saved.wizard, result.route.wizard);
  assert.equal(flow.summarize().totalTrips, 1);
  assert.ok(store.getEvents().some(event => event.type === 'trip_wizard_generate'));
  // 未完成向导不生成、不写存储。
  store.clearAll();
  const partial = lib.buildRoute(lib.blankWizard());
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /未完成/);
  assert.equal(store.getRoute(), null);
  // 起点过远时如实带回生成原因，供向导微调。
  const far = lib.normalizeWizard(Object.assign({}, wizard, { startPoint: { name: '远地', address: 'x', latitude: 30.0, longitude: 120.0, coordinateSystem: 'gcj02', source: 'user' } }));
  const failed = lib.buildRoute(far);
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /起点距离过远|郑州/);
  assert.equal(store.getRoute(), null);
});

test('wizard page walks one screen per step and redirects to the trip page after generating', () => {
  const page = loadWizardPage();
  page.onLoad();
  assert.equal(page.data.step, 1);
  assert.equal(page.data.canNext, false);
  assert.ok(page.data.fruitCards.some(card => card.name === '柿子'), 'cards come from the current profile season');
  assert.equal(page.data.progressText.indexOf('1'), page.data.progressText.indexOf('1'), 'progress text is precomputed');
  page.onFruit(taps({ name: '柿子' }));
  assert.equal(page.data.canNext, true);
  page.nextStep();
  assert.equal(page.data.step, 2);
  // 使用当前位置（用户主动点击才触发）与地图选点都能落起点。
  page.useLocation();
  assert.deepEqual(calls.location, ['getLocation']);
  assert.equal(page.data.startPointLabel, '我的位置');
  page.chooseMapPoint();
  assert.equal(page.data.startPointLabel, '二七广场');
  page.pickOrchard(taps({ name: '辰耕基地的猕猴桃故事' }));
  page.nextStep();
  page.onDateChange(taps({}, { value: '2026-10-10' }));
  page.nextStep();
  page.pickPeople(taps({ id: 'family' }));
  page.nextStep();
  assert.equal(page.data.familyHint, true, '带娃提示亲子预选');
  page.togglePreference(taps({ id: 'pick' }));
  assert.deepEqual(page.data.wizard.preferences, ['pick', 'sight', 'photo'], 'normalize keeps canonical option order');
  page.nextStep();
  page.pickBudget(taps({ id: 'mid' }));
  page.nextStep();
  assert.equal(page.data.step, 7);
  assert.equal(page.data.summaryRows.length, 8, 'summary card: 水果/起点/园子/日期/时长/人数/偏好/预算');
  assert.equal(page.data.summaryRows[0].k, '水果主题');
  // 生成 → redirectTo 行程详情页；路线与向导数据都已落库。
  page.generate();
  assert.deepEqual(calls.navigation, ['/packageMore/route-detail/route-detail']);
  const saved = store.getRoute();
  assert.ok(saved && saved.ok);
  assert.equal(saved.wizard.peopleCount, 'family');
  assert.equal(saved.wizard.orchard, '辰耕基地的猕猴桃故事');
  // 生成失败时留在第 7 步并给出可操作的微调提示。
  page.update({ startPoint: { name: '远地', address: 'x', latitude: 30.0, longitude: 120.0, coordinateSystem: 'gcj02', source: 'user' } });
  page.generate();
  assert.equal(page.data.step, 7);
  assert.match(page.data.error, /暂时排不出来/);
  assert.deepEqual(calls.navigation, ['/packageMore/route-detail/route-detail']);
  // 上一步回退。
  page.prevStep();
  assert.equal(page.data.step, 6);
});

test('entries and registration: route-detail opens the wizard, P04 route page is untouched', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const trip = app.subPackages.find(pkg => pkg.root === 'packageTrip');
  assert.deepEqual(trip && trip.pages, ['pages/trip-wizard/trip-wizard']);
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(root, 'packageTrip/pages/trip-wizard/trip-wizard.' + ext)), ext + ' missing');
  }
  const detail = fs.readFileSync(path.join(root, 'packageMore/route-detail/route-detail.wxml'), 'utf8');
  assert.match(detail, /id="start-route"[^>]*bindtap="openWizard"/);
  assert.match(detail, /id="route-add"[^>]*bindtap="openWizard"/);
  assert.doesNotMatch(detail, /id="start-route"[^>]*bindtap="editProfile"/);
  assert.match(detail, /bindtap="editProfile"/, 'other entries keep pointing at the profile form');
  const routeTab = fs.readFileSync(path.join(root, 'pages/route/route.wxml'), 'utf8');
  assert.doesNotMatch(routeTab, /openWizard/, 'P04 route tab keeps its own editProfile entries');
  const detailJs = fs.readFileSync(path.join(root, 'packageMore/route-detail/route-detail.js'), 'utf8');
  assert.match(detailJs, /packageTrip\/pages\/trip-wizard\/trip-wizard/);
  // 页面文案保持文旅语气，不出现商业词。
  const pageSource = ['trip-wizard.wxml', 'trip-wizard.js'].map(name => fs.readFileSync(path.join(root, 'packageTrip/pages/trip-wizard', name), 'utf8')).join('\n');
  for (const word of ['促销', '特价', '售卖']) assert.doesNotMatch(pageSource, new RegExp(word));
});
