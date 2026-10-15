'use strict';
// 编辑老名片时「所在地区」要能预选 + 没填时行内红字提示（2026-10-17）。
// 背景：<picker mode="region"> 的 value 只认它自己那份全名（「陕西省 / 延安市 / 洛川县」），
// 而存档一直是短名（「陕西」）→ 编辑态三列对不上，选择器只能停在第一列；
// 校验本来就会给 errors.region，但模板没渲染它 → 只弹一句一闪而过的 toast，栏位上没有红字。
// 这份测试盯住四件事：
//   ① 双存：除存档那三段短名外，再存一份选择器原样返回的全名三段（form.regionFull），
//      编辑态（loadTown）把它读回给 regionValue → 预选成功；
//   ② 老存档（只有短名 / regionFull 形状不对）照旧能用：不预选、不报错、显示与存档形状一个字没变；
//   ③ 卡片与列表显示仍用短名（form.province / city / county），不许把「陕西」显示成「陕西省」；
//   ④ 模板照别的字段的既有写法渲染 errors.region，文案复用既有键 pub_err_region（不新增 i18n 键）。
// 桩与 tests/seller-publish-picker.test.js / seller-publish-errors.test.js 同一套：真加载页面、内存 storage。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const publishFlow = require('../miniprogram/pages/seller/publish/publish-flow');

const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const PUBLISH_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.wxml');
const WXML = fs.readFileSync(PUBLISH_WXML, 'utf8');

const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const useLang = code => { store.saveSettings({ language: code }); i18n.invalidateLang(); };

// 老名片的存档形状（省名是短名，服务端白名单也只认这几项）：一个字没改。
const TOWN = {
  id: 'town-mine', favId: 'fruit-town:townmine', term: '秋分', published: true,
  name: '洛川苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
  activityDate: '', address: '洛川县凤栖镇××路8号',
  openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00',
  experiences: ['采摘', '观光'], description: '三代人种苹果，霜降后最甜。',
  wechat: 'guoyuan2026', phone: '13800000000',
  location: { latitude: 35.76, longitude: 109.43 }, locationName: '陕西延安市洛川县'
};

let memory;
let calls;
let town;   // 详情接口回的那张名片（用例按需换掉）

function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: o => calls.navigation.push(o.url),
    navigateBack: () => calls.navigation.push('navigateBack'),
    showToast: o => calls.toasts.push(o),
    setNavigationBarTitle: o => calls.titles.push(o.title),
    request: opts => {
      const url = opts.url || '';
      calls.requests.push(url);
      const data = url.includes('/api/farmtown/detail') ? { town: clone(town) } : { town: clone(TOWN) };
      if (opts.success) opts.success({ statusCode: 200, data: data });
    }
  };
}

function makePage() {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(PUBLISH_JS)];
  require(PUBLISH_JS);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback.call(this);
    }
  });
}

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], requests: [], titles: [] };
  town = TOWN;
  store.exitDemo();
  store.clearAll();
  i18n.invalidateLang();
  mockWx();
});
test.after(() => { delete global.wx; });

// ---- ① 双存：选择器那份全名与存档那份短名各就各位 ----

test('选完地区：选择器那份全名三段进 form.regionFull（跟 regionValue 同一份），存档三段仍是短名', () => {
  const page = makePage();
  page.onLoad();
  assert.deepEqual(page.data.form.regionFull, [], '没选过就是空数组');
  page.onRegionChange({ detail: { value: ['陕西省', '延安市', '洛川县'] } });
  assert.deepEqual(page.data.form.regionFull, ['陕西省', '延安市', '洛川县'], '选择器原样返回的全名三段留一份');
  assert.deepEqual(page.data.regionValue, ['陕西省', '延安市', '洛川县'], '交给选择器的那一份与它一致');
  assert.equal(page.data.form.province, '陕西', '存档仍是短省名');
  assert.equal(page.data.form.city, '延安市');
  assert.equal(page.data.form.county, '洛川县');
  // 三段不齐 = 选择器没给齐：两份都不留脏值（与既有 regionValue 的口径一样）
  page.onRegionChange({ detail: { value: ['陕西省'] } });
  assert.deepEqual(page.data.form.regionFull, []);
  assert.deepEqual(page.data.regionValue, []);
});

