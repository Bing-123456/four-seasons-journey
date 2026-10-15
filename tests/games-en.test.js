'use strict';

// 2026-10-11 用户要求：English 模式下「农事转盘」「文脉连连」要全英文。
// 这里锁定三件事：① 果名能取到英文名 ② 题库/配对素材跟着当前语言现挑（不是模块加载时冻结一次）
// ③ 游戏文案的中英键成对、wxml 里不再有硬编码中文。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const map = new Map();
global.wx = { getStorageSync: key => map.get(key), setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key) };

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const fruitNameEn = require('../miniprogram/lib/fruit-name-en');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

test.beforeEach(() => { map.clear(); store.exitDemo(); store.clearAll(); useLang('zh'); });

test('fruit names follow the interface language, including the two game-only short names', () => {
  useLang('zh');
  assert.equal(fruitNameEn.nameEn('柿子'), '柿子');
  assert.equal(fruitNameEn.nameEn(''), '');
  useLang('en');
  assert.equal(fruitNameEn.nameEn('柿子'), 'Persimmon');
  assert.equal(fruitNameEn.nameEn('荔枝'), 'Lychee');
  assert.equal(fruitNameEn.nameEn('砂糖橘'), 'Sugar tangerine');
  // 游戏里用的两个短名不在果库的 name 里，按对照表补上
  assert.equal(fruitNameEn.nameEn('桃'), 'Peach');
  assert.equal(fruitNameEn.nameEn('柑橘'), 'Citrus');
  // 查不到的果名原样返回（不空白、不乱编）
  assert.equal(fruitNameEn.nameEn('不存在的果子'), '不存在的果子');
  assert.equal(fruitNameEn.nameEn(''), '');
});

test('challenge question bank is re-picked from the language at use time, not frozen at load', () => {
  const bank = require('../miniprogram/packageGame/data/challenge-questions');
  useLang('zh');
  const zhQ = bank.current().find(q => q.id === 'c-kumquat-disaster');
  assert.match(zhQ.situation, /[\u4e00-\u9fa5]/, '中文模式拿到中文题面');
  useLang('en');
  const enQ = bank.current().find(q => q.id === 'c-kumquat-disaster');
  assert.doesNotMatch(enQ.situation, /[\u4e00-\u9fa5]/, '英文模式拿到英文题面');
  assert.equal(enQ.options.length, zhQ.options.length, '选项数量一致');
  assert.deepEqual(enQ.options.map(o => o.correct), zhQ.options.map(o => o.correct), '正确答案标记不变');
  // 切回中文还能拿回中文（证明不是"加载时挑一次"）
  useLang('zh');
  assert.match(bank.current().find(q => q.id === 'c-kumquat-disaster').situation, /[\u4e00-\u9fa5]/);
});

test('match pair material follows the language; ids and fruit keys stay stable', () => {
  const pool = require('../miniprogram/packageGame/data/match-questions');
  useLang('zh');
  const zhPair = pool.current().find(p => p.id === 'm-litchi-poetry');
  useLang('en');
  const enPair = pool.current().find(p => p.id === 'm-litchi-poetry');
  assert.notEqual(enPair.label, zhPair.label, '英文模式下标签换成英文');
  assert.equal(enPair.id, zhPair.id, 'id 不变（配对判定靠 id）');
  assert.equal(enPair.fruit, zhPair.fruit, 'fruit 仍是中文原名（持久化状态要稳定）');
});

