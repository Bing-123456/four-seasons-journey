'use strict';
// 10.2 批次：游戏板块的三处改动——填色可回退/清空、答题进度条、答完后的扇形封面流。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const companionLib = require('../miniprogram/lib/companion');
const fruitQuiz = require('../miniprogram/data/fruit-quiz');
const store = require('../miniprogram/lib/store');
const clone = value => JSON.parse(JSON.stringify(value));
const originalWx = global.wx, originalPage = global.Page;

function stubWx() {
  const memory = new Map();
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    showToast() {}, showModal: value => value.success({ confirm: true }),
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    request() { throw Error('must not access network'); },
    getFileSystemManager: () => ({ accessSync() {}, mkdirSync() {}, copyFile: o => o.success(), unlink: o => o.success() }),
    canvasToTempFilePath: o => o.success({ tempFilePath: 'wxfile://temp/p.png' }),
    navigateBack() {}, navigateTo() {}, setNavigationBarTitle() {}, setClipboardData() {}
  };
}

function companionPage() {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/companion/companion.js');
  delete require.cache[file];
  require(file);
  const noop = new Proxy({}, { get: () => () => {} });
  const subject = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (typeof callback === 'function') callback(); }
  });
  subject.onLoad();
  subject._ctx = noop;
  subject._canvas = { getContext: () => noop };
  subject._bounds = { left: 0, top: 0, width: 512, height: 512 };
  return subject;
}

function playground() {
  const createPlaygroundController = require('../miniprogram/lib/playground-controller');
  const definition = createPlaygroundController();
  const subject = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (typeof callback === 'function') callback(); },
    getTabBar: () => ({ setData() {} })
  });
  return subject;
}

test.beforeEach(() => { stubWx(); store.exitDemo(); store.clearAll(); });
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('fill mode can step back one colour and clear every fill back to the template default', () => {
  const subject = companionPage();
  const region = Object.keys(subject._editor.config.colors)[0];
  const original = subject._editor.config.colors[region];
  subject.setData({ tool: 'fill' });

  subject.change({ type: 'fill', regionId: region, color: '#FF0000' });
  assert.equal(subject._editor.config.colors[region], '#FF0000');
  // 回退一笔：填色模式下撤销上一次填色（描画笔迹不受影响）。
  subject.stepBack();
  assert.equal(subject._editor.config.colors[region], original, 'step back restores the previous colour');

  subject.change({ type: 'fill', regionId: region, color: '#00FF00' });
  assert.equal(subject._editor.config.colors[region], '#00FF00');
  subject.undoAll();
  assert.equal(subject._editor.config.colors[region], original, 'clear restores the template default palette');
});

test('history count drives the undo buttons so they are usable right after a fill', () => {
  const subject = companionPage();
  subject.setData({ tool: 'fill' });
  assert.equal(subject.data.historyCount, 0, 'nothing to undo on a fresh canvas');
  subject.change({ type: 'fill', regionId: Object.keys(subject._editor.config.colors)[0], color: '#FF0000' });
  assert.equal(subject.data.historyCount, 1, 'a fill counts as one undoable step');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/companion/companion.wxml'), 'utf8');
  assert.ok(!/disabled="\{\{!strokeCount\}\}"/.test(wxml), 'undo buttons are no longer gated on stroke count alone');
  assert.match(wxml, /disabled="\{\{!historyCount\}\}"/);
});

test('quiz progress fills as each answer is ticked and reaches full on the last one', () => {
  const subject = playground();
  subject.setData({ quiz: fruitQuiz.buildRound(null, 'zh'), quizIndex: 0, quizAnswered: false });
  const total = subject.data.quiz.length;
  assert.ok(total >= 2, 'the round has several questions');
  // 进度 = 已答题数 / 总题数：未答第一题时为 0，勾一项立刻前进，答完最后一项填满。
  subject.updateQuizTexts();
  assert.equal(subject.data.quizProgressWidth, 0, 'nothing is filled before the first answer');
  subject.setData({ quizAnswered: true });
  subject.updateQuizTexts();
  assert.equal(subject.data.quizProgressWidth, Math.round(1 / total * 100), 'ticking an option advances the bar at once');
  subject.setData({ quizIndex: total - 1, quizAnswered: true });
  subject.updateQuizTexts();
  assert.equal(subject.data.quizProgressWidth, 100, 'the last answer fills the bar completely');
});

test('finishing a round builds centred result cards for owned fruits', () => {
  store.unlockFruit('watermelon');
  store.unlockFruit('apple');
  store.unlockFruit('pear');
  const subject = playground();
  subject.buildCoverflow();
  assert.equal(subject.data.unlockCards.length, 3);
  assert.ok(subject.data.unlockCards.every(card => card.config), 'each card carries a companion config');
  assert.equal(subject.data.coverflowIndex, 0);
});

