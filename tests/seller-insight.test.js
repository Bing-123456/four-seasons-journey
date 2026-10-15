'use strict';

// /api/seller-insight: request normalization and the output contract. The
// deterministic status is the only risk authority — a model that echoes a
// different status loses the whole turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../server/validation');

function input() {
  return {
    batch: {
      name: '本机试填', crop: '西瓜', variety: '', region: ['河南省', '郑州市', '中牟县'], areaMu: 1,
      harvestStart: '2026-09-21', harvestEnd: '2026-09-27', deadline: '2026-09-27',
      reception: { enabled: true, capacity: 10, staff: 2 }
    },
    risk: { status: 'attention', label: '需要关注', windowDays: 7, remainingKg: 30, supplyKg: 100, expectedSalesKg: 70, pendingKg: 0 },
    weather: { available: true, label: '未来 7 天有 2 天降雨', rainDays: 2, windowRainDays: 1 },
    tourism: { totalTrips: 3, totalParties: 9, top: [{ name: '河南博物院', month: '2026-09', parties: 6 }] },
    culture: [],
    limits: { maxCapacity: 80, maxBudget: 300 }
  };
}

test('request normalization clamps and validates every field group', () => {
  const parsed = validation.sellerInsightRequest(input());
  assert.equal(parsed.risk.status, 'attention');
  assert.equal(parsed.batch.region[1], '郑州市');
  assert.equal(parsed.weather.rainDays, 2);
  assert.equal(parsed.tourism.top[0].parties, 6);
  assert.equal(parsed.limits.maxCapacity, 80);

  const badRegion = input(); badRegion.batch.region = ['河南省'];
  assert.throws(() => validation.sellerInsightRequest(badRegion), /地区无效/);

  const badStatus = input(); badStatus.risk.status = 'critical';
  assert.throws(() => validation.sellerInsightRequest(badStatus));

  const badMonth = input(); badMonth.tourism.top = [{ name: 'x', month: '2026-13', parties: 1 }];
  assert.throws(() => validation.sellerInsightRequest(badMonth), /月份无效/);
});

test('output contract accepts a well-formed insight bound by rule limits', () => {
  const parsed = validation.sellerInsightRequest(input());
  const output = validation.sellerInsight({
    status: 'attention', reading: '窗口 7 天预计剩余约 30 公斤，建议尽快组织到访消化库存，避开雨天采收。',
    suggestions: ['按周拆解销售节奏', '小规模试接待'],
    planTitle: '瓜田到访体验', planSteps: ['核对文化出处', '发布到访草案', '记录执行反馈'],
    capacity: 16, budget: 128, alternative: '雨天改为线上预售'
  }, parsed);
  assert.equal(output.status, 'attention');
  assert.equal(output.capacity, 16);
  assert.equal(output.planSteps.length, 3);
});

test('a status echo that disagrees with the rules invalidates the entire output', () => {
  const parsed = validation.sellerInsightRequest(input());
  const hopeful = { status: 'clear', reading: '一切正常，无需担心库存积压问题，请放心安排后续工作。', suggestions: ['a', 'b'], planTitle: 't', planSteps: ['s1', 's2', 's3'] };
  assert.throws(() => validation.sellerInsight(hopeful, parsed), /状态与程序测算不一致/);
});

test('capacity or budget beyond the rule limits is rejected', () => {
  const parsed = validation.sellerInsightRequest(input());
  const greedy = {
    status: 'attention', reading: '解读文字长度符合要求，测试容量越界的情况是否被正确拒绝掉。',
    suggestions: ['a', 'b'], planTitle: 't', planSteps: ['s1', 's2', 's3'], capacity: 999
  };
  assert.throws(() => validation.sellerInsight(greedy, parsed));
  greedy.capacity = 10; greedy.budget = 100000;
  assert.throws(() => validation.sellerInsight(greedy, parsed));
});

test('shape violations on reading and suggestions fall back, never pass through', () => {
  const parsed = validation.sellerInsightRequest(input());
  const short = { status: 'attention', reading: '短', suggestions: ['a', 'b'], planTitle: 't', planSteps: ['s1', 's2', 's3'] };
  assert.throws(() => validation.sellerInsight(short, parsed), /解读过短/);
  const one = { status: 'attention', reading: '这是一条足够长的解读文本，用于测试建议数量不足时的表现。', suggestions: ['唯一'], planTitle: 't', planSteps: ['s1', 's2', 's3'] };
  assert.throws(() => validation.sellerInsight(one, parsed), /建议无效/);
});

