'use strict';
// 诊断探针：连接 automation，dump 首页渲染 wxml 与数据键。
const path = require('node:path');
const automator = require('miniprogram-automator');
const PORT = Number(process.env.E2E_PORT || 9428);

(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  console.log('connected');
  mini.reLaunch('/pages/index/index').catch(() => {});
  await new Promise(r => setTimeout(r, 6000));
  const page = await mini.currentPage();
  console.log('currentPage:', page.path);
  const data = await page.data();
  console.log('data keys:', Object.keys(data).join(','));
  console.log('welcomeVisible:', data.welcomeVisible, 'roleSelectVisible:', data.roleSelectVisible);
  console.log('L.search_local_web:', data.L && data.L.search_local_web);
  const views = await page.$$('view');
  console.log('view count:', views.length);
  const homeSearch = await page.$('.home-search');
  console.log('.home-search:', homeSearch ? 'FOUND' : 'null');
  try {
    const wxml = await page.wxml();
    console.log('wxml head:', String(wxml).slice(0, 600).replace(/\s+/g, ' '));
  } catch (e) { console.log('wxml() failed:', e.message); }
  await mini.disconnect();
  process.exit(0);
})().catch(e => { console.error('probe error:', e.message); process.exit(1); });
