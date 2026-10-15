'use strict';
// 方案 B（跟名片一起存到服务端）的客户端守卫：
//   ① 发布 payload 里带上这份方案，内容 = 本机暂存（lib/plan-draft.js）那一份，其它字段一个字没动；
//   ② 老存档 / 没生成过方案 → payload 里没有 plan 这个键，也不崩；
//   ③ 「我的发布」卡片最后一行才出现「我的方案」块，且只有真有方案的名片才渲染（wxml 结构断言）；
//   ④ 新增的中英词典键只有 sl_my_plan 这一个，英文侧没有汉字；除「我的发布」外没有第二个页面渲染它。
// 桩与 tests/seller-en.test.js / tests/seller-page.test.js 同一套：真加载页面、内存 storage、wx.request 桩。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HAN = /[\u4e00-\u9fa5]/;
const SELLER_JS = path.resolve(__dirname, '../miniprogram/pages/seller/index.js');
const SELLER_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/index.wxml');
const SELLER_WXSS = path.resolve(__dirname, '../miniprogram/pages/seller/index.wxss');
const PUBLISH_FLOW_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish-flow.js');

// 本机暂存的那份方案（形状与 publish.js 的 draftFrom 落进 lib/plan-draft.js 的一致）。
const DRAFT_TITLE = '梨园秋分小课堂';
const DRAFT_STEPS = [
  '到园先集合，带客人绕园走一圈，讲这梨与当下的时令。',
  '说清采摘范围与方式，发下小筐，各自去挑合乎标准的梨。',
  '摘够后坐下歇一歇，尝梨、称重、装袋，当场结清。',
  '照手艺小课堂的做法熬一小罐梨膏，写下日期带走。'
];
const PLAN = { title: DRAFT_TITLE, steps: DRAFT_STEPS };

// 合并页填好的一份「果乡资料」（payload 里除 plan 外的字段，与 publish-flow.townPayload 一一对应）。
const FORM = {
  name: '洛川苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
  activityDate: '', address: '洛川县凤栖镇××路8号',
  openDate: '2026-09-01', openTime: '09:00', closeDate: '2026-09-05', closeTime: '17:00',
  experiences: ['采摘', '观光'], description: '三代人种苹果，霜降后最甜。',
  wechat: 'guoyuan2026', phone: '13800000000',
  location: { latitude: 35.76, longitude: 109.43 }
};
// 旧的字段名单（顺序也照旧）：新方案是「追加一项」，不是重排。
const OLD_KEYS = ['name', 'province', 'city', 'county', 'fruit', 'activityDate', 'experiences', 'address',
  'openDate', 'openTime', 'closeDate', 'closeTime', 'description', 'wechat', 'phone', 'location', 'polishedDescription'];

const MY_TOWNS = [
  // 有方案的名片：方案跟名片一起从服务端读回来
  Object.assign({ id: 'town-mine', favId: 'fruit-town:townmine', term: '秋分', published: true, plan: PLAN }, FORM),
  // 老名片：服务端返回里压根没有 plan 字段
  { id: 'town-plain', favId: 'fruit-town:townplain', name: '老果园', term: '', fruit: '', province: '', city: '', county: '', description: '老名片', polishedDescription: '', experiences: [], transport: '', contact: '', wechat: '', phone: '', location: null, published: false },
  // 方案被改坏（只有标题没有步骤 / 形状不对）：整块不渲染，也不许崩
  Object.assign({ id: 'town-broken', favId: 'fruit-town:townbroken', name: '坏方案园', term: '', fruit: '', province: '', city: '', county: '', description: '', polishedDescription: '', experiences: [], transport: '', contact: '', wechat: '', phone: '', location: null, published: true, plan: { title: '没有步骤的方案' } }, {}),
  Object.assign({ id: 'town-weird', favId: 'fruit-town:townweird', name: '怪方案园', term: '', fruit: '', province: '', city: '', county: '', description: '', polishedDescription: '', experiences: [], transport: '', contact: '', wechat: '', phone: '', location: null, published: true, plan: '这不是一份方案' }, {})
];