test('带全名三段的老名片：编辑态 regionValue 被预选，短名存档与那一行显示一个字没改', async () => {
  town = Object.assign({}, TOWN, { regionFull: ['陕西省', '延安市', '洛川县'] });
  const page = makePage();
  page.onLoad({ id: 'town-mine' });
  await wait();
  assert.deepEqual(page.data.regionValue, ['陕西省', '延安市', '洛川县'], '拿得到全名就预选（选择器停在这三列）');
  assert.deepEqual(page.data.form.regionFull, ['陕西省', '延安市', '洛川县'], '全名三段也在表单里留了一份');
  assert.ok(Array.isArray(page.data.regionValue), 'regionValue 必须是 data 顶层数组');
  assert.equal(page.data.form.regionValue, undefined, 'regionValue 不该嵌进 form');
  // 存档形状没变：那一行显示的仍是已存的三段短名
  assert.equal(page.data.form.province, '陕西');
  assert.equal([page.data.form.province, page.data.form.city, page.data.form.county].join(' '), '陕西 延安市 洛川县');
});

test('新建时选过的地区：服务端存档仍只有短名，下次编辑这一张（哪怕是结果页发出去的、id 没见过）也预选得上', async () => {
  const page = makePage();
  page.onLoad();
  page.onRegionChange({ detail: { value: ['河南省', '郑州市', '中牟县'] } });
  assert.deepEqual(page.data.form.regionFull, ['河南省', '郑州市', '中牟县'], '表单里留一份全名三段（双存的那一份）');
  // 这里是结果页「保存并发布」那条路：名片 id 是本机第一次见到的（publish 页发出去之前并不知道 id），
  // 服务端白名单也不收 regionFull —— 只有存档那三段短名能对上，照样要预选得上。
  town = Object.assign({}, TOWN, { id: 'town-from-plan', province: '河南', city: '郑州市', county: '中牟县' });
  const again = makePage();
  again.onLoad({ id: 'town-from-plan' });
  await wait();
  assert.deepEqual(again.data.regionValue, ['河南省', '郑州市', '中牟县'], '本机记的那一份按三段短名找回来预选');
  assert.equal(again.data.form.province, '河南', '存档侧仍是短名');
  assert.equal(again.data.form.city, '郑州市');
});

test('本机只记最近选过的 8 个地区：同一份不重复记，也不会无限长大', () => {
  const key = 'guayouji.town.regionFull.' + store.capturePartition();
  const page = makePage();
  page.onLoad();
  page.onRegionChange({ detail: { value: ['陕西省', '延安市', '洛川县'] } });
  page.onRegionChange({ detail: { value: ['陕西省', '延安市', '洛川县'] } });
  assert.deepEqual(memory.get(key), [['陕西省', '延安市', '洛川县']], '同一份地区只留最新的一条');
  for (let i = 0; i < 12; i += 1) page.onRegionChange({ detail: { value: ['测试省' + i, '测试市', '测试县'] } });
  const stored = memory.get(key);
  assert.equal(stored.length, 8, '最多 8 条，本机存档不无限长大');
  assert.deepEqual(stored[0], ['测试省11', '测试市', '测试县'], '最新选的排最前');
});

// ---- ② 老存档照旧能用：不预选、不报错、行为与加这一项之前一样 ----
test('老存档（没有全名 / 形状不对）：regionValue 仍是 []，页面不报错，其它字段照旧回填', async () => {
  const shapes = [undefined, null, '陕西', ['陕西省'], ['陕西省', '延安市'], ['陕西省', '延安市', ''], [1, 2, 3], { 0: '陕西省', 1: '延安市', 2: '洛川县' }];
  for (const shape of shapes) {
    store.clearAll();
    town = Object.assign({}, TOWN, { regionFull: shape });
    const page = makePage();
    page.onLoad({ id: 'town-mine' });
    await wait();
    assert.deepEqual(page.data.regionValue, [], '取不到可用的全名就不预选（退化成本轮之前的行为）：' + JSON.stringify(shape));
    assert.deepEqual(page.data.form.regionFull, []);
    assert.equal(page.data.error, '', '不许因此报错：' + JSON.stringify(shape));
    assert.equal(page.data.form.province, '陕西');
    assert.equal(page.data.form.city, '延安市');
    assert.equal(page.data.form.county, '洛川县');
    assert.equal(page.data.editing, true, '仍是编辑态');
  }
});

