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

// —— 10.11 英文模式（用户要求：语言跟随界面语言，不跟提问语言）——
test('English mode accepts the English answer as-is and never falls back to the Chinese guard templates', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => chatPayload(JSON.stringify({
      answer: 'Right now, in late autumn, these fruits are in season: persimmons, pears and jujubes.',
      usedEvidence: ['当季果品·霜天凝果（9-10-11月）'],
      followUps: ['What is in season in winter?', 'How do I pick a persimmon?']
    })), body: { cancel: async () => {} } };
  });
  const result = await chat.answer({
    question: '现在吃什么水果当季',            // 中文提问 + 英文模式
    lang: 'en',
    history: [],
    contexts: [{ name: '当季果品·霜天凝果（9-10-11月）', text: '当前正当季的果品清单：柿子、秋梨、枣。' }]
  });
  assert.equal(calls.length, 1, '英文模式不做中文问点复核，不触发 refocus 重答');
  assert.equal(result.mode, 'chat-evidence');
  assert.match(result.answer, /in season/);
  assert.doesNotMatch(result.answer, /素材库|答不准/, '不返回中文兜底话术');
  assert.ok(calls[0].messages[0].content.includes('Answer entirely in English'), '英文输出指令已下发');
  assert.ok(calls[0].messages[0].content.includes('not the language of the question'), '明确「语言跟指令走、不跟提问语言走」');
});

test('English mode fills in English guiding follow-ups when the model returns none', async () => {
  const chat = createChatService(BASE_CONFIG, async () => ({ ok: true, json: async () => chatPayload(JSON.stringify({ answer: 'The sources do not cover that.', usedEvidence: [], followUps: [] })), body: { cancel: async () => {} } }));
  const result = await chat.answer({ question: 'How do I grow apples?', lang: 'en', history: [], contexts: [{ name: '苹果·四时素材', text: '【历史渊源】苹果本土化。' }] });
  assert.deepEqual(result.followUps, ['What fruit is in season now?', 'How do I pick a good watermelon?']);
  assert.match(result.answer, /sources do not cover/);
});

test('English mode forbids ordinary Chinese words and uses an English prompt shell', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => chatPayload(JSON.stringify({ answer: 'Watermelon is in season in summer.', usedEvidence: [], followUps: [] })), body: { cancel: async () => {} } };
  });
  await chat.answer({ question: 'watermelon', lang: 'en', history: [], contexts: [{ name: 'Watermelon · Seasonal material', text: '【History】It reached China long ago.' }] });
  const messages = calls[0].messages;
  const system = messages[0].content;
  const user = messages[messages.length - 1].content;
  assert.ok(system.includes('never leave an ordinary Chinese word'), '明确禁止英文句子里夹普通中文词');
  assert.ok(system.includes('puns and homophone lore'), '保留了「只允许专名」的白名单');
  assert.doesNotMatch(system, /must repeat each 资料名/, '不再用「资料名」这种说法教模型把「资料」当专名');
  assert.match(user, /^Material:\n/, '英文模式的外壳标签也是英文');
  assert.match(user, /\n\nQuestion: watermelon$/);
});

test('Chinese mode keeps the original Chinese prompt shell and prompt', async () => {
  const calls = [];
  const chat = createChatService(BASE_CONFIG, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => chatPayload(JSON.stringify({ answer: '西瓜夏天成熟。', usedEvidence: [], followUps: [] })), body: { cancel: async () => {} } };
  });
  await chat.answer({ question: '西瓜', history: [], contexts: [{ name: '西瓜·四时素材', text: '【历史渊源】很久以前传入。' }] });
  const messages = calls[0].messages;
  const user = messages[messages.length - 1].content;
  assert.match(user, /^资料：\n/);
  assert.match(user, /\n\n问题：西瓜$/);
  assert.doesNotMatch(messages[0].content, /OUTPUT LANGUAGE/, '中文模式不带英文输出指令');
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

