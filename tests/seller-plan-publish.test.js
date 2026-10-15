'use strict';
// 本轮 5 处客户端改动的守卫（合并页 pages/seller/publish + 结果页 pages/seller/plan）：
//   ① 合并页只剩「生成方案」一颗无条件的按钮：那行小字（pub_generate_hint）与新建态的「保存并发布」都不在模板里；
//   ② 结果页那颗按钮的文案是「保存并发布」，旧的 useThisPlan 与那行小字一并消失；
//   ③ 点「保存并发布」= 走合并页同一条发布链路（pages/seller/publish/publish-flow.js），
//      新建态恰好 1 次 create、编辑态恰好 1 次 update，payload 与合并页填的一致、不新建第二张；
//   ④ 缺必填项 / 读不到那份表单时只给一句可读提示，一个请求都不发。
// 桩与 tests/seller-page.test.js、tests/seller-publish-culture.test.js 同一套：真加载页面、内存 storage。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');

const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const PLAN_JS = path.resolve(__dirname, '../miniprogram/pages/seller/plan/plan.js');
const PUBLISH_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.wxml');
const PLAN_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/plan/plan.wxml');

const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

// 日期按本机今天算（页面里的天数也用本机今天），不写死。
function localIso(offsetDays) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = value => String(value).padStart(2, '0');
  return target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate());
}
const OPEN = localIso(1);
const CLOSE = localIso(5);

// 合并页填好的一份「果乡资料」：结果页要发出去的正是这一份。
const FORM = {
  name: '洛川苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
  activityDate: '', address: '洛川县凤栖镇××路8号',
  openDate: OPEN, openTime: '09:00', closeDate: CLOSE, closeTime: '17:00',
  experiences: ['采摘', '观光'], description: '三代人种苹果，霜降后最甜。',
  wechat: 'guoyuan2026', phone: '13800000000',
  location: { latitude: 35.76, longitude: 109.43 }, locationName: '陕西延安市洛川县'
};
// 合并页那一份 payload 的字面值（与 publish-flow.townPayload 的字段一一对应，这里独立写一遍）。
const EXPECTED_PAYLOAD = {
  name: FORM.name, province: FORM.province, city: FORM.city, county: FORM.county,
  fruit: FORM.fruit, activityDate: '', experiences: FORM.experiences,
  address: FORM.address, openDate: FORM.openDate, openTime: FORM.openTime,
  closeDate: FORM.closeDate, closeTime: FORM.closeTime,
  description: FORM.description, wechat: FORM.wechat, phone: FORM.phone,
  location: FORM.location, polishedDescription: '',
  // 本轮新增：方案（AI / 手机上按规矩整理的那份）跟名片一起送上去 —— publish-flow.townPayload
  // 从 lib/plan-draft.js 的暂存里取 title / steps；这里照旧独立写一遍字面值，不引用 INSIGHT。
  plan: { title: '苹果烘片小课堂', steps: ['到园先讲清采摘范围与方式，发小筐让客人自己挑苹果', '照手艺小课堂的苹果烘片课自己洗切护色', '摆盘进烘房，等出炉时玩一局农谚问答攒果票', '成品装瓶写上日期带走'] }
};

const INSIGHT = {
  mode: 'cloudbase', status: 'attention',
  reading: '这几天窗口里有一天雨，建议在园里办两场半天的小课堂，晴天在树下动手、雨天挪进屋，按到访人数分批带开。',
  suggestions: ['按到访批次准备果票与手作材料', '先核对烘房与洗净晾干的果盘'],
  planTitle: '苹果烘片小课堂',
  planSteps: ['到园先讲清采摘范围与方式，发小筐让客人自己挑苹果', '照手艺小课堂的苹果烘片课自己洗切护色', '摆盘进烘房，等出炉时玩一局农谚问答攒果票', '成品装瓶写上日期带走'],
  capacity: 30, budget: 140, alternative: '下雨改到屋里做烘片'
};
const TOWN = Object.assign({ id: 'town-mine', favId: 'fruit-town:townmine', term: '秋分', published: true }, FORM);

let memory;
let calls;
// 结果页发完回「我的发布」：栈里那一页的位置由这个数组决定。
let stack;

function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    navigateBack: options => calls.navigation.push('navigateBack:' + ((options && options.delta) || 1)),
    redirectTo: options => calls.navigation.push(options.url),
    showToast: options => calls.toasts.push(options),
    setNavigationBarTitle: options => calls.titles.push(options.title),
    request: options => {
      const url = options.url || '';
      calls.requests.push(url);
      // GET 请求没有 body（options.data 是 undefined），别拿它去 JSON 克隆。
      calls.payloads.push(options.data === undefined ? undefined : clone(options.data));
      const data = url.includes('/api/seller-insight') ? clone(INSIGHT)
        : url.includes('/api/farmtown/detail') ? { town: clone(TOWN) }
          : url.includes('/api/farmtown/create') ? { town: Object.assign({}, clone(TOWN), { id: 'town-new' }) }
            : url.includes('/api/farmtown/update') ? { town: clone(TOWN) }
              : { error: 'not found' };
      if (options.success) options.success({ statusCode: 200, data: data });
    }
  };
}

