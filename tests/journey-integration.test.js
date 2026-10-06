const { pageFile } = require('./helpers/page-path');
'use strict';

// Integration checks run the actual Page controllers and shared content/store.
// They do not render WXML or claim physical-touch/device coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../miniprogram/data/catalog');
const learning = require('../miniprogram/data/learning');
const lesson = require('../miniprogram/data/workshop');
const core = require('../miniprogram/lib/core');
const store = require('../miniprogram/lib/store');

const originalWx = global.wx;
const originalPage = global.Page;
const root = path.resolve(__dirname, '../miniprogram');
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset: dataset || {} }, detail: {} });
let calls;

function loadPage(relative) {
  let definition;
  global.Page = value => { definition = value; };
  const file = pageFile(relative);
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    getTabBar: () => ({ setData() {} }),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        keys.slice(0, -1).forEach(part => { target = target[part]; });
        target[keys[keys.length - 1]] = value;
      }
    }
  });
}

test.beforeEach(() => {
  const memory = new Map();
  calls = { navigation: [], clipboard: [], toast: [], requests: [] };
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    redirectTo: options => calls.navigation.push(options.url),
    switchTab: options => calls.navigation.push(options.url),
    navigateBack: () => calls.navigation.push('back'),
    showToast: options => calls.toast.push(options),
    setNavigationBarTitle() {},
    setClipboardData: options => calls.clipboard.push(options.data),
    request: options => { calls.requests.push(options); throw Error('Unexpected network request in content journey'); },
    pageScrollTo() {}
  };
  store.clearAll();
  store.saveSettings({ useAI: false });
});

test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('every journey fact resolves to a public source and every linked fact belongs to the same season', () => {
  const sourceIds = new Set(catalog.sources.map(item => item.id));
  const facts = new Map(catalog.facts.map(item => [item.id, item]));
  assert.equal(sourceIds.size, catalog.sources.length, 'source IDs must be unique');
  assert.equal(facts.size, catalog.facts.length, 'fact IDs must be unique');
  for (const fact of catalog.facts) {
    assert.ok(fact.sourceIds.length > 0, fact.id + ' needs a source');
    for (const sourceId of fact.sourceIds) assert.ok(sourceIds.has(sourceId), fact.id + ': missing ' + sourceId);
  }
  for (const place of catalog.places) {
    for (const factId of place.factIds) {
      const fact = facts.get(factId);
      assert.ok(fact, place.id + ': unknown ' + factId);
      assert.equal(fact.season, place.season, place.id + ' must not silently reuse the other season’s facts');
    }
  }
  for (const source of catalog.sources) assert.equal(new URL(source.url).protocol, 'https:');
});

test('new classroom pages are importable native routes with page files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  // 2026-10-06 起 13 个非 tab 页面迁入 packageMore 分包，主包 pages 与分包 pages 均为合法注册位置。
  const registered = manifest.pages.concat(...(manifest.subPackages || []).map(sp => sp.pages.map(p => sp.root + '/' + p)));
  for (const route of ['packageMore/workshop/index', 'packageMore/heritage/index']) {
    assert.ok(registered.includes(route), route + ' must be registered');
    for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.ok(fs.existsSync(path.join(root, route + '.' + extension)), route + '.' + extension);
  }
});

test('home shows the single orchard poster while place links follow their factual context', () => {
  const home = loadPage('index/index');
  home.onShow();
  assert.ok(home.data.poster && home.data.poster.image && home.data.poster.imageBg, 'the discover page shows one fixed orchard poster');
  for (const place of catalog.places) {
    const culture = loadPage('culture/culture');
    culture.onLoad({ id: place.id });
    const expected = ['summer-kitchen', 'summer-field'].includes(place.id) ? learning.sauce : place.id === 'summer-culture' ? learning.grain : null;
    assert.deepEqual(culture.data.lesson, expected, place.id);
    const before = calls.navigation.length;
    culture.openLesson();
    if (expected) assert.equal(calls.navigation.at(-1), expected.url);
    else assert.equal(calls.navigation.length, before, place.id + ' has no related lesson');
  }
});

test('classroom and cultural Q&A cite the same underlying material while refusing unsupported claims', () => {
  for (const source of lesson.sources) assert.ok(catalog.sources.some(item => item.url === source.url), source.url + ' must resolve in the shared cultural catalog');
  const sourceIds = new Set(catalog.sources.map(item => item.id));
  for (const entry of [learning.sauce, learning.grain]) for (const id of entry.sourceIds) assert.ok(sourceIds.has(id), 'entry source ' + id);

  const cases = [
    { question: '瓜豆酱的主要原料是什么？', place: 'summer-kitchen', patterns: [/西瓜/, /黄豆/], fact: 'f-guadou-process', source: 'S8' },
    { question: '石磨盘和磨棒在哪里出土？', place: 'summer-culture', patterns: [/新郑/, /裴李岗/], fact: 'f-grain-origin', source: 'S9' },
    { question: '磨棒怎么使用？', place: 'summer-culture', patterns: [/滚碾|往复|来回/], fact: 'f-grain-motion', source: 'S9' }
  ];
  for (const item of cases) {
    const answer = core.answerQuestion(item.question, item.place);
    assert.equal(answer.unanswerable, false, item.question);
    for (const pattern of item.patterns) assert.match(answer.answer, pattern);
    assert.ok(answer.evidenceIds.includes(item.fact), item.question);
    assert.ok(answer.sourceIds.includes(item.source), item.question);
    for (const evidenceId of answer.evidenceIds) {
      const fact = catalog.facts.find(fact => fact.id === evidenceId);
      assert.ok(fact);
      for (const sourceId of fact.sourceIds) assert.ok(answer.sourceIds.includes(sourceId));
    }
  }
  assert.ok(core.answerQuestion('这里的手作有什么故事？', 'summer-kitchen').evidenceIds.every(id => !id.startsWith('f-kiwi')), 'summer handcraft must not answer using autumn workshop evidence');
  for (const question of ['瓜豆酱发酵需要多少天，温度多少？', '这个瓜豆酱体验今天可以预约吗？', '瓜豆酱是不是省级非遗？', '石磨盘是不是国家级非遗？']) {
    const answer = core.answerQuestion(question, 'summer-kitchen');
    assert.equal(answer.unanswerable, true, question);
    assert.deepEqual(answer.sourceIds, [], question + ' must not borrow unrelated evidence');
    assert.deepEqual(answer.evidenceIds, []);
  }
});

