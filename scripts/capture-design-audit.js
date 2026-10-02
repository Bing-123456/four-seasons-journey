'use strict';
// Native rendering audit. A fresh demo fixture is built in Node, then installed
// temporarily; existing personal/demo data and the exact active mode are restored.
const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');
const memory = new Map();
global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key) };
require('../miniprogram/lib/store').enterDemo();
const fixture = memory.get('guayouji.demo.v1');
delete global.wx;
fixture.identity = { nickname: '林小满', role: 'tourist', roleChosen: true, greetingCustomized: true, welcomeEnabled: false };
const output = path.resolve(process.env.AUDIT_OUTPUT || 'test-results/design-20260926');
const backupKey = 'guayouji.design-audit-backup.v1';
const languages = (process.env.AUDIT_LANGUAGES || 'zh,en').split(',');
const selectedPages = process.env.AUDIT_PAGES ? process.env.AUDIT_PAGES.split(',') : null;
const capture = process.env.AUDIT_CAPTURE !== '0';
const reportName = process.env.AUDIT_REPORT || 'report.json';
const routes = [
  ['home', '/pages/index/index'], ['calendar', '/pages/calendar/calendar'],
  ['learn', '/pages/learn/learn'], ['route', '/pages/route/route'],
  ['mine', '/pages/mine/mine'], ['favorites', '/pages/favorites/favorites'],
  ['places-favorites', '/pages/favorites/favorites?type=places'],
  ['profile', '/pages/profile/profile'], ['culture', '/pages/culture/culture?id=summer-culture'],
  ['heritage', '/pages/heritage/index?id=grain-mill'],
  ['workshop', '/pages/workshop/index'], ['companion', '/pages/companion/companion'],
  ['seller', '/pages/seller/index'], ['places', '/pages/places/places'],
  ['graph', '/pages/graph/graph?season=autumn'], ['search', '/pages/search/search'],
  ['craft-lesson', '/pages/craft-lesson/craft-lesson?fruit=spring-plum'],
  ['account', '/pages/account/account'], ['fruit-note', '/pages/fruit-note/fruit-note?fruit=spring-plum&cat=folk'],
  ['place-finder', '/pages/place-finder/place-finder'], ['world', '/packageWorld/pages/index/index'],
  ['journal', '/pages/journal/journal'], ['fruit-detail', '/pages/fruit-detail/fruit-detail?fruit=spring-plum'],
  ['playground-paint', '/pages/playground/playground?game=paint'], ['playground-quiz', '/pages/playground/playground?game=quiz'],
  ['playground-identify', '/pages/playground/playground?game=identify'], ['route-detail', '/pages/route-detail/route-detail'],
  ['fruit-note-craft', '/pages/fruit-note/fruit-note?fruit=spring-plum&cat=craft']
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, label, timeout = 14000) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), timeout); })]); }
  finally { clearTimeout(timer); }
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const mp = await bounded(automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' }), 'connect');
  const ev = (fn, ...args) => bounded(mp.evaluate(fn, ...args), 'evaluate');
  const report = { startedAt: new Date().toISOString(), pages: [], errors: [], restored: false, limits: ['Native DevTools rendering, not physical device gestures', 'No AI generation invoked', 'Map/canvas native pixels can be absent in automator screenshots'] };
  let current = '', backedUp = false;
  mp.on('exception', error => report.errors.push({ current, message: String(error && error.message || error).slice(0, 300) }));
  async function nav(url) {
    const route = url.slice(1).split('?')[0];
    await ev(value => { setTimeout(() => wx.reLaunch({ url: value }), 80); return true; }, url);
    for (let attempt = 0; attempt < 35; attempt++) {
      await pause(250);
      if (await ev(() => { const page = getCurrentPages().slice(-1)[0]; return page && page.route; }) === route) { await pause(650); return; }
    }
    throw new Error('Navigation failed: ' + route);
  }
  async function shot(name) {
    const file = name + '.png';
    await bounded(mp.screenshot({ path: path.join(output, file) }), 'screenshot', 30000);
    await ev(() => {
      const app = getApp(); app.__designGeometry = null;
      wx.createSelectorQuery().selectAll('.page, .button, .button-secondary, .forecast-card, .forecast-copy, .forecast-poster, .game-card, .card, .page-title').boundingClientRect().exec(results => {
        const info = wx.getSystemInfoSync();
        app.__designGeometry = { width: info.windowWidth, nodes: (results[0] || []).map(node => ({ id: node.id, left: node.left, right: node.right, top: node.top, width: node.width, height: node.height })) };
      });
      return true;
    });
    await pause(150);
    const geometry = await ev(() => getApp().__designGeometry);
    const overflows = geometry ? geometry.nodes.filter(n => n.width > 0 && (n.left < -2 || n.right > geometry.width + 2)) : [];
    report.pages.push({ name, file, bytes: fs.statSync(path.join(output, file)).size, geometry, overflows });
    console.log(name + ': rendered' + (overflows.length ? ' (inspect ' + overflows.length + ' off-screen nodes)' : ''));
  }
  try {
    await ev((seed, backupKey) => {
      const keys = wx.getStorageInfoSync().keys;
      if (keys.includes(backupKey)) throw new Error('An unfinished audit backup exists; restore it before starting another audit');
      const mode = wx.getStorageSync('guayouji.active-mode.v1');
      const source = wx.getStorageSync(mode === 'demo' ? 'guayouji.demo.v1' : 'guayouji.prototype.v1');
      wx.setStorageSync(backupKey, {
        personal: JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')),
        demo: wx.getStorageSync('guayouji.demo.v1'), demoPresent: keys.includes('guayouji.demo.v1'),
        mode, modePresent: keys.includes('guayouji.active-mode.v1'),
        language: source && source.settings && source.settings.language === 'en' ? 'en' : 'zh',
        extras: ['guayouji.farm.demo.v1', 'guayouji.place-recommend.v1.demo'].map(key => ({ key, present: keys.includes(key), value: wx.getStorageSync(key) }))
      });
      ['guayouji.farm.demo.v1', 'guayouji.place-recommend.v1.demo'].forEach(key => wx.removeStorageSync(key));
      wx.setStorageSync('guayouji.demo.v1', seed);
      wx.setStorageSync('guayouji.active-mode.v1', 'demo');
      return true;
    }, fixture, backupKey);
    backedUp = true;
    for (const language of languages) {
      await nav('/pages/mine/mine');
      await ev(language => {
        const state = wx.getStorageSync('guayouji.demo.v1');
        state.settings.language = language === 'en' ? 'zh' : 'en';
        wx.setStorageSync('guayouji.demo.v1', state);
        const page = getCurrentPages().slice(-1)[0]; page.toggleAppLanguage();
        return page.data.appLanguage === language;
      }, language);
      await pause(1700);
      for (const [name, url] of routes) {
        if (selectedPages && !selectedPages.includes(name)) continue;
        current = language + '-' + name;
        await nav(url);
        const markup = fs.readFileSync(path.join('miniprogram', url.split('?')[0] + '.wxml'), 'utf8');
        const labelKeys = [...new Set([...markup.matchAll(/\bL\.([A-Za-z_]\w*)/g)].map(match => match[1]))];
        const missing = await ev(keys => { const labels = getCurrentPages().slice(-1)[0].data.L || {}; return keys.filter(key => labels[key] === undefined || labels[key] === null); }, labelKeys);
        if (missing.length) report.errors.push({ current, missingLabels: missing });
        if (['home', 'calendar', 'learn', 'route'].includes(name)) {
          await ev(() => {
            wx.pageScrollTo({ scrollTop: 650, duration: 0 });
            setTimeout(() => wx.createSelectorQuery().selectViewport().scrollOffset().exec(result => {
              const info = wx.getSystemInfoSync();
              getApp().__designScroll = { top: result[0].scrollTop, viewportHeight: info.windowHeight };
            }), 120);
            return true;
          });
          await pause(250);
          const scroll = await ev(() => getApp().__designScroll);
          if (!scroll || scroll.top > 0) report.errors.push({ current, unexpectedPageScroll: scroll });
          if (!report.mainScreens) report.mainScreens = [];
          report.mainScreens.push({ name: current, scroll });
        }
        if (!capture) { report.pages.push({ name: current, missingLabels: missing }); console.log(current + ': labels checked'); continue; }
        await shot(current);
        if (['profile', 'mine', 'route-detail', 'journal'].includes(name)) {
          await ev(() => { wx.pageScrollTo({ scrollTop: 650, duration: 0 }); return true; }); await pause(250);
          await shot(current + '-lower');
        }
        if (name === 'mine') {
          await ev(selector => { wx.pageScrollTo({ selector, duration: 0 }); return true; }, '#farm-card');
          await pause(400); await shot(current + '-illustration');
        }
        if (name === 'seller') {
          await ev(() => { getCurrentPages().slice(-1)[0].chooseSection({ currentTarget: { dataset: { section: 'ai' } } }); return true; });
          await pause(600); await shot(current + '-ai');
        }
        if (name === 'place-finder') {
          await ev(() => { getCurrentPages().slice(-1)[0].toggleOption({ currentTarget: { dataset: { qid: 'fruits', oid: '青梅' } } }); return true; });
          await pause(300); await shot(current + '-selected');
        }
      }
    }
  } finally {
    try {
      if (backedUp) {
        await nav('/pages/mine/mine');
        await ev(backupKey => {
          const backup = wx.getStorageSync(backupKey);
          if (!backup) return false;
          const state = wx.getStorageSync('guayouji.demo.v1');
          state.settings.language = backup.language === 'en' ? 'zh' : 'en';
          wx.setStorageSync('guayouji.demo.v1', state);
          getCurrentPages().slice(-1)[0].toggleAppLanguage(); return true;
        }, backupKey);
        report.restored = await ev(backupKey => {
          const backup = wx.getStorageSync(backupKey);
          if (!backup) return false;
          const unchanged = JSON.stringify(wx.getStorageSync('guayouji.prototype.v1')) === backup.personal;
          if (backup.demoPresent) wx.setStorageSync('guayouji.demo.v1', backup.demo); else wx.removeStorageSync('guayouji.demo.v1');
          if (backup.modePresent) wx.setStorageSync('guayouji.active-mode.v1', backup.mode); else wx.removeStorageSync('guayouji.active-mode.v1');
          (backup.extras || []).forEach(item => { if (item.present) wx.setStorageSync(item.key, item.value); else wx.removeStorageSync(item.key); });
          wx.removeStorageSync(backupKey); delete getApp().__designGeometry;
          return unchanged;
        }, backupKey);
        await nav('/pages/index/index');
      }
    } finally {
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(output, reportName), JSON.stringify(report, null, 2) + '\n');
      mp.disconnect();
    }
  }
  if (!report.restored || report.errors.length) throw new Error('Audit needs review: restore=' + report.restored + ', errors=' + report.errors.length);
  console.log(report.pages.length + (capture ? ' screenshots' : ' page checks') + '; personal state unchanged and original demo/mode restored.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
