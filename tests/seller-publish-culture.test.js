'use strict';

// v54：果农工作台「生成方案」送上去的活动素材。
// ① miniprogram/data/craft-index.js（新，42 条手艺课小索引）内容逐字来自分包文档，不许编；
// ② pages/seller/publish/publish.js 只往既有 culture[] 里加该果的一条 + 上一次方案名一条，payload 其余字段不动。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const store = require('../miniprogram/lib/store');
const planDraft = require('../miniprogram/lib/plan-draft');
const craftIndex = require('../miniprogram/data/craft-index');
const craftDoc = require('../miniprogram/packageMore/data/craft-lessons-doc');
const validation = require('../server/validation');

const PUBLISH = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const clone = value => JSON.parse(JSON.stringify(value));
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
// 页面里的天数（lib/seller-core.js 的 daysLeft）按本机今天算，所以这里也用本机今天造日期，不写死。
function localIso(offsetDays) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = value => String(value).padStart(2, '0');
  return target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate());
}
const OPEN = localIso(1);
const CLOSE = localIso(5);

// ── ① 索引本体：42 条，逐字抽自 craft-lessons-doc.js，没编、没译、没改 ──────────────────
test('v54 craft index holds 42 fruit-to-lesson rows with no invented content', () => {
  assert.ok(Array.isArray(craftIndex), '索引是数组');
  assert.equal(craftIndex.length, 42, '42 条');
  assert.equal(fs.statSync(path.resolve(__dirname, '../miniprogram/data/craft-index.js')).size <= 6 * 1024, true, '新文件不超过 6KB');
  const docKeys = Object.keys(craftDoc);
  assert.equal(docKeys.length, 42);
  const fruits = craftIndex.map(row => row.fruit);
  assert.equal(new Set(fruits).size, 42, '一果一课，果名不重复');
  craftIndex.forEach(row => {
    assert.deepEqual(Object.keys(row), ['fruit', 'course', 'actions'], row.course + ' 只有 fruit/course/actions 三个键');
    assert.ok(docKeys.includes(row.course), row.course + ' 必须是 craft-lessons-doc.js 里真有的课名');
    assert.ok(row.actions.length >= 3 && row.actions.length <= 5, row.course + ' 动作词 3~5 个');
    row.actions.forEach(action => {
      const verbatim = craftDoc[row.course].steps.some(step => step.slice(0, step.indexOf('：')) === action);
      assert.ok(verbatim, row.course + ' 的动作词「' + action + '」必须逐字来自该课步骤标题');
    });
  });
  // 分包文档里的 42 门课一门没落下
  assert.deepEqual(craftIndex.map(row => row.course).sort(), docKeys.slice().sort());
  // 抽查两条逐字对齐（果名取自 world-fruit-culture.js 的 craft 维度课名对应关系）
  assert.deepEqual(craftIndex.find(row => row.fruit === '苹果'), { fruit: '苹果', course: '苹果烘片', actions: ['清洗与切片', '护色处理', '摆盘与烘干', '耐心等待', '密封保存'] });
  assert.deepEqual(craftIndex.find(row => row.fruit === '青梅'), { fruit: '青梅', course: '青梅酱', actions: ['清洗与杀青', '去核与切碎', '腌制出汁', '慢火熬煮', '装瓶保存'] });
});

// ── ② 客户端 payload：只加该果一条 + 上一次方案名一条 ────────────────────────────────
const result = {
  mode: 'cloudbase', status: 'attention',
  reading: '这几天窗口里有一天雨，建议在园里办两场半天的小课堂，晴天在树下动手、雨天挪进屋，按到访人数分批带开。',
  suggestions: ['按到访批次准备果票与手作材料', '先核对烘房与洗净晾干的果盘'],
  planTitle: '苹果烘片小课堂',
  planSteps: ['到园先讲清采摘范围与方式，发小筐让客人自己挑苹果', '照手艺小课堂的苹果烘片课自己洗切护色', '摆盘进烘房，等出炉时玩一局农谚问答攒果票', '成品装瓶写上日期带走'],
  capacity: 30, budget: 140, alternative: '下雨改到屋里做烘片'
};

