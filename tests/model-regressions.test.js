'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const evidence = require('../miniprogram/lib/evidence');
const validation = require('../server/validation');
const { createTasks } = require('../server/tasks');
const clone = value => JSON.parse(JSON.stringify(value));
const tasks = transport => createTasks({ config: { provider: 'openai-compatible', timeoutMs: 30 }, catalog, core, transport });

test('lexical retrieval handles ingredient paraphrases and an explicit cultural context', () => {
  for (const question of ['瓜豆酱的原料有哪些？', '瓜豆酱用啥做的？', '做这个酱需要哪些东西？', '青谷堆的酱用什么做？']) {
    const result = evidence.answerQuestion(question, 'summer-kitchen');
    assert.equal(result.unanswerable, false, question);
    assert.deepEqual(result.evidenceIds, ['f-guadou-process'], question);
    assert.match(result.answer, /黄豆和西瓜/);
  }
});

test('question intent separates protected level from list counts and tool motion from origin', () => {
  assert.deepEqual(evidence.answerQuestion('这种种瓜手艺被列入哪一级保护名录？').evidenceIds, ['f-watermelon-heritage']);
  assert.deepEqual(evidence.answerQuestion('郑州市第六批名录有多少项？').evidenceIds, ['f-heritage-batch']);
  assert.deepEqual(evidence.answerQuestion('裴李岗农具是转圈还是前后碾？').evidenceIds, ['f-grain-motion']);
  assert.deepEqual(evidence.answerQuestion('裴李岗磨棒怎样使用？').evidenceIds, ['f-grain-motion']);
  assert.deepEqual(evidence.answerQuestion('裴李岗磨盘出土在哪里？').evidenceIds, ['f-grain-origin']);
});

test('real Henan museum address and published visit policy are answerable with sources', () => {
  for (const question of ['河南博物院在哪里？', '河南博物院地址是什么？']) {
    const result = evidence.answerQuestion(question);
    assert.equal(result.unanswerable, false, question);
    assert.deepEqual(result.evidenceIds, ['f-henan-museum-address']);
    assert.match(result.answer, /郑州市农业路8号/); assert.ok(result.sourceIds.includes('S14'));
  }
  const policy = evidence.answerQuestion('河南博物院常规参观需要预约吗？');
  assert.deepEqual(policy.evidenceIds, ['f-henan-museum-visit']); assert.match(policy.answer, /当日信息为准/);
});

test('museum today and tomorrow questions refuse with official-channel direction, also in context', () => {
  for (const question of ['河南博物院明天能去吗？', '今天有票吗？', '明天能去吗？']) {
    const result = evidence.answerQuestion(question, 'summer-culture');
    assert.equal(result.unanswerable, true, question); assert.deepEqual(result.sourceIds, []);
    assert.match(result.answer, /河南博物院官网.*参观服务/);
  }
});

test('Dahecun settlement and dated opening record remain distinct from live opening', () => {
  const period = evidence.answerQuestion('大河村有哪些文化时期的遗存？');
  assert.deepEqual(period.evidenceIds, ['f-dahecun-settlement']);
  assert.match(period.answer, /仰韶文化、龙山文化/); assert.deepEqual(period.sourceIds, ['S12']);
  const opening = evidence.answerQuestion('大河村新馆什么时候开放的？');
  assert.deepEqual(opening.evidenceIds, ['f-dahecun-opening']); assert.match(opening.answer, /2025年12月12日/);
  assert.match(opening.answer, /当年12月6日/);
  const live = evidence.answerQuestion('大河村今天开放吗？');
  assert.equal(live.unanswerable, true); assert.match(live.answer, /官方服务渠道/);
  assert.equal(evidence.answerQuestion('大河村遗址是西安的吗？').unanswerable, true);
});

test('unknown objects, incompatible regions, unsupported grades and live assumptions refuse', () => {
  for (const question of ['讲讲兵马俑的故事', '介绍敦煌壁画', '讲讲苏绣的文化', '青谷堆瓜豆酱是四川的手艺吗？', '介绍南京的瓜豆酱', '瓜豆酱用的黄豆是进口的吗？', '瓜豆酱来自新郑吗？', '猕猴桃是国家级非遗吗？', '瓜豆酱是省级非遗吗？', '瓜豆酱今天有体验课程吗？', '裴李岗磨盘为什么这样运动？', '瓜豆酱发酵温度是多少？']) {
    const result = evidence.answerQuestion(question, 'summer-kitchen');
    assert.equal(result.unanswerable, true, question);
    assert.deepEqual(result.evidenceIds, [], question);
    assert.deepEqual(result.sourceIds, [], question);
  }
});

