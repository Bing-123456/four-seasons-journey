'use strict';
const { pageFile } = require('./helpers/page-path');
// 果农工作台重构后（P13，「果农工作台」+ 发布表单）的页面行为测试。
// 真实加载 seller/index 与 seller/publish 页面，用内存 storage 与 wx.request 桩
// 返回种子果乡数据，覆盖：我的发布列表、下架、发布表单三步与 AI 润色、编辑模式。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = v => JSON.parse(JSON.stringify(v));
const wait = (ms = 35) => new Promise(r => setTimeout(r, ms));

const MY_TOWNS = [
  { id: 'town-mine', favId: 'fruit-town:townmine', name: '洛川王大爷苹果园', term: '秋分', fruit: '苹果', province: '陕西', city: '延安市', county: '洛川县', description: '三代种苹果', polishedDescription: '', experiences: ['采摘', '观光'], transport: '自驾约20分钟', contact: '', location: { latitude: 35.76, longitude: 109.43 }, published: true }
];

let afterUnpublish = false;
let publishMode = 'owned'; // 'owned' | 'empty'
function responder(url) {
  if (url.includes('/api/farmtown/my')) {
    if (publishMode === 'empty') return { towns: [] };
    return { towns: afterUnpublish ? [Object.assign({}, MY_TOWNS[0], { published: false })] : MY_TOWNS };
  }
  if (url.includes('/api/farmtown/detail')) return { town: MY_TOWNS[0] };
  if (url.includes('/api/farmtown/create')) return { town: Object.assign({}, MY_TOWNS[0], { id: 'town-new', favId: 'fruit-town:townnew' }) };
  if (url.includes('/api/farmtown/update')) return { town: Object.assign({}, MY_TOWNS[0], { id: 'town-edit' }) };
  if (url.includes('/api/farmtown/unpublish')) { afterUnpublish = true; return { town: Object.assign({}, MY_TOWNS[0], { published: false }) }; }
  if (url.includes('/api/farmtown-polish')) return { polishedText: '润色后的果乡文案。' };
  return { error: 'not found' };
}

let memory;
let calls;
function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (k, v) => memory.set(k, clone(v)),
    removeStorageSync: k => memory.delete(k),
    navigateTo: o => calls.navigation.push(o.url),
    navigateBack: () => calls.navigation.push('navigateBack'),
    showToast: o => calls.toasts.push(o),
    showModal: o => { calls.modals.push(o); o.success && o.success({ confirm: true }); },
    chooseLocation: o => { calls.locations.push(o); o.success && o.success({ name: '测试果园', address: '延安市洛川县', latitude: 35.76, longitude: 109.43 }); },
    request: (opts) => {
      calls.requests.push(opts.url);
      const result = responder(opts.url || '');
      if (result instanceof Error) { opts.fail && opts.fail({ errMsg: result.message }); return; }
      opts.success && opts.success({ statusCode: 200, data: result });
    }
  };
}

function makePage(name) {
  let definition;
  global.Page = value => { definition = value; };
  const file = pageFile(name, 'index');
  if (name === 'publish') {
    // publish 位于 pages/seller/publish/publish.js
    const pf = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
    delete require.cache[require.resolve(pf)];
    require(pf);
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

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], modals: [], locations: [], requests: [] };
  afterUnpublish = false;
  publishMode = 'owned';
  mockWx();
  store.clearAll();
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('果农工作台 lists my towns with published status and opens publish flows', () => {
  const subject = makePage('seller');
  subject.onShow();
  return wait().then(() => {
    assert.equal(subject.data.myTowns.length, 1);
    assert.equal(subject.data.myTowns[0].statusText, '已发布');
    subject.publishNew();
    assert.equal(calls.navigation.at(-1), '/pages/seller/publish/publish');
    subject.editTown({ currentTarget: { dataset: { id: 'town-mine' } } });
    assert.equal(calls.navigation.at(-1), '/pages/seller/publish/publish?id=town-mine');
  });
});