function makePage(file) {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
      if (typeof callback === 'function') callback.call(this);
    }
  });
}

// 走一遍真实路径：合并页填完 → 生成方案（结果落本机暂存）→ 进结果页。
async function openPlanPage(options) {
  const publish = makePage(PUBLISH_JS);
  if (options && options.id) publish.onLoad({ id: options.id });
  else publish.onLoad();
  if (options && options.form) publish.setData({ form: clone(options.form) });
  await wait();
  publish.generatePlan();
  await wait();
  const plan = makePage(PLAN_JS);
  plan.onLoad();
  return { publish, plan };
}

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], requests: [], payloads: [], titles: [] };
  store.exitDemo();
  store.clearAll();
  i18n.invalidateLang();
  mockWx();
  stack = [{ route: 'pages/seller/index' }, { route: 'pages/seller/publish/publish' }, { route: 'pages/seller/plan/plan' }];
  global.getCurrentPages = () => stack;
});
test.after(() => { delete global.getCurrentPages; });

// ---- ① 合并页的模板 ----

test('合并页只剩「生成方案」一颗按钮：小字与新建态的保存并发布都不在模板里', () => {
  const wxml = fs.readFileSync(PUBLISH_WXML, 'utf8');
  assert.doesNotMatch(wxml, /pub_generate_hint/, '那行小字（pub_generate_hint）不该再渲染');
  assert.doesNotMatch(wxml, /pub_save_publish/, '新建态的「保存并发布」按钮该删掉');
  assert.doesNotMatch(wxml, /wx:if="\{\{!editing\}\}"/, '新建态专属的那颗按钮不该还在');
  const buttons = wxml.match(/<button\b[^>]*>/g) || [];
  assert.equal(buttons.length, 2, '模板里只该有「生成方案」和编辑态的「保存修改」两颗按钮：\n' + buttons.join('\n'));
  const always = buttons.filter(tag => !/wx:if=/.test(tag));
  assert.equal(always.length, 1, '不挂 wx:if 的按钮只该有一颗');
  assert.match(always[0], /bindtap="generatePlan"/, '唯一那颗主按钮就是「生成方案」');
  assert.match(wxml, /bindtap="generatePlan"[^>]*>\{\{L\.pub_generate\}\}<\/button>/);
  const editing = buttons.filter(tag => /wx:if=/.test(tag));
  assert.equal(editing.length, 1);
  assert.match(editing[0], /wx:if="\{\{editing\}\}"/, '编辑态的「保存修改」保留不动');
  assert.match(wxml, /wx:if="\{\{editing\}\}"[^>]*bindtap="saveCard"[^>]*>\{\{L\.pub_save_edit\}\}<\/button>/);
  // 词典里的键先留着（用户要求不删键）
  assert.equal(i18n.dict.pub_generate_hint[0], '没填完也可以生成，缺的会说明。');
  assert.equal(i18n.dict.pub_save_publish[0], '保存并发布');
  assert.match(wxml, /<demo-notice id="demo-mode-notice"\/>/, '演示模式提示条保留');
});

test('「一次能接待多少人」不再带（可不填），英文侧也不再带 optional', () => {
  assert.equal(i18n.dict.pub_batch_people[0], '②一次能接待多少人');
  assert.equal(i18n.dict.pub_batch_people[1], '②How many people can you host at once');
  assert.doesNotMatch(i18n.dict.pub_batch_people[1], /optional/i);
});

// ---- ② 结果页的模板与文案 ----

test('结果页按钮文案是「保存并发布」，旧的 useThisPlan 与那行小字一并消失', () => {
  const wxml = fs.readFileSync(PLAN_WXML, 'utf8');
  assert.equal(i18n.dict.plan_cta[0], '保存并发布');
  assert.match(wxml, /<button[^>]*bindtap="saveAndPublish"[^>]*>\{\{L\.plan_cta\}\}<\/button>/, '按钮走新的处理函数与文案');
  assert.doesNotMatch(wxml, /plan_cta_note/, '那行小字不再渲染');
  assert.doesNotMatch(wxml, /不会覆盖你原来写的内容/, '旧小字的原话也不该再出现在模板里');
  assert.doesNotMatch(wxml, /useThisPlan/);
  assert.doesNotMatch(wxml, /用这个方案去改我的果乡名片/, '旧按钮文案不该再出现在模板里');
  const js = fs.readFileSync(PLAN_JS, 'utf8');
  assert.doesNotMatch(js, /useThisPlan/, '旧的处理函数该删掉');
  assert.doesNotMatch(js, /setClipboardData/, '结果页不再只做复制');
  assert.match(js, /publishFlow\.saveTown/, '发布走合并页同一条链路');
  assert.match(wxml, /<demo-notice id="demo-mode-notice"\/>/, '演示模式提示条保留');
  // 词典里的键先留着（用户要求不删键）
  assert.equal(i18n.dict.plan_cta_note[1], 'Copies this text and opens the edit page — you confirm and save. Nothing you wrote before is overwritten.');
});

