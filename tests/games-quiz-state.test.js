'use strict';

// 2026-10-14：用户批准的「农谚问答 · 切语言/退出重进跳轮次」修复（方案 A）。
// 诊断报告《农谚问答切语言跳轮次-诊断与方案.md》§2 / §3 / §4。
//   根因：onShow（playground-controller.js onShow）里"发新题"只看 progress.round，
//         而结算时 finishQuizRound 故意把 round 清成 null（抽屉要拿它算剩余题数），
//         于是"今天已打完一轮（roundsDone === 1）"被当成"还没开始打第二局"→ buildQuizRound(2)。
//   修法：加常量 QUIZ_ROUND_SIZE；onShow 先认出「今天已打完、且没有进行中那一局」这一屏
//         （finishedRound = !progress.round && roundsDone >= 1 → Math.min(roundsDone, 2)），
//         把 !finishedRound 并进"发新题"的条件，并用专门的 restoreFinishedQuizRound 固定在总结页；
//         updateQuizTexts 的分母在总结页（quiz 为空）回退到 QUIZ_ROUND_SIZE。
// 这个文件守的就是上面这些，全部走「真跑 onShow / 真打完一局」的集成路径（不看源码字符串）。
// 断言在改之前必须是红的（实测：第一轮打完切语言会跳成第 2 轮、quizDone=false、askedIds 6→12）。
const test = require('node:test');
const assert = require('node:assert/strict');

