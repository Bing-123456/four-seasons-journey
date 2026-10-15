'use strict';
// 发布失败时把真实原因说给果农（2026-10-16）。
// 背景：果乡资料超限时服务端 400 带着中文原因（「果乡名称过长（最多 60 字）」），
// 而页面只弹一句通用的「发布失败」—— 果农不知道该改哪一栏。
// 这份测试盯住四件事：
//   ① 本地预校验：提交前就按同一套上限（60 / 30 / 600，与 server/farmtown.js 同口径）拦下来；
//   ② 服务端被拒：把 field / max 翻成对应语言的文案并显示出来（中英各一次，页面级真加载）；
//   ③ 只有 error 文案的回执（老服务端 / 老中转形状，没有 field / max）—— 这一路也必须认得出字段与上限
//      （lib/media-service.js 现在会把服务端给的 field / max / reason 挂到 Error 上，但本组用例不许依赖它）；
//   ④ 认不出来的错误退回原来那句通用文案，不空白、不崩。
// 桩与 tests/seller-plan-publish.test.js / tests/seller-page.test.js 同一套：真加载页面、内存 storage。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const planDraft = require('../miniprogram/lib/plan-draft');
const publishFlow = require('../miniprogram/pages/seller/publish/publish-flow');

const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const PLAN_JS = path.resolve(__dirname, '../miniprogram/pages/seller/plan/plan.js');
const SELLER_JS = path.resolve(__dirname, '../miniprogram/pages/seller/index.js');

const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
// 语言存在当前账户分区的 settings.language 里（与 tests/seller-en.test.js 同款切换方式）。
const useLang = code => { store.saveSettings({ language: code }); i18n.invalidateLang(); };

// 日期按本机今天算（页面里的天数也用本机今天），不写死。
function localIso(offsetDays) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = value => String(value).padStart(2, '0');
  return target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate());
}
const FORM = {
  name: 'Sunny Hill Fruit Farm', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
  activityDate: '', address: '洛川县凤栖镇××路8号', openDate: localIso(1), openTime: '09:00',
  closeDate: localIso(5), closeTime: '17:00', experiences: ['采摘', '观光'],
  description: '三代人种苹果，霜降后最甜。', wechat: 'guoyuan2026', phone: '13800000000',
  location: { latitude: 35.76, longitude: 109.43 }, locationName: '陕西延安市洛川县'
};
const form = patch => Object.assign({}, FORM, patch);
const MY_TOWNS = [Object.assign({ id: 'town-mine', favId: 'fruit-town:townmine', term: '秋分', published: true }, FORM)];

let memory;
let calls;
// 这一轮的 HTTP 回执：默认全成功，需要 400 的用例自己换掉（与真实 wx.request 一样只给 statusCode + data）。
let reply;

function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    navigateBack: options => calls.navigation.push('navigateBack:' + ((options && options.delta) || 1)),
    redirectTo: options => calls.navigation.push(options.url),
    showToast: options => calls.toasts.push(options),
    showModal: options => { calls.modals.push(options); if (options.success) options.success({ confirm: true }); },
    setNavigationBarTitle: options => calls.titles.push(options.title),
    request: options => {
      calls.requests.push(options.url || '');
      calls.payloads.push(options.data === undefined ? undefined : clone(options.data));
      if (options.success) options.success(reply(options.url || ''));
    }
  };
}

function makePage(file) {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(file)];
  require(file);
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

// 服务端被拒时的回执（响应体照 server/farmtown.js 的 dispatch 给：error 文案一字不改，另带 field / max / reason）。
const rejected = body => () => ({ statusCode: 400, data: body });

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], modals: [], requests: [], payloads: [], titles: [] };
  store.exitDemo();
  store.clearAll();
  i18n.invalidateLang();
  mockWx();
  reply = url => {
    if (url.includes('/api/farmtown/my')) return { statusCode: 200, data: { towns: clone(MY_TOWNS) } };
    if (url.includes('/api/farmtown/detail')) return { statusCode: 200, data: { town: clone(MY_TOWNS[0]) } };
    if (url.includes('/api/farmtown/create') || url.includes('/api/farmtown/update')) return { statusCode: 200, data: { town: clone(MY_TOWNS[0]) } };
    if (url.includes('/api/farmtown/unpublish')) return { statusCode: 200, data: { town: clone(MY_TOWNS[0]) } };
    return { statusCode: 200, data: {} };
  };
  global.getCurrentPages = () => [{ route: 'pages/seller/index' }, { route: 'pages/seller/publish/publish' }, { route: 'pages/seller/plan/plan' }];
});
test.after(() => { delete global.getCurrentPages; });

// ---- ① 本地预校验：与 server/farmtown.js 同一套上限、同一批文案键 ----

