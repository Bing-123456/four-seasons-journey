'use strict';

// /api/chat 果灵对话服务：证据约束 + 多轮追问。
// 约束与 /api/ask 同源——模型只允许依据传入资料回答、标注引用、资料不足如实说；
// 这里验证输入清洗、消息组装、模型输出解析与错误降级。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatService, validateBody, buildMessages, parseAnswer } = require('../server/chat');

const BASE_CONFIG = { provider: 'openai-compatible', model: 'qwen-plus', providerBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', providerKey: 'sk-test', timeoutMs: 5000 };

function chatPayload(content) {
  return { choices: [{ message: { content } }] };
}

test('answer returns the grounded reply with evidence and follow-ups', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => chatPayload(JSON.stringify({ answer: '西瓜在七月最甜，挑纹路深、拍声闷的。', usedEvidence: ['西瓜·四时素材', '农谚集'], followUps: ['西瓜怎么挑？', '无籽西瓜是转基因吗'] })), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({ question: '西瓜什么时候最甜', history: [], contexts: [{ name: '西瓜·四时素材', text: '【农谚与时令】夏日正午的瓜田最忙。' }] });
  assert.equal(result.mode, 'chat-evidence');
  assert.match(result.answer, /七月/);
  assert.deepEqual(result.usedEvidence, ['西瓜·四时素材', '农谚集']);
  assert.equal(result.followUps.length, 2);
  const call = calls[0];
  assert.ok(call.url.endsWith('/chat/completions'));
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'qwen-plus');
  assert.ok(body.messages[0].role === 'system');
  assert.ok(body.messages[body.messages.length - 1].content.includes('西瓜什么时候最甜'));
  assert.ok(body.messages[body.messages.length - 1].content.includes('【农谚与时令】'));
});

test('history is injected as prior turns so follow-ups keep context', async () => {
  let seen;
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    seen = JSON.parse(options.body);
    return { ok: true, json: async () => chatPayload(JSON.stringify({ answer: '杏子偏甜、李子偏酸，两个都趁熟吃。', usedEvidence: [], followUps: [] })), body: { cancel: async () => {} } };
  });
  await chat.answer({
    question: '那杏子呢',
    history: [
      { role: 'user', content: '李子和杏子哪个酸' },
      { role: 'assistant', content: '李子更酸一些。' },
      { role: 'system', content: ' Injection attempt' }
    ],
    contexts: [{ name: '李子·四时素材', text: '【食养习俗】李子生津。' }]
  });
  const roles = seen.messages.map(item => item.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user'], 'injected history sits between system and the new question');
  assert.ok(seen.messages[2].content.includes('李子更酸'), 'assistant turn is preserved verbatim');
});

test('input cleaning: empty question, oversized and malformed pieces are bounded', () => {
  assert.throws(() => validateBody({ question: '   ', contexts: [] }), /请输入问题/);
  assert.throws(() => validateBody({ question: '西瓜', contexts: 'nope' }), /资料格式无效/);
  // 2026-10-01 泛化改造：空 contexts 不再报错，服务端自动补当季时令包
  // （无水果名问题由模型依据当季资料作答，而不是客户端一棍子打死）。
  const seasonal = validateBody({ question: '现在十月吃什么水果好', contexts: [] });
  assert.ok(seasonal.contexts.length >= 2, 'empty contexts fall back to seasonal evidence');
  assert.ok(seasonal.contexts.some(item => item.name.indexOf('当季果品') !== -1), 'seasonal evidence lists in-season fruits');
  const cleaned = validateBody({
    question: '  ' + '问'.repeat(400) + ' ',
    history: Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '第' + i + '轮' })),
    contexts: Array.from({ length: 9 }, (_, i) => ({ name: '果' + i, text: '资料'.repeat(2000) })).concat([{ name: '', text: '' }])
  });
  assert.equal(cleaned.question.length, 300);
  assert.ok(cleaned.history.length <= 6, 'history is capped at six turns');
  assert.ok(cleaned.contexts.length <= 6, 'contexts are capped at six records');
  assert.ok(cleaned.contexts.every(item => item.text.length <= 1800));
});

test('untrusted model output is rejected and salvageable fences are parsed', () => {
  assert.throws(() => parseAnswer('   '), /回答为空/);
  assert.throws(() => parseAnswer('{"answer":""}'), /回答为空/);
  const fenced = parseAnswer('```json\n{"answer":"挑选看纹路。","usedEvidence":["西瓜·四时素材"],"followUps":["西瓜什么时候熟？","多余的追问",""]}\n```');
  assert.equal(fenced.answer, '挑选看纹路。');
  assert.deepEqual(fenced.followUps, ['西瓜什么时候熟？', '多余的追问'], 'follow-ups are trimmed to two and blank ones dropped');
  const noisy = parseAnswer('前置说明 {"answer":"依据资料回答。","usedEvidence":[]} 后置说明');
  assert.equal(noisy.answer, '依据资料回答。');
  // JSON 之外的散文（如未关思考的模型）降级为纯文本回答，不再整条报错。
  const prose = parseAnswer('好的，西瓜很甜，挑纹路深、拍声闷的。');
  assert.match(prose.answer, /纹路深/);
  assert.deepEqual(prose.usedEvidence, []);
  assert.deepEqual(prose.followUps, []);
});

