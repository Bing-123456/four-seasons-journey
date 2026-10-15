'use strict';
// 前端遗留清理的回归守卫（用户 2026-10 要求一轮清完，清完才提交代码包）：
//   A. 活动方案结果页的死残留：plan_copy_* 孤儿键（词典 + LABEL_KEYS）、.cta-note 死规则都已清；
//      宣传文字块确实不在，「保存并发布」（plan_cta）那颗按钮仍在。
//   B. 行程页票卡展开区的过时注释已改成现状（只剩「导航出发」+「撕票盖章」两个动作），
//      那三段的中文标题不再有任何残留；note / 联系方式的读写代码一行没动。
//   C. 「我的」页的页面方法 enterDemo 已删；store 层共用能力、#demo-summary 面板、
//      演示提示条都不动；4 个脚本改走共用的 changeDemo / store 层调用。
// 纯展示层 / 文本守卫：只读源码与词典，不碰报名、票据、演示账户的任何数据逻辑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../miniprogram/lib/i18n');

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const PLAN_JS = 'miniprogram/pages/seller/plan/plan.js';
const PLAN_WXSS = 'miniprogram/pages/seller/plan/plan.wxss';
const PLAN_WXML = 'miniprogram/pages/seller/plan/plan.wxml';
const ROUTE_JS = 'miniprogram/pages/route/route.js';
const MINE_JS = 'miniprogram/pages/mine/mine.js';
const MINE_WXML = 'miniprogram/pages/mine/mine.wxml';
const CAPTURE_SCRIPTS = ['scripts/capture-fix-927.js', 'scripts/capture-fix-927b.js', 'scripts/capture-polish.js'];

test('活动方案结果页：宣传文字块的死残留清干净，「保存并发布」那颗按钮还在', () => {
  const planJs = read(PLAN_JS), planWxss = read(PLAN_WXSS), planWxml = read(PLAN_WXML);
  // 宣传文字块的三处残留：模板 / 样式 / 页面 labels 列表
  assert.doesNotMatch(planWxml, /plan_copy|cta-note|宣传文字/, '模板里不该再有宣传文字块');
  assert.doesNotMatch(planWxss, /cta-note/, '.cta-note 是死规则（wxml 里没有任何元素用它）');
  assert.doesNotMatch(planJs, /plan_copy/, 'LABEL_KEYS 里的三个死键必须已移除');
  // 清理不该顺手伤到方案本身：来源行、缺项清单、四块方案信息都还在
  for (const key of ["'plan_nav'", "'plan_badge_ai'", "'plan_capacity'", "'plan_budget'", "'plan_alt'"]) {
    assert.ok(planJs.includes(key), 'LABEL_KEYS 仍要取 ' + key);
  }
  // 「保存并发布」：键、文案、按钮绑定三样都得在
  assert.ok(planJs.includes("'plan_cta'"), 'LABEL_KEYS 仍要取 plan_cta');
  assert.deepEqual(i18n.dict.plan_cta, ['保存并发布', 'Save and publish']);
  assert.match(planWxml, /<button[^>]*bindtap="saveAndPublish"[^>]*>\{\{L\.plan_cta\}\}<\/button>/, '「保存并发布」按钮原样保留');
  assert.match(planJs, /publishFlow\.saveTown/, '发布链路不动');
});

test('词典里 5 个 plan_copy_* 与同一段的 plan_copied 孤儿键已删，plan_cta_note 按规则保留', () => {
  // 全仓库 grep（miniprogram/、tests/、scripts/）确认：这 6 个键除词典外没有任何引用。
  for (const key of ['plan_copy_title', 'plan_copy_hint', 'plan_copy_when', 'plan_copy_people', 'plan_copy_note', 'plan_copied']) {
    assert.equal(i18n.dict[key], undefined, '孤儿键应已删除：' + key);
  }
  // plan_cta_note 仍被 tests/seller-plan-publish.test.js 引用 → 按「测试引用的键保留」规则留着。
  assert.ok(i18n.dict.plan_cta_note, 'plan_cta_note 仍被既有用例引用，必须保留');
});

