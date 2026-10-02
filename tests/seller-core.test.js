'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/seller-core');
const { createRepository } = require('../miniprogram/lib/seller-store');
const NOW = '2026-09-22';
const batch = patch => core.normalizeBatch(Object.assign({ id: 'b', name: '真实试填批次', region: ['河南省', '郑州市', '中牟县'], crop: '西瓜', variety: '', areaMu: 2, openingDate: '2026-09-10', openingStockKg: 100, harvestStart: '2026-09-10', harvestEnd: '2026-09-12', deadline: '2026-09-30', yieldMinKg: 100, yieldMaxKg: 100, assumedDailyKg: 10, reception: { enabled: false, capacity: 0, staff: 0, budget: 100, traffic: '', rainyAlternative: '' } }, patch));
const event = (id, type, quantityKg, refId, date) => ({ id, batchId: 'b', type, quantityKg, refId: refId || '', date: date || NOW, note: '' });
function storage() { let current = 'personal'; const partitions = { personal: {}, demo: {} }; return { capturePartition: () => current, switch: value => { current = value; }, readPartitionField: (field, partition) => partitions[partition][field], writePartitionField: (field, value, partition) => { partitions[partition][field] = structuredClone(value); }, partitions }; }

test('seller converts units, rejects missing numbers and invalid calendar dates', () => {
  assert.equal(core.toKg(20, 'jin'), 10); assert.equal(core.toKg(0.25, 'ton'), 250); assert.equal(core.toMu(2, 'hectare'), 30);
  assert.equal(core.amount(0, 'value', true), 0); assert.equal(core.amount('', 'value', true), null);
  ['2026-02-30', '2026-13-01', '22-09-22'].forEach(value => assert.throws(() => core.date(value), /日期/));
  ['', '  ', [], {}, -1, Infinity, 'NaN', true].forEach(value => assert.throws(() => core.toKg(value, 'kg'), /非负数/));
  assert.throws(() => core.toKg(1, 'pound'), /单位/); assert.throws(() => batch({ yieldMinKg: 200, yieldMaxKg: 100 }), /范围/);
  assert.throws(() => batch({ harvestEnd: '2026-10-01' }), /顺序/);
});

test('seller inventory conserves stock through orders, fulfilment, cancellation, sale, returns and loss', () => {
  const events = [event('h', 'harvest', 50), event('o', 'order', 40), event('f', 'fulfill', 25, 'o'), event('c', 'cancel', 15, 'o'), event('s', 'sale', 20), event('r', 'return', 5, 'f'), event('l', 'loss', 8)];
  const result = core.ledger(batch(), events);
  assert.equal(result.stockKg, 102); assert.equal(result.pendingKg, 0); assert.equal(result.netSalesKg, 40);
  assert.equal(result.stockKg, 100 + result.harvestedKg - result.salesKg + result.returnedKg - result.lossKg);
  assert.equal(core.ledger(batch(), [event('o', 'order', 40)]).stockKg, 100);
  assert.equal(core.ledger(batch(), [event('o', 'order', 40)]).pendingKg, 40);
  assert.throws(() => core.ledger(batch(), events.concat(event('r2', 'return', 21, 'f'))), /退货/);
  assert.throws(() => core.ledger(batch(), events.concat(event('f2', 'fulfill', 1, 'o'))), /待交付/);
  assert.throws(() => core.ledger(batch(), [event('r', 'return', 1, 'unknown')]), /退货/);
  assert.throws(() => core.ledger(batch(), [event('l', 'loss', 101)]), /库存小于零/);
});

test('seller reserves orders exactly once and projects only the remaining selling window', () => {
  const target = batch({ deadline: '2026-09-24' });
  const events = [event('o', 'order', 40), event('f', 'fulfill', 10, 'o')];
  const risk = core.assess(target, events, NOW);
  assert.equal(risk.windowDays, 3); assert.equal(risk.stockKg, 90); assert.equal(risk.pendingKg, 30); assert.equal(risk.expectedSalesKg, 30); assert.equal(risk.remainingKg, 30); assert.equal(risk.status, 'urgent');
  assert.equal(core.assess(batch(), [], NOW).windowDays, 7);
  const fulfilled = events.concat(event('f2', 'fulfill', 30, 'o'));
  assert.equal(core.assess(target, fulfilled, NOW).remainingKg, risk.remainingKg, 'fulfillment must not subtract confirmed quantity twice');
});

test('missing inputs, explicit zero sales, stale records and expired goods never become fabricated probability', () => {
  assert.equal(core.assess(batch({ assumedDailyKg: null }), [], NOW).status, 'insufficient');
  const zero = core.assess(batch({ assumedDailyKg: 0 }), [], NOW);
  assert.equal(zero.status, 'attention'); assert.equal(zero.remainingKg, 100); assert.match(zero.basis, /情景测算/); assert.equal('probability' in zero, false);
  const expired = core.assess(batch({ deadline: '2026-09-20' }), [], NOW);
  assert.equal(expired.windowDays, 0); assert.equal(expired.status, 'insufficient'); assert.ok(expired.errors.some(error => /已过/.test(error)));
  const stale = core.assess(batch(), [event('close', 'close', 0, '', '2026-09-12')], NOW);
  assert.equal(stale.stale, true); assert.match(stale.basis, /假设/);
  assert.equal(core.assess(batch({ assumedDailyKg: null }), [event('close', 'close', 0, '', '2026-09-12')], NOW).status, 'insufficient');
});

