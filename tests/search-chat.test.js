'use strict';

// P16 搜索改版「与果灵对话」：多轮追问 + 证据约束回答 + 云端不可用时本地兜底。
// 客户端只把检索命中的四时素材作为证据发给 /api/chat；离线/失败降级走原
// finishSearch（离线检索），保证演示断网也不空屏。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const original = { wx: global.wx, Page: global.Page };

const tick = () => new Promise(resolve => setImmediate(resolve));

function memoryStorage() {
  const map = new Map();
  return {
    getStorageSync: key => (map.has(key) ? map.get(key) : ''),
    setStorageSync: (key, value) => { map.set(key, value); },
    removeStorageSync: key => { map.delete(key); }
  };
}

function buildPage() {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/packageMore/search/search.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  page.onLoad();
  return page;
}

function chatReply(content, answer, extra = {}) {
  // success 回调模拟 wx.request 的返回；记录请求体供断言。
  return options => {
    chatReply.last = options;
    options.success({ statusCode: 200, data: { answer, ...extra } });
  };
}

test.beforeEach(() => {
  global.wx = Object.assign(memoryStorage(), { showToast() {}, navigateTo() {}, switchTab() {}, showModal() {}, request() {} });
  store.exitDemo(); store.clearAll();
  // i18n 会缓存语言；每个用例都从「清空后的默认 zh」重新读一次，避免上一个用例的 en 泄漏过来。
  require('../miniprogram/lib/i18n').invalidateLang();
  chatReply.last = null;
});
test.after(() => { global.wx = original.wx; global.Page = original.Page; });

test('cloud reply becomes an elf bubble with evidence, jump chips and follow-ups', async () => {
  global.wx.request = chatReply(null, '西瓜七月最甜，挑纹路深、拍声闷的。', { usedEvidence: ['西瓜·四时素材'], followUps: ['西瓜怎么挑？'] });
  const page = buildPage();
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  const roles = page.data.messages.map(item => item.role);
  assert.deepEqual(roles, ['user', 'elf']);
  assert.equal(page.data.pending, false);
  const elf = page.data.messages[1];
  assert.match(elf.text, /七月最甜/);
  assert.deepEqual(elf.evidence, ['西瓜·四时素材']);
  assert.deepEqual(elf.followUps, ['西瓜怎么挑？']);
  assert.ok(elf.chips.length >= 1, 'the matched fruit offers a jump to 四时');
  assert.equal(elf.chips[0].name, '西瓜');
  assert.ok(!elf.local, 'a cloud answer is not tagged offline');
  const request = chatReply.last;
  assert.ok(request.url.endsWith('/api/chat'));
  assert.ok(request.header.Authorization.startsWith('Bearer '));
  assert.equal(request.data.question, '如何挑选西瓜');
  assert.ok(request.data.contexts.some(item => item.name.indexOf('西瓜') !== -1), 'retrieved material is attached as evidence');
  assert.ok(request.data.contexts[0].text.includes('【'), 'evidence keeps the dimension structure');
});

test('follow-up questions carry prior user turns as history (assistant answers are excluded)', async () => {
  const replies = ['李子更酸一些。', '杏子甜一点，熟透更香。'];
  let lastRequest = null;
  global.wx.request = options => {
    lastRequest = options;
    options.success({ statusCode: 200, data: { answer: replies.shift(), usedEvidence: [], followUps: [] } });
  };
  const page = buildPage();
  page.ask('李子和杏子哪个酸');
  await tick(); await tick();
  page.ask('那杏子呢');
  await tick(); await tick();
  assert.equal(page.data.messages.length, 4);
  const second = lastRequest;
  const roles = second.data.history.map(item => item.role);
  // 2026-10-01 fix: 服务端要求 assistant 消息必须是 JSON，客户端存的是纯文本，混进去会导致追问 502。
  assert.deepEqual(roles, ['user', 'user'], 'history only replays user questions');
  assert.ok(second.data.history[0].content.includes('李子和杏子哪个酸'));
  assert.ok(second.data.history[1].content.includes('那杏子呢'));
});

test('out-of-scope foreign fruit is refused locally without calling the model', async () => {
  let called = 0;
  global.wx.request = () => { called += 1; };
  const page = buildPage();
  page.ask('榴莲是什么季节的');
  await tick(); await tick();
  assert.equal(called, 0, 'no model call for out-of-scope topics');
  const elf = page.data.messages[1];
  assert.match(elf.text, /外来引进/);
  assert.match(elf.text, /荔枝/, 'native alternatives are suggested');
  assert.equal(elf.local, true);
  assert.equal(page.data.pending, false);
  // 2026-10-01 拒答指路：本土替代果做成可点的追问，不做死胡同。
  assert.ok(elf.followUps.length >= 1, 'refusal carries tappable alternatives');
  assert.ok((elf.followUps || []).every(item => item.length <= 4), 'alternatives are short fruit names');
});