// v59：语言字段与英文侧长度上限。中文侧数值（10/160、建议 ≤60、步骤 ≤90、标题 ≤40）一个没动，
// 英文侧（400 / 180 / 270 / 120）只在 lang === 'en' 时生效，且要与客户端同口径校验
// （miniprogram/lib/service.js 的 sellerInsight）保持一致。
test('v59 lang defaults to zh, accepts only en, and relaxes length caps for English alone', () => {
  assert.equal(validation.sellerInsightRequest(input()).lang, 'zh', '老客户端不传 lang 时必须按 zh');
  assert.equal(validation.sellerInsightRequest(Object.assign(input(), { lang: 'zh' })).lang, 'zh');
  assert.equal(validation.sellerInsightRequest(Object.assign(input(), { lang: 'en' })).lang, 'en');
  assert.equal(validation.sellerInsightRequest(Object.assign(input(), { lang: 'fr' })).lang, 'zh', '只认 en，其余一律按 zh');
  assert.equal(validation.sellerInsightRequest(Object.assign(input(), { lang: null })).lang, 'zh');

  const zh = validation.sellerInsightRequest(input());
  const en = validation.sellerInsightRequest(Object.assign(input(), { lang: 'en' }));
  // reading 300 字符 / 每条建议 120 字符 / 每条步骤 200 字符：三处都超中文口径，都在英文口径内
  const longEnglish = {
    status: 'attention', reading: 'a'.repeat(300),
    suggestions: ['b'.repeat(120), 'c'.repeat(120)], planTitle: 'orchard weekend session',
    planSteps: ['d'.repeat(200), 'e'.repeat(200), 'f'.repeat(200)], capacity: 30, budget: 120,
    alternative: 'g'.repeat(300)
  };
  const accepted = validation.sellerInsight(longEnglish, en);
  assert.equal(accepted.reading.length, 300, '英文长解读不再被判无效');
  assert.equal(accepted.planSteps[0].length, 200, '英文长步骤不再被判无效');
  assert.equal(accepted.suggestions[0].length, 120);
  assert.equal(accepted.planTitle, 'orchard weekend session');
  // 中文侧：同一份超长英文结果仍按老上限整条拒（防回归）
  assert.throws(() => validation.sellerInsight(longEnglish, zh), /解读为空或过长/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, reading: 'a'.repeat(150) }, zh), /建议无效/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, reading: 'a'.repeat(150), suggestions: ['b', 'c'] }, zh), /步骤无效/);

  // 中文侧老上限逐条仍在：161 字解读 / 61 字建议 / 91 字步骤照样拒
  const zhBase = { status: 'attention', reading: '这是一条足够长的中文解读文本，用来核对中文侧的老上限是否原样保留下来。', suggestions: ['按周拆解销售节奏', '小规模试接待'], planTitle: '瓜田到访体验', planSteps: ['核对文化出处', '发布到访草案', '记录执行反馈'] };
  assert.equal(validation.sellerInsight(zhBase, zh).reading.length, zhBase.reading.length);
  assert.throws(() => validation.sellerInsight({ ...zhBase, reading: '一'.repeat(161) }, zh), /解读为空或过长/);
  assert.throws(() => validation.sellerInsight({ ...zhBase, suggestions: ['一'.repeat(61), 'b'] }, zh), /建议无效/);
  assert.throws(() => validation.sellerInsight({ ...zhBase, planSteps: ['一'.repeat(91), 's2', 's3'] }, zh), /步骤无效/);
  assert.throws(() => validation.sellerInsight({ ...zhBase, planTitle: '一'.repeat(41) }, zh), /方案标题为空或过长/);

  // 英文侧也有上限：401 字解读 / 181 字建议 / 271 字步骤照样拒
  assert.throws(() => validation.sellerInsight({ ...longEnglish, reading: 'a'.repeat(401) }, en), /解读为空或过长/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, suggestions: ['b'.repeat(181), 'c'] }, en), /建议无效/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, planSteps: ['d'.repeat(271), 'e', 'f'] }, en), /步骤无效/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, planTitle: '一'.repeat(121) }, en), /方案标题为空或过长/);

  // 标题：英文侧上限 120、中文侧仍是 40；空标题按既有规则照样判无效（兜底常量 'AI plan draft'
  // 与中文侧 'AI 文旅方案草案' 只是同一处的假值兜底，行为与改动前一致：空串先被 text() 拦下）。
  assert.equal(validation.sellerInsight({ ...longEnglish, planTitle: 'a'.repeat(120) }, en).planTitle.length, 120);
  assert.throws(() => validation.sellerInsight({ ...zhBase, planTitle: '' }, zh), /方案标题为空或过长/);
  assert.throws(() => validation.sellerInsight({ ...longEnglish, planTitle: '' }, en), /方案标题为空或过长/);
});

