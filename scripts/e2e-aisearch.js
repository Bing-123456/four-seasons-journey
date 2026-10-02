'use strict';

// 果灵 AI 搜索 · 微信开发者工具端到端测试。
// 说明：本机 devtools(1.06.2504101) 的 Page.* 自动化通道（element/data 直查）不响应，
// 但 App.* 通道（evaluate/callWxMethod/screenshot）正常。因此本脚本用
// miniProgram.evaluate 在真实小程序运行时内驱动真实页面方法与数据：
// 真实页面实例、真实本机存储、真实线上 /api/chat(DeepSeek)、真实降级链路；
// WXML 事件绑定（tap→handler）由 413 项单元测试中的 markup 断言覆盖。
// 用法：先 cli auto --project . --auto-port <port>，再 E2E_PORT=<port> node scripts/e2e-aisearch.js

const path = require('node:path');
const fs = require('node:fs');
const automator = require('miniprogram-automator');

const PROJECT = path.resolve(__dirname, '..');
const OUT = path.join(PROJECT, 'e2e-artifacts');
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 9421;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? '✔' : '✖') + ' ' + name + (detail ? '  —— ' + detail : ''));
}
async function until(poll, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = await poll(); if (value) return value; } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error('等待超时（' + label + '）');
}
// reLaunch 到 tab 页时回调常不返回（automation 怪癖）：触发后轮询 currentPage。
async function goto(mini, route, label) {
  mini.reLaunch('/' + route).catch(() => {});
  await until(async () => {
    const current = await mini.currentPage();
    return current && current.path === route;
  }, 25000, label || route);
  return mini.currentPage();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('连接自动化端口', PORT, '…');
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const shot = async name => { try { await mini.screenshot({ path: path.join(OUT, name + '.png') }); } catch (e) { console.log('截图失败', name, e.message); } };
  // IDE 侧拒收 new Function 产物（function anonymous 头）并挂 Page.* 通道：
  // 只能传「干净箭头函数源码」——用 eval 构造使 toString() 恰为箭头源码，常量内联、零参数。
  const arrow = src => eval('(' + src + ')');
  const snap = async route => {
    // 运行时被 clearStorageSync 重启后 JSON.parse 损坏：用 spread 复制（stringify 传输正常）。
    const src = '() => { const page = getCurrentPages().find(item => item.route === ' + JSON.stringify(route) + '); if (!page) return null; return { data: { ...page.data } }; }';
    const result = await mini.evaluate(arrow(src));
    return result ? { route, data: result.data } : null;
  };
  const call = async (route, method, ...args) => {
    const src = '() => { const page = getCurrentPages().find(item => item.route === ' + JSON.stringify(route) + '); if (!page) return "NO_PAGE"; page[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + '); return "OK"; }';
    return mini.evaluate(arrow(src));
  };

  // 干净开局：清本机存储，回首页。
  console.log('· 清存储并回首页…');
  await mini.callWxMethod('clearStorageSync');
  await goto(mini, 'pages/index/index', '首页加载');

  // ① 首页入口：问果灵 · AI 搜索（真实页面数据 + 真实跳转处理器）
  const home = await snap('pages/index/index');
  record('首页入口文案', home && home.data.L && home.data.L.search_local_web === '问果灵 · AI 搜索', home && home.data.L && home.data.L.search_local_web);
  record('首启身份弹窗在', home && home.data.roleSelectVisible === true, '首启流程真实呈现');
  await call('pages/index/index', 'chooseRole', { currentTarget: { dataset: { role: 'tourist' } } });
  await new Promise(r => setTimeout(r, 800));
  // 渲染未完成时 navigateTo 可能撞导航锁：循环重试直到跳转成功。
  await until(async () => {
    await call('pages/index/index', 'openSearch');
    await new Promise(r => setTimeout(r, 1600));
    return (await mini.currentPage()).path === 'pages/search/search';
  }, 20000, 'openSearch 跳转');
  await shot('01-首页与搜索入口');

  // ② 搜索页空态：欢迎语 + 无历史
  await until(async () => {
    const s = await snap('pages/search/search');
    return s && Array.isArray(s.data.messages) && s.data.messages.length === 0 && s.data.L.chat_welcome;
  }, 15000, '搜索页空态');
  record('果灵欢迎语（AI 问答定位）', true);
  record('初始无历史气泡', true);

  // ③ 真实 AI 问答（线上 /api/chat，DeepSeek）
  await call('pages/search/search', 'setData', { keyword: '如何挑选西瓜' });
  await call('pages/search/search', 'doSearch');
  let chat = null;
  await until(async () => {
    chat = await snap('pages/search/search');
    const messages = chat && chat.data.messages;
    return messages && messages.length >= 2 && messages[1].role === 'elf' && !chat.data.pending;
  }, 90000, '线上 AI 回答');
  const elf = chat.data.messages[1];
  record('AI 回答依据资料', elf.text.length > 10 && !elf.local, '「' + elf.text.slice(0, 42).replace(/\n/g, ' ') + '…」');
  record('回答标注依据', elf.evidence.length >= 1, elf.evidence.join('、'));
  record('回答附跳转卡片', elf.chips.length >= 1 && elf.chips[0].name === '西瓜', elf.chips.map(c => c.jumpLabel).join('，'));
  record('回答附追问建议', elf.followUps.length >= 1, elf.followUps.join('；'));
  await shot('02-AI问答西瓜');

  // ④ 追问续聊：点追问建议，第二轮带历史
  await call('pages/search/search', 'tapFollowUp', { currentTarget: { dataset: { word: elf.followUps[0] } } });
  await until(async () => {
    chat = await snap('pages/search/search');
    return chat && chat.data.messages.length >= 4 && !chat.data.pending;
  }, 90000, '追问第二轮回答');
  const second = chat.data.messages[3];
  record('多轮追问续聊', chat.data.messages.length === 4 && second.role === 'elf', '第2轮：「' + second.text.slice(0, 30).replace(/\n/g, ' ') + '…」');
  await shot('03-多轮追问');

  // ⑤ 聊天记录本机恢复（重进页面）
  await goto(mini, 'pages/search/search', '重进搜索页');
  const restored = await snap('pages/search/search');
  record('聊天记录本机恢复', restored && restored.data.messages.length === 4 && restored.data.messages[0].text === '如何挑选西瓜', restored && restored.data.messages.length + ' 条气泡');
  await shot('04-历史恢复');

  // ⑥ 清空对话（确认弹窗自动确认）
  await mini.mockWxMethod('showModal', { confirm: true, cancel: false });
  await call('pages/search/search', 'clearChat');
  await until(async () => {
    const s = await snap('pages/search/search');
    return s && s.data.messages.length === 0;
  }, 10000, '清空对话');
  await mini.restoreWxMethod('showModal');
  record('清空对话', true);
  await goto(mini, 'pages/search/search', '清空后重进');
  const afterClear = await snap('pages/search/search');
  record('清空后不再恢复', afterClear && afterClear.data.messages.length === 0);

  // ⑦ 语音按钮降级（0.9.1 未声明插件 → 友好提示改键盘）
  await mini.evaluate(arrow('() => { wx.__toastCalls = []; wx.showToast = options => { wx.__toastCalls.push(options && options.title); }; const page = getCurrentPages().find(item => item.route === "pages/search/search"); page.toggleVoice(); return true; }'));
  await new Promise(r => setTimeout(r, 1500));
  const toasts = await mini.evaluate(() => wx.__toastCalls);
  record('语音按钮友好降级', toasts.some(t => String(t).includes('改用键盘')), JSON.stringify(toasts));

  // ⑧ 四时页：地点与风物已删，底部果灵搜索入口在
  await goto(mini, 'pages/calendar/calendar', '四时页');
  const cal = await snap('pages/calendar/calendar');
  const calKeys = Object.keys(cal.data.L || {});
  record('地点与风物入口已删', !calKeys.includes('nav_places') && !calKeys.includes('cal_browse'), '页面数据不再注入旧入口标签');
  record('四时底部果灵搜索入口', !!cal.data.L.guoling_search_title, cal.data.L.guoling_search_title);
  await shot('05-四时页底部入口');

  // ⑨ 断网兜底：拦截请求 → 本地检索回答 + 离线标注
  await goto(mini, 'pages/search/search', '断网兜底重进');
  await mini.evaluate(arrow('() => { wx.__realRequest = wx.request; wx.request = options => { options.fail && options.fail({ errMsg: "request:fail 模拟断网" }); }; const page = getCurrentPages().find(item => item.route === "pages/search/search"); page.setData({ keyword: "李子和杏子有什么区别" }); page.doSearch(); return true; }'));
  let offline = null;
  await until(async () => {
    offline = await snap('pages/search/search');
    const messages = offline && offline.data.messages;
    return messages && messages.length >= 2 && messages[messages.length - 1].role === 'elf' && !offline.data.pending;
  }, 20000, '离线本地回答');
  const lastElf = offline.data.messages[offline.data.messages.length - 1];
  record('断网本地兜底回答', lastElf.text.includes('李子') && lastElf.text.includes('【'), '「' + lastElf.text.slice(0, 30).replace(/\n/g, ' ') + '…」');
  record('离线诚实标注', lastElf.local === true, '气泡带「离线检索」标注');
  await shot('06-断网兜底');
  await mini.evaluate(arrow('() => { wx.request = wx.__realRequest; return true; }'));

  console.log('\n===== E2E 结果：' + results.filter(r => r.ok).length + '/' + results.length + ' 通过 =====');
  const failed = results.filter(r => !r.ok);
  if (failed.length) { console.log('失败项：', failed.map(f => f.name).join('、')); process.exitCode = 1; }
  await mini.disconnect();
  process.exit(process.exitCode || 0);
})().catch(error => {
  console.error('E2E 异常中断：', error);
  process.exit(1);
});
