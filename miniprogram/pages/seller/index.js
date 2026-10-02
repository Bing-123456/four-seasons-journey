'use strict';
const repository = require('../../lib/seller-store');
const core = require('../../lib/seller-core');
const weather = require('../../lib/weather');
const booking = require('../../lib/booking-service');
const store = require('../../lib/store');
const service = require('../../lib/service');
const i18n = require('../../lib/i18n');
const t = key => i18n.dict[key] ? i18n.dict[key][0] : key;
const labels = () => Object.keys(i18n.dict).filter(key => key.indexOf('sl_') === 0).reduce((out, key) => { out[key] = t(key); return out; }, {});
// 果农界面底部两个分区：左「AI预测」右「我的」；每个分区内保留工作区子标签。
const SECTIONS = {
  ai: { key: 'sl_section_ai', tabs: ['sl_tab_risk', 'sl_tab_plan'] },
  mine: { key: 'sl_section_mine', tabs: ['sl_tab_batch', 'sl_tab_ledger', 'sl_tab_exec'] }
};
const EVT_KEYS = { harvest: 'sl_evt_harvest', sale: 'sl_evt_sale', order: 'sl_evt_order', fulfill: 'sl_evt_fulfill', cancel: 'sl_evt_cancel', return: 'sl_evt_return', loss: 'sl_evt_loss', close: 'sl_evt_close' };
const RISK_KEYS = { insufficient: 'sl_risk_status_insufficient', clear: 'sl_risk_status_clear', attention: 'sl_risk_status_attention', urgent: 'sl_risk_status_urgent' };
const UNIT_KEYS = { kg: 'sl_unit_kg', jin: 'sl_unit_jin', ton: 'sl_unit_ton' };
const quantities = [{ id: 'kg' }, { id: 'jin' }, { id: 'ton' }];
function displayUnits() { return quantities.map(item => ({ id: item.id, label: t(UNIT_KEYS[item.id]) })); }
function displayEventTypes() { return core.EVENT_TYPES.map(item => ({ id: item.id, label: t(EVT_KEYS[item.id]) })); }
function displayTabs(section) { return SECTIONS[section].tabs.map(key => t(key)); }
function initialForm() { const today = core.today(); return { variety: '', matureDate: core.addDays(today, 6), growthNote: '', yieldTotal: '', receptionStart: today, receptionEnd: core.addDays(today, 6) }; }
Page({
  data: { advanced: false, activityFormVisible: false, activityBusy: false, bookingBusy: false, bookingError: '', publishedActivities: [], activityForm: {}, section: 'mine', tabs: [], tab: 0, quantities: [],
    weatherView: { available: false, label: '' }, tourismView: null, insight: null, insightBusy: false, insightMode: '', eventTypes: [], error: '', simulated: false, batches: [], selectedId: '', selected: null, risk: null, riskLabel: '', book: null, showForm: false, editing: false, form: initialForm(), events: [], plans: [], feedback: [], eventForm: { type: 0, date: core.today(), quantity: '', unit: 0, refId: '', note: '' }, referenceOptions: [], referenceIndex: 0, feedbackForm: { intentCount: '0', actualCost: '0', note: '' }, planIndex: 0, busy: false, L: {} },
  onLoad: function () { if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '果农工作台' }); this._partition = repository.capturePartition(); this._eventSubmissionId = null; this._feedbackSubmissionId = null; this._closed = false;
    this.setData({ L: labels(), tabs: displayTabs('mine'), quantities: displayUnits(), eventTypes: displayEventTypes(), form: initialForm(), 'eventForm.date': core.today() });
    this.refresh(); },
  onUnload: function () { this._closed = true; },
  chooseSection: function (event) {
    const section = event.currentTarget.dataset.section;
    if (section === this.data.section) return;
    this.setData({ section: section, tabs: displayTabs(section), tab: 0, error: '' });
    if (section === 'ai') this.loadSignals();
    this.loadBookings();
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 if (!this._partition) return; if (repository.capturePartition() !== this._partition) { this._partition = repository.capturePartition(); this._eventSubmissionId = null; this._feedbackSubmissionId = null; this._batchSubmissionId = null; this.setData({ selectedId: '', showForm: false, publishedActivities: [], bookingError: '', bookingBusy: false, activityFormVisible: false, activityBusy: false, activityForm: {}, insight: null, insightBusy: false, form: initialForm(), eventForm: { type: 0, date: core.today(), quantity: '', unit: 0, refId: '', note: '' }, feedbackForm: { intentCount: '0', actualCost: '0', note: '' }, weatherView: { available: false, label: '' }, tourismView: null, error: '' }); } this.refresh(); if (booking.getCredential('seller')) this.loadBookings(); },
  guard: function () { if (repository.capturePartition() !== this._partition) { this.onShow(); throw new Error('账户已切换，请在当前账户重新操作'); } },
  attempt: function (fn) { try { this.guard(); this.setData({ error: '' }); return fn(); } catch (error) { this.setData({ error: error.message || '操作未完成，请重试' }); return null; } },
  refresh: function () {
    try {
      const state = repository.read(this._partition); const selected = state.batches.find(item => item.id === this.data.selectedId) || state.batches[0] || null;
      const risk = selected ? repository.assess(selected.id, this._partition) : null;
      const fresh = repository.read(this._partition); const events = selected ? fresh.events.filter(event => event.batchId === selected.id).map(event => Object.assign({}, event, { label: t(EVT_KEYS[core.EVENT_TYPES.find(type => type.id === event.type).id]) })).reverse() : [];
      const plans = selected ? fresh.plans.filter(plan => plan.batchId === selected.id).reverse() : [];
      this.setData({ simulated: this._partition === 'demo', batches: fresh.batches.map(batch => Object.assign({}, batch, { regionLabel: batch.region.join(' · ') })), selectedId: selected ? selected.id : '', selected, risk, riskLabel: risk ? t(RISK_KEYS[risk.status]) : '', book: selected ? core.ledger(selected, fresh.events) : null, events, plans, feedback: selected ? fresh.feedback.filter(item => item.batchId === selected.id).reverse() : [], planIndex: Math.max(0, Math.min(this.data.planIndex, plans.length - 1)) });
      this.updateReferences();
      if (this.data.section === 'ai') this.loadSignals();
    } catch (error) { this.setData({ error: error.message || '本机数据暂不可用' }); }
  },
  chooseTab: function (event) { this.setData({ tab: Number(event.currentTarget.dataset.index), error: '' }); },

  // ---- AI预测信号：虚拟演示天气与人流量（评审口径），解读以这两项为固定输入 ----
  loadSignals: function () {
    const selected = this.data.selected;
    if (!selected) { this.setData({ weatherView: { available: false, label: '' }, tourismView: null }); return; }
    // 虚拟演示信号：不再请求真实公开气象，也不展示「未知/正在获取」的真实获取态。
    const reception = selected.reception || {};
    const window = { start: reception.startDate || selected.harvestStart, end: reception.endDate || selected.deadline };
    this.setData({ weatherView: weather.virtualSummary(window), tourismView: weather.virtualTourism() });
  },
  insightPayload: function () {
    const batch = this.data.selected; const risk = this.data.risk;
    return {
      batch: { id: batch.id, name: batch.name, crop: batch.crop, variety: batch.variety || '', region: batch.region, areaMu: batch.areaMu, harvestStart: batch.harvestStart, harvestEnd: batch.harvestEnd, deadline: batch.deadline, matureDate: batch.matureDate || batch.deadline, growthNote: batch.growthNote || '', reception: { enabled: batch.reception.enabled, capacity: batch.reception.capacity, staff: batch.reception.staff } },
      risk: { status: risk.status, label: risk.label, windowDays: risk.windowDays, remainingKg: risk.remainingKg || 0, supplyKg: risk.supplyKg, expectedSalesKg: risk.expectedSalesKg, pendingKg: risk.pendingKg },
      weather: { available: !!this.data.weatherView.available, label: this.data.weatherView.label || '', rainDays: this.data.weatherView.rainDays == null ? null : this.data.weatherView.rainDays, windowRainDays: this.data.weatherView.windowRainDays == null ? null : this.data.weatherView.windowRainDays },
      tourism: { available: !!(this.data.tourismView && this.data.tourismView.available), virtual: !!(this.data.tourismView && this.data.tourismView.virtual), totalTrips: this.data.tourismView && this.data.tourismView.totalTrips || 0, totalParties: this.data.tourismView && this.data.tourismView.totalParties || 0, top: [] },
      culture: [],
      limits: { maxCapacity: Math.max(1, (batch.reception.capacity || 1) * 8), maxBudget: Math.max(0, batch.reception.budget || 0) }
    };
  },
  localInsight: function (payload) {
    const risk = payload.risk;
    const parts = [];
    parts.push(risk.status === 'insufficient' ? t('sl_li_insufficient') : t(RISK_KEYS[risk.status]) + t('sl_li_risk_a') + risk.windowDays + t('sl_li_risk_b') + risk.remainingKg + t('sl_li_risk_c'));
    // 天气影响采收：晴天利于采收与到访，窗口内有雨则提示错开。
    parts.push(payload.weather.available ? t('sl_li_weather_a') + payload.weather.label + t('sl_li_weather_end') : t('sl_li_weather_none'));
    if (payload.weather.available && payload.weather.windowRainDays) parts.push(t('sl_li_sug_rain_a') + payload.weather.windowRainDays + t('sl_li_sug_rain_b') + '。');
    // 人流量影响滞销判断：按演示人流安排接待与现货，人流不等于实际销量。
    if (payload.tourism.available) parts.push('演示人流量：未来 7 天约 ' + payload.tourism.totalTrips + ' 组 ' + payload.tourism.totalParties + ' 人到访（虚拟数据），按人流与日期安排接待和现货备货。');
    else parts.push('人流量：暂无演示数据。');
    const suggestions = [];
    if (risk.status === 'urgent' || risk.status === 'attention') suggestions.push(t('sl_li_sug_split'));
    if (payload.tourism.totalTrips) suggestions.push('按演示人流高峰安排接待与人手，人流和预约不等于实际销量，需以台账核实。');
    suggestions.push(t('sl_li_sug_verify'));
    return { status: risk.status, reading: parts.join('').slice(0, 160), suggestions: suggestions.slice(0, 4), planTitle: t('sl_mode_local'), planSteps: [], capacity: null, budget: null, alternative: '', mode: 'local-rules' };
  },
  runInsight: function () {
    if (!this.data.selected || !this.data.risk || this.data.insightBusy) return;
    const payload = this.insightPayload();
    const selectedId = this.data.selectedId; const partition = this._partition;
    const page = this;
    this.setData({ insightBusy: true, error: '' });
    (this._partition === 'demo' || !store.getSettings().useAI ? Promise.resolve() : booking.ensureClient('seller')).then(() => service.sellerInsight(payload, () => this.localInsight(payload))).then(function (result) {
      if (repository.capturePartition() !== partition || page._partition !== partition || page.data.selectedId !== selectedId || page._closed) return;
      page.setData({ insight: result, insightMode: result.mode || 'openai-compatible', insightBusy: false });
      try {
        if (Array.isArray(result.planSteps) && result.planSteps.length) {
          repository.saveInsightPlan(page.data.selectedId, { planTitle: result.planTitle, reading: result.reading, suggestions: result.suggestions, planSteps: result.planSteps, capacity: result.capacity, budget: result.budget, alternative: result.alternative, status: result.status }, page._partition);
          page.refresh();
        }
      } catch (error) { /* 方案保存失败不影响解读展示 */ }
    }).catch(function (error) {
      if (page._closed || page._partition !== partition || page.data.selectedId !== selectedId) return;
      page.setData({ insightBusy: false, error: error.message || 'AI 解读未完成' });
    });
  },
  loadBookings: function () {
    const batchId = this.data.selectedId; const partition = this._partition;
    if (!batchId || partition === 'demo') { this.setData({ publishedActivities: [], bookingError: partition === 'demo' ? '演示账户不提交真实预约' : '' }); return Promise.resolve(); }
    this.setData({ bookingBusy: true, bookingError: '' });
    return booking.summary(batchId).then(result => { if (this._closed || this._partition !== partition || repository.capturePartition() !== partition || this.data.selectedId !== batchId) return; this.setData({ publishedActivities: result.activities, bookingBusy: false }); }).catch(error => { if (this._closed || this._partition !== partition || this.data.selectedId !== batchId) return; this.setData({ bookingBusy: false, bookingError: error.message }); });
  },
  openActivity: function (event) {
    if (!this.data.selected || this._partition === 'demo') { wx.showToast({ title: '请在个人账户发布真实活动', icon: 'none' }); return; }
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    const existing = this.data.publishedActivities.find(item => item.id === id); const batch = this.data.selected;
    const planId = event && event.currentTarget && event.currentTarget.dataset.plan;
    const plan = this.data.plans.find(item => item.id === planId);
    this._activityRequestId = booking.requestId();
    this.setData({ activityFormVisible: true, activityForm: existing ? Object.assign({}, existing, { published: true }) : { title: plan ? plan.title : batch.variety + '采摘体验', description: plan ? (plan.reading || plan.steps.join('；')).slice(0, 300) : batch.growthNote, location: batch.region.join(''), startDate: batch.reception.startDate || batch.harvestStart, endDate: batch.reception.endDate || batch.harvestEnd, capacityPerDay: '', published: true }, error: '' });
  },
  activityInput: function (event) { this.setData({ ['activityForm.' + event.currentTarget.dataset.field]: event.detail.value }); this._activityRequestId = booking.requestId(); },
  closeActivity: function () { if (!this.data.activityBusy) this.setData({ activityFormVisible: false }); },
  publishActivity: function () {
    if (this.data.activityBusy) return;
    const batchId = this.data.selectedId; const partition = this._partition; const form = this.data.activityForm;
    this.setData({ activityBusy: true, error: '' });
    return booking.publish(Object.assign({}, form, { batchId, requestId: this._activityRequestId, capacityPerDay: Number(form.capacityPerDay) })).then(() => { if (this._closed || this._partition !== partition || repository.capturePartition() !== partition || this.data.selectedId !== batchId) return; this.setData({ activityFormVisible: false }); return this.loadBookings(); }).catch(error => { if (!this._closed && this._partition === partition) this.setData({ error: error.message }); }).finally(() => { if (!this._closed && this._partition === partition) this.setData({ activityBusy: false }); });
  },
  unpublishActivity: function (event) {
    const activity = this.data.publishedActivities.find(item => item.id === event.currentTarget.dataset.id); if (!activity || this.data.activityBusy) return;
    const partition = this._partition; const selectedId = this.data.selectedId;
    const current = () => !this._closed && this._partition === partition && repository.capturePartition() === partition && this.data.selectedId === selectedId;
    this.setData({ activityBusy: true });
    return booking.publish(Object.assign({}, activity, { requestId: booking.requestId(), published: false })).then(() => { if (current()) return this.loadBookings(); }).catch(error => { if (current()) this.setData({ error: error.message }); }).finally(() => { if (current()) this.setData({ activityBusy: false }); });
  },
  selectBatch: function (event) { this._eventSubmissionId = null; this._feedbackSubmissionId = null; this.setData({ selectedId: event.currentTarget.dataset.id, publishedActivities: [], bookingBusy: false, insight: null, insightBusy: false, tourismView: null, error: '', eventForm: { type: 0, date: core.today(), quantity: '', unit: 0, refId: '', note: '' }, feedbackForm: { intentCount: '0', actualCost: '0', note: '' }, planIndex: 0 }); this.refresh(); this.loadBookings(); },
  toggleAdvanced: function () { this.setData({ advanced: !this.data.advanced, tab: 0 }); },
  enterVisitor: function () { store.saveIdentity({ role: 'tourist', roleChosen: true }); wx.switchTab({ url: '/pages/index/index' }); },
  newBatch: function () { this.setData({ showForm: true, editing: false, form: initialForm(), error: '' }); this._batchSubmissionId = repository.uniqueId('batch'); },
  editBatch: function () {
    const batch = this.data.selected; if (!batch) return;
    // 表单只保留 5 项：品种、预计成熟时间、生长概况、预估总产量、可采摘时间。
    this.setData({ showForm: true, editing: true, error: '', form: { variety: batch.variety || batch.crop, matureDate: batch.matureDate || batch.deadline, growthNote: batch.growthNote || '', yieldTotal: batch.yieldMaxKg === null || batch.yieldMaxKg === undefined ? '' : String(batch.yieldMaxKg), receptionStart: batch.reception.startDate || batch.harvestStart, receptionEnd: batch.reception.endDate || batch.harvestEnd } });
  },
  cancelForm: function () { this.setData({ showForm: false, error: '' }); },
  formInput: function (event) { const field = event.currentTarget.dataset.field; this.setData({ ['form.' + field]: event.detail.value }); },
  saveBatch: function () {
    if (this.data.busy) return;
    this.attempt(() => {
      const form = this.data.form;
      const old = this.data.editing ? this.data.selected : null;
      const variety = String(form.variety || form.crop || '').trim();
      const total = core.amount(form.yieldTotal, '预计总产量');
      if (!variety) throw new Error('请填写水果品种');
      if (!String(form.growthNote || '').trim()) throw new Error('请填写生长概况');
      core.date(form.matureDate); core.date(form.receptionStart); core.date(form.receptionEnd);
      if (form.receptionStart > form.receptionEnd) throw new Error('可采摘结束日期不能早于开始日期');
      const input = Object.assign({}, old || {}, { id: this._batchSubmissionId, name: old ? old.name : variety + '种植记录', crop: old ? old.crop : variety, variety, region: old ? old.region : [], areaMu: old ? old.areaMu : 0, openingDate: old ? old.openingDate : (core.today() < form.receptionStart ? core.today() : form.receptionStart), openingStockKg: old ? old.openingStockKg : 0, matureDate: form.matureDate, growthNote: form.growthNote, yieldMinKg: total, yieldMaxKg: total, harvestStart: form.receptionStart, harvestEnd: form.receptionEnd, deadline: form.receptionEnd, assumedDailyKg: old ? old.assumedDailyKg : null, reception: Object.assign({}, old ? old.reception : {}, { startDate: form.receptionStart, endDate: form.receptionEnd }) });
      this.setData({ busy: true });
      try { const batch = this.data.editing ? repository.updateBatch(this.data.selectedId, input, this._partition) : repository.createBatch(input, this._partition); this.setData({ selectedId: batch.id, showForm: false }); this.refresh(); wx.showToast({ title: t('sl_toast_batch'), icon: 'success' }); } finally { this.setData({ busy: false }); }
    });
  },
  eventInput: function (event) { this._eventSubmissionId = null; this.setData({ ['eventForm.' + event.currentTarget.dataset.field]: event.detail.value }); },
  eventPicker: function (event) { this._eventSubmissionId = null; this.setData({ ['eventForm.' + event.currentTarget.dataset.field]: Number(event.detail.value) }); this.updateReferences(); },
  updateReferences: function () {
    const type = core.EVENT_TYPES[this.data.eventForm.type].id; const book = this.data.book;
    const references = !book ? [] : type === 'return' ? this.data.events.filter(event => ['sale', 'fulfill'].includes(event.type) && book.delivered[event.id] && book.delivered[event.id].quantityKg > book.delivered[event.id].returnedKg).map(event => ({ id: event.id, label: event.date + ' · ' + event.label + t('sl_ref_returnable') + core.round(book.delivered[event.id].quantityKg - book.delivered[event.id].returnedKg) + t('sl_ref_kg') })) : ['cancel', 'fulfill'].includes(type) ? book.orders.filter(order => order.pendingKg > 0).map(order => ({ id: order.id, label: order.date + t('sl_ref_pending') + order.pendingKg + t('sl_ref_kg') })) : [];
    this.setData({ referenceOptions: references, referenceIndex: 0, 'eventForm.refId': references[0] ? references[0].id : '', requiresReference: ['return', 'cancel', 'fulfill'].includes(type), closesDay: type === 'close' });
  },
  referenceChange: function (event) { const index = Number(event.detail.value); this._eventSubmissionId = null; this.setData({ referenceIndex: index, 'eventForm.refId': this.data.referenceOptions[index].id }); },
  saveEvent: function () {
    if (!this.data.selectedId || this.data.busy) return;
    this.attempt(() => { const form = this.data.eventForm; this._eventSubmissionId = this._eventSubmissionId || repository.uniqueId('event'); this.setData({ busy: true });
      try { repository.addEvent(this.data.selectedId, { id: this._eventSubmissionId, type: core.EVENT_TYPES[form.type].id, date: form.date, quantity: form.quantity, unit: quantities[form.unit].id, refId: form.refId, note: form.note }, this._partition); this.setData({ 'eventForm.quantity': '', 'eventForm.note': '' }); this.refresh(); wx.showToast({ title: t('sl_toast_event'), icon: 'success' }); } finally { this.setData({ busy: false }); }
    });
  },
  createPlan: function () { this.attempt(() => { if (!this.data.selectedId) throw new Error(t('sl_err_select_batch')); repository.makePlan(this.data.selectedId, this._partition); this.refresh(); wx.showToast({ title: t('sl_toast_plan'), icon: 'success' }); }); },
  copySource: function (event) { const id = event.currentTarget.dataset.id; const sources = [].concat.apply([], this.data.plans.map(plan => plan.sources)); const found = sources.find(source => source.id === id); if (found) wx.setClipboardData({ data: found.url }); },
  feedbackInput: function (event) { this._feedbackSubmissionId = null; this.setData({ ['feedbackForm.' + event.currentTarget.dataset.field]: event.detail.value }); },
  choosePlan: function (event) { this._feedbackSubmissionId = null; this.setData({ planIndex: Number(event.detail.value) }); },
  saveFeedback: function () { this.attempt(() => { const plan = this.data.plans[this.data.planIndex]; if (!plan) throw new Error(t('sl_err_need_plan')); this._feedbackSubmissionId = this._feedbackSubmissionId || repository.uniqueId('feedback'); repository.addFeedback(plan.id, Object.assign({ id: this._feedbackSubmissionId }, this.data.feedbackForm), this._partition); this.setData({ feedbackForm: { intentCount: '0', actualCost: '0', note: '' } }); this.refresh(); wx.showToast({ title: t('sl_toast_exec'), icon: 'success' }); }); },
  exportRecords: function () { this.attempt(() => { wx.setClipboardData({ data: JSON.stringify(repository.read(this._partition), null, 2) }); }); }
});