test('cloud failure shows a clear error instead of silently fabricating an offline answer', async () => {
  global.wx.request = options => options.fail({ errMsg: 'request:fail timeout' });
  const page = buildPage();
  page.RETRY_DELAY_MS = 0;   // 关掉「等 2 秒再重试」的等待，保持这条用例的原有节奏
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.match(elf.text, /连接云端失败/, 'user is told the cloud connection failed');
  assert.equal(elf.local, true, 'error bubble is honestly tagged as local');
  assert.equal(page.data.pending, false);
});

test('questions matching nothing in the library stay honest instead of inventing', async () => {
  global.wx.request = () => { throw new Error('must not be called'); };
  const page = buildPage();
  page.RETRY_DELAY_MS = 0;   // 同上：这条走 seasonal 兜底，需要重试立刻发生
  page.ask('今天天气怎么样');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.equal(elf.local, true);
  assert.ok(elf.text.length > 6, 'an honest guidance message is shown');
  assert.equal(page.data.result, null, 'no fabricated answer card');
  // 2026-10-01 拒答指路：本地拒答也必须带可点的建议问法。
  assert.equal(elf.followUps.length, 2, 'local refusal carries guiding follow-ups');
});

test('recent questions and follow-up chips feed back into ask', async () => {
  global.wx.request = chatReply(null, '依据资料回答。', { followUps: ['荔枝什么时候熟？'] });
  const page = buildPage();
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  assert.ok(page.data.recent.includes('如何挑选西瓜'), 'the asked question enters recents');
  page.setData({ messages: page.data.messages, pending: false });
  const elf = page.data.messages[1];
  assert.ok(elf.followUps.length);
  global.wx.request = chatReply(null, '荔枝六七月成熟。');
  page.tapFollowUp({ currentTarget: { dataset: { word: elf.followUps[0] } } });
  await tick(); await tick();
  const last = page.data.messages[page.data.messages.length - 1];
  assert.match(last.text, /六月|七月/);
  assert.equal(page.data.messages[page.data.messages.length - 2].text, '荔枝什么时候熟？');
});

test('finishSearch keeps its legacy contract for offline callers', () => {
  const page = buildPage();
  page.finishSearch('如何挑选西瓜');
  assert.ok(page.data.result);
  assert.ok(page.data.answerBlocks.length >= 3);
  page.finishSearch('梅雨季节水果容易坏吗');
  assert.equal(page.data.result, null);
  assert.equal(page.data.empty, true);
});

test('chat history persists locally and is restored on next visit', async () => {
  global.wx.request = chatReply(null, '西瓜七月最甜。', { followUps: ['西瓜怎么挑？'] });
  const first = buildPage();
  first.ask('如何挑选西瓜');
  await tick(); await tick();
  const second = buildPage();
  assert.equal(second.data.messages.length, 2, 'conversation is restored from local storage on load');
  assert.equal(second.data.messages[1].text, '西瓜七月最甜。');
  assert.equal(second.data.messages[1].role, 'elf');
  // 恢复的追问建议仍可点击续聊，且历史作为上下文随下一次请求携带。
  const followUp = second.data.messages[1].followUps[0];
  global.wx.request = options => { chatReply.last = options; options.success({ statusCode: 200, data: { answer: '按纹路挑。', usedEvidence: [], followUps: [] } }); };
  second.tapFollowUp({ currentTarget: { dataset: { word: followUp } } });
  await tick(); await tick();
  assert.ok(chatReply.last.data.history.length >= 2, 'restored turns feed the multi-turn context');
});

test('clearChat wipes local history after confirmation', async () => {
  global.wx.request = chatReply(null, '回答。');
  const page = buildPage();
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  let confirmed = false;
  global.wx.showModal = options => { confirmed = true; options.success({ confirm: true }); };
  page.clearChat();
  assert.equal(confirmed, true);
  assert.equal(page.data.messages.length, 0);
  const fresh = buildPage();
  assert.equal(fresh.data.messages.length, 0, 'cleared history does not come back on next load');
});

test('elf answers no longer expose read-aloud controls', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageMore/search/search.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /read-btn|readAnswer/, '果灵回答的朗读按钮已删除');
  const page = buildPage();
  assert.equal(typeof page.readAnswer, 'undefined', '朗读处理函数已删除');
});

