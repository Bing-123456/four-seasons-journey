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
  for (const game of ['paint', 'quiz', 'identify']) hub.openGame({ currentTarget: { dataset: { game } } });
  assert.deepEqual(navigations, ['paint', 'quiz', 'identify'].map(game => '/pages/playground/playground?game=' + game));
  hub.openGame({ currentTarget: { dataset: { game: '../../mine' } } });
  assert.equal(navigations.length, 3);
  assert.equal(hub.onShareAppMessage().path, '/pages/learn/learn');
});

test('activity deep links select and share the module with localized navigation titles', () => {
  store.saveSettings({ language: 'en' }); i18n.invalidateLang();
  for (const [requested, selected] of [['quiz', 'quiz'], ['paint', 'paint'], ['identify', 'identify'], ['story', 'identify'], ['unknown', 'quiz']]) {
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
  quiz.data.paintExamples.push('local-only');
  assert.equal(page(false).data.paintExamples.includes('local-only'), false);
});

test('identified fruit opens its dedicated culture detail without a delayed tab handoff', () => {
  const identify = page(false); identify.onLoad({ game: 'identify' });
  identify.setData({ identifyResult: { fruit: '青梅' } });
  identify.viewFruit();
  assert.deepEqual(navigations, ['/pages/fruit-detail/fruit-detail?fruit=spring-plum']);
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
  assert.equal(first[0], 'watermelon-planting', 'the opening question is the watermelon proverb');
  quiz.restartQuiz();
  const second = quiz.data.quiz.map(question => question.id);
  assert.equal(first.filter(id => second.includes(id)).length, 0, '评审 9.28：两轮题目完全不同');
  assert.equal(new Set(quiz.data.quiz.map(q => q.fruitId)).size, 6, 'a full round still covers all six fruits');
  for (const question of quiz.data.quiz) {
    assert.equal(question.options.filter(option => option.correct).length, 1, 'every question keeps exactly one correct option');
  }
  assert.equal(quiz.data.quizScore, 0); assert.equal(quiz.data.quizDone, false);
  quiz.restartQuiz();
  const third = quiz.data.quiz.map(question => question.id);
  assert.equal(second.filter(id => third.includes(id)).length, 0, '第三轮同样换回未出过的那套题');
  assert.notDeepEqual(third, first, 'another replay differs again');
});

test('transient vision failures are retried transparently; a disabled service is not', async () => {
  const calls = [];
  global.wx.getFileSystemManager = () => ({ readFile: input => input.success({ data: '/9j/' + 'A'.repeat(64) }) });
  global.wx.showModal = input => input.success({ confirm: true });
  global.wx.chooseMedia = input => input.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/photo.jpg' }] });
  const fallback = reason => ({ statusCode: 200, data: { identified: false, message: '拍照识别服务暂不可用，可从链图手动选择水果。', mode: 'local-fallback', fallbackReason: reason } });
  global.wx.request = input => {
    calls.push(input);
    input.success(calls.length === 1 ? fallback('model_invalid_json') : { statusCode: 200, data: { identified: true, fruit: '西瓜', confidence: 'high', mode: 'openai-compatible' } });
  };
  const identify = page(false); identify.onLoad({ game: 'identify' }); identify.onShow();
  identify.identifyFruit();
  await identify._identifyPromise;
  assert.equal(calls.length, 2, 'a model_* fallback is retried once more before giving up');
  assert.deepEqual(identify.data.identifyResult, { fruit: '西瓜' });
  assert.equal(identify.data.identifyBusy, false);

  while (calls.length) calls.pop();
  global.wx.request = input => { calls.push(input); input.success(fallback('vision_disabled')); };
  identify.identifyFruit();
  await identify._identifyPromise;
  assert.equal(calls.length, 1, 'a disabled vision service answers immediately without retries');
  assert.equal(identify.data.identifyResult.fruit, null);
  assert.match(identify.data.identifyResult.message, /暂不可用/);
  assert.equal(identify.data.identifyBusy, false);
});

const flushPaint = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function paintingPage() { const detail = page(false); detail.onLoad({ game: 'paint' }); detail.onShow(); return detail; }
function paintingTransport() {
  const calls = [], files = new Set();
  wx.getFileSystemManager = () => ({ accessSync(file) { if (!files.has(file)) throw Error('missing'); } });
  wx.downloadFile = input => { const path = 'wxfile://tmp/' + input.url.split('/').pop(); files.add(path); input.success({ statusCode: 200, tempFilePath: path }); };
  wx.request = input => {
    calls.push(input);
    input.success({ statusCode: 200, data: input.method === 'POST' ? { taskId: 'task-' + calls.filter(call => call.method === 'POST').length, status: 'queued' } : { status: 'succeeded', imageUrl: 'https://art.example/' + input.url.split('/').pop() + '.png' } });
  };
  return { calls, files };
}

test('leaving before submission returns retains the task and resumes once without another POST', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = paintingTransport(); const request = wx.request; let finish;
  wx.request = input => { if (input.method === 'POST') { transport.calls.push(input); finish = input.success; } else request(input); };
  const first = paintingPage(); first.setData({ paintKeyword: '霜降摘柿' });
  const submission = first.generatePaint(); first.onUnload();
  const returned = paintingPage(); assert.equal(returned.data.paintBusy, true);
  returned.generatePaint(); assert.equal(transport.calls.length, 1);
  finish({ statusCode: 202, data: { taskId: 'retained-job', status: 'queued' } });
  await submission; await flushPaint();
  assert.equal(returned.data.paintKeyword, '霜降摘柿');
  t.mock.timers.tick(2500); await flushPaint();
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 1);
  assert.match(transport.calls.at(-1).url, /retained-job$/);
  assert.equal(returned.data.paintImage, 'wxfile://tmp/retained-job.png'); assert.equal(returned.data.paintBusy, false);
  returned.onUnload();
  const complete = paintingPage();
  assert.equal(complete.data.paintImage, returned.data.paintImage); assert.equal(complete.data.paintKeyword, '霜降摘柿');
  assert.equal(transport.calls.length, 2, 'a completed local result needs neither a POST nor another status request');
  complete.onUnload();
});

