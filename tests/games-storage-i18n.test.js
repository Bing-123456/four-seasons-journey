'use strict';

// 2026-10-11 用户批准修的第 3 / 7 / 8 条（"存起来的文案切语言后不跟着变"）：
//   ① 农事转盘：存档只留题目 id，恢复时按当前语言重取题面与选项（老存档不能崩）；
//   ② 农谚问答的问答簿：只存 id + 对错，读回时按当前语言现取（出处按方案 A 保留中文原样）；
//   ③ 四时页：导航栏标题在 onShow 里重设（切语言后不再是切换前那一门语言）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const map = new Map();
let titles = [];
global.wx = {
  getStorageSync: key => map.get(key),
  setStorageSync: (key, value) => map.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: key => map.delete(key),
  setNavigationBarTitle: input => titles.push(input && input.title)
};

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }
function today() {
  const d = new Date();
  const pad = n => String(n).length < 2 ? '0' + n : String(n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
const HAN = /[\u4e00-\u9fa5]/;

test.beforeEach(() => { map.clear(); titles = []; store.exitDemo(); store.clearAll(); useLang('zh'); });

// ── ① 农事转盘：题目/选项不再被冻在存档语言里 ─────────────────────────────

// 照 tests/games-en.test.js:207-241 的写法：真跑一次 init + 假 canvas。
function challengePage() {
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, clearRect() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, arc() {}, fillText() {},
    measureText: t => ({ width: String(t).length * 8 })
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return {
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
    _closed: true,   // 不真要画转盘
    _wheelCanvas: canvas, _wheelCtx: ctx, _wheelSize: { width: 340, height: 340 }
  };
}
function seedChallengeStorage(question) {
  map.set('guayouji.challenge.v2.' + store.capturePartition(), {
    lastPlayDate: today(), playedToday: 0, seenCombos: [], answeredIds: [], correctTotal: 0, todayCards: [],
    challengeState: 'answering', challengeData: question, challengeSelected: -1, challengeCorrectIndex: 0,
    wheelRot: { term: 0, fruit: 0, category: 0 }, wheelSelection: { term: '小雪', fruit: '金桔', category: '灾害' }
  });
}
// 「中文时存下的一道题」：题面与四个选项都是中文（老存档就是这个形状）。
const ZH_QUESTION = {
  id: 'c-kumquat-disaster', term: '小雪', fruit: '金桔', category: '灾害',
  situation: '金桔挂树越冬，最怕什么？',
  options: [
    { text: '冻害', correct: true, letter: 'A' },
    { text: '夏季日灼', correct: false, letter: 'B' },
    { text: '秋季台风', correct: false, letter: 'C' },
    { text: '春季晚霜', correct: false, letter: 'D' }
  ]
};

test('③农事转盘：老存档（中文整题）在英文下恢复出英文题面与英文选项，切回中文又变回中文', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  seedChallengeStorage(JSON.parse(JSON.stringify(ZH_QUESTION)));

  useLang('en');
  const en = challengePage();
  game.init(en);
  assert.equal(en.data.challenge.situation, 'The kumquat hangs on the tree through winter. What does it fear most?');
  assert.doesNotMatch(en.data.challenge.situation, HAN, '英文模式恢复出来的题面不能再有中文');
  assert.equal(en.data.challenge.options.length, 4);
  assert.deepEqual(en.data.challenge.options.map(o => o.correct), ZH_QUESTION.options.map(o => o.correct), '正误标记逐条不变');
  assert.deepEqual(en.data.challenge.options.map(o => o.letter), ['A', 'B', 'C', 'D'], '字母位不变（判分按 correct，不按顺序）');
  en.data.challenge.options.forEach(o => assert.doesNotMatch(o.text, HAN, '选项文字也要是英文：' + o.text));

  useLang('zh');
  const zh = challengePage();
  game.init(zh);
  assert.equal(zh.data.challenge.situation, '金桔挂树越冬，最怕什么？', '切回中文要变回中文（不是单向冻结）');
  assert.deepEqual(zh.data.challenge.options.map(o => o.text), ['冻害', '夏季日灼', '秋季台风', '春季晚霜']);
});

test('③农事转盘：persist 只写题目 id（题面/选项文字不再落盘），并带上判定进度', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');
  const page = challengePage();
  page._challengeState = { lastPlayDate: today(), playedToday: 1, seenCombos: [], answeredIds: [], correctTotal: 0, todayCards: [] };
  page.data.challenge = JSON.parse(JSON.stringify(ZH_QUESTION));
  page.data.challengeState = 'answering';
  page.data.challengeSelected = 2;
  page.data.challengeCorrectIndex = 0;
  page.data.challengeKnowledge = null;
  page.data.challengeSaved = false;
  page.data.challengeCardTitle = '📖 小雪 · 金桔 · 灾害';
  page.data.wheelRot = { term: 1, fruit: 2, category: 3 };
  page.data.wheel = { selectedFruit: '金桔', selectedTerm: '小雪', selectedCategory: '灾害' };
  game.persist(page);

  const stored = map.get('guayouji.challenge.v2.' + store.capturePartition());
  assert.equal(stored.challengeData.id, 'c-kumquat-disaster');
  assert.equal(JSON.stringify(stored.challengeData).indexOf('金桔挂树越冬'), -1, '题面不再落盘');
  assert.equal(JSON.stringify(stored.challengeData).indexOf('夏季日灼'), -1, '选项文字不再落盘');
  assert.deepEqual(stored.challengeData.options.map(o => o.correct), [true, false, false, false], '正误标记要留下（判分要用）');
  assert.deepEqual(stored.challengeData.options.map(o => o.letter), ['A', 'B', 'C', 'D']);
  assert.equal(stored.challengeSelected, 2, '必要进度照常落盘');
  assert.equal(stored.challengeState, 'answering');
  assert.deepEqual(stored.wheelSelection, { fruit: '金桔', term: '小雪', category: '灾害' });
});