test('本地预校验：60 / 30 / 600 字内放行，超一格当场说清「哪一栏、多少字上限」', () => {
  assert.deepEqual(publishFlow.FIELD_MAX, { name: 60, fruit: 30, description: 600 }, '上限必须与服务端同口径');
  assert.deepEqual(publishFlow.step1Errors(form({ name: 'N'.repeat(60), fruit: 'F'.repeat(30) })), {}, '新口径内的最大值放行');
  assert.equal(publishFlow.step1Errors(form({ name: 'N'.repeat(61) })).name, '果乡名称过长（最多 60 字）');
  assert.equal(publishFlow.step1Errors(form({ fruit: 'F'.repeat(31) })).fruit, '当季水果过长（最多 30 字）');
  assert.equal(publishFlow.step2Error(form({ description: 'D'.repeat(600) })), '');
  assert.equal(publishFlow.step2Error(form({ description: 'D'.repeat(601) })), '果乡介绍过长（最多 600 字）');
  // 老口径挡住的英文店名（21 字）现在本地也放行 —— 与服务端一起「只放宽不收紧」。
  assert.equal(publishFlow.step1Errors(form({ name: 'Sunny Hill Fruit Farm' })).name, undefined);
});

test('英文模式：同一批文案键出英文，不新写第二套', () => {
  useLang('en');
  assert.equal(publishFlow.step1Errors(form({ name: 'N'.repeat(61) })).name, 'The orchard name is too long (max 60 characters)');
  assert.equal(publishFlow.step1Errors(form({ fruit: 'F'.repeat(31) })).fruit, 'The fruit name is too long (max 30 characters)');
  assert.equal(publishFlow.step2Error(form({ description: 'D'.repeat(601) })), 'The orchard introduction is too long (max 600 characters)');
  assert.equal(publishFlow.failureMessage({ field: 'description', max: 600, reason: 'too_long' }, false),
    'The orchard introduction is too long (max 600 characters)');
  // 中文侧逐字不变（这三个键的中文侧是服务端那句话的同款说法）
  useLang('zh');
  assert.equal(i18n.t('pub_err_name_long', { n: 60 }), '果乡名称过长（最多 60 字）');
});

// ---- ② 服务端被拒 → 文案（含只有 error 文案的老回执 / 兜底形状）----

test('服务端带 field / max / reason 时照字段出文案；没填的字段沿用原来那句', () => {
  assert.equal(publishFlow.failureMessage({ message: '果乡名称过长（最多 60 字）', code: 'invalid_farmtown', field: 'name', max: 60, reason: 'too_long' }, false),
    '果乡名称过长（最多 60 字）');
  assert.equal(publishFlow.failureMessage({ field: 'fruit', max: 30, reason: 'too_long' }, false), '当季水果过长（最多 30 字）');
  assert.equal(publishFlow.failureMessage({ message: '果乡名称未填写或过长', field: 'name', reason: 'required' }, false), '请填写果乡名称');
  assert.equal(publishFlow.failureMessage({ field: 'description', max: 600, reason: 'required' }, false), '请填写果乡介绍');
});

test('兜底那一路：即使回执只有 error 文案，也要能认出字段与上限（双保险）', () => {
  // 老回执只有 error 文案（服务端没给 field / max / reason）时，页面拿到的就是这个形状。
  assert.deepEqual(publishFlow.rejectReason(new Error('果乡名称过长（最多 60 字）')), { field: 'name', max: 60, tooLong: true });
  assert.deepEqual(publishFlow.rejectReason(new Error('当季水果过长（最多 30 字）')), { field: 'fruit', max: 30, tooLong: true });
  assert.deepEqual(publishFlow.rejectReason(new Error('果乡介绍过长（最多 600 字）')), { field: 'description', max: 600, tooLong: true });
  assert.deepEqual(publishFlow.rejectReason(new Error('果乡名称未填写或过长')), { field: 'name', max: 60, tooLong: false },
    '「未填写或过长」里也含「过长」，不许当成超限');
  useLang('en');
  assert.equal(publishFlow.failureMessage(new Error('果乡介绍过长（最多 600 字）'), false),
    'The orchard introduction is too long (max 600 characters)');
});

test('认不出来的错误退回原来那句通用文案，不空白也不崩', () => {
  assert.equal(publishFlow.failureMessage(new Error('服务暂时不可用'), false), '发布失败');
  assert.equal(publishFlow.failureMessage(new Error('服务暂时不可用'), true), '保存失败');
  assert.equal(publishFlow.failureMessage(undefined, false), '发布失败', '连 error 都没有也不许崩');
  assert.equal(publishFlow.failureMessage({ message: '' }, false), '发布失败');
  assert.equal(publishFlow.failureMessage(new Error('网络异常'), false, 'sl_unpublish_failed'), '下架失败');
  assert.equal(publishFlow.rejectReason(new Error('省份过长（最多 20 字）')), null, '没点名 field 的字段不硬认成上面三项');
});

