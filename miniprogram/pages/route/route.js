'use strict';
// 行程页 · 票夹（第 3 轮建立，第 9 轮按设计稿第⑤⑥⑦屏重排版式，2026-10-07）。
//
// 一屏内顺序固定：下一张票 → 待用的票 → ＋排一张票 → 存根。
// 一张票 = 一个目的地 + 4 项信息（目的地 / 距出发 / 目标日期时间 / 交通工具），
// 两个动作：导航出发（wx.openLocation）与「去过了 · 撕票盖章」；待用票多一个删除（✕）。
// 点一张票 = 在原页展开（展开区只剩「导航出发」「去过了 · 撕票盖章」两个动作），不跳新页。
// 旧版行程页的五个旧动作已从界面彻底移除（出行前复习、班次时刻、门票确认、出发前包、同步到社群）。
// 「生成这张票」= 本机留票（原行为、离线兜底）+ 后台试一次真报名（lib/booking-service.js）；报名失败只提示，不影响票。
const store = require('../../lib/store');
const booking = require('../../lib/booking-service');
const farmtown = require('../../lib/farmtown-service');
const i18n = require('../../lib/i18n');
const ticketFormat = require('../../lib/ticket-format');
const townInfo = require('../../lib/town-info');
const recentTown = require('../../lib/recent-town');

// 抽屉「去哪」默认只露 1 个（2026-10-12 第12 轮按用户要求：先只显示一个果乡名片，
// 其余放进「查看更多果园」；展开逻辑 poolExpanded / poolRest 未改）
const POOL_PREVIEW = 1;

const LABEL_KEYS = [
  // rt_page_title = 页面内大标题（wxml 第 4 行一直在用），此前漏在本表外 → 大标题渲染成 undefined（2026-10-12 第13 轮修）。
  // rt_load_failed = 候选池加载失败的提示行，同样一直用在 wxml 里、漏在本表外。
  'rt_holder_title', 'rt_page_title', 'rt_load_failed',
  'rt_next_ticket', 'rt_pending_tickets', 'rt_add_ticket', 'rt_stubs',
  'rt_navigate_go', 'rt_stamp', 'rt_no_ticket', 'rt_no_pending', 'rt_no_stub',
  'rt_pool_note', 'rt_pool_all', 'rt_pool_less', 'rt_pool_empty', 'rt_save', 'rt_drawer_where', 'rt_drawer_when', 'rt_pick_date', 'rt_pick_time', 'picker_cancel', 'picker_ok',
  'rt_drawer_how', 'rt_where_placeholder', 'rt_confirm', 'rt_cancel', 'rt_remove_ticket',
  'rt_remove_confirm', 'rt_visit_hint', 'rt_find_who', 'rt_where_is', 'rt_my_note',
  'rt_note_placeholder', 'rt_days_left', 'rt_depart_today', 'rt_expired',
  'rt_transport_self', 'rt_transport_share', 'rt_transport_public', 'rt_calendar', 'rt_clock',
  'rt_when', 'rt_how', 'rt_visited', 'rt_copy_contact', 'rt_contact_prefix', 'rt_transport_prefix', 'rt_exp_prefix',
  // 「① 去哪」的候选名片要显示整张果乡名片（2026-10-12 第12 轮）：标签键复用快讯卡片那套，一个都没新造。
  'pub_name', 'sl_region', 'sl_address', 'sl_experience', 'sl_intro', 'sl_transport',
  'sl_wechat_colon', 'sl_phone_colon', 'sl_none',
  // 名片剩余 4 项（可去日期 / 开关门日期 + 开关门时间两行 / 距你多少公里 / 联系方式，2026-10-12 第13 轮）：
  // 标签同样全部复用既有键 —— 可去日期用快讯那条 news_activity_date，
  // 开关门两项用卖货台那套自带冒号的 sl_open_date_colon / sl_open_time_colon，
  // 联系方式沿用候选名片一直在用的 rt_contact_prefix（票卡展开区删掉那三段后，这个键仍由 ①去哪 的名片在用）；距离的值本身已含「距你」/「km away」，不需要标签键。
  'news_activity_date', 'sl_open_date_colon', 'sl_open_time_colon',
  // 「活动方案」（2026-10-13）：候选名片最后一块的标题键，直接用结果页早就在用的 plan_nav
  // （词典里就是「活动方案」/「Activity plan」）—— 不新造键，也不复用卖货台那块专用的 sl_my_plan。
  'plan_nav',
  // 真报名的两句新提示（本轮只加这两个键；失败提示复用既有 network_error，不新造）
  'rt_booking_ok', 'rt_booking_full',
  // 「每天还剩多少名额」（本轮新增的两个键，全量就这两个）：
  // rt_seats_left 带 {{n}}，只能在 JS 里插值后给每行（WXML 不做插值）；rt_seats_unknown 是名额未知时的那句可读提示。
  'rt_seats_left', 'rt_seats_unknown'
];