test('③农事转盘：老存档、题库里没有的 id、无 id 三种情况都不崩', () => {
  const game = require('../miniprogram/packageGame/lib/challenge-game');

  // (a) 老存档：有整题但没有 id（更老的一版）→ 按现状原样用，不白屏
  const legacyNoId = { term: '小雪', fruit: '金桔', category: '灾害', situation: '老存档的中文题面', options: [{ text: '冻害', correct: true }] };
  seedChallengeStorage(legacyNoId);
  useLang('en');
  const a = challengePage();
  assert.doesNotThrow(() => game.init(a));
  assert.equal(a.data.challenge.situation, '老存档的中文题面');

  // (b) 有 id 但题库里已经没有这道题 → 原样回退，不崩
  seedChallengeStorage({ id: 'no-such-question-any-more', situation: '中文占位', options: [{ text: '甲', correct: true }] });
  const b = challengePage();
  assert.doesNotThrow(() => game.init(b));
  assert.equal(b.data.challenge.situation, '中文占位');

  // (c) 纯函数层面：null / 空对象 / 无 id 都安全
  assert.equal(game.localizeStoredQuestion(null), null);
  assert.deepEqual(game.localizeStoredQuestion({}), {});
  assert.equal(game.storedQuestionFor(null), null);
});

// ── ② 农谚问答的「问答簿」：存 key 不存文案 ───────────────────────────────

const createController = require('../miniprogram/packageGame/lib/playground-controller');
const LOG_KEY = 'guayouji.quiz.log.v1.' + store.capturePartition();
function quizPage() {
  const definition = createController({ hub: false });
  return Object.assign(definition, {
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    getTabBar() { return { setData() {}, applyLang() {} }; }
  });
}
// 中文玩一题：真走一遍题目选择 + 作答 + 入册
function answerOneInZh() {
  const quiz = quizPage();
  quiz.onLoad({ game: 'quiz' });
  quiz.onShow();
  const index = quiz.data.quiz.findIndex(q => HAN.test(q.text || ''));
  assert.ok(index >= 0, '中文模式下应有中文题目');
  quiz.setData({ quizIndex: index });
  quiz.answer({ currentTarget: { dataset: { correct: '1' } } });
  return quiz;
}

test('②问答簿：中文答一题 → 存档里只有 id 和对错，没有成品文案', () => {
  const quiz = answerOneInZh();
  const stored = map.get(LOG_KEY);
  assert.equal(stored.day, today());
  assert.ok(stored.items.length >= 1);
  const item = stored.items[0];
  assert.equal(typeof item.id, 'string');
  assert.ok(item.id.length > 0, '要有题目 id');
  assert.equal(item.text, undefined, '题面不再落盘');
  assert.equal(item.answer, undefined, '正解不再落盘');
  assert.equal(item.source, undefined, '出处不再落盘');
  assert.equal(typeof item.correct, 'boolean');
  assert.equal(quiz.data.quizLog[0].id, item.id);
});

test('②问答簿：中文玩一局 → 切英文 → 整行是英文，出处保留中文原样', () => {
  answerOneInZh();
  useLang('en');
  const quiz = quizPage();
  quiz.onLoad({ game: 'quiz' });
  quiz.onShow();
  const rows = quiz.data.quizLog;
  assert.ok(rows.length >= 1, '切语言后问答簿不能变空');
  rows.forEach(row => {
    assert.doesNotMatch(row.text || '', HAN, '题目要英文：' + row.text);
    assert.doesNotMatch(row.answer || '', HAN, '正解要英文：' + row.answer);
    // 方案 A（用户定）：仓库没有英文出处数据 → 英文界面下保留中文原样，不翻译
    assert.ok(row.source && HAN.test(row.source), '出处保留中文原样：' + row.source);
  });
  // 英文界面下再答一题：同一题（同 id）不会被当成两道题重复入册
  const before = quiz.data.quizLog.length;
  const index = quiz.data.quiz.findIndex(q => !HAN.test(q.text || ''));
  quiz.setData({ quizIndex: index });
  quiz.answer({ currentTarget: { dataset: { correct: '1' } } });
  const ids = map.get(LOG_KEY).items.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, '同一题不能重复入册（身份用 id，不是文字）');
  assert.ok(quiz.data.quizLog.length >= before);
});

