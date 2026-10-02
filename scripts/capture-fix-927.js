'use strict';
// 9.27 修改巡检：针对本轮改动页面的截图验证（demo 分区隔离，结束后恢复个人模式）。
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
      getApp().__fixBackup = { demoPresent: present.includes('guayouji.demo.v1'), demo: wx.getStorageSync('guayouji.demo.v1'), personal: JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')) };
      return true;
    });
    backedUp = true;
    await navigate('/pages/mine/mine');
    await evaluate(() => { getCurrentPages().slice(-1)[0].enterDemo(); return true; });
    await pause(500);

    await navigate('/pages/index/index');
    await pause(600);
    await shot('p01-home-carousel');

    await navigate('/pages/calendar/calendar');
    await pause(900);
    await shot('p02-calendar-spring');
    await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.choose({ currentTarget: { dataset: { id: 'summer' } } }); return true; });
    await pause(700);
    await shot('p02-calendar-summer-bayberry');

    await navigate('/pages/learn/learn');
    await pause(600);
    await shot('p03-learn-cards');

    await navigate('/pages/fruit-note/fruit-note?fruit=summer-bayberry&cat=folk');
    await pause(700);
    await shot('p19-bayberry-summer');

    await navigate('/pages/craft-lesson/craft-lesson?fruit=summer-mangosteen');
    await pause(700);
    await shot('p17-craft-ingredients');

    await navigate('/pages/journal/journal');
    await pause(700);
    await shot('p21-journal-story');

    await navigate('/pages/place-finder/place-finder');
    await pause(500);
    await evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      for (const [qid, oid] of [['fruits', '西瓜'], ['activity', 'pick'], ['timing', 'soon']]) p.toggleOption({ currentTarget: { dataset: { qid, oid } } });
      return true;
    });
    await pause(300);
    await evaluate(() => { getCurrentPages().slice(-1)[0].generate(); return true; });
    await pause(1500);
    await evaluate(() => { wx.pageScrollTo({ selector: '.finder-note', duration: 0 }); return true; });
    await pause(600);
    await shot('p20-place-finder-local');
  } finally {
    try {
      if (backedUp) {
        const restored = await evaluate(() => {
          const b = getApp().__fixBackup;
          if (!b) throw new Error('Demo backup unavailable');
          if (b.demoPresent) wx.setStorageSync('guayouji.demo.v1', b.demo); else wx.removeStorageSync('guayouji.demo.v1');
          wx.setStorageSync('guayouji.active-mode.v1', 'personal');
          delete getApp().__fixBackup;
          return wx.getStorageSync('guayouji.active-mode.v1') === 'personal';
        });
        await navigate('/pages/index/index');
        console.log(restored ? 'demo restored; personal mode active' : 'RESTORE FAILED');
      }
    } finally {
      mp.disconnect();
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