// —— 2026-10-01 RAG 别名映射改造（需求文档任务 1）：约 90 组现代别名→古籍果名 ——
// 数据来自用户人工审核的字典；替换法归一化 + 长词在前保证最长匹配。
{
  global.Page = () => {}; global.getCurrentPages = () => [];
  const search = require('../miniprogram/packageMore/search/search');
  const cases = [
    ['酸梅有什么讲究', '青梅'], ['桑椹是什么', '桑葚'], ['中国樱桃好吃吗', '樱桃'],
    ['芦橘是什么果', '枇杷'], ['水蜜桃怎么挑', '桃子'], ['三华李是什么', '李子'],
    ['妃子笑是什么品种', '荔枝'], ['桂圆补什么', '龙眼'], ['东魁杨梅呢', '杨梅'],
    ['磨盘柿呢', '柿子'], ['砀山梨怎么挑', '秋梨'], ['红枣补气血吗', '枣'],
    ['奇异果呢', '猕猴桃'], ['安石榴有什么故事', '石榴'], ['温州蜜柑呢', '瓯柑'],
    ['蜜柚呢', '柚子'], ['脆冬枣呢', '冬枣'], ['海枣呢', '椰枣'], ['伊拉克枣呢', '椰枣'],
    ['糖蔗呢', '甘蔗'], ['贵妃芒怎么挑', '芒果'], ['芭蕉是什么', '香蕉'],
    ['奶油草莓呢', '草莓'], ['莽吉柿呢', '山竹'], ['青柠檬呢', '柠檬'],
    ['热情果呢', '百香果'], ['红心火龙果呢', '火龙果'], ['椰青呢', '椰子'],
    ['阳光玫瑰怎么挑', '葡萄'], ['网纹瓜呢', '哈密瓜'], ['8424呢', '西瓜'],
    ['阿驵是什么', '无花果'], ['纽荷尔脐橙呢', '脐橙'], ['红富士呢', '苹果'],
    ['夏威夷木瓜呢', '木瓜'], ['五棱子呢', '杨桃'], ['阳桃呢', '杨桃']
  ];
  test('user-provided alias dictionary routes every alias to its canonical fruit', () => {
    for (const [question, want] of cases) {
      const got = search.matchFruits(question).map(hit => hit.fruit.name);
      assert.deepEqual(got, [want], question + ' → ' + got.join(','));
    }
  });
  test('longest alias match wins: 阳光玫瑰葡萄 still routes to 葡萄 once', () => {
    const got = search.matchFruits('阳光玫瑰葡萄怎么挑').map(hit => hit.fruit.name);
    assert.deepEqual(got, ['葡萄']);
  });
  // 单字被长名占用：问「冬枣」不重复命中「枣」，问「杨梅」不误命中青梅的根「梅」。
  test('single-char fruit roots are suppressed when a longer fruit name occupies them', () => {
    assert.deepEqual(search.matchFruits('冬枣呢').map(h => h.fruit.name), ['冬枣']);
    assert.deepEqual(search.matchFruits('椰枣呢').map(h => h.fruit.name), ['椰枣']);
    assert.deepEqual(search.matchFruits('杨梅呢').map(h => h.fruit.name), ['杨梅']);
    // 单字本体直接问仍然命中。
    assert.deepEqual(search.matchFruits('枣呢').map(h => h.fruit.name), ['枣']);
    assert.deepEqual(search.matchFruits('梅子什么时候熟').map(h => h.fruit.name), ['青梅']);
  });
  // 文化词保护：别名芭蕉→香蕉后，「芭蕉扇」这类文化词不误路由。
  test('cultural compounds with alias chars are not misrouted to fruits', () => {
    assert.equal(search.matchFruits('芭蕉扇是谁的宝物').length, 0);
    assert.equal(search.matchFruits('樱桃小丸子是谁').length, 0);
    assert.equal(search.matchFruits('核桃补脑吗').length, 0);
    assert.deepEqual(search.matchFruits('蜂蜜柚子茶怎么做').map(h => h.fruit.name), ['柚子']);
  });
}