// 本页拟报名人数固定 1（页面上还没有人数字段）：用来判断「剩余名额 < 人数」。
// 必须与 reserveSeat 里 booking.reserve 传的 people 是同一个数，否则置灰口径会和服务端不一致。
const PEOPLE = 1;

// 体验标签（存档值永远是中文，与 pages/seller/index.js 同一套口径）：
// 词典里有的取英文名，没有的原样返回（不空白、不乱编）。
const EXP_KEYS = ['sl_exp_pick', 'sl_exp_sightseeing', 'sl_exp_craft', 'sl_exp_food', 'sl_exp_culture'];
const EXP_KEY_BY_ZH = {};
EXP_KEYS.forEach(function (key) { EXP_KEY_BY_ZH[i18n.dict[key][0]] = key; });
function experienceLabel(name) {
  const key = EXP_KEY_BY_ZH[name];
  return key ? i18n.t(key) : name;
}

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
// 「每天还剩多少名额」的一行（② 里逐日列出）。口径完全按服务端 server/bookings.js:83：
// past 或 full → disabled（wxml 里这种行不绑 tap，整行灰掉、没有点击区）；remaining 用 {{n}} 在 JS 里插值。
function seatRow(day) {
  return {
    date: day.date,
    label: String(day.date || '').slice(5),
    remaining: day.remaining,
    disabled: !!(day.past || day.full),
    seatsText: i18n.t('rt_seats_left', { n: day.remaining })
  };
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
    // ② 里的「每天还剩多少名额」：dayRows 只装 /api/booking-availability 真回过的天；
    // 接口没部署 / 断网 / 403 / 404 一律 dayRows=[] + seatsKnown=false（名额未知 → 不置灰、不拦报名）。
    dayRows: [],
    seatsKnown: false,
    seatsUnknown: false,
    seatsDestId: '',
    seatsToken: 0,
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
    // 名片就位后再取一次「每天还剩多少名额」（挑园子/回本页都会刷新；没选园子时什么都不做）。
    const self = this;
    this.load().then(function () { if (self.data.draft.destId) self.loadSeats(self.data.draft.destId); });
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
    // 本机的票不依赖网络：果乡名片拉不到时票夹照常显示（只是候选池那块的名片
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
  // note 字段的写入逻辑照旧保留（展开区已不再渲染备注输入框，界面上没人调用它了）：只改 note，不再和别的字段共用。
  updateNote: function (e) {
    const id = e.currentTarget.dataset.id;
    const tickets = this.data.allTickets.slice();
    const hit = tickets.filter(function (t) { return t.id === id; })[0];
    if (!hit) return;
    hit.note = e.detail.value;
    store.saveTickets(tickets);
    this.setData(decorate(tickets, this.data.allTowns || [], this.data.poolFailed, this.data.poolExpanded));
  },
  // 复制联系方式：展开区那三段删掉后界面已无人调用，handler 与 rt_copy_contact 一起原样保留（代码不动）。
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
  pickDest: function (e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ 'draft.destId': id });
    this.loadSeats(id);
  },
  // 点「还有名额」的那一天 = 选日期。置灰行在 wxml 里就没绑 tap，这里再兜一层。
  pickDay: function (e) {
    const date = e.currentTarget.dataset.date;
    const row = (this.data.dayRows || []).filter(function (r) { return r.date === date; })[0];
    if (!row || row.disabled) return;
    this.setData({ 'draft.date': date });
  },
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
    // 名额已知、且选的正是这家园子、且那天剩余 < 拟报名人数（本页 1 人）→ 不许提交，给可读提示。
    // 名额未知时 seatsShort() 一定返回空串，绝不阻塞报名（照现有流程走）。
    const short = this.seatsShort();
    if (short) { wx.showToast({ title: short, icon: 'none' }); return; }
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
    // 本机的票先落地（离线兜底 / 原行为），再在后台试一次真报名；报名这条线无论成败都不改上面这份票。
    this.reserveSeat(town, d.date);
  },
  notify: function (title) {
    try { if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: title, icon: 'none' }); } catch (e) { /* 提示失败也不影响本机那份票 */ }
  },
  // 真报名（lib/booking-service.js 既有用法：ensureClient 内部取身份、requestId 由它生成）。
  // 四种情况都只弹一句中文提示，绝不抛错、不白屏：取不到身份 / 这个园子没有已发布活动 / 断网 / 服务端拒绝。
  reserveSeat: function (town, date) {
    const self = this;
    const tell = function (key) { self.notify(i18n.t(key)); };
    // 演示账户不连真实预约服务（lib/booking-service.js:26 会直接拒绝），走本机兜底、连请求都不发。
    if (store.isDemoMode()) return;
    let attempt;
    try { attempt = booking.listActivities(); } catch (e) { attempt = Promise.reject(e); }
    Promise.resolve(attempt).then(function (result) {
      const activity = activityForTown(town, result && result.activities);
      if (!activity) { tell('network_error'); return; }
      // 一张票记 1 人：本页还没有人数字段（名额列表 / 人数选择是下一件小事），不在这里新造输入。
      return booking.reserve({ requestId: booking.requestId(), activityId: activity.id, date: date, people: 1 })
        .then(function () { tell('rt_booking_ok'); }, function (error) { tell(error && error.code === 'booking_full' ? 'rt_booking_full' : 'network_error'); });
    }).catch(function () { tell('network_error'); });
  },
  // 每天还剩多少名额（GET /api/booking-availability，客户端封装见 lib/booking-service.js）。
  // 严格按服务端口径置灰：past===true || full===true → 整行灰掉且不做点击区；past===false（含今天）可约。
  // 优雅降级是硬要求：接口还没部署到线上（404 / 网络失败）、401 重取身份后仍失败、403（拿到的是果乡身份）、
  // 认不出对应活动（=「没有这个活动」）→ 一律按「名额未知」：不置灰、不拦报名、照现有流程走，只多一句可读提示。
  loadSeats: function (destId) {
    const self = this;
    const token = (this.data.seatsToken || 0) + 1;
    const town = (this.data.allTowns || []).filter(function (t) { return t.id === destId; })[0];
    // 没这家名片 / 演示账户不连真实预约服务：什么都不显示，也不置灰不拦
    if (!town || store.isDemoMode()) { this.setData({ seatsToken: token, seatsDestId: '', dayRows: [], seatsKnown: false, seatsUnknown: false }); return; }
    this.setData({ seatsToken: token, seatsDestId: destId, dayRows: [], seatsKnown: false, seatsUnknown: false });
    // 名额未知的落地口（silent=true 连提示都不给：那属于「没有这个活动」，提交时沿用既有提示）
    const settle = function (silent) {
      if (self.data.seatsToken !== token) return;
      self.setData({ dayRows: [], seatsKnown: false, seatsUnknown: !silent });
    };
    const attempt = function (retried) {
      let listed;
      try { listed = booking.listActivities(); } catch (e) { listed = Promise.reject(e); }
      return Promise.resolve(listed).then(function (result) {
        const activity = activityForTown(town, result && result.activities);
        if (!activity) { settle(true); return; }
        return booking.availability(activity.id).then(function (data) {
          if (self.data.seatsToken !== token) return;
          const days = (data && data.days) || [];
          if (!days.length) { settle(true); return; }
          self.setData({ dayRows: days.map(seatRow), seatsKnown: true, seatsUnknown: false });
        }, function (error) {
          // 401：身份已失效 → 按既有逻辑重取身份（booking-service 已顺手清掉旧凭据）后再试一次
          if (error && error.code === 'booking_unauthorized' && !retried) return attempt(true);
          // 403（拿到的是果乡身份）/ 还没部署到线上（404）/ 断网 → 一律「名额未知」+ 一句可读提示
          settle(false);
        });
      }).catch(function () { settle(false); });
    };
    attempt(false);
  },
  // 提交前的本地闸：名额是接口给的、且选的正是这家园子、且那天剩余 < 拟报名人数 → 返回一句提示。
  // 名额未知（接口没部署 / 断网 / 403 / 404 / 没活动）时一定返回空串：绝不阻塞报名，
  // 并发抢最后一席仍由提交时的 409 booking_full 兜住（置灰只是提示）。
  seatsShort: function () {
    if (!this.data.seatsKnown || this.data.seatsDestId !== this.data.draft.destId) return '';
    const date = this.data.draft.date;
    const row = (this.data.dayRows || []).filter(function (r) { return r.date === date; })[0];
    return row && row.remaining < PEOPLE ? i18n.t('rt_booking_full') : '';
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

// 果乡 ↔ 已发布活动的对应关系。
// ① 先认 townId（2026-10-18 起活动契约里带上这个字段，创建时由发活动那头写入，见 server/bookings.js 的 publish）：
//    整份列表先扫一遍 townId，命中就认这一场 —— 不能跟下面那套猜测混在同一个循环里，
//    否则一场更靠前的「同名活动」会把真正对应的那一场抢先（名字相等本来就只是巧合）。
// ② 拿不到 townId（老活动 / 没写）再回退到原有的等值猜测（这条退路不许删）：
//    把这张名片的 id / 收藏 id 写进种植记录编号，或把名片名称 / 地址写成活动名称 / 集合地点，
//    这四种任一命中才算「这个果乡有对应的已发布活动」，认不出就退回本机。
function activityForTown(town, list) {
  const ids = [town.id, town.favId].filter(Boolean);
  const names = [town.name, town.address].filter(Boolean);
  const rows = Array.isArray(list) ? list : [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] || {};
    if (a.townId && ids.indexOf(a.townId) !== -1) return a;
  }
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] || {};
    if (a.batchId && ids.indexOf(a.batchId) !== -1) return a;
    if (a.title && names.indexOf(a.title) !== -1) return a;
    if (a.location && names.indexOf(a.location) !== -1) return a;
  }
  return null;
}

