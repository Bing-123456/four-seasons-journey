'use strict';

const automator = require('miniprogram-automator');
const { wrapPage } = require('./wechat-runtime-adapter');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../test-results/calendar-images');
const captureScreenshots = !process.argv.includes('--no-screenshot');
fs.mkdirSync(output, { recursive: true });

(async function () {
  let mp;
  const result = { checkedAt: new Date().toISOString(), mode: 'native-render-and-page-controller', physicalGestures: false, screenshotCapture: captureScreenshots ? 'automator' : 'disabled-explicitly', checks: [] };
  try {
    mp = await automator.connect({ wsEndpoint: process.env.WECHAT_WS_ENDPOINT || 'ws://127.0.0.1:9420' });
    let timer;
    try {
      await Promise.race([
        mp.evaluate(() => new Promise((resolve, reject) => wx.reLaunch({ url: '/pages/calendar/calendar', success: () => resolve(true), fail: error => reject(Error(error.errMsg)) }))),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Calendar navigation timeout')), 15000); })
      ]);
    } finally { clearTimeout(timer); }
    await pause(400);
    const page = wrapPage(mp, { path: 'pages/calendar/calendar' });
    for (const season of ['summer', 'autumn']) {
      await page.tap('#season-' + season, 'choose');
      const deadline = Date.now() + 10000;
      while (await page.data('heroImageStatus') !== 'loaded') {
        if (Date.now() > deadline || await page.data('heroImageStatus') === 'failed') throw Error(season + ' photo did not load');
        await pause(100);
      }
      const image = await page.data('heroImage');
      assert.equal(await page.data('season'), season);
      assert.equal(image.src, season === 'summer' ? '/assets/zhongmu-watermelon-real.jpg' : '/assets/xixia-kiwifruit-real.jpg');
      const node = (await page.query('#calendar-season-image')).node;
      assert.ok(node.width > 300 && node.height > 200);
      assert.ok(Math.abs(node.width / node.height - 4 / 3) < 0.02, 'The original photo and its watermark must not be cropped');
      assert.equal((await page.query('#calendar-photo-source')).exists, true);
      await mp.evaluate(() => { wx.pageScrollTo({ selector: '.calendar-tabs', offsetTop: -12, duration: 0 }); return true; });
      await pause(350);
      const filename = season + '.png';
      if (captureScreenshots) await mp.screenshot({ path: path.join(output, filename) });
      result.checks.push({ season, status: 'loaded', src: image.src, caption: image.caption, width: node.width, height: node.height, screenshot: captureScreenshots ? filename : null });
      console.log('PASS', season, image.caption);
    }
    result.passed = true;
  } catch (error) { result.passed = false; result.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { if (mp) mp.disconnect(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); }
}());
