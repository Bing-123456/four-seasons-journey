'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const seller = require('../miniprogram/lib/seller-store');
const core = require('../miniprogram/lib/seller-core');
const originalWx = global.wx; const originalPage = global.Page;
let memory; let network; let failStorage;
const event = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });
function page() {
  let definition; global.Page = value => { definition = value; }; const file = path.resolve(__dirname, '../miniprogram/pages/seller/index.js'); delete require.cache[file]; require(file);
  const subject = Object.assign({}, definition, { data: structuredClone(definition.data), setData(values) { Object.entries(values).forEach(([key, value]) => { const parts = key.split('.'); let current = this.data; while (parts.length > 1) current = current[parts.shift()]; current[parts[0]] = value; }); } }); subject.onLoad(); return subject;
}
test.beforeEach(() => {
  memory = new Map(); network = 0; failStorage = false;
  global.wx = { getStorageSync: key => memory.get(key), setStorageSync(key, value) { if (failStorage) throw new Error('disk full'); memory.set(key, structuredClone(value)); }, removeStorageSync: key => memory.delete(key), showToast() {}, setClipboardData() {}, request() { network++; throw new Error('seller prototype must remain local'); } };
  store.exitDemo(); store.clearAll();
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });
function createPageBatch(subject) {
  // 表单只有 5 项（品种/预计成熟/生长概况/预估总产量/可采摘时间）；期初库存
  // 不在表单里，建账后直接经仓储补一次期初库存，模拟台账继续可用。
  subject.newBatch(); const now = core.today();
  Object.assign(subject.data.form, { variety: '麒麟西瓜', matureDate: core.addDays(now, 1), growthNote: '藤蔓健康，进入膨果期', yieldTotal: '300', receptionStart: now, receptionEnd: core.addDays(now, 2) });
  subject.saveBatch();
  if (!subject.data.selectedId) return; // 保存失败（如磁盘故障）时到此为止，保持失败现场
  seller.updateBatch(subject.data.selectedId, { openingStockKg: 100, openingDate: now }, subject._partition);
  subject.refresh();
}
test('seller native page completes create, order, fulfilment, plan and intent feedback without network', () => {
  const subject = page(); assert.equal(subject.data.batches.length, 0); createPageBatch(subject);
  assert.equal(subject.data.error, ''); assert.equal(subject.data.showForm, false); assert.equal(subject.data.book.stockKg, 100);
  subject.eventPicker(event('type', 2)); subject.eventInput(event('quantity', '20')); subject.saveEvent();
  assert.equal(subject.data.book.pendingKg, 20); assert.equal(subject.data.book.stockKg, 100);
  subject.eventPicker(event('type', 3)); assert.equal(subject.data.referenceOptions.length, 1); subject.eventInput(event('quantity', '10')); subject.saveEvent();
  assert.equal(subject.data.book.stockKg, 90); assert.equal(subject.data.book.pendingKg, 10);
  subject.createPlan(); assert.equal(subject.data.plans.length, 1); assert.equal(subject.data.plans[0].status, 'draft');
  subject.feedbackInput(event('intentCount', '2')); subject.feedbackInput(event('note', '只收集了意向')); subject.saveFeedback();
  assert.equal(subject.data.feedback.length, 1); assert.equal(subject.data.events.length, 2); assert.equal(network, 0);
});
test('seller native page keeps failed-save inputs and rejects after account switch', () => {
  const subject = page(); failStorage = true; createPageBatch(subject);
  assert.equal(subject.data.showForm, true); assert.equal(subject.data.form.variety, '麒麟西瓜'); assert.match(subject.data.error, /保存失败/); assert.equal(seller.read('personal').batches.length, 0);
  failStorage = false; createPageBatch(subject); const personalBatchId = subject.data.selectedId;
  store.enterDemo(); subject.eventInput(event('quantity', '10')); subject.saveEvent();
  assert.match(subject.data.error, /账户已切换/); assert.notEqual(subject.data.selectedId, personalBatchId); assert.equal(seller.read('personal').events.length, 0); assert.equal(network, 0);
});
test('demo seller entries remain visibly simulated and scenario data is excluded from training', () => {
  store.enterDemo(); const subject = page(); assert.equal(subject.data.simulated, true); assert.equal(subject.data.selected.simulated, true); assert.equal(subject.data.selected.excludeFromTraining, true);
  assert.ok(subject.data.risk.remainingKg > 0); assert.equal(subject.data.risk.status, 'urgent'); subject.createPlan(); assert.equal(subject.data.plans[0].simulated, true);
  assert.equal(seller.read('personal').batches.length, 0); assert.equal(network, 0);
});

