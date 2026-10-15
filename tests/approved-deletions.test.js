'use strict';
// 2026-10 两处「已批准删除」的回归守卫（用户拍板）：
//   任务 C：行程页票卡展开区只留「导航出发」「去过了·撕票盖章」两个动作；
//   任务 D：「我的」页的旅客体验案例入口整块删除（演示账户共用功能不许跟着删）。
// 纯展示层守卫：只读 wxml / 词典 / store 的导出面，不碰任何报名·票据数据逻辑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../miniprogram/lib/i18n');
const store = require('../miniprogram/lib/store');

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const ROUTE_WXML = 'miniprogram/pages/route/route.wxml';
const MINE_WXML = 'miniprogram/pages/mine/mine.wxml';

test('行程票卡展开区只剩导航出发与撕票盖章，三段展示与词典键的处置各自到位', () => {
  const wxml = read(ROUTE_WXML);
  // 三段的标题绑定与中文标题都不许再出现（注释里也不许，避免改成"隐藏但留着"）
  assert.doesNotMatch(wxml, /rt_find_who|rt_where_is|rt_my_note/, '三段展示的标题绑定必须已移除');
  assert.doesNotMatch(wxml, /到了找谁|在哪儿|我的一行备注/, '三段的中文标题不得再出现在 wxml');
  // 三段各自的零件：备注输入框 / 复制联系方式 / 位置块
  assert.doesNotMatch(wxml, /bindinput="updateNote"/, '「我的一行备注」输入框必须已移除');
  assert.doesNotMatch(wxml, /bindtap="copyContact"/, '「到了找谁」里的复制联系方式必须已移除');
  assert.doesNotMatch(wxml, /class="tk-block|class="tk-place|class="ticket-input"/, '联系/位置/备注块的类名必须已移除');
  // 两个按钮必须还在
  assert.match(wxml, /bindtap="navigateTicket"/, '导航出发留着');
  assert.match(wxml, /bindtap="stampTicket"/, '去过了·撕票盖章留着');
  // 四段顺序（下一张票 → 待用 → ＋排票 → 存根）不受影响
  const order = ['rt_next_ticket', 'rt_pending_tickets', 'rt_add_ticket', 'rt_stubs'].map(k => wxml.indexOf('{{L.' + k + '}}'));
  assert.ok(order.every(v => v > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), '四段顺序不变');
  // 按用户要求：三个标题的词典键先留着（不删键）
  ['rt_find_who', 'rt_where_is', 'rt_my_note'].forEach(key => assert.ok(i18n.dict[key], '词典键必须保留：' + key));
  // 演示横幅挂载点照旧
  assert.match(wxml, /<demo-notice id="demo-mode-notice"/, '页面保留 demo-notice');
});

test('「我的」不再有旅客体验案例入口，演示账户的共用能力一个都没少', () => {
  const wxml = read(MINE_WXML);
  assert.doesNotMatch(wxml, /demo_entry|enter-demo|demo-entry/, '入口的绑定 / 按钮 id / 类名引用必须已移除');
  assert.doesNotMatch(wxml, /看看一位旅客如何使用/, '入口文案必须已移除');
  assert.doesNotMatch(read('miniprogram/pages/mine/mine.js'), /demo_entry_/, '页面 labels() 不再取入口专属词条');
  // 入口专属的三个词条已删（它们没有别处引用）
  ['demo_entry_title', 'demo_entry_sub', 'demo_entry_btn'].forEach(key => assert.equal(i18n.dict[key], undefined, '专属词条应已删除：' + key));
  // 演示账户是共用功能：面板、横幅、store 层分区能力必须原样留着
  assert.match(wxml, /id="demo-summary"/, '演示账户面板（退出 / 重置）是共用功能，必须留着');
  assert.match(wxml, /<demo-notice id="demo-mode-notice"/, '演示横幅挂载点不许动');
  ['enterDemo', 'exitDemo', 'resetDemo', 'getDemoSummary', 'isDemoMode'].forEach(name =>
    assert.equal(typeof store[name], 'function', 'store 层演示账户能力必须留着：' + name));
  // 字体档位逻辑不受影响
  assert.match(read('miniprogram/pages/mine/mine.js'), /saveFontScale/, '字体档位保存逻辑不动');
});
