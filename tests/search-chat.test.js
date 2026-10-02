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
  const file = path.resolve(__dirname, '../miniprogram/pages/search/search.js');
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

test('elf answers expose read-aloud controls wired to the reader', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/search/search.wxml'), 'utf8');
  assert.match(wxml, /read-btn" data-id="\{\{item.id\}\}" bindtap="readAnswer"/, '每条果灵回答挂朗读按钮');
  const page = buildPage();
  page.setData({ messages: [{ id: 'mx', role: 'elf', text: '西瓜七月最甜。' }] });
  let toasted = null;
  global.wx.showToast = options => { toasted = options.title; };
  page.readAnswer({ currentTarget: { dataset: { id: 'mx' } } });
  assert.equal(page.data.readingId, 'mx', '点按后锁定该条为朗读目标');
  page.readAnswer({ currentTarget: { dataset: { id: 'mx' } } });
  assert.equal(page.data.reading, false, '再点同一条即停止');
  page.readAnswer({ currentTarget: { dataset: { id: '不存在' } } });
  assert.equal(page.data.readingId, 'mx', '未知 id 不改变当前状态');
});

// —— 2026-10-01 RAG 别名映射改造（需求文档任务 1）：约 90 组现代别名→古籍果名 ——
// 数据来自用户人工审核的字典；替换法归一化 + 长词在前保证最长匹配。
{
  global.Page = () => {}; global.getCurrentPages = () => [];
  const search = require('../miniprogram/pages/search/search');
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