test('every new game string is bilingual and keeps the same placeholders', () => {
  const keys = [
    'challenge_cat_farming', 'challenge_cat_traditional', 'challenge_cat_storage', 'challenge_cat_health', 'challenge_cat_care', 'challenge_cat_disaster',
    'challenge_kb_cause', 'challenge_kb_origin',
    'challenge_album_title', 'challenge_album_body', 'challenge_album_go',
    'challenge_toast_unsupported', 'challenge_toast_save_failed', 'challenge_toast_saved', 'challenge_toast_image_failed', 'challenge_toast_wheel_failed',
    'match_elf_explaining', 'match_note_fallback', 'match_select_fruit', 'match_select_label', 'match_learned_pair', 'match_wrong_hint', 'match_some_fruit',
    'qlog_source_fallback', 'coverflow_prev', 'coverflow_next'
  ];
  keys.forEach(key => {
    const entry = i18n.dict[key];
    assert.ok(Array.isArray(entry) && entry.length === 2, key + ' 必须是中英一对');
    entry.forEach(side => assert.ok(typeof side === 'string' && side.trim(), key + ' 两侧都不能为空'));
    const ph = side => (side.match(/{{[a-z]+}}/g) || []).sort().join(',');
    assert.equal(ph(entry[0]), ph(entry[1]), key + ' 中英两侧占位符要一致');
  });
});

test('solar term names use the project convention: Chinese in zh, pinyin in en', () => {
  const terms = require('../miniprogram/lib/term-name-en');
  useLang('zh');
  assert.equal(terms.termEn('霜降', 'zh'), '霜降');
  assert.equal(terms.termEn('中秋', 'zh'), '中秋');
  assert.equal(terms.termEn('芒种', 'en'), 'Mangzhong');
  assert.equal(terms.termEn('霜降', 'en'), 'Shuangjiang');
  assert.equal(terms.termEn('冬至', 'en'), 'Dongzhi');
  assert.equal(terms.termEn('中秋', 'en'), 'Mid-Autumn', '语料里中秋写作 Mid-Autumn');
  assert.equal(terms.termEn('不存在的节气', 'en'), '不存在的节气', '表外的名字原样返回');
  assert.equal(terms.termEn('', 'en'), '');
  // 24 节气 + 中秋 全部要有映射，且都是拼音（不含空格，避免官方译名混进来）
  assert.equal(Object.keys(terms.TERM_EN).length, 25);
  Object.keys(terms.TERM_EN).forEach(zhName => {
    const en = terms.TERM_EN[zhName];
    assert.match(en, /^[A-Za-z-]+$/, zhName + ' 的英文名应是拼音单字：' + en);
  });
});

test('knowledge card titles are generated from the raw fields in the current language', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  useLang('zh');
  assert.equal(game.cardTitleFor('霜降', '柿子', '农事'), '霜降 · 柿子 · 农事');
  useLang('en');
  assert.equal(game.cardTitleFor('霜降', '柿子', '农事'), 'Shuangjiang · Persimmon · Farming');
  assert.equal(game.cardTitleFor('小雪', '金桔', '农事'), 'Xiaoxue · Kumquat · Farming');
  assert.equal(game.cardTitleFor('', '', ''), ' ·  · ', '字段缺失时不崩（配置异常也不会白屏）');
});

test('today cards are recomputed from the question id in the current language', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  const bank = require('../miniprogram/packageGame/data/challenge-questions');
  // 模拟一张"中文时期存下来的"卡：sig 里带题目 id，正文是当时的中文
  // （c-kumquat-farm = 小雪/金桔/农事，与用户截图那张「小雪 · 金桔 · 农事」同一条）
  const stored = [{ sig: 'c-kumquat-farm:1', term: '小雪', fruit: '金桔', category: '农事', situation: '中文题面占位', points: ['原因：中文占位'], answer: 'C. 中文占位' }];

  useLang('zh');
  const zhView = game.cardsFor(stored)[0];
  assert.equal(zhView.title, '小雪 · 金桔 · 农事');
  assert.equal(zhView.situation, bank.current().find(q => q.id === 'c-kumquat-farm').situation, '中文模式取中文题库题面');
  assert.match(zhView.points[0], /^原因：/);
  assert.ok(zhView.pointsView.length >= 1 && zhView.pointsView[0].label === '原因：', '中文模式下知识卡标签是「原因：」');
  assert.ok(zhView.pointsView.every(p => p.text && p.text.trim()), '每段正文都非空');

  useLang('en');
  const enView = game.cardsFor(stored)[0];
  assert.equal(enView.title, 'Xiaoxue · Kumquat · Farming', '标题跟着语言重算');
  assert.equal(enView.situation, bank.current().find(q => q.id === 'c-kumquat-farm').situation, '英文模式取英文题库题面');
  assert.doesNotMatch(enView.situation, /中文题面占位/, '不再用存档里的中文题面');
  assert.match(enView.answer, /^[A-D]\. /, '正解仍带字母');
  assert.match(enView.points[0], /^Reason: /, '知识卡正文取英文库');
  assert.doesNotMatch(enView.points[0], /中文占位/, '不再用存档里的中文正文');
});

