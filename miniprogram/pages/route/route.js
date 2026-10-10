'use strict';
// 行程页 · 票夹（第 3 轮建立，第 9 轮按设计稿第⑤⑥⑦屏重排版式，2026-10-07）。
//
// 一屏内顺序固定：下一张票 → 待用的票 → ＋排一张票 → 存根。
// 一张票 = 一个目的地 + 4 项信息（目的地 / 距出发 / 目标日期时间 / 交通工具），
// 两个动作：导航出发（wx.openLocation）与「去过了 · 撕票盖章」；待用票多一个删除（✕）。
// 点一张票 = 在原页展开「到了找谁 / 在哪儿 / 我的一行备注」，不跳新页。
// 旧版行程页的五个旧动作已从界面彻底移除（出行前复习、班次时刻、门票确认、出发前包、同步到社群）。
const store = require('../../lib/store');
const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');
const ticketFormat = require('../../lib/ticket-format');
const townInfo = require('../../lib/town-info');

// 抽屉「去哪」默认只露 3 个，其余折叠（2026-10-07 第11 轮按用户要求）
const POOL_PREVIEW = 3;

const LABEL_KEYS = [
  'rt_holder_title', 'rt_next_ticket', 'rt_pending_tickets', 'rt_add_ticket', 'rt_stubs',
  'rt_navigate_go', 'rt_stamp', 'rt_no_ticket', 'rt_no_pending', 'rt_no_stub',
  'rt_pool_note', 'rt_pool_all', 'rt_pool_less', 'rt_pool_empty', 'rt_save', 'rt_drawer_where', 'rt_drawer_when', 'rt_pick_date', 'rt_pick_time', 'picker_cancel', 'picker_ok',
  'rt_drawer_how', 'rt_where_placeholder', 'rt_confirm', 'rt_cancel', 'rt_remove_ticket',
  'rt_remove_confirm', 'rt_visit_hint', 'rt_find_who', 'rt_where_is', 'rt_my_note',
  'rt_note_placeholder', 'rt_days_left', 'rt_depart_today', 'rt_expired',
  'rt_transport_self', 'rt_transport_share', 'rt_transport_public', 'rt_calendar', 'rt_clock',
  'rt_when', 'rt_how', 'rt_visited', 'rt_copy_contact', 'rt_contact_prefix', 'rt_transport_prefix', 'rt_exp_prefix'
];

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 日期选择（2026-10-07 第13 轮）：不用原生 mode="date"，因为它会把邻近的过去日期也画在滚轮上
// （用户实测 2024/2025 还在上面），start/end 只管"选不选得中"。改用 multiSelector 自己给列，
// 列里根本不放过去的年月日：年 今年→2028、月/日按"不早于今天"动态生成。
const DATE_END_YEAR = 2028;
function todayParts() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}
function monthColumn(year, t) {
  const from = year === t.y ? t.m : 1;
  const out = [];
  for (let m = from; m <= 12; m++) out.push(m + '月');
  return out;
}
function dayColumn(year, month, t) {
  const last = new Date(year, month, 0).getDate();
  const from = (year === t.y && month === t.m) ? t.d : 1;
  const out = [];
  for (let d = from; d <= last; d++) out.push(d + '日');
  return out;
}
// 按当前选择拼出三列 + 索引 + 'YYYY-MM-DD'（索引越界时收敛到最后一列）
function buildDateState(t, sel) {
  const years = [];
  for (let y = t.y; y <= DATE_END_YEAR; y++) years.push(y + '年');
  const wantY = sel && sel.y ? sel.y : t.y;
  const yi = Math.max(0, Math.min(years.length - 1, wantY - t.y));
  const year = t.y + yi;
  const months = monthColumn(year, t);
  const wantM = sel && sel.m ? sel.m : (year === t.y ? t.m : 1);
  const mi = Math.max(0, Math.min(months.length - 1, wantM - Number(months[0].replace('月', ''))));
  const month = Number(months[mi].replace('月', ''));
  const days = dayColumn(year, month, t);
  const wantD = sel && sel.d ? sel.d : (year === t.y && month === t.m ? t.d : 1);
  const di = Math.max(0, Math.min(days.length - 1, wantD - Number(days[0].replace('日', ''))));
  const day = Number(days[di].replace('日', ''));
  return {
    dateRange: [years, months, days],
    dateIndex: [yi, mi, di],
    date: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  };
}
// 存根红章里的短日期：2026-10-05 → 10·05
function stampShort(stampedAt) {
  const m = String(stampedAt || '').replace(/\//g, '-').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[2] + '·' + m[3] : '';
}

Page({
  data: {
    fontClass: 'fs-normal',
    loading: false,
    error: '',
    next: null,
    pending: [],
    stubs: [],
    pool: [],
    poolExpanded: false,
    // 日期选择的三个滚轮列 + 当前索引（只含今天及以后，最远 2028 年）
    dateRange: [[], [], []],
    dateIndex: [0, 0, 0],
    dateSheetOpen: false,
    timeSheetOpen: false,
    timeSheetIndex: [9, 0],
    timeRange: [[], []],
    dateSheetIndex: [0, 0, 0],
    drawerOpen: false,
    draft: { destId: '', date: '', time: '', transport: '' },
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
    // 今日快讯页「排一张票」带的园子：落到本页时自动开抽屉并预选。
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.pendingPlanTownId) {
      const id = app.pendingPlanTownId;
      app.pendingPlanTownId = null;
      this.setData({ drawerOpen: true, 'draft.destId': id });
    }
  },
  applyNav: function () {
    const L = i18n.labels(LABEL_KEYS);
    this.setData({ L: L });
    if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: i18n.t('rt_holder_title') });
  },
  load: function () {
    const self = this;
    this.setData({ loading: true, error: '' });
    // 本机的票不依赖网络：果乡名片拉不到时票夹照常显示（只是候选池与「到了找谁」的名片
    // 信息缺一块），不再整页报错 —— 2026-10-07 第10 轮修（开发者工具里没连云时会踩到）。
    const townsPromise = farmtown.listTowns()
      .then(function (list) { return { towns: list || [], failed: false }; })
      .catch(function () { return { towns: [], failed: true }; });
    return Promise.all([townsPromise, Promise.resolve(store.getTickets())]).then(function (results) {
      const townResult = results[0];
      const tickets = results[1] || [];
      self.setData(decorate(tickets, townResult.towns, townResult.failed, self.data.poolExpanded));
      self.setData({ loading: false, error: townResult.failed && !tickets.length ? i18n.t('rt_load_failed') : '' });
    }).catch(function () {
      self.setData({ loading: false, error: i18n.t('rt_load_failed') });
    });
  },
  // 点一张票 = 在原页展开（下面板块被推下去），不跳新页。
  toggleTicket: function (e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  // 动作之一：导航出发。票里没存坐标（老票）时回查该园子名片的坐标，避免明明能去却只弹提示。
  navigateTicket: function (e) {
    const t = this.findTicket(e.currentTarget.dataset.id);
    if (!t) return;
    let lat = t.destLat;
    let lng = t.destLng;
    if (!farmtown.validTownLocation({ latitude: lat, longitude: lng })) {
      const town = (this.data.allTowns || []).filter(function (x) { return x.id === t.destId; })[0];
      if (town && farmtown.validTownLocation(town.location)) {
        lat = town.location.latitude;
        lng = town.location.longitude;
      }
    }
    if (!farmtown.validTownLocation({ latitude: lat, longitude: lng })) {
      wx.showToast({ title: i18n.t('rt_no_location'), icon: 'none' });
      return;
    }
    wx.openLocation({ latitude: lat, longitude: lng, name: t.destName, address: t.destName, fail: function () {} });
  },
  // 动作之二：去过了 · 撕票盖章 → 移入存根并盖日期章。
  // 注意：wx.showModal 的按钮文字上限 4 个字，之前把整句「去过了 · 撕票盖章」塞进 confirmText，
  // 弹窗直接调用失败 → 表现为「点了没反应」（2026-10-07 第12 轮修）。
  stampTicket: function (e) {
    const self = this;
    const id = e.currentTarget.dataset.id;
    const doStamp = function () {
      const tickets = self.data.allTickets.slice();
      const hit = tickets.filter(function (t) { return t.id === id; })[0];
      if (!hit) return;
      hit.status = 'visited';
      hit.stampedAt = todayKey();
      self.persist(tickets);
      wx.showToast({ title: i18n.t('rt_stamped'), icon: 'none' });
    };
    wx.showModal({
      title: i18n.t('rt_stamp_confirm_title'),
      content: i18n.t('rt_stamp_confirm_body'),
      confirmText: i18n.t('rt_stamp_confirm'),
      cancelText: i18n.t('rt_cancel'),
      success: function (r) { if (r.confirm) doStamp(); },
      // 弹窗失败也照样盖章，绝不再出现「点了没反应」
      fail: doStamp
    });
  },
  // 展开块里的「我的一行备注」：只改 note，不再和别的字段共用。
  updateNote: function (e) {
    const id = e.currentTarget.dataset.id;
    const tickets = this.data.allTickets.slice();
    const hit = tickets.filter(function (t) { return t.id === id; })[0];
    if (!hit) return;
    hit.note = e.detail.value;
    store.saveTickets(tickets);
    this.setData(decorate(tickets, this.data.allTowns || [], this.data.poolFailed, this.data.poolExpanded));
  },
  // 「到了找谁」里的复制微信
  copyContact: function (e) {
    const contact = e.currentTarget.dataset.contact || '';
    if (!contact) return;
    wx.setClipboardData({ data: contact, fail: function () { wx.showToast({ title: i18n.t('news_copy_failed'), icon: 'none' }); } });
  },
  // ＋排一张票：底部抽屉（不跳页），抽屉背后仍是票夹原样。
  // 打开抽屉时把日期列刷成"今天起"，但**不替用户把日期填上** —— 日期栏显示「选日期」，滚轮停到今天，
  // 只有点「确定」才算选好（2026-10-09 用户要求：日期/时间/怎么去三项都要用户自己选）。
  openDrawer: function () {
    const t = todayParts();
    const next = buildDateState(t, null);
    this.setData({
      drawerOpen: true,
      dateRange: next.dateRange,
      dateIndex: next.dateIndex
    });
  },
  closeDrawer: function () {
    this.setData({ drawerOpen: false }); },
  noop: function () {},
  pickDest: function (e) { this.setData({ 'draft.destId': e.currentTarget.dataset.id }); },
  pickTransport: function (e) { this.setData({ 'draft.transport': e.currentTarget.dataset.value }); },
  // 打开自绘日期面板（把当前选择带进去；此时还不算选好）
  openDateSheet: function () {
    this.setData({ dateSheetOpen: true, dateSheetIndex: this.data.dateIndex.slice() });
  },
  // 滚轮滚动：只更新临时索引，并按新范围重建"月/日"两列（过去的日期永不出现）
  onDateSheetChange: function (e) {
    const v = (e.detail && e.detail.value) || this.data.dateSheetIndex;
    const t = todayParts();
    const year = t.y + (v[0] || 0);
    const months = monthColumn(year, t);
    const mi = Math.max(0, Math.min(months.length - 1, v[1] || 0));
    const days = dayColumn(year, Number(String(months[mi]).replace('月', '')), t);
    const di = Math.max(0, Math.min(days.length - 1, v[2] || 0));
    const range = this.data.dateRange.slice();
    range[1] = months; range[2] = days;
    this.setData({ dateRange: range, dateSheetIndex: [v[0] || 0, mi, di] });
  },
  // 取消：什么都不写，直接关掉（保持"只有点确定才算选好"）
  cancelDateSheet: function () { this.setData({ dateSheetOpen: false }); },
  // 确定：走原来的选值逻辑写进 draft.date，然后关闭面板
  confirmDateSheet: function () {
    const idx = this.data.dateSheetIndex;
    this.onDateChange({ detail: { value: idx } });
    this.setData({ dateSheetOpen: false });
  },
  // 滚轮列变化：年/月变了就把"月""日"两列按新范围重建，保证过去的日期不会出现在列里
  onDateColumnChange: function (e) {
    const col = e.detail.column;
    const idx = this.data.dateIndex.slice();
    idx[col] = e.detail.value;
    const t = todayParts();
    const year = t.y + idx[0];
    const months = monthColumn(year, t);
    const mi = Math.max(0, Math.min(months.length - 1, idx[1]));
    const month = Number(months[mi].replace('月', ''));
    const days = dayColumn(year, month, t);
    const di = Math.max(0, Math.min(days.length - 1, idx[2]));
    const range = this.data.dateRange.slice();
    range[1] = months; range[2] = days;
    this.setData({ dateRange: range, dateIndex: [idx[0], mi, di] });
  },
  // 点确定：按当前三列索引拼出日期
  onDateChange: function (e) {
    const v = (e.detail && e.detail.value) || this.data.dateIndex;
    const t = todayParts();
    const year = t.y + (v[0] || 0);
    const months = this.data.dateRange[1] || monthColumn(year, t);
    const days = this.data.dateRange[2] || dayColumn(year, Number(String(months[v[1] || 0] || '1月').replace('月', '')), t);
    const month = Number(String(months[v[1] || 0] || '1月').replace('月', ''));
    const day = Number(String(days[v[2] || 0] || '1日').replace('日', ''));
    this.setData({
      'draft.date': year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
      dateIndex: [v[0] || 0, v[1] || 0, v[2] || 0]
    });
  },
  onTimeChange: function (e) { this.setData({ 'draft.time': e.detail.value }); },
  // 自绘时间面板：时 00-23、分 00-59（每 1 分钟一档）；只有点「确定」才写值
  openTimeSheet: function () {
    const hours = []; for (let h = 0; h < 24; h++) hours.push(String(h).padStart(2, '0'));
    const mins = []; for (let m = 0; m < 60; m++) mins.push(String(m).padStart(2, '0'));
    const cur = String(this.data.draft.time || '');
    const parts = /^(\d{1,2}):(\d{2})$/.exec(cur);
    const now = new Date();
    const hi = parts ? Math.min(23, Number(parts[1])) : now.getHours();
    const mi = parts ? Math.min(59, Number(parts[2])) : 0;
    this.setData({ timeRange: [hours, mins], timeSheetIndex: [hi, mi], timeSheetOpen: true });
  },
  onTimeSheetChange: function (e) {
    const v = (e.detail && e.detail.value) || this.data.timeSheetIndex;
    this.setData({ timeSheetIndex: [v[0] || 0, v[1] || 0] });
  },
  cancelTimeSheet: function () { this.setData({ timeSheetOpen: false }); },
  confirmTimeSheet: function () {
    const idx = this.data.timeSheetIndex;
    const hours = this.data.timeRange[0] || [];
    const mins = this.data.timeRange[1] || [];
    const hh = hours[idx[0]] || '09';
    const mm = mins[idx[1]] || '00';
    this.setData({ 'draft.time': hh + ':' + mm, timeSheetOpen: false });
  },
  // 候选池默认只显示 3 个，点「查看更多果园 ›」把剩下的展开（再点收起），仍留在抽屉里。
  togglePool: function () {
    const next = !this.data.poolExpanded;
    this.setData({ poolExpanded: next });
    this.setData(decorate(this.data.allTickets || [], this.data.allTowns || [], this.data.poolFailed, next));
  },
  confirmTicket: function () {
    const d = this.data.draft;
    if (!d.destId) { wx.showToast({ title: i18n.t('rt_pick_where'), icon: 'none' }); return; }
    if (!d.date) { wx.showToast({ title: i18n.t('rt_pick_when'), icon: 'none' }); return; }
    if (!d.time) { wx.showToast({ title: i18n.t('rt_pick_time'), icon: 'none' }); return; }
    if (!d.transport) { wx.showToast({ title: i18n.t('rt_pick_how'), icon: 'none' }); return; }
    const town = (this.data.allTowns || []).filter(function (t) { return t.id === d.destId; })[0];
    if (!town) return;
    const ticket = {
      id: 't' + Date.now(),
      destId: town.id,
      destName: town.name,
      destLat: farmtown.validTownLocation(town.location) ? town.location.latitude : null,
      destLng: farmtown.validTownLocation(town.location) ? town.location.longitude : null,
      dateTime: d.date + ' ' + d.time,
      transport: d.transport,
      status: 'planned',
      stampedAt: '',
      note: ''
    };
    const tickets = this.data.allTickets.concat([ticket]);
    this.setData({ drawerOpen: false, draft: { destId: '', date: '', time: '', transport: '' } });
    this.persist(tickets);
  },
  // 删掉一张待用票 → 该园子自动回到候选池（persist 后由 decorate 重算）。
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
    this.setData(decorate(tickets, this.data.allTowns || [], this.data.poolFailed, this.data.poolExpanded));
  },
  findTicket: function (id) { return this.data.allTickets.filter(function (t) { return t.id === id; })[0]; }
});

