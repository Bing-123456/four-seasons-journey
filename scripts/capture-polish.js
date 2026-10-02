'use strict';
// Native screenshots use only the isolated demo partition. Navigation is queued
// after App.evaluate returns because a route change can drop its bridge reply.
const automator = require('miniprogram-automator');
const path = require('node:path');
const fs = require('node:fs');
const output = path.resolve('test-results/repair-20260925');
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
  const report = { startedAt: new Date().toISOString(), environment: 'WeChat DevTools native simulator', screenshots: [], geometry: {}, personalUnchanged: false, modeRestored: false, limits: ['Native simulator screenshots, not physical device gestures', 'Demo partition only; no AI generation or personal profile edits'] };
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
  const shot = async (name, selectors, scrollSelector) => {
    if (scrollSelector) { await evaluate(selector => { wx.pageScrollTo({ selector, duration: 0 }); return true; }, scrollSelector); await pause(450); }
    await bounded(mp.screenshot({ path: path.join(output, name + '.png') }), 'screenshot ' + name);
    report.screenshots.push(name + '.png');
    await evaluate(selectors => {
      const app = getApp(); app.__polishGeometry = null;
      const q = wx.createSelectorQuery();
      selectors.forEach(selector => q.selectAll(selector).boundingClientRect());
      q.exec(results => { app.__polishGeometry = results.map((nodes, index) => ({ selector: selectors[index], nodes: (nodes || []).map(n => ({ left: n.left, right: n.right, top: n.top, width: n.width, height: n.height })) })); });
      return true;
    }, selectors);
    await pause(300);
    report.geometry[name] = await evaluate(() => getApp().__polishGeometry);
    console.log(name + ': rendered');
  };
  try {
    await evaluate(() => {
      const present = wx.getStorageInfoSync().keys;
      getApp().__polishBackup = { demoPresent: present.includes('guayouji.demo.v1'), demo: wx.getStorageSync('guayouji.demo.v1'), personal: JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')) };
      return true;
    });
    backedUp = true;
    report.viewport = await evaluate(() => { const s = wx.getSystemInfoSync(); return { width: s.windowWidth, height: s.windowHeight, pixelRatio: s.pixelRatio }; });
    await navigate('/pages/mine/mine');
    await evaluate(() => { getCurrentPages().slice(-1)[0].enterDemo(); return true; });
    await evaluate(() => {
      const key = 'guayouji.demo.v1', state = wx.getStorageSync(key);
      state.identity = Object.assign({}, state.identity, { role: 'tourist', roleChosen: true, greetingCustomized: true });
      wx.setStorageSync(key, state); return true;
    });
    for (const [name, route, selectors] of [
      ['home', '/pages/index/index', ['.page', '.home-masthead', '.guoling-search', '.forecast-card']],
      ['learn', '/pages/learn/learn', ['.page', '.studio-illustration', '.game-card']],
      ['mine', '/pages/mine/mine', ['.page', '.profile-header', '#farm-card', '.farm-calendar']],
      ['companion', '/pages/companion/companion', ['.page', '.template-grid', '.editor-bottom']],
      ['seller', '/pages/seller/index', ['.page', '.signals', '.signal-card', '.section-bar']]
    ]) {
      await navigate(route);
      if (name === 'seller') { await evaluate(() => { getCurrentPages().slice(-1)[0].chooseSection({ currentTarget: { dataset: { section: 'ai' } } }); return true; }); await pause(600); }
      await shot(name, selectors);
      if (name === 'seller') await shot('seller-signals', ['.signals', '.signal-card'], '.signals');
      if (name === 'mine') await shot('mine-calendar', ['#farm-card', '.farm-calendar'], '#farm-card');
      if (name === 'companion') {
        await shot('companion-canvas', ['.canvas-paper', '.editor-canvas', '.editor-bottom'], '.canvas-heading');
        await evaluate(() => {
          const app = getApp(), p = getCurrentPages().slice(-1)[0]; app.__polishCanvasExport = null;
          wx.canvasToTempFilePath({ canvas: p._canvas, fileType: 'png', success(result) {
            wx.getFileSystemManager().readFile({ filePath: result.tempFilePath, encoding: 'base64', success(file) { app.__polishCanvasExport = { ready: p.data.canvasReady, data: file.data }; }, fail() { app.__polishCanvasExport = { error: 'Canvas image read failed' }; } });
          }, fail() { app.__polishCanvasExport = { error: 'Canvas image export failed' }; } });
          return true;
        });
        let canvasExport;
        for (let attempt = 0; attempt < 24 && !canvasExport; attempt++) { await pause(250); canvasExport = await evaluate(() => getApp().__polishCanvasExport); }
        if (!canvasExport || canvasExport.error) throw new Error(canvasExport && canvasExport.error || 'Canvas export timed out');
        fs.writeFileSync(path.join(output, 'companion-canvas-export.png'), Buffer.from(canvasExport.data, 'base64'));
        report.canvas = { ready: canvasExport.ready, exportFile: 'companion-canvas-export.png', screenshotLimit: 'Native editor canvas pixels may be omitted by automator screenshots; exported pixels are verified separately.' };
      }
    }
    await navigate('/pages/index/index');
    await evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.setData({ welcomeVisible: true }); return true; });
    await pause(1100);
    await shot('welcome', ['.welcome-center', '#welcome-companion']);
  } finally {
    try {
      if (backedUp) {
        const restored = await evaluate(() => {
          const b = getApp().__polishBackup;
          if (!b) throw new Error('Demo backup unavailable');
          const unchanged = JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')) === b.personal;
          if (b.demoPresent) wx.setStorageSync('guayouji.demo.v1', b.demo); else wx.removeStorageSync('guayouji.demo.v1');
          wx.setStorageSync('guayouji.active-mode.v1', 'personal');
          delete getApp().__polishBackup; delete getApp().__polishGeometry; delete getApp().__polishCanvasExport;
          return { personalUnchanged: unchanged, modeRestored: wx.getStorageSync('guayouji.active-mode.v1') === 'personal' };
        });
        Object.assign(report, restored);
        await navigate('/pages/index/index');
      }
    } finally {
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2) + '\n');
      mp.disconnect();
    }
  }
  if (!report.personalUnchanged || !report.modeRestored) throw new Error('Account preservation verification failed');
  console.log('Personal account unchanged; personal mode restored.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
