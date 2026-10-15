'use strict';

// 2026-10-11：农事转盘「知识卡」英文版（challenge-explanations-en.js）的结构、规矩与渲染路径守卫。
// 背景：中文知识库 150 条没有英文版，英文模式下知识卡会退回 AI。用户决定把 150 条也翻成英文。
// 守四件事：① 与中文侧同一批 id、一条不差 ② 每段非空、长度合理
// ③ 「只译不添」——普通果名不许留在英文里（专名/谐音梗/传统食物名按规矩保留中文，不在此列）
// ④ 渲染路径：中文取中文库+「原因：」，英文取英文库+「Reason: 」，标签能被正确拆出来。
const test = require('node:test');
const assert = require('node:assert/strict');

const map = new Map();
global.wx = { getStorageSync: key => map.get(key), setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key), showToast() {}, navigateTo() {} };

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const game = require('../miniprogram/packageGame/lib/challenge-game');
const zh = require('../miniprogram/packageGame/data/challenge-explanations');
const en = require('../miniprogram/packageGame/data/challenge-explanations-en');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }
const ID = 'c-plum-store';   // 有独立 id 的一条（中文库里同样存在）

test.beforeEach(() => { map.clear(); store.exitDemo(); store.clearAll(); useLang('zh'); });

test('English knowledge base keeps exactly the same 150 ids as the Chinese one', () => {
  const zhIds = Object.keys(zh);
  const enIds = Object.keys(en);
  assert.equal(zhIds.length, 150, '中文侧仍是 150 条');
  assert.deepEqual(enIds, zhIds, 'id 顺序与集合都要与中文侧一致（一条不差、不增）');
});

test('every English knowledge point has both paragraphs, non-empty and in a sane length', () => {
  Object.keys(en).forEach(id => {
    const item = en[id];
    assert.ok(item && typeof item.cause === 'string' && item.cause.trim(), id + ' 缺 cause');
    assert.ok(item && typeof item.origin === 'string' && item.origin.trim(), id + ' 缺 origin');
    ['cause', 'origin'].forEach(key => {
      const words = item[key].trim().split(/\s+/).length;
      assert.ok(words >= 35 && words <= 150, id + ' 的 ' + key + ' 词数异常：' + words);
      assert.doesNotMatch(item[key], /资料|素材库|习俗|农事/, id + ' 的 ' + key + ' 里出现了该译成英文的日常中文词');
    });
    assert.notEqual(item.cause.trim(), item.origin.trim(), id + ' 两段不能一模一样');
  });
});

test('ordinary fruit names are translated, not left in Chinese', () => {
  // 判定只针对**正文散文**：以下两类按规矩保留中文，先剔除再判，避免误报——
  // ① 引句与书名整段：「于嗟鸠兮，无食桑葚」、《荔枝谱》、「霜降摘柿子」、「一颗荔枝三把火」…
  // ② 传统食物名：荔枝干、柿饼、桃脯、话梅、山楂糕…（与「柿饼」同类，规则要求保留中文）
  const FOODS = /(荔枝干|柿饼|月形柿饼|桃脯|桃干|话梅|乌梅|酸梅汤|青梅酒|山楂糕|山楂片|果丹皮|枣泥|枣糕|杏皮水)/g;
  const prose = text => String(text)
    .replace(/「[^」]*」/g, ' ')
    .replace(/《[^》]*》/g, ' ')
    .replace(FOODS, ' ');
  const plain = ['柿子', '荔枝', '柚子', '猕猴桃', '枇杷', '桑葚', '金桔', '砂糖橘'];
  const offenders = [];
  Object.keys(en).forEach(id => {
    const body = prose(en[id].cause) + ' ' + prose(en[id].origin);
    plain.forEach(word => { if (body.indexOf(word) !== -1) offenders.push(id + ' → ' + word); });
  });
  assert.deepEqual(offenders, [], '普通果名必须译成英文（引句/书名/传统食物名里的不算）：' + offenders.join(', '));
});

test('solar terms inside the English knowledge base use pinyin, like the rest of the English corpus', () => {
  const all = Object.keys(en).map(id => en[id].cause + ' ' + en[id].origin).join('\n');
  assert.match(all, /Shuangjiang/, '霜降 应写作 Shuangjiang');
  assert.match(all, /Mangzhong/, '芒种 应写作 Mangzhong');
  const OFFICIAL = ['Frost\'s Descent', 'Grain in Ear', 'Awakening of Insects', 'Autumn Equinox', 'Cold Dew', 'White Dew', 'Pure Brightness', 'Light Snow'];
  const left = OFFICIAL.filter(v => all.indexOf(v) !== -1);
  assert.deepEqual(left, [], '不该混用官方译名：' + left.join(', '));
  assert.doesNotMatch(all, /the winter solstice|the start of spring|the autumn equinox/i, '不该混用描述式写法');
});

test('the Chinese knowledge base is untouched', () => {
  const zhIds = Object.keys(zh);
  assert.equal(zhIds.length, 150);
  zhIds.forEach(id => {
    assert.ok(zh[id].cause && zh[id].origin, id + ' 中文侧两段都要在');
    assert.doesNotMatch(zh[id].cause, /Reason/, id + ' 中文侧不该混进英文标签');
  });
});

test('knowledge card reads the Chinese book in Chinese mode, the English book in English mode', () => {
  useLang('zh');
  const zhPoints = game.knowledgePointsFor({ id: ID });
  assert.equal(zhPoints.length, 2, '「原因」「由来」两段');
  assert.match(zhPoints[0], /^原因：/, '中文标签仍是「原因：」');
  assert.ok(zhPoints[0].indexOf(zh[ID].cause) !== -1, '取的是中文库原文');
  assert.match(zhPoints[1], /^由来：/);

  useLang('en');
  const enPoints = game.knowledgePointsFor({ id: ID });
  assert.equal(enPoints.length, 2);
  assert.match(enPoints[0], /^Reason: /, '英文标签用 Reason: ');
  assert.ok(enPoints[0].indexOf(en[ID].cause) !== -1, '取的是英文库原文');
  assert.match(enPoints[1], /^Origin: /);
  assert.ok(enPoints[0].indexOf(zh[ID].cause) === -1, '英文模式下不该出现中文库正文');
});

test('point labels split correctly in both languages and never mis-split a ratio', () => {
  assert.deepEqual(game.splitPoint('原因：为什么会这样'), { label: '原因：', text: '为什么会这样' });
  assert.deepEqual(game.splitPoint('Reason: A short reason.'), { label: 'Reason: ', text: 'A short reason.' });
  assert.deepEqual(game.splitPoint('Origin: A short origin.'), { label: 'Origin: ', text: 'A short origin.' });
  // 中文里的比例（半角冒号）不能被当成标签分隔符
  assert.deepEqual(game.splitPoint('比例为 1:2 的糖水'), { label: '', text: '比例为 1:2 的糖水' });
  assert.deepEqual(game.splitPoint('Water to sugar 1:2'), { label: '', text: 'Water to sugar 1:2' });
  // 视图：英文知识卡两段都能拆出标签（标签会渲染成更大字号）
  const view = game.pointsView(game.knowledgePointsFor({ id: ID }));
  assert.equal(view.length, 2);
  assert.match(view[0].label, /^原因：$/);
  useLang('en');
  const viewEn = game.pointsView(game.knowledgePointsFor({ id: ID }));
  assert.match(viewEn[0].label, /^Reason: $/);
  assert.match(viewEn[1].label, /^Origin: $/);
  assert.ok(viewEn[0].text.trim().length > 20, '正文非空');
});
