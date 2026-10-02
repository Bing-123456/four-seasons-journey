'use strict';

// L3/L4 检索融合层的行为锁定。
//
// 背景：为了让「我们的检索质量有多少来自算法、多少来自人工标注」这个问题可回答，
// 给检索内核加了两个可选能力：
//   ① rrf()  —— 把词法名次与稠密名次融合（纯函数，无环境依赖）
//   ② retrieve(q, placeId, catalog, options) —— 通过 options.ranker 切换排序器
// 两者都必须是**默认不生效**的：小程序端拿不到向量，走的永远是纯词法路径，
// 行为要与加这一层之前逐字节一致。
//
// 实测得到的两条重要事实（测试里固化为回归防线）：
//   - 经过 subject/intent 闸门后，候选池**恒为 1 条**，排序器无发挥空间；
//   - 因此稠密名次只能改变顺序，**绝不能把闸门之外的事实带进候选**。
const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../miniprogram/lib/evidence');
const catalog = require('../miniprogram/data/catalog');

const ids = list => list.map(item => item.id);

test('rrf fuses by rank, not by score scale', () => {
  // 「a」在两个列表里都靠前，应当胜出；「d」只在一个列表里出现且垫底。
  assert.deepEqual(ids(evidence.rrf([['a', 'b', 'c'], ['c', 'a', 'd']])), ['a', 'c', 'b', 'd']);
});

test('rrf weights let a weaker ranker be discounted', () => {
  // 词法权重压到 0.2 后，稠密排第一的「c」应当反超。
  assert.deepEqual(ids(evidence.rrf([['a', 'b', 'c'], ['c', 'a', 'd']], 60, [0.2, 1])), ['c', 'a', 'd', 'b']);
});

test('rrf weight of zero removes that ranker entirely', () => {
  // 词法权重为 0 时它整张列表都不参与，「b」应当彻底消失（只在词法里出现过）。
  assert.deepEqual(ids(evidence.rrf([['a', 'b', 'c'], ['c', 'a', 'd']], 60, [0, 1])), ['c', 'a', 'd']);
});

test('rrf accepts both bare ids and {id, score} entries', () => {
  // 「b」在两个列表里都出现，累积分数高于只出现一次的「a」，所以 b 在前。
  // 这条验证的是两种条目形式都能被正确解析——旧版的 {id, score} 与纯字符串结果一致。
  const mixed = evidence.rrf([[{ id: 'a', score: 9 }, { id: 'b', score: 1 }], [{ id: 'b', score: 0.9 }]]);
  const bare = evidence.rrf([['a', 'b'], ['b']]);
  assert.deepEqual(ids(mixed), ['b', 'a']);
  assert.deepEqual(ids(mixed), ids(bare));
});

test('rrf ignores entries without an id', () => {
  assert.deepEqual(ids(evidence.rrf([['a', null, undefined, { score: 1 }]])), ['a']);
});

test('retrieve without options keeps the pre-fusion behaviour', () => {
  const plain = evidence.retrieve('做瓜豆酱用啥东西', 'summer-kitchen');
  const explicit = evidence.retrieve('做瓜豆酱用啥东西', 'summer-kitchen', null, { ranker: 'lexical' });
  assert.deepEqual(ids(plain.candidates), ['f-guadou-process']);
  assert.deepEqual(ids(explicit.candidates), ids(plain.candidates));
  assert.equal(plain.subject, 'sauce');
  assert.equal(plain.intent, 'ingredients');
});

test('the gate compresses the candidate pool to a single fact', () => {
  // 这条是实测结论，不是期望值：闸门用 subject+intent 两个离散标签直接定位到唯一事实。
  // 一旦它不再成立（例如标注被改宽），排序器才开始有发挥空间——所以要盯着。
  for (const [question, placeId] of [['做瓜豆酱用啥东西', 'summer-kitchen'], ['猕猴桃的果心颜色', 'autumn-orchard'], ['磨棒怎样使用', 'summer-culture']]) {
    const result = evidence.retrieve(question, placeId);
    assert.equal(result.candidates.length, 1, question + ' 的候选池应当只有 1 条');
  }
});

test('dense ranking cannot introduce a fact the gate did not approve', () => {
  // 稠密名次把一条无关事实排在第一——它必须被闸门挡住，不能进候选。
  const result = evidence.retrieve('做瓜豆酱用啥东西', 'summer-kitchen', null, {
    ranker: 'hybrid',
    denseRanking: [{ id: 'f-apple-storage' }, { id: 'f-kiwi-colors' }, { id: 'f-guadou-process' }]
  });
  assert.deepEqual(ids(result.candidates), ['f-guadou-process']);
});

test('a question the gate refuses stays refused even with dense results', () => {
  // 「瓜豆酱发酵的安全温度」在本地闸门就该被拒（资料库没有发酵参数）。
  // 语义层再自信也不能推翻这个判定——拒答是第一道，排序是第二道。
  const result = evidence.retrieve('瓜豆酱发酵的安全温度', 'summer-kitchen', null, {
    ranker: 'hybrid',
    denseRanking: [{ id: 'f-guadou-process' }, { id: 'f-guadou-local' }]
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.local.unanswerable, true);
});

test('an unknown place id still reports the entry error, not a retrieval result', () => {
  const result = evidence.retrieve('猕猴桃的果心颜色', 'autumn-field');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.local.answer, '没有找到这个文化条目，请重新选择。');
  assert.ok(catalog.places.some(place => place.id === 'autumn-orchard'), '正确的地点 id 应当是 autumn-orchard');
});
