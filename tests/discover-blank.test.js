'use strict';

// 发现页（2026-10-06 用户决定下方留白、A+B 学习成果兑现设计撤销）回归：
//   发现页只保留三图自动轮播，下方保持空白，不得复活旧入口、不得重新引用 action-loop/farmtown。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const original = { wx: global.wx, Page: global.Page };

function read(file) { return fs.readFileSync(path.resolve(root, file), 'utf8'); }
function loadPage(name, basename) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(root, 'miniprogram/pages', name, (basename || name) + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    getTabBar: () => ({ setData() {} }),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts[parts.length - 1]] = value;
      });
      if (callback) callback();
    }
  });
}

test.beforeEach(() => {
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    navigateTo: () => {}, switchTab: () => {}, setNavigationBarTitle: () => {}, showToast: () => {},
    request: options => options.fail({ errMsg: 'test offline' })
  };
  store.clearAll();
  i18n.invalidateLang();
});
test.after(() => { global.wx = original.wx; global.Page = original.Page; i18n.invalidateLang(); });

test('the discover page keeps the carousel and leaves the space below blank', () => {
  const markup = read('miniprogram/pages/index/index.wxml');
  assert.match(markup, /id="farming-forecast"/, '三图自动轮播保留');
  assert.match(markup, /<swiper class="feature-swiper"[^>]*autoplay="\{\{true\}\}"/, '轮播仍然自动连播');
  // 2026-10-06 用户决定下方留白、A+B 学习成果兑现设计撤销：这些板块不得存在。
  ['study-progress', 'action-loop', 'action-towns', 'action-tally'].forEach(id =>
    assert.doesNotMatch(markup, new RegExp('id="' + id + '"'), id + ' 板块不应存在（已被用户撤销）'));
  const js = read('miniprogram/pages/index/index.js');
  assert.doesNotMatch(js, /require\(['"]\.\.\/\.\.\/lib\/action-loop['"]\)/, 'index 不再引用 action-loop');
  assert.doesNotMatch(js, /require\(['"]\.\.\/\.\.\/lib\/farmtown-service['"]\)/, 'index 不再引用 farmtown-service');
  assert.doesNotMatch(markup, /home-shortcuts/, '旧入口不应复活');
});

test('the discover page does not load learning-payoff data (space below kept blank)', () => {
  const page = loadPage('index');
  page.onShow();
  assert.equal(page.data.study, undefined, '游学进度数据已移除');
  assert.equal(page.data.actionFruit, undefined, '挑果卡数据已移除');
  assert.equal(page.data.actionTowns, undefined, '果乡列表数据已移除');
  assert.equal(page.data.tally, undefined, '兑现计数数据已移除');
  // 原版默认分享可保留，但 A+B 的果乡分享逻辑必须消失。
  if (typeof page.onShareAppMessage === 'function') {
    const shared = page.onShareAppMessage({});
    assert.equal(shared.path, '/pages/index/index', '分享落地页仍是发现页，不含果乡');
    assert.doesNotMatch(JSON.stringify(shared), /town|actionTowns|果乡/, '默认分享不再带果乡');
  }
});

test('the discover page no longer shares farm towns (A+B design removed)', () => {
  const js = read('miniprogram/pages/index/index.js');
  assert.doesNotMatch(js, /openTown|actionTowns|al_town|\bgoRoute\b/, '发现页不再含果乡分享/列表/跳转逻辑（goRoutePlan 路线规划除外）');
});