test('本机存档坏了（不是对象 / 读存储抛错）也不预选、不崩', async () => {
  memory.set('guayouji.town.regionFull.' + store.capturePartition(), '坏了');
  let page = makePage();
  page.onLoad({ id: 'town-mine' });
  await wait();
  assert.deepEqual(page.data.regionValue, []);
  assert.equal(page.data.error, '');

  global.wx.getStorageSync = () => { throw new Error('storage broken'); };
  page = makePage();
  page.onLoad({ id: 'town-mine' });
  await wait();
  assert.deepEqual(page.data.regionValue, [], '读存储抛错也照旧走老行为');
  assert.equal(page.data.error, '');
});

// ---- ③ 显示与上报仍用短名 ----

test('模板那一行显示的仍是短名，不许把「陕西」显示成「陕西省」；regionFull 不跟着 payload 上服务端', () => {
  assert.match(WXML, /\{\{form\.province \|\| L\.pub_region_ph\}\} \{\{form\.city\}\} \{\{form\.county\}\}/,
    '那一行照旧显示已存的三段短名，不许改成显示 regionValue / regionFull');
  assert.doesNotMatch(WXML, /\{\{regionValue\}\}[^"]*\}\} \{\{form\.city\}\}/, '显示那行不许拿选择器那份全名来凑');
  // payload 契约一个字不动（tests/seller-plan-publish.test.js 逐字钉着它）
  const payload = publishFlow.townPayload({ province: '陕西', city: '延安市', county: '洛川县', regionFull: ['陕西省', '延安市', '洛川县'], fruit: '苹果' });
  assert.ok(!('regionFull' in payload), 'regionFull 是本机的那一份，不许混进 /api/farmtown/create|update 的 payload');
  assert.equal(payload.province, '陕西');
  assert.equal(payload.city, '延安市');
  assert.equal(payload.county, '洛川县');
});

// ---- ④ 没填时行内红字：照别的字段的既有写法，文案复用既有键 ----

test('模板照 errors.name 那套写法渲染 errors.region（就在 #field-region 这一块下面）', () => {
  assert.match(WXML, /<view id="field-region">[\s\S]*?<\/picker>\s*<\/view>\s*<view wx:if="\{\{errors\.region\}\}" class="field-error">\{\{errors\.region\}\}<\/view>/,
    '地区这一栏下面要有与别的字段同一套样式（class="field-error"）的行内提示');
  // 滚动锚点仍在外层 view 上（wx.pageScrollTo({ selector: '#field-region' }) 靠它）
  assert.match(WXML, /<view id="field-region">[\s\S]*?<picker mode="region"[\s\S]*?<\/picker>\s*<\/view>/, '#field-region 必须仍包住整个 picker');
});

test('地区为空：errors.region 有值（中英各一套既有文案），选完就清掉', () => {
  assert.ok(i18n.dict.pub_err_region, '复用既有键 pub_err_region，本轮不新增 i18n 键');
  const page = makePage();
  page.onLoad();
  page.setData({ form: Object.assign({}, page.data.form, {
    name: '洛川苹果园', fruit: '苹果', address: '洛川县凤栖镇××路8号',
    openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00',
    province: '', city: '', county: ''
  }) });
  page.next1();
  assert.equal(page.data.errors.region, '请选择所在地区', '中文用既有那句');
  assert.equal(page.data.errors.region, i18n.dict.pub_err_region[0]);
  assert.equal(page.data.errors.name, undefined, '别的必填都填好了，只差地区');
  // 选完地区这一行红字要消失（与 inputName / inputFruit 清自己那个错同一口径）
  page.onRegionChange({ detail: { value: ['陕西省', '延安市', '洛川县'] } });
  assert.equal(page.data.errors.region, '');

  useLang('en');
  const english = makePage();
  english.onLoad();
  english.setData({ form: Object.assign({}, english.data.form, {
    name: 'Luochuan Orchard', fruit: 'Apple', address: '8 Fengqi Road',
    openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00'
  }) });
  english.next1();
  assert.equal(english.data.errors.region, 'Select the region', '英文侧是同一把键的英文，成对');
  assert.equal(english.data.errors.region, i18n.dict.pub_err_region[1]);
});