let memory = new Map();
let calls = { navigation: [], toasts: [], modals: [], titles: [], requests: [] };

global.wx = {
  getStorageSync: key => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: key => memory.delete(key),
  navigateTo: o => calls.navigation.push(o.url),
  navigateBack: () => calls.navigation.push('navigateBack'),
  reLaunch: o => calls.navigation.push(o.url),
  switchTab: o => calls.navigation.push(o.url),
  showToast: o => calls.toasts.push(o),
  showModal: o => { calls.modals.push(o); if (o.success) o.success({ confirm: true }); },
  hideHomeButton: () => {},
  setNavigationBarTitle: o => calls.titles.push(o.title),
  request: opts => {
    const url = opts.url || '';
    calls.requests.push(url);
    const data = url.includes('/api/farmtown/my') ? { towns: MY_TOWNS }
      : url.includes('/api/farmtown/detail') ? { town: MY_TOWNS[0] }
        : url.includes('/api/farmtown/create') || url.includes('/api/farmtown/update') ? { town: MY_TOWNS[0] }
          : { error: 'not found' };
    if (opts.success) opts.success({ statusCode: 200, data: data });
  }
};

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const planDraft = require('../miniprogram/lib/plan-draft');
const publishFlow = require(PUBLISH_FLOW_JS);

const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(file, 'utf8');

function loadPage(file) {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
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

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], modals: [], titles: [], requests: [] };
  store.clearAll();
  i18n.invalidateLang();
});

// ---- ① 发布 payload 带方案（内容 = 本机暂存那份）----

test('发布 payload 带上本机暂存的那份方案，其它字段一个不多一个不少', () => {
  planDraft.remember({ title: DRAFT_TITLE, steps: DRAFT_STEPS, form: FORM, editing: false, townId: '' });
  const payload = publishFlow.townPayload(FORM);
  assert.deepEqual(payload.plan, PLAN, 'plan 就是暂存里那份方案的原话（title + steps）');
  assert.deepEqual(Object.keys(payload), OLD_KEYS.concat('plan'), '原有字段的名字与顺序都没动，方案追加在最后');

  // 直接对着暂存读一遍：两边必须是同一份（不加工、不改写、不截断）
  const draft = planDraft.read();
  assert.deepEqual(payload.plan, { title: draft.title, steps: draft.steps });

  // 编辑态（?id=）走的是同一个 townPayload：payload 里同样带方案，id 由 saveTown 另外补
  const editing = publishFlow.townPayload(FORM);
  assert.deepEqual(editing.plan, PLAN);
});

test('暂存里的方案两头有空白 / 混了空步骤：送上去的是清理过的那几条，空步骤不带上', () => {
  planDraft.remember({
    title: '  ' + DRAFT_TITLE + '  ',
    steps: ['  ' + DRAFT_STEPS[0] + ' ', '', '   ', DRAFT_STEPS[1], DRAFT_STEPS[2]],
    form: FORM, editing: false, townId: ''
  });
  assert.deepEqual(publishFlow.townPayload(FORM).plan, { title: DRAFT_TITLE, steps: DRAFT_STEPS.slice(0, 3) });
});

// ---- ② 老存档 / 没方案：payload 里没有这个字段，也不崩 ----

test('没生成过方案（暂存是空的）→ payload 里没有 plan 键，字段与改造前逐字一致', () => {
  assert.equal(planDraft.read(), null, '没存过就是 null');
  const payload = publishFlow.townPayload(FORM);
  assert.ok(!('plan' in payload), '没方案就不带 plan 键（老客户端、老名片照旧）');
  assert.deepEqual(Object.keys(payload), OLD_KEYS);
});