test('queued task resumes after unload, and an expired local image downloads the saved result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = paintingTransport();
  const first = paintingPage(); first.setData({ paintKeyword: '芒种采梅' }); await first.generatePaint(); first.onUnload();
  const returned = paintingPage(); t.mock.timers.tick(2500); await flushPaint();
  assert.equal(returned.data.paintBusy, false); assert.ok(returned.data.paintImage);
  const requests = transport.calls.length; returned.onUnload(); transport.files.clear();
  const restored = paintingPage(); await flushPaint();
  assert.ok(restored.data.paintImage); assert.equal(restored.data.paintBusy, false);
  assert.equal(transport.calls.length, requests, 'a reclaimed temp file is restored from its saved URL, without generating again');
  restored.onUnload();
});

test('personal and demo painting sessions remain separate even when they share device pairing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = paintingTransport();
  const personal = paintingPage(); personal.setData({ paintKeyword: '个人果园' }); await personal.generatePaint(); personal.onUnload();
  store.enterDemo(); i18n.invalidateLang();
  const demo = paintingPage(); assert.equal(demo.data.paintKeyword, ''); assert.equal(demo.data.paintImage, '');
  demo.setData({ paintKeyword: '演示麦田' }); await demo.generatePaint(); demo.onUnload();
  store.exitDemo(); i18n.invalidateLang();
  const restored = paintingPage(); assert.equal(restored.data.paintKeyword, '个人果园');
  t.mock.timers.tick(2500); await flushPaint();
  assert.match(transport.calls.at(-1).url, /task-1$/); assert.equal(restored.data.paintImage, 'wxfile://tmp/task-1.png');
  assert.equal(store.readPartitionField('paintSessions', 'demo')[0].taskId, 'task-2');
  restored.onUnload();
});

