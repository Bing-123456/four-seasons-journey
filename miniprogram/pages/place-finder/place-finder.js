'use strict';

// 个性档案：三道选择题 → 果灵生成虚拟文旅推荐地（仅展示，不跳详情）。
// 文字与配图分阶段生成；失败明确提示，任务可在返回页面后恢复。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const bookingService = require('../../lib/booking-service');

// title/label 均为 [中文, English]；界面按当前语言取值，提交仍用 id。
const QUESTIONS = [
  {
    id: 'fruits', title: ['你喜欢哪些水果？', 'Which fruits do you like?'], multi: true,
    options: [
      { id: '青梅', label: ['青梅', 'Green plum'], group: 'season_spring' }, { id: '枇杷', label: ['枇杷', 'Loquat'], group: 'season_spring' }, { id: '桑葚', label: ['桑葚', 'Mulberry'], group: 'season_spring' },
      { id: '西瓜', label: ['西瓜', 'Watermelon'], group: 'season_summer' }, { id: '李子', label: ['李子', 'Plum'], group: 'season_summer' }, { id: '桃子', label: ['桃子', 'Peach'], group: 'season_summer' },
      { id: '柿子', label: ['柿子', 'Persimmon'], group: 'season_autumn' }, { id: '石榴', label: ['石榴', 'Pomegranate'], group: 'season_autumn' }, { id: '秋梨', label: ['秋梨', 'Autumn pear'], group: 'season_autumn' },
      { id: '冬枣', label: ['冬枣', 'Winter jujube'], group: 'season_winter' }, { id: '瓯柑', label: ['瓯柑', 'Ou mandarin'], group: 'season_winter' }, { id: '砂糖橘', label: ['砂糖橘', 'Sugar tangerine'], group: 'season_winter' }
    ]
  },
  {
    id: 'activity', title: ['你想怎么玩？', 'How do you want to play?'], multi: false,
    options: [
      { id: 'pick', label: ['自己动手采摘', 'Pick by myself'] },
      { id: 'photo', label: ['果园观光拍照', 'Orchard sightseeing & photos'] },
      { id: 'taste', label: ['现场品尝', 'Taste on site'] }
    ]
  },
];

// 评审 9.28④：删掉「你什么时候去？」第三题——用户选「下个月」时所选水果未必应季，
// 这一题无法兑现承诺。服务端契约保留 timing 字段，固定提交 'unset'，
// 果期信息改由「常见果期」给出，不再承诺具体月份有果。
function localizedQuestions(answers = {}) {
  const lang = i18n.getLang() === 'en' ? 1 : 0;
  const pick = value => Array.isArray(value) ? value[lang] : value;
  return QUESTIONS.map(question => Object.assign({}, question, {
    title: pick(question.title),
    options: question.options.map(option => Object.assign({}, option, { label: pick(option.label), group: option.group ? i18n.t(option.group) : '', selected: (answers[question.id] || []).includes(option.id) }))
  }));
}

const STORAGE_KEY = 'guayouji.place-recommend.v1.';
const ACTIVE = ['queued', 'generating-text', 'generating-images'];
const COPY = {
  virtual: ['AI 虚拟灵感 · 非真实可预约地点', 'AI travel ideas · fictional places'],
  seasonal: ['按常见露天果期估算，地区、品种和天气会有差异。', 'Typical outdoor harvest windows vary by location, cultivar and weather.'],
  needAll: ['请完成水果和玩法两道题', 'Please answer both questions'],
  reset: ['重置选择', 'Reset selections'],
  connect: ['请先连接 AI 服务后再生成', 'Connect the AI service to generate ideas'],
  demo: ['演示模式不调用云端 AI，请退出演示后生成', 'Leave demo mode to generate with cloud AI'],
  disabled: ['AI 功能已关闭，请在设置中开启', 'Turn on AI in Settings first'],
  textBusy: ['果灵正在构思推荐地…', 'Creating your travel ideas…'],
  imageBusy: ['推荐已生成，插画陆续完成中…', 'Ideas are ready. Illustrations are being created…'],
  imageWait: ['插画生成中', 'Creating illustration'],
  imageFail: ['插画未生成', 'Illustration unavailable'],
  retry: ['重试配图', 'Retry image'],
  refresh: ['继续查询', 'Check again'],
  failure: ['推荐生成未完成，请重试', 'Generation did not complete. Try again.'],
  local: ['云端未就绪 · 已按素材库生成 3 个虚拟灵感地（非真实地点）', 'Cloud unavailable · 3 fictional ideas from the local library'],
  localIdea: ['本地灵感 · 虚拟地点', 'Local idea · fictional'],
  network: ['连接中断，任务已保留，可继续查询', 'Connection interrupted. Your task is saved.'],
  expired: ['上次任务已过期，请重新生成', 'Your last task expired. Generate again.'],
  ready: ['配图未完成时，可单独重试。', 'You can retry any unfinished illustration.'],
  noDate: ['果期规划 · 时间待定', 'Seasonal planning · date undecided'],
  offSeason: ['非采收期 · 观赏或加工体验', 'Outside harvest · views or preserves'],
  inSeason: ['常见果期内 · 创意体验', 'Typical harvest window · travel idea'],
  harvest: ['常见果期', 'Typical harvest'],
  illustration: ['插画 · 非实景', 'Illustration'],
  download: ['插画加载失败', 'Illustration could not load']
};
function copy(key) { return COPY[key][i18n.getLang() === 'en' ? 1 : 0]; }

