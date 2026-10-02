'use strict';
// 果灵的内容边界：《四时》只回答中国本土果品与农耕常识，纯境外问题回固定话术。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fruitScope = require('../miniprogram/data/fruit-scope');
const evidence = require('../miniprogram/lib/evidence');
const core = require('../miniprogram/lib/core');

const REFUSAL = '为外来引进我国的果品，不属于《四时》板块收录的中国本土原生水果。';
const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8');

test('the refusal sentence is written once and reused', () => {
  assert.equal(fruitScope.TEMPLATES.fruit, '{{name}}为外来引进我国的果品，不属于《四时》板块收录的中国本土原生水果。');
  assert.equal(fruitScope.TEMPLATES.topic, '{{name}}属于境外农耕文化，不属于《四时》板块收录的中国本土农耕文化。');
  for (const file of ['miniprogram/pages/search/search.js', 'miniprogram/lib/evidence.js', 'server/tasks.js']) {
    assert.doesNotMatch(read(file), /外来引进我国的果品/, file + ' must not inline the sentence');
  }
});

test('questions that only involve foreign fruit are refused with the fixed sentence', () => {
  // 车厘子已纳入樱桃别名映射，不再走境外婉拒；其余保持境外。
  for (const name of ['榴莲', '蓝莓', '牛油果', '菠萝蜜', '红毛丹']) {
    const scope = fruitScope.classify(name + '怎么种？');
    assert.equal(scope.scope, 'out', name + ' is out of scope');
    assert.equal(scope.message, name + REFUSAL);
  }
  // 番石榴/葡萄柚 里含有《四时》收录水果的名字，不能被误判成收录对象。
  assert.equal(fruitScope.classify('番石榴是什么？').scope, 'out');
  assert.equal(fruitScope.classify('葡萄柚怎么吃？').scope, 'out');
});

test('questions that only involve a foreign country or region are refused as well', () => {
  const scope = fruitScope.classify('法国的葡萄园怎么修剪？');
  assert.equal(scope.scope, 'out');
  assert.equal(scope.message, '法国属于境外农耕文化，不属于《四时》板块收录的中国本土农耕文化。');
  for (const question of ['日本的和牛怎么养', '泰国的稻田怎么灌溉', '荷兰的郁金香种植']) {
    assert.equal(fruitScope.classify(question).scope, 'out', question);
  }
});

test('domestic fruits, domestic regions and mixed questions are answered normally', () => {
  for (const question of [
    '青梅怎么腌？', '西瓜栽培技艺是省级非遗吗？', '石榴是什么时候传入中国的？', '苹果怎么贮藏？',
    '枇杷什么时候成熟？', '猕猴桃采摘时段是农历吗？', '中牟的西瓜怎么种？', '河南的苹果',
    '中国和法国种葡萄有什么不同？', '西瓜是从国外传进中国的吗？', '国外的榴莲和中国的荔枝比一比'
  ]) {
    const scope = fruitScope.classify(question);
    assert.notEqual(scope.scope, 'out', question);
    assert.equal(scope.message, '', question);
  }
  // 内蒙古、新疆等国内地名不能被当成境外。
  assert.equal(fruitScope.classify('内蒙古的苹果').scope, 'in');
  assert.equal(fruitScope.classify('新疆的哈密瓜').scope, 'in');
  // 出现境外地名又没有国内标记时，即使句子里带了收录水果名也算境外（问的是"法国的葡萄园"）。
  assert.equal(fruitScope.classify('法国的葡萄园怎么修剪？').scope, 'out');
  assert.equal(fruitScope.classify('中国的葡萄和法国的葡萄有什么不同？').scope, 'mixed');
});

test('the ask gate returns the fixed sentence and stays unanswerable', () => {
  const answer = core.answerQuestion('榴莲怎么种？');
  assert.equal(answer.unanswerable, true);
  assert.equal(answer.answer, fruitScope.refusalText(fruitScope.classify('榴莲怎么种？')));
  assert.ok(answer.answer.startsWith('榴莲' + REFUSAL));
  assert.deepEqual(answer.evidenceIds, []);
  assert.deepEqual(answer.sourceIds, []);
  // 涉及国内外的问题照常走资料检索。
  const mixed = evidence.answerQuestion('西瓜栽培技艺是什么级别的非遗？', 'summer-culture');
  assert.equal(mixed.unanswerable, false);
  assert.ok(mixed.evidenceIds.length > 0);
});