test('unconfirmed heritage levels and unknown objects cannot inherit a list or another fact', () => {
  for (const question of ['瓜豆酱是哪一级非遗？', '瓜豆酱是县级非遗吗？', '剪纸第六批名录有多少项？']) {
    const result = evidence.answerQuestion(question);
    assert.equal(result.unanswerable, true, question); assert.deepEqual(result.sourceIds, []);
  }
  assert.deepEqual(evidence.answerQuestion('第六批名录有多少项？').evidenceIds, ['f-heritage-batch']);
});

test('explicit unrelated Henan entities cannot borrow each other\'s facts or imply a venue attribution', () => {
  for (const question of ['大河村的瓜豆酱有哪些原料？', '河南博物院里的瓜豆酱怎么做？', '青谷堆的猕猴桃有哪些果心颜色？', '大河村的裴李岗磨棒怎么使用？']) {
    const result = evidence.answerQuestion(question, 'summer-kitchen');
    assert.equal(result.unanswerable, true, question); assert.deepEqual(result.evidenceIds, []); assert.deepEqual(result.sourceIds, []);
    assert.match(result.answer, /归属关系|分别提问/);
  }
});

test('documented museum/tool relation and a single supported compound process question remain answerable', () => {
  const tool = evidence.answerQuestion('河南博物院介绍的裴李岗磨棒怎样使用？');
  assert.deepEqual(tool.evidenceIds, ['f-grain-motion']); assert.deepEqual(tool.sourceIds, ['S9']);
  const ingredients = evidence.answerQuestion('瓜豆酱的原料有西瓜和黄豆，涉及哪些制作工序？');
  assert.deepEqual(ingredients.evidenceIds, ['f-guadou-process']);
  const separate = evidence.answerQuestion('河南博物院在哪里，以及裴李岗磨棒怎样使用？');
  assert.equal(separate.unanswerable, true); assert.match(separate.answer, /分开提问/);
  const aliases = evidence.answerQuestion('西瓜龙舞是什么非遗？');
  assert.deepEqual(aliases.evidenceIds, ['f-dragon-name']);
});

test('cloud cannot answer unsupported entity attribution and receives no unrelated candidate', async () => {
  let calls = 0;
  const runner = tasks(async () => { calls++; return { evidenceIds: ['f-guadou-process'], unanswerable: false }; });
  const result = await runner.run('ask', { question: '大河村的瓜豆酱有哪些原料？', placeId: 'summer-kitchen' });
  assert.equal(result.unanswerable, true); assert.deepEqual(result.evidenceIds, []); assert.equal(calls, 0);
});

test('retrieval scans full catalog, while only subject/intent-compatible facts become model candidates', () => {
  const result = evidence.retrieve('瓜豆酱原料是什么？', 'summer-kitchen');
  assert.ok(result.candidates.length);
  assert.ok(result.candidates.every(candidate => candidate.id === 'f-guadou-process'));
  assert.equal(result.local.retrievalMethod, 'lexical-bm25-intent-gates');
});

test('unsupported query never calls model; timeout fallback keeps only relevant evidence', async () => {
  let calls = 0;
  const runner = tasks(async () => { calls++; return new Promise(() => {}); });
  const bad = await runner.run('ask', { question: '讲讲兵马俑的故事', placeId: 'summer-kitchen' });
  assert.equal(bad.unanswerable, true); assert.equal(calls, 0);
  const good = await runner.run('ask', { question: '做这个酱需要哪些东西？', placeId: 'summer-kitchen' });
  assert.equal(good.fallbackReason, 'model_timeout');
  assert.deepEqual(good.evidenceIds, ['f-guadou-process']); assert.equal(calls, 1);
});

test('model cannot replace valid retrieved ingredient evidence with an existing unrelated fact', async () => {
  const result = await tasks(async () => ({ evidenceIds: ['f-kiwi-case'], unanswerable: false })).run('ask', { question: '瓜豆酱的原料？' });
  assert.equal(result.fallbackReason, 'model_invalid_output');
  assert.deepEqual(result.evidenceIds, ['f-guadou-process']);
});

test('cloud evidence wording is constructed from catalog even when model adds fabricated prose', async () => {
  const result = await tasks(async () => ({ evidenceIds: ['f-grain-motion'], unanswerable: false, answer: '这是飞行器' })).run('ask', { question: '裴李岗磨棒怎么使用？' });
  assert.equal(result.mode, 'openai-compatible');
  assert.equal(result.answer, catalog.facts.find(fact => fact.id === 'f-grain-motion').text);
});

test('full profile replacement is rejected and unspecified fields and missing notices survive', async () => {
  const base = clone(catalog.defaultProfile);
  const result = await tasks(async () => ({ profile: { ...base, budget: 99999, partySize: 20, duration: 720 }, missingFields: [] })).run('profile', { text: '喜欢拍照', base });
  assert.equal(result.mode, 'local-rules'); assert.equal(result.fallbackReason, 'model_invalid_output');
  for (const field of ['budget', 'partySize', 'duration', 'date', 'startTime']) {
    assert.equal(result.profile[field], base[field]); assert.ok(result.missingFields.includes(field));
  }
  assert.deepEqual(result.profile.interests, ['photo']);
});