test('zero-sale closed days are observations while unclosed days are not invented', () => {
  const events = [event('c1', 'close', 0, '', '2026-09-19'), event('c2', 'close', 0, '', '2026-09-20'), event('c3', 'close', 0, '', '2026-09-21')];
  const risk = core.assess(batch({ assumedDailyKg: null }), events, NOW);
  assert.equal(risk.dailyKg, 0); assert.equal(risk.status, 'attention'); assert.match(risk.basis, /3 天/);
  const twoDays = core.assess(batch({ assumedDailyKg: null }), events.slice(0, 2), NOW);
  assert.equal(twoDays.status, 'insufficient');
  assert.equal(core.assess(batch({ assumedDailyKg: null }), events.concat(event('duplicate-day', 'close', 0, '', '2026-09-21')), NOW).dailyKg, 0);
});

test('future harvest is bounded and never counted twice with opening stock or harvested receipts', () => {
  const target = batch({ harvestStart: '2026-09-22', harvestEnd: '2026-09-25', yieldMinKg: 200, yieldMaxKg: 200 });
  const risk = core.assess(target, [event('h', 'harvest', 30)], NOW);
  assert.equal(risk.incomingKg, 70); assert.equal(risk.stockKg, 130); assert.equal(risk.supplyKg, 200);
  const missing = core.assess(batch({ harvestStart: NOW, harvestEnd: '2026-09-25', yieldMinKg: null, yieldMaxKg: null }), [], NOW);
  assert.equal(missing.status, 'insufficient'); assert.ok(missing.errors.some(error => /产量范围/.test(error)));
  const limited = core.assess(batch({ harvestStart: NOW, harvestEnd: '2026-10-05', deadline: '2026-10-10', yieldMinKg: 240, yieldMaxKg: 240 }), [], NOW);
  assert.equal(limited.incomingKg, 70);
});

test('repository is idempotent, preserves personal/demo isolation and captures writes to the initiating partition', () => {
  const backing = storage(); const repo = createRepository(backing); const captured = repo.capturePartition();
  assert.equal(repo.read().batches.length, 0);
  const created = repo.createBatch(batch(), captured);
  assert.equal(created.simulated, false);
  const input = { id: 'once', type: 'sale', date: NOW, quantity: 10, unit: 'kg' };
  repo.addEvent('b', input, captured, NOW); repo.addEvent('b', input, captured, NOW);
  assert.equal(repo.read(captured).events.length, 1);
  assert.throws(() => repo.addEvent('b', { ...input, quantity: 20 }, captured, NOW), /同一记录编号/);
  backing.switch('demo'); assert.ok(repo.read().batches.every(item => item.simulated));
  repo.addEvent('b', { ...input, id: 'after-switch', quantity: 5 }, captured, NOW);
  assert.equal(repo.read('personal').events.length, 2); assert.equal(repo.read('demo').events.some(item => item.id === 'after-switch'), false);
  assert.throws(() => repo.updateBatch('b', { openingStockKg: 999 }, 'personal'), /期初库存/);
  assert.throws(() => repo.addEvent('b', { ...input, id: 'future', date: '2026-09-23' }, 'personal', NOW), /今天/);
});

test('alert refresh deduplicates and keeps read/handled/review state', () => {
  const repo = createRepository(storage()); repo.createBatch(batch({ deadline: '2026-09-24' }));
  repo.assess('b', 'personal', NOW); repo.assess('b', 'personal', NOW);
  assert.equal(repo.read().alerts.length, 1); assert.equal(repo.read().riskSnapshots.length, 1);
  const alert = repo.read().alerts[0]; repo.markAlert(alert.id, 'read'); repo.markAlert(alert.id, 'handled'); repo.markAlert(alert.id, 'review', '已核实渠道意向，尚未成交');
  repo.assess('b', 'personal', NOW); const stored = repo.read().alerts[0];
  assert.equal(stored.read, true); assert.equal(stored.handled, true); assert.match(stored.review, /尚未成交/);
  repo.updateBatch('b', { assumedDailyKg: 100 }); repo.assess('b', 'personal', NOW);
  assert.equal(repo.read().alerts[0].active, false);
});

