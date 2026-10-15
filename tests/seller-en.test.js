'use strict';
// 「果农工作台」这条线的 English 接线（pages/seller/index + pages/seller/publish）：
//   ① English 模式下这条线不出现汉字、也不出现全角标点（：（）「」·）；
//   ② 中文模式逐字不变（含 statusText 仍是「已发布 / 已下架」、体验标签仍是中文）；
//   ③ 数据驱动的中文（节气 / 水果 / 体验标签 / 状态）按语言取词，**存档值保持中文**。
// 判定口径与 tests/discover-en.test.js 一致：真加载页面、内存 storage、wx.request 桩。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HAN = /[\u4e00-\u9fa5]/;
// 中文全角标点：模板里一个都不许留。
const CJK_PUNCT = /[：（）「」·]/;
// 渲染出来的英文串里不许有全角冒号/括号/引号；间隔号 U+00B7 是项目英文文案一贯用的分隔符（指令允许保留）。
const CJK_MARKS = /[：（）「」]/;

const SELLER_JS = path.resolve(__dirname, '../miniprogram/pages/seller/index.js');
const PUBLISH_JS = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.js');
const SELLER_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/index.wxml');
const PUBLISH_WXML = path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.wxml');

let storage = new Map();
let calls = {};

const MY_TOWNS = [
  { id: 'town-mine', name: '洛川王大爷苹果园', term: '秋分', fruit: '苹果', province: '陕西', city: '延安市', county: '洛川县', description: '三代种苹果', polishedDescription: '', experiences: ['采摘', '观光'], transport: '自驾约20分钟', contact: '', wechat: '', phone: '', location: { latitude: 35.76, longitude: 109.43 }, published: true },
  // 第二个果乡：已下架 + 节气/水果全空 + 一个词典里没有的体验标签（不许被抹掉、也不许乱编）
  { id: 'town-off', name: '老果园', term: '', fruit: '', province: '', city: '', county: '', description: '', polishedDescription: '', experiences: ['采摘', '本地新玩法'], transport: '', contact: '', wechat: '', phone: '', location: null, published: false }
];

function resetCalls() {
  calls = { navigation: [], toasts: [], modals: [], requests: [], titles: [] };
}

// 与 tests/seller-page.test.js 同一套桩：读页面 data、跑真实 onShow / onLoad。
global.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: key => storage.delete(key),
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
          : url.includes('/api/farmtown/unpublish') ? { town: Object.assign({}, MY_TOWNS[0], { published: false }) }
            : { error: 'not found' };
    if (opts.success) opts.success({ statusCode: 200, data: data });
  }
};

const originalPage = global.Page;
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const termNameEn = require('../miniprogram/lib/term-name-en');
const fruitNameEn = require('../miniprogram/lib/fruit-name-en');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

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

// ---- 本次接线涉及的键：新增 + 复用（复用键的中文侧一个字都没改）----
const NEW_KEYS = [
  'sl_publish_new', 'sl_date_colon', 'sl_open_date_colon', 'sl_open_time_colon', 'sl_transport_colon',
  'sl_wechat_colon', 'sl_phone_colon', 'sl_none', 'sl_status_on', 'sl_status_off',
  'sl_unpublish_title', 'sl_unpublish_body', 'sl_unpublish_failed',
  'sl_exp_pick', 'sl_exp_sightseeing', 'sl_exp_craft', 'sl_exp_food', 'sl_exp_culture',
  'pub_nav_title', 'pub_step_title', 'pub_name_ph', 'pub_region_ph', 'pub_fruit_ph', 'pub_desc_ph',
  'pub_wechat_ph', 'pub_phone_ph', 'pub_prev',
  'pub_err_town_missing', 'pub_err_load_failed', 'pub_err_name', 'pub_err_region', 'pub_err_fruit',
  'pub_err_address', 'pub_err_open_date', 'pub_err_open_time', 'pub_err_close_date', 'pub_err_close_time',
  'pub_err_location_invalid', 'pub_toast_location_set', 'pub_err_exp_max', 'pub_err_exp_required',
  'pub_err_desc', 'pub_toast_saved', 'pub_toast_published', 'pub_toast_save_failed', 'pub_toast_publish_failed'
];
const REUSED_KEYS = [
  'sl_title', 'sl_mine', 'sl_edit', 'sl_unpublish', 'sl_empty', 'sl_region', 'sl_address', 'sl_open_date',
  'sl_open_time', 'sl_date', 'sl_transport', 'sl_intro', 'sl_more', 'sl_less', 'sl_back_tourist',
  'sl_waking', 'sl_retry', 'loading', 'rt_load_failed',
  'pub_name', 'pub_region', 'pub_address', 'pub_address_ph', 'pub_fruit', 'pub_date_window', 'pub_open_date',
  'pub_open_time', 'pub_close_date', 'pub_close_time', 'pub_next', 'pub_experience', 'pub_wechat', 'pub_phone',
  'pub_submit', 'pub_save_edit'
];
const ALL_KEYS = NEW_KEYS.concat(REUSED_KEYS);