test('②问答簿：切回中文又变回中文（不是单向冻结），且不再写回旧文案', () => {
  answerOneInZh();
  useLang('en');
  const en = quizPage(); en.onLoad({ game: 'quiz' }); en.onShow();
  useLang('zh');
  const zh = quizPage(); zh.onLoad({ game: 'quiz' }); zh.onShow();
  assert.match(zh.data.quizLog[0].text, HAN, '切回中文题面要变回中文');
  assert.match(zh.data.quizLog[0].answer, HAN, '切回中文正解要变回中文');
  // 读取后回写的存档仍然是「只有 id」，文案不会被重新落盘
  map.get(LOG_KEY).items.forEach(item => { assert.equal(item.text, undefined); assert.equal(item.answer, undefined); });
});

test('②问答簿：老存档（只有 text、没有 id）原样显示、不崩、不变空', () => {
  const legacy = [{ text: '老存档里的中文题目', kind: 'proverb', correct: true, answer: '老存档里的正解', source: '老存档里的出处', note: '' }];
  map.set(LOG_KEY, { day: today(), items: JSON.parse(JSON.stringify(legacy)) });
  useLang('en');
  const quiz = quizPage();
  quiz.onLoad({ game: 'quiz' });
  assert.doesNotThrow(() => quiz.onShow());
  assert.equal(quiz.data.quizLog.length, 1, '老条目不能被丢掉');
  assert.equal(quiz.data.quizLog[0].text, '老存档里的中文题目', '读不到 id 就按现状显示');
  assert.equal(quiz.data.quizLog[0].answer, '老存档里的正解');
  assert.equal(quiz.data.quizLog[0].source, '老存档里的出处');
});

test('②问答簿：老存档条目一旦能按 id 重算，就换掉旧文案（下次切语言不再被绊住）', () => {
  const bank = require('../miniprogram/packageGame/data/fruit-quiz').QUIZ;
  const id = bank[0].id;
  map.set(LOG_KEY, { day: today(), items: [{ id: id, text: '中文时期存下的题面', answer: '中文时期存下的正解', source: '中文时期存下的出处', correct: true }] });
  useLang('en');
  const quiz = quizPage();
  quiz.onLoad({ game: 'quiz' });
  quiz.onShow();
  assert.doesNotMatch(quiz.data.quizLog[0].text, HAN, '按当前语言重取题面');
  assert.doesNotMatch(quiz.data.quizLog[0].answer, HAN, '按当前语言重取正解');
  const stored = map.get(LOG_KEY).items[0];
  assert.equal(stored.text, undefined, '旧文案被清掉，只留 key');
  assert.equal(stored.id, id);
  assert.equal(stored.correct, true, '对错结果保留');
});

// ── ③ 四时页：导航栏标题在 onShow 里重设 ────────────────────────────────

test('③四时页：源码里 onShow 段必须有 i18n.applyNav(\'nav_calendar\')', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/calendar/calendar.js'), 'utf8');
  const onShow = src.slice(src.indexOf('onShow'));
  assert.match(onShow, /i18n\.applyNav\('nav_calendar'\)/, 'onShow 里要重设导航栏标题');
});

test('③四时页：真跑 onShow —— 切英文后标题是 Fruit Seasons，切回中文是果物四时记', () => {
  const originalGetProfile = store.getProfile;
  const originalGetApp = global.getApp;
  const hadPage = 'Page' in global;
  const originalPage = global.Page;
  global.getApp = () => ({ getFontClass: () => 'fs-normal' });
  store.getProfile = () => ({ season: 'spring' });
  try {
    let definition = null;
    global.Page = obj => { definition = obj; };
    delete require.cache[require.resolve('../miniprogram/pages/calendar/calendar.js')];
    require('../miniprogram/pages/calendar/calendar.js');
    assert.ok(definition && typeof definition.onShow === 'function');

    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
      getTabBar() { return { setData() {}, applyLang() {} }; }
    });

    useLang('en');
    titles = [];
    page.onShow();
    assert.equal(titles.at(-1), 'Fruit Seasons', '英文下导航栏标题跟着变');

    useLang('zh');
    titles = [];
    page.onShow();
    assert.equal(titles.at(-1), '果物四时记', '切回中文后导航栏标题必须变回中文（本条第 8 条的正主）');
    assert.equal(page.data.L.cal_title1, '四时', '页面内大标题也照旧跟语言');
  } finally {
    store.getProfile = originalGetProfile;
    global.getApp = originalGetApp;
    if (hadPage) global.Page = originalPage; else delete global.Page;
    delete require.cache[require.resolve('../miniprogram/pages/calendar/calendar.js')];
  }
});
