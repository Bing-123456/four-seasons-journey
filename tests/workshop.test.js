'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lesson = require('../miniprogram/data/workshop');
const workshop = require('../miniprogram/lib/workshop');
const store = require('../miniprogram/lib/store');

function ingredientsDone() {
  let state = workshop.initialState();
  state = workshop.transition(state, 'ingredient', 'watermelon');
  state = workshop.transition(state, 'ingredient', 'soybean');
  return workshop.transition(state, 'confirm-ingredients');
}

test('ingredient choices reject an incorrect pair and retain a clear route to retry', () => {
  const initial = workshop.initialState();
  let state = workshop.transition(initial, 'confirm-ingredients');
  assert.equal(state.step, 0);
  assert.match(state.feedback, /两种/);
  state = workshop.transition(state, 'ingredient', 'rice');
  state = workshop.transition(state, 'ingredient', 'apple');
  const beforeExtraChoice = state.selectedIds.slice();
  state = workshop.transition(state, 'ingredient', 'watermelon');
  assert.deepEqual(state.selectedIds, beforeExtraChoice);
  assert.match(state.feedback, /取消/);
  state = workshop.transition(state, 'confirm-ingredients');
  assert.equal(state.step, 0);
  assert.equal(state.ingredientOK, false);
  state = workshop.transition(state, 'ingredient', 'rice');
  state = workshop.transition(state, 'ingredient', 'apple');
  state = workshop.transition(state, 'ingredient', 'watermelon');
  state = workshop.transition(state, 'ingredient', 'soybean');
  state = workshop.transition(state, 'confirm-ingredients');
  assert.equal(state.step, 1);
  assert.equal(state.ingredientOK, true);
  assert.deepEqual(initial.selectedIds, [], 'state transitions do not mutate prior progress');
});

test('process reading supports any order, revisits without duplicate progress, and next-button exploration', () => {
  let state = ingredientsDone();
  assert.deepEqual(state.visitedProcessIds, ['boil']);
  state = workshop.transition(state, 'process', 3);
  state = workshop.transition(state, 'process', 3);
  assert.equal(state.visitedProcessIds.length, 2);
  state = workshop.transition(state, 'continue');
  assert.equal(state.activeProcessIndex, 1);
  assert.equal(state.step, 1);
  state = workshop.transition(state, 'continue');
  assert.equal(state.activeProcessIndex, 2);
  assert.equal(state.visitedProcessIds.length, 4);
  state = workshop.transition(state, 'continue');
  assert.equal(state.step, 2);
  state = workshop.transition(state, 'previous');
  assert.equal(state.step, 1);
  assert.equal(state.visitedProcessIds.length, 4);
  for (const invalid of [-1, 4, NaN, 1.5]) assert.deepEqual(workshop.transition(state, 'process', invalid), state);
});

test('completion requires understanding and stays completed when reviewing a finished lesson', () => {
  let state = ingredientsDone();
  while (state.step === 1) state = workshop.transition(state, 'continue');
  state = workshop.transition(state, 'complete');
  assert.equal(state.completed, false);
  assert.equal(state.step, 2);
  state = workshop.transition(state, 'answer', 'instant');
  assert.equal(state.answerOK, false);
  assert.match(state.feedback, /多道工序/);
  state = workshop.transition(state, 'answer', 'forecast');
  assert.equal(state.answerOK, false);
  assert.match(state.feedback, /不能/);
  state = workshop.transition(state, 'answer', 'craft');
  state = workshop.transition(state, 'complete');
  assert.equal(state.step, 3);
  assert.equal(state.completed, true);
  state = workshop.transition(state, 'previous');
  assert.equal(state.step, 2);
  assert.equal(state.completed, true);
  state = workshop.transition(state, 'complete');
  assert.equal(state.step, 3);
});

test('every cultural fragment and the question resolve to a dated public source', () => {
  const sets = [lesson.introSourceIds, lesson.ingredientSourceIds, lesson.question.sourceIds, ...lesson.processes.map(step => step.sourceIds)];
  sets.forEach(ids => {
    assert.ok(ids.length > 0);
    ids.forEach(id => {
      const source = lesson.sources.find(item => item.id === id);
      assert.ok(source);
      assert.match(source.url, /^https:\/\/(public\.zhongmu\.gov\.cn|www\.peopleapp\.com)\//);
      assert.match(source.date, /^\d{4}-\d{2}-\d{2}$/);
    });
  });
  assert.equal(lesson.placeId, 'summer-kitchen');
  assert.equal(lesson.processes.length, 4);
});

const priorWx = global.wx;
const priorPage = global.Page;
const priorGetCurrentPages = global.getCurrentPages;
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset } });
let calls, storage, failWrites, pageStack;

function pageController(options) {
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/workshop/index');
  delete require.cache[file];
  require(file);
  const page = Object.assign({}, definition, { data: clone(definition.data), setData(value) { Object.assign(this.data, value); } });
  page.onLoad(options);
  return page;
}

function finish(page) {
  page.selectIngredient(event({ id: 'watermelon' }));
  page.selectIngredient(event({ id: 'soybean' }));
  page.confirmIngredients();
  while (page.data.step === 1) page.continueToQuiz();
  page.selectAnswer(event({ id: 'craft' }));
  page.completeLesson();
}