test('老存档 / 存档被改坏：读不出方案就当没有，不发怪东西也不崩', () => {
  const key = planDraft.KEY + store.capturePartition();
  const broken = [
    '这不是一份方案',                                   // 存档被别的东西占了
    { title: '旧版方案' },                              // 老存档：只有标题没有 steps
    { title: '旧版方案', steps: [] },                    // steps 是空的
    { title: '', steps: DRAFT_STEPS },                  // 标题空
    { steps: DRAFT_STEPS }                              // 没有标题
  ];
  for (const value of broken) {
    memory.set(key, value);
    const payload = publishFlow.townPayload(FORM);
    assert.ok(!('plan' in payload), '读不出方案就不能硬塞一个：' + JSON.stringify(value));
    assert.deepEqual(Object.keys(payload), OLD_KEYS);
  }
  // 步骤全空 / 不是数组
  memory.set(key, { title: '方案', steps: ['  ', ''] });
  assert.ok(!('plan' in publishFlow.townPayload(FORM)));
  memory.set(key, { title: '方案', steps: '第一步' });
  assert.ok(!('plan' in publishFlow.townPayload(FORM)));
});

// ---- ③ 卡片：有方案才出现「我的方案」块，位置在最后一行 ----

test('卡片数据：有方案的名片带方案名与那几步；老名片 / 坏方案整块不渲染', async () => {
  const subject = loadPage(SELLER_JS);
  subject.onShow();
  await wait();

  assert.equal(subject.data.myTowns.length, 4);
  const mine = subject.data.myTowns[0];
  assert.equal(mine.hasPlan, true);
  assert.equal(mine.planTitle, DRAFT_TITLE);
  assert.deepEqual(mine.planSteps, DRAFT_STEPS, '那几步按原顺序原样摆出来（编号在模板里加）');
  // 卡片原有内容照旧
  assert.equal(mine.name, FORM.name);
  assert.equal(mine.region, '陕西 · 延安市 · 洛川县');
  assert.equal(mine.metaLine, '秋分 · 苹果');
  assert.equal(mine.address, FORM.address);
  assert.equal(mine.wechat, FORM.wechat);
  assert.equal(mine.phone, FORM.phone);
  assert.equal(mine.statusText, '已发布');

  const plain = subject.data.myTowns[1];
  assert.equal(plain.hasPlan, false, '老名片（服务端没有 plan 字段）不出这一块');
  assert.equal(plain.planTitle, '');
  assert.deepEqual(plain.planSteps, []);
  assert.equal(subject.data.myTowns[2].hasPlan, false, '只有标题没有步骤 = 坏方案，不出空块');
  assert.equal(subject.data.myTowns[3].hasPlan, false, 'plan 不是对象（老数据被改坏）也不崩');
  assert.ok(!('plan' in subject.data.myTowns[1]), '老名片的数据里不该凭空多出 plan');
});

