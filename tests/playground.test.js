'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createController = require('../miniprogram/lib/playground-controller');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const originalWx = global.wx;
let navigations, titles;
function page(hub) {
  const definition = createController({ hub });
  return Object.assign(definition, {
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    getTabBar() { return { setData() {} }; }
  });
}
test.beforeEach(() => {
  const memory = new Map(); navigations = []; titles = [];
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: key => memory.delete(key),
    navigateTo: input => navigations.push(input.url),
    setNavigationBarTitle: input => titles.push(input.title)
  };
  i18n.invalidateLang();
});
test.after(() => { global.wx = originalWx; i18n.invalidateLang(); });

test('each single-screen game entry opens the requested activity and rejects unknown routes', () => {
  const hub = page(true); hub.onShow();
  assert.deepEqual(hub.data.quiz, [], 'the selector does not start an unanswered round');
  for (const game of ['quiz', 'challenge', 'match']) hub.openGame({ currentTarget: { dataset: { game } } });
  assert.deepEqual(navigations, ['quiz', 'challenge', 'match'].map(game => '/pages/playground/playground?game=' + game));
  hub.openGame({ currentTarget: { dataset: { game: '../../mine' } } });
  assert.equal(navigations.length, 3);
  assert.equal(hub.onShareAppMessage().path, '/pages/learn/learn');
});

test('activity deep links select and share the module with localized navigation titles', () => {
  store.saveSettings({ language: 'en' }); i18n.invalidateLang();
  for (const [requested, selected] of [['quiz', 'quiz'], ['challenge', 'challenge'], ['match', 'match'], ['unknown', 'quiz']]) {
    const detail = page(false); detail.onLoad({ game: requested }); detail.onShow();
    assert.equal(detail.data.game, selected);
    assert.equal(detail.onShareAppMessage().path, '/pages/playground/playground?game=' + selected);
    assert.equal(titles.at(-1), detail.data.activeTitle);
    assert.match(detail.data.activeTitle, /^[A-Za-z]/);
  }
});

test('quiz detail retains score, fruit unlock and replay without leaking state into another page', () => {
  const quiz = page(false); quiz.onLoad({ game: 'quiz' }); quiz.onShow();
  const questionIndex = quiz.data.quiz.findIndex(question => question.fruitId !== 'watermelon' && question.fruitId);
  assert.ok(questionIndex >= 0);
  quiz.setData({ quizIndex: questionIndex });
  const fruitId = quiz.data.quiz[questionIndex].fruitId;
  quiz.answer({ currentTarget: { dataset: { correct: '1' } } });
  assert.equal(quiz.data.quizScore, 1);
  assert.ok(store.getFruitUnlocks().includes(fruitId));
  assert.equal(quiz.data.unlockCelebration.config.templateId, fruitId);
  quiz.answer({ currentTarget: { dataset: { correct: '1' } } });
  assert.equal(quiz.data.quizScore, 1, 'a second tap cannot earn another point');
  quiz.closeUnlock(); assert.equal(quiz.data.unlockCelebration, null);
  quiz.restartQuiz(); assert.equal(quiz.data.quizScore, 0); assert.equal(quiz.data.quizAnswered, false);
});

test('unlock button goes straight to the companion customizer', () => {
  const quiz = page(false); quiz.onLoad({ game: 'quiz' }); quiz.onShow();
  quiz.setData({ unlockCelebration: { name: '西瓜', config: {}, templateName: '西瓜', alreadyOwned: false } });
  quiz.goMine();
  assert.deepEqual(navigations, ['/pages/companion/companion'], '去「我的」看看直达果灵伙伴创作页');
  assert.equal(quiz.data.unlockCelebration, null);
});

test('a replay round uses the unseen question set and never repeats the previous round', () => {
  const quiz = page(false); quiz.onLoad({ game: 'quiz' }); quiz.onShow();
  const first = quiz.data.quiz.map(question => question.id);
  assert.equal(first.length, 6, '每轮 6 道题');
  // 10.5 游戏③：西瓜是初始伙伴（已解锁），已解锁的水果不再出题，空位由非定制水果题补齐。
  assert.equal(first.includes('watermelon-planting'), false, '解锁过的西瓜不再出题');
  assert.equal(first.includes('watermelon-ripe'), false, '解锁过的西瓜不再出题');
  quiz.restartQuiz();
  const second = quiz.data.quiz.map(question => question.id);
  assert.equal(first.filter(id => second.includes(id)).length, 0, '评审 9.28：两轮题目完全不同');
  assert.equal(new Set(quiz.data.quiz.map(q => q.id)).size, 6, '复轮 6 道题 id 各不相同');
  for (const question of quiz.data.quiz) {
    assert.equal(question.options.filter(option => option.correct).length, 1, 'every question keeps exactly one correct option');
  }
  assert.equal(quiz.data.quizScore, 0); assert.equal(quiz.data.quizDone, false);
  quiz.restartQuiz();
  const third = quiz.data.quiz.map(question => question.id);
  assert.equal(second.filter(id => third.includes(id)).length, 0, '再一轮同样不重复上一轮');
  assert.notDeepEqual(third, first, 'another replay differs again');
});

test('答完两轮后当天再进游戏停在结果页，跨天自动重玩', () => {
  const store = require('../miniprogram/lib/store');
  const quiz = page(false);
  quiz.onLoad({ game: 'quiz' }); quiz.onShow();
  assert.equal(quiz.data.quizDone, false, '进度为零时正常答题');
  store.saveQuizProgress({ roundsDone: 2 });
  quiz.onShow();
  assert.equal(quiz.data.quizDone, true, '当天两轮已答完：直接停在结果页');
  assert.equal(quiz.data.quizRound, 2);
  // 跨天：轮数清零，第二天可以重新玩
  const day = new Date(); const pad = n => String(n).length < 2 ? '0' + n : String(n);
  const tomorrow = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate() + 1);
  store.saveQuizProgress({ roundsDone: 2, day: tomorrow });
  quiz.onShow();
  assert.equal(store.getQuizProgress().roundsDone, 0, '第二天轮数归零');
});

test('每道题的干扰项都不是那句一眼假的套话', () => {
  const quizData = require('../miniprogram/data/fruit-quiz');
  const stale = '这是全国各地都必须严格照办的硬性农时，不用看当地气候和品种。';
  for (const question of quizData.QUIZ) {
    assert.notEqual(question.wrong, stale, question.id + ' 的干扰项必须换掉');
    assert.ok(question.wrong && question.wrong.length > 8, question.id + ' 有实在的干扰项');
  }
  const proverbs = quizData.buildRandomProverbQuestions(6, false, []);
  for (const question of proverbs) {
    const wrong = question.options.filter(option => !option.correct)[0];
    assert.notEqual(wrong.label, stale, '农谚题的干扰项必须换掉');
    assert.ok(wrong.label && wrong.label.length > 8, '农谚题有实在的干扰项');
  }
  assert.ok(Object.keys(quizData.PROVERB_DISTRACTORS).length >= 42, '42 条农谚都配了干扰项');
});