const map = new Map();
global.wx = {
  getStorageSync: key => map.get(key),
  setStorageSync: (key, value) => map.set(key, value),
  removeStorageSync: key => map.delete(key),
  setNavigationBarTitle() {},
  navigateTo() {},
  showToast() {},
  setClipboardData() {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  // coverflow（结果页水果卡）只用到 select().fields()/boundingClientRect() + exec()，给个安全空壳
  createSelectorQuery: () => ({ select: () => ({ fields: () => {}, boundingClientRect: () => {} }), exec: cb => { if (cb) cb(null); } })
};

const createPlaygroundController = require('../miniprogram/packageGame/lib/playground-controller');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

function quizPage() {
  const definition = createPlaygroundController({ hub: false });
  return Object.assign(definition, {
    setData(patch, done) {
      Object.keys(patch || {}).forEach(key => {
        if (key.indexOf('.') === -1) { this.data[key] = patch[key]; return; }
        const parts = key.split('.');
        let node = this.data;
        for (let i = 0; i < parts.length - 1; i += 1) { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
        node[parts[parts.length - 1]] = patch[key];
      });
      if (done) done();
    },
    getTabBar() { return { setData() {} }; }
  });
}

// 「开一页并初始化到指定语言」：onLoad + onShow == 用户每一次进这一页走的那条路
// （切语言时页面还活着 → 只重跑 onShow；退出重进 → 新页面重跑 onLoad + onShow，两条都覆盖得到）。
function open(lang) {
  useLang(lang);
  const page = quizPage();
  page.onLoad({ game: 'quiz' });
  page.onShow();
  return page;
}

// 真打完一轮：答 → 下一题 → …（末题的 nextQuiz 触发 finishQuizRound）
function answerAll(page) {
  let guard = 0;
  while (!page.data.quizDone && guard++ < 30) {
    page.answer({ currentTarget: { dataset: { correct: '1' } } });
    page.nextQuiz();
  }
}

test.beforeEach(() => {
  map.clear();
  store.exitDemo();
  store.clearAll();
  useLang('zh');
});

test('第一轮打完：切语言（EN→ZH、ZH→EN）都停在第一轮总结页', () => {
  const page = open('en');
  answerAll(page);
  assert.equal(page.data.quizDone, true, 'EN 下打完第 1 轮应停在总结页');
  assert.equal(page.data.quizRound, 1);
  assert.equal(store.getQuizProgress().roundsDone, 1);
  assert.equal(store.getQuizProgress().round, null, '结算时快照被清成 null（抽屉口径依赖它）');

  useLang('zh');
  page.onShow();                                   // ← 就是用户那一步
  assert.equal(page.data.quizDone, true, '切中文后必须还在总结页');
  assert.equal(page.data.quizRound, 1, '不能跳成第二轮');
  assert.equal(store.getQuizProgress().roundsDone, 1, '轮数没被推进');
  assert.equal(store.getQuizProgress().round, null, '没有偷偷开新一局');
  assert.equal(page.data.quizLog.length, 6, '今日问答簿还在（6 题）');
  assert.ok(page.data.quizScoreLine, '「答对 X / Y 题」不能变空');
  assert.match(page.data.quizScoreLine, /[\u4e00-\u9fa5]/, 'ZH 下分数行应是中文：' + page.data.quizScoreLine);

  useLang('en');
  page.onShow();
  assert.equal(page.data.quizDone, true, '再切回英文仍在总结页');
  assert.equal(page.data.quizRound, 1);
  assert.match(page.data.quizScoreLine, /You scored/, 'EN 下分数行应切成英文：' + page.data.quizScoreLine);
});

test('第一轮打完：同语言退出再进来也停在总结页（不切语言也不能跳）', () => {
  const page = open('zh');
  answerAll(page);
  const again = open('zh');                        // 不动存档，只新建一页重跑 onLoad + onShow
  assert.equal(again.data.quizDone, true, '退出再进不能跳第二轮');
  assert.equal(again.data.quizRound, 1);
  assert.equal(store.getQuizProgress().round, null, '重进也不能开新一局');
  // 「答对 X / Y 题」的分母要显出来（中文串形如「答对 6 / 6 题」，英文形如「You scored 6 / 6」）
  assert.match(again.data.quizScoreLine, /\/ ?6/, '分数行的分母不能空：' + again.data.quizScoreLine);
  assert.equal(again.data.quizLog.length, 6, '今日问答簿也要读回来');
});

test('切语言不再偷偷消耗题库（askedIds / askedProverbs 不因切语言而增加）', () => {
  const page = open('zh');
  answerAll(page);
  const before = store.getQuizProgress();
  assert.equal(before.askedIds.length, 6, '第 1 轮出过 6 道');
  useLang('en');
  page.onShow();
  const after = store.getQuizProgress();
  assert.equal(after.askedIds.length, before.askedIds.length, '切语言不该再记 6 道「已出过」的题');
  assert.equal(after.askedProverbs.length, before.askedProverbs.length);
});

test('点「再来一轮」才开第二轮；第 2 轮打完仍停在「今日已结束」', () => {
  const page = open('zh');
  answerAll(page);
  useLang('en');
  page.onShow();
  assert.equal(page.data.quizDone, true, '切语言后仍在总结页');
  assert.equal(typeof page.restartQuiz, 'function', 'Play again 按钮的处理函数保留');
  page.restartQuiz();                              // 只有用户点它才开新局
  assert.equal(page.data.quizDone, false);
  assert.equal(page.data.quizRound, 2);
  assert.equal(page.data.quiz.length, 6, '第 2 轮是全新 6 道题');
  assert.equal(store.getQuizProgress().roundsDone, 1, '第 2 轮还没打完，轮数仍是 1');

  answerAll(page);
  assert.equal(store.getQuizProgress().roundsDone, 2);
  useLang('zh');
  page.onShow();
  assert.equal(page.data.quizDone, true, '两轮打完仍停在结束页');
  assert.equal(page.data.quizRound, 2);
  assert.match(page.data.quizScoreLine, /\/ ?6/, '第 2 轮的分数行也要在：' + page.data.quizScoreLine);
});

test('第 2 轮打到一半：退出重进接着打，不会被误判成"已打完"', () => {
  const page = open('zh');
  answerAll(page);
  page.restartQuiz();                              // 第 2 轮开始
  page.answer({ currentTarget: { dataset: { correct: '1' } } });
  page.nextQuiz();
  assert.equal(store.getQuizProgress().round.no, 2, '第 2 轮的快照在存档里（round 非空）');
  assert.equal(store.getQuizProgress().roundsDone, 1, '第 2 轮还没打完');

  const again = open('zh');                        // 退出再进来
  assert.equal(again.data.quizDone, false, '这是「没打完的那一局」，必须接着打而不是停在总结页');
  assert.equal(again.data.quizRound, 2);
  assert.equal(again.data.quizIndex, 1, '打到第 2 题就停在那儿');
  assert.equal(again.data.quizScore, 1, '得分也接着算');
});

test('中途切语言不丢进度（回归保护）', () => {
  const page = open('zh');
  page.answer({ currentTarget: { dataset: { correct: '1' } } });
  page.nextQuiz();
  page.answer({ currentTarget: { dataset: { correct: '1' } } });
  page.nextQuiz();
  const index = page.data.quizIndex, score = page.data.quizScore;
  useLang('en');
  page.onShow();
  assert.equal(page.data.quizIndex, index, '第几题不能丢');
  assert.equal(page.data.quizScore, score, '得分不能丢');
  assert.equal(page.data.quizDone, false, '没打完就还在答题页');
  assert.equal(page.data.quiz.length, 6, '题目不能被重发');
});