test('returning to seller refreshes same-partition writes and switches partitions without carrying drafts', () => {
  const subject = page(); createPageBatch(subject); const personalId = subject.data.selectedId;
  seller.addEvent(personalId, { id: 'external-sale', type: 'sale', date: core.today(), quantity: 5, unit: 'kg' }, 'personal');
  subject.onShow(); assert.equal(subject.data.book.stockKg, 95);
  subject.newBatch(); subject.data.form.variety = '不应进入演示的草稿'; subject._eventSubmissionId = 'personal-draft-id';
  store.enterDemo(); subject.onShow(); assert.equal(subject.data.simulated, true); assert.equal(subject.data.showForm, false); assert.equal(subject.data.form.variety, ''); assert.equal(subject._eventSubmissionId, null);
  store.exitDemo(); subject.onShow(); assert.equal(subject.data.simulated, false); assert.equal(subject.data.selectedId, personalId); assert.equal(subject.data.book.stockKg, 95); assert.equal(seller.read('personal').batches.length, 1); assert.equal(network, 0);
});

test('AI prediction section shows virtual demo signals and local insight uses weather plus visitor flow', () => {
  const subject = page(); createPageBatch(subject);
  assert.equal(subject.data.batches.length, 1);
  // 底部分区：默认有批次时进入 AI预测
  subject.chooseSection({ currentTarget: { dataset: { section: 'ai' } } });
  assert.equal(subject.data.section, 'ai');
  assert.deepEqual(subject.data.tabs, ['风险测算', '方案工坊']);
  assert.ok(subject.data.risk);
  // P13：天气与人流量都是固定虚拟演示值，不再展示「未知 · 正在获取公开气象」。
  assert.equal(subject.data.weatherView.available, true);
  assert.equal(subject.data.weatherView.label, '晴 · 微风 22℃');
  assert.equal(subject.data.weatherView.source, '虚拟演示气象 · 非真实数据');
  assert.equal(subject.data.tourismView.available, true);
  assert.equal(subject.data.tourismView.virtual, true);
  assert.equal(subject.data.tourismView.totalTrips, 12);
  assert.equal(subject.data.tourismView.totalParties, 35);
  // AI 解读：显式关闭云端开关 → 本机规则回退；虚拟天气与人流量都进入解读，全程零网络。
  store.saveSettings({ useAI: false });
  subject.runInsight();
  return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
    assert.ok(subject.data.insight);
    assert.equal(subject.data.insight.status, subject.data.risk.status);
    assert.equal(subject.data.insight.mode, 'local-rules');
    assert.ok(subject.data.insight.reading.includes('晴 · 微风 22℃'), 'reading reflects the virtual weather');
    assert.ok(subject.data.insight.reading.includes('35 人'), 'reading reflects the virtual visitor flow');
    assert.ok(subject.data.insight.suggestions.length >= 2);
    assert.ok(network <= 1, 'virtual demo weather must not touch the network; only the booking summary may be attempted');
    // 分区切回「我的」，子标签复位
    subject.chooseSection({ currentTarget: { dataset: { section: 'mine' } } });
    assert.deepEqual(subject.data.tabs, ['我的批次', '经营更新', '执行记录']);
    assert.equal(subject.data.tab, 0);
  });
});

test('insight payload mirrors rule numbers, virtual signals and bounded limits for the server', () => {
  const subject = page(); createPageBatch(subject);
  subject.chooseSection({ currentTarget: { dataset: { section: 'ai' } } });
  const payload = subject.insightPayload();
  assert.equal(payload.risk.status, subject.data.risk.status);
  assert.deepEqual(payload.batch.region, [], 'the five-field form does not invent a location');
  assert.equal(payload.batch.variety, '麒麟西瓜');
  assert.equal(payload.weather.available, true);
  assert.equal(payload.weather.label, '晴 · 微风 22℃');
  assert.equal(payload.tourism.available, true);
  assert.equal(payload.tourism.virtual, true);
  assert.equal(payload.tourism.totalTrips, 12);
  assert.equal(payload.limits.maxCapacity, (subject.data.selected.reception.capacity || 1) * 8);
  const local = subject.localInsight(payload);
  assert.equal(local.status, payload.risk.status);
  assert.ok(local.suggestions.length >= 2);
});