// —— 第 3 阶段：切语言翻历史（甲方案）——
test('collectTranslationTasks + finalizeLang 驱动双语缓存，切回来读缓存不再翻', () => {
  const helpers = require('../miniprogram/packageMore/search/search');
  const long = '长'.repeat(1300);   // 1300 字 → 3 块（600/600/100）
  const messages = [
    { id: 'e0', role: 'elf', lang: 'zh', text: '苹果最甜。', textZh: '苹果最甜。', textEn: '', followUps: ['苹果怎么挑？'], followUpsZh: ['苹果怎么挑？'], followUpsEn: [] },
    { id: 'e1', role: 'elf', lang: 'zh', text: long, textZh: long, textEn: '', followUps: [], followUpsZh: [], followUpsEn: [] }
  ];
  const collected = helpers.collectTranslationTasks(messages, 'en');
  assert.equal(collected.blocks.length, 5, '最新在前：e1 长正文 3 块 + e0 正文 1 块 + e0 追问 1 块');
  assert.equal(collected.blocks[0].text, long.slice(0, 600));
  assert.ok(collected.tasks.every(t => t.count <= 3), '单条任务块数不超过 3');
  // 逐任务应用译文，再落 lang
  collected.tasks.forEach(t => {
    const items = collected.blocks.slice(t.start, t.start + t.count).map(b => 'EN:' + b.text);
    t.apply(items);
  });
  helpers.finalizeLang(messages, 'en');
  assert.equal(messages[1].lang, 'en');
  assert.equal(messages[0].lang, 'en');
  assert.equal(messages[0].text, 'EN:苹果最甜。');
  assert.equal(messages[0].followUps[0], 'EN:苹果怎么挑？');
  // 已全量缓存 → en 方向与 zh 方向都不再需要翻
  assert.equal(helpers.collectTranslationTasks(messages, 'en').blocks.length, 0);
  assert.equal(helpers.collectTranslationTasks(messages, 'zh').blocks.length, 0);
});

test('switching the app language translates saved history in place and persists the cache', async () => {
  const chatHistory = require('../miniprogram/packageMore/lib/chat-history');
  const i18n = require('../miniprogram/lib/i18n');
  store.saveSettings({ language: 'zh' });
  i18n.invalidateLang();
  chatHistory.save([
    { id: 'u1', role: 'user', text: '西瓜什么时候最甜' },
    { id: 'e1', role: 'elf', text: '西瓜七月最甜。', followUps: ['西瓜怎么挑？'] }
  ]);
  const page = buildPage();
  assert.equal(page.data.messages[1].text, '西瓜七月最甜。');

  let translateCall = null;
  global.wx.request = options => {
    if (String(options.url).endsWith('/api/translate')) {
      translateCall = options;
      options.success({ statusCode: 200, data: { translated: true, items: ['Watermelons are sweetest in July.', 'How to pick a watermelon?'] } });
    } else {
      options.success({ statusCode: 200, data: {} });
    }
  };
  store.saveSettings({ language: 'en' });
  i18n.invalidateLang();
  page.onShow();
  await tick(); await tick();

  assert.ok(translateCall, '切语言触发一次 /api/translate');
  assert.equal(translateCall.data.target, 'en');
  const elf = page.data.messages[1];
  assert.equal(elf.text, 'Watermelons are sweetest in July.');
  assert.equal(elf.lang, 'en');
  assert.equal(elf.textEn, 'Watermelons are sweetest in July.');
  assert.equal(elf.followUps[0], 'How to pick a watermelon?');
  assert.equal(elf.followUpsEn[0], 'How to pick a watermelon?');
  assert.equal(page.data.messages[0].text, '西瓜什么时候最甜', '用户自己的提问不翻');
  assert.equal(chatHistory.load()[1].text, 'Watermelons are sweetest in July.', '译文已落盘');
});