test('wxml 结构：「我的方案」块是名片正文的最后一块，前面是手机号那一行、后面才是状态与按钮', () => {
  const wxml = read(SELLER_WXML);
  const lines = wxml.split('\n');
  const at = needle => lines.findIndex(line => line.includes(needle));

  const iMain = at('class="tc-main"');
  const iWechat = at('sl_wechat_colon');
  const iPhone = at('sl_phone_colon');
  const iLabel = at('sl_my_plan');
  const iTitle = at('item.planTitle');
  const iStep = at('item.planSteps');
  const iStatus = at('class="tc-status');
  const iActions = at('class="tc-actions"');

  assert.ok(iMain >= 0 && iWechat > iMain && iPhone > iWechat, '原有的行序没动：微信号 → 手机号');
  assert.ok(iLabel > iPhone, '「我的方案」块追加在原来最后一行（手机号）之后');
  assert.ok(iTitle > iLabel && iStep > iTitle, '先方案名、再那几步');
  assert.ok(iStep < iStatus && iStatus < iActions, '它仍是正文（tc-main）里的东西，没插到状态/按钮后面');

  // 这一块自己闭合后，紧跟的两行就是 tc-block 与 tc-main 的收尾 → 它确实是正文的最后一块
  assert.equal(lines[iStep + 1].trim(), '</view>', '紧接着收尾的是方案块自己');
  assert.equal(lines[iStep + 2].trim(), '</view>', '再收尾的就是名片正文 tc-main');
  assert.match(lines[iStep + 3], /class="tc-status/, '正文之后才是状态标签');

  // 只挂 wx:if="{{item.hasPlan}}"：没方案的名片连空块都不留
  assert.match(lines[iLabel - 1], /wx:if="\{\{item\.hasPlan\}\}"/, '整块挂在 hasPlan 上');
  assert.match(lines[iStep], /wx:for="\{\{item\.planSteps\}\}"/);
  assert.match(lines[iStep], /\{\{stepIndex \+ 1\}\}\. \{\{step\}\}/, '编号在模板里加（与 plan.wxml 的步骤写法一致）');
  assert.match(wxml, /<view class="tc-label">\{\{L\.sl_my_plan\}\}<\/view>/, '标题是新增的那个词典键');

  // 卡片原有的内容一个字没少（原标题/标签集合与顺序）
  const ORDER = ['pub_name', 'sl_region', 'sl_address', 'sl_open_date_colon', 'sl_open_time_colon',
    'tc-chips', 'sl_intro', 'sl_transport_colon', 'sl_wechat_colon', 'sl_phone_colon', 'sl_my_plan'];
  const positions = ORDER.map(key => wxml.indexOf(key));
  positions.forEach((position, index) => {
    assert.ok(position >= 0, '缺了原来的内容：' + ORDER[index]);
    if (index) assert.ok(position > positions[index - 1], '顺序变了：' + ORDER[index - 1] + ' → ' + ORDER[index]);
  });

  // 样式：字号走既有的 --fs-scale 口径，没有写死 px 的字号
  const wxss = read(SELLER_WXSS);
  ['tc-plan-title', 'tc-plan-step'].forEach(name => {
    const rule = wxss.split('\n').find(line => line.startsWith('.' + name + '{'));
    assert.ok(rule, '缺样式 ' + name);
    assert.match(rule, /calc\(23rpx \* var\(--fs-scale, 1\)\)/, name + ' 的字号要跟全站一样缩放');
  });
});

// ---- ④ 词典与「只在这一处显示」 ----

test('新增词典键只有 sl_my_plan 这一个（快讯 / ①去哪 那轮复用 plan_nav，没再加键）：中英成对、英文侧没有汉字', () => {
  assert.deepEqual(i18n.dict.sl_my_plan, ['我的方案', 'My plan']);
  assert.doesNotMatch(i18n.dict.sl_my_plan[1], HAN);
  assert.equal(i18n.t('sl_my_plan'), '我的方案', '中文模式逐字是「我的方案」');
  // 「我的方案」这句中文只挂在 sl_my_plan 上，没有第二个键偷偷复用
  assert.deepEqual(Object.keys(i18n.dict).filter(key => i18n.dict[key][0] === '我的方案'), ['sl_my_plan']);
  // 工作台把这一句取进了模板字典（其它页面的 L 里不该有它）
  const sellerJs = read(SELLER_JS);
  assert.match(sellerJs, /i18n\.labels\(\[[^\]]*'sl_my_plan'/);
});

test('「我的方案」这一句仍然只长在「我的发布」一张模板上（快讯 / ①去哪 用的是「活动方案」）', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const hits = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.wxml')) continue;
      if (read(full).includes('L.sl_my_plan')) hits.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  })(root);
  // 2026-10-13：用户要求把方案也拿去吸引游客，但游客那两页的标题是「活动方案」（键 plan_nav），
  // 不是卖货台专用的「我的方案」——所以这里仍该只有一张（命中数变了说明有人又复用了这个词）。
  assert.deepEqual(hits, ['pages/seller/index.wxml'], '「我的方案」只属于「我的发布」；快讯 / ①去哪 用的是「活动方案」');
  // 结果页自己的方案块（stepsTitle / steps）照旧，不受影响
  const planWxml = read(path.resolve(root, 'pages/seller/plan/plan.wxml'));
  assert.match(planWxml, /\{\{stepsTitle\}\}/);
  assert.match(planWxml, /wx:for="\{\{steps\}\}"/);
});