test('a refusal is not a dead end: it points at the nearest in-scope fruit', () => {
  // 固定话术本身一字不改；引导是补在后面的一句。
  const durian = fruitScope.classify('榴莲怎么种？');
  assert.equal(durian.message, '榴莲' + REFUSAL);
  assert.deepEqual(durian.suggestions, ['荔枝', '龙眼', '黄皮']);
  assert.equal(fruitScope.refusalText(durian), '榴莲' + REFUSAL + '可以试试《四时》收录的荔枝、龙眼、黄皮。');
  // 车厘子已纳入樱桃别名映射，本地内容边界不再拦截，故 classify 返回 in。
  assert.equal(fruitScope.classify('车厘子怎么挑').scope, 'in');
  // 引导指向的必须真的在《四时》收录范围内。
  const collected = fruitScope.collectedNames();
  for (const [name, hints] of Object.entries(fruitScope.REDIRECTS)) {
    assert.ok(fruitScope.OUT_OF_SCOPE_FRUITS.includes(name), name + ' must be listed as out of scope');
    assert.ok(hints.length, name + ' needs at least one suggestion');
    for (const hint of hints) assert.ok(collected.includes(hint), name + ' suggests an uncollected fruit: ' + hint);
  }
});

test('the boundary is a policy switch, not a hardcoded limit', () => {
  const source = read('miniprogram/data/fruit-scope.js');
  assert.match(source, /const ENABLED = true;/, 'the whole boundary can be turned off in one line');
  assert.match(source, /const REDIRECT_HINT = true;/, 'the guidance hint is switchable too');
  assert.match(source, /if \(!ENABLED \|\| !text\.trim\(\)\) return \{ scope: 'in'/);
  assert.equal(fruitScope.ENABLED, true);
  assert.equal(fruitScope.REDIRECT_HINT, true);
});

test('the Guoling search page refuses foreign fruit and still finds world-layer fruit', () => {
  let definition;
  global.Page = value => { definition = value; };
  global.wx = { getStorageSync: () => undefined, setStorageSync() {}, showToast() {}, navigateTo() {} };
  const file = path.resolve(__dirname, '../miniprogram/pages/search/search.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  page.onLoad();
  assert.equal(typeof page.data.L.search_no_result, 'string');
  page.doSearch('榴莲');
  page.finishSearch('榴莲');
  assert.equal(page.data.empty, true);
  assert.ok(page.data.emptyNote.startsWith('榴莲' + REFUSAL));
  assert.match(page.data.emptyNote, /可以试试《四时》收录的荔枝/);
  // 外圈世界风物也能搜到（此前只覆盖内圈 13 种）。
  page.doSearch('枇杷');
  page.finishSearch('枇杷');
  assert.equal(page.data.empty, false);
  assert.ok(page.data.matched.some(item => item.name === '枇杷'));
  page.finishSearch('不存在的问法');
  assert.equal(page.data.emptyNote, page.data.L.search_no_result);
});

test('fruit story generation never invents foreign farming culture', () => {
  const tasks = require('../server/tasks');
  const config = { provider: 'openai-compatible', timeoutMs: 1000 };
  const transport = { request: () => { throw new Error('模型不应该被调用'); } };
  const instance = tasks.createTasks({ config, catalog: require('../miniprogram/data/catalog'), core, transport });
  return instance.run('fruitStory', { keyword: '榴莲', language: 'zh' }).then(result => {
    assert.equal(result.outOfScope, true);
    assert.equal(result.zh, '榴莲' + REFUSAL);
    assert.equal(result.mode, 'out-of-scope');
    assert.match(result.en, /introduced to China from abroad/);
  });
});

test('the ask system prompt carries the same content boundary', () => {
  const source = read('server/tasks.js');
  assert.match(source, /SCOPE_RULE/);
  assert.match(source, /内容边界：只回答中国本土的果品与农耕常识/);
  assert.match(source, /fruitScope\.classify\(fruit\)/, 'fruit stories check the scope before calling the model');
});
