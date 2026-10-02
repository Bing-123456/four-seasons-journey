'use strict';

// 问果灵答非所问修复（评审 9.28-29，最重要问题）：四层通用防线单测。
//   1) 服务端提示词：能答（哪怕角度不同/只覆盖一部分）→ 先答问点；完全无关 → 干净拒答；
//   2) 服务端答点守卫：回答既不覆盖问点词、又不是诚实拒答 → 带纠正指令重答一次，
//      仍不合格则替换为诚实拒答模板（宁可拒答，不输出答非所问）；
//   3) 服务端拒答复核（9.29）：拒答稿一律再核对一次——能答则答（防假拒答）、
//      补充逐句核对（防拒答格式里编造资料没有的内容，如「李子为什么酸→有机酸」教训）；
//   4) 客户端相关性排序：与问点相关的资料分块排在上下文前面，1800 字截断只吃无关尾巴。
// 守卫全部基于词法通用规则，禁止出现具体水果/问题的特判（防过拟合红线）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createChatService, focusTermsOf, answerAddresses, isHonestRefusal, refusalFallback } = require('../server/chat');

const BASE_CONFIG = { provider: 'openai-compatible', model: 'qwen-plus', providerBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', providerKey: 'sk-test', timeoutMs: 5000 };
function chatPayload(answer) { return { choices: [{ message: { content: JSON.stringify({ answer, usedEvidence: [], followUps: [] }) } }] }; }

test('focus terms drop function characters and keep two-char content pairs', () => {
  // 2026-10-01 修复：外圈 28 种果名（杏等）漏收进排除集，「杏子」曾被误当问点词。
  // 修复后杏是水果主题词，问「那杏子呢」没有问点词，由宽松层单字核心词兜底。
  assert.deepEqual(focusTermsOf('那杏子呢'), []);
  assert.ok(focusTermsOf('凤梨酥馅为啥要掺冬瓜').includes('冬瓜'));
  assert.deepEqual(focusTermsOf('吗'), []);
});

test('an answer passes when it covers a focus term or states an honest refusal', () => {
  assert.equal(answerAddresses('凤梨酥馅为啥要掺冬瓜', '冬瓜蓉能降低成本又定型，是百年传统做法。'), true);
  assert.equal(answerAddresses('凤梨酥馅为啥要掺冬瓜', '菠萝原产南美，明代传入华南。'), false);
  assert.equal(isHonestRefusal('素材库里没有这题的直接答案。'), true);
  assert.equal(isHonestRefusal('菠萝原产南美。'), false);
  // 守卫门槛 = 覆盖问点词 或 诚实拒答（与 server/chat.js acceptableAnswer 同语义）。
  const refusal = '素材库里没有这道题的直接答案，给你最相关的时令内容。';
  assert.equal(isHonestRefusal(refusal) || answerAddresses('凤梨酥馅为啥要掺冬瓜', refusal), true, '诚实拒答通过守卫');
});

test('the refusal fallback quotes the question instead of inventing content', () => {
  const text = refusalFallback('凤梨酥馅为啥要掺冬瓜');
  assert.match(text, /素材库里没有/);
  assert.match(text, /凤梨酥馅为啥要掺冬瓜/);
  assert.match(text, /不能瞎编/);
});

test('off-topic first draft triggers one corrective retry; an on-topic retry is returned', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(JSON.parse(options.body));
    const answer = calls.length === 1
      ? '菠萝原产南美，明代经海上传入华南，闽南话里叫旺来。' // 答非所问：不含「冬瓜」也不是拒答
      : '冬瓜蓉能让凤梨馅不散、成型好，又压低成本，是台式凤梨酥的常见做法。';
    return { ok: true, json: async () => chatPayload(answer), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【食养习俗】凤梨酥取旺来口彩。' }] });
  assert.equal(calls.length, 2, '守卫触发一次重答');
  const corrective = calls[1].messages[calls[1].messages.length - 1];
  assert.equal(corrective.role, 'user');
  assert.match(corrective.content, /素材库里没有/, '纠正指令同样要求先答问点或诚实拒答');
  assert.match(result.answer, /冬瓜蓉/);
  assert.equal(result.guarded, true);
});

test('both drafts off-topic fall back to the honest refusal, never to off-topic content', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(1);
    return { ok: true, json: async () => chatPayload('菠萝喜欢温暖的气候，全年都可以吃到。'), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【拓展科普】菠萝喜温。' }] });
  assert.equal(calls.length, 2);
  // 2026-10-01 需求文档情况 B：果在库里但缺该知识点，兜底改为指路模板（同为诚实拒答族）。
  assert.match(result.answer, /素材库里没有|暂未收录您询问/);
  assert.deepEqual(result.usedEvidence, []);
  assert.equal(result.guarded, true);
});

// 拒答也要指路（2026-10-01 用户反馈）：拒答稿必须带 followUps，模型没给就服务端兜底。
test('every maintained refusal carries guiding follow-ups instead of a dead end', async () => {
  const chat = createChatService(BASE_CONFIG, async () => {
    return { ok: true, json: async () => chatPayload('素材库里没有「凤梨酥馅为啥要掺冬瓜」的直接答案，不敢瞎编。'), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【拓展科普】菠萝喜温。' }] });
  assert.match(result.answer, /素材库里没有/, '拒答被维持（复核仍拒）');
  assert.equal(result.followUps.length, 2, '拒答稿带两条建议问法');
  assert.ok(result.followUps.every(item => item.length > 3 && item.length <= 18), '建议问法短句可点');
});

test('an on-topic first draft costs exactly one model call', async () => {
  let calls = 0;
  const direct = createChatService(BASE_CONFIG, async () => {
    calls += 1;
    return { ok: true, json: async () => chatPayload('冬瓜蓉能让凤梨馅不散、成型好，是常见做法。'), body: { cancel: async () => {} } };
  });
  const result = await direct.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【拓展科普】菠萝。' }] });
  assert.equal(calls, 1, '直答一稿通过');
  assert.equal(result.guarded, undefined);
});

// —— 拒答复核（9.29 假拒答修复）：拒答稿一律再核对一次 ——
test('a false refusal is corrected by the verification retry', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(JSON.parse(options.body));
    const answer = calls.length === 1
      ? '素材库里没有「凤梨酥馅为啥要掺冬瓜」的直接答案。' // 假拒答：资料明明能答
      : '冬瓜蓉能让凤梨馅不散、成型好，又压低成本，是台式凤梨酥的常见做法。';
    return { ok: true, json: async () => chatPayload(answer), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【食养习俗】凤梨酥馅掺冬瓜蓉，成型好又实惠。' }] });
  assert.equal(calls.length, 2, '拒答触发一次复核');
  const verify = calls[1].messages[calls[1].messages.length - 1];
  assert.equal(verify.role, 'user');
  assert.match(verify.content, /逐条核对|直接回答，不要拒答/, '复核指令要求能答则答');
  assert.match(verify.content, /资料原文|一律删掉/, '复核指令要求补充逐句来自资料');
  assert.match(result.answer, /冬瓜蓉/);
  assert.equal(result.guarded, true);
});

test('a true refusal is verified twice and then kept as the refusal', async () => {
  let calls = 0;
  const chat = createChatService(BASE_CONFIG, async () => {
    calls += 1;
    return { ok: true, json: async () => chatPayload('素材库里没有这道题的直接答案，资料里只写了菠萝的时令。'), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【时令】菠萝夏天常见。' }] });
  assert.equal(calls, 2, '真拒答：复核后维持');
  assert.match(result.answer, /素材库里没有/);
  assert.equal(result.guarded, true);
});

test('a verification failure keeps the first refusal instead of erroring', async () => {
  let calls = 0;
  const chat = createChatService(BASE_CONFIG, async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => chatPayload('素材库里没有这题的直接答案。'), body: { cancel: async () => {} } };
    throw new Error('network down');
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【拓展科普】菠萝。' }] });
  assert.match(result.answer, /素材库里没有|暂未收录您询问/);
  assert.equal(result.guarded, true);
});

test('a refocus retry that turns into a refusal still goes through verification', async () => {
  const answers = [
    '菠萝原产南美，明代传入华南。',                       // 一稿答非所问
    '素材库里没有这道题的直接答案。',                      // 纠正重答转成拒答（假拒答）
    '冬瓜蓉能让凤梨馅不散、成型好，是台式凤梨酥的常见做法。' // 复核改直答
  ];
  let calls = 0;
  const chat = createChatService(BASE_CONFIG, async () => {
    const answer = answers[Math.min(calls, answers.length - 1)]; calls += 1;
    return { ok: true, json: async () => chatPayload(answer), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【食养习俗】馅掺冬瓜蓉。' }] });
  assert.equal(calls, 3);
  assert.match(result.answer, /冬瓜蓉/);
  assert.equal(result.guarded, true);
});

test('a corrective retry failure degrades to refusal instead of surfacing an error', async () => {
  let calls = 0;
  const chat = createChatService(BASE_CONFIG, async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => chatPayload('菠萝好厉害。'), body: { cancel: async () => {} } };
    throw new Error('network down');
  });
  const result = await chat.answer({ question: '凤梨酥馅为啥要掺冬瓜', history: [], contexts: [{ name: '菠萝·四时素材', text: '【拓展科普】菠萝。' }] });
  assert.match(result.answer, /素材库里没有|暂未收录您询问/);
});

// —— 客户端：与问点相关的分块排前，截断保住相关内容 ——
const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8');
test('the client orders evidence sections by question relevance before truncation', () => {
  const markup = read('miniprogram/pages/search/search.js');
  assert.match(markup, /function buildContexts\(fruits, question\)/, 'buildContexts 接收问点');
  assert.match(markup, /relevanceScore\(question/, '分块按问点词重合数排序');
  global.wx = global.wx || { getStorageSync: () => undefined, setStorageSync: () => {}, showToast: () => {}, request: () => {} };
  global.Page = global.Page || (() => {});
  delete require.cache[require.resolve('../miniprogram/pages/search/search')];
  const search = require('../miniprogram/pages/search/search');
  const fruits = search.matchFruits('菠萝');
  assert.ok(fruits.length >= 1, '问题里的水果仍能命中');
  const contexts = search.buildContexts(fruits, '菠萝和凤梨是什么关系');
  assert.ok(contexts.length >= 1);
  assert.ok(contexts[0].text.length > 0);
  // 相关性分值：含问点词的分块 ≥ 不含的分块。
  const scored = ['菠萝与凤梨在闽台被分开叫。', '西瓜在夏日正午最忙。'];
  assert.ok(search.relevanceScore('菠萝和凤梨是什么关系', scored[0]) > search.relevanceScore('菠萝和凤梨是什么关系', scored[1]));
});