// 组装票夹视图数据：下一张票 / 待用 / 存根 / 候选池。
// 候选池 = 全部果农名片 −（待用的票 + 存根里的园子），三个板块地点互不重复；
// 默认只给前 POOL_PREVIEW 个（=1，2026-10-12 第12 轮改），其余放 poolRest，点「查看更多果园 ›」展开（poolExpanded）。
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
  // 「① 去哪」的候选行 = 整张果乡名片（2026-10-12 第12 轮用户要求：名片的所有内容都在这里显示出来）。
  // 字段名与取值兜底走 lib/town-info.js 的 cardFor —— 与今日快讯页同一套（原来是两处各写一份）。
  // 旧的 id / name / subLine 原样保留（subLine = 地区 ｜ 节气·水果），避免动到别处的口径。
  let poolRows = pool.map(function (t) {
    const card = townInfo.cardFor(t, origin, farmtown.validTownLocation);
    const region = townInfo.regionLabel(t);
    const term = card.termLabel;
    return {
      id: t.id,
      name: card.name,
      subLine: [region, term].filter(Boolean).join(' ｜ '),
      card: card,
      // 体验标签按语言取词（存档值仍是中文，中文模式逐字不变）
      expTags: card.experiences.map(experienceLabel).filter(Boolean)
    };
  });
  // 2026-10-12：刚发布 / 保存的那张提到最前（createdAt 只到日期，同日排序会「平手」），其余顺序不动；
  // 没记住该 id 或它已被排票用掉时 promote 原样返回 → 与改动前逐项一致（不报错、不空白）。
  poolRows = recentTown.promote(poolRows);
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
    // 「查看更多果园 N ›」的文案在页内拼（i18n 只放纯文案，不支持插值）。
    // 英文按数量取单/复数：1 个用 rt_pool_all_one（more orchard），其余用 rt_pool_all（more orchards），
    // 修掉 N=1 时「1 more orchards ›」的单复数错误（2026-10-12 第13 轮）。
    // 中文两种数量都走 rt_pool_all，输出与改动前逐字一致：查看更多果园 N ›。
    poolMoreLabel: rest.length
      ? (i18n.getLang() === 'en'
        ? rest.length + ' ' + i18n.t(rest.length === 1 ? 'rt_pool_all_one' : 'rt_pool_all') + ' ›'
        : i18n.t('rt_pool_all') + ' ' + rest.length + ' ›')
      : '',
    next: sortedPending.length ? pack(sortedPending[0]) : null,
    pending: sortedPending.slice(1).map(pack),
    stubs: visited.map(pack)
  };
}