test('sauce lesson requires the right ingredients and understanding, then returns the saved note to the journey', () => {
  const page = loadPage('workshop/index');
  page.onLoad({});
  assert.equal(page.data.step, 0);
  page.selectIngredient(event({ id: 'rice' }));
  page.selectIngredient(event({ id: 'apple' }));
  page.confirmIngredients();
  assert.equal(page.data.step, 0, 'a wrong ingredient must not advance');
  assert.equal(page.data.ingredientOK, false);
  assert.ok(page.data.feedback, 'an incorrect attempt needs explanatory feedback');
  page.selectIngredient(event({ id: 'rice' }));
  page.selectIngredient(event({ id: 'apple' }));
  page.selectIngredient(event({ id: 'watermelon' }));
  page.selectIngredient(event({ id: 'soybean' }));
  page.confirmIngredients();
  assert.equal(page.data.ingredientOK, true);
  assert.equal(page.data.step, 1);
  page.selectProcess(event({ index: 2 }));
  page.selectProcess(event({ index: 0 }));
  page.selectProcess(event({ index: 1 }));
  page.selectProcess(event({ index: 3 }));
  assert.equal(new Set(page.data.visitedProcessIds).size, 4);
  page.continueToQuiz();
  assert.equal(page.data.step, 2);
  page.previousStep();
  assert.equal(page.data.step, 1, 'the learner can revisit the process');
  assert.equal(new Set(page.data.visitedProcessIds).size, 4, 'review should preserve reading progress');
  page.continueToQuiz();
  page.selectAnswer(event({ id: 'instant' }));
  page.completeLesson();
  assert.equal(page.data.completed, false, 'incorrect answers must not be logged as completed learning');
  assert.equal(page.data.step, 2);
  page.selectAnswer(event({ id: 'craft' }));
  page.completeLesson();
  assert.equal(page.data.completed, true);
  assert.equal(page.data.step, 3);
  assert.equal(store.getFavorites().length, 0, 'learning should not silently favorite content');
  page.saveNote();
  assert.ok(store.getFavorites().includes('summer-kitchen'));
  page.saveNote();
  assert.equal(store.getFavorites().filter(id => id === 'summer-kitchen').length, 1);
  page.readNote();
  assert.equal(calls.navigation.at(-1), '/pages/culture/culture?id=summer-kitchen');
  const mine = loadPage('mine/mine');
  mine.onShow();
  assert.ok(mine.data.favorites.some(item => item.id === 'summer-kitchen'), 'the saved classroom note needs to appear in the existing collection');
  assert.equal(calls.requests.length, 0, 'the sourced lesson works without a model request');
});

test('skipping the optional lesson never marks learning complete or silently adds a favorite', () => {
  const page = loadPage('workshop/index');
  page.onLoad({});
  page.skipToReading();
  assert.equal(page.data.completed, false);
  assert.equal(store.getFavorites().length, 0);
  assert.ok(store.getEvents().every(item => item.type !== 'workshop_complete'));
});

test('classroom citations are accessible without completing or saving the lesson', () => {
  const page = loadPage('workshop/index');
  page.onLoad({});
  page.viewAllSources();
  assert.equal(page.data.sourceVisible, true);
  assert.ok(page.data.sources.length >= 2);
  assert.ok(page.data.sources.some(source => source.url === 'https://public.zhongmu.gov.cn/D47Y/4767401.jhtml'));
  assert.ok(page.data.sources.some(source => source.url === 'https://www.peopleapp.com/column/30035319967-500005115460'));
  for (const source of page.data.sources) {
    page.copySource(event({ id: source.id }));
    assert.equal(calls.clipboard.at(-1), source.url);
  }
  assert.equal(page.data.completed, false);
  assert.equal(store.getFavorites().length, 0);
});

test('a renderer failure falls back to the complete text lesson and still connects to the related story', () => {
  const page = loadPage('heritage/index');
  page.onLoad({ id: 'grain-mill' });
  assert.equal(page.data.started, false, 'the initial cover must not load a viewer');
  assert.equal(page.data.ready, false);
  page.startLesson();
  page.onViewerError({ detail: { message: 'WebGL unavailable in test device' } });
  assert.equal(page.data.started, true);
  assert.equal(page.data.textMode, true);
  assert.equal(page.data.ready, false);
  page.nextTextStep();
  page.nextTextStep();
  assert.equal(page.data.step, 2);
  page.answerQuestion(event({ answer: 'spinning' }));
  assert.equal(page.data.completed, false);
  page.answerQuestion(event({ answer: 'rolling' }));
  assert.equal(page.data.completed, true);
  assert.equal(page.data.answerCorrect, true);
  page.copySource();
  assert.equal(calls.clipboard.at(-1), 'https://www.chnmus.net/sitesources/hnsbwy/page_pc/dzjp/mzyp/smpjmb/list1.html');
  page.exploreExperience();
  assert.equal(calls.navigation.at(-1), learning.sauce.url);
  assert.equal(calls.requests.length, 0);
});