// 新增键的中文侧必须是改动前的原字面（「中文模式逐字不变」）。
const ZH_VERBATIM = {
  sl_publish_new: '＋ 发布我的果乡名片',
  sl_date_colon: '可去的日期：',
  sl_open_date_colon: '开关门日期：',
  sl_open_time_colon: '开关门时间：',
  sl_transport_colon: '交通指引：',
  sl_wechat_colon: '微信号：',
  sl_phone_colon: '手机号：',
  sl_none: '无',
  sl_status_on: '已发布',
  sl_status_off: '已下架',
  sl_unpublish_title: '下架果乡名片',
  sl_unpublish_body: '下架后游客在地图上将看不到它，确定吗？',
  sl_unpublish_failed: '下架失败',
  sl_exp_pick: '采摘',
  sl_exp_sightseeing: '观光',
  sl_exp_craft: '手作',
  sl_exp_food: '餐饮',
  sl_exp_culture: '文化讲解',
  pub_nav_title: '发布果乡名片',
  pub_step_title: '果园活动方案（{{step}}/2）',
  pub_name_ph: '如：洛川王大爷苹果园',
  pub_region_ph: '请选择',
  pub_fruit_ph: '如：苹果',
  pub_desc_ph: '讲讲你的果园和故事…',
  pub_wechat_ph: '微信号',
  pub_phone_ph: '手机号',
  pub_prev: '← 上一步',
  pub_err_town_missing: '果乡不存在或已下架',
  pub_err_load_failed: '加载失败，请重试',
  pub_err_name: '请填写果乡名称',
  pub_err_region: '请选择所在地区',
  pub_err_fruit: '请填写当季水果',
  pub_err_address: '请填写具体位置',
  pub_err_open_date: '请选择开门日期',
  pub_err_open_time: '请选择开门时间',
  pub_err_close_date: '请选择关门日期',
  pub_err_close_time: '请选择关门时间',
  pub_err_location_invalid: '位置无效，请重选',
  pub_toast_location_set: '已选择位置',
  pub_err_exp_max: '最多选 5 个',
  pub_err_exp_required: '请至少选择一个体验标签',
  pub_err_desc: '请填写果乡介绍',
  pub_toast_saved: '保存成功',
  pub_toast_published: '发布成功',
  pub_toast_save_failed: '保存失败',
  pub_toast_publish_failed: '发布失败'
};

test.beforeEach(() => {
  storage = new Map();
  resetCalls();
  store.exitDemo();
  store.clearAll();
  useLang('zh');
});
test.after(() => { global.Page = originalPage; });

// ---- ① 键本身 ----

test('every key touched by this wiring is a [中文, English] pair with both sides filled', () => {
  ALL_KEYS.forEach(key => {
    const entry = i18n.dict[key];
    assert.ok(Array.isArray(entry), key + ' 要是数组');
    assert.equal(entry.length, 2, key + ' 必须是两元素数组');
    assert.ok(typeof entry[0] === 'string' && entry[0].length > 0, key + ' 中文侧不许为空');
    assert.ok(typeof entry[1] === 'string' && entry[1].length > 0, key + ' 英文侧不许为空');
  });
});

test('new keys keep their original Chinese text verbatim', () => {
  Object.keys(ZH_VERBATIM).forEach(key => {
    assert.equal(i18n.dict[key][0], ZH_VERBATIM[key], key + ' 的中文侧必须与改动前逐字一致');
  });
  assert.equal(Object.keys(ZH_VERBATIM).length, NEW_KEYS.length, '新增键清单与逐字表要对齐');
});

