'use strict';
// 果园活动方案（新设计图 2「一页填完」）：上半段「果乡资料」= 原「发布我的果乡名片」的 12 项，
// 一项没丢、字段名与校验规则原样；下半段「这一批果子」= 新增的 2 项（大概还剩多少 / 一次能接待多少人）。
// 两段在同一页上，从上往下填，中间没有跳页。
// 编辑模式（?id=xxx）：回填已有数据（下半段两项回填本机值）。
const farmtown = require('../../../lib/farmtown-service');
const batchLocal = require('../../../lib/batch-local');
const planDraft = require('../../../lib/plan-draft');
const store = require('../../../lib/store');
const publishFlow = require('./publish-flow');
const service = require('../../../lib/service');
const sellerCore = require('../../../lib/seller-core');
const i18n = require('../../../lib/i18n');
const craftIndex = require('../../../data/craft-index');

// 体验标签（存档值永远是中文）：与 pages/seller/index.js 同一批键，中文值取词典的中文侧，
// 页面里不写死中文（中文模式显示原值、逐字不变；英文模式只换显示名）。
const EXP_KEYS = ['sl_exp_pick', 'sl_exp_sightseeing', 'sl_exp_craft', 'sl_exp_food', 'sl_exp_culture'];
const EXPERIENCES = EXP_KEYS.map(function (key) { return i18n.dict[key][0]; });
const EXP_KEY_BY_ZH = {};
EXP_KEYS.forEach(function (key) { EXP_KEY_BY_ZH[i18n.dict[key][0]] = key; });
function experienceLabel(name) {
  const key = EXP_KEY_BY_ZH[name];
  return key ? i18n.t(key) : name;
}
// 页面实例创建时按当前语言生成选项：label 只用于显示，value（中文存档值）用于选中态与存档。
function experienceOptions() {
  return EXPERIENCES.map(function (name) { return { value: name, label: experienceLabel(name) }; });
}
// 两步表单的标题带 {{step}} 占位，wxml 不能二次求值，所以在页面里拼好。
function stepTitleFor(step) { return i18n.t('pub_step_title', { step: step }); }
function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}
function emptyForm() {
  return { name: '', province: '', city: '', county: '', regionFull: [], fruit: '', activityDate: '', address: '', openDate: '', openTime: '', closeDate: '', closeTime: '', experiences: [], description: '', wechat: '', phone: '', location: null, locationName: '' };
}
// region 选择器（省市区）的 value 必须是 data 顶层的一个数组，而且里面放的必须是选择器内置字典里的
// 名字（「陕西省」，不是「陕西」）。所以这一项存两份值：
//   · regionValue —— 交给选择器的值：没选过就是空数组（官方文档里 region 的默认值就是 []，
//     表示每一列都停在第一个值），选过之后原样留着选择器给的那一份；
//   · form.province / city / county —— 存档值，形状一个字不改（省名仍存短名）。
// 只有「省」要去行政后缀：存档一直是短省名（server/farmtown.js:92-99 的种子、
// packageMore/lib/season-journal.js:7-15 的省名表、tests/seller-plan-publish.test.js:36 全写「陕西」），
// 而选择器给的是「陕西省 / 新疆维吾尔自治区 / 北京市」——不去后缀，新果乡在手账海报上会静默不点亮。
// 市 / 县不去后缀：存档里本来就有「延安市 / 洛川县」这种带后缀写法，而缩写对不上（种子里
// city: '红河州' vs 选择器的「红河哈尼族彝族自治州」），做对照表得不偿失。
function shortProvince(name) {
  return String(name || '').replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|维吾尔|壮族|回族|自治区|省|市)+$/, '');
}
// 编辑老名片时「所在地区」要能预选（2026-10-17）：存档是短名（「陕西」），选择器字典只认全名
// （「陕西省」），短名硬塞进 regionValue 三列对不上 → 选择器只能停在第一列。
// 改法：双存 —— 除存档那三段短名外，再存一份「选择器原样返回的全名三段」（form.regionFull），
// loadTown（编辑态）把它读回给 regionValue，于是预选成功。不建省名对照表（34 个省 / 自治区的写法对不齐，
// 得不偿失）；卡片与列表显示仍用短名（form.province / city / county 一个字没动）。
// 服务端白名单不收这一项（server/farmtown.js 的 normalize 只挑它认的字段），所以这份全名另存本机一份 ——
// 键名与 lib/batch-local.js / lib/recent-town.js 同一套：带演示 / 个人分区后缀（不改 store.js）。
// 找回的办法不是按名片 id，而是按「全名去掉省后缀后 == 存档那三段短名」对：新建名片是在结果页保存的
// （pages/seller/plan/plan.js 走同一条发布链路），发出去之前拿不到 id，只有这三段短名一定会落在存档里。
// 老存档 / 这台手机没选过这个地区 → 找不回，regionValue 仍是 []（退化成加这一项之前的行为：显示照旧、不报错）。
const REGION_FULL_KEY = 'guayouji.town.regionFull.';
const REGION_PART_MAX = 40;
const REGION_FULL_MAX = 8;   // 只记最近选过的 8 个地区，本机存档不无限长大
function fullRegion(value) {
  if (!Array.isArray(value) || value.length !== 3) return [];
  // 只认选择器给的那种三段非空字符串（老存档是 undefined / 形状不对 → 空数组）。
  const parts = value.map(function (part) { return typeof part === 'string' ? part.slice(0, REGION_PART_MAX) : ''; });
  return parts[0] && parts[1] && parts[2] ? parts : [];
}
// 全名三段 → 存档那三段短名的形状（省去行政后缀，市 / 区县原样，与 onRegionChange 的入档口径同一个函数）。
function regionShortOf(full) { return [shortProvince(full[0]), full[1], full[2]]; }
// 读不到 / 存档坏了 / 格式不对 → 空列表（照旧不预选，页面不报错）。
function regionFullList() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return [];
    const value = wx.getStorageSync(REGION_FULL_KEY + store.capturePartition());
    return Array.isArray(value) ? value.map(fullRegion).filter(function (item) { return item.length === 3; }).slice(0, REGION_FULL_MAX) : [];
  } catch (e) { return []; }
}
// 编辑态取全名：先看名片自己带的那一份（服务端哪天收了这一项就直接用），再按三段短名找本机记过的那一份。
function regionFullOf(town) {
  const fromTown = fullRegion(town && town.regionFull);
  if (fromTown.length) return fromTown;
  const short = [String((town && town.province) || ''), String((town && town.city) || ''), String((town && town.county) || '')];
  if (!short[0] || !short[1] || !short[2]) return [];
  const want = short.join('\u0000');
  for (const item of regionFullList()) { if (regionShortOf(item).join('\u0000') === want) return item; }
  return [];
}
// 选完就记一条（同一份地区只留最新的一条）；写失败只影响下次预选，不抛错、不挡住名片保存。
function rememberRegionFull(value) {
  const parts = fullRegion(value);
  if (!parts.length) return;
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return;
    const key = parts.join('\u0000');
    const list = [parts].concat(regionFullList().filter(function (item) { return item.join('\u0000') !== key; }));
    wx.setStorageSync(REGION_FULL_KEY + store.capturePartition(), list.slice(0, REGION_FULL_MAX));
  } catch (e) { /* 忽略 */ }
}
// 体验标签选中态映射：wxml 不支持 indexOf，这里预计算好每个标签是否选中。
function expSelectedMap(experiences) {
  const map = {};
  (experiences || []).forEach(function (exp) { map[exp] = true; });
  return map;
}