test('wheel labels use short names in English so the three rings cannot overlap', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  useLang('zh');
  assert.equal(game.wheelLabelFor('fruit', '砂糖橘'), '砂糖橘');
  assert.equal(game.wheelLabelFor('category', '古法'), '古法');
  assert.equal(game.wheelLabelFor('term', '霜降'), '霜降');
  useLang('en');
  assert.equal(game.wheelLabelFor('fruit', '砂糖橘'), 'Tangerine', '转盘上用短名');
  assert.equal(game.wheelLabelFor('fruit', '秋梨'), 'Pear');
  assert.equal(game.wheelLabelFor('fruit', '猕猴桃'), 'Kiwi');
  assert.equal(game.wheelLabelFor('category', '古法'), 'Methods');
  assert.equal(game.wheelLabelFor('category', '灾害'), 'Hazards');
  assert.equal(game.wheelLabelFor('term', '霜降'), 'Shuangjiang', '节气用拼音');
  assert.equal(game.wheelLabelFor('term', '中秋'), 'Mid-Autumn');
  // 没进短名表的果名走官方英文名，不缩写
  assert.equal(game.wheelLabelFor('fruit', '柿子'), 'Persimmon');
});

test('the wheel draws every ring along the radius with an auto-fitted font', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/lib/challenge-game.js'), 'utf8');
  assert.doesNotMatch(src, /if \(ring\.type === 'term'\) \{/, '不再只给外圈做径向排字（三圈一律径向）');
  assert.match(src, /avail \/ maxEm/, '按最长名字自动缩字号');
  assert.match(src, /ctx\.measureText/, '用真实字宽测量');
  assert.match(src, /charCodeAt\(i\) > 0x2e80/, 'measureText 不可用时按 CJK/非 CJK 估算兜底');
});