test('Chinese and English sides use the same number of {{placeholder}} slots', () => {
  ALL_KEYS.forEach(key => {
    const slots = side => (i18n.dict[key][side].match(/\{\{[\w.]+\}\}/g) || []).sort().join(',');
    assert.equal(slots(1), slots(0), key + ' 的中英占位符必须一致');
  });
});

test('English texts contain no Chinese characters, Chinese texts still do not leak into en', () => {
  useLang('en');
  ALL_KEYS.forEach(key => {
    assert.doesNotMatch(i18n.dict[key][1], HAN, key + ' 的英文侧含汉字');
    assert.doesNotMatch(i18n.t(key), HAN, 'en 模式下 t(' + key + ') 含汉字');
  });
  useLang('zh');
  NEW_KEYS.forEach(key => {
    assert.equal(i18n.t(key), ZH_VERBATIM[key], 'zh 模式下 t(' + key + ') 必须逐字不变');
  });
});

// ---- ② 工作台首页（pages/seller/index）----

test('English: the workbench card is fully English (term/fruit line, chips, status, modal, toast)', async () => {
  useLang('en');
  const subject = loadPage(SELLER_JS);
  subject.onShow();
  await wait();

  assert.equal(calls.titles.at(-1), 'Farmer Studio', '导航栏标题走 applyNav(sl_title)');
  const mine = subject.data.myTowns[0];
  assert.equal(mine.metaLine, 'Qiufen · Apple', '节气 + 水果按语言取词');
  assert.deepEqual(mine.experienceList, ['Picking', 'Sightseeing']);
  assert.equal(mine.statusText, 'Published');
  const off = subject.data.myTowns[1];
  assert.equal(off.statusText, 'Unpublished');
  assert.equal(off.metaLine, ' · ', '两个字段都空时与中文模式的拼法一致');
  assert.deepEqual(off.experienceList, ['Picking', '本地新玩法'], '词典里没有的标签原样保留，不许抹掉或乱编');

  const shown = [mine.metaLine, mine.statusText, off.statusText].concat(mine.experienceList).join('|');
  assert.doesNotMatch(shown, HAN);
  assert.doesNotMatch(shown, CJK_MARKS, '英文侧不许出现全角标点');
  assert.match(mine.metaLine, / · /, '分隔符沿用 U+00B7 间隔号（通用符号，指令允许保留）');

  Object.values(subject.data.L).forEach(text => assert.doesNotMatch(text, HAN, '模板字典含汉字：' + text));
  assert.equal(subject.data.L.sl_date_colon, 'Date: ');

  subject.unpublishTown({ currentTarget: { dataset: { id: 'town-mine' } } });
  await wait();
  const modal = calls.modals.at(-1);
  assert.equal(modal.title, 'Unpublish this card');
  assert.doesNotMatch(modal.content, HAN);
  assert.doesNotMatch(calls.toasts.at(-1).title, HAN, '下架 toast 也要英文');
});

test('Chinese: the workbench renders exactly the old strings (statusText 已发布/已下架 included)', async () => {
  useLang('zh');
  const subject = loadPage(SELLER_JS);
  subject.onShow();
  await wait();

  assert.equal(calls.titles.at(-1), '果农工作台');
  const mine = subject.data.myTowns[0];
  assert.equal(mine.metaLine, '秋分 · 苹果', '中文模式的节气 + 水果行逐字不变');
  assert.deepEqual(mine.experienceList, ['采摘', '观光']);
  assert.equal(mine.statusText, '已发布');
  assert.equal(subject.data.myTowns[1].statusText, '已下架');
  assert.equal(subject.data.L.sl_date_colon, '可去的日期：');
  assert.equal(subject.data.L.sl_publish_new, '＋ 发布我的果乡名片');
  assert.equal(subject.data.L.sl_none, '无');

  subject.unpublishTown({ currentTarget: { dataset: { id: 'town-mine' } } });
  await wait();
  assert.equal(calls.modals.at(-1).title, '下架果乡名片');
  assert.equal(calls.modals.at(-1).content, '下架后游客在地图上将看不到它，确定吗？');
  assert.match(calls.toasts.at(-1).title, /已下架/);
});

