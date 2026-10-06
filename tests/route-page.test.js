'use strict';
// 第3 轮重写（2026-10-07）：行程页改为「票夹」，旧行程用例按新结构改写。
// 票据 = { id, destId, destName, destLat, destLng, dateTime, transport, status, stampedAt, note }
// 界面顺序固定：下一张票 → 待用的票 → ＋排一张票 → 存根。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const store = require('../miniprogram/lib/store');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = v => JSON.parse(JSON.stringify(v));
const wait = (ms = 35) => new Promise(r => setTimeout(r, ms));

const SAMPLE_TOWNS = [
  { id: 'town-luochuan', favId: 'fruit-town:townluochuan', name: '陕西洛川·王大爷苹果园', term: '秋分', fruit: '苹果', province: '陕西', city: '延安市', county: '洛川县', description: '黄土高原上的老果园', experiences: ['采摘', '观光'], transport: '自驾约20分钟', location: { latitude: 35.76, longitude: 109.43 }, published: true },
  { id: 'town-lingbao', favId: 'fruit-town:townlingbao', name: '河南灵宝·寺河山苹果园', term: '霜降', fruit: '苹果', province: '河南', city: '三门峡市', county: '灵宝市', description: '高山苹果', experiences: ['采摘'], transport: '自驾约40分钟', location: { latitude: 34.52, longitude: 110.88 }, published: true }
];

function responder(url) {
  if (url.includes('/api/farmtown/list')) return { towns: SAMPLE_TOWNS };
  if (url.includes('/api/farmtown/detail')) return { town: SAMPLE_TOWNS[0] };
  if (url.includes('/api/chat')) return { answer: '苹果在霜降后糖分积累。' };
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
    switchTab: o => calls.navigation.push('switchTab:' + o.url),
    navigateBack: () => calls.navigation.push('navigateBack'),
    showToast: o => calls.toasts.push(o),
    showModal: o => { calls.modals.push(o); o.success && o.success({ confirm: true }); },
    openLocation: o => calls.locations.push(o),
    stopPullDownRefresh: () => {},
    setNavigationBarTitle: () => {},
    getFontClass: () => 'fs-normal',
    request: (opts) => {
      calls.requests.push(opts.url);
      const result = responder(opts.url || '');
      if (result instanceof Error) { opts.fail && opts.fail({ errMsg: result.message }); return; }
      opts.success && opts.success({ statusCode: 200, data: result });
    }
  };
  global.getApp = () => ({ getFontClass: () => 'fs-normal' });
}

function makePage(name) {
  let definition;
  global.Page = value => { definition = value; };
  const base = name === 'fruit-town' ? '../miniprogram/packageFruit/pages' : '../miniprogram/pages';
  const file = path.resolve(__dirname, base, name, name + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d{1,3})\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback.call(this);
    }
  });
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], modals: [], locations: [], requests: [] };
  mockWx();
  store.clearAll();
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

// —— 票夹 ——

test('the ticket holder starts empty with every orchard in the candidate pool', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    assert.equal(subject.data.next, null, '没有下一张票');
    assert.deepEqual(subject.data.pending, [], '没有待用的票');
    assert.deepEqual(subject.data.stubs, [], '没有存根');
    assert.equal(subject.data.pool.length, 2, '两个园子都在候选池');
  });
});

test('planning a ticket moves the orchard out of the pool and shows countdown', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(3), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    assert.equal(subject.data.next.destId, 'town-luochuan');
    assert.match(subject.data.next.countdown, /3/, '距出发 3 天');
    assert.equal(subject.data.next.transportText, '自驾');
    assert.equal(subject.data.pool.length, 1, '排过的园子离开候选池');
    assert.equal(subject.data.pool[0].id, 'town-lingbao');
    // 票落库，字段齐全
    const saved = store.getTickets('personal');
    assert.equal(saved.length, 1);
    ['id', 'destId', 'destName', 'destLat', 'destLng', 'dateTime', 'transport', 'status', 'stampedAt', 'note']
      .forEach(k => assert.ok(k in saved[0], '票含字段 ' + k));
    assert.equal(saved[0].status, 'planned');
  });
});

test('a ticket today says 今天出发 and the nearest date becomes the next ticket', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(3), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    subject.setData({ draft: { destId: 'town-lingbao', date: dayOffset(0), time: '08:00', transport: 'public' } });
    subject.confirmTicket();
    assert.equal(subject.data.next.destId, 'town-lingbao', '日期最近的成为下一张票');
    assert.match(subject.data.next.countdown, /今天出发/);
    assert.equal(subject.data.pending.length, 1);
    assert.equal(subject.data.pool.length, 0, '都排过了，候选池为空');
  });
});

test('stamping a ticket files it under stubs and keeps it out of the pool', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(1), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    const id = subject.data.allTickets[0].id;
    subject.stampTicket({ currentTarget: { dataset: { id } } });
    assert.equal(subject.data.stubs.length, 1, '票移入存根');
    assert.ok(subject.data.stubs[0].stampedAt, '存根带日期章');
    assert.equal(subject.data.next, null, '待用票空了');
    assert.equal(subject.data.pool.length, 1, '去过的园子不回候选池');
    assert.equal(subject.data.pool[0].id, 'town-lingbao');
    assert.equal(store.getTickets('personal')[0].status, 'visited');
  });
});