// ---- ③ 真的发布：新建态 / 编辑态 ----

test('新建态点「保存并发布」：恰好 1 次 create、payload 与合并页填的一致、不再新建第二张', async () => {
  const { plan } = await openPlanPage({ form: FORM });
  assert.equal(plan.data.expired, false, '方案该正常显示');
  assert.equal(plan.data.publishing, false);
  plan.saveAndPublish();
  await wait(700);
  const creates = calls.requests.filter(url => url.includes('/api/farmtown/create'));
  assert.equal(creates.length, 1, '只发一次 create：' + creates.length);
  assert.equal(calls.requests.filter(url => url.includes('/api/farmtown/update')).length, 0, '新建态不该更新任何名片');
  assert.deepEqual(calls.payloads[calls.requests.indexOf(creates[0])], EXPECTED_PAYLOAD, 'payload 与合并页填的那份一致');
  assert.equal(calls.toasts.at(-1).title, '发布成功');
  assert.equal(calls.navigation.at(-1), 'navigateBack:2', '发完回「我的发布」，不停在合并页上');
  assert.equal(plan.data.publishing, true, '成功后按钮保持禁用，300ms 内连点也不会再发一张');
  plan.saveAndPublish();
  assert.equal(calls.requests.filter(url => url.includes('/api/farmtown/create')).length, 1, '重复点击不再发第二次');
});

test('编辑态（?id= 进来的）点「保存并发布」：恰好 1 次 update，带原来那张的 id', async () => {
  const { plan } = await openPlanPage({ id: 'town-mine' });
  assert.equal(plan.data.expired, false);
  plan.saveAndPublish();
  await wait(700);
  const updates = calls.requests.filter(url => url.includes('/api/farmtown/update'));
  assert.equal(updates.length, 1, '只发一次 update：' + updates.length);
  assert.equal(calls.requests.filter(url => url.includes('/api/farmtown/create')).length, 0, '编辑态不许新建');
  assert.deepEqual(calls.payloads[calls.requests.indexOf(updates[0])], Object.assign({ id: 'town-mine' }, EXPECTED_PAYLOAD));
  assert.equal(calls.toasts.at(-1).title, '保存成功');
});

test('发布失败也只给一句可读提示，不崩', async () => {
  const { plan } = await openPlanPage({ form: FORM });
  const realRequest = global.wx.request;
  global.wx.request = options => {
    calls.requests.push(options.url || '');
    if (options.fail) options.fail({ errMsg: 'request:fail timeout' });
  };
  try {
    plan.saveAndPublish();
    await wait(700);
  } finally { global.wx.request = realRequest; }
  assert.equal(calls.toasts.at(-1).title, '发布失败');
  assert.equal(plan.data.publishing, false, '失败后按钮要能再点');
});

// ---- ④ 缺项与读不到表单 ----

test('缺必填项时给出可读提示，一个请求都不发', async () => {
  const { plan } = await openPlanPage({ form: Object.assign({}, FORM, { name: '', address: '' }) });
  const before = calls.requests.length;
  plan.saveAndPublish();
  await wait(40);
  assert.equal(calls.requests.length, before, '缺项时不该发任何请求');
  assert.equal(calls.toasts.at(-1).title, i18n.t('pub_err_name'), '提示要能读懂，且指向第一个缺的字段');
  assert.equal(plan.data.publishing, false);
});

test('缺体验标签 / 缺介绍时同样只提示不发请求', async () => {
  const { plan } = await openPlanPage({ form: Object.assign({}, FORM, { experiences: [], description: '  ' }) });
  const before = calls.requests.length;
  plan.saveAndPublish();
  await wait(40);
  assert.equal(calls.requests.length, before);
  assert.equal(calls.toasts.at(-1).title, i18n.t('pub_err_exp_required'));
});

test('结果页读不到合并页那份表单（旧版存档）时只提示过期，不发请求也不白屏', async () => {
  memory.set(require('../miniprogram/lib/plan-draft').KEY + store.capturePartition(), { title: '旧版方案', steps: ['第一步'] });
  const plan = makePage(PLAN_JS);
  plan.onLoad();
  assert.equal(plan.data.expired, false, '方案本体还在，页面照常显示');
  const before = calls.requests.length;
  plan.saveAndPublish();
  await wait(40);
  assert.equal(calls.requests.length, before, '读不到表单就不发请求');
  assert.equal(calls.toasts.at(-1).title, i18n.t('plan_expired'));
  assert.equal(plan.data.publishing, false);
});