test('term/fruit/status helpers agree with the shared name tables in both languages', () => {
  useLang('zh');
  assert.equal(termNameEn.termEn('秋分', 'zh'), '秋分');
  assert.equal(fruitNameEn.nameEn('苹果'), '苹果');
  useLang('en');
  assert.equal(termNameEn.termEn('秋分', 'en'), 'Qiufen');
  assert.equal(fruitNameEn.nameEn('苹果'), 'Apple');
  assert.doesNotMatch(i18n.t('sl_status_on') + i18n.t('sl_status_off'), HAN);
});

// ---- ③ 发布向导（pages/seller/publish）----

test('English: the publish wizard shows English labels, placeholders, errors and options', async () => {
  useLang('en');
  const subject = loadPage(PUBLISH_JS);
  subject.onLoad();

  assert.equal(calls.titles.at(-1), 'Orchard activity plan', '导航栏标题走 applyNav(sl_plan_entry)');
  assert.equal(subject.data.stepTitle, 'Orchard activity plan (1/2)');
  assert.deepEqual(subject.data.experiences, [
    { value: '采摘', label: 'Picking' },
    { value: '观光', label: 'Sightseeing' },
    { value: '手作', label: 'Handicraft' },
    { value: '餐饮', label: 'Dining' },
    { value: '文化讲解', label: 'Culture talk' }
  ], '显示名英文，存档值仍是中文');
  Object.values(subject.data.L).forEach(text => assert.doesNotMatch(text, HAN, '模板字典含汉字：' + text));
  assert.equal(subject.data.L.pub_region_ph, 'Select');

  subject.next1();
  assert.equal(subject.data.step, 1);
  assert.equal(subject.data.errors.name, 'Enter the orchard name');
  assert.equal(calls.toasts.at(-1).title, 'Enter the orchard name');
  Object.values(subject.data.errors).forEach(text => assert.doesNotMatch(text, HAN));

  // 选中：wxml 传的是中文 value，存档与选中态只认中文值
  subject.toggleExp({ currentTarget: { dataset: { exp: '采摘' } } });
  subject.toggleExp({ currentTarget: { dataset: { exp: '观光' } } });
  assert.deepEqual(subject.data.form.experiences, ['采摘', '观光']);
  assert.equal(subject.data.expSelected['采摘'], true);
  assert.equal(subject.data.expSelected['观光'], true);
  const publishWxml = fs.readFileSync(PUBLISH_WXML, 'utf8');
  assert.match(publishWxml, /data-exp="\{\{item\.value\}\}"/, 'wxml 必须把中文 value 传给 toggleExp');
  assert.match(publishWxml, /expSelected\[item\.value\]/);
  assert.match(publishWxml, /\{\{item\.label\}\}/, '显示名走 label');

  subject.setData({
    form: Object.assign({}, subject.data.form, {
      name: 'Wang orchard', province: 'Shaanxi', city: 'Yan’an', county: 'Luochuan', fruit: 'Apple',
      address: 'No.8 Fengqi Road', openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00'
    })
  });
  subject.next1();
  assert.equal(subject.data.step, 2);
  assert.equal(subject.data.stepTitle, 'Orchard activity plan (2/2)');
  subject.back({ currentTarget: { dataset: { step: 1 } } });
  assert.equal(subject.data.stepTitle, 'Orchard activity plan (1/2)');
});

test('Chinese: the publish wizard strings are byte-identical to before', () => {
  useLang('zh');
  const subject = loadPage(PUBLISH_JS);
  subject.onLoad();

  assert.equal(calls.titles.at(-1), '果园活动方案');
  assert.equal(subject.data.stepTitle, '果园活动方案（1/2）');
  assert.deepEqual(subject.data.experiences.map(o => o.label), ['采摘', '观光', '手作', '餐饮', '文化讲解']);
  assert.deepEqual(subject.data.experiences.map(o => o.value), ['采摘', '观光', '手作', '餐饮', '文化讲解']);
  assert.equal(subject.data.L.pub_name_ph, '如：洛川王大爷苹果园');
  assert.equal(subject.data.L.pub_region_ph, '请选择');
  assert.equal(subject.data.L.pub_fruit_ph, '如：苹果');
  assert.equal(subject.data.L.pub_desc_ph, '讲讲你的果园和故事…');
  assert.equal(subject.data.L.pub_wechat_ph, '微信号');
  assert.equal(subject.data.L.pub_phone_ph, '手机号');
  assert.equal(subject.data.L.pub_prev, '← 上一步');

  subject.next1();
  assert.equal(subject.data.errors.name, '请填写果乡名称');
  assert.equal(subject.data.errors.region, '请选择所在地区');
  assert.equal(subject.data.errors.address, '请填写具体位置');
  assert.equal(calls.toasts.at(-1).title, '请填写果乡名称');

  subject.setData({
    form: Object.assign({}, subject.data.form, {
      name: '洛川苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
      address: '凤栖镇××路8号', openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00'
    })
  });
  subject.next1();
  assert.equal(subject.data.step, 2);
  assert.equal(subject.data.stepTitle, '果园活动方案（2/2）');
  subject.back({ currentTarget: { dataset: { step: 1 } } });
  assert.equal(subject.data.stepTitle, '果园活动方案（1/2）');
});

