'use strict';
// 9.27 修改巡检第二批：本轮改动页面的修改后截图（demo 分区隔离，退出前恢复 demo 与 personal 存储）。
const automator = require('miniprogram-automator');
const path = require('node:path');
const fs = require('node:fs');
const output = path.resolve('test-results/fix-20260927');
fs.mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, label, timeout = 12000) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), timeout); })]); }
  finally { clearTimeout(timer); }
}
(async () => {
  const mp = await bounded(automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' }), 'connect');
  const evaluate = (fn, ...args) => bounded(mp.evaluate(fn, ...args), 'App.evaluate');
  let backedUp = false;
  const navigate = async url => {
    const route = url.replace(/^\//, '').split('?')[0];
    await evaluate(url => { setTimeout(() => wx.reLaunch({ url }), 80); return true; }, url);
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline) {
      await pause(250);
      if (await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return p && p.route; }) === route) { await pause(700); return; }
    }
    throw new Error('Navigation did not settle: ' + route);
  };
  const shot = async name => {
    await bounded(mp.screenshot({ path: path.join(output, name + '.png') }), 'screenshot ' + name);
    console.log(name + ': rendered');
    await pause(250);
  };
  try {
    await evaluate(() => {
      const present = wx.getStorageInfoSync().keys;
      getApp().__fixB = { demoPresent: present.includes('guayouji.demo.v1'), demo: wx.getStorageSync('guayouji.demo.v1'), personal: JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')) };
      return true;
    });
    backedUp = true;
    await navigate('/pages/mine/mine');
    await evaluate(() => { getCurrentPages().slice(-1)[0].enterDemo(); return true; });
    await pause(500);

    // P01：跳过欢迎浮层拍首页轮播
    await navigate('/pages/index/index');
    await evaluate(() => {
      const key = 'guayouji.demo.v1', state = wx.getStorageSync(key);
      state.identity = Object.assign({}, state.identity, { role: 'tourist', roleChosen: true, greetingCustomized: true });
      wx.setStorageSync(key, state); return true;
    });
    await navigate('/pages/index/index');
    await pause(800);
    await shot('p01-home-carousel');

    // P05：农场卡（新 meta 文案 + 小苗说明）
    await navigate('/pages/mine/mine');
    await evaluate(() => { wx.pageScrollTo({ selector: '#farm-card', duration: 0 }); return true; });
    await pause(500);
    await shot('p05-mine-farm');

    // P12：顶部（01 标题 + 模板库）
    await navigate('/pages/companion/companion');
    await pause(700);
    await shot('p12-companion-top');
    // P12：自由描画模式（笔触对齐）+ 03 标题
    await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.chooseTool({ currentTarget: { dataset: { tool: 'brush' } } }); return true; });
    await pause(400);
    await evaluate(() => { wx.pageScrollTo({ selector: '.brush-options', duration: 0 }); return true; });
    await pause(400);
    await shot('p12-companion-brush');
    await evaluate(() => { wx.pageScrollTo({ selector: '.photo-heading', duration: 0 }); return true; });
    await pause(400);
    await shot('p12-companion-03');

    // P13：顶部（方框「切换到游客」）+ AI 分区（无站内提醒）
    await navigate('/pages/seller/index');
    await pause(700);
    await shot('p13-seller-top');
    await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.chooseSection && p.chooseSection({ currentTarget: { dataset: { section: 'ai' } } }); return true; });
    await pause(700);
    await shot('p13-seller-ai');

    // P16：断开云端（临时改 apiBase 为不可达地址），走本地分块路径搜「芒果」
    await navigate('/pages/search/search');
    await evaluate(() => {
      const key = 'guayouji.prototype.v1';
      const state = wx.getStorageSync(key);
      const obj = (state && typeof state === 'object') ? state : {};
      obj.settings = Object.assign({}, obj.settings, { apiBase: 'http://127.0.0.1:9', session: null });
      wx.setStorageSync(key, obj); return true;
    });
    await navigate('/pages/search/search');
    await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.setData({ keyword: '芒果' }); p.ask('芒果'); return true; });
    await pause(1500);
    await shot('p16-search-mango-local');

    // P20：生成结果（云端在线则出云端结果；失败则本地兜底，两者都证明「有结果」）
    await navigate('/pages/place-finder/place-finder');
    await pause(500);
    await evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      for (const [qid, oid] of [['fruits', '西瓜'], ['activity', 'pick'], ['timing', 'soon']]) p.toggleOption({ currentTarget: { dataset: { qid, oid } } });
      p.generate(); return true;
    });
    for (let i = 0; i < 26; i++) {
      await pause(1000);
      const busy = await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return p.data.busy; });
      if (!busy) break;
    }
    await pause(600);
    await evaluate(() => { wx.pageScrollTo({ selector: '.place-card', duration: 0 }); return true; });
    await pause(500);
    await shot('p20-place-finder-results');

    // P23：国风绘画实玩页
    await navigate('/pages/playground/playground?game=paint');
    await pause(900);
    await shot('p23-playground-paint');
  } finally {
    try {
      if (backedUp) {
        const restored = await evaluate(() => {
          const b = getApp().__fixB;
          if (!b) throw new Error('backup unavailable');
          if (b.demoPresent) wx.setStorageSync('guayouji.demo.v1', b.demo); else wx.removeStorageSync('guayouji.demo.v1');
          if (b.personal && typeof b.personal === 'object') wx.setStorageSync('guayouji.prototype.v1', b.personal); else wx.removeStorageSync('guayouji.prototype.v1');
          wx.setStorageSync('guayouji.active-mode.v1', 'personal');
          delete getApp().__fixB;
          return wx.getStorageSync('guayouji.active-mode.v1') === 'personal';
        });
        await navigate('/pages/index/index');
        console.log(restored ? 'demo + personal restored' : 'RESTORE FAILED');
      }
    } finally {
      mp.disconnect();
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
