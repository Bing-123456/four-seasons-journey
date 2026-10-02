'use strict';
const core = require('../lib/seller-core');
module.exports = function sample(now) {
  const day = now || core.today();
  // 演示批次：全部为虚拟数据。种植情况只含 5 项——品种、预计成熟时间、
  // 生长概况、预估总产量、可采摘时间；天气与人流量信号由 lib/weather.js
  // 的虚拟演示口径提供。
  const batch = core.normalizeBatch({ id: 'seller-demo-watermelon', name: '中牟西瓜 · 模拟经营批次', region: ['河南省', '郑州市', '中牟县'], crop: '西瓜', variety: '麒麟西瓜（虚拟演示）', areaMu: 2, openingDate: core.addDays(day, -4), openingStockKg: 600, harvestStart: core.addDays(day, -7), harvestEnd: core.addDays(day, -1), deadline: core.addDays(day, 2), matureDate: core.addDays(day, 1), growthNote: '虚拟演示：藤蔓长势旺盛，坐果整齐，无病虫害，果实进入膨果后期。', yieldMinKg: 600, yieldMaxKg: 600, assumedDailyKg: null, reception: { enabled: true, startDate: day, endDate: core.addDays(day, 2), capacity: 16, staff: 2, traffic: '模拟条件：可自驾抵达，停车条件待确认', budget: 180, rainyAlternative: '模拟条件：线上阅读，不组织田间到访' }, simulated: true });
  const events = [];
  [-3, -2, -1].forEach((offset, index) => {
    events.push({ id: 'demo-sale-' + index, batchId: batch.id, type: 'sale', date: core.addDays(day, offset), quantityKg: 30, refId: '', note: '模拟已交付销量', createdAt: day + 'T00:00:00.000Z' });
    events.push({ id: 'demo-close-' + index, batchId: batch.id, type: 'close', date: core.addDays(day, offset), quantityKg: 0, refId: '', note: '模拟日结', createdAt: day + 'T00:00:00.000Z' });
  });
  events.push({ id: 'demo-order-1', batchId: batch.id, type: 'order', date: day, quantityKg: 120, refId: '', note: '模拟待交付订单', createdAt: day + 'T00:00:00.000Z' });
  return { version: 1, batches: [batch], events, riskSnapshots: [], alerts: [], plans: [], feedback: [], sampleDay: day, simulated: true, excludeFromTraining: true };
};