let memory; let calls;
function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    navigateTo: options => calls.navigation.push(options.url),
    navigateBack: () => calls.navigation.push('navigateBack'),
    showToast: options => calls.toasts.push(options),
    request: options => {
      calls.requests.push(options.url);
      calls.payloads.push(clone(options.data));
      options.success && options.success({ statusCode: 200, data: clone(result) });
    }
  };
}
// 真加载 publish 页面（与 tests/seller-page.test.js 同一套内存 storage + wx.request 桩）
function makePage() {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(PUBLISH)];
  require(PUBLISH);
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
// 填好必填项，点「生成方案」，把真正发给 /api/seller-insight 的 payload 抓回来。
async function generate(fruit, previousTitle) {
  memory = new Map();
  calls = { navigation: [], toasts: [], requests: [], payloads: [] };
  mockWx();
  if (previousTitle) memory.set(planDraft.KEY + store.capturePartition(), { title: previousTitle, steps: ['上一稿的第一步'] });
  const page = makePage();
  page.onLoad();
  page.inputName({ detail: { value: '洛川苹果园' } });
  page.onRegionChange({ detail: { value: ['陕西', '延安市', '洛川县'] } });
  page.inputFruit({ detail: { value: fruit } });
  page.inputAddress({ detail: { value: '洛川县凤栖镇××路8号' } });
  page.onOpenDate({ detail: { value: OPEN } });
  page.onOpenTime({ detail: { value: '09:00' } });
  page.onCloseDate({ detail: { value: CLOSE } });
  page.onCloseTime({ detail: { value: '17:00' } });
  page.inputBatchLeft({ detail: { value: '800 斤' } });
  page.inputBatchPeople({ detail: { value: '30' } });
  page.generatePlan();
  await wait();
  return { page, payloads: calls.payloads, body: calls.payloads[0] };
}

test('v54 the client sends exactly one craft entry for this fruit plus the last plan name', async () => {
  const { body } = await generate('苹果', '果园周末采摘开放日');
  assert.equal(body.culture.length, 2);
  const craft = body.culture.filter(item => item.title.indexOf('[手艺课]') === 0);
  assert.equal(craft.length, 1, '只带该果那一条，不是 42 条');
  assert.deepEqual(craft[0], {
    title: '[手艺课] 苹果烘片',
    text: '苹果的手艺课「苹果烘片」关键动作：清洗与切片、护色处理、摆盘与烘干、耐心等待、密封保存'
  });
  const last = body.culture.filter(item => item.title.indexOf('[上次方案]') === 0);
  assert.equal(last.length, 1);
  assert.match(last[0].text, /上次已用：果园周末采摘开放日/);
  assert.match(last[0].text, /换一个方向/);
  // 别的果的课名一个都不许混进来
  assert.ok(!/青梅酱|橙肉小食|椰枣夹馅|释迦果肉杯/.test(JSON.stringify(body)));
  // 果名在 42 条里对不上号时，只可能对上一条，不会把整张表塞上去
  assert.ok(body.culture.length <= 3, '服务端只收前 3 条 culture');
});

test('v54 payload fields other than culture stay byte-identical and still pass the server contract', async () => {
  const { body } = await generate('苹果', '果园周末采摘开放日');
  // 除 culture 外交给服务端的字段原样（与 v53 的 buildPayload 一字不差）
  // v59 唯一的例外：顶层多一个 lang（当前界面语言，这里是默认的中文账户 → 'zh'）。
  assert.deepEqual(body, {
    lang: 'zh',
    batch: {
      name: '洛川苹果园', crop: '苹果', region: ['陕西', '延安市', '洛川县'], areaMu: 0,
      harvestStart: OPEN, harvestEnd: CLOSE, deadline: CLOSE,
      matureDate: '', growthNote: '', reception: { enabled: true, capacity: 30, staff: 0 }
    },
    risk: { status: 'attention', label: '需要关注', windowDays: 6, remainingKg: 400, supplyKg: 400, expectedSalesKg: null, pendingKg: 0 },
    weather: { available: false },
    tourism: { totalTrips: 0, totalParties: 0, top: [] },
    culture: [
      { title: '[手艺课] 苹果烘片', text: '苹果的手艺课「苹果烘片」关键动作：清洗与切片、护色处理、摆盘与烘干、耐心等待、密封保存' },
      { title: '[上次方案] 请换方向', text: '上次已用：果园周末采摘开放日；这次请换一个方向，不要与上次同一套路' }
    ],
    limits: { maxCapacity: 30, maxBudget: 240 }
  });
  // 零接口改动：这份 payload 服务端照收，两条 culture 长度都在契约里
  const parsed = validation.sellerInsightRequest(body);
  assert.equal(parsed.culture.length, 2);
  parsed.culture.forEach(item => { assert.ok(item.title.length <= 80); assert.ok(item.text.length <= 300); });
});

test('v54 an unknown fruit adds no craft entry and an absent last plan adds no repeat entry', async () => {
  const unknown = await generate('水蜜桃', '');
  assert.deepEqual(unknown.body.culture, [], '索引里没有这门课就不带，绝不编一条');
  // 上一稿读不到（清缓存 / 首次生成）时也不带那条
  const first = await generate('西瓜', '');
  assert.equal(first.body.culture.length, 1);
  assert.equal(first.body.culture[0].title, '[手艺课] 西瓜果杯');
  assert.match(first.body.culture[0].text, /切半取肉/);
  assert.ok(!/上次已用/.test(JSON.stringify(first.body)));
  // 上一稿名换了，送上去的也换
  const second = await generate('西瓜', '西瓜果杯DIY');
  assert.match(second.body.culture[1].text, /上次已用：西瓜果杯DIY/);
});