// 组装票夹视图数据：下一张票 / 待用 / 存根 / 候选池。
// 候选池 = 全部果农名片 −（待用的票 + 存根里的园子），三个板块地点互不重复；
// 默认只给前 3 个（poolPreview），其余放 poolRest，点「查看更多果园 ›」展开（poolExpanded）。
function decorate(tickets, towns, townsFailed, poolExpanded) {
  const planned = tickets.filter(function (t) { return t.status !== 'visited'; });
  const visited = tickets.filter(function (t) { return t.status === 'visited'; });
  const used = {};
  planned.concat(visited).forEach(function (t) { used[t.destId] = true; });
  const pool = towns.filter(function (t) { return !used[t.id]; });
  const byId = {};
  towns.forEach(function (t) { byId[t.id] = t; });
  const origin = townInfo.readOrigin();
  const L = i18n.labels(['rt_contact_prefix', 'rt_transport_prefix', 'rt_exp_prefix', 'sl_region', 'sl_address']);

  const pack = function (t) {
    const town = byId[t.destId] || {};
    const region = townInfo.regionLabel(town);
  const address = (town && town.address) || '';
    const distance = townInfo.distanceLabel(town, origin, farmtown.validTownLocation);
    const exps = Array.isArray(town.experiences) ? town.experiences.filter(Boolean) : [];
    return Object.assign({}, t, {
      whenLabel: ticketFormat.whenLabel(t.dateTime),
      countdown: ticketFormat.countdownLabel(t.dateTime),
      transportText: ticketFormat.transportLabel(t.transport),
      stampShort: stampShort(t.stampedAt),
      contact: town.contact || '',
      contactLine: town.contact ? L.rt_contact_prefix + town.contact : '',
      transportLine: town.transport ? L.rt_transport_prefix + town.transport : '',
      expLine: exps.length ? L.rt_exp_prefix + exps.join(' · ') : '',
      placeLine: [region, distance].filter(Boolean).join(' · ')
    });
  };
  const sortedPending = planned.slice().sort(function (a, b) { return String(a.dateTime).localeCompare(String(b.dateTime)); });
  const poolRows = pool.map(function (t) {
    const term = t.term && t.fruit ? t.term + ' · ' + t.fruit : (t.fruit || t.term || '');
    const region = townInfo.regionLabel(t);
  const address = (t && t.address) || '';
    return {
      id: t.id,
      name: t.name || '',
      art: townInfo.artFor(t),
      subLine: [region, term].filter(Boolean).join(' ｜ ')
    };
  });
  const preview = poolExpanded ? poolRows : poolRows.slice(0, POOL_PREVIEW);
  const rest = poolExpanded ? [] : poolRows.slice(POOL_PREVIEW);
  return {
    allTickets: tickets,
    allTowns: towns,
    poolFailed: !!townsFailed,
    poolExpanded: !!poolExpanded,
    pool: poolRows,
    poolPreview: preview,
    poolRest: rest,
    // 「查看更多果园 N ›」的文案在页内拼（i18n 只放纯文案，不支持插值）
    poolMoreLabel: rest.length
      ? (i18n.getLang() === 'en' ? rest.length + ' ' + i18n.t('rt_pool_all') + ' ›' : i18n.t('rt_pool_all') + ' ' + rest.length + ' ›')
      : '',
    next: sortedPending.length ? pack(sortedPending[0]) : null,
    pending: sortedPending.slice(1).map(pack),
    stubs: visited.map(pack)
  };
}
