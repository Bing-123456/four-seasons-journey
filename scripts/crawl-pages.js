'use strict';

// 全页面 × 双语言巡检：逐页导航（含带参页面），收集页面加载状态与控制台错误。
// 语言经「我的」正规入口切换；结束后恢复中文。产出 test-results/current-native/crawl-results.json。
const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 带参页面的参数（无参导航会落入 invalid 兜底，也算合法渲染，但优先带参验证主路径）
const URLS = [
  '/pages/index/index',
  '/pages/calendar/calendar',
  '/pages/learn/learn',
  '/pages/route/route',
  '/pages/mine/mine',
  '/pages/favorites/favorites',
  '/pages/favorites/favorites?type=places',
  '/pages/profile/profile',
  '/pages/culture/culture?id=summer-culture',
  '/pages/heritage/index?id=grain-mill',
  '/pages/workshop/index',
  '/pages/companion/companion',
  '/pages/seller/index',
  '/pages/places/places',
  '/pages/graph/graph?season=autumn',
  '/pages/search/search',
  '/pages/craft-lesson/craft-lesson?fruit=' + encodeURIComponent('spring-plum'),
  '/pages/account/account',
  '/pages/fruit-note/fruit-note?fruit=' + encodeURIComponent('spring-plum') + '&cat=folk',
  '/pages/place-finder/place-finder',
  '/packageWorld/pages/index/index'
];

async function run() {
  const output = path.resolve(__dirname, '../test-results/current-native');
  fs.mkdirSync(output, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' });
  const errors = [];
  mp.on('console', msg => { if (msg.type === 'error') errors.push({ lang: current.lang, args: (msg.args || []).join(' ').slice(0, 200) }); });
  mp.on('exception', err => errors.push({ lang: current.lang, exception: (err && err.message || '').slice(0, 200) }));
  const ev = (fn, ...args) => mp.evaluate(fn, ...args);
  const current = { lang: 'zh' };
  async function nav(url) {
    await ev(url => new Promise((resolve, reject) => { wx.reLaunch({ url, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) }); }), url);
    await sleep(950);
    return ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      if (!p) return { ok: false, reason: 'no page' };
      const data = p.data && typeof p.data === 'object' ? Object.keys(p.data) : [];
      return { ok: true, route: p.route, dataKeys: data.length };
    }, url);
  }
  // 空白页检测：统一底色的整页截图体积极小（实测空白 <8KB，正常页 >35KB）。
  async function shotAndCheckBlank(lang, slug) {
    const file = path.join(output, 'crawl-' + lang + '-' + slug + '.png');
    await mp.screenshot({ path: file });
    const size = fs.statSync(file).size;
    return { file, size, blank: size < 20000 };
  }
  async function setLanguage(lang) {
    await nav('/pages/mine/mine');
    const now = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return p.data && p.data.appLanguage || null; });
    if (now !== lang) { await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.toggleAppLanguage(); return true; }); await sleep(500); }
  }
  const results = [];
  for (const lang of ['zh', 'en']) {
    await setLanguage(lang);
    current.lang = lang;
    for (const url of URLS) {
      const before = errors.length;
      let info;
      try { info = await nav(url); } catch (e) { info = { ok: false, reason: e.message }; }
      let blankInfo = null;
      if (info.ok) {
        try { blankInfo = await shotAndCheckBlank(lang, url.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-')); } catch (e) { blankInfo = { blank: false, size: -1, skip: e.message }; }
      }
      const newErrors = errors.slice(before);
      const blankHit = blankInfo && blankInfo.blank;
      results.push({ lang, url, ...info, blank: blankInfo, errors: newErrors });
      const flag = info.ok && !newErrors.length && !blankHit ? 'OK ' : 'BAD';
      console.log(flag, lang, url, info.ok ? '' : info.reason || '', blankHit ? 'POSSIBLE-BLANK ' + blankInfo.size + 'B' : '', newErrors.length ? 'errors:' + newErrors.length : '');
    }
  }
  // 恢复中文
  await setLanguage('zh');
  const summary = { pages: results.length, bad: results.filter(r => !r.ok || r.errors.length), consoleErrors: errors };
  fs.writeFileSync(path.join(output, 'crawl-results.json'), JSON.stringify({ results, summary }, null, 2) + '\n');
  console.log('CRAWL', summary.bad.length === 0 ? 'ALL-CLEAN' : 'ISSUES', results.length, 'page views');
  await mp.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1); });