test('swiping the result cards updates the current index', () => {
  store.unlockFruit('watermelon');
  store.unlockFruit('apple');
  const subject = playground();
  subject.buildCoverflow();
  subject.onResultSwipe({ detail: { current: 1 } });
  assert.equal(subject.data.coverflowIndex, 1);
  subject.onResultSwipe({ detail: { current: 0 } });
  assert.equal(subject.data.coverflowIndex, 0);
  subject.onResultSwipe({ detail: { current: 9 } });
  assert.equal(subject.data.coverflowIndex, 9, 'swiper reports the raw current index');
});

test('a player who owns nothing still sees one placeholder card instead of an empty band', () => {
  const subject = playground();
  subject.buildCoverflow();
  assert.equal(subject.data.unlockCards.length, 1);
  assert.ok(subject.data.unlockCards[0].config, 'the placeholder card still carries a config');
});

test('the result markup renders a fan coverflow of centred fruit cards', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/playground/playground.wxml'), 'utf8');
  assert.match(wxml, /class="coverflow-stage/, 'results render in a coverflow stage');
  assert.match(wxml, /bindtap="coverflowTo"/, 'tapping a card brings it to the centre');
  assert.match(wxml, /coverflow-card/, 'each fruit renders a coverflow card');
  // 10.5：手指左右滑动翻卡——拖动时整组卡片跟手，松手吸附到最近卡片
  assert.match(wxml, /bindtouchstart="coverflowTouchStart"/, 'swipe starts tracking the finger');
  assert.match(wxml, /bindtouchmove="coverflowTouchMove"/, 'cards follow the finger while dragging');
  assert.match(wxml, /bindtouchend="coverflowTouchEnd"/, 'releasing snaps to the nearest card');
  assert.match(wxml, /size="\{\{coverflowFaceSize\}\}"/, 'fruit art scales with the card');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/playground/playground.wxss'), 'utf8');
  assert.match(wxss, /\.coverflow-card/, 'the coverflow card is styled');
  assert.match(wxss, /\.coverflow-stage/, 'the stage has a fixed height');
  // 卡片带横向撑满整屏；拖动中必须关掉过渡，卡片才能实时跟手
  assert.match(wxss, /\.coverflow-wrap \{[^}]*width: 100vw/, 'the strip spans the full screen width');
  assert.match(wxss, /\.coverflow-stage\.is-dragging \.coverflow-card \{ transition: none/, 'dragging disables the transition so cards track the finger');
});

test('the coverflow follows the finger in the right direction', () => {
  const createController = require('../miniprogram/lib/playground-controller');
  const controller = createController({});
  controller.setData = patch => Object.assign(controller.data, patch);
  controller.data.unlockCards = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  controller.data.coverflowIndex = 0;
  controller.data.coverflowDrag = 0;
  const offsetOf = index => Number(/translateX\((-?[\d.]+)%\)/.exec(controller.data.coverflowCards[index].style)[1]);
  controller.updateCoverflowStyles();
  const rest = offsetOf(1);
  assert.ok(rest > 0, '静止时第二张卡在右侧');
  controller.data.coverflowDrag = 0.5; // 手指左滑半张
  controller.updateCoverflowStyles();
  assert.ok(offsetOf(1) < rest, '左滑：后面的卡片向中心靠近');
  controller.data.coverflowDrag = -0.5; // 手指右滑半张
  controller.updateCoverflowStyles();
  assert.ok(offsetOf(1) > rest, '右滑：后面的卡片退回右侧');
  // 中心卡片始终最大最亮：缩放 1、亮度 1
  controller.data.coverflowDrag = 0;
  controller.updateCoverflowStyles();
  const centerStyle = controller.data.coverflowCards[0].style;
  assert.match(centerStyle, /scale\(1\)/);
  assert.match(centerStyle, /brightness\(1\)/);
  assert.match(controller.data.coverflowCards[1].style, /brightness\(0\.7\)/, '邻卡亮度降到 70%');
});

test('clearing fills is only offered for template companions', () => {
  const editor = companionLib.createEditor(companionLib.defaultConfig('watermelon'));
  const filled = companionLib.applyAction(editor, { type: 'fill', regionId: 'body', color: '#123456' });
  assert.equal(filled.config.colors.body, '#123456');
  const cleared = companionLib.applyAction(filled, { type: 'clear-fills' });
  assert.equal(cleared.config.colors.body, companionLib.defaultConfig('watermelon').colors.body);
});