// ---- ⑤ 快讯页与 ①去哪：共用 lib/town-info.js 的映射，两页各渲染一块 ----
// 验收口径（2026-10-13，用户当天纠正过两处）：
//   ① cardFor() 对带 plan 的名片返回方案字段、对不带 plan 的名片照旧（空值口径：
//      planTitle '' / planSteps [] / hasPlan false）；
//   ② 两张 wxml 里都有 wx:if 包着的 {{L.plan_nav}} 块（标题是「活动方案」，不是「我的方案」）；
//   ③ 两页都没有新增 i18n 键：标题直接用结果页早就在用的 plan_nav；
//   ④ 「所在地区」的三段用「 · 」分隔（与「我的发布」一致），不再挤成「河南省郑州市中牟县」。

const TOWN_INFO_JS = path.resolve(__dirname, '../miniprogram/lib/town-info.js');
const NEWS_JS = path.resolve(__dirname, '../miniprogram/packageMore/news/news.js');
const NEWS_WXML = path.resolve(__dirname, '../miniprogram/packageMore/news/news.wxml');
const NEWS_WXSS = path.resolve(__dirname, '../miniprogram/packageMore/news/news.wxss');
const ROUTE_JS = path.resolve(__dirname, '../miniprogram/pages/route/route.js');
const ROUTE_WXML = path.resolve(__dirname, '../miniprogram/pages/route/route.wxml');
const ROUTE_WXSS = path.resolve(__dirname, '../miniprogram/pages/route/route.wxss');

test('cardFor：带 plan 的名片带出方案名与那几步；不带 plan 的照旧空着（不崩）', () => {
  const townInfo = require(TOWN_INFO_JS);
  const base = Object.assign({}, FORM, { id: 'town-x', term: '秋分', fruit: '苹果' });
  const valid = () => false;   // 没有本机位置 → 距离空串，断言不受位置影响

  const mine = townInfo.cardFor(Object.assign({}, base, { plan: PLAN }), null, valid);
  assert.equal(mine.hasPlan, true);
  assert.equal(mine.planTitle, DRAFT_TITLE);
  assert.deepEqual(mine.planSteps, DRAFT_STEPS, '那几步按原顺序原样摆出来（编号在模板里加）');

  const plain = townInfo.cardFor(Object.assign({}, base), null, valid);
  assert.equal(plain.hasPlan, false, '老名片（服务端没有 plan 字段）不出这一块');
  assert.equal(plain.planTitle, '');
  assert.deepEqual(plain.planSteps, []);
  assert.ok(!('plan' in plain), '老名片的数据里不该凭空多出 plan');

  // 坏方案（只有标题 / 形状不对 / 干脆是别的东西）→ 整块不渲染，也不许崩。
  // 口径与「我的发布」那张卡片严格同一套：模板只认 hasPlan，所以这里就只钉 hasPlan=false
  // （标题 / 步骤带出来什么原话都无所谓——没人渲染它；seller 的 planView 也是这个行为，不动它）。
  [{ title: '没有步骤的方案' }, { title: '', steps: DRAFT_STEPS }, { steps: DRAFT_STEPS },
    { title: '  ', steps: ['  ', ''] }, '这不是一份方案', ['第一步'], 42, null]
    .forEach(bad => {
      assert.equal(townInfo.cardFor(Object.assign({}, base, { plan: bad }), null, valid).hasPlan, false,
        '坏方案不出空块：' + JSON.stringify(bad));
    });

  // 两头有空白 / 混了空步骤：照「我的发布」那张卡片同一套口径清理
  const messy = townInfo.cardFor(Object.assign({}, base, {
    plan: { title: '  ' + DRAFT_TITLE + '  ', steps: ['  ' + DRAFT_STEPS[0] + ' ', '', '   ', DRAFT_STEPS[1]] }
  }), null, valid);
  assert.equal(messy.planTitle, DRAFT_TITLE);
  assert.deepEqual(messy.planSteps, DRAFT_STEPS.slice(0, 2));
  assert.equal(messy.hasPlan, true);

  // 名片原有字段一个字没动（与不带 plan 的那张逐项相同）
  const KEYS = ['id', 'name', 'termLabel', 'activityDate', 'experiences', 'region', 'wechat', 'phone',
    'address', 'openDateText', 'openTimeText', 'distance', 'intro', 'transport', 'contact'];
  KEYS.forEach(key => {
    assert.ok(key in mine, 'cardFor 少了原有字段：' + key);
    assert.deepEqual(mine[key], plain[key], '原有字段被方案影响了：' + key);
  });

  // 名片本身是空 / 没有：照旧返回一张空名片，不抛错
  assert.equal(townInfo.cardFor(null, null, valid).hasPlan, false);
  assert.deepEqual(townInfo.cardFor(undefined, null, valid).planSteps, []);
});

