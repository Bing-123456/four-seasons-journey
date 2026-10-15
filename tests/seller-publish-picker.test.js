'use strict';
// 「所在地区」与「开门/关门 日期·时间」四处选择器点不动的回归守卫（诊断见工作区根的
// 地区选择点不动-诊断与方案.md，修法=方案 A）：
//   ① 模板：region 的 value 必须走 data 顶层数组 {{regionValue}}，不许回退成渲染时临时拼的
//      {{[form.province, form.city, form.county]}}（docs：mode=region 的 value 是顶层 array、默认值 []）；
//   ② 页面数据：regionValue 与 form.province/city/county 双写，存档形状一个字不改；
//   ③ 省名去行政后缀（选择器给「陕西省」，存档一直是短名「陕西」，直接入档手账海报会静默不点亮）；
//      市 / 县不去后缀（存档本来就带后缀，缩写对不上，不做对照表）；
//   ④ 五个 picker 的标题 <label> 都必须在这个 picker 里面，整行可点 —— 这也是那四项日期 / 时间
//      「点不动」的根因（与地区同一类，模板里 label 与 picker 是兄弟节点，点标题没反应）；
//      同一个坑不许再回退，所以整页逐个 picker 都查一遍，并钉住 picker 总数。
// 桩与 tests/seller-page.test.js、tests/seller-plan-publish.test.js 同一套：真加载页面、内存 storage。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');

const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const PUBLISH_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.wxml');
const WXML = fs.readFileSync(PUBLISH_WXML, 'utf8');

const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

// 编辑态要读的旧名片：地区与其它字段都照仓库既有形状（省名是短名）。
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
      const data = url.includes('/api/farmtown/detail') ? { town: clone(TOWN) } : { error: 'not found' };
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
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
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
  store.exitDemo();
  store.clearAll();
  i18n.invalidateLang();
  mockWx();
});
test.after(() => { delete global.wx; });

// ---- ① 模板：值走 data 顶层数组 + 标题在 picker 里 ----