test('seller proposals cite real cultural facts, constrain capacity and fall back to channels', () => {
  const noReception = core.createPlan(batch(), null, NOW);
  assert.equal(noReception.capacity, 0); assert.match(noReception.title, /渠道/); assert.equal(noReception.status, 'draft'); assert.equal(noReception.culturalBasis.factId, 'f-guadou-process'); assert.ok(noReception.sources.every(source => source.url.startsWith('https://')));
  const target = batch({ reception: { enabled: true, startDate: NOW, endDate: '2026-09-24', capacity: 30, staff: 2, traffic: '待核实停车区', budget: 50 } });
  const plan = core.createPlan(target, null, NOW);
  assert.equal(plan.capacity, 16); assert.equal(plan.cost.estimated, 128); assert.ok(plan.confirmations.some(item => /超过/.test(item))); assert.match(plan.alternative, /取消线下/);
  const elsewhere = core.createPlan(batch({ region: ['山东省', '烟台市', '莱山区'], crop: '苹果' }), null, NOW);
  assert.equal(elsewhere.culturalBasis, null); assert.equal(elsewhere.sources.length, 0);
});

test('feedback does not turn intentions into sales or visitor bookings', () => {
  const repo = createRepository(storage()); repo.createBatch(batch()); const plan = repo.makePlan('b', 'personal', NOW);
  const before = repo.read().events.length;
  repo.addFeedback(plan.id, { id: 'intent', intentCount: 7, actualCost: 20, note: '收集了意向，还未确认' });
  repo.addFeedback(plan.id, { id: 'intent', intentCount: 7, actualCost: 20, note: '收集了意向，还未确认' });
  assert.equal(repo.read().feedback.length, 1); assert.equal(repo.read().events.length, before); assert.equal(repo.read().plans[0].status, 'draft');
  assert.match(repo.read().feedback[0].interpretation, /不等于/);
});


test('cross-day ledger follows occurrence date and rejects impossible backdated references', () => {
  const target = batch();
  const events = [event('order', 'order', 30, '', '2026-09-19'), event('sold', 'sale', 10, '', '2026-09-18'), event('delivered', 'fulfill', 20, 'order', '2026-09-20'), event('returned', 'return', 5, 'delivered', '2026-09-21')];
  assert.equal(core.ledger(target, events, '2026-09-18').stockKg, 90);
  assert.equal(core.ledger(target, events, '2026-09-18').pendingKg, 0);
  assert.equal(core.ledger(target, events, '2026-09-19').pendingKg, 30);
  assert.equal(core.ledger(target, events, '2026-09-20').stockKg, 70);
  assert.equal(core.ledger(target, events, NOW).stockKg, 75);
  assert.equal(core.ledger(target, events, NOW).pendingKg, 10);
  assert.throws(() => core.ledger(target, events.concat(event('bad', 'fulfill', 1, 'order', '2026-09-17'))), /关联订单/);
});

test('zero quantity is rejected for movement events but explicit zero day remains valid', () => {
  const repo = createRepository(storage()); repo.createBatch(batch());
  for (const type of ['harvest', 'sale', 'order', 'fulfill', 'cancel', 'return', 'loss']) assert.throws(() => repo.addEvent('b', { id: 'zero-' + type, type, date: NOW, quantity: 0, unit: 'kg' }, 'personal', NOW), /大于零/);
  repo.addEvent('b', { id: 'close-zero', type: 'close', date: NOW, quantity: 0 }, 'personal', NOW);
  assert.equal(repo.read().events.length, 1); assert.equal(core.ledger(repo.read().batches[0], repo.read().events).stockKg, 100);
});

test('forecast harvest is read-only and recording projected receipts transfers stock without duplicating supply', () => {
  const repo = createRepository(storage()); repo.createBatch(batch({ harvestStart: NOW, harvestEnd: '2026-09-25', yieldMinKg: 200, yieldMaxKg: 200 }));
  const before = repo.assess('b', 'personal', NOW);
  assert.equal(before.stockKg, 100); assert.equal(before.incomingKg, 100); assert.equal(before.supplyKg, 200);
  repo.assess('b', 'personal', NOW); assert.equal(repo.read().events.length, 0);
  repo.addEvent('b', { id: 'actual-harvest', type: 'harvest', date: NOW, quantity: 40, unit: 'kg' }, 'personal', NOW);
  const after = repo.assess('b', 'personal', NOW);
  assert.equal(after.stockKg, 140); assert.equal(after.incomingKg, 60); assert.equal(after.supplyKg, before.supplyKg);
});

test('a recurring pressure alert is new only after its former state has resolved', () => {
  const repo = createRepository(storage()); repo.createBatch(batch({ assumedDailyKg: 0 }));
  repo.assess('b', 'personal', NOW); const first = repo.read().alerts[0]; repo.markAlert(first.id, 'handled');
  repo.assess('b', 'personal', core.addDays(NOW, 1)); assert.equal(repo.read().alerts.length, 1); assert.equal(repo.read().alerts[0].handled, true);
  repo.updateBatch('b', { assumedDailyKg: 100 }); repo.assess('b', 'personal', core.addDays(NOW, 1));
  repo.updateBatch('b', { assumedDailyKg: 0 }); repo.assess('b', 'personal', core.addDays(NOW, 1));
  assert.equal(repo.read().alerts.length, 2); assert.equal(repo.read().alerts.filter(alert => alert.active).length, 1); assert.equal(repo.read().alerts[1].handled, false);
});