// ══ 10.11 英文模式：农事挑战 / 文化连连看（/api/chat taskType=challenge|match）══
// 背景：客户端英文模式会带 lang:'en'（miniprogram/lib/challenge-game.js、match-game.js），
// 但这两条分支原先提示词写死中文，英文界面拿到的仍是中文讲解。
// 守卫三件事：① 英文提示词 + JSON 字段名一个不变（cause/origin/elfMessage/correct、comment/knowledge）
// ② 英文模式跳过随包中文知识库与中文缓存（改用 challenge-explanations-en.js 与 v2en 缓存键）
// ③ 中文模式（不传 lang / 'zh' / 非法值）与改动前逐字一致。
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const zhChallengeBook = require('../miniprogram/packageGame/data/challenge-explanations');
const enChallengeBook = require('../miniprogram/packageGame/data/challenge-explanations-en');
// 与 server/chat.js 同一路径：os.tmpdir() 下的知识库写回文件
const KB_FILE = path.join(os.tmpdir(), 'guayouji-challenge-knowledge.json');

// 会写回知识库缓存的用例一律先备份该文件、跑完还原，绝不污染开发机上的真实缓存。
async function withKbFile(entries, run) {
  const before = fs.existsSync(KB_FILE) ? fs.readFileSync(KB_FILE, 'utf8') : null;
  try {
    fs.writeFileSync(KB_FILE, JSON.stringify(entries || {}, null, 2));
    return await run();
  } finally {
    if (before === null) { try { fs.unlinkSync(KB_FILE); } catch (error) { /* 忽略 */ } }
    else fs.writeFileSync(KB_FILE, before);
  }
}

// 记录下发的请求体；reply 固定返回同一份模型输出。
function recordingModel(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => chatPayload(reply), body: { cancel: async () => {} } };
  };
  return { calls, fetchImpl };
}

// 一段真实长度的英文讲解（远超中文侧 90 字符的上限）
const CAUSE_EN = 'Around Mangzhong the summer rain pours day after day and water stands in the plum orchard; the roots cannot breathe and the fruit swells too fast, so the old growers open the drainage ditches first and only then thin the crowded fruit.';
const ORIGIN_EN = 'Opening ditches and thinning fruit is handwork handed down in the mountain plum orchards, where growers learned over generations to trust patient work in the wet season rather than any quick fix.';

test('English farming challenge gets an English prompt, the same JSON field names, and no truncation at the Chinese limit', async () => {
  const { calls, fetchImpl } = recordingModel(JSON.stringify({ correct: true, cause: CAUSE_EN, origin: ORIGIN_EN, elfMessage: 'Nicely reasoned — keep going!' }));
  const chat = createChatService(BASE_CONFIG, fetchImpl);
  const result = await withKbFile({}, () => chat.challenge({
    taskType: 'challenge', lang: 'en', questionId: 'probe-not-in-any-book',
    fruit: '青梅', term: '芒种', category: '农事',
    situation: '芒种梅雨连绵，青梅园里湿气重。', userChoice: '及时排水防落果和病害', isCorrect: true,
    context: '芒种梅雨多，青梅怕落果和病害。'
  }));
  assert.equal(calls.length, 1, '无随包条目时现调模型');
  const system = calls[0].messages[0].content;
  const user = calls[0].messages[1].content;
  assert.match(system, /Answer entirely in English/, '英文输出指令已下发');
  assert.match(system, /not the language of the material/, '素材是中文也用英文作答');
  assert.match(system, /traditional food names/, '专名白名单（含传统食物名）在');
  assert.ok(system.includes('"correct"') && system.includes('"cause"') && system.includes('"origin"') && system.includes('"elfMessage"'), 'JSON 字段名一个不变');
  assert.doesNotMatch(system, /你是「果物四时记」/, '英文模式不夹中文提示词');
  assert.match(user, /^Solar term: 芒种\nFruit: 青梅\nTrouble type: 农事\n/, 'user 用英文字段名');
  assert.match(user, /\nIs correct: Yes\n/);
  assert.doesNotMatch(user, /节气：|水果：|困境类型：/, '英文模式的 user 不再用中文字段名');
  assert.equal(result.correct, true);
  assert.deepEqual(result.knowledgePoints, ['Reason: ' + CAUSE_EN, 'Origin: ' + ORIGIN_EN], '英文讲解按 500 字符上限保留整段，不被中文的 90 字符截断');
  assert.equal(result.elfMessage, 'Nicely reasoned — keep going!');
});

