'use strict';

// v59：果乡名片 →「我的方案」在英文模式下也要是英文。这条测试盯客户端这一端的接线（服务端那一段见
// tests/model-regressions.test.js 的英文分支测试与 tests/seller-insight.test.js 的长度口径测试）：
//   ① 点「生成方案」时，当前界面语言随请求上报（lang: 'en' / 'zh'）；
//   ② 英文模式下、AI 交回一份「按英文长度写」的方案（reading 300 字符、每条建议 120、每条步骤 150），
//      客户端不再按中文字数把它判无效 —— 存进本机暂存的是这份 AI 方案，不是中文兜底；
//   ③ 中文模式下同一份超长英文方案仍按老口径被拒 → 照旧换成本机兜底（中文侧逐字回归）；
//   ④ 结果页的标题/步骤/来源行在英文模式下都是英文（文案全部走 lib/i18n.js 既有键，没有新造词）。
// 桩与 tests/seller-plan-publish.test.js、tests/seller-publish-culture.test.js 同一套：真加载页面、内存 storage。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const planDraft = require('../miniprogram/lib/plan-draft');

const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const PLAN_JS = path.resolve(__dirname, '../miniprogram/pages/seller/plan/plan.js');

const HAN = /[\u4e00-\u9fa5]/;
const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function localIso(offsetDays) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = value => String(value).padStart(2, '0');
  return target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate());
}
const OPEN = localIso(1);
const CLOSE = localIso(5);

const FORM = {
  name: 'Luochuan Wang orchard', province: 'Shaanxi', city: 'Yan’an', county: 'Luochuan', fruit: 'Apple',
  activityDate: '', address: 'No.8 Fengqi Road', openDate: OPEN, openTime: '09:00', closeDate: CLOSE, closeTime: '17:00',
  experiences: ['采摘'], description: 'Three generations of apple growers.', wechat: 'guoyuan2026', phone: '13800000000',
  location: { latitude: 35.76, longitude: 109.43 }, locationName: 'Shaanxi Yan’an Luochuan'
};

// 一份「按英文长度写」的 AI 方案：三处长度都超过中文口径（160 / 60 / 90），都在英文口径（400 / 180 / 270）内。
const EN_INSIGHT = {
  mode: 'cloudbase', status: 'attention',
  reading: 'Rain is expected on one day inside this window, so two half-day sessions fit better than one long day: work under the trees on the fine day and move the craft part indoors when it rains, and bring guests in by arrival group so nobody queues at the gate. Weather and visitor signals shape the schedule only; they are not a sales conclusion.',
  suggestions: [
    'Check the yard, the parking space and the hand-washing point before the first group arrives.',
    'Price the craft materials at local rates and keep an indoor plan ready for the rainy day.'
  ],
  planTitle: 'Apple drying workshop weekend',
  planSteps: [
    'Meet at the gate, walk the picking rows with your guests and agree on the picking scope and method before anyone starts.',
    'Hand out small baskets and let each guest pick their own fruit; weigh and bag it on site instead of promising a fixed weight.',
    'Run the craft class from the notes you were given: guests wash, slice and dry the fruit while you watch the heat and the packing.',
    'Finish around the fruit-ticket game, then send everyone home with the jar or the dried tray they made, dated and labelled.'
  ],
  capacity: 30, budget: 140, alternative: 'If it rains, move the craft part indoors and keep the same arrival groups.'
};

// 送上去的那份 payload 必须是「英文长度」的证明：这三处长度在中文口径下会被整条判无效。
test.before(() => {
  assert.ok(EN_INSIGHT.reading.length > 160 && EN_INSIGHT.reading.length <= 400, 'reading 要落在英文口径内、且超出中文上限');
  EN_INSIGHT.suggestions.forEach(item => assert.ok(item.length > 60 && item.length <= 180, '建议要超出中文上限（60）'));
  EN_INSIGHT.planSteps.forEach(item => assert.ok(item.length > 90 && item.length <= 270, '步骤要超出中文上限（90）'));
});

let memory;
let calls;
let insight;

function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    showToast: options => calls.toasts.push(options),
    setNavigationBarTitle: options => calls.titles.push(options.title),
    request: options => {
      calls.requests.push(options.url);
      calls.payloads.push(clone(options.data));
      if (options.success) options.success({ statusCode: 200, data: clone(insight) });
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
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts.at(-1)] = value;
      }
    }
  });
}

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