// ---- 「生成方案」用到的四件小事：读已填项 / 照服务端契约拼 payload / 本机兜底 / 暂存草稿 ----
// 服务端 /api/seller-insight 的字段与数值约束见 server/validation.js:120-170；越界一律夹到上限。
// 只送已填的：没填的字段留空（不猜、不编）；预约人数一律 0 —— 服务端会用自己的预约数据覆盖 tourism
// （server/app.js:288-291），客户端编的数字不但没用，还会把假数据带进模型。
const STATUS_LABELS = { insufficient: '信息不足', attention: '需要关注', urgent: '临近截止' };
function firstNumber(value) {
  const matched = String(value === null || value === undefined ? '' : value).match(/\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}
function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
// 「800 斤 / 120 公斤」只认能换算成公斤的写法；写成「120 箱」这种认不出来就当没填，不猜重量。
function kgFromText(value) {
  const text = String(value === null || value === undefined ? '' : value);
  const number = firstNumber(text);
  if (!number) return 0;
  if (/斤/.test(text)) return clampInt(number / 2, 0, 10000000);
  if (/公斤|千克|kg|KG/.test(text)) return clampInt(number, 0, 10000000);
  if (/吨/.test(text)) return clampInt(number * 1000, 0, 10000000);
  return 0;
}
function daysLeft(dateText) {
  const matched = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) return 0;
  const target = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])).getTime();
  if (!Number.isFinite(target)) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((target - today) / 86400000) + 1);
}
// 已经填了的项：既用来算「按你填的 N 项整理」，也用来告诉结果页「哪些没填」。
// 缺项名直接用既有 i18n 键（果乡名称 / 所在地区 / 当季水果 / 可去的日期段 / 果乡介绍），只有「一次能接待多少人」是新键。
function filledInput(data) {
  const form = data.form || {};
  const people = clampInt(firstNumber(data.batchPeople), 0, 999);
  const region = form.province && form.city && form.county
    ? [form.province, form.city, form.county].map(function (part) { return String(part).slice(0, 40); })
    : [];
  const items = [
    { key: 'pub_name', filled: !!(form.name && String(form.name).trim()) },
    { key: 'pub_region', filled: region.length === 3 },
    { key: 'pub_fruit', filled: !!(form.fruit && String(form.fruit).trim()) },
    { key: 'pub_date_window', filled: !!(form.openDate || form.closeDate) },
    { key: 'pub_desc', filled: !!String(form.description || '').trim() },
    { key: 'plan_m_people', filled: people > 0 }
  ];
  const missingKeys = items.filter(function (item) { return !item.filled; }).map(function (item) { return item.key; });
  return {
    name: String(form.name || '').trim(), region: region, fruit: String(form.fruit || '').trim(),
    openDate: form.openDate || '', closeDate: form.closeDate || '', openTime: form.openTime || '', closeTime: form.closeTime || '',
    people: people, leftKg: kgFromText(data.batchLeft),
    filledCount: items.length - missingKeys.length, missingKeys: missingKeys
  };
}
// 「生成方案」要送上云端的 culture[]（服务端只收前 3 条、每条标题≤80字、正文≤300字，见 server/validation.js:133-136）。
// v54 只加这两条，接口契约一个字不动：①该果的手艺课索引一条（让模型照真课名与真动作写手作环节）②上一次用过的方案名。
// 果子在 42 条索引里对不上号就整条不带（不猜、不编）；上一稿方案名读不到也不带。
function craftEntry(fruit) {
  const name = String(fruit || '').trim();
  if (!name) return null;
  // 找法：先要全等；再要「填的果子名里含索引果名」，最后才是「索引果名里含填的果子名」（如填「梨」对「秋梨」）。
  // 带「子/儿/果」尾巴的常见写法（如「橙子」）去掉尾巴再对上一条；仍对不上就不带。
  const trimmed = name.replace(/[子儿果]$/, '');
  const same = function (a, b) { return a === b || (!!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)); };
  const found = craftIndex.find(function (item) { return item.fruit === name; })
    || craftIndex.find(function (item) { return same(name, item.fruit); })
    || (trimmed !== name ? craftIndex.find(function (item) { return same(trimmed, item.fruit); }) : null);
  if (!found) return null;
  return { title: '[手艺课] ' + found.course, text: found.fruit + '的手艺课「' + found.course + '」关键动作：' + found.actions.join('、') };
}
// 上一次生成过的方案名（lib/plan-draft.js 既有本机暂存，键与分区照仓库既有写法，不新造存储）：
// 让模型这次换一个方向，别与上一稿同套路。
function lastPlanEntry() {
  const draft = planDraft.read();
  const title = draft && typeof draft.title === 'string' ? draft.title.trim() : '';
  if (!title) return null;
  return { title: '[上次方案] 请换方向', text: '上次已用：' + title + '；这次请换一个方向，不要与上次同一套路' };
}
function cultureEntries(input) {
  return [craftEntry(input.fruit), lastPlanEntry()].filter(Boolean);
}
function buildPayload(input) {
  const today = sellerCore.today();
  const harvestStart = input.openDate || today;
  const deadline = (input.closeDate && input.closeDate >= harvestStart) ? input.closeDate : harvestStart;
  const days = daysLeft(deadline);
  // 程序测算是唯一风险结论：有「还剩多少 + 最晚哪天」才敢给关注/临近，缺一个就如实写信息不足。
  const status = (!input.leftKg || !days) ? 'insufficient' : (days <= 3 ? 'urgent' : 'attention');
  return {
    // v59：当前界面语言随请求上报（'zh' / 'en'，由 generatePlan 从 lib/i18n.js:1647 的 getLang() 取一次、
    // 全链路共用同一个归一化值）。服务端白名单接住它（server/validation.js 的 sellerInsightRequest），
    // 英文时那条提示词才走英文输出；中文模式送来的一直是 'zh'，服务端行为与改动前逐字一致（缺省也是 zh）。
    lang: input.lang === 'en' ? 'en' : 'zh',
    batch: {
      name: (input.name || input.fruit || '我的果园').slice(0, 80), crop: input.fruit.slice(0, 40),
      region: input.region, areaMu: 0,
      harvestStart: harvestStart, harvestEnd: deadline, deadline: deadline,
      matureDate: '', growthNote: '',
      reception: { enabled: input.people > 0, capacity: input.people, staff: 0 }
    },
    risk: {
      status: status, label: STATUS_LABELS[status], windowDays: clampInt(days, 0, 7),
      remainingKg: input.leftKg, supplyKg: input.leftKg, expectedSalesKg: null, pendingKg: 0
    },
    weather: { available: false },
    tourism: { totalTrips: 0, totalParties: 0, top: [] },
    culture: cultureEntries(input),
    // 花费上限不给 100000 那个空上限：模型会把上限当花费报回来（实测 budget=100000）。
    // 按 lib/seller-core.js 自己的材料口径（每位参与者 8 元，见 createPlan 的 perVisitorAssumption）算上限，
    // 模型仍自己报价，只是报不出「一场十万」这种数。没填人数就退回服务端默认上限。
    limits: {
      maxCapacity: input.people > 0 ? clampInt(input.people, 1, 999) : 999,
      maxBudget: input.people > 0 ? clampInt(input.people * 8, 0, 100000) : 100000
    }
  };
}
// 真 AI 与「手机上整理」怎么分：服务端真连上模型时 mode 是 provider 名（实测线上是 cloudbase，
// 仓库里另一种写法是 openai-compatible，见 server/tasks.js:110），兜底一律 mode='local-rules' 且带 fallbackReason
// （server/tasks.js:37-41、lib/service.js:147-158）。两者不许混为一谈。
function isAiResult(result) {
  return !!(result && result.mode && result.mode !== 'local-rules' && result.mode !== 'local-fallback' && !result.fallbackReason);
}
// 最后的保底：连本机规则都跑不动时也要有东西可看（不至于白屏）。
// v59 说明：minimalPlan / localPlan 这几句是页面自己写的兜底文案，仓库里**没有**现成的英文键
// （lib/i18n.js 的 sl_li_* 是「服务端本机解读」那一串的英文，句子与这里并不逐字对应），
// 按用户口径「不许自己翻译造词，实在没有就复用中文」——英文模式下这几句暂时仍是中文，
// 已单列清单交给用户定，没有在本轮新造英文。
function minimalPlan(input) {
  const crop = input.fruit || '果子';
  return {
    status: 'insufficient', reading: '本机规则草案：可售信息不足，先按能办的条件排一场活动。',
    suggestions: ['先核实场地、人手与接待日期', '活动材料按当地实价自己核'],
    planTitle: (crop + '果园活动草案').slice(0, 40),
    planSteps: [
      '到园先集合，带客人绕园走一圈，讲这果子与当下的时令。',
      '说清采摘范围与方式，发下小筐，各自去挑合乎标准的果子。',
      '摘够后坐下歇一歇，尝果、称重、装袋，当场结清。',
      '照手艺小课堂的做法做一小罐果酱或一盘果干，写下日期带走。'
    ],
    capacity: input.people > 0 ? input.people : null, budget: null, alternative: '', mode: 'local-rules'
  };
}
// 断网 / 超时 / 演示账户：走 lib/seller-core.js 的既有规则（assess + createPlan）出一份草案，
// 来源行照实写「手机上按规矩整理」。它给的是「预售与渠道协作」那一支时（活动支要交通 / 人手 /
// 接待日期齐全，新表单没收这些），结果页改用本机写好的通用四步 —— 这一页是活动方案，兜底也不给卖果指导。
function localPlan(input) {
  try {
    const today = sellerCore.today();
    const harvestStart = input.openDate || today;
    const deadline = (input.closeDate && input.closeDate >= harvestStart) ? input.closeDate : harvestStart;
    const batch = {
      id: '', name: input.name || '我的果园', region: input.region, crop: input.fruit || '果子',
      areaMu: 0, openingDate: today, openingStockKg: 0,
      harvestStart: harvestStart, harvestEnd: deadline, deadline: deadline,
      yieldMinKg: null, yieldMaxKg: null, matureDate: '', growthNote: '', assumedDailyKg: null,
      reception: { enabled: input.people > 0, startDate: '', endDate: '', capacity: input.people, staff: input.people > 0 ? 1 : 0, traffic: '', budget: 0, rainyAlternative: '' },
      simulated: false
    };
    const risk = sellerCore.assess(batch, [], today);
    const plan = sellerCore.createPlan(batch, risk, today);
    const reading = ('本机规则草案：' + (risk.errors.length ? risk.errors.join('；') : risk.label + '。')).slice(0, 160);
    const title = String((plan && plan.title) || '');
    if (/预售|渠道/.test(title)) {
      const draft = minimalPlan(input);
      draft.reading = reading;
      return draft;
    }
    const steps = (plan && plan.steps ? plan.steps : []).map(function (step) { return String(step).slice(0, 90); }).filter(Boolean).slice(0, 6);
    if (!title || !steps.length) {
      const draft = minimalPlan(input);
      draft.reading = reading;
      return draft;
    }
    return {
      status: risk.status, reading: reading,
      suggestions: ['容量与日期按你填的条件估算，接待前需再核实', '活动材料按当地实价自己核'],
      planTitle: title.slice(0, 40), planSteps: steps,
      capacity: input.people > 0 ? input.people : null, budget: null,
      alternative: String(plan.alternative || '').slice(0, 120), mode: 'local-rules'
    };
  } catch (error) { return minimalPlan(input); }
}
// 结果页只认这几个字段：多存无益，也免得本机存档长胖。
// 例外是 form / editing / townId：结果页那颗「保存并发布」要把这张果乡名片真的发出去，
// 就得拿回这一页填的「果乡资料」原样过同一条发布链路（publish-flow.js），所以生成时一并存下。
// v59：落地暂存时的长度上限也按语言取 —— 英文方案照中文字数截断会被切成半句话，结果页照着显示就废了。
// 这三组数值与服务端 server/validation.js 的 INSIGHT_CAPS、客户端 lib/service.js 的同口径校验逐字一致：
// 英文 标题≤120 / 每条步骤≤270 / 备选≤360；中文仍是 40 / 90 / 120（一个都没动）。
function draftCaps(lang) {
  return lang === 'en' ? { title: 120, step: 270, alternative: 360 } : { title: 40, step: 90, alternative: 120 };
}
function draftFrom(result, input, source) {
  const from = source || {};
  const caps = draftCaps(input && input.lang);
  return {
    ai: isAiResult(result), mode: String(result.mode || ''),
    title: String(result.planTitle || '').slice(0, caps.title),
    steps: (result.planSteps || []).map(function (step) { return String(step).slice(0, caps.step); }).slice(0, 6),
    capacity: Number.isInteger(result.capacity) && result.capacity > 0 ? result.capacity : null,
    budget: Number.isInteger(result.budget) && result.budget > 0 ? result.budget : null,
    alternative: String(result.alternative || '').trim().slice(0, caps.alternative),
    filled: input.filledCount, missingKeys: input.missingKeys,
    dates: { deadline: input.closeDate, openTime: input.openTime, closeTime: input.closeTime },
    form: JSON.parse(JSON.stringify(from.form || {})),
    editing: from.editing === true,
    townId: from.editing === true ? String(from.townId || '') : ''
  };
}