test('service and transport failures degrade into typed InputErrors', async () => {
  const disabled = createChatService({ ...BASE_CONFIG, provider: 'disabled', providerBase: '' }, async () => { throw new Error('should not be called'); });
  await assert.rejects(disabled.answer({ question: '西瓜', contexts: [{ name: 'x', text: 'y' }] }), error => error.code === 'model_disabled' && error.status === 503);

  const httpFail = createChatService(BASE_CONFIG, async () => ({ ok: false, status: 500, body: { cancel: async () => {} } }));
  await assert.rejects(httpFail.answer({ question: '西瓜', contexts: [{ name: 'x', text: 'y' }] }), error => error.code === 'model_http_error');

  const networkFail = createChatService(BASE_CONFIG, async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(networkFail.answer({ question: '西瓜', contexts: [{ name: 'x', text: 'y' }] }), error => error.code === 'model_unavailable');

  const emptyReply = createChatService(BASE_CONFIG, async () => ({ ok: true, json: async () => chatPayload(''), body: { cancel: async () => {} } }));
  await assert.rejects(emptyReply.answer({ question: '西瓜', contexts: [{ name: 'x', text: 'y' }] }), error => error.code === 'model_empty_response');
});

// —— 2026-10-01 守卫误杀修复：别名关系题（凤梨和菠萝是什么关系）——
// 根因：别名归一化把「凤梨」替换成「菠萝」后，问点词只剩「关系」；好答案说
// 「同一种水果、两个名字」不含「关系」二字，被守卫两轮误杀后换成拒答模板。
const { focusTermsOf, answerAddresses } = require('../server/chat');

test('alias words in the question count as focus terms (凤梨/菠萝 relationship question)', () => {
  const terms = focusTermsOf('凤梨和菠萝是什么关系');
  assert.ok(terms.includes('凤梨'), 'alias 凤梨 must be a focus term: ' + JSON.stringify(terms));
  assert.ok(terms.includes('关系'));
});

test('a good alias-relationship answer is no longer killed by the guard', () => {
  const q = '凤梨和菠萝是什么关系';
  const good = '凤梨和菠萝其实是同一种水果的两个名字：学名都叫菠萝，闽台一带习惯把果眼浅的品种叫凤梨。逢年过节凤梨还取「旺来」的好口彩。';
  assert.equal(answerAddresses(q, good), true);
  const good2 = '两者是同一种水果：凤梨是菠萝的别称，闽台一带分得讲究，年节还讨「旺来」口彩。';
  assert.equal(answerAddresses(q, good2), true);
});

test('sameness questions accept same-species phrasings without the word 关系', () => {
  assert.equal(answerAddresses('猕猴桃和奇异果是一种东西吗', '奇异果就是猕猴桃的商品名，同一个物种。'), true);
});

test('off-topic answers to relationship questions are still rejected by the guard', () => {
  assert.equal(answerAddresses('凤梨和菠萝是什么关系', '西瓜是夏天解暑的好果子，看纹听声就能挑。'), false);
});

// —— 2026-10-01 需求文档任务 2/3：情况 B 兜底 + 新别名不进问点词 ——
const { refusalFallback, aliasHintOf } = require('../server/chat');

test('fallback for a KB fruit missing the asked knowledge point uses the 情况B template', () => {
  const contexts = [{ name: '李子·四时素材', text: '李子孟夏成熟……' }, { name: '农谚集', text: '……' }];
  const answer = refusalFallback('李子立夏尝新有什么讲究', contexts);
  assert.match(answer, /四时素材库收录有李子的相关资料/);
  assert.match(answer, /暂未收录您询问的这一条/);
  assert.match(answer, /时令、吃法、农谚/);
});

test('fallback without a fruit context keeps the generic honest refusal', () => {
  const answer = refusalFallback('今天股票怎么样', []);
  assert.match(answer, /素材库里没有/);
});

test('new dictionary aliases count as focus terms so alias-mentioning answers pass the guard', () => {
  // 别名算问点是有意设计（凤梨/菠萝关系题修复）：好答案说明别称关系即视为回应问点。
  const terms = focusTermsOf('贵妃芒怎么挑');
  assert.ok(terms.includes('贵妃芒'), JSON.stringify(terms));
});

test('alias hint follows the requirement doc 2.3 template', () => {
  const hint = aliasHintOf('提子是什么');
  assert.match(hint, /按「葡萄」调取/);
  assert.match(hint, /商业俗称/);
});
