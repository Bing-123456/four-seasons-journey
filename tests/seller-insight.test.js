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