test('region 的 value 走 data 顶层数组，且不许回退成渲染时临时拼的数组字面量', () => {
  assert.match(WXML, /<picker mode="region" value="\{\{regionValue\}\}"/, 'region 的 value 必须走 data 顶层数组 {{regionValue}}');
  assert.doesNotMatch(WXML, /value="\{\{\[form\.province/, '不许再写成 {{[form.province, ...]}} 这种渲染时临时拼的数组（防回退）');
  assert.doesNotMatch(WXML, /mode="region"[^>]*value="\{\{\[/, 'region 的 value 不许再内联数组字面量');
  // 滚动锚点仍在最外层 view 上（publish.js 的 wx.pageScrollTo({ selector: '#field-region' }) 靠它）
  assert.match(WXML, /<view id="field-region">[\s\S]*?<picker mode="region"/, '#field-region 必须留在 picker 外层，锚点不变');
  assert.match(WXML, /<view id="field-region">[\s\S]*?<\/picker>\s*<\/view>/, '#field-region 要包住整个 picker');
});

test('五个 picker 的标题都在 picker 里面（整行可点，不许再退回「标题与 picker 是兄弟」）', () => {
  // 逐个 picker 查：这个 picker 的开标签与它的 </picker> 之间必须有一个 <label>。
  const pickers = Array.from(WXML.matchAll(/<picker\b[^>]*>[\s\S]*?<\/picker>/g)).map(m => m[0]);
  assert.equal(pickers.length, 5, '本页的 picker 恰好 5 个（1 个 region + 2 个 date + 2 个 time）：' + pickers.length);
  pickers.forEach((block, index) => {
    const head = block.match(/<picker\b[^>]*>/)[0];
    assert.match(block, /<label class="label">\{\{L\.[A-Za-z0-9_]+\}\}<\/label>/, '第 ' + (index + 1) + ' 个 picker 里没有标题 label，整行点不动：' + head);
  });
  // 点名那四项：开门日期 / 开门时间 / 关门日期 / 关门时间
  ['pub_open_date', 'pub_open_time', 'pub_close_date', 'pub_close_time'].forEach(key => {
    assert.match(WXML, new RegExp('<picker mode="(?:date|time)"[\\s\\S]*?<label class="label">\\{\\{L\\.' + key + '\\}\\}</label>'), key + ' 的标题要在这个 picker 里，整行可点');
  });
  assert.match(WXML, /<picker mode="region"[\s\S]*?<label class="label">\{\{L\.pub_region\}\}<\/label>/m, '「所在地区」的标题要在 region picker 里');
});

// ---- ② 页面数据：双写 + 存档形状不变 ----

test('regionValue 与 form.province/city/county 双写：没选过是空数组，选完两份各就各位', () => {
  const subject = makePage();
  subject.onLoad();
  assert.deepEqual(subject.data.regionValue, [], 'region 的官方默认值就是空数组 []');
  assert.deepEqual(subject.data.form.province, '');
  subject.onRegionChange({ detail: { value: ['陕西省', '延安市', '洛川县'] } });
  assert.deepEqual(subject.data.regionValue, ['陕西省', '延安市', '洛川县'], 'regionValue 留选择器自己的那一份，下次打开停在这个位置');
  assert.equal(subject.data.form.province, '陕西', '入档仍是短省名');
  assert.equal(subject.data.form.city, '延安市', '市不去后缀');
  assert.equal(subject.data.form.county, '洛川县', '区县不去后缀');
  // 再选一次要覆盖，不是叠加
  subject.onRegionChange({ detail: { value: ['河南省', '郑州市', '中牟县'] } });
  assert.deepEqual(subject.data.regionValue, ['河南省', '郑州市', '中牟县']);
  assert.equal(subject.data.form.province, '河南');
});

test('编辑态（?id=）照旧回填三段、但不预选，且其它字段仍在 data 顶层', async () => {
  const subject = makePage();
  subject.onLoad({ id: 'town-mine' });
  await wait();
  assert.equal(subject.data.form.province, '陕西');
  assert.equal(subject.data.form.city, '延安市');
  assert.equal(subject.data.form.county, '洛川县');
  assert.deepEqual(subject.data.regionValue, [], '短省名与选择器字典（「陕西省」）对不上，不预选');
  // data 顶层必须有这个值，且不是 form 里的
  assert.ok(Array.isArray(subject.data.regionValue), 'regionValue 必须是 data 顶层数组');
  assert.equal(subject.data.form.regionValue, undefined, 'regionValue 不该嵌进 form');
  // 存档形状没变：那一行显示的仍是已存的三段
  assert.equal([subject.data.form.province, subject.data.form.city, subject.data.form.county].join(' '), '陕西 延安市 洛川县');
});

// ---- ③ 省名去行政后缀（改在处理器里，所以从数据层就能验） ----

test('选择器的全名入档前抹掉行政后缀，短名 / 空值原样', () => {
  const subject = makePage();
  subject.onLoad();
  const cases = [
    ['陕西省', '陕西'], ['河南省', '河南'], ['北京市', '北京'], ['上海市', '上海'], ['天津市', '天津'],
    ['重庆市', '重庆'], ['内蒙古自治区', '内蒙古'], ['广西壮族自治区', '广西'], ['宁夏回族自治区', '宁夏'],
    ['新疆维吾尔自治区', '新疆'], ['西藏自治区', '西藏'], ['香港特别行政区', '香港'], ['澳门特别行政区', '澳门'],
    // 本来就是短名 / 没选：一个字不改
    ['陕西', '陕西'], ['', ''], [undefined, ''], [null, '']
  ];
  cases.forEach(pair => {
    subject.onRegionChange({ detail: { value: [pair[0], '延安市', '洛川县'] } });
    assert.equal(subject.data.form.province, pair[1], '省名「' + pair[0] + '」应该入档成「' + pair[1] + '」');
  });
  // 三段不全时不写脏值（不会出现「省填了、市空着」这种半截存档）
  subject.onRegionChange({ detail: { value: ['陕西省'] } });
  assert.deepEqual(subject.data.regionValue, [], '选择器没给齐三段就不留自己的值');
  assert.equal(subject.data.form.city, '');
  assert.equal(subject.data.form.county, '');
});

// ---- ④ 没新增键、仍走既有 i18n；四处日期 / 时间的灰字与地区那行同一套 ----

test('没新增 i18n 键：四处日期 / 时间的灰字仍是既有的「请选择」', () => {
  ['pub_open_date', 'pub_open_time', 'pub_close_date', 'pub_close_time', 'pub_region', 'pub_date_window', 'pub_region_ph'].forEach(key => {
    assert.ok(i18n.dict[key], '词典里应有 ' + key);
  });
  assert.equal(i18n.dict.pub_region_ph[0], '请选择');
  assert.equal(i18n.dict.pub_region_ph[1], 'Select');
  const subject = makePage();
  subject.onLoad();
  assert.equal(subject.data.L.pub_region_ph, '请选择', '四处日期 / 时间没选时的灰字与地区那行同一套（不新增键）');
  ['pub_open_date', 'pub_open_time', 'pub_close_date', 'pub_close_time'].forEach(key => {
    assert.equal(subject.data.L[key], i18n.dict[key][0], key + ' 的标题文案走既有词典，中文逐字不变');
  });
  const keys = Array.from(new Set(Array.from(WXML.matchAll(/<label class="label">\{\{L\.([A-Za-z0-9_]+)\}\}<\/label>/g)).map(m => m[1])));
  assert.deepEqual(keys.sort(), ['pub_address', 'pub_batch_left', 'pub_batch_people', 'pub_close_date', 'pub_close_time', 'pub_date_window', 'pub_desc', 'pub_experience', 'pub_fruit', 'pub_name', 'pub_open_date', 'pub_open_time', 'pub_phone', 'pub_region', 'pub_wechat'].sort(), '字段标题全走既有 i18n 键：' + keys.join(' '));
});
