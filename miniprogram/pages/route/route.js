'use strict';
// 行程页 · 票夹（第 3 轮，2026-10-07，依据 mockups/final-design-3pages.html 第⑤⑥⑦屏）。
//
// 一屏内顺序固定：下一张票 → 待用的票 → ＋排一张票 → 存根。
// 一张票 = 一个目的地 + 4 项信息（目的地 / 距出发 / 目标日期时间 / 交通工具），
// 只有两个动作：导航出发（wx.openLocation）与「去过了 · 撕票盖章」。
// 旧版行程页的五个旧动作已从界面彻底移除（出行前复习、班次时刻、门票确认、出发前包、同步到社群）。
const store = require('../../lib/store');
const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');

const LABEL_KEYS = [
  'rt_title', 'rt_next_ticket', 'rt_pending_tickets', 'rt_add_ticket', 'rt_stubs',
  'rt_navigate', 'rt_stamp', 'rt_no_ticket', 'rt_no_pending', 'rt_no_stub',
  'rt_pool_note', 'rt_pool_all', 'rt_pool_empty', 'rt_drawer_where', 'rt_drawer_when',
  'rt_drawer_how', 'rt_where_placeholder', 'rt_confirm', 'rt_cancel', 'rt_remove_ticket',
  'rt_remove_confirm', 'rt_visit_hint', 'rt_find_who', 'rt_where_is', 'rt_my_note',
  'rt_note_placeholder', 'rt_days_left', 'rt_depart_today', 'rt_expired',
  'rt_transport_self', 'rt_transport_share', 'rt_transport_public', 'rt_calendar', 'rt_clock'
];
const TRANSPORT_KEYS = { self: 'rt_transport_self', share: 'rt_transport_share', public: 'rt_transport_public' };

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 距出发天数：目标日期时间 − 今天，实时算，不存字段。跨天显示「距出发 N 天」，当天显示「今天出发」。
function countdownLabel(dateTime) {
  const target = String(dateTime || '').replace(/\//g, '-');
  const m = target.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return '';
  const targetDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (Number.isNaN(targetDay)) return '';
  const days = Math.round((targetDay - today) / 86400000);
  if (days < 0) return i18n.t('rt_expired');
  if (days === 0) return i18n.t('rt_depart_today');
  // i18n 不支持插值：「距出发 N 天」在页内拼（i18n 只放纯文案）。
  return i18n.getLang() === 'en' ? 'In ' + days + ' ' + i18n.t('rt_days_left') : '距出发 ' + days + ' ' + i18n.t('rt_days_left');
}
function transportLabel(value) { return i18n.t(TRANSPORT_KEYS[value] || 'rt_transport_self'); }

Page({
  data: {
    fontClass: 'fs-normal',
    loading: false,
    error: '',
    next: null,
    pending: [],
    stubs: [],
    pool: [],
    drawerOpen: false,
    draft: { destId: '', date: '', time: '', transport: 'self' },
    expandedId: ''
  },
  onLoad: function () { this.applyNav(); this.load(); },
  onShow: function () {
    this.setData({ fontClass: fontClass() });
    this.applyNav();
    const bar = this.getTabBar && this.getTabBar();
    if (bar) { bar.setData({ selected: 3 }); if (bar.applyLang) bar.applyLang(); }
    // 果农名片或票据变化后回到本页时同步刷新（今日快讯页「排一张票」会切到这里）。
    this.load();
  },
  applyNav: function () {
    const L = i18n.labels(LABEL_KEYS);
    this.setData({ L: L });
    if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: i18n.t('app_name') });
  },
  load: function () {
    const self = this;
    this.setData({ loading: true, error: '' });
    return Promise.all([farmtown.listTowns(), Promise.resolve(store.getTickets())]).then(function (results) {
      const towns = results[0] || [];
      const tickets = results[1] || [];
      self.setData(decorate(tickets, towns));
      self.setData({ loading: false });
    }).catch(function () {
      self.setData({ loading: false, error: i18n.t('rt_load_failed') });
    });
  },
  // 点一张票 = 在原页展开（下面板块被推下去），不跳新页。
  toggleTicket: function (e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  // 两个动作之一：导航出发。
  navigateTicket: function (e) {
    const t = this.findTicket(e.currentTarget.dataset.id);
    if (!t) return;
    if (!farmtown.validTownLocation({ latitude: t.destLat, longitude: t.destLng })) {
      wx.showToast({ title: i18n.t('rt_no_location'), icon: 'none' });
      return;
    }
    wx.openLocation({ latitude: t.destLat, longitude: t.destLng, name: t.destName, address: t.destName, fail: function () {} });
  },
  // 两个动作之二：去过了 · 撕票盖章 → 移入存根并盖日期章。
  stampTicket: function (e) {
    const self = this;
    const id = e.currentTarget.dataset.id;
    const tickets = this.data.allTickets.slice();
    const hit = tickets.filter(function (t) { return t.id === id; })[0];
    if (!hit) return;
    wx.showModal({
      title: i18n.t('rt_stamp_confirm_title'),
      content: i18n.t('rt_stamp_confirm_body'),
      confirmText: i18n.t('rt_stamp'),
      cancelText: i18n.t('rt_cancel'),
      success: function (r) {
        if (!r.confirm) return;
        hit.status = 'visited';
        hit.stampedAt = todayKey();
        self.persist(tickets);
      }
    });
  },
  updateNote: function (e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['draft.' + field]: e.detail.value });
    const tickets = this.data.allTickets.slice();
    const hit = tickets.filter(t => t.id === this.data.expandedId)[0];
    if (hit) { hit.note = e.detail.value; store.saveTickets(tickets); }
  },
  // ＋排一张票：底部抽屉（不跳页），抽屉背后仍是票夹原样。
  openDrawer: function () { this.setData({ drawerOpen: true }); },
  closeDrawer: function () { this.setData({ drawerOpen: false }); },
  noop: function () {},
  pickDest: function (e) { this.setData({ 'draft.destId': e.currentTarget.dataset.id }); },
  pickTransport: function (e) { this.setData({ 'draft.transport': e.currentTarget.dataset.value }); },
  onDateChange: function (e) { this.setData({ 'draft.date': e.detail.value }); },
  onTimeChange: function (e) { this.setData({ 'draft.time': e.detail.value }); },
  viewAllTowns: function () { this.setData({ drawerOpen: false }); wx.switchTab({ url: '/pages/index/index' }); },
  confirmTicket: function () {
    const self = this;
    const d = this.data.draft;
    if (!d.destId) { wx.showToast({ title: i18n.t('rt_pick_where'), icon: 'none' }); return; }
    if (!d.date) { wx.showToast({ title: i18n.t('rt_pick_when'), icon: 'none' }); return; }
    const town = this.data.allTowns.filter(function (t) { return t.id === d.destId; })[0];
    if (!town) return;
    const ticket = {
      id: 't' + Date.now(),
      destId: town.id,
      destName: town.name,
      destLat: farmtown.validTownLocation(town.location) ? town.location.latitude : null,
      destLng: farmtown.validTownLocation(town.location) ? town.location.longitude : null,
      dateTime: d.date + ' ' + (d.time || '09:00'),
      transport: d.transport,
      status: 'planned',
      stampedAt: '',
      note: ''
    };
    const tickets = this.data.allTickets.concat([ticket]);
    this.setData({ drawerOpen: false, draft: { destId: '', date: '', time: '', transport: 'self' } });
    this.persist(tickets);
    void self;
  },
  // 删掉一张待用票 → 该园子自动回到候选池（persist 后由decorate 重算）。
  removeTicket: function (e) {
    const self = this;
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: i18n.t('rt_remove_confirm'),
      content: i18n.t('rt_remove_confirm_body'),
      confirmText: i18n.t('rt_remove_ticket'),
      cancelText: i18n.t('rt_cancel'),
      success: function (r) {
        if (!r.confirm) return;
        self.persist(self.data.allTickets.filter(function (t) { return t.id !== id; }));
      }
    });
  },
  persist: function (tickets) {
    store.saveTickets(tickets);
    this.setData(decorate(tickets, this.data.allTowns));
  },
  findTicket: function (id) { return this.data.allTickets.filter(function (t) { return t.id === id; })[0]; }
});

// 组装票夹视图数据：下一张票 / 待用 / 存根 / 候选池。
// 候选池 = 全部果农名片 −（待用的票 + 存根里的园子），三个板块地点互不重复。
function decorate(tickets, towns) {
  const planned = tickets.filter(function (t) { return t.status !== 'visited'; });
  const visited = tickets.filter(function (t) { return t.status === 'visited'; });
  const used = {};
  planned.concat(visited).forEach(function (t) { used[t.destId] = true; });
  const pool = towns.filter(function (t) { return !used[t.id]; });
  const pack = function (t) {
    return Object.assign({}, t, { countdown: countdownLabel(t.dateTime), transportText: transportLabel(t.transport) });
  };
  const sortedPending = planned.slice().sort(function (a, b) { return String(a.dateTime).localeCompare(String(b.dateTime)); });
  return {
    allTickets: tickets,
    allTowns: towns,
    next: sortedPending.length ? pack(sortedPending[0]) : null,
    pending: sortedPending.slice(1).map(pack),
    stubs: visited.map(pack),
    pool: pool.map(function (t) { return Object.assign({}, t, { termLabel: t.term && t.fruit ? t.term + ' · ' + t.fruit : (t.fruit || t.term || '') }); })
  };
}