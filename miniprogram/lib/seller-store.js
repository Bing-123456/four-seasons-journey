'use strict';
const defaultStore = require('./store');
const core = require('./seller-core');
const seed = require('../data/seller-sample');
let sequence = 0;
const id = prefix => prefix + '-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
const blank = () => ({ version: 1, batches: [], events: [], riskSnapshots: [], alerts: [], plans: [], feedback: [] });
function createRepository(storage) {
  const store = storage || defaultStore;
  function partition(value) { const result = value || store.capturePartition(); if (!['personal', 'demo'].includes(result)) throw new Error('账户分区不正确'); return result; }
  function read(value) {
    const key = partition(value); const saved = store.readPartitionField('seller', key);
    if (saved && saved.version === 1) return Object.assign(blank(), core.clone(saved));
    if (key === 'demo') { const result = seed(); store.writePartitionField('seller', result, key); return result; }
    return blank();
  }
  function write(state, key) { store.writePartitionField('seller', state, partition(key)); }
  function batch(state, batchId) { const found = state.batches.find(item => item.id === batchId); if (!found) throw new Error('批次不存在'); return found; }
  function createBatch(input, value) {
    const key = partition(value); const state = read(key);
    if (state.batches.length >= 100) throw new Error('本机最多保存 100 个批次');
    const next = core.normalizeBatch(Object.assign({}, input, { id: input.id || id('batch'), simulated: key === 'demo' }));
    if (state.batches.some(item => item.id === next.id)) throw new Error('批次已存在，请勿重复提交');
    state.batches.push(next); write(state, key); return core.clone(next);
  }
  function updateBatch(batchId, patch, value) {
    const key = partition(value); const state = read(key); const old = batch(state, batchId);
    const next = core.normalizeBatch(Object.assign({}, old, patch, { id: old.id, createdAt: old.createdAt, simulated: old.simulated }));
    if (state.events.some(event => event.batchId === batchId) && (next.openingStockKg !== old.openingStockKg || next.openingDate !== old.openingDate)) throw new Error('已有经营记录，不能重写期初库存或建账日期');
    core.ledger(next, state.events); state.batches = state.batches.map(item => item.id === batchId ? next : item); write(state, key); return core.clone(next);
  }
  function addEvent(batchId, input, value, now) {
    const key = partition(value); const state = read(key); const target = batch(state, batchId);
    const next = core.normalizeEvent(Object.assign({}, input, { id: input.id || id('event') }), target, now);
    const existing = state.events.find(item => item.id === next.id);
    if (existing) {
      if (['batchId', 'type', 'quantityKg', 'date', 'refId', 'note'].some(field => existing[field] !== next[field])) throw new Error('同一记录编号不能用于不同经营事项');
      return core.clone(existing);
    }
    if (state.events.length >= 5000) throw new Error('本机经营记录已达上限，请先导出备份');
    const events = state.events.concat(next); core.ledger(target, events); state.events = events; write(state, key); return core.clone(next);
  }
  function assess(batchId, value, now) {
    const key = partition(value); const state = read(key); const target = batch(state, batchId);
    const snapshot = core.assess(target, state.events, now);
    const snapshotKey = batchId + ':' + snapshot.date;
    state.riskSnapshots = state.riskSnapshots.filter(item => item.id !== snapshotKey).concat(Object.assign({ id: snapshotKey }, snapshot)).slice(-200);
    const alertKey = batchId + ':' + snapshot.status + ':' + target.deadline;
    state.alerts.forEach(alert => { if (alert.batchId === batchId && alert.active && alert.key !== alertKey) alert.active = false; });
    if (['attention', 'urgent', 'insufficient'].includes(snapshot.status)) {
      let alert = state.alerts.find(item => item.key === alertKey && item.active);
      if (!alert) { alert = { id: id('alert'), key: alertKey, batchId, label: snapshot.label, active: true, read: false, handled: false, review: '', createdAt: new Date().toISOString() }; state.alerts.push(alert); }
      alert.lastAssessedAt = snapshot.date; alert.remainingKg = snapshot.remainingKg;
    }
    state.alerts = state.alerts.slice(-200); write(state, key); return snapshot;
  }
  function markAlert(alertId, action, review, value) {
    if (!['read', 'handled', 'review'].includes(action)) throw new Error('提醒操作不正确');
    const key = partition(value); const state = read(key); const alert = state.alerts.find(item => item.id === alertId);
    if (!alert) throw new Error('提醒不存在');
    if (action === 'read') alert.read = true;
    if (action === 'handled') { alert.handled = true; alert.read = true; }
    if (action === 'review') { if (!review || !String(review).trim() || String(review).length > 1000) throw new Error('请填写 1–1000 字复盘'); alert.review = String(review).trim(); }
    write(state, key); return core.clone(alert);
  }
  function makePlan(batchId, value, now) {
    const key = partition(value); const state = read(key); const target = batch(state, batchId); const risk = core.assess(target, state.events, now);
    const plan = Object.assign({ id: id('plan') }, core.createPlan(target, risk, now)); state.plans.push(plan); state.plans = state.plans.slice(-100); write(state, key); return core.clone(plan);
  }
  // Persists an AI insight as a clearly-labeled draft plan. The rule plan
  // remains the baseline; this entry only carries the model's constrained
  // reading/steps and can be deleted like any other draft.
  function saveInsightPlan(batchId, insight, value) {
    const key = partition(value); const state = read(key); const target = batch(state, batchId);
    const plan = {
      id: id('plan'), batchId: target.id, mode: 'ai-insight',
      title: String(insight.planTitle || 'AI 文旅方案草案').slice(0, 40),
      reading: String(insight.reading || '').slice(0, 160),
      suggestions: Array.isArray(insight.suggestions) ? insight.suggestions.slice(0, 4).map(item => String(item).slice(0, 60)) : [],
      steps: Array.isArray(insight.planSteps) ? insight.planSteps.slice(0, 6).map(item => String(item).slice(0, 90)) : [],
      capacity: Number.isInteger(insight.capacity) ? insight.capacity : null,
      budget: Number.isInteger(insight.budget) ? insight.budget : null,
      alternative: String(insight.alternative || '').slice(0, 120),
      status: insight.status, generatedAt: new Date().toISOString(), simulated: key === 'demo',
      aiGenerated: true, confirmations: ['AI 草案：数字与状态以本机规则测算为准', '举办前需人工核实容量、场地与文化出处', '未确认草案不会进入游客可预约列表']
    };
    state.plans.push(plan); state.plans = state.plans.slice(-100); write(state, key); return core.clone(plan);
  }
  function addFeedback(planId, input, value) {
    const key = partition(value); const state = read(key); const plan = state.plans.find(item => item.id === planId);
    if (!plan) throw new Error('请选择已保存方案');
    const count = core.amount(input.intentCount, '参与意向人数'); if (!Number.isInteger(count) || count > 10000) throw new Error('意向人数需要填写整数');
    const note = typeof input.note === 'string' ? input.note.trim() : ''; if (!note || note.length > 1000) throw new Error('请填写 1–1000 字执行记录');
    const feedback = { id: input.id || id('feedback'), planId, batchId: plan.batchId, intentCount: count, note, actualCost: core.amount(input.actualCost, '实际支出'), simulated: key === 'demo', createdAt: new Date().toISOString(), interpretation: '意向不等于预约、成交或已到访；销量请在经营台账单独登记' };
    const existing = state.feedback.find(item => item.id === feedback.id); if (existing) return core.clone(existing);
    state.feedback = state.feedback.concat(feedback).slice(-300); write(state, key); return core.clone(feedback);
  }
  return { capturePartition: () => partition(), read, createBatch, updateBatch, addEvent, assess, markAlert, makePlan, saveInsightPlan, addFeedback, uniqueId: id };
}
module.exports = Object.assign({ createRepository }, createRepository());