test.beforeEach(() => {
  calls = { navigation: [], back: [], clipboard: [], toasts: [], scroll: [] };
  storage = new Map(); failWrites = false;
  pageStack = [{ route: 'pages/workshop/index', options: {} }];
  global.getCurrentPages = () => pageStack;
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => { if (failWrites) throw new Error('full'); storage.set(key, clone(value)); },
    removeStorageSync: key => storage.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    navigateBack: options => calls.back.push(options.delta),
    switchTab: options => calls.navigation.push(options.url),
    setClipboardData: options => calls.clipboard.push(options.data),
    showToast: options => calls.toasts.push(options),
    pageScrollTo: options => calls.scroll.push(options)
  };
  store.clearAll();
});

test.after(() => { global.wx = priorWx; global.Page = priorPage; global.getCurrentPages = priorGetCurrentPages; });

test('unknown lesson ids show an honest empty state and a working home exit', () => {
  const page = pageController({ id: 'not-a-lesson' });
  assert.equal(page.data.validLesson, false);
  assert.match(page.data.error, /没有收录/);
  page.selectIngredient(event({ id: 'watermelon' }));
  assert.deepEqual(page.data.selectedIds, []);
  assert.equal(store.getEvents().length, 0);
  page.backHome();
  assert.deepEqual(calls.navigation, ['/pages/index/index']);
});

test('skip opens the matching culture note without pretending the lesson was completed', () => {
  const page = pageController();
  page.skipToReading();
  assert.equal(calls.navigation[0], '/pages/culture/culture?id=summer-kitchen');
  assert.equal(page.data.completed, false);
  assert.equal(store.getEvents().filter(item => item.type === 'workshop_complete').length, 0);
  assert.equal(store.getEvents().filter(item => item.type === 'workshop_skip').length, 1);
});

test('reading returns to the nearest existing matching note with the correct stack delta', () => {
  const page = pageController();
  const originalNote = { route: 'pages/culture/culture', data: { place: { id: 'summer-kitchen' }, question: '原有阅读状态' } };
  pageStack = [
    { route: 'pages/index/index' },
    { route: 'pages/culture/culture', options: { id: 'summer-kitchen' } },
    originalNote,
    { route: 'pages/heritage/index', options: { id: 'grain-mill' } },
    { route: 'pages/workshop/index', options: { id: lesson.id } }
  ];
  page.readNote();
  assert.deepEqual(calls.back, [2]);
  assert.deepEqual(calls.navigation, []);
  assert.equal(originalNote.data.question, '原有阅读状态');
  pageStack = [pageStack[0], pageStack[1], pageStack[4]];
  page.skipToReading();
  assert.deepEqual(calls.back, [2, 1]);
  assert.equal(page.data.completed, false);
});

test('an unrelated culture page does not intercept the lesson handoff or the mill link', () => {
  const page = pageController();
  pageStack = [
    { route: 'pages/culture/culture', data: { place: { id: 'summer-field' } }, options: { id: 'summer-kitchen' } },
    { route: 'pages/culture/culture', options: { id: 'autumn-workshop' } },
    { route: 'pages/workshop/index', options: { id: lesson.id } }
  ];
  page.readNote();
  assert.deepEqual(calls.back, []);
  assert.deepEqual(calls.navigation, ['/pages/culture/culture?id=summer-kitchen']);
  pageStack[0] = { route: 'pages/culture/culture', data: { place: { id: 'summer-kitchen' } } };
  page.openMill();
  assert.deepEqual(calls.back, []);
  assert.equal(calls.navigation[1], '/pages/heritage/index?id=grain-mill');
});

test('a failed return keeps the lesson available without stacking a duplicate note', () => {
  const page = pageController();
  finish(page);
  pageStack = [
    { route: 'pages/culture/culture', options: { id: 'summer-kitchen' } },
    { route: 'pages/workshop/index' }
  ];
  global.wx.navigateBack = options => options.fail();
  page.readNote();
  assert.equal(page.data.step, 3);
  assert.match(page.data.error, /重试/);
  assert.deepEqual(calls.navigation, []);
});

test('completion is recorded once, saving is idempotent, and handoff stays attached to the correct story', () => {
  const page = pageController();
  finish(page);
  page.previousStep(); page.completeLesson(); page.completeLesson();
  assert.equal(store.getEvents().filter(item => item.type === 'workshop_complete').length, 1);
  page.saveNote(); page.saveNote();
  assert.deepEqual(store.getFavorites(), ['summer-kitchen']);
  assert.equal(page.data.favorite, true);
  assert.match(page.data.saveStatus, /我的/);
  page.readNote(); page.openMill();
  assert.deepEqual(calls.navigation, ['/pages/culture/culture?id=summer-kitchen', '/pages/heritage/index?id=grain-mill']);
  page.viewSources();
  assert.equal(page.data.sources.length, 2);
  page.copySource(event({ id: 'S8' }));
  assert.equal(calls.clipboard[0], lesson.sources[1].url);
  page.closeSources(); assert.equal(page.data.sourceVisible, false);
});

test('storage and navigation failures leave reading usable and explain failed saving', () => {
  failWrites = true;
  const page = pageController();
  finish(page);
  assert.equal(page.data.completed, true, 'failed event writes do not interrupt the lesson');
  page.saveNote();
  assert.equal(page.data.favorite, false);
  assert.match(page.data.error, /收藏没有保存成功/);
  global.wx.navigateTo = options => options.fail();
  page.readNote();
  assert.match(page.data.error, /重试/);
  assert.equal(page.data.step, 3);
  failWrites = false;
  page.saveNote();
  assert.equal(page.data.favorite, true);
  assert.equal(page.data.error, '');
});