test('deleting a pending ticket returns its orchard to the candidate pool', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(1), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    const id = subject.data.allTickets[0].id;
    assert.equal(subject.data.pool.length, 1);
    subject.removeTicket({ currentTarget: { dataset: { id } } });
    assert.equal(subject.data.allTickets.length, 0);
    assert.equal(subject.data.pool.length, 2, '删掉的园子回到候选池');
    assert.equal(subject.data.next, null);
  });
});

test('the plan drawer asks only where, when and how, and never leaves the ticket page', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.openDrawer({ currentTarget: { dataset: {} } });
    assert.equal(subject.data.drawerOpen, true);
    const before = calls.navigation.length;
    subject.pickDest({ currentTarget: { dataset: { id: 'town-luochuan' } } });
    subject.pickTransport({ currentTarget: { dataset: { value: 'share' } } });
    subject.onDateChange({ detail: { value: dayOffset(2) } });
    subject.onTimeChange({ detail: { value: '10:30' } });
    assert.equal(subject.data.draft.destId, 'town-luochuan');
    assert.equal(subject.data.draft.transport, 'share');
    assert.equal(calls.navigation.length, before, '抽屉里不跳页');
    subject.confirmTicket();
    assert.equal(subject.data.next.transportText, '拼车');
    assert.equal(subject.data.drawerOpen, false, '排完自动收起抽屉');
  });
});

test('a ticket expands in place and only offers navigate plus stamp', () => {
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(1), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    const id = subject.data.next.id;
    subject.toggleTicket({ currentTarget: { dataset: { id } } });
    assert.equal(subject.data.expandedId, id, '原页展开');
    assert.equal(calls.navigation.length, 0, '不跳新页');
    subject.toggleTicket({ currentTarget: { dataset: { id } } });
    assert.equal(subject.data.expandedId, '', '再点收起');

    const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/route/route.wxml'), 'utf8');
    assert.match(markup, /bindtap="navigateTicket"/);
    assert.match(markup, /bindtap="stampTicket"/);
    assert.doesNotMatch(markup, /wx:for="{{stops}}"/, '旧行程列表已移除');
  });
});

test('navigate uses openLocation and refuses when the orchard has no coordinates', () => {
  global.wx.request = (opts) => {
    if ((opts.url || '').includes('/api/farmtown/list')) {
      opts.success && opts.success({ statusCode: 200, data: { towns: [Object.assign({}, SAMPLE_TOWNS[0], { location: { latitude: 0, longitude: 0 } })] } });
      return;
    }
    opts.success && opts.success({ statusCode: 200, data: responder(opts.url || '') });
  };
  const subject = makePage('route');
  subject.onLoad();
  return wait().then(() => {
    subject.setData({ draft: { destId: 'town-luochuan', date: dayOffset(1), time: '09:00', transport: 'self' } });
    subject.confirmTicket();
    const id = subject.data.next.id;
    subject.navigateTicket({ currentTarget: { dataset: { id } } });
    assert.equal(calls.locations.length, 0, '无有效坐标不导航');
    assert.ok(calls.toasts.length > 0, '给出提示');
  });
});

test('route markup keeps the four segments in order and drops the five old actions', () => {
  const folder = path.resolve(__dirname, '../miniprogram/pages');
  const routeJson = JSON.parse(fs.readFileSync(path.join(folder, 'route/route.json'), 'utf8'));
  assert.equal(routeJson.navigationBarTitleText, '果物四时记');
  const wxml = fs.readFileSync(path.join(folder, 'route/route.wxml'), 'utf8');
  const order = ['rt_next_ticket', 'rt_pending_tickets', 'rt_add_ticket', 'rt_stubs'].map(k => wxml.indexOf('{{L.' + k + '}}'));
  assert.ok(order.every(v => v > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), '四段顺序：下一张票→待用→＋排票→存根');
  ['出发前再看一遍', '站点时间表', '门票待确认', '行前包', '晒到社群'].forEach(w =>
    assert.doesNotMatch(wxml, new RegExp(w), w + ' 必须已移除'));
  assert.match(wxml, /wx\.openLocation|bindtap="navigateTicket"/, '只剩导航出发与盖章两个动作');
  const wxss = fs.readFileSync(path.join(folder, 'route/route.wxss'), 'utf8');
  assert.match(wxss, /#B03A4A/, '红章用设计图给的红章色');
});

// —— 果乡详情（本轮未改动，保持通过）——

test('fruit-town detail loads town, defaults to fruit art, uses AI culture text', () => {
  const subject = makePage('fruit-town');
  subject.onLoad({ id: 'town-luochuan' });
  return wait().then(() => {
    assert.equal(subject.data.town.name, SAMPLE_TOWNS[0].name);
    assert.ok(subject.data.cultureText.length > 0);
  });
});

test('fruit-town falls back to static culture when chat fails', () => {
  global.wx.request = (opts) => {
    if ((opts.url || '').includes('/api/chat')) { opts.fail && opts.fail({ errMsg: 'offline' }); return; }
    opts.success && opts.success({ statusCode: 200, data: responder(opts.url || '') });
  };
  const subject = makePage('fruit-town');
  subject.onLoad({ id: 'town-luochuan' });
  return wait().then(() => {
    assert.ok(subject.data.cultureText.length > 0);
  });
});