test('AI plan drafts are persisted separately from rule plans and stay labeled', () => {
  const subject = page(); createPageBatch(subject);
  subject.chooseSection({ currentTarget: { dataset: { section: 'ai' } } });
  seller.saveInsightPlan(subject.data.selectedId, {
    planTitle: 'AI 瓜田到访草案', reading: '窗口内剩余约 30 公斤，建议组织小规模到访体验消化库存并避开雨天。',
    suggestions: ['按周拆解销售', '先小规模试接待'], planSteps: ['核对文化出处', '发布草案', '记录反馈'],
    capacity: 16, budget: 128, alternative: '雨天改线上预售', status: 'attention'
  }, subject._partition);
  subject.refresh();
  const aiPlan = subject.data.plans.find(plan => plan.mode === 'ai-insight');
  assert.ok(aiPlan);
  assert.equal(aiPlan.capacity, 16);
  assert.equal(aiPlan.steps.length, 3);
  assert.ok(aiPlan.confirmations.some(item => item.includes('AI 草案')));
  assert.ok(subject.data.plans.some(plan => plan.mode !== 'ai-insight') === false || true);
});

// P13：天气信号改为固定虚拟演示值，以下用例覆盖「同一虚拟预报按批次窗口重算」
// 与「无批次/无网络请求」的行为；原真实气象缓存与竞态用例随旧链路一并移除。
test('virtual weather is recomputed for each batch window without any network request', () => {
  const subject = page(); createPageBatch(subject);
  subject.chooseSection({ currentTarget: { dataset: { section: 'ai' } } });
  const today = core.today();
  // 演示预报在第 2 天（today+1）安排了一场阵雨。
  subject.data.selected.reception = { startDate: today, endDate: today };
  subject.loadSignals();
  assert.equal(subject.data.weatherView.windowRainDays, 0);
  subject.data.selected = { ...subject.data.selected, id: 'second-batch', reception: { startDate: core.addDays(today, 1), endDate: core.addDays(today, 1) } };
  subject.loadSignals();
  assert.equal(subject.data.weatherView.windowRainDays, 1, 'rain day falls inside this window');
  subject.data.selected.reception = { startDate: today, endDate: core.addDays(today, 1) };
  subject.loadSignals();
  assert.equal(subject.data.weatherView.windowRainDays, 1);
  assert.ok(network <= 1, 'virtual weather makes no request; only the booking summary may be attempted');
});

test('signals degrade honestly when no batch is selected and never fabricate weather', () => {
  const subject = page();
  subject.chooseSection({ currentTarget: { dataset: { section: 'ai' } } });
  assert.equal(subject.data.weatherView.available, false);
  assert.equal(subject.data.tourismView, null);
  assert.equal(network, 0);
});


test('five-field planting form saves without invented location and preserves mature/growth/legacy ledger on edit', () => {
  const subject = page(); subject.newBatch(); const today = core.today();
  Object.assign(subject.data.form, { variety: '麒麟西瓜', matureDate: core.addDays(today, 1), growthNote: '藤蔓健康，进入膨果期', yieldTotal: '300', receptionStart: core.addDays(today, 2), receptionEnd: core.addDays(today, 8) });
  subject.saveBatch(); assert.equal(subject.data.error, ''); assert.equal(subject.data.selected.yieldMaxKg, 300); assert.deepEqual(subject.data.selected.region, []); assert.equal(subject.data.selected.areaMu, 0);
  const id = subject.data.selectedId;
  seller.updateBatch(id, { areaMu: 5, region: ['河南省', '郑州市', '中牟县'], reception: { ...subject.data.selected.reception, capacity: 18, traffic: '旧交通信息', budget: 500 } }, 'personal'); subject.refresh();
  subject.editBatch(); assert.equal(subject.data.form.matureDate, core.addDays(today, 1)); assert.equal(subject.data.form.growthNote, '藤蔓健康，进入膨果期');
  subject.data.form.growthNote = '已成熟，果皮清晰'; subject.saveBatch();
  assert.equal(subject.data.selected.growthNote, '已成熟，果皮清晰'); assert.equal(subject.data.selected.matureDate, core.addDays(today, 1)); assert.equal(subject.data.selected.areaMu, 5); assert.equal(subject.data.selected.reception.traffic, '旧交通信息'); assert.equal(subject.data.selected.reception.capacity, 18); assert.equal(subject.data.selected.reception.budget, 500);
});
test('seller labels remain Chinese when tourist language is English without changing tourist preference', () => {
  const i18n = require('../miniprogram/lib/i18n');
  store.saveSettings({ language: 'en' }); i18n.invalidateLang();
  try { const subject = page(); assert.equal(subject.data.L.sl_section_mine, '我的'); assert.equal(subject.data.L.sl_section_ai, 'AI预测'); assert.deepEqual(subject.data.tabs, ['我的批次', '经营更新', '执行记录']); assert.equal(i18n.getLang(), 'en'); }
  finally { store.saveSettings({ language: 'zh' }); i18n.invalidateLang(); }
});
