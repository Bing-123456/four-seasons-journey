'use strict';
// 分步向导页（评审 P24③《"行程"的修改方案》）：一步一问、顶部进度条、全大按钮/标签点选，
// 不用下拉框。选择数据存 guayouji.trip-wizard.v1（本分包 lib/trip-wizard），第 7 步复用
// core.generateRoute 同一套确定性链路生成路线，成功后 redirectTo 行程详情页看时间轴。
// 页面放 packageTrip 分包（主包体积余量不足，见 lib/trip-wizard.js 头注释）；分包页面允许
// require 主包的 store/i18n/geo 与本分包 lib。
const store = require('../../../lib/store');
const i18n = require('../../../lib/i18n');
const geo = require('../../../lib/geo');
const lib = require('../../lib/trip-wizard');
// 中英双语内联文案（参照 pages/index/index.js 的 visualCopy 写法；不改 lib/i18n.js）。
const COPY = {
  zh: {
    title: '定制文化行程', subtitle: '七个小问题，串一条属于你的果香路线',
    titles: ['你想体验哪种水果的文化？', '从哪出发？想去哪个园子？', '哪天去？待多久？', '几个人去？', '想体验什么？', '人均预算大概？', '核对一下，就去生成'],
    subs: ['选一张水果卡片，跟着它的节气故事走', '定位只在你主动点击时读取一次；园子按水果主题推荐', '行程按白天时段安排，先定日子和节奏', '同行人数影响体验安排', '可多选，行程会围绕它们展开', '只作规划参考，未知费用会如实标注', '生成后还能在行程页微调，再行预约'],
    prev: '上一步', next: '下一步', generate: '生成文化行程', generating: '正在生成…',
    useLocation: '使用当前位置', locating: '正在定位…', mapPick: '地图选点', originTag: '已选起点', eligibleTag: '可规划',
    myLocationName: '我的位置', orchardHeading: '按水果主题推荐的园子', dateLabel: '出游日期', durationHeading: '停留时长', prefHeading: '体验偏好（可多选）',
    familyHint: '带娃出行：已自动预选「田园观光」和「拍照记录」，可再调整。',
    budgetNote: '预算只作规划参考；交通、餐饮等未知费用会在行程页如实标注。',
    locateFail: '暂时没有拿到有效位置，请改用地图选点。', mapFail: '当前环境不支持地图选点，请使用当前位置。',
    failHeading: '这条组合暂时排不出来：换一天、挪一挪起点，或放宽预算后再试。'
  },
  en: {
    title: 'Craft your trip', subtitle: 'Seven small questions, one fruit-scented route',
    titles: ['Which fruit culture speaks to you?', 'Where from, and which orchard?', 'Which day, and how long?', 'How many travellers?', 'What would you like to do?', 'Budget per person?', 'Review and craft the trip'],
    subs: ['Pick a fruit card, follow its seasonal story', 'Location is read once, only when you tap', 'Daylight hours are planned; set day and pace', 'Party size shapes the experience', 'Multi-select; the route follows your picks', 'For reference only; unknown costs stay honest', 'Fine-tune on the trip page afterwards'],
    prev: 'Back', next: 'Next', generate: 'Craft the trip', generating: 'Crafting…',
    useLocation: 'Use current location', locating: 'Locating…', mapPick: 'Pick on map', originTag: 'Start set', eligibleTag: 'On the route',
    myLocationName: 'My location', orchardHeading: 'Orchards for this fruit', dateLabel: 'Date', durationHeading: 'Duration', prefHeading: 'Experiences (multi-select)',
    familyHint: 'With kids: sightseeing and photo notes are preselected.',
    budgetNote: 'For reference only; unknown costs are disclosed on the trip page.',
    locateFail: 'No valid location right now; please pick on the map.', mapFail: 'Map picking is unavailable here; use current location.',
    failHeading: 'No plan fits yet: try another day, move the start, or loosen the budget.'
  }
};
Page({
  data: { step: 1, en: false, T: {}, fontClass: 'fs-normal', wizard: {}, progress: [], progressText: '', stepTitle: '', stepSub: '', canNext: false, fruitCards: [], orchardOptions: [], durationOptions: [], peopleOptions: [], preferenceOptions: [], budgetOptions: [], startPointLabel: '', locating: false, dateMin: '', summaryRows: [], familyHint: false, generating: false, error: '' },
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  onLoad: function () {
    const en = i18n.getLang() === 'en';
    const saved = lib.loadWizard();
    const today = lib.isoDate(0);
    if (!saved.date || saved.date < today) saved.date = lib.isoDate(3);
    // 起点为空时先沿用当前资料的已核实起点（继续用不必重新定位）。
    if (!saved.startPoint) { const origin = store.getProfile().origin; if (geo.validOrigin(origin)) saved.startPoint = { name: origin.name, address: origin.address || '', latitude: origin.latitude, longitude: origin.longitude, coordinateSystem: 'gcj02', source: 'user' }; }
    this.setData({ en, T: COPY[en ? 'en' : 'zh'], dateMin: today, step: 1 });
    this.refresh(saved);
  },
  refresh: function (wizardState) {
    lib.saveWizard(wizardState); // 每次选择即落盘，中途离开也不丢
    const w = lib.normalizeWizard(wizardState);
    const en = this.data.en, T = this.data.T, step = this.data.step, season = store.getProfile().season;
    this.setData({
      wizard: w, error: '',
      progress: [1, 2, 3, 4, 5, 6, 7].map(n => ({ n: n, state: n < step ? 'done' : n === step ? 'now' : 'todo' })),
      // 进度文案在逻辑层拼好再 setData（data 里不放函数，避免渲染层序列化告警）。
      progressText: (en ? 'Step ' + step + ' / 7' : '第 ' + step + ' / 7 步'),
      stepTitle: T.titles[step - 1], stepSub: T.subs[step - 1],
      canNext: step < 7 && lib.stepValid(w, step),
      fruitCards: lib.fruitCards(season, en, w.fruitTheme),
      orchardOptions: lib.matchedOrchards(w.fruitTheme, season).map(item => Object.assign({}, item, { selected: item.name === w.orchard })),
      durationOptions: lib.decorate(lib.OPTIONS.durations, w.duration, en),
      peopleOptions: lib.decorate(lib.OPTIONS.people, w.peopleCount, en),
      preferenceOptions: lib.decorate(lib.OPTIONS.preferences, '', en).map(item => Object.assign({}, item, { selected: w.preferences.indexOf(item.id) !== -1 })),
      budgetOptions: lib.decorate(lib.OPTIONS.budgets, w.budget, en),
      startPointLabel: w.startPoint ? w.startPoint.name : '', familyHint: w.peopleCount === 'family',
      summaryRows: lib.summaryRows(w, en)
    });
  },
  update: function (patch) { this.refresh(Object.assign({}, this.data.wizard, patch)); },
  prevStep: function () { if (this.data.step > 1) { this.setData({ step: this.data.step - 1 }); this.refresh(this.data.wizard); } },
  nextStep: function () { if (this.data.canNext) { this.setData({ step: this.data.step + 1 }); this.refresh(this.data.wizard); } },
  onFruit: function (event) {
    const name = event.currentTarget.dataset.name, patch = { fruitTheme: name };
    // 换水果后推荐园子会变：原选园子不在新清单里就清空，请用户重选。
    if (this.data.wizard.orchard && !lib.matchedOrchards(name, store.getProfile().season).some(item => item.name === this.data.wizard.orchard)) patch.orchard = '';
    this.update(patch);
  },
  // 【使用当前位置】只在用户主动点击时读取一次坐标（wx.getLocation，gcj02）。
  useLocation: function () {
    if (this.data.locating || typeof wx.getLocation !== 'function') return;
    const page = this;
    this.setData({ locating: true });
    const finish = function (origin, failMessage) { page.setData({ locating: false }); if (origin) page.update({ startPoint: origin }); else if (failMessage) page.setData({ error: failMessage }); };
    try {
      wx.getLocation({ type: 'gcj02', isHighAccuracy: false,
        success: function (location) {
          const origin = { name: page.data.T.myLocationName, address: '', latitude: location.latitude, longitude: location.longitude, coordinateSystem: 'gcj02', source: 'user' };
          if (geo.validOrigin(origin)) finish(origin, ''); else finish(null, page.data.T.locateFail);
        }, fail: function (error) { finish(null, geo.locationFailure(error).message); } });
    } catch (error) { finish(null, page.data.T.locateFail); }
  },
  chooseMapPoint: function () {
    if (typeof wx.chooseLocation !== 'function') { this.setData({ error: this.data.T.mapFail }); return; }
    const page = this;
    try {
      wx.chooseLocation({ success: function (location) {
        if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
        page.update({ startPoint: { name: location.name || page.data.T.myLocationName, address: location.address || '', latitude: location.latitude, longitude: location.longitude, coordinateSystem: 'gcj02', source: 'user' } });
      }, fail: function () { /* 用户取消选点，保持原状 */ } });
    } catch (error) { this.setData({ error: this.data.T.mapFail }); }
  },
  pickOrchard: function (event) { this.update({ orchard: event.currentTarget.dataset.name }); },
  onDateChange: function (event) { if (/^\d{4}-\d{2}-\d{2}$/.test(event.detail.value || '')) this.update({ date: event.detail.value }); },
  pickDuration: function (event) { this.update({ duration: event.currentTarget.dataset.id }); },
  pickPeople: function (event) { this.refresh(lib.applyPeopleEffect(this.data.wizard, event.currentTarget.dataset.id)); },
  togglePreference: function (event) {
    const id = event.currentTarget.dataset.id, list = this.data.wizard.preferences.slice(), at = list.indexOf(id);
    if (at === -1) list.push(id); else list.splice(at, 1);
    this.update({ preferences: list });
  },
  pickBudget: function (event) { this.update({ budget: event.currentTarget.dataset.id }); },
  generate: function () {
    if (this.data.generating) return;
    this.setData({ generating: true, error: '' });
    let result;
    try { result = lib.buildRoute(this.data.wizard); } catch (error) { result = { ok: false, reason: error.message }; }
    if (!result.ok) { this.setData({ generating: false, error: result.reason ? this.data.T.failHeading + '（' + result.reason + '）' : this.data.T.failHeading }); return; }
    this.setData({ generating: false });
    wx.redirectTo({ url: '/packageMore/route-detail/route-detail', fail: () => wx.navigateTo({ url: '/packageMore/route-detail/route-detail' }) });
  },
  noop: function () {}
});