test('「所在地区」三段用「 · 」分隔（与「我的发布」一致），有值的才留、重复的只留一段', () => {
  const townInfo = require(TOWN_INFO_JS);
  const valid = () => false;
  const regionOf = town => townInfo.cardFor(Object.assign({}, town), null, valid).region;

  // 用户点名的两种现状：三段挤在一起 → 现在带「 · 」
  assert.equal(regionOf({ province: '河南省', city: '郑州市', county: '中牟县' }), '河南省 · 郑州市 · 中牟县');
  assert.equal(regionOf({ province: '北京', city: '北京市', county: '东城区' }), '北京 · 北京市 · 东城区');
  // 与「我的发布」那张卡片的拼法逐字一致（pages/seller/index.js 的 decorateTown.region）
  const sellerRegion = ['河南省', '郑州市', '中牟县'].filter(Boolean).join(' · ');
  assert.equal(regionOf({ province: '河南省', city: '郑州市', county: '中牟县' }), sellerRegion);

  // 只有一段 / 两段：不留多余分隔符（「河南 · 」这种）
  assert.equal(regionOf({ province: '河南省' }), '河南省');
  assert.equal(regionOf({ city: '郑州市', county: '中牟县' }), '郑州市 · 中牟县');
  assert.equal(regionOf({}), '');
  assert.ok(!/(^|\s)·\s*$|^\s*·/.test(regionOf({ province: '河南省' })), '不许出现开头 / 结尾的孤立分隔符');

  // 省市区有重复值：同一段只留一次（原来的去重口径没变，只是换了分隔符）
  assert.equal(regionOf({ province: '北京', city: '北京', county: '东城区' }), '北京 · 东城区');

  // 快讯页与 ①去哪 都直接渲染 card.region（这不是关键，关键是没有第三处再拼一遍）
  const newsJs = read(NEWS_JS);
  assert.ok(!/province/.test(newsJs), '快讯页不许自己再拼一遍地区');
  const routeJs = read(ROUTE_JS);
  assert.match(routeJs, /townInfo\.regionLabel\(/, '①去哪 沿用共用的 regionLabel');
  // 「我的发布」那处没动（它本来就是对的，用的是自己的 decorateTown）
  assert.match(read(SELLER_JS), /\[t\.province, t\.city, t\.county\]\.filter\(Boolean\)\.join\(' · '\)/);
});

test('快讯页：「活动方案」块挂在 hasPlan 上，位置在手机号之后、按钮之前', () => {
  const wxml = read(NEWS_WXML);
  const lines = wxml.split('\n');
  const at = needle => lines.findIndex(line => line.includes(needle));

  const iPhone = at('sl_phone_colon');
  const iBlock = at('item.hasPlan');
  const iLabel = at('L.plan_nav');
  const iTitle = at('item.planTitle');
  const iStep = at('item.planSteps');
  const iActions = at('class="town-actions"');

  assert.ok(iPhone >= 0 && iBlock > iPhone, '「活动方案」块追加在原来最后一行（手机号）之后');
  assert.match(lines[iBlock], /wx:if="\{\{item\.hasPlan\}\}"/, '整块挂在 hasPlan 上（没方案连空块都不留）');
  assert.ok(iLabel > iBlock && iTitle > iLabel && iStep > iTitle, '先标题、再方案名、再那几步');
  assert.ok(iStep < iActions, '它仍在卡片正文里，没插到「排一张票」按钮后面');
  assert.match(lines[iStep], /wx:for="\{\{item\.planSteps\}\}"/);
  assert.match(lines[iStep], /\{\{stepIndex \+ 1\}\}\. \{\{step\}\}/, '编号在模板里加');
  assert.match(wxml, /\{\{L\.plan_nav\}\}/, '标题用既有的词典键，不硬编码中文');
  assert.ok(!wxml.includes('L.sl_my_plan'), '这一页不许复用卖货台专用的「我的方案」');

  // 数据确实来自共用的 cardFor（本页只转发，不自己再写一份映射）
  const js = read(NEWS_JS);
  assert.match(js, /townInfo\.cardFor\(/, '本页仍走共用的 cardFor');
  assert.ok(!/planTitle\s*:/.test(js), '本页不许再写一份方案映射');

  // 样式：字号走既有的 --fs-scale 口径，不写死 px
  const wxss = read(NEWS_WXSS);
  ['town-plan-title', 'town-plan-step'].forEach(name => {
    const rule = wxss.split('\n').find(line => line.startsWith('.' + name + '{'));
    assert.ok(rule, '缺样式 ' + name);
    assert.match(rule, /calc\(2[36]rpx \* var\(--fs-scale, 1\)\)/, name + ' 的字号要跟全站一样缩放');
  });
});

test('①去哪：候选名片（预览 + 展开）都带上「活动方案」块，位置在手机号之后', () => {
  const wxml = read(ROUTE_WXML);
  const lines = wxml.split('\n');
  const at = needle => lines.findIndex(line => line.includes(needle));

  // 两条候选行（poolPreview / poolRest）各要一套：块 / 标题键都出现两次
  const blocks = lines.map((line, index) => ({ line, index }))
    .filter(row => row.line.includes('item.card.hasPlan'));
  assert.equal(blocks.length, 2, '预览那一条与「查看更多果园」那一条都要有');
  blocks.forEach(row => assert.match(row.line, /wx:if="\{\{item\.card\.hasPlan\}\}"/));

  const labels = lines.filter(line => line.includes('L.plan_nav'));
  assert.equal(labels.length, 2, '两条候选行各一个标题（不硬编码中文）');
  assert.ok(!wxml.includes('L.sl_my_plan'), '这一页不许复用卖货台专用的「我的方案」');

  // 第一条（预览）里的相对位置：手机号 → 方案块 → 联系方式
  const iPhone = at('sl_phone_colon');
  const iBlock = at('item.card.hasPlan');
  const iLabel = at('L.plan_nav');
  const iTitle = at('item.card.planTitle');
  const iStep = at('item.card.planSteps');
  const iContact = at('rt_contact_prefix');
  assert.ok(iPhone >= 0 && iBlock > iPhone, '「活动方案」块排在手机号那一行之后');
  assert.ok(iLabel > iBlock && iTitle > iLabel && iStep > iTitle, '先标题、再方案名、再那几步');
  assert.ok(iStep < iContact, '它排在最后一行联系方式之前（与「我的发布」的位置口径一致）');
  assert.match(lines[iStep], /wx:for="\{\{item\.card\.planSteps\}\}"/);
  assert.match(lines[iStep], /\{\{stepIndex \+ 1\}\}\. \{\{step\}\}/, '编号在模板里加');

  // 数据来自共用的 cardFor（本页也只是转发）
  const js = read(ROUTE_JS);
  assert.match(js, /townInfo\.cardFor\(/, '候选池仍走共用的 cardFor');
  assert.ok(!/planTitle\s*:/.test(js), '本页不许再写一份方案映射');

  // 样式：字号走既有的 --fs-scale 口径，不写死 px
  const wxss = read(ROUTE_WXSS);
  ['pool-plan-title', 'pool-plan-step'].forEach(name => {
    const rule = wxss.split('\n').find(line => line.startsWith('.' + name + '{'));
    assert.ok(rule, '缺样式 ' + name);
    assert.match(rule, /calc\(22rpx \* var\(--fs-scale, 1\)\)/, name + ' 的字号要跟全站一样缩放');
  });
});

test('两页都没有新增 i18n 键：标题直接用既有的 plan_nav，词典一个字没加', () => {
  // 「活动方案」这一对中英，用结果页早就在用的 plan_nav（不新造键、也不用 sl_my_plan）
  assert.deepEqual(i18n.dict.plan_nav, ['活动方案', 'Activity plan']);
  assert.doesNotMatch(i18n.dict.plan_nav[1], HAN);
  assert.equal(i18n.t('plan_nav'), '活动方案', '中文模式逐字是「活动方案」');
  // 「我的方案」那一句仍只属于「我的发布」用的那个键
  assert.deepEqual(i18n.dict.sl_my_plan, ['我的方案', 'My plan']);
  assert.deepEqual(Object.keys(i18n.dict).filter(key => i18n.dict[key][0] === '我的方案'), ['sl_my_plan']);
  // 词典里没有第二个「活动方案」——用户建议新增的 plan_block_title 不该出现（内容重复）
  assert.equal(i18n.dict.plan_block_title, undefined, '既有 plan_nav 已经够用，不新增重复内容的键');
  assert.deepEqual(Object.keys(i18n.dict).filter(key => i18n.dict[key][0] === '活动方案'), ['plan_nav']);

  // 两页的标签集里都有它（否则 wxml 里渲染成空）：
  // 快讯页把它放进模块级 LABEL_KEYS（onLoad / onShow 各取一次），①去哪 放进 LABEL_KEYS。
  assert.match(read(NEWS_JS), /LABEL_KEYS = \[[^\]]*'plan_nav'/, '快讯页要把它取进 L');
  assert.match(read(ROUTE_JS), /'plan_nav'/, '①去哪 要把它取进 LABEL_KEYS');

  // 真跑一遍快讯页（只有 onLoad 是同步的，不碰网络）：L 里必须真取到「活动方案」，不是键名本身、也不是空
  const newsPage = loadPage(NEWS_JS);
  newsPage.onLoad();
  assert.equal(newsPage.data.L.plan_nav, '活动方案', '快讯页要取到中文的「活动方案」');

  // 两页新增的词典键是 0：方案这一块只用到 plan_nav 这一个键，
  // 其余（news_activity_date / sl_*_colon / rt_contact_prefix …）都是本来就在的；
  // 它们必须在词典里真的存在，否则渲染出来是键名本身。
  ['plan_nav', 'news_activity_date', 'sl_open_date_colon', 'sl_open_time_colon',
    'sl_wechat_colon', 'sl_phone_colon', 'sl_none', 'rt_contact_prefix'].forEach(key => {
    assert.ok(i18n.dict[key], '词典里没有这个键：' + key);
  });
});