test('English farming challenge reads the bundled English knowledge base and never the Chinese one', async () => {
  const ID = 'c-plum-store';   // 中英两库同 id（games-en-kb.test.js 已锁「150 条 id 一条不差」）
  let modelCalls = 0;
  const chat = createChatService(BASE_CONFIG, async () => { modelCalls += 1; throw new Error('英文命中随包知识库时不该调模型'); });
  const result = await chat.challenge({ taskType: 'challenge', lang: 'en', questionId: ID, fruit: '青梅', term: '小满', category: '储存', isCorrect: false });
  assert.equal(modelCalls, 0, '命中英文随包知识库就不调模型（与中文侧同一既有行为）');
  assert.equal(result.knowledgePoints.length, 2);
  assert.match(result.knowledgePoints[0], /^Reason: /, '英文标签用 Reason: ');
  assert.match(result.knowledgePoints[1], /^Origin: /, '英文标签用 Origin: ');
  assert.ok(result.knowledgePoints[0].includes(enChallengeBook[ID].cause), '取英文库原文');
  assert.ok(result.knowledgePoints[1].includes(enChallengeBook[ID].origin));
  assert.ok(result.knowledgePoints.join(' ').indexOf(zhChallengeBook[ID].cause) === -1, '中文库正文一个字都不许出现');
  assert.equal(result.correct, false);
});

test('English farming challenge ignores the Chinese local cache, and its own answer lands in the English cache key', async () => {
  await withKbFile({ 'v2|CacheProbe|CacheTerm|CacheCat': { cause: '中文缓存原因', origin: '中文缓存由来' } }, async () => {
    const { calls, fetchImpl } = recordingModel(JSON.stringify({ correct: true, cause: 'English model cause.', origin: 'English model origin.', elfMessage: 'Well done!' }));
    const chat = createChatService(BASE_CONFIG, fetchImpl);
    const en = await chat.challenge({ taskType: 'challenge', lang: 'en', questionId: 'cache-probe-en', fruit: 'CacheProbe', term: 'CacheTerm', category: 'CacheCat', isCorrect: true });
    assert.equal(calls.length, 1, '英文模式读不到中文缓存 → 必须现调模型');
    assert.deepEqual(en.knowledgePoints, ['Reason: English model cause.', 'Origin: English model origin.']);
    assert.equal(en.correct, true);
    const saved = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
    assert.equal(saved['v2|CacheProbe|CacheTerm|CacheCat'].cause, '中文缓存原因', '中文缓存没被英文讲解覆盖');
    assert.equal(saved['v2en|CacheProbe|CacheTerm|CacheCat'].cause, 'English model cause.', '英文讲解写进 v2en 键');

    // 同一份中文缓存：中文模式照旧命中、不调模型、输出中文（与改动前一致）
    let zhModelCalls = 0;
    const zhChat = createChatService(BASE_CONFIG, async () => { zhModelCalls += 1; throw new Error('中文缓存命中时不该调模型'); });
    const zh = await zhChat.challenge({ taskType: 'challenge', questionId: 'cache-probe-zh', fruit: 'CacheProbe', term: 'CacheTerm', category: 'CacheCat', isCorrect: false });
    assert.equal(zhModelCalls, 0, '中文模式仍读中文缓存');
    assert.deepEqual(zh.knowledgePoints, ['原因：中文缓存原因', '由来：中文缓存由来']);
    assert.equal(zh.correct, false);
  });
});