// —— 10.11 修复：英文下 6 条提示问法仍是中文 ——
test('the six suggested questions follow the app language instead of freezing at module load', () => {
  const i18n = require('../miniprogram/lib/i18n');
  store.saveSettings({ language: 'zh' });
  i18n.invalidateLang();
  const page = buildPage();
  assert.equal(page.data.suggestionsLeft.length, 6);
  assert.match(page.data.suggestionsLeft[0], /现在吃什么水果当季/);
  // 切到英文后 onShow 重算（旧写法在这里会一直是中文）
  store.saveSettings({ language: 'en' });
  i18n.invalidateLang();
  page.onShow();
  assert.equal(page.data.suggestionsLeft.length, 6);
  assert.match(page.data.suggestionsLeft[0], /What's in season right now/);
  assert.match(page.data.suggestionsLeft.join('|'), /How to pick a good watermelon/);
  // 真实故障场景：模块是中文时加载的，之后切英文再进页面（onLoad 决定初值）
  page.onLoad();
  assert.match(page.data.suggestionsLeft[0], /What's in season right now/);
});

// —— 10.11 修复：本地台词（不经过服务端的回答）也要跟着界面语言走 ——
// 起因：English 界面下问「你好」拿到中文问候（用户截图反馈）。
function useLang(code) {
  store.saveSettings({ language: code });
  require('../miniprogram/lib/i18n').invalidateLang();
}

test('English mode answers a Chinese greeting in English (local, no cloud call)', async () => {
  useLang('en');
  let called = 0;
  global.wx.request = () => { called += 1; };
  const page = buildPage();
  page.ask('你好');
  await tick(); await tick();
  assert.equal(called, 0, '本地问候不调云端');
  const elf = page.data.messages[1];
  assert.equal(elf.local, true);
  assert.match(elf.text, /Guoling/);
  assert.doesNotMatch(elf.text, /[\u4e00-\u9fa5]/, '英文模式下本地台词不出现中文');
});

test('Chinese mode still answers an English greeting in Chinese (unchanged)', async () => {
  const page = buildPage();
  page.ask('hello');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.match(elf.text, /你好呀/);
  assert.match(elf.text, /果灵/);
});

test('English mode refuses out-of-scope fruit in English', async () => {
  useLang('en');
  const page = buildPage();
  page.ask('榴莲是什么季节的');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.equal(elf.local, true);
  assert.match(elf.text, /introduced to China from abroad|farming culture outside China/);
  assert.doesNotMatch(elf.text, /不属于《四时》/);
});

test('English mode shows cloud failures in English only', async () => {
  useLang('en');
  global.wx.request = options => options.fail({ errMsg: 'cloud.callContainer:fail 102002' });
  const page = buildPage();
  page.RETRY_DELAY_MS = 0;
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.equal(elf.local, true);
  assert.match(elf.text, /^Cloud connection failed: /);
  assert.doesNotMatch(elf.text, /[\u4e00-\u9fa5]/, '不把中文 SDK 报错拼进英文句子');
});

test('English mode offline fallback is an honest English line, not the Chinese composed card', async () => {
  useLang('en');
  global.wx.request = options => options.fail({ errMsg: 'offline' });
  const page = buildPage();
  page.RETRY_DELAY_MS = 0;
  page.ask('今天天气怎么样');
  await tick(); await tick();
  const elf = page.data.messages[1];
  assert.equal(elf.local, true);
  assert.match(elf.text, /can't reach the cloud/);
  assert.doesNotMatch(elf.text, /[\u4e00-\u9fa5]/);
  assert.equal(elf.followUps.length, 2, '拒答仍指路');
  assert.match(elf.followUps[0], /What fruit is in season now\?/);
});

test('jump-pill label and fruit name follow the language, including for already-saved messages', () => {
  const chatHistory = require('../miniprogram/packageMore/lib/chat-history');
  // 中文时代存下来的老消息：按钮与果名都是中文
  chatHistory.save([{ id: 'e1', role: 'elf', text: '西瓜七月最甜。', chips: [{ fullId: 'summer-watermelon', name: '西瓜', seasonName: '夏', jumpLabel: '前往四时【西瓜】' }] }]);
  useLang('en');
  const page = buildPage();
  page.onShow();
  const chip = page.data.messages[0].chips[0];
  assert.match(chip.jumpLabel, /^Go to Four Seasons · /);
  assert.doesNotMatch(chip.jumpLabel, /前往四时/);
  assert.equal(chip.name, 'Watermelon');
  assert.equal(chatHistory.load()[0].chips[0].jumpLabel, chip.jumpLabel, '重算后的按钮文案已落盘');
});

// —— 10.11 修复：云端失败后等一会儿再重试（冷启动 callContainer 102002 请求超时）——
test('a failed call retries once after a delay instead of immediately', async () => {
  let calls = 0;
  global.wx.request = options => {
    calls += 1;
    if (calls === 1) options.fail({ errMsg: 'cloud.callContainer:fail 102002' });
    else options.success({ statusCode: 200, data: { answer: '西瓜七月最甜。', usedEvidence: [], followUps: [] } });
  };
  const page = buildPage();
  page.RETRY_DELAY_MS = 30;
  page.ask('如何挑选西瓜');
  await tick(); await tick();
  assert.equal(calls, 1, '第一次失败后不立刻重试');
  assert.equal(page.data.messages.length, 1, '等待期间还没有果灵气泡');
  await new Promise(resolve => setTimeout(resolve, 60));
  await tick(); await tick();
  assert.equal(calls, 2, '等一会儿之后重试一次');
  assert.equal(page.data.messages[1].text, '西瓜七月最甜。');
});