// ---- ③ 页面级：三处 catch 都显示得到这个原因 ----

test('合并页 publish：服务端 400 时 toast 是「果乡名称过长（最多 60 字）」，不是「发布失败」', async () => {
  reply = rejected({ error: '果乡名称过长（最多 60 字）', code: 'invalid_farmtown', field: 'name', max: 60, reason: 'too_long' });
  const page = makePage(PUBLISH_JS);
  page.onLoad();
  page.setData({ form: form({ name: 'Sunny Hill Fruit Farm And Orchard Of The Wang Family In Luochuan' }) });
  page.submit();
  await wait();
  assert.equal(calls.requests.filter(url => url.includes('/api/farmtown/create')).length, 1, '先把请求真的发出去（让服务端判）');
  assert.equal(calls.toasts.at(-1).title, '果乡名称过长（最多 60 字）');
  assert.notEqual(calls.toasts.at(-1).title, '发布失败');
  assert.equal(page.data.submitting, false, '失败后按钮要能再点');
});

test('合并页 publish（英文）：同一份 400 回执显示英文文案', async () => {
  useLang('en');
  reply = rejected({ error: '果乡介绍过长（最多 600 字）', code: 'invalid_farmtown', field: 'description', max: 600, reason: 'too_long' });
  const page = makePage(PUBLISH_JS);
  page.onLoad();
  page.setData({ form: form({ description: 'D'.repeat(601) }) });
  page.submit();
  await wait();
  assert.equal(calls.toasts.at(-1).title, 'The orchard introduction is too long (max 600 characters)');
  assert.equal(page.data.submitting, false);
});

test('合并页 publish：认不出的失败仍旧显示「发布失败」', async () => {
  reply = rejected({ error: '服务暂时不可用', code: 'internal_error' });
  const page = makePage(PUBLISH_JS);
  page.onLoad();
  page.setData({ form: FORM });
  page.submit();
  await wait();
  assert.equal(calls.toasts.at(-1).title, '发布失败');
  assert.equal(page.data.submitting, false);
});

test('结果页 plan：服务端 400 时 toast 说清是哪一栏（与合并页同一套映射）', async () => {
  // 这条特意只回 { error } —— 也就是服务端没给结构化字段的那种回执，
  // 证明页面不依赖 field 也认得出是哪一栏、上限多少（双保险，别删）。
  reply = rejected({ error: '当季水果过长（最多 30 字）' });
  memory.set(planDraft.KEY + store.capturePartition(), {
    title: '苹果摘采小课堂', steps: ['到园先讲清采摘范围', '发小筐各自挑果', '称重装袋带走'],
    dates: {}, form: form(), editing: false, townId: ''
  });
  const plan = makePage(PLAN_JS);
  plan.onLoad();
  plan.saveAndPublish();
  await wait();
  assert.equal(calls.requests.filter(url => url.includes('/api/farmtown/create')).length, 1);
  assert.equal(calls.toasts.at(-1).title, '当季水果过长（最多 30 字）');
  assert.equal(plan.data.publishing, false, '失败后按钮要能再点');
});

test('工作台 index：下架失败照旧说「下架失败」，能认出的原因则照原因说', async () => {
  reply = url => (url.includes('/api/farmtown/unpublish')
    ? { statusCode: 400, data: { error: '果乡不存在或无权下架', code: 'not_found' } }
    : { statusCode: 200, data: { towns: clone(MY_TOWNS) } });
  const seller = makePage(SELLER_JS);
  seller.onShow();
  await wait();
  seller.unpublishTown({ currentTarget: { dataset: { id: 'town-mine' } } });
  await wait();
  assert.equal(calls.toasts.at(-1).title, '下架失败', '认不出的原因沿用本页原来那句');

  // 反过来的那一半：同一个 catch 认得出原因时照原因说（下架接口目前不返回 field，这条守的是
  // 「三处 catch 共用同一套映射」，不新增第二套文案）。
  reply = url => (url.includes('/api/farmtown/unpublish')
    ? { statusCode: 400, data: { error: '果乡名称过长（最多 60 字）', code: 'invalid_farmtown', field: 'name', max: 60, reason: 'too_long' } }
    : { statusCode: 200, data: { towns: clone(MY_TOWNS) } });
  seller.unpublishTown({ currentTarget: { dataset: { id: 'town-mine' } } });
  await wait();
  assert.equal(calls.toasts.at(-1).title, '果乡名称过长（最多 60 字）');
});
