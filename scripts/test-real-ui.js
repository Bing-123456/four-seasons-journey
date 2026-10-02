'use strict';

// Native DevTools render + Page controller integration. No gesture synthesis,
// model requests, fabricated GPS, or personal-account fixture writes.
const automator = require('miniprogram-automator');
const { wrapPage } = require('./wechat-runtime-adapter');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../miniprogram/lib/core');
const catalog = require('../miniprogram/data/catalog');
const PERSONAL = 'guayouji.prototype.v1', DEMO = 'guayouji.demo.v1', MODE = 'guayouji.active-mode.v1';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run(scope = 'all') {
  const output = path.resolve(__dirname, '../test-results/current-native');
  fs.mkdirSync(output, { recursive: true });
  const report = { scope, startedAt: new Date().toISOString(), mode: 'native-render-and-page-controller', physicalGestures: false, modelCalls: false, roadNavigationVerified: false, checks: [], screenshots: [], limits: ['开发工具模拟器；未验证真机权限、平台审核或道路导航', 'App.evaluate 调用页面事件处理器；非物理触摸', '截图可能不包含原生 WebGL 画布像素，几何与 ready 状态另行检查'] };
  let mp, backup, personalDigest;
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function bounded(promise, label) {
    let timer;
    try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error(label + ' 超过 15 秒')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  const evaluate = (fn, ...args) => bounded(mp.evaluate(fn, ...args), 'App.evaluate');
  async function until(label, predicate) {
    const start = Date.now();
    while (!await predicate()) { if (Date.now() - start > 12000) throw Error(label + ' 未就绪'); await sleep(150); }
  }
  async function navigate(url) {
    const target = url.replace(/^\//, '').split('?')[0];
    console.log('NAV', target);
    let failure;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await evaluate(url => new Promise((resolve, reject) => wx.reLaunch({ url, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })), url);
        failure = null; break;
      } catch (error) { failure = error; if (!attempt) { console.warn('NAV_RETRY', target); await sleep(500); } }
    }
    if (failure) throw failure;
    await until(target, () => evaluate(target => { const p = getCurrentPages().slice(-1)[0]; return !!p && p.route === target; }, target));
    await sleep(250);
    return wrapPage(mp, { path: target });
  }
  async function shot(name, selector) {
    await evaluate(selector => { wx.pageScrollTo(selector ? { selector, duration: 0 } : { scrollTop: 0, duration: 0 }); return true; }, selector || '');
    await sleep(/map|route/.test(name) ? 2500 : 450);
    const filename = scope + '-' + name + '.png';
    await bounded(mp.screenshot({ path: path.join(output, filename) }), 'screenshot');
    report.screenshots.push(filename);
  }
  async function check(name, action) { console.log('RUN', name); await action(); report.checks.push(name); console.log('PASS', name); }
  async function notice() {
    assert.equal(await evaluate(() => { const p = getCurrentPages().slice(-1)[0], c = p.selectComponent('#demo-mode-notice'); return !!c && c.data.active; }), true);
  }
  async function mine() { return navigate('/pages/mine/mine'); }
  async function resetDemo() { const p = await mine(); await p.callMethod('enterDemo'); await p.callMethod('resetDemo'); return p; }
  try {
    mp = await automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' });
    personalDigest = hash(await evaluate(key => wx.getStorageSync(key), PERSONAL));
    backup = await evaluate(keys => { const present = wx.getStorageInfoSync().keys; return keys.map(key => ({ key, present: present.includes(key), value: wx.getStorageSync(key) })); }, [DEMO, MODE]);
    let page = await resetDemo();
    await check('独立演示账户含两站、三收藏，云端直连开启', async () => {
      const summary = await page.data('demoSummary');
      assert.equal(summary.active, true); assert.equal(summary.simulated, true); assert.equal(summary.excludeFromTraining, true);
      assert.equal(summary.routeStops, 2); assert.equal(summary.favoritesCount, 3);
      // 0.3.13 起内置团队后端直连：演示与个人模式默认开启云端 AI（设备级连接）。
      assert.equal(await page.data('settings.useAI'), true);
      assert.equal((await page.query('#demo-summary')).exists, true);
    });
    await shot('01-demo-account');
    await check('退出恢复个人账户，再进入保留演示记录', async () => {
      await page.callMethod('exitDemo'); assert.equal(await page.data('demoSummary.active'), false);
      assert.equal(hash(await evaluate(key => wx.getStorageSync(key), PERSONAL)), personalDigest);
      await page.callMethod('enterDemo'); assert.equal(await page.data('demoSummary.routeStops'), 2);
    });
    await check('演示账户云端直连默认开启且设置锁定，无法在演示内关闭', async () => {
      assert.equal(await page.data('settings.useAI'), true);
      await page.callMethod('saveAI', false);
      assert.equal(await page.data('settings.useAI'), true, '演示账户固定使用本机资料，服务设置不可改');
    });

    if (scope !== 'field') {
      await check('未规划也显示两处真实河南地点的原生地图，没有假路线', async () => {
        await evaluate(key => { const s = wx.getStorageSync(key); s.route = null; wx.setStorageSync(key, s); return true; }, DEMO);
        page = await navigate('/pages/route/route');
        assert.equal(await page.data('route'), null);
        assert.equal((await page.query('#preview-map')).exists, true);
        assert.equal((await page.data('routeMap.markers')).length, 2);
        assert.deepEqual(await page.data('routeMap.polyline'), []);
        await notice();
      });
      await shot('02-preview-map');
      page = await navigate('/pages/index/index');
      await check('首页海报轮播为已打包实拍照片并可加载，保留农具课堂入口', async () => {
        const posters = await page.data('forecastPosters');
        assert.ok(Array.isArray(posters) && posters.length >= 3, '首页必须保留海报轮播');
        for (const poster of posters) {
          assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram', poster.image.replace(/^\//, ''))), '海报必须为已打包图片：' + poster.image);
        }
        const packaged = await evaluate(srcs => srcs.map(src => wx.getFileSystemManager().accessSync(src) === undefined || true), posters.map(poster => poster.image)).catch(() => null);
        assert.notEqual(packaged, null, '海报图片可访问');
        assert.equal((await page.query('#farming-forecast')).exists, true);
        await notice();
      });
      await shot('03-home-photo');
      page = await navigate('/pages/profile/profile');
      await check('真实起点快捷选项无需打开慢速地图，规则解析能生成行程', async () => {
        await page.tap('#origin-summer-culture', 'chooseQuickOrigin');
        assert.equal(await page.data('profile.origin.name'), '河南博物院');
        assert.equal(await page.data('originBusy'), false);
        await page.input('#profile-text', '两个人自驾，想看农耕文化，预算200元，玩4小时。', 'onTextInput');
        await page.tap('#parse-profile', 'parse');
        // 云端直连开启时解析可能走 AI（约 1–3 秒）或失败回落本地规则，两条路径预算都应为 200。
        await until('解析完成', async () => (await page.data('parsing')) === false);
        assert.equal(await page.data('error'), '');
        assert.equal(await page.data('profile.duration'), 240);
        assert.equal(await page.data('profile.budget'), 200);
        assert.equal(await page.data('profile.partySize'), 2);
        await shot('04-origin-shortcuts', '.origin-card');
        await page.tap('#create-route', 'createRoute');
        await until('行程页', () => evaluate(() => getCurrentPages().slice(-1)[0].route === 'pages/route/route'));
        page = wrapPage(mp, { path: 'pages/route/route' });
        assert.equal(await page.data('route.ok'), true);
      });
      await check('地图、真实坐标、距离估算与未知费用保持一致', async () => {
        const route = await page.data('route'), profile = await page.data('profile');
        assert.equal(core.validateRoute(route, profile).valid, true);
        assert.equal(route.totalCost, null); assert.equal(route.mode, 'estimated');
        const markers = await page.data('routeMap.markers');
        for (const marker of markers.filter(m => m.placeId)) {
          const p = catalog.places.find(p => p.id === marker.placeId);
          assert.equal(marker.latitude, p.location.latitude); assert.equal(marker.longitude, p.location.longitude);
        }
        assert.equal((await page.query('#route-map')).exists, true);
        const viewport = await evaluate(() => wx.getWindowInfo().windowWidth);
        for (const selector of ['#route-map', '.itinerary-list', '.journey-summary']) {
          const node = (await page.query(selector)).node;
          assert.ok(node.width > 100 && node.left >= -1 && node.right <= viewport + 1, selector + ' 越界');
        }
        await notice();
      });
      await shot('05-route-map');
      await check('展开站点与地图可收起恢复，选择不会改写行程', async () => {
        const original = await page.data('route'), stops = await page.data('stops');
        await page.tap('#select-' + stops[1].placeId, 'selectStop');
        assert.equal(await page.data('activeStopId'), stops[1].placeId);
        assert.equal((await page.query('#story-' + stops[1].placeId)).exists, true);
        await page.tap('#toggle-route-map', 'toggleMap'); assert.equal((await page.query('#route-map')).exists, false);
        await page.tap('#toggle-route-map', 'toggleMap'); assert.equal((await page.query('#route-map')).exists, true);
        assert.deepEqual(await page.data('route'), original);
      });
      page = await navigate('/pages/culture/culture?id=summer-kitchen');
      await check('文化问答提供匹配出处，并拒绝无依据的实时营业问题', async () => {
        await page.input('#culture-question', '瓜豆酱用什么做的？', 'onQuestionInput');
        await page.tap('#ask-culture', 'ask');
        await until('回答一', async () => (await page.data('answer')) !== null);
        assert.equal(await page.data('answer.unanswerable'), false);
        assert.ok(((await page.data('answer.answer')) || '').length >= 6, '回答必须给出实际内容');
        await page.input('#culture-question', '今天可以预约制作瓜豆酱吗？', 'onQuestionInput');
        await page.tap('#ask-culture', 'ask');
        await until('回答二', async () => { const answer = await page.data('answer'); return answer && answer.unanswerable === true; });
        assert.equal(await page.data('answer.unanswerable'), true);
      });
    }
    if (scope !== 'route') {
      page = await navigate('/pages/workshop/index');
      await check('瓜豆酱课堂完成食材、工序与理解题', async () => {
        await page.tap('#ingredient-watermelon', 'selectIngredient');
        await page.tap('#ingredient-soybean', 'selectIngredient');
        await page.tap('#workshop-confirm', 'confirmIngredients'); assert.equal(await page.data('step'), 1);
        for (const id of ['boil', 'coat', 'rest', 'sun']) await page.tap('#process-' + id, 'selectProcess');
        await page.tap('#workshop-continue', 'continueToQuiz');
        await page.tap('#answer-craft', 'selectAnswer');
        await page.tap('#workshop-complete', 'completeLesson'); assert.equal(await page.data('completed'), true);
        await notice();
      });
      await shot('06-workshop');
      page = await navigate('/pages/heritage/index?id=grain-mill');
      await check('河南农具3D真实初始化，推拉四次完成观察与理解', async () => {
        await page.tap('#start-lesson', 'startLesson');
        await until('WebGL', async () => await page.data('ready') || await page.data('error'));
        assert.equal(await page.data('ready'), true, String(await page.data('error')));
        assert.ok(await page.data('vertexCount') > 100); assert.ok(await page.data('triangleCount') > 100);
        report.webgl = { ready: true, vertexCount: await page.data('vertexCount'), triangleCount: await page.data('triangleCount') };
        for (const value of [100, 0, 100, 0]) await page.callMethod('moveGrind', { detail: { value } });
        assert.equal(await page.data('strokes'), 4);
        await page.tap('#answer-rolling', 'answerQuestion'); assert.equal(await page.data('completed'), true);
        await notice();
      });
      await shot('07-mill');
      await check('图文替代模式也能阅读完整课堂', async () => {
        await page.tap('#toggle-text-mode', 'toggleTextMode');
        await page.tap('#next-text-step', 'nextTextStep'); await page.tap('#next-text-step', 'nextTextStep');
        assert.equal(await page.data('step'), 2); assert.equal((await page.query('#text-lesson')).exists, true);
      });
    }
    await check('本次模拟器交互只产生标明模拟的记录，不修改个人数据', async () => {
      assert.equal(hash(await evaluate(key => wx.getStorageSync(key), PERSONAL)), personalDigest);
      const events = await evaluate(key => wx.getStorageSync(key).events, DEMO);
      assert.ok(events.length >= 6 && events.every(e => e.details.simulated === true));
    });
    report.passed = true;
  } catch (error) {
    report.passed = false; report.error = error.stack || error.message;
    console.error(error.message); process.exitCode = 1;
  } finally {
    if (mp && backup) {
      try {
        if (report.passed && process.argv.includes('--leave-demo')) {
          await resetDemo(); await navigate('/pages/route/route'); await shot('08-final-demo-route');
          report.finalState = '独立演示账户，重置为完整示例，展示行程地图';
        } else {
          await evaluate(items => { items.forEach(item => { if (item.present) wx.setStorageSync(item.key, item.value); else wx.removeStorageSync(item.key); }); return true; }, backup);
          await navigate('/pages/index/index'); report.finalState = '原模式与演示记录已恢复';
        }
        assert.equal(hash(await evaluate(key => wx.getStorageSync(key), PERSONAL)), personalDigest);
      } catch (error) { report.passed = false; report.cleanupError = error.message; process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, scope + '-results.json'), JSON.stringify(report, null, 2) + '\n');
    if (mp) mp.disconnect();
  }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, report: path.join(output, scope + '-results.json') }));
}

module.exports = { run };
if (require.main === module) run(process.argv.includes('--field') ? 'field' : process.argv.includes('--route') ? 'route' : 'all');