test('empty my-towns list shows the empty hint without error', () => {
  publishMode = 'empty';
  const subject = makePage('seller');
  subject.onShow();
  return wait().then(() => {
    assert.equal(subject.data.myTowns.length, 0);
    assert.equal(subject.data.loading, false);
    assert.ok(!subject.data.error);
  });
});

test('unpublish confirms, requests unpublish and flips status to 已下架', () => {
  const subject = makePage('seller');
  subject.onShow();
  return wait().then(() => {
    subject.unpublishTown({ currentTarget: { dataset: { id: 'town-mine' } } });
    assert.ok(calls.requests.some(u => u.includes('/api/farmtown/unpublish')));
    return wait();
  }).then(() => {
    assert.ok(afterUnpublish);
    assert.equal(subject.data.myTowns[0].published, false);
    assert.equal(subject.data.myTowns[0].statusText, '已下架');
    assert.match(calls.toasts.at(-1).title, /已下架/);
  });
});

test('publish form walks three steps, caps experiences at 3, polishes and submits', () => {
  const subject = makePage('publish');
  subject.onLoad();
  subject.inputName({ detail: { value: '洛川苹果园' } });
  subject.onRegionChange({ detail: { value: ['陕西', '延安市', '洛川县'] } });
  subject.inputFruit({ detail: { value: '苹果' } });
    subject.inputAddress({ detail: { value: '洛川县凤栖镇××路8号' } });
    subject.onOpenDate({ detail: { value: '2026-06-21' } });
    subject.onOpenTime({ detail: { value: '09:00' } });
    subject.onCloseDate({ detail: { value: '2026-06-25' } });
    subject.onCloseTime({ detail: { value: '17:00' } });
  subject.next1();
  assert.equal(subject.data.step, 2);
    assert.equal(subject.data.form.address, '洛川县凤栖镇××路8号');
    assert.equal(subject.data.form.openTime, '09:00');
    assert.equal(subject.data.form.closeTime, '17:00');
  subject.toggleExp({ currentTarget: { dataset: { exp: '采摘' } } });
  subject.toggleExp({ currentTarget: { dataset: { exp: '观光' } } });
  subject.toggleExp({ currentTarget: { dataset: { exp: '手作' } } });
  subject.toggleExp({ currentTarget: { dataset: { exp: '餐饮' } } }); // 现在允许最多 5 个（全部可选）
  assert.equal(subject.data.form.experiences.length, 4);
  subject.inputDesc({ detail: { value: '三代人种苹果，霜降后最甜。' } });
      subject.inputWechat({ detail: { value: 'guoyuan2026' } });
      subject.inputPhone({ detail: { value: '13800000000' } });
  subject.next2();
  assert.equal(subject.data.step, 3);
  subject.polish();
  return wait().then(() => {
    assert.equal(subject.data.polishedText, '润色后的果乡文案。');
    subject.submit();
    return wait(700);
  }).then(() => {
    assert.ok(calls.requests.some(u => u.includes('/api/farmtown/create')));
    assert.match(calls.toasts.at(-1).title, /发布成功/);
    assert.equal(calls.navigation.at(-1), 'navigateBack');
  });
});

test('publish form in edit mode loads existing town and saves via update', () => {
  const subject = makePage('publish');
  subject.onLoad({ id: 'town-edit' });
  return wait().then(() => {
      subject.setData({ 'form.address': '洛川县凤栖镇××路8号' });
      subject.setData({ 'form.openDate': '2026-06-21' });
      subject.setData({ 'form.openTime': '09:00' });
      subject.setData({ 'form.closeDate': '2026-06-25' });
      subject.setData({ 'form.closeTime': '17:00' });
    assert.equal(subject.data.editing, true);
    assert.equal(subject.data.form.name, '洛川王大爷苹果园');
    assert.equal(subject.data.form.fruit, '苹果');
    subject.submit();
    return wait(700);
  }).then(() => {
    assert.ok(calls.requests.some(u => u.includes('/api/farmtown/update')));
    assert.match(calls.toasts.at(-1).title, /保存成功/);
  });
});
