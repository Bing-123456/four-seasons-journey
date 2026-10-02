'use strict';

const catalog = require('../data/catalog');
const DAY = 86400000;
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round((value + Number.EPSILON) * 1000) / 1000;
const EVENT_TYPES = [
  { id: 'harvest', label: '采收入库' }, { id: 'sale', label: '现货销售（已交付）' },
  { id: 'order', label: '确认订单（未交付）' }, { id: 'fulfill', label: '订单交付' },
  { id: 'cancel', label: '取消未交付订单' }, { id: 'return', label: '退货重新入库' },
  { id: 'loss', label: '损耗出库' }, { id: 'close', label: '当天销售已核对（含零销量）' }
];
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式应为 YYYY-MM-DD');
  const number = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(number) || new Date(number).toISOString().slice(0, 10) !== value) throw new Error('请输入有效日期');
  return number;
}
function today() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
function addDays(value, days) { return new Date(date(value) + days * DAY).toISOString().slice(0, 10); }
function amount(value, label, optional) {
  const empty = value === null || value === undefined || typeof value === 'string' && !value.trim();
  if (empty && optional) return null;
  if (empty || !['number', 'string'].includes(typeof value) || typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100000000) throw new Error(label + '需要填写非负数');
  return round(Number(value));
}
function toKg(value, unit) { if (!['kg', 'jin', 'ton'].includes(unit)) throw new Error('重量单位不支持'); return round(amount(value, '重量') * ({ kg: 1, jin: 0.5, ton: 1000 })[unit]); }
function toMu(value, unit) { if (!['mu', 'hectare'].includes(unit)) throw new Error('面积单位不支持'); return round(amount(value, '面积') * (unit === 'hectare' ? 15 : 1)); }
function text(value, label, required, max) { const result = typeof value === 'string' ? value.trim() : ''; if ((required && !result) || result.length > (max || 200)) throw new Error(label + '未填写或过长'); return result; }
function normalizeBatch(input) {
  if (!input || typeof input !== 'object') throw new Error('批次信息不完整');
  const region = input.region || [];
  if (!Array.isArray(region) || ![0, 3].includes(region.length) || region.some(part => !text(part, '地区', true, 50))) throw new Error('请选择省、市、县');
  ['openingDate', 'harvestStart', 'harvestEnd', 'deadline'].forEach(key => date(input[key]));
  if (input.harvestStart > input.harvestEnd || input.harvestEnd > input.deadline || input.openingDate > input.deadline) throw new Error('采收日期、建账日期与可售截止日期顺序不正确');
  const yieldMinKg = amount(input.yieldMinKg, '预计产量下限', true);
  const yieldMaxKg = amount(input.yieldMaxKg, '预计产量上限', true);
  if ((yieldMinKg === null) !== (yieldMaxKg === null) || yieldMinKg !== null && yieldMaxKg < yieldMinKg) throw new Error('产量范围需同时填写，且上限不能小于下限');
  const reception = input.reception || {};
  const capacity = amount(reception.capacity === undefined ? 0 : reception.capacity, '接待人数');
  const staff = amount(reception.staff === undefined ? 0 : reception.staff, '接待人员');
  if (!Number.isInteger(capacity) || !Number.isInteger(staff) || capacity > 10000 || staff > 1000) throw new Error('接待人数与人员需要填写合理的整数');
  const receptionStart = reception.startDate || '';
  const receptionEnd = reception.endDate || '';
  if (receptionStart || receptionEnd) { date(receptionStart); date(receptionEnd); if (receptionStart > receptionEnd) throw new Error('接待日期顺序不正确'); }
  return {
    id: text(input.id, '批次编号', false, 100), name: text(input.name, '批次名称', true, 80), region: region.slice(),
    crop: text(input.crop, '作物', true, 40), variety: text(input.variety, '品种', false, 60), areaMu: amount(input.areaMu, '种植面积'),
    openingDate: input.openingDate, openingStockKg: amount(input.openingStockKg, '期初可售库存'),
    harvestStart: input.harvestStart, harvestEnd: input.harvestEnd, deadline: input.deadline, yieldMinKg, yieldMaxKg,
    matureDate: (date(input.matureDate || input.deadline), input.matureDate || input.deadline), growthNote: text(input.growthNote || '', '生长概况', false, 300),
    assumedDailyKg: amount(input.assumedDailyKg, '新增日净销量假设', true),
    reception: { enabled: reception.enabled === true, startDate: receptionStart, endDate: receptionEnd, capacity, staff, traffic: text(reception.traffic, '交通', false, 400), budget: amount(reception.budget === undefined ? 0 : reception.budget, '活动预算'), rainyAlternative: text(reception.rainyAlternative, '雨天备选', false, 400) },
    simulated: input.simulated === true, excludeFromTraining: input.simulated === true, createdAt: input.createdAt || new Date().toISOString()
  };
}
function normalizeEvent(input, batch, now) {
  if (!input || !EVENT_TYPES.some(type => type.id === input.type)) throw new Error('经营记录类型不正确');
  const eventDate = input.date;
  date(eventDate); date(now || today());
  if (eventDate < batch.openingDate || eventDate > (now || today())) throw new Error('只可记录建账日至今天已发生的经营事项');
  const quantityKg = input.type === 'close' ? 0 : toKg(input.quantity, input.unit || 'kg');
  if (input.type !== 'close' && quantityKg <= 0) throw new Error('数量应大于零');
  return { id: text(input.id, '记录编号', true, 100), batchId: batch.id, date: eventDate, type: input.type, quantityKg, refId: text(input.refId, '关联记录', false, 100), note: text(input.note, '备注', false, 500), createdAt: input.createdAt || new Date().toISOString() };
}
function ledger(batch, events, asOf) {
  const end = asOf || '9999-12-31';
  let stockKg = batch.openingStockKg; let harvestedKg = 0; let salesKg = 0; let returnedKg = 0; let lossKg = 0;
  const orders = {}; const delivered = {}; const daily = {}; const closedDates = []; const seen = new Set();
  const ordered = events.filter(item => item.batchId === batch.id && item.date <= end).map((item, index) => ({ item, index })).sort((a, b) => a.item.date.localeCompare(b.item.date) || a.index - b.index).map(row => row.item);
  ordered.forEach(event => {
    if (seen.has(event.id)) return; seen.add(event.id);
    const quantity = amount(event.quantityKg, '台账数量');
    if (event.type !== 'close' && quantity <= 0) throw new Error('台账数量必须大于零');
    if (event.date < batch.openingDate) throw new Error('记录日期早于建账日期');
    daily[event.date] = daily[event.date] || 0;
    if (event.type === 'harvest') { stockKg += quantity; harvestedKg += quantity; }
    else if (event.type === 'order') { orders[event.id] = { id: event.id, date: event.date, originalKg: quantity, pendingKg: quantity, note: event.note || '' }; }
    else if (event.type === 'cancel' || event.type === 'fulfill') {
      const order = orders[event.refId];
      if (!order || quantity > round(order.pendingKg)) throw new Error('取消或交付数量超过关联订单的待交付量');
      order.pendingKg = round(order.pendingKg - quantity);
      if (event.type === 'fulfill') { stockKg -= quantity; salesKg += quantity; daily[event.date] += quantity; delivered[event.id] = { quantityKg: quantity, returnedKg: 0 }; }
    } else if (event.type === 'sale') { stockKg -= quantity; salesKg += quantity; daily[event.date] += quantity; delivered[event.id] = { quantityKg: quantity, returnedKg: 0 }; }
    else if (event.type === 'return') {
      const sale = delivered[event.refId];
      if (!sale || quantity + sale.returnedKg > sale.quantityKg + 0.0001) throw new Error('退货数量超过关联销售的已交付数量');
      sale.returnedKg = round(sale.returnedKg + quantity); stockKg += quantity; returnedKg += quantity; daily[event.date] -= quantity;
    } else if (event.type === 'loss') { stockKg -= quantity; lossKg += quantity; }
    else if (event.type === 'close') { if (!closedDates.includes(event.date)) closedDates.push(event.date); }
    else throw new Error('台账记录类型不支持');
    stockKg = round(stockKg);
    if (stockKg < 0) throw new Error('记录会使库存小于零，请先核对入库或关联订单');
  });
  return { stockKg: round(stockKg), harvestedKg: round(harvestedKg), salesKg: round(salesKg), returnedKg: round(returnedKg), netSalesKg: round(salesKg - returnedKg), lossKg: round(lossKg), pendingKg: round(Object.keys(orders).reduce((sum, id) => sum + orders[id].pendingKg, 0)), orders: Object.values(orders), daily, closedDates, delivered };
}
function assess(batch, events, asOf) {
  const now = asOf || today(); date(now);
  const book = ledger(batch, events, now);
  const remainingDays = Math.floor((date(batch.deadline) - date(now)) / DAY) + 1;
  const windowDays = Math.max(0, Math.min(7, remainingDays));
  const windowEnd = addDays(now, Math.max(0, windowDays - 1));
  const recent = book.closedDates.filter(day => day < now && day >= addDays(now, -7));
  let dailyKg = null; let basis = '缺少至少 3 天已核对销量，请填写日净销量假设';
  if (recent.length >= 3) { dailyKg = round(Math.max(0, recent.reduce((sum, day) => sum + (book.daily[day] || 0), 0) / recent.length)); basis = '最近 7 天内 ' + recent.length + ' 天已核对净销量均值'; }
  else if (batch.assumedDailyKg !== null) { dailyKg = batch.assumedDailyKg; basis = '卖家填写的日净销量假设 · 情景测算'; }
  const latestClose = book.closedDates.slice().sort().pop();
  const stale = !!latestClose && latestClose < addDays(now, -7);
  const errors = []; const notes = [];
  if (now < batch.openingDate) errors.push('尚未到建账日期');
  if (remainingDays <= 0) errors.push('可售期限已过，请更新批次后重新测算');
  if (dailyKg === null) errors.push('缺少新增净销量依据');
  if (stale) notes.push('最近一次销量核对已超过 7 天；当前仅按显式假设测算，请补记账');
  const intersectStart = now > batch.harvestStart ? now : batch.harvestStart;
  const intersectEnd = windowEnd < batch.harvestEnd ? windowEnd : batch.harvestEnd;
  let incomingKg = 0; let incomingLowKg = 0; let incomingHighKg = 0;
  if (windowDays && intersectStart <= intersectEnd) {
    if (batch.yieldMinKg === null || batch.yieldMaxKg === null) errors.push('采收窗口内缺少预计产量范围');
    else {
      const harvestDaysRemaining = Math.max(1, (date(batch.harvestEnd) - date(intersectStart)) / DAY + 1);
      const overlapDays = (date(intersectEnd) - date(intersectStart)) / DAY + 1;
      const accountedHarvest = batch.openingStockKg + book.harvestedKg;
      incomingLowKg = round(Math.max(0, batch.yieldMinKg - accountedHarvest) * overlapDays / harvestDaysRemaining);
      incomingHighKg = round(Math.max(0, batch.yieldMaxKg - accountedHarvest) * overlapDays / harvestDaysRemaining);
      incomingKg = round((incomingLowKg + incomingHighKg) / 2);
      notes.push('预计待采数量扣除期初库存与累计采收入库，按剩余采收天数均摊；这是假设，不是产量预测');
    }
  }
  const supplyKg = round(book.stockKg + incomingKg);
  const expectedSalesKg = dailyKg === null ? null : round(dailyKg * windowDays);
  const remainingKg = expectedSalesKg === null ? null : round(Math.max(0, supplyKg - book.pendingKg - expectedSalesKg));
  const rawBalanceKg = expectedSalesKg === null ? null : round(supplyKg - book.pendingKg - expectedSalesKg);
  if (book.pendingKg > supplyKg) notes.push('待交付订单超过窗口可售供给，需核实履约能力');
  let status = 'insufficient';
  if (!errors.length) status = remainingKg > 0 ? (remainingDays <= 3 ? 'urgent' : 'attention') : 'clear';
  const labels = { insufficient: '信息不足', clear: '暂无明显压力', attention: '需要关注', urgent: '临近截止仍有缺口' };
  return { batchId: batch.id, date: now, status, label: labels[status], windowDays, windowEnd, remainingDays, supplyKg, incomingKg, incomingLowKg, incomingHighKg, dailyKg, expectedSalesKg, remainingKg, rawBalanceKg, pendingKg: book.pendingKg, stockKg: book.stockKg, basis, notes, errors, stale, weather: '未知 · 尚未接入天气数据', tourism: '未知 · 尚未接入旅游数据', simulated: batch.simulated, model: 'inventory-balance-v1', scenario: recent.length < 3 || incomingKg > 0, netSalesKg: book.netSalesKg };
}
function createPlan(batch, risk, now) {
  const reception = batch.reception;
  const eligible = reception.enabled && reception.capacity > 0 && reception.staff > 0 && reception.traffic && reception.startDate && reception.endDate && reception.endDate >= (now || today()) && reception.endDate <= batch.deadline;
  const local = /河南/.test(batch.region[0]);
  const factId = local && /中牟/.test(batch.region[2]) && /西瓜/.test(batch.crop) ? 'f-guadou-process' : local ? 'f-grain-origin' : null;
  const fact = factId ? catalog.facts.find(item => item.id === factId) : null;
  const sources = fact ? catalog.sources.filter(item => fact.sourceIds.includes(item.id)).map(item => ({ id: item.id, title: item.title, url: item.url })) : [];
  const culturalBasis = fact ? { factId: fact.id, title: fact.title, text: fact.text, relation: fact.id === 'f-guadou-process' ? '中牟西瓜文化阅读线索；不是发酵制作或食用教程' : '河南农耕文化延伸阅读；不主张该馆藏属于当前卖家的产地' } : null;
  const capacity = eligible ? Math.min(reception.capacity, reception.staff * 8) : 0;
  return { batchId: batch.id, status: 'draft', title: eligible ? batch.crop + '风物阅读与田间观察草案' : batch.crop + '预售与渠道协作草案', mode: 'local-constraints', capacity, simulated: batch.simulated, culturalBasis, sources,
    steps: eligible ? ['先核实场地开放、人员和交通；按接待日期分时段接收参与意向，容量上限为 ' + capacity + ' 人。', fact ? '使用列明出处的文化材料做 15 分钟阅读，明确地方事实与本次活动设想。' : '先采集并核验本地产地文化资料；核验前只做种植说明，不编造非遗身份。', '带领田间观察，隔离生产作业区域；不承诺未经核实的采摘或食品制作体验。', '自愿了解农产品与预售条件，单独确认交付日期、运输及取消方式。', '活动后记录实际参与意向、已核实销量与反馈，复盘投入。'] : ['整理品种、产量范围、可售截止日期及库存照片，核对承诺交付量。', '先与现有渠道确认需求与交付条件，登记意向，不将意向当作销售。', '按可交付数量制定预售说明并人工确认，不发布未确认的文旅活动。', '每天更新销售、订单和损耗；有真实接待条件后再设计文化活动。'],
    cost: { budget: reception.budget, perVisitorAssumption: 8, estimated: capacity * 8, description: '按每位参与者材料 8 元估算，不含人工、保险、运输和场地；费用尚未询价' },
    confirmations: ['这是未确认草案，不发布到游客可预约列表', '实际销售和接待资格需人工确认', '容量暂按每名工作人员 8 人估算，接待前需核实场地与人员安排', fact ? '文化资料有出处，图片与活动使用授权仍需核实' : '缺少本地产地文化依据，需补充真实出处', '天气与旅游需求未知，请外部核实', eligible && capacity * 8 > reception.budget ? '材料估算超过已填预算，需缩减人数或调整材料' : '逐项核实预算假设'],
    alternative: eligible ? (reception.rainyAlternative ? '遇雨先暂停田间环节，核实后采用：' + reception.rainyAlternative : '未填雨天场地，遇雨取消线下接待，改为线上文化阅读与预售说明') : '无接待能力时仅做预售、产地内容和渠道协作，不组织到访',
    riskSnapshot: risk ? { date: risk.date, status: risk.status, remainingKg: risk.remainingKg } : null, createdAt: new Date().toISOString() };
}
module.exports = { EVENT_TYPES, date, today, addDays, amount, toKg, toMu, normalizeBatch, normalizeEvent, ledger, assess, createPlan, round, clone };