test('profile changes require a real span, field semantics and matching deterministic value', async () => {
  const base = clone(catalog.defaultProfile);
  const invalid = [
    { field: 'budget', value: 99999, evidenceSpan: '喜欢拍照' },
    { field: 'budget', value: 250, evidenceSpan: '预算250元' },
    { field: 'partySize', value: 20, evidenceSpan: '喜欢拍照' },
    { field: 'optInSupport', value: true, evidenceSpan: '喜欢拍照' },
    { field: 'origin', value: null, evidenceSpan: '喜欢拍照' }
  ];
  for (const change of invalid) {
    const result = await tasks(async () => ({ changes: [change] })).run('profile', { text: '喜欢拍照', base });
    assert.equal(result.fallbackReason, 'model_invalid_output', change.field);
    assert.equal(result.profile.budget, base.budget);
    assert.equal(result.profile.optInSupport, base.optInSupport);
  }
  const mismatch = await tasks(async () => ({ changes: [{ field: 'budget', value: 99999, evidenceSpan: '预算250元' }] })).run('profile', { text: '预算250元', base });
  assert.equal(mismatch.fallbackReason, 'model_invalid_output'); assert.equal(mismatch.profile.budget, 250);
});

test('valid cloud increments preserve unknown conditions and cannot hide missing notices', async () => {
  const result = await tasks(async () => ({ changes: [{ field: 'transport', value: 'bike', evidenceSpan: '骑车' }, { field: 'budget', value: 250, evidenceSpan: '预算250元' }] })).run('profile', { text: '骑车，预算250元', base: clone(catalog.defaultProfile) });
  assert.equal(result.mode, 'openai-compatible'); assert.equal(result.profile.transport, 'bike'); assert.equal(result.profile.budget, 250);
  assert.deepEqual(result.missingFields, ['date', 'startTime', 'duration', 'partySize']);
});

test('deterministic parser handles denied preferences, corrected people and two-and-half hours', () => {
  const parsed = core.parseProfile('我不去看文化，只想摄影；不要自驾，我要骑车；不是两个人，是三个人，玩两个半小时。', catalog.defaultProfile);
  assert.deepEqual(parsed.profile.interests, ['photo']); assert.equal(parsed.profile.transport, 'bike');
  assert.equal(parsed.profile.partySize, 3); assert.equal(parsed.profile.duration, 150);
  assert.ok(!parsed.missingFields.includes('duration')); assert.ok(!parsed.missingFields.includes('partySize'));
  const ambiguous = core.parseProfile('自驾或者骑车都可以', catalog.defaultProfile);
  assert.ok(ambiguous.missingFields.includes('transport'));
  assert.equal(ambiguous.profile.transport, catalog.defaultProfile.transport);
});

test('cloud increments respect explicit negation and request confirmation for ambiguous transport', async () => {
  const base = clone(catalog.defaultProfile);
  const result = await tasks(async () => ({ changes: [
    { field: 'transport', value: 'bike', evidenceSpan: '我要骑车' },
    { field: 'interests', value: ['photo'], evidenceSpan: '我不去看文化，只想摄影' }
  ] })).run('profile', { text: '我不去看文化，只想摄影；不要自驾，我要骑车', base });
  assert.equal(result.mode, 'openai-compatible'); assert.deepEqual(result.profile.interests, ['photo']);
  assert.equal(result.profile.transport, 'bike'); assert.equal(result.profile.budget, base.budget);
  const uncertain = await tasks(async () => ({ changes: [{ field: 'transport', value: 'drive', evidenceSpan: '自驾或者骑车都可以' }] })).run('profile', { text: '自驾或者骑车都可以', base });
  assert.equal(uncertain.fallbackReason, 'model_invalid_output'); assert.ok(uncertain.missingFields.includes('transport'));
  const duration = await tasks(async () => ({ changes: [{ field: 'duration', value: 150, evidenceSpan: '玩两个半小时' }] })).run('profile', { text: '玩两个半小时', base });
  assert.equal(duration.profile.duration, 150); assert.equal(duration.mode, 'openai-compatible');
});

test('location never enters upstream profile prompt and cannot be proposed by the model', async () => {
  const origin = { name: '私有出发点', address: '隐私地址', latitude: 34.7, longitude: 113.7, coordinateSystem: 'gcj02', source: 'user' };
  let payload;
  const result = await tasks(async ({ prompt }) => { payload = prompt.user; return { changes: [] }; }).run('profile', { text: '喜欢文化', base: { ...clone(catalog.defaultProfile), origin } });
  assert.ok(!payload.includes('私有出发点')); assert.ok(!payload.includes('隐私地址')); assert.ok(!payload.includes('latitude'));
  assert.deepEqual(result.profile.origin, origin);
});