Page({
  data: {
    fontClass: 'fs-normal',
    step: 1,
    errors: {},
    editing: false,
    townId: '',
    form: emptyForm(),
    // 交给「省市区选择器」的值：必须是 data 顶层数组（不能写成 {{[form.province, ...]}} 那种
    // 渲染时临时拼的数组字面量），没选过就是官方默认值 []。
    regionValue: [],
    submitting: false,
    error: '',
    stepTitle: '',
    experiences: [],
    expSelected: {},
    // 「这一批果子」两项：只存本机（服务端名片接口不收），页面进来时回填。
    batchLeft: '',
    batchPeople: '',
    generating: false,
    L: {}
  },
  onLoad: function (options) {
    // 导航栏标题按设计图走「果园活动方案」，与页内标题（wxml 的 L.sl_plan_entry）同一把键，不新增键。
    i18n.applyNav('sl_plan_entry');
    const batch = batchLocal.read();
    this.setData({ fontClass: fontClass(), stepTitle: stepTitleFor(1), batchLeft: batch.left, batchPeople: batch.people, experiences: experienceOptions(), L: i18n.labels(['pub_name', 'pub_region', 'pub_location', 'pub_fruit', 'pub_activity_date', 'pub_desc', 'pub_transport', 'pub_your_desc', 'pub_polished', 'pub_repolish', 'pub_next', 'pub_experience', 'pub_contact', 'pub_wechat', 'pub_phone', 'pub_address', 'pub_address_ph', 'pub_date_window', 'pub_open_date', 'pub_open_time', 'pub_close_date', 'pub_close_time', 'pub_submit', 'pub_save_edit', 'pub_step_title', 'pub_name_ph', 'pub_region_ph', 'pub_fruit_ph', 'pub_desc_ph', 'pub_wechat_ph', 'pub_phone_ph', 'pub_prev', 'pub_page_hint', 'pub_sec_card', 'pub_sec_batch', 'pub_batch_left', 'pub_batch_left_ph', 'pub_batch_people', 'pub_batch_people_ph', 'pub_generate', 'pub_generate_hint', 'pub_save_publish', 'sl_plan_entry']) });
    const id = options && options.id;
    if (id) {
      this.setData({ editing: true, townId: id });
      this.loadTown(id);
    }
  },
  loadTown: function (id) {
    const self = this;
    farmtown.getTown(id).then(function (town) {
      if (!town) { self.setData({ error: i18n.t('pub_err_town_missing') }); return; }
      const hasLoc = farmtown.validTownLocation(town.location);
      // 预选用的全名三段：名片自己带的那一份，或本机记过的那一份（老存档两份都没有 → []）。
      const regionFull = regionFullOf(town);
      self.setData({
        // 编辑态预选：只有拿得到「选择器自己的全名三段」时才交给 regionValue；老存档只有短名
        // （「陕西」对不上选择器的「陕西省」）→ 仍是 []，选择器停在第一列，页面照旧不报错；
        // 下面那一行显示仍照旧是已存的三段短名（form.province 等已回填）。
        regionValue: regionFull,
        form: {
          name: town.name, province: town.province, city: town.city, county: town.county, regionFull: regionFull,
          fruit: town.fruit, activityDate: town.activityDate || '', address: town.address || '', openDate: town.openDate || '', openTime: town.openTime || '', closeDate: town.closeDate || '', closeTime: town.closeTime || '', experiences: town.experiences || [],
          description: town.description || town.polishedDescription || '',
          wechat: town.wechat || '', phone: town.phone || '',
          location: hasLoc ? { latitude: town.location.latitude, longitude: town.location.longitude } : null,
          locationName: hasLoc ? ((town.province || '') + (town.city || '') + (town.county || '')) : ''
        },
        expSelected: expSelectedMap(town.experiences || [])
      });
    }).catch(function () { self.setData({ error: i18n.t('pub_err_load_failed') }); });
  },
  // ---- 第 1 步：基本信息 ----
  inputName: function (e) { this.setData({ 'form.name': e.detail.value, 'errors.name': '' }); },
  inputFruit: function (e) { this.setData({ 'form.fruit': e.detail.value, 'errors.fruit': '' }); },
  onRegionChange: function (e) {
    const v = e.detail.value || [];
    // form.* 仍是三段字符串、仍是原来的形状（只有省名抹掉行政后缀，市 / 区县原样）；
    // regionValue / form.regionFull 存的是「选择器自己的全名三段」，让下次打开就停在这三列。
    const full = fullRegion(v);
    // 选完立刻记本机一条（不看名片 id：新建名片是在结果页才保存、那时才知道 id，见上面的注释）。
    rememberRegionFull(full);
    this.setData({
      'form.province': shortProvince(v[0]),
      'form.city': v[1] || '',
      'form.county': v[2] || '',
      'form.regionFull': full,
      'errors.region': '',
      regionValue: full
    });
  },
  // 可去的日期（选填）；没填就是空串，快讯名片上整行不显示。
  onDateChange: function (e) { this.setData({ 'form.activityDate': (e.detail && e.detail.value) || '' }); },
  inputAddress: function (e) { this.setData({ 'form.address': e.detail.value, 'errors.address': '' }); },
  onOpenDate: function (e) { this.setData({ 'form.openDate': (e.detail && e.detail.value) || '', 'errors.openDate': '' }); },
  onOpenTime: function (e) { this.setData({ 'form.openTime': (e.detail && e.detail.value) || '', 'errors.openTime': '' }); },
  onCloseDate: function (e) { this.setData({ 'form.closeDate': (e.detail && e.detail.value) || '', 'errors.closeDate': '' }); },
  onCloseTime: function (e) { this.setData({ 'form.closeTime': (e.detail && e.detail.value) || '', 'errors.closeTime': '' }); },
  next1: function () {
    const f = this.data.form;
    // 字段级校验：错在哪就标在哪，并滚到那个字段（不再只弹一句一闪而过的提示）。
    // 规则本身在 pages/seller/publish/publish-flow.js：结果页的「保存并发布」走的是同一个函数。
    const errors = publishFlow.step1Errors(f);
    const first = publishFlow.firstErrorField(errors);
    if (first) {
      this.setData({ errors: errors });
      wx.showToast({ title: errors[first], icon: 'none' });
      if (wx.pageScrollTo) wx.pageScrollTo({ selector: '#field-' + first, duration: 200 });
      return;
    }
    this.setData({ errors: {}, step: 2, stepTitle: stepTitleFor(2) });
  },
  chooseLocation: function () {
    const self = this;
    wx.chooseLocation({
      success: function (res) {
        if (!Number.isFinite(res.latitude) || !Number.isFinite(res.longitude)) { wx.showToast({ title: i18n.t('pub_err_location_invalid'), icon: 'none' }); return; }
        self.setData({
          'form.location': { latitude: res.latitude, longitude: res.longitude },
          'form.locationName': res.name || res.address || i18n.t('pub_toast_location_set')
        });
      },
      fail: function () {}
    });
  },
  // ---- 第 2 步：体验与介绍 ----
  toggleExp: function (e) {
    // dataset.exp 传的是中文值（wxml 绑 item.value）：选中态与存档都用中文值，英文只影响显示名。
    const exp = e.currentTarget.dataset.exp;
    const list = this.data.form.experiences.slice();
    const expSelected = Object.assign({}, this.data.expSelected);
    const i = list.indexOf(exp);
    if (i !== -1) { list.splice(i, 1); expSelected[exp] = false; }
    else {
      if (list.length >= 5) { wx.showToast({ title: i18n.t('pub_err_exp_max'), icon: 'none' }); return; }
      list.push(exp); expSelected[exp] = true;
    }
    this.setData({ 'form.experiences': list, expSelected: expSelected });
  },
  inputDesc: function (e) { this.setData({ 'form.description': e.detail.value }); },
  inputWechat: function (e) { this.setData({ 'form.wechat': e.detail.value }); },
  inputPhone: function (e) { this.setData({ 'form.phone': e.detail.value }); },
  // ---- 下半段「这一批果子」：两项都选填，不做校验，存本机（名片接口不收）----
  inputBatchLeft: function (e) { this.setData({ batchLeft: e.detail.value }); },
  inputBatchPeople: function (e) { this.setData({ batchPeople: e.detail.value }); },
  next2: function () {
    // 第 2 页是最后一页：先校验必填，再直接提交（2026-10-10 起取消第 3 页 AI 润色）
    const step2 = publishFlow.step2Error(this.data.form);
    if (step2) { wx.showToast({ title: step2, icon: 'none' }); return; }
    this.submit();
  },
  back: function (e) { const step = Number(e.currentTarget.dataset.step); this.setData({ step: step, stepTitle: stepTitleFor(step) }); },
  goBack: function () { wx.navigateBack({ delta: 1 }); },
  // ---- 页面底部的主按钮：生成方案（设计图二）----
  // 点了先出方案给他看：调 /api/seller-insight，把结果暂存本机，跳到结果页（pages/seller/plan）。
  // 这一条路不发布名片：不走 next1() / next2() / submit()，也不碰 /api/farmtown/create|update。
  // 缺项也能生成：只送已填的内容，没填的留空，缺了什么由结果页用一句大白话说清。
  generatePlan: function () {
    const self = this;
    if (this.data.generating) return;
    const input = filledInput(this.data);
    // v59：语言在这一处取一次、全链路共用（payload 上报 / 客户端同口径校验 / 落地暂存的截断上限），
    // 免得三处各自读一次、将来改一处漏两处。
    input.lang = i18n.getLang() === 'en' ? 'en' : 'zh';
    batchLocal.remember(this.data.batchLeft, this.data.batchPeople);
    this.setData({ generating: true, error: '' });
    const go = function (result) {
      planDraft.remember(draftFrom(result, input, { form: self.data.form, editing: self.data.editing, townId: self.data.townId }));
      self.setData({ generating: false });
      if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url: '/pages/seller/plan/plan' });
    };
    let request;
    try {
      request = service.sellerInsight(buildPayload(input), function () { return localPlan(input); });
    } catch (error) {
      request = Promise.reject(error);
    }
    Promise.resolve(request).then(function (result) {
      // 服务端自己的本机兜底只给标题、不给步骤（server/tasks.js:39），这种结果不上页面：
      // 一律换成 lib/seller-core.js 的草案，来源行照实写「手机上按规矩整理的」。
      const usable = isAiResult(result) && Array.isArray(result.planSteps) && result.planSteps.length >= 3;
      go(usable ? result : localPlan(input));
    }).catch(function () {
      // 连兜底都失败也要有东西可看：本地再出一份保底草案，绝不白屏。
      go(minimalPlan(input));
      wx.showToast({ title: i18n.t('plan_failed'), icon: 'none' });
    });
  },
  // 这一页的「保存修改」（编辑态）与结果页的「保存并发布」共用同一条发布链路：
  // saveCard → next1() → next2() → submit()，submit() 再按 editing 决定 createTown / updateTown
  // （见 pages/seller/publish/publish-flow.js）。校验规则一个字没改。
  saveCard: function () {
    this.next1();
    if (Object.keys(this.data.errors || {}).length) return;
    batchLocal.remember(this.data.batchLeft, this.data.batchPeople);
    this.next2();
  },
  // ---- 第 3 步：AI 润色与确认 ----
  submit: function () {
    const self = this;
    if (this.data.submitting) return;
    const f = this.data.form;
    const addressError = publishFlow.step1Errors(f).address;
    if (addressError) { wx.showToast({ title: addressError, icon: 'none' }); return; }
    const polished = '';   // 已取消 AI 润色：提交用户原文
    this.setData({ submitting: true });
    const editing = this.data.editing;
    publishFlow.saveTown(f, { editing: editing, townId: this.data.townId }).then(function () {
      // 2026-10-12：真正发布 / 保存成功才记本机（失败路径不写）——两个列表于是保持原顺序不动。
      wx.showToast({ title: i18n.t(publishFlow.toastKey(editing, true)), icon: 'none' });
      setTimeout(function () { wx.navigateBack({ delta: 1 }); }, 600);
    }).catch(function (error) {
      // 失败原因说给果农听：服务端拒绝时（哪一栏超了多少字）由 publish-flow 翻成对应语言的文案，
      // 认不出来的错误才退回原来那句通用文案（不空白、不崩）。
      self.setData({ submitting: false });
      wx.showToast({ title: publishFlow.failureMessage(error, editing), icon: 'none' });
    });
  }
});