test('Chinese: the publish wizard still saves the Chinese experience values through submit', async () => {
  useLang('zh');
  const subject = loadPage(PUBLISH_JS);
  subject.onLoad();
  subject.setData({
    form: Object.assign({}, subject.data.form, {
      name: '洛川苹果园', province: '陕西', city: '延安市', county: '洛川县', fruit: '苹果',
      address: '凤栖镇××路8号', openDate: '2026-06-21', openTime: '09:00', closeDate: '2026-06-25', closeTime: '17:00',
      experiences: ['采摘'], description: '三代人种苹果。'
    })
  });
  subject.next1();
  subject.submit();
  await wait();
  assert.ok(calls.requests.some(url => url.includes('/api/farmtown/create')));
  assert.match(calls.toasts.at(-1).title, /发布成功/);
});

// ---- ④ 源码守卫 ----

test('the two templates keep no bare Chinese except the brand glyph 乡', () => {
  [SELLER_WXML, PUBLISH_WXML].forEach(file => {
    const hits = [];
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (HAN.test(line) && !/aria-hidden="true">乡</.test(line)) hits.push((index + 1) + ': ' + line.trim());
    });
    assert.deepEqual(hits, [], path.basename(file) + ' 里还有裸中文：\n' + hits.join('\n'));
  });
});

test('the two templates keep no full-width Chinese punctuation', () => {
  [SELLER_WXML, PUBLISH_WXML].forEach(file => {
    const hits = [];
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (CJK_PUNCT.test(line)) hits.push((index + 1) + ': ' + line.trim());
    });
    assert.deepEqual(hits, [], path.basename(file) + ' 里还有全角标点：\n' + hits.join('\n'));
  });
});

test('the brand glyph 乡 is still there and the page json files were left alone', () => {
  assert.match(fs.readFileSync(SELLER_WXML, 'utf8'), /<view class="mark serif" aria-hidden="true">乡<\/view>/, '品牌字形必须保留');
  const sellerJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/seller/index.json'), 'utf8'));
  const publishJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/seller/publish/publish.json'), 'utf8'));
  assert.equal(sellerJson.navigationBarTitleText, '果农工作台', 'json 不许改，标题靠页面 applyNav 覆盖');
  assert.equal(publishJson.navigationBarTitleText, '果园活动方案', 'json 与 applyNav 同步为设计图上的标题');
});

test('both pages set their navigation title through i18n.applyNav', () => {
  assert.match(fs.readFileSync(SELLER_JS, 'utf8'), /i18n\.applyNav\('sl_title'\)/);
  assert.match(fs.readFileSync(PUBLISH_JS, 'utf8'), /i18n\.applyNav\('sl_plan_entry'\)/);
});

test('every {{L.key}} used in a template exists in the dict and in that page\u2019s labels() list', () => {
  [{ wxml: SELLER_WXML, js: SELLER_JS }, { wxml: PUBLISH_WXML, js: PUBLISH_JS }].forEach(pair => {
    const src = fs.readFileSync(pair.wxml, 'utf8');
    const jsSrc = fs.readFileSync(pair.js, 'utf8');
    const keys = Array.from(new Set(Array.from(src.matchAll(/L\.([A-Za-z0-9_]+)/g)).map(m => m[1])));
    assert.ok(keys.length > 0, path.basename(pair.wxml) + ' 应该用模板字典');
    keys.forEach(key => {
      assert.ok(i18n.dict[key], '词典里缺 ' + key);
      assert.ok(jsSrc.includes("'" + key + "'"), path.basename(pair.js) + ' 的 labels([...]) 里缺 ' + key);
    });
  });
});