// 评审 9.28③：「常见果期 3 / 4」用户看不懂 → 改为自然语言区间（3 月至 4 月；不连续用顿号）。
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthRangeText(months) {
  const sorted = [...new Set(months || [])].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const runs = [];
  for (const month of sorted) {
    const last = runs[runs.length - 1];
    if (last && month === last[last.length - 1] + 1) last.push(month); else runs.push([month]);
  }
  const english = i18n.getLang() === 'en';
  return runs.map(run => english
    ? (run.length >= 2 ? EN_MONTHS[run[0] - 1] + '-' + EN_MONTHS[run[run.length - 1] - 1] : EN_MONTHS[run[0] - 1])
    : (run.length >= 2 ? run[0] + ' 月至 ' + run[run.length - 1] + ' 月' : run[0] + ' 月')).join(english ? ', ' : '、');
}
function monthsTextOf(months) { return copy('harvest') + (i18n.getLang() === 'en' ? ': ' : '：') + monthRangeText(months); }

// 评审 9.28②：本地灵感地配「所选水果」的果物插画作主题图（角标注明插画 · 非实景）。
const ART_BY_NAME = {};
require('../../data/fruit-culture').seasons.forEach(season => {
  require('../../data/fruit-culture').seasonFruits(season).forEach(fruit => {
    if (!(fruit.name in ART_BY_NAME)) ART_BY_NAME[fruit.name] = '/assets/fruit-art/' + season.id + '-' + fruit.id + '.jpg';
  });
});
function sameCloud(a, b) { return !!a && a.apiBase === b.apiBase && a.token === b.token; }
function storageKey() { return STORAGE_KEY + (store.isDemoMode() ? 'demo' : 'personal'); }
function labels() {
  const result = i18n.labels(['place_gen_btn', 'place_gen_busy', 'place_result_title', 'id_bag_title', 'id_bag_sub', 'finder_multi', 'finder_toast_fruit']);
  Object.keys(COPY).forEach(key => { result[key] = copy(key); });
  return result;
}
function loadRecord(key) { try { return wx.getStorageSync(key) || {}; } catch (_) { return {}; } }
function requestId() { return 'finder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }

// 本地兜底素材池：云端未就绪/生成失败时的确定性虚拟灵感地（结果仍为虚构，结果区横幅已注明）。
// 9.27 反馈：演示或离线场景下点「一键生成推荐地」不再死路，直接给出可看的本地结果。
const LOCAL_PLACES = [
  { name: '云溪梅岭农庄', fruits: ['青梅'], harvestMonths: [3, 4], intro: '丘陵梅园连片，青梅露、腌梅手作台常年开放。' },
  { name: '金沙湾枇杷园', fruits: ['枇杷'], harvestMonths: [5, 6], intro: '沿河枇杷长廊，白沙枇杷现摘现称。' },
  { name: '桑干河畔桑葚园', fruits: ['桑葚'], harvestMonths: [5, 6], intro: '老桑树采撷区，紫白两色桑葚分垄而栽。' },
  { name: '沙窝西瓜大棚基地', fruits: ['西瓜'], harvestMonths: [6, 7, 8], intro: '沙地吊蔓西瓜，现场开瓜试吃。' },
  { name: '伏牛山李子坡果园', fruits: ['李子'], harvestMonths: [7, 8], intro: '坡地李园步道完善，脆李分批成熟。' },
  { name: '桃园溪谷农场', fruits: ['桃子'], harvestMonths: [6, 7, 8], intro: '水蜜桃与蟠桃分区，林下有野餐桌。' },
  { name: '柿柿如意观光园', fruits: ['柿子'], harvestMonths: [9, 10], intro: '百年柿林挂果如灯，摘柿与晒柿饼体验都有。' },
  { name: '红石峡石榴庄园', fruits: ['石榴'], harvestMonths: [9, 10], intro: '软籽石榴庄园，开果品籽台面对着山谷。' },
  { name: '秋梨小镇采摘园', fruits: ['秋梨'], harvestMonths: [9, 10, 11], intro: '老梨树群配仓储窖，梨膏现熬。' },
  { name: '枣乡人家农场', fruits: ['冬枣'], harvestMonths: [10, 11], intro: '大棚冬枣脆甜，垄间可以边摘边尝。' },
  { name: '瓯江柑橘观景园', fruits: ['瓯柑', '砂糖橘'], harvestMonths: [11, 12, 1], intro: '山坡柑橘梯田，观景台可俯瞰江景。' }
];
const ACTIVITY_LINES = {
  pick: '支持预约下园自采，工具由园方提供。',
  photo: '园区设有拍照点，花期果季都适合取景。',
  taste: '现场品尝为主，果汁与深加工小食现做。'
};
function localPlaces(answers) {
  const wanted = answers.fruits || [];
  const activity = (answers.activity || [])[0] || 'pick';
  // 评审 9.28①：推荐地必须与所选水果一致——只返回经营所选水果的灵感地，不再用无关地点凑满三个。
  return LOCAL_PLACES
    .filter(place => (place.fruits || []).some(fruit => wanted.indexOf(fruit) !== -1))
    .map(place => {
      const fruit = (place.fruits || []).find(name => wanted.indexOf(name) !== -1) || place.fruits[0];
      const item = {
        id: 'local-' + LOCAL_PLACES.indexOf(place),
        name: place.name,
        intro: place.intro + ACTIVITY_LINES[activity],
        image: ART_BY_NAME[fruit] || '',
        local: true,
        month: null,
        year: new Date().getFullYear(),
        harvestMonths: place.harvestMonths
      };
      item.seasonText = copy('noDate');
      item.monthsText = monthsTextOf(place.harvestMonths);
      return item;
    });
}
// A non-secret identity hint for local restoration. Server ownership is always
// checked using the complete, server-issued capability, never this hint.
function identityHint(value) {
  if (!value) return '';
  let a = 2166136261, b = 3339675911;
  for (let index = 0; index < value.length; index += 1) { a = Math.imul(a ^ value.charCodeAt(index), 16777619); b = Math.imul(b ^ value.charCodeAt(index), 2246822519); }
  return (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
}

Page({
  data: { questions: [], answers: {}, busy: false, note: '', places: [], companion: null, taskId: '', taskStatus: '', canResume: false, L: {} },
  onLoad: function () {
    i18n.applyNav('nav_finder');
    this._key = storageKey(); this._visible = true; this._epoch = (this._epoch || 0) + 1; this._cloud = store.getCloudConnection();
    const saved = loadRecord(this._key);
    this._saved = saved.apiBase === this._cloud.apiBase ? saved : {};
    if (this._saved.ownerHint !== identityHint(bookingService.getCredential('visitor'))) this._saved = Object.assign({}, this._saved, { taskId: '', requestId: '', submittedBody: null });
    const answers = this._saved.answers || {};
    this.setData({ companion: store.getCompanion(), questions: localizedQuestions(answers), answers, L: labels(), taskId: this._saved.taskId || '' });
  },
  onShow: function () {
    if (this._key !== storageKey() || !sameCloud(this._cloud, store.getCloudConnection())) { this.stopPolling(); this.onLoad(); this.setData({ places: [], busy: false, note: '', canResume: false }); }
    this._visible = true;
    this.setData({ companion: store.getCompanion(), L: labels(), questions: localizedQuestions(this.data.answers) });
    if (this.data.taskId && !this._requesting) this.resume();
  },
  onHide: function () { this.stopPolling(); },
  onUnload: function () { this.stopPolling(); },
  stopPolling: function () { this._visible = false; this._epoch += 1; clearTimeout(this._timer); this._requesting = false; },
  persist: function (patch) {
    if (this._key !== storageKey() || !sameCloud(this._cloud, store.getCloudConnection())) return;
    this._saved = Object.assign({}, this._saved, patch, { answers: this.data.answers, apiBase: this._cloud.apiBase });
    try { wx.setStorageSync(this._key, this._saved); } catch (_) { /* A storage failure does not discard the visible result. */ }
  },
  toggleOption: function (event) {
    if (this.data.busy) return;
    const qid = event.currentTarget.dataset.qid, oid = event.currentTarget.dataset.oid;
    const question = this.data.questions.find(item => item.id === qid);
    if (!question || !question.options.some(option => option.id === oid)) return;
    const answers = Object.assign({}, this.data.answers);
    const current = answers[qid] || [];
    answers[qid] = question.multi ? (current.includes(oid) ? current.filter(item => item !== oid) : current.concat(oid)) : [oid];
    this.setData({ answers, questions: localizedQuestions(answers) });
    this.persist({ requestId: '', submittedBody: null });
  },
  isChecked: function (qid, oid) { return (this.data.answers[qid] || []).includes(oid); },
  // 重置选择条件：三题恢复未选，结果列表回到未生成状态（本地任务记录一并清空）。
  resetAnswers: function () {
    if (this.data.busy) return;
    this.setData({ answers: {}, questions: localizedQuestions({}), places: [], note: '', taskId: '', taskStatus: '', canResume: false });
    this.persist({ requestId: '', submittedBody: null, taskId: '', expiresAt: 0 });
  },
  connection: function () {
    const settings = store.getSettings(), cloud = store.getCloudConnection(), token = cloud.token;
    if (this._key !== storageKey() || !sameCloud(this._cloud, cloud)) { this.stopPolling(); this.onLoad(); this.setData({ places: [], busy: false, note: '', canResume: false }); }
    if (!settings.useAI) { this.setData({ note: copy('disabled'), busy: false }); return null; }
    if (!token) { this.setData({ note: copy('connect'), busy: false }); return null; }
    return { settings, token, apiBase: cloud.apiBase };
  },
  generate: function () {
    if (this.data.busy || this._requesting) return;
    const answers = this.data.answers;
    if (!answers.fruits || !answers.fruits.length || !(answers.activity || []).length) { wx.showToast({ title: copy('needAll'), icon: 'none' }); return; }
    if (!this.connection()) { this.showLocalPlaces(); return; }
    const body = { fruits: answers.fruits, activity: answers.activity[0], timing: 'unset' };
    // Reuse a submission ID after a lost HTTP response instead of purchasing the same generation twice.
    body.requestId = this._saved.submittedBody === JSON.stringify(body) && this._saved.requestId ? this._saved.requestId : requestId();
    this.persist({ requestId: body.requestId, submittedBody: JSON.stringify({ fruits: body.fruits, activity: body.activity, timing: body.timing }), taskId: '', expiresAt: 0 });
    this.setData({ busy: true, note: copy('textBusy'), places: [], taskId: '', taskStatus: 'queued', canResume: false });
    this.api('/api/place-recommend', 'POST', body, data => this.receive(data));
  },
  api: function (path, method, body, complete) {
    const connection = this.connection(); if (!connection) return;
    const epoch = this._epoch;
    this._requesting = true;
    bookingService.ensureClient('visitor', { allowDemoIdentity: true }).then(credential => {
      if (epoch !== this._epoch || !this._visible || this._key !== storageKey() || !sameCloud(connection, store.getCloudConnection())) return;
      const hint = identityHint(credential);
      if (this._saved.ownerHint && this._saved.ownerHint !== hint && path !== '/api/place-recommend') { this._requesting = false; this.persist({ taskId: '', requestId: '', ownerHint: hint }); this.setData({ taskId: '', places: [], busy: false, note: copy('expired'), canResume: false }); return; }
      this.persist({ ownerHint: hint });
      wx.request({
      url: connection.apiBase + path, method, timeout: 20000, data: body,
      header: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json', 'X-Booking-Client': credential },
      success: response => {
        if (epoch !== this._epoch || !this._visible || this._key !== storageKey() || !sameCloud(connection, store.getCloudConnection())) return;
        this._requesting = false;
        const data = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && data.taskId) { complete(data); return; }
        if (response.statusCode === 404) { this.persist({ taskId: '', requestId: '', expiresAt: 0 }); this.setData({ busy: false, taskId: '', note: copy('expired'), canResume: false }); return; }
        if (!this.data.places.length) { this.showLocalPlaces(); return; }
        this.setData({ busy: false, note: copy('failure'), canResume: !!this.data.taskId });
      },
      fail: () => { if (epoch !== this._epoch || !this._visible || !sameCloud(connection, store.getCloudConnection())) return; this._requesting = false; if (!this.data.places.length) { this.showLocalPlaces(); return; } this.setData({ busy: false, note: copy('network'), canResume: !!this.data.taskId }); }
      });
    }).catch(() => { if (epoch !== this._epoch || !this._visible || !sameCloud(connection, store.getCloudConnection())) return; this._requesting = false; if (!this.data.places.length) { this.showLocalPlaces(); return; } this.setData({ busy: false, note: copy('network'), canResume: !!this.data.taskId }); });
  },
  // 云端不可用时的本地兜底：给出确定性虚拟灵感地（非真实地点），不再死路报错。
  showLocalPlaces: function () {
    clearTimeout(this._timer);
    this._requesting = false;
    const places = localPlaces(this.data.answers);
    this.persist({ taskId: '', requestId: '', submittedBody: null, expiresAt: 0 });
    this.setData({ busy: false, places, taskId: '', taskStatus: 'succeeded', canResume: false, note: copy('local') });
  },
  receive: function (result) {
    if (!Array.isArray(result.places) || !['queued', 'generating-text', 'generating-images', 'succeeded', 'partial', 'failed'].includes(result.status)) { this.setData({ busy: false, note: copy('failure'), canResume: !!this.data.taskId }); return; }
    const apiBase = this._cloud.apiBase;
    const places = result.places.map(place => Object.assign({}, place, {
      image: place.image && /^\/artifacts\/[a-z0-9-]+\.png$/.test(place.image) ? apiBase + place.image : '',
      seasonText: (place.month ? place.year + '.' + String(place.month).padStart(2, '0') + ' · ' : '') + copy(place.month === null ? 'noDate' : place.inSeason ? 'inSeason' : 'offSeason'),
      monthsText: monthsTextOf(place.harvestMonths)
    }));
    const busy = ACTIVE.includes(result.status);
    this.persist({ taskId: result.taskId, expiresAt: result.expiresAt });
    if (['failed', 'partial', 'succeeded'].includes(result.status)) this.persist({ requestId: '', submittedBody: null });
    this.setData({ taskId: result.taskId, taskStatus: result.status, busy, places, canResume: false, note: result.status === 'generating-images' ? copy('imageBusy') : busy ? copy('textBusy') : result.status === 'failed' ? copy('failure') : result.status === 'partial' ? copy('ready') : '' });
    clearTimeout(this._timer);
    if (busy && this._visible) this._timer = setTimeout(() => this.resume(), 3000);
  },
  resume: function () {
    if (!this._visible || this._requesting || !this.data.taskId) return;
    if (this._saved.expiresAt && this._saved.expiresAt <= Date.now()) { this.persist({ taskId: '', requestId: '', expiresAt: 0 }); this.setData({ taskId: '', busy: false, note: copy('expired'), canResume: false }); return; }
    this.setData({ busy: true, canResume: false });
    this.api('/api/place-recommend/' + this.data.taskId, 'GET', undefined, data => this.receive(data));
  },
  imageError: function (event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ places: this.data.places.map(place => place.id === id ? Object.assign({}, place, { downloadFailed: true }) : place) });
  },
  retryImage: function (event) {
    const id = event.currentTarget.dataset.id, place = this.data.places.find(item => item.id === id);
    if (!place || this._requesting) return;
    if (place.downloadFailed && place.image) { this.setData({ places: this.data.places.map(item => item.id === id ? Object.assign({}, item, { image: item.image.split('?')[0] + '?reload=' + Date.now(), downloadFailed: false }) : item) }); return; }
    if (place.imageStatus !== 'failed') return;
    this.api('/api/place-recommend/' + this.data.taskId + '/retry', 'POST', { placeId: id }, data => this.receive(data));
  },
  noop: function () {}
});