test('farming challenge without lang / zh / an unknown lang keeps the original Chinese prompt and knowledge base', async () => {
  let modelCalls = 0;
  const kbChat = createChatService(BASE_CONFIG, async () => { modelCalls += 1; throw new Error('中文随包知识库命中时不该调模型'); });
  const hit = await kbChat.challenge({ taskType: 'challenge', questionId: 'c-plum-store', fruit: '青梅', term: '小满', category: '储存' });
  assert.equal(modelCalls, 0);
  assert.match(hit.knowledgePoints[0], /^原因：/, '中文标签仍是「原因：」');
  assert.match(hit.knowledgePoints[1], /^由来：/);
  assert.ok(hit.knowledgePoints[0].includes(zhChallengeBook['c-plum-store'].cause), '仍取中文库原文');

  for (const lang of [undefined, 'zh', 'fr']) {
    await withKbFile({}, async () => {
      const { calls, fetchImpl } = recordingModel(JSON.stringify({ correct: false, cause: '中文原因', origin: '中文由来', elfMessage: '再接再厉' }));
      const chat = createChatService(BASE_CONFIG, fetchImpl);
      const input = { taskType: 'challenge', questionId: 'zh-probe-' + String(lang), fruit: '杧果', term: '小满', category: '农事', situation: '题面', userChoice: '选项', isCorrect: false, context: '段落' };
      if (lang !== undefined) input.lang = lang;
      const result = await chat.challenge(input);
      const system = calls[0].messages[0].content;
      const user = calls[0].messages[1].content;
      assert.match(system, /^你是「果物四时记」/, 'lang=' + lang + ' 时仍是原中文 system 提示词');
      assert.doesNotMatch(system, /OUTPUT LANGUAGE/, 'lang=' + lang + ' 时不带英文输出指令');
      assert.match(user, /^节气：小满\n水果：杧果\n困境类型：农事\n/, 'lang=' + lang + ' 时 user 字段名仍是中文');
      assert.match(user, /\n是否正确：否\n/);
      assert.deepEqual(result.knowledgePoints, ['原因：中文原因', '由来：中文由来']);
      assert.equal(result.elfMessage, '再接再厉');
    });
  }
});

test('English culture match gets an English prompt with the same comment/knowledge fields', async () => {
  const { calls, fetchImpl } = recordingModel(JSON.stringify({ correct: true, comment: 'A neat pairing — the old monograph really does describe this fruit.', knowledge: 'The classic text 荔枝谱 records how the fruit was prized in the south.' }));
  const chat = createChatService(BASE_CONFIG, fetchImpl);
  const result = await chat.match({
    taskType: 'match', lang: 'en', fruit: '荔枝', category: '古籍', label: '《荔枝谱》', isCorrect: true,
    context: '《荔枝谱》记荔枝南国珍果。'
  });
  assert.equal(calls.length, 1);
  const system = calls[0].messages[0].content;
  const user = calls[0].messages[1].content;
  assert.match(system, /Answer entirely in English/);
  assert.match(system, /not the language of the material/, '素材是中文也用英文作答');
  assert.match(system, /traditional food names/, '专名白名单在');
  assert.ok(system.includes('"correct"') && system.includes('"comment"') && system.includes('"knowledge"'), 'JSON 字段名一个不变');
  assert.doesNotMatch(system, /你是「果物四时记」/);
  assert.match(user, /^Fruit: 荔枝\nLabel category: 古籍\nLabel content: 《荔枝谱》\nMatch is correct: Yes\n/, 'user 用英文字段名、专名保留中文');
  assert.doesNotMatch(user, /水果：|标签类别：|配对是否正确：/);
  assert.deepEqual(result, { correct: true, comment: 'A neat pairing — the old monograph really does describe this fruit.', knowledge: 'The classic text 荔枝谱 records how the fruit was prized in the south.' });
});

test('culture match without lang keeps the original Chinese prompt shell', async () => {
  const { calls, fetchImpl } = recordingModel(JSON.stringify({ correct: false, comment: '这对没配对上。', knowledge: '文化库原文说的是别的用途。' }));
  const chat = createChatService(BASE_CONFIG, fetchImpl);
  const result = await chat.match({ taskType: 'match', fruit: '荔枝', category: '古籍', label: '《荔枝谱》', isCorrect: false, context: '中文文化库原文' });
  const system = calls[0].messages[0].content;
  const user = calls[0].messages[1].content;
  assert.match(system, /^你是「果物四时记」/);
  assert.doesNotMatch(system, /OUTPUT LANGUAGE/);
  assert.match(user, /^水果：荔枝\n标签类别：古籍\n标签内容：《荔枝谱》\n配对是否正确：否\n/, '中文模式 user 字段名与改动前一致');
  assert.deepEqual(result, { correct: false, comment: '这对没配对上。', knowledge: '文化库原文说的是别的用途。' });
});
