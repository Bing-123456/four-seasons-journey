'use strict';

// 英文模式端到端验证：开发者工具模拟器内切换语言，抽查各页 L 词条为英文并截图。
// 结束时把语言恢复为中文，不遗留任何存储改动。
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hasLatin = value => typeof value === 'string' && /[A-Za-z]/.test(value);

async function run() {
  const output = path.resolve(__dirname, '../test-results/current-native');
  fs.mkdirSync(output, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' });
  const evaluate = (fn, ...args) => mp.evaluate(fn, ...args);
  async function navigate(url) {
    await evaluate(url => new Promise((resolve, reject) => wx.reLaunch({ url, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })), url);
    await sleep(600);
  }
  async function shot(name) {
    await mp.screenshot({ path: path.join(output, 'en-' + name + '.png') });
    console.log('SHOT', name);
  }
  const pages = [
    { url: '/pages/index/index', name: 'index', key: 'id_bag_sub', notKey: null },
    { url: '/pages/calendar/calendar', name: 'calendar', key: 'cal_month_note' },
    { url: '/pages/route/route', name: 'route', key: 'rt_time_note' },
    { url: '/pages/mine/mine', name: 'mine', key: 'farm_intro' },
    { url: '/pages/learn/learn', name: 'learn', key: 'games_title1' },
    { url: '/pages/profile/profile', name: 'profile', key: 'pf_sheet_text' },
    { url: '/pages/search/search', name: 'search', key: 'guoling_intro' },
    { url: '/pages/places/places', name: 'places', key: 'pl_intro' },
    { url: '/pages/workshop/index', name: 'workshop', key: 'ws_ing_note' }
  ];
  const results = [];
  try {
    // 语言切到英文（个人分区设置；结束时恢复 zh）。
    await navigate('/pages/mine/mine');
    let page = await evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { route: p.route, language: p.data.settings.language };
    });
    console.log('before', JSON.stringify(page));
    await mp.callWxMethod('setStorageSync', 'guayouji.active-mode.v1', 'personal');
    await evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      if (p.route !== 'pages/mine/mine') return false;
      p.toggleAppLanguage();
      return true;
    });
    await sleep(400);
    for (const item of pages) {
      await navigate(item.url);
      const probe = await evaluate(key => {
        const p = getCurrentPages().slice(-1)[0];
        const L = p.data && p.data.L || {};
        return { route: p.route, value: L[key] || null, keys: Object.keys(L).length };
      }, item.key);
      assert.equal(probe.route, item.url.replace(/^\//, '').split('?')[0], item.name + ' route');
      assert.ok(probe.keys > 0, item.name + ' L 已注入');
      assert.ok(hasLatin(probe.value), item.name + ' L.' + item.key + ' 应为英文，实际: ' + probe.value);
      results.push(item.name + ' ✔ L.' + item.key + ' = ' + String(probe.value).slice(0, 48));
      await shot(item.name);
    }
    // 果农工作台：直连导航验证英文（不依赖身份入口）。
    await navigate('/pages/seller/index');
    const sellerProbe = await evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { value: p.data.L.sl_eyebrow || null, tab: (p.data.tabs || [])[0] || null };
    });
    assert.ok(hasLatin(sellerProbe.value) && hasLatin(sellerProbe.tab), 'seller 页应全英文');
    results.push('seller ✔ L.sl_eyebrow = ' + sellerProbe.value + ' / tab = ' + sellerProbe.tab);
    await shot('seller');
    console.log(results.join('\n'));
    console.log('EN-PASS', results.length, 'pages');
  } finally {
    // 恢复中文，清除本次对个人分区的唯一改动。
    try {
      await evaluate(() => {
        const storage = wx.getStorageSync('guayouji.prototype.v1');
        if (storage && storage.settings) { storage.settings.language = 'zh'; wx.setStorageSync('guayouji.prototype.v1', storage); }
        return true;
      });
      await navigate('/pages/mine/mine');
    } catch (error) { console.warn('restore', error.message); }
    await shot('restore-mine');
  }
}
run().then(() => process.exit(0)).catch(error => { console.error('EN-FAIL', error.message); process.exit(1); });
