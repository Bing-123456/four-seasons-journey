'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');

const clone = value => JSON.parse(JSON.stringify(value));

// 与 tests/ui-regressions.test.js 相同的最小小程序环境：storage 走内存 Map。
function withWx(callback) {
  const state = new Map();
  const previousWx = global.wx;
  global.wx = {
    getStorageSync: key => state.get(key), setStorageSync: (key, value) => state.set(key, clone(value)), removeStorageSync: key => state.delete(key),
    navigateTo() {}, switchTab() {}, showActionSheet() {}, chooseLocation() {},
    setNavigationBarTitle() {}, showToast() {}, pageScrollTo() {},
    request: input => input.fail({ errMsg: 'test offline' })
  };
  try { return callback(); } finally { global.wx = previousWx; }
}

test('font scale defaults to standard, persists the chosen tier and rejects unknown tiers', () => {
  withWx(() => {
    store.clearAll();
    assert.equal(store.getFontScale(), 'normal', 'a fresh install reads at standard size');
    assert.equal(store.saveFontScale('large'), 'large');
    assert.equal(store.getFontScale(), 'large');
    assert.equal(store.saveFontScale('xlarge'), 'xlarge');
    assert.equal(store.getFontScale(), 'xlarge', 'the tier survives without re-saving');
    assert.throws(() => store.saveFontScale('huge'), /字体大小/);
    assert.equal(store.getFontScale(), 'xlarge', 'a rejected tap never changes the tier');
    assert.equal(store.saveFontScale('normal'), 'normal');
    assert.equal(store.getFontScale(), 'normal');
  });
});

test('font scale is a device-level preference that survives demo and data clearing', () => {
  withWx(() => {
    store.clearAll();
    store.saveFontScale('large');
    store.enterDemo();
    assert.equal(store.getFontScale(), 'large', 'older users keep their size inside the demo account');
    store.clearAll();
    assert.equal(store.getFontScale(), 'large', 'clearing account data does not reset accessibility');
    store.exitDemo();
  });
});

test('the app exposes the font class helper and mine applies the saved tier at once', () => {
  withWx(() => {
    store.clearAll();
    const previousPage = global.Page;
    const previousApp = global.App;
    let app; let definition;
    global.App = value => { app = value; };
    global.Page = value => { definition = value; };
    const appPath = require.resolve('../miniprogram/app');
    const minePath = require.resolve('../miniprogram/pages/mine/mine');
    try {
      delete require.cache[appPath]; require('../miniprogram/app');
      delete require.cache[minePath]; require('../miniprogram/pages/mine/mine');
      assert.equal(app.getFontClass(), 'fs-normal');
      const page = Object.assign({}, definition, {
        data: clone(definition.data),
        setData(patch) { Object.assign(this.data, patch); },
        getTabBar: () => ({ setData() {} })
      });
      page.onShow();
      assert.equal(page.data.fontScale, 'normal');
      assert.equal(page.data.fontClass, 'fs-normal');
      assert.equal(page.data.fontIndex, 0, 'the slider starts at 标准 under 我的身份');
      assert.ok(page.data.fontTickLeft && page.data.fontTickMid && page.data.fontTickRight, 'slider tick labels are prepared');
      assert.ok(page.data.fontCopy.title, 'the card title copy is inline and bilingual-ready');
      page.onFontSlider({ detail: { value: 2 } });
      assert.equal(store.getFontScale(), 'xlarge', 'choosing a tier persists immediately');
      assert.equal(page.data.fontClass, 'fs-xlarge', 'the page root class updates at once');
      assert.equal(app.getFontClass(), 'fs-xlarge');
      page.onFontSlider({ detail: { value: 9 } });
      assert.equal(page.data.fontClass, 'fs-xlarge', 'unknown values are ignored');
      page.onFontSlider({ detail: { value: 2 } });
      assert.equal(store.getFontScale(), 'xlarge', 're-tapping the chosen tier is a no-op');
    } finally {
      global.Page = previousPage;
      global.App = previousApp;
      delete require.cache[appPath];
      delete require.cache[minePath];
    }
  });
});

test('the mine markup mounts the tier on the page root and app.wxss carries all three tiers', () => {
  const mineWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/mine/mine.wxml'), 'utf8');
  assert.match(mineWxml, /class="page tab-page mine-page \{\{fontClass\}\}"/, 'the page root carries the font class binding');
  assert.match(mineWxml, /bindchanging="onFontSlider"/);
  assert.match(mineWxml, /aria-label="\{\{fontCopy\.title\}\}"/, 'the slider is announced to screen readers');
  assert.match(mineWxml, /font-slider-ticks/, 'slider carries readable tier ticks');
  const appWxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.wxss'), 'utf8');
  // 10.2①：缩放改为 CSS 变量驱动——根节点写入 --fs-scale，任何元素都跟随，不再依赖类名白名单。
  for (const rule of ['.fs-normal { --fs-scale: 1; }', '.fs-large { --fs-scale: 1.15; }', '.fs-xlarge { --fs-scale: 1.32; }']) {
    assert.ok(appWxss.includes(rule), 'app.wxss defines ' + rule);
  }
  const appJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.js'), 'utf8');
  assert.match(appJs, /getFontClass/, 'app.js exposes the helper pages can call');
});

test('every wxss font-size scales with --fs-scale so the whole app follows the setting', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.wxss')) files.push(full);
    }
  })(root);
  assert.ok(files.length > 20, 'scanned the whole style tree, got ' + files.length);
  const bare = [];
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    // 取完整的属性值（到分号或右括号为止），再判断：含 rpx 字号就必须挂上 --fs-scale。
    for (const match of css.matchAll(/font-size:([^;}]+)/g)) {
      const value = match[1];
      if (!/\d+(?:\.\d+)?rpx/.test(value)) continue;
      if (!/var\(--fs-scale/.test(value)) bare.push(path.relative(root, file) + ' -> ' + value.trim());
    }
  }
  assert.deepEqual(bare, [], 'no un-scaled font-size may remain:\n' + bare.join('\n'));
});