// 走真实路径：填好表单 → 点「生成方案」→ 进结果页。
async function generate(code) {
  memory = new Map();
  calls = { navigation: [], toasts: [], requests: [], payloads: [], titles: [] };
  mockWx();
  store.exitDemo();
  store.clearAll();
  useLang(code);
  const publish = makePage(PUBLISH_JS);
  publish.onLoad();
  publish.setData({ form: clone(FORM), batchLeft: '400 公斤', batchPeople: '30' });
  publish.generatePlan();
  await wait();
  const payloads = calls.payloads.filter(item => item && item.batch);
  assert.equal(payloads.length, 1, '只该发一次 /api/seller-insight');
  const draft = planDraft.read();
  const plan = makePage(PLAN_JS);
  plan.onLoad();
  return { publish, draft, plan, payload: payloads[0] };
}

test('v59 English: the request carries lang:en and a long English plan is kept instead of the local fallback', async () => {
  insight = EN_INSIGHT;
  const { draft, plan, payload } = await generate('en');

  assert.equal(payload.lang, 'en', '当前界面语言要随请求上报');
  assert.equal(draft.ai, true, '英文长方案不许因为字数被换成中文兜底');
  assert.equal(draft.mode, 'cloudbase');
  assert.equal(draft.title, EN_INSIGHT.planTitle);
  assert.deepEqual(draft.steps, EN_INSIGHT.planSteps);
  assert.equal(draft.capacity, 30);
  assert.equal(draft.budget, 140);

  // 结果页照 ai 结果渲染：标题、步骤、来源行都是英文（文案走既有 i18n 键）
  assert.equal(plan.data.expired, false);
  assert.equal(plan.data.isAI, true);
  assert.equal(plan.data.title, EN_INSIGHT.planTitle);
  assert.deepEqual(plan.data.steps, EN_INSIGHT.planSteps);
  assert.doesNotMatch(plan.data.sourceLine, HAN, 'AI 来源行在英文模式下要走英文文案');
  assert.equal(plan.data.sourceLine, i18n.t('plan_src_ai', { n: draft.filled || 0 }));
});

test('v59 Chinese: the same long English plan is still rejected by the old caps and falls back on device', async () => {
  insight = EN_INSIGHT;
  const { draft, payload } = await generate('zh');

  assert.equal(payload.lang, 'zh', '中文模式上报 zh（老客户端不传 lang，服务端也按 zh）');
  assert.equal(draft.ai, false, '中文口径没放宽：超长解读仍整条判无效');
  assert.equal(draft.mode, 'local-rules');
  assert.notEqual(draft.title, EN_INSIGHT.planTitle, '走的是本机兜底标题，不是那份 AI 英文方案');
});

test('v59 English: a plan that also fits the Chinese caps keeps working unchanged', async () => {
  insight = Object.assign({}, EN_INSIGHT, {
    reading: 'Two half-day sessions fit this window better than one long day, and guests come in by arrival group.',
    suggestions: ['Check the yard and the hand-washing point first', 'Keep an indoor plan for the rainy day'],
    planSteps: [
      'Meet at the gate and agree on the picking scope before anyone starts.',
      'Hand out baskets and let every guest pick their own fruit.',
      'Run the craft class from the given notes and pack the results.'
    ]
  });
  const { draft, payload } = await generate('en');
  assert.equal(payload.lang, 'en');
  assert.equal(draft.ai, true);
  assert.equal(draft.title, EN_INSIGHT.planTitle);
});

test('v59 the client caps still match the server caps for both languages', () => {
  const service = require('node:fs').readFileSync(path.resolve(__dirname, '../miniprogram/lib/service.js'), 'utf8');
  const validation = require('node:fs').readFileSync(path.resolve(__dirname, '../server/validation.js'), 'utf8');
  // 两边的英文侧数值必须一致（改一处要同步另一处）：400 / 180 / 270
  assert.match(service, /reading: 400, suggestion: 180, step: 270/);
  assert.match(validation, /en: \{ reading: 400, suggestion: 180, step: 270/);
  // 中文侧数值一个没动：160 / 60 / 90
  assert.match(service, /reading: 160, suggestion: 60, step: 90/);
  assert.match(validation, /zh: \{ reading: 160, suggestion: 60, step: 90/);
});