test('行程页：注释只说现状（只剩导航出发与撕票盖章），那三段的中文标题零残留、代码一行没动', () => {
  const routeJs = read(ROUTE_JS);
  assert.doesNotMatch(routeJs, /到了找谁|在哪儿|我的一行备注/, '过时注释里不该再出现那三段的说法');
  assert.match(routeJs, /展开区只剩「导航出发」「去过了 · 撕票盖章」两个动作/, '注释要如实描述现状');
  // 词典键按用户要求留着（approved-deletions.test.js 也守着这一条）
  assert.match(routeJs, /'rt_find_who', 'rt_where_is', 'rt_my_note'/, '三个词典键仍在 LABEL_KEYS 里');
  // 代码没动：note 写入、复制联系方式、导航出发、撕票盖章四个 handler 与存盘调用原样保留
  for (const fragment of ['updateNote: function', 'copyContact: function', 'navigateTicket: function', 'stampTicket: function', 'hit.note = e.detail.value;', 'store.saveTickets(tickets);']) {
    assert.ok(routeJs.includes(fragment), '代码行不许动，必须仍在：' + fragment);
  }
  // 展开区的两个动作照旧（wxml 侧由 approved-deletions.test.js 守着）
  assert.match(read('miniprogram/pages/route/route.wxml'), /bindtap="navigateTicket"/);
  assert.match(read('miniprogram/pages/route/route.wxml'), /bindtap="stampTicket"/);
});

test('「我的」页不再有页面级 enterDemo，4 个脚本改走共用的 changeDemo / store 层，面板照旧', () => {
  const mineJs = read(MINE_JS), mineWxml = read(MINE_WXML);
  assert.doesNotMatch(mineJs, /enterDemo/, '页面方法 enterDemo 必须已删除（含任何字符串残留）');
  assert.doesNotMatch(mineWxml, /enterDemo|enter-demo|demo-entry|demo_entry/, '入口卡片的绑定 / id / 类名一个都不许回来');
  // 共用的演示账户切换器与面板原样留着
  assert.match(mineJs, /changeDemo: function \(action\)/, '离开 / 重置共用的 changeDemo 保留');
  assert.match(mineJs, /store\[action\]\(\)/, 'changeDemo 仍直接调 store 层');
  assert.match(mineWxml, /id="demo-summary"/, '演示账户面板（退出 / 重置）必须留着');
  assert.match(mineWxml, /bindtap="exitDemo"/);
  assert.match(mineWxml, /bindtap="resetDemo"/);
  assert.match(mineWxml, /<demo-notice id="demo-mode-notice"\/>/, '演示横幅挂载点不动');
  // 4 个脚本：不再调页面级方法，改成共用的 changeDemo（内部就是 store 层能力）
  for (const rel of CAPTURE_SCRIPTS) {
    const src = read(rel);
    assert.match(src, /changeDemo\('enterDemo'\)/, rel + ' 应改走共用的 changeDemo');
    assert.doesNotMatch(src, /\[0\]\.enterDemo\(/, rel + ' 不该再在页面实例上直调 enterDemo');
  }
  const ui = read('scripts/test-real-ui.js');
  assert.match(ui, /callMethod\('changeDemo', 'enterDemo'\)/, 'test-real-ui 走 callMethod 的 changeDemo');
  assert.doesNotMatch(ui, /callMethod\('enterDemo'\)/, 'test-real-ui 不该再调页面级 enterDemo');
  // 需要 Node 侧直接调 store 的先例仍在（capture-design-audit 一开始就 require store）
  assert.match(read('scripts/capture-design-audit.js'), /require\('\.\.\/miniprogram\/lib\/store'\)\.enterDemo\(\)/);
});