test('changing service or pairing identity never displays another connection’s painting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = paintingTransport(); const initial = store.getCloudConnection();
  const first = paintingPage(); first.setData({ paintKeyword: '原服务的作品' }); await first.generatePaint();
  t.mock.timers.tick(2500); await flushPaint(); first.onUnload();
  store.saveSettings({ apiBase: 'https://other.example' });
  store.saveSession({ token: 'b'.repeat(64), expiresAt: Date.now() + 600000 }, 'https://other.example');
  const other = paintingPage(); assert.equal(other.data.paintImage, ''); assert.equal(other.data.paintKeyword, ''); other.onUnload();
  store.saveSettings({ apiBase: initial.apiBase });
  store.saveSession({ token: 'c'.repeat(64), expiresAt: Date.now() + 600000 }, initial.apiBase);
  const paired = paintingPage(); assert.equal(paired.data.paintImage, ''); assert.equal(paired.data.paintKeyword, ''); paired.onUnload();
  store.saveSession({ token: initial.token, expiresAt: Date.now() + 600000 }, initial.apiBase);
  const original = paintingPage(); assert.equal(original.data.paintImage, 'wxfile://tmp/task-1.png');
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 1); original.onUnload();
});

test('late download stays with its captured account, and clearing an account cannot resurrect its task', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  paintingTransport(); let finishDownload;
  wx.downloadFile = input => { finishDownload = input.success; };
  const first = paintingPage(); first.setData({ paintKeyword: '秋收' }); await first.generatePaint();
  t.mock.timers.tick(2500); await flushPaint(); first.onUnload();
  store.enterDemo(); const demo = paintingPage();
  finishDownload({ statusCode: 200, tempFilePath: 'wxfile://tmp/personal-only.png' }); await flushPaint();
  assert.equal(demo.data.paintImage, ''); assert.equal(store.readPartitionField('paintSessions', 'demo'), null);
  assert.equal(store.readPartitionField('paintSessions', 'personal')[0].imagePath, 'wxfile://tmp/personal-only.png'); demo.onUnload();
  store.exitDemo(); store.clearAll(); assert.equal(store.readPartitionField('paintSessions', 'personal'), null);
  let finishSubmit; wx.request = input => { finishSubmit = input.success; };
  const pending = paintingPage(); pending.setData({ paintKeyword: '清空前' }); const submission = pending.generatePaint();
  store.clearAll(); finishSubmit({ statusCode: 202, data: { taskId: 'cleared-job', status: 'queued' } }); await submission;
  assert.equal(store.readPartitionField('paintSessions', 'personal'), null); assert.equal(pending.data.paintBusy, false); pending.onUnload();
});

test('failed task is retryable and temporary polling failures retain the original job', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = paintingTransport(); const request = wx.request; let failed = false;
  wx.request = input => {
    if (input.method === 'GET' && !failed) { failed = true; transport.calls.push(input); input.success({ statusCode: 200, data: { status: 'failed', message: 'Provider failed' } }); }
    else request(input);
  };
  const detail = paintingPage(); detail.setData({ paintKeyword: '梅子' }); await detail.generatePaint();
  t.mock.timers.tick(2500); await flushPaint();
  assert.equal(detail.data.paintBusy, false); assert.equal(detail.data.paintNote, 'Provider failed');
  await detail.generatePaint(); assert.equal(transport.calls.filter(call => call.method === 'POST').length, 2);
  wx.request = input => { transport.calls.push(input); input.fail({ errMsg: 'timeout' }); };
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(2500); await flushPaint(); }
  assert.equal(detail.data.paintBusy, false); detail.onUnload();
  wx.request = request; const resumed = paintingPage(); t.mock.timers.tick(2500); await flushPaint();
  assert.equal(resumed.data.paintImage, 'wxfile://tmp/task-2.png');
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 2); resumed.onUnload();
});