test('the wheel still draws even when the device canvas cannot measure text', () => {
  // 2026-10-11 实机踩到：把"量字宽"放在画扇区之前，一旦 measureText 异常整块转盘全空白。
  // 这里锁死：三种画布（正常 / 抛错 / 返回 undefined）都必须画满扇区与文字，且不抛错。
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  const FRUITS = ['青梅', '桑葚', '樱桃', '枇杷', '桃', '荔枝', '杨梅', '杏', '柿子', '枣', '秋梨', '山楂', '砂糖橘', '瓯柑', '柚子', '金桔'];
  const TERMS = ['立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '中秋'];
  const CATS = ['农事', '古法', '储存', '食养', '管护', '灾害'];
  const total = FRUITS.length + TERMS.length + CATS.length;
  ['en', 'zh'].forEach(lang => {
    useLang(lang);
    ['normal', 'throws', 'undefined'].forEach(mode => {
      let fills = 0, texts = 0;
      const ctx = {
        font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
        save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, clearRect() {},
        beginPath() {}, closePath() {}, arc() {}, stroke() {}, fill() { fills += 1; }, fillText() { texts += 1; }
      };
      if (mode === 'throws') ctx.measureText = () => { throw new Error('measureText is not a function'); };
      else if (mode === 'undefined') ctx.measureText = () => undefined;
      else ctx.measureText = text => ({ width: String(text).length * 8 });
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      const page = {
        data: { wheel: { fruits: FRUITS, terms: TERMS, categories: CATS, selectedFruit: '', selectedTerm: '', selectedCategory: '' }, wheelRot: { term: 0, fruit: 0, category: 0 } },
        _wheelCanvas: canvas, _wheelCtx: ctx, _wheelSize: { width: 340, height: 340 }
      };
      assert.doesNotThrow(() => game.drawWheelFor(page), lang + '/' + mode + ' 不该抛错');
      assert.equal(fills, total, lang + '/' + mode + ' 扇区要画满');
      assert.equal(texts, total, lang + '/' + mode + ' 文字要画满');
    });
  });
});

test('the wheel summary line follows the language (the 「秋分 · 秋梨 · 灾害」 line)', () => {
  // 用户截图那条：转盘下方 .wheel-summary。以前直接在 wxml 里拼 wheel.selected*（中文原名）。
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/pages/playground/playground.wxml'), 'utf8');
  assert.match(wxml, /class="wheel-summary">\{\{wheelSummary\}\}/, '改渲染 wheelSummary');
  assert.doesNotMatch(wxml, /wheel\.selectedTerm\}\} · \{\{wheel\.selectedFruit/, '不再直接拼中文原名');

  const game = require('../miniprogram/packageGame/lib/challenge-game');
  useLang('zh');
  assert.equal(game.cardTitleFor('秋分', '秋梨', '灾害'), '秋分 · 秋梨 · 灾害', '中文模式逐字不变');
  useLang('en');
  assert.equal(game.cardTitleFor('秋分', '秋梨', '灾害'), 'Qiufen · Autumn pear · Hazards');
});

test('init writes a localized wheel summary when a saved round is restored', () => {
  // 真跑一次 init（存档里已经有选中值 + 一道题），断言那条标题按当前语言生成
  const KEY = 'guayouji.challenge.v2.' + store.capturePartition();
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const question = { id: 'c-pear-disaster', term: '秋分', fruit: '秋梨', category: '灾害', situation: 'placeholder', options: [{ text: 'A', correct: true }, { text: 'B' }] };
  map.set(KEY, {
    lastPlayDate: today, playedToday: 0, seenCombos: [], answeredIds: [], correctTotal: 0, todayCards: [],
    challengeState: 'answering', challengeData: question, challengeSelected: -1, challengeCorrectIndex: 0,
    wheelRot: { term: 0, fruit: 0, category: 0 }, wheelSelection: { term: '秋分', fruit: '秋梨', category: '灾害' }
  });
  const ctx = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, clearRect() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, arc() {}, fillText() {}, measureText: t => ({ width: String(t).length * 8 }) };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const page = {
    data: { wheel: { fruits: [], terms: [], categories: [], selectedFruit: '', selectedTerm: '', selectedCategory: '' }, wheelRot: {} },
    setData(patch) {
      Object.keys(patch || {}).forEach(key => {
        if (key.indexOf('.') === -1) { this.data[key] = patch[key]; return; }
        const parts = key.split('.');
        let node = this.data;
        for (let i = 0; i < parts.length - 1; i += 1) { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
        node[parts[parts.length - 1]] = patch[key];
      });
    },
    _closed: true,
    _wheelCanvas: canvas, _wheelCtx: ctx, _wheelSize: { width: 340, height: 340 }
  };
  useLang('zh');
  require('../miniprogram/packageGame/lib/challenge-game').init(page);
  assert.equal(page.data.wheelSummary, '秋分 · 秋梨 · 灾害');
  useLang('en');
  require('../miniprogram/packageGame/lib/challenge-game').init(page);
  assert.equal(page.data.wheelSummary, 'Qiufen · Autumn pear · Hazards');
  assert.equal(page.data.challengeCardTitle, '📖 Qiufen · Autumn pear · Hazards', '带 📖 的知识卡标题也一起变英文');
});

test('the game page has no leftover hardcoded Chinese labels', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/pages/playground/playground.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /\|\| '知识库'/, '问答簿/图谱的来源兜底文案已改走 i18n');
  assert.doesNotMatch(wxml, /aria-label="上一张"|aria-label="下一张"/, '翻页按钮的无障碍文案已改走 i18n');
  const match = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/lib/match-game.js'), 'utf8');
  assert.match(match, /NOTE_PENDING/, '讲解占位符用语言无关常量');
  assert.doesNotMatch(match, /x\.note === '果灵正在讲解…'/, '不再拿中文文案当状态标记去比对');
});
