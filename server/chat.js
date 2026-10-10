'use strict';

// 果灵对话（P16 搜索改版）：多轮问答接口。
// 与 /api/ask 的「模型只选证据、不写答案」不同，这里模型需要组织口语化回答，
// 但约束不变：只允许依据客户端检索出的资料回答，明确标注引用，资料不足时如实说
// 不足，禁止编造农谚、民俗、果农故事。历史轮次由客户端传入，服务端不存会话。
const { InputError } = require('./validation');
const { createCloudbaseModel } = require('./provider');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 2026-09-29 假拒答修复（9.28 版机制反噬的教训）：
// 9.28 版把回答框成两分支——「能回答→直答」/「不能回答→拒答+补充最相关内容+免责声明」。
// 实测出现两类反噬：①模型判定「直接回答」的门槛过高，素材其实能答也走拒答分支；
// ②拒答分支被要求「补充最相关内容」而素材又没有时，模型现编一句（如给「李子为什么酸」
// 编出素材里不存在的「有机酸」），再自我声明它不是答案——自相矛盾且夹带编造。
// 修复原则不变：全部是问题无关的通用规则——
//   · 分支改成三分：能答（哪怕角度不同/只覆盖一部分）→ 直答；完全无关 → 干净拒答；
//   · 拒答后允许补充，但补充必须是资料原文就有的说法，拿不准就不补，禁止成因/原理/数字类推断；
//   · 服务端对拒答稿一律复核一次：能答则答、补充逐句核对，两次都拒才维持拒答。
const SYSTEM = [
  '你是「果物四时记」中原果事研学小程序的 AI 文化助手「果灵」，一位熟悉中国乡土果文化的果树精灵。面向各地游客，语言通俗，适合手机阅读，分段清晰，拒绝大段学术长文。',
  '',
  '水果分两类标签：【华夏本土原生果】（桃、李、杏、枣、梨、梅、柿等华夏原生果品）、【丝路引种‑中原本土化物产】（石榴、西瓜、葡萄等外来引种后本土化的果品）。核心理念：无论物种起源何方，一旦经过华夏土地驯化、本草归纳、民俗浸润，就成为中华果食文化的一部分。',
  '',
  '回答铁律，按顺序执行：',
  '一、先判断：逐条核对「资料」，判断资料能不能回应用户问题的问点（用户到底在问什么）。',
  '二、资料能回应问点（哪怕只从一个角度、只覆盖一部分、说法和问题用词不一样）：第一句必须直接回应问点——问什么答什么。比较题先给一句话结论；关系题先说清两者是什么关系；为什么题先给原因；怎么做题先给关键步骤。禁止开头先概述资料、先寒暄或先讲别的角度。',
  '三、资料完全回应不了问点、又不属于第四条至第七条可生成范围的，按两种情况处理：（甲）资料属于某一水果（资料名形如「李子·四时素材」）但缺用户问的这一条知识点：第一句按模板写「四时素材库收录有该果的相关资料，但暂未收录您询问的这一条记载」，并建议改问该果的时令、吃法、农谚等其他方向；（乙）资料与问点完全不沾边：第一句写「素材库里没有」并点出问点，可用一到两句补充资料里确实写到的相关内容（必须是资料原文就有的说法，拿不准就不补）。两种情况都禁止为了贴合问点补写资料里没有的解释（尤其是成因、原理、数字）。境外原生且未收录的外来果品不适用本条，按第十三条的引种模板处理。',
  '',
  '【物种匹配全局强制规则】一、传入的资料已经过水果标签过滤，单果问题的资料全部属于该目标水果；严禁使用其他水果的资料内容来举例、类比、补充回答（用户点名比较两种水果的对比题除外——只允许使用这两种被点名水果的资料）。二、禁止编造本库不存在的农谚、古文、民俗。三、库内史料与【补充常识】两种内容不得混淆，不得把现代常识包装成古代史料、也不得把古籍民俗说成现代说法。',
  '四、挑选、保存、保鲜、清洗、催熟、去皮、存放、吃法、食用等水果生活实用问题：如果资料里已有相关内容（传统手艺、食养习俗、民俗食俗等），优先引用资料作答；资料里完全没有时，才用可靠的通用生活常识作答，第一句直接给要点（分点、短句、可操作），常识段开头标注【补充常识】，末尾加一句「以上是通用生活小常识，非文献资料」。常识回答同样禁止编造：不写具体数字、产地、品种名、民俗与农谚。',
  '五、时令推荐与节气类问题（当季/应季/现在吃什么水果、这个季节吃什么、什么正当令，或问立冬、霜降等某个节气的讲究）：依据资料里的当季果品清单与节气札作答——时令推荐挑几种当季果、各带一句时令讲究或食俗；节气题讲该节气的果事讲究与相关食俗。推荐的果品必须来自资料清单，不推荐清单之外的果品。',
  '六、问候、道谢、告别、闲聊，或问「你是谁」「你会什么」这类关于果灵自己的问题：以果灵身份友好回应，两三句即可，自然引导回水果话题（时令、挑选、吃法、习俗），不强行引用资料。用户表达情绪（如心情不好）时先温柔回应，再用一两句应季果食的暖心话宽慰，不编造食养功效。',
  '七、文化知识类问题：知识库素材优先；素材缺失时，可以基于公认的中华农耕文化常识自己组织整理回答（像一位博学的文化讲解员），但不得编造具体古籍名、篇目、人名、朝代年代、数字、考古出处、农谚原文——这些只能来自资料。资料拿不准的说法，用「一般认为」「民间流传」「相传」这类口吻表述，常识段开头标注【补充常识】，末尾加一句「以上为通用文化常识，非文献资料」。',
  '八、华夏本土原生果（🍂）：可引用全国范围内的考古、上古农书、历代典籍、各地农耕民俗（以资料为准），不局限于河南一地。',
  '九、丝路引种水果（🛤️，石榴、西瓜、葡萄等）：用户用现代商品名或口语别称提问时（车厘子、奇异果、提子、凤梨等，问题后附有「别称说明」），一律映射到该物种的传统果名作答，开头一句话说明对应关系，再调取本体资料。物种在世界范围内的原生起源与早期域外史料至多一句带过；七成以上篇幅讲述传入华夏之后：传入的历史记载、农人驯化改良耕种技术、适配二十四节气农时、被中医本草纳入食养体系、融入各地民俗吉祥寓意、中国人的食用习俗与古典诗文、发展中式手工食艺。',
  '十、【对比类问题强制规则，非常重要】用户问「A 和 B 有什么区别」「A 和 B 怎么选」这类对比提问，严禁优先使用糖分、甜度、维生素、热量等现代营养学指标做对比。必须优先从四个传统文化维度中挑选合适的维度：①农耕农时（成熟节气、农谚、古法采收、种植历史）；②本草食养（本草性味、民间食养宜忌、古老饮食俗语）；③古籍文学（《诗经》、历代农书、诗文、古籍记载）；④民俗寓意（岁时节令、婚嫁年节、吉祥象征、南北各地习俗）。对比题的第一句话必须点明两者「不同/区别」在哪里。对比结束后，可自然带出一句线下研学提示，如「想实地感受这份果食文化，可以到定位附近的果园古树走一走，亲手触摸果树」。示例逻辑（柿子 vs 李子）：不写「柿子糖分更高、李子维C更高」；要写「李子孟夏成熟是时令果；柿子霜降采收是秋冬风物；二者本草性味不同；民俗寓意也不一样」。',
  '十一、资料名里已标注该果的分类标签（🍂 华夏本土原生果 / 🛤️ 丝路引种·中原本土化物产），这是服务端依据资料库确定的分类，直接采用、不要自行改判；回答开头可单独一行带上这个小标识（一次回答涉及多果且标签不同时，在对应内容处分别标注）。没有标签的资料（如农谚集）不强行标注。行文自然流畅，不要输出【】标题等生硬符号。',
  '十二、禁止编造农谚、民俗、果农故事、产地数据；禁止把资料里没有的数字写进回答。',
  '十三、境外原生、且资料库未收录其中国本土化内容的果品，以及纯境外农耕话题：第一句按模板说明「该水果属于外来引种物种，四时素材库暂未收录它在中国传统农谚与时令民俗记载」；随后可以给一小段可靠的通用常识（如挑选、食用注意，分点短句），这一段开头标注【补充常识】，同样禁止编造民俗、农谚与具体数字；followUps 引回素材库内的本土水果（如「荔枝有什么讲究」），把用户带回中华果文化的正题。',
  '十四、回答用温暖、简明的中文口语：短句、分点、每点一行，总长不超过 260 字。',
  '十五、只输出 JSON：{"answer":"回答正文","usedEvidence":["资料名"],"followUps":["建议追问1","建议追问2"]}。',
  'followUps 最多 2 条、每条不超过 18 字，要与当前话题衔接；按铁律三拒答时 usedEvidence 返回空数组，但 followUps 绝不能为空——必须给两条素材库范围内、尽量贴近用户话题的建议问法（换成果库内的水果、或转向时令、挑选、吃法、习俗），很多用户不知道能问什么，拒答要给他们指路。按铁律四用常识作答、按铁律五作时令推荐、按铁律六闲聊回应、按铁律七生成文化常识时 usedEvidence 返回空数组，并在正文末尾带上对应的「非文献资料」标注（时令推荐与闲聊可不带标注）。对比题的 followUps 可引导往某个传统文化维度深入，或引向相邻水果。'
].join('\n');

// —— 用户自定义回答模板（2026-10-01 预留插槽，等产品负责人整理好模板后填入）——
// 用途：用户希望「问到每一个水果时都直接套统一模板回答」，而不是逐果示例改提示词。
// 填入后自动拼接在 SYSTEM 末尾作为输出结构要求，对全部水果、全部问答一次生效。
// 填写格式建议：固定结构 + 每段说明该段放什么内容，例：
//   '回答结构模板（任何水果问题都必须按此结构组织正文）：\n'
//   + '第一行：果名 + 分类标签（🍂/🛤️）\n'
//   + '第二句：一句话点明与问题的关系（时令结论/区别结论等）\n'
//   + '正文分三段：①时令与农事 ②挑选与吃法 ③民俗与讲究\n'
//   + '结尾：一句研学体验引导'
// 注意：模板只约束「结构」，资料内容仍按铁律逐句核对，禁止为凑模板编造内容。
const ANSWER_TEMPLATE = '';
const SYSTEM_FULL = ANSWER_TEMPLATE ? SYSTEM + '\n\n' + ANSWER_TEMPLATE : SYSTEM;

// —— 答点守卫（通用词法机制，不含任何具体问题/水果的特判）——
// 从问题里抽「双实义字」词作为问点词：两字都不是常见虚字才保留，问点词在回答里出现
// 视为「回应了问点」。守卫只做两件事：回答既不覆盖问点、又不是诚实拒答时要求模型重答
// 一次；重答仍不合格则替换为诚实拒答模板，宁可拒答也不输出答非所问的内容。
//
// 2026-10-01 修复：问点词要排除问题中命中的水果名——「如何挑选西瓜」的问点是「挑选」，
// 不是「西瓜」。旧版把「西瓜」也当问点词，回答里到处是「西瓜」，答非所问也能蒙混过关。
const FUNCTION_CHARS = new Set('的一是在了有和与跟对对于会被把不没就都很也还又并或者吗呢吧啊呀么什怎啥这那哪此如为因所但而且如果到从给让用叫要能想请说告诉知道可应该'.split(''));
// 水果名与别名（与客户端 matchFruits 的别名规则一致）：双字整名从问点词排除，单字进兜底集。
// FRUIT_ALIASES 与 miniprogram/pages/search/search.js 保持同源，两边一起改：
// 问「提子」时客户端路由到葡萄资料，服务端同时不把「提子」当问点词，守卫不会误杀。
// 2026-10-01 合入用户整理并人工审核的《现代别名→古籍果名》字典（约 90 组），
// 数组内长词在前，保证最长匹配（需求文档注意事项 1）。
const FRUIT_ALIASES = {
  '青梅': ['酸梅'],
  '桑葚': ['桑椹', '桑果'],
  '樱桃': ['中国樱桃', '小樱桃', '车厘子'],
  '枇杷': ['芦橘'],
  '桃子': ['水蜜桃', '蟠桃', '毛桃', '油桃'],
  '李子': ['三华李', '黑布林', '脆李'],
  '荔枝': ['妃子笑', '糯米糍', '桂味'],
  '龙眼': ['桂圆'],
  '杨梅': ['东魁杨梅'],
  '柿子': ['磨盘柿', '脆柿子', '脆柿'],
  '秋梨': ['砀山梨', '雪梨', '鸭梨'],
  '枣': ['红枣', '大枣'],
  '山楂': ['山里红', '红果'],
  '猕猴桃': ['奇异果'],
  '石榴': ['安石榴'],
  '砂糖橘': ['沙糖桔', '沙糖橘'],
  '瓯柑': ['温州蜜柑'],
  '柚子': ['沙田柚', '蜜柚', '西柚', '文旦'],
  '金桔': ['金橘', '金枣'],
  '冬枣': ['脆冬枣'],
  '黄皮': ['黄皮果'],
  '甘蔗': ['糖蔗', '果蔗'],
  '芒果': ['大青芒', '小台芒', '台农芒', '贵妃芒', '杧果'],
  '香蕉': ['小米蕉', '粉蕉', '芭蕉'],
  '草莓': ['红颜草莓', '奶油草莓'],
  '山竹': ['莽吉柿'],
  '柠檬': ['青柠檬', '黄柠檬'],
  '百香果': ['西番莲', '热情果', '鸡蛋果'],
  '火龙果': ['红心火龙果', '白心火龙果', '红龙果'],
  '椰子': ['椰青', '椰果'],
  '葡萄': ['阳光玫瑰', '巨峰', '提子'],
  '哈密瓜': ['网纹瓜', '西州蜜'],
  '菠萝': ['凤梨'],
  '西瓜': ['黑美人', '麒麟瓜', '8424'],
  '无花果': ['布兰瑞克', '阿驵'],
  '脐橙': ['纽荷尔脐橙'],
  '苹果': ['花牛苹果', '红富士'],
  '椰枣': ['伊拉克枣', '海枣'],
  '释迦': ['番荔枝'],
  '木瓜': ['夏威夷木瓜', '番木瓜'],
  '杨桃': ['五棱子', '阳桃']
};
const FRUIT_TERMS = new Set();
const FRUIT_CHARS = new Set();
(function collectFruitTerms() {
  // 部署包里数据内置在 server/miniprogram（云托管 v6+ 结构），主项目在上级 ../miniprogram。
  let fruitCulture;
  try { fruitCulture = require('./miniprogram/data/fruit-culture'); }
  catch (error) { fruitCulture = require('../miniprogram/data/fruit-culture'); }
  const names = [];
  // seasonFruits = season.fruits + season.moreFruits：内圈 14 种 + 外圈 28 种全量收录。
  // 旧版只遍历 season.fruits，漏掉 28 种外圈果名（葡萄、苹果、龙眼……），它们的果名
  // 会被当成问点词，守卫误杀答非所问——问「葡萄是什么」回答里全是「葡萄」也算回应问点。
  for (const season of fruitCulture.seasons) for (const fruit of fruitCulture.seasonFruits(season)) names.push(fruit.name);
  for (const name of names) {
    FRUIT_TERMS.add(name);
    // 单字水果名（如「杏」）的口语变体「杏子」同样属于主题词，不算问点。
    if (name.length === 1) FRUIT_TERMS.add(name + '子');
  }
  // 口语别名（提子/车厘子/番荔枝……）与本体名一样不算问点词。
  Object.keys(FRUIT_ALIASES).forEach(fruit => FRUIT_ALIASES[fruit].forEach(alias => FRUIT_TERMS.add(alias)));
  for (const name of FRUIT_TERMS) for (const char of name) FRUIT_CHARS.add(char);
})();
// 果品分类标签（服务端依据资料库确定性注入，不靠模型猜）：
// NATIVE_NAMES 里的 20 种是【华夏本土原生果】；WORLD 库里有内容但不在本土名单的
// （西瓜、石榴、葡萄、火龙果等 22 种）是【丝路引种·中原本土化物产】。
const FRUIT_TAGS = new Map();
(function collectFruitTags() {
  let fruitCulture, WORLD;
  try { fruitCulture = require('./miniprogram/data/fruit-culture'); }
  catch (error) { fruitCulture = require('../miniprogram/data/fruit-culture'); }
  try { WORLD = require('./miniprogram/data/world-fruit-culture'); }
  catch (error) { WORLD = require('../miniprogram/data/world-fruit-culture'); }
  const native = new Set();
  Object.values(fruitCulture.NATIVE_NAMES || {}).forEach(list => (list || []).forEach(n => native.add(n)));
  for (const name of native) FRUIT_TAGS.set(name, '🍂 华夏本土原生果');
  for (const name of Object.keys(WORLD || {})) if (!native.has(name)) FRUIT_TAGS.set(name, '🛤️ 丝路引种·中原本土化物产');
})();
// 单字核心词：问题里去掉虚字与水果名后的实义单字，作双字问点未命中时的宽松层。
// 取词前先做别名归一化：「番荔枝好吃吗」→「释迦好吃吗」，滑窗对不再把别名拆成问点。
function normalizeAliases(text) {
  let normalized = String(text || '');
  Object.keys(FRUIT_ALIASES).forEach(fruit => {
    FRUIT_ALIASES[fruit].forEach(alias => {
      if (normalized.indexOf(alias) !== -1) normalized = normalized.split(alias).join(fruit);
    });
  });
  return normalized;
}
function coreCharsOf(question) {
  const chars = new Set();
  const segments = normalizeAliases(question).match(/[\u4e00-\u9fa5]+/g) || [];
  segments.join('').split('').forEach(char => {
    if (!FUNCTION_CHARS.has(char) && !FRUIT_CHARS.has(char)) chars.add(char);
  });
  return Array.from(chars);
}
function focusTermsOf(question) {
  const terms = new Set();
  const raw = String(question || '');
  // 别名本身也是问点：问「凤梨和菠萝是什么关系」时，别名归一化会把「凤梨」替换成
  // 「菠萝」，问点词只剩「关系」二字；而好答案说「同一种水果、两个名字」并不连写
  // 「关系」，会被守卫误杀成答非所问、最终换成拒答模板（2026-10-01 真机实测踩坑）。
  // 所以原问题里出现过的别名一律计入问点——好答案解释别名关系必然复述别名本身。
  Object.keys(FRUIT_ALIASES).forEach(fruit => {
    FRUIT_ALIASES[fruit].forEach(alias => { if (raw.indexOf(alias) !== -1) terms.add(alias); });
  });
  const segments = normalizeAliases(question).match(/[\u4e00-\u9fa5]+/g) || [];
  segments.forEach(segment => {
    for (let i = 0; i + 1 < segment.length; i += 1) {
      const pair = segment.slice(i, i + 2);
      if (!FUNCTION_CHARS.has(pair[0]) && !FUNCTION_CHARS.has(pair[1]) && !FRUIT_TERMS.has(pair)) terms.add(pair);
    }
  });
  if (terms.size) return Array.from(terms);
  // 兜底：双字问点全被虚字/水果名过滤时（如「西瓜怎么挑」），退化为单字核心词，
  // 回答里出现任一核心字（如「挑」）即视为回应了问点。
  return coreCharsOf(question);
}
// 与铁律三对应的诚实拒答话术（模型端或模板端产生都算数）。
function isHonestRefusal(answer) {
  return /素材库里没有|素材库暂无|资料里没有|资料暂无|暂未收录您询问/.test(String(answer || ''));
}
function answerAddresses(question, answer) {
  const terms = focusTermsOf(question);
  if (!terms.length) return true;
  const text = String(answer || '');
  if (terms.some(term => text.includes(term))) return true;
  // 宽松层：双字问点未连写命中时（如回答「挑西瓜看三点」不含「挑选」），
  // 检查单字核心词（如「挑」「选」）任一出现即视为回应了问点。
  if (coreCharsOf(question).some(char => text.includes(char))) return true;
  // 对比题宽松层：问「A和B有什么区别」时问点词只剩「区别」，而合格的对比回答
  // 常用「不同/各有/相比」等表述、不连写「区别」——出现对比表述词即视为回应了问点。
  if (/区别|不同|差异|对比|怎么选|哪个更|哪个好/.test(String(question || '')) &&
      /不同|区别|差异|不一样|各有|相比|相对|一个偏|一个是|走的是|各是/.test(text)) return true;
  // 关系/同一题宽松层：问「凤梨和菠萝是什么关系」「是一样东西吗」时，合格回答
  // 常说「同一种/别称/两个名字」而不复述「关系」二字——出现同类表述即视为回应。
  if (/什么关系|一样的吗|一样吗|同一种|同一物|是不是同/.test(String(question || '')) &&
      /同一种|同一物|别称|别名|两个名字|又叫|也称|就是|其实是|学名|另一种叫法/.test(text)) return true;
  return false;
}
function acceptableAnswer(question, answer) {
  return isHonestRefusal(answer) || answerAddresses(question, answer);
}
// 两次都答非所问时的兜底（需求文档 3.1 三分支）：
// 情况 B——问题命中了库里某个水果（contexts 里有「X·四时素材」）但没有对应细分知识点：
//   固定模板直出，不再调模型，绝不把其他水果的片段塞进回答（硬隔离，防止串素材）。
// 无水果命中——保持通用诚实话术。
function refusalFallback(question, contexts) {
  const fruits = (Array.isArray(contexts) ? contexts : [])
    .map(item => (item && typeof item.name === 'string' ? item.name.split('·')[0] : ''))
    .filter(name => FRUIT_TERMS.has(name));
  const unique = [...new Set(fruits)];
  if (unique.length === 1) {
    const fruit = unique[0];
    return '四时素材库收录有' + fruit + '的相关资料，但暂未收录您询问的这一条记载。'
      + '您可以尝试询问' + fruit + '的时令、吃法、农谚等其他相关问题。';
  }
  return '这个问题我答不准：你问的「' + String(question || '').slice(0, 120) + '」，素材库里没有能直接回答它的内容，我不能瞎编。可以换个问法，比如问某种水果的时令、挑选、吃法或习俗。';
}

// 拒答也要指路（2026-10-01 用户反馈）：面向游客与长辈，很多用户不知道能问什么，
// 拒答不带建议问法等于把人一直关在门外，只会越问越生气。拒答稿一律保证带
// followUps（模型没给就由服务端兜底补两条），建议都是已验证可答的通用方向。
const REFUSAL_GUIDE = ['当季吃什么水果好？', '怎么挑西瓜？'];
function withRefusalGuide(parsed) {
  if (parsed.followUps && parsed.followUps.length) return parsed;
  return { ...parsed, followUps: REFUSAL_GUIDE.slice() };
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum);
}

// —— 无水果名问题的服务端时令兜底（2026-10-01 泛化改造）——
// 新版客户端没命中水果时会自己拼当季时令包发上来；老版本客户端/异常请求
// contexts 可能为空。这里兜底：为空时服务端自己补一份当季时令包（当季果品
// 清单 + 本季节气札 + 相关农谚），保证任何问题都有资料可依，由模型按铁律
// 判断时令推荐、节气讲究或礼貌闲聊，而不是一上来就报「没有可依据的资料」。
function seasonalContexts() {
  let fruitCulture, farmProverbs, solarTermNotes;
  try { fruitCulture = require('./miniprogram/data/fruit-culture'); }
  catch (error) { fruitCulture = require('../miniprogram/data/fruit-culture'); }
  try { farmProverbs = require('./miniprogram/data/farm-proverbs'); }
  catch (error) { farmProverbs = require('../miniprogram/data/farm-proverbs'); }
  try { solarTermNotes = require('./miniprogram/data/solar-term-notes'); }
  catch (error) { solarTermNotes = require('../miniprogram/data/solar-term-notes'); }
  const month = new Date().getMonth() + 1;
  const seasonId = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
  const season = (fruitCulture.seasons || []).find(item => item.id === seasonId) || (fruitCulture.seasons || [])[0];
  if (!season) return [];
  const fruits = fruitCulture.seasonFruits(season) || [];
  const listText = fruits.map(fruit => {
    const first = (fruit.categories || [])[0];
    const intro = first ? cleanText(first.text, 60) : '';
    return '·' + fruit.name + (intro ? '：' + intro : '');
  }).join('\n');
  // 二十四节气全量收录（名称+一句话果事）：用户可能问任何节气的讲究（十月的用户
  // 就可能问立冬——立冬属冬季节气），只放当前季节会误拒答；当前季节的节气再附全文。
  const termList = (solarTermNotes.TERMS || [])
    .map(term => '·' + term.name + '（' + cleanText(term.headline, 40) + '）')
    .join('\n');
  const seasonTerms = (solarTermNotes.TERMS || [])
    .filter(term => term.season === season.id)
    .map(term => '·' + term.name + '：' + cleanText(term.text, 400))
    .join('\n');
  const termText = '二十四节气果事一览：\n' + termList + '\n\n本季节气详解：\n' + seasonTerms;
  const names = fruits.map(fruit => fruit.name);
  const proverbText = (farmProverbs.proverbs || [])
    .filter(item => names.some(name => String(item.text || '').indexOf(name) !== -1))
    .slice(0, 4)
    .map(item => '「' + cleanText(item.text, 60) + '」' + cleanText(item.note, 120))
    .join('\n');
  const contexts = [
    { name: '当季果品·' + season.name + '（' + season.months.join('-') + '月）', text: ('当前正当季的果品清单：\n' + listText).slice(0, 1800) },
    { name: '二十四节气札·' + season.name, text: termText.slice(0, 1800) }
  ];
  if (proverbText) contexts.push({ name: '农谚集', text: proverbText.slice(0, 600) });
  return contexts;
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求格式无效');
  const question = cleanText(body.question, 300);
  if (!question) throw new InputError('请输入问题');
  // 只保留 user/assistant 两类历史；system 等角色一律丢弃，客户端无法注入系统提示。
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
    .map(item => ({ role: item.role, content: cleanText(item.content, 800) }))
    .filter(item => item.content)
    .slice(-6);
  if (!Array.isArray(body.contexts)) throw new InputError('资料格式无效');
  let contexts = body.contexts.slice(0, 6).map(item => {
    const name = cleanText(item && item.name, 60);
    const text = cleanText(item && item.text, 1800);
    return name && text ? { name, text } : null;
  }).filter(Boolean);
  // 客户端没命中水果（泛时令/节气/闲聊问题）时 contexts 为空：服务端补当季时令包。
  if (!contexts.length) contexts = seasonalContexts();
  if (!contexts.length) throw new InputError('没有可依据的资料');
  return { question, history, contexts };
}

// 问题里的口语别称提示：问「提子是什么」时客户端会路由到葡萄资料，但问题原文
// 还是「提子」，模型不知道别称就会误判「资料与问题无关」而拒答。这里检测到
// 别名时在问题后面拼一行提示，让模型明确按本体果名回答。
function aliasHintOf(question) {
  const text = String(question || '');
  const hints = [];
  Object.keys(FRUIT_ALIASES).forEach(fruit => {
    FRUIT_ALIASES[fruit].forEach(alias => {
      // 别名提示语（需求文档 2.3 模板）：开头一句向用户说明商品名/古籍名的对应关系。
      if (text.indexOf(alias) !== -1) hints.push('用户问的「' + alias + '」是「' + fruit + '」的现代商品名/常见别称，相关中华果食文化按「' + fruit + '」调取。回答第一句必须先说明这层对应（示例：「' + alias + '是市面上对' + fruit + '的商业俗称，相关中华果食文化按「' + fruit + '」调取。」），再按「' + fruit + '」的本体资料作答，重点讲它在中国本土的时令、习俗与文化');
    });
  });
  return hints.join('；');
}
function buildMessages({ question, history, contexts }, corrective = false) {
  // 资料名形如「西瓜·四时素材」，取「·」前的果名查分类标签，拼进证据标题。
  // 查不到标签的资料（农谚集等）保持原名，模型按铁律九不强行标注。
  const evidence = contexts.map(item => {
    const tag = FRUIT_TAGS.get(String(item.name).split('·')[0]);
    return '【' + item.name + (tag ? '｜' + tag : '') + '】' + item.text;
  }).join('\n');
  const aliasHint = aliasHintOf(question);
  const userContent = '资料：\n' + evidence + '\n\n问题：' + question + (aliasHint ? '\n（别称说明：' + aliasHint + '）' : '');
  const messages = [{ role: 'system', content: SYSTEM_FULL }];
  history.forEach(item => messages.push({ role: item.role, content: item.content }));
  messages.push({ role: 'user', content: userContent });
  if (corrective === 'refocus') {
    // 答点守卫触发后的重答指令：仍基于同一份资料，只纠正「没回应问点」这一件事。
    messages.push({
      role: 'user',
      content: '刚才的回答没有回应问题的问点。请重新回答：第一句直接回应「' + question + '」问的到底是什么。如果资料回应不了问点，按顺序判断：是挑选、保存、清洗、吃法等生活实用问题就按通用生活常识直答（末尾标注「以上是通用生活小常识，非文献资料」）；是当季/应季吃什么、节气讲究等时令问题就依据资料里的当季果品清单与节气札作答；是文化知识且素材缺失就基于公认的中华农耕文化常识整理回答（不编造古籍、人名、年代、数字，末尾标注「以上为通用文化常识，非文献资料」）；若资料明确属于某一水果却缺这一条知识点，按模板回答「四时素材库收录有该果的相关资料，但暂未收录您询问的这一条记载」，并建议改问该果的时令、吃法、农谚；都不是才在第一句写「素材库里没有……」。如果是对比类问题，严禁用糖分、维生素等营养学指标，优先从农耕农时、本草食养、古籍文学、民俗寓意四个维度对比，且只允许使用被点名的那两种水果的资料。仍然只输出 JSON。'
    });
  } else if (corrective === 'verifyRefusal') {
    // 拒答复核：模型说「没有」时再核对一次——能答则答（防假拒答），补充必须逐句来自资料（防拒答内编造）。
    messages.push({
      role: 'user',
      content: '请再逐条核对一遍资料后再回答「' + question + '」：如果资料里有任何内容能回应问点（哪怕角度不同、只覆盖一部分、用词和问题不一样），就直接回答，不要拒答。如果资料确实回应不了，按顺序判断：生活实用问题按通用生活常识直答（末尾标注「以上是通用生活小常识，非文献资料」）；时令问题依据资料里的当季果品清单与节气札作答；文化知识基于公认的中华农耕文化常识整理回答（不编造古籍、人名、年代、数字，末尾标注「以上为通用文化常识，非文献资料」）；仍不行才保持「素材库里没有……」的拒答。对比类问题严禁用营养学指标，优先农耕农时、本草食养、古籍文学、民俗寓意四个维度。另外请逐条检查你上一稿补充的内容：凡是资料里没有的具体出处（古籍名、篇目、人名、年代、数字）一律删掉，拿不准就不写。仍然只输出 JSON。'
    });
  }
  return messages;
}

function parseAnswer(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed = null;
  try { parsed = JSON.parse(text); }
  catch {
    const brace = text.match(/{[\s\S]*}/);
    if (brace) { try { parsed = JSON.parse(brace[0]); } catch {} }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
    if (!answer) throw new InputError('回答为空', 'model_invalid_output', 502);
    const usedEvidence = Array.isArray(parsed.usedEvidence)
      ? parsed.usedEvidence.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 4)
      : [];
    const followUps = Array.isArray(parsed.followUps)
      ? parsed.followUps.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 24)).filter(Boolean).slice(0, 2)
      : [];
    return { answer, usedEvidence, followUps };
  }
  // 完全解析不出 JSON 时的兜底：模型（尤其未关闭思考的 DeepSeek）可能直接输出
  // 散文。正文非空就按纯文本回答采信——系统提示已约束只依据资料作答，只是失去
  // 结构化字段；JSON 壳里的空回答不算散文，仍按「回答为空」报错。
  const prose = text.trim();
  if (prose) return { answer: prose.slice(0, 1200), usedEvidence: [], followUps: [] };
  throw new InputError('回答为空', 'model_invalid_output', 502);
}

function createChatService(config, fetchImpl = globalThis.fetch, sdk) {
  // CloudBase SDK 通道模型（懒初始化）：小程序成长计划仅允许「云开发 SDK」调用 AI，
  // HTTP 直连网关会被拒（AI_CHANNEL_NOT_ALLOWED）。与 provider.js 共用同一工厂。
  let cloudbaseModel = null;
  // 单次模型调用：组包、请求、取正文。守卫重答复用同一路径，错误类型不变。
  async function callModelOnce(messages, timeoutMs) {
    if (config.provider === 'cloudbase') {
      // SDK 调用不走 AbortController（SDK 内部按 init timeout 控制），超时语义由 callModel 重试兜底。
      if (!cloudbaseModel) cloudbaseModel = createCloudbaseModel(config, sdk);
      let result;
      try {
        result = await cloudbaseModel.generateText({
          model: config.model,
          messages,
          temperature: 0.3,
          max_tokens: 900,
          // hy3 是思考型模型：不关思考 token 全烧在 reasoning_content 上，content 为空。
          thinking: { type: 'disabled' }
        });
      } catch (error) {
        throw new InputError('对话服务暂不可用', 'model_unavailable', 502);
      }
      if (result && result.error) throw new InputError('对话服务响应异常', 'model_http_error', 502);
      const content = result && result.text;
      if (typeof content !== 'string' || !content.trim()) throw new InputError('回答为空', 'model_empty_response', 502);
      return content;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const payload = {
        model: config.model,
        messages,
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: 'json_object' }
      };
      // 与 provider.js 同款补丁：DeepSeek 思考模型的 reasoning 会挤占输出预算，
      // 关闭思考才能稳定拿到 JSON 终稿。
      try { if (new URL(config.providerBase).hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' }; }
      catch (error) {}
      response = await fetchImpl(config.providerBase + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.providerKey ? { authorization: 'Bearer ' + config.providerKey } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new InputError('回答超时，请重试', 'model_timeout', 504);
      throw new InputError('对话服务暂不可用', 'model_unavailable', 502);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
      throw new InputError('对话服务响应异常', 'model_http_error', 502);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new InputError('对话服务响应异常', 'model_invalid_json', 502);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new InputError('回答为空', 'model_empty_response', 502);
    return content;
  }

  // 模型调用最多重试 2 次：偶发的空响应/超时通过重试兜底，避免把临时故障抛给用户。
  async function callModel(messages) {
    const timeoutMs = config.timeoutMs || 30000;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // 首次 30 秒，每次重试增加 15 秒，给慢启动模型更宽容的时间。
        return await callModelOnce(messages, timeoutMs + attempt * 15000);
      } catch (error) {
        lastError = error;
        // 用户输入校验/配置类错误不重试，直接抛；可恢复错误才重试。
        if (error.code && ['model_disabled', 'model_invalid_output'].indexOf(error.code) !== -1) throw error;
      }
    }
    throw lastError;
  }

  async function answer(body) {
    const input = validateBody(body);
    if (config.provider === 'disabled' || !config.providerBase) {
      throw new InputError('对话服务未配置', 'model_disabled', 503);
    }
    const parsed = parseAnswer(await callModel(buildMessages(input)));
    if (!isHonestRefusal(parsed.answer) && acceptableAnswer(input.question, parsed.answer)) {
      return { ...parsed, mode: 'chat-evidence' };
    }
    if (isHonestRefusal(parsed.answer)) {
      // 拒答复核（防假拒答/拒答内编造）：拒答稿一律再核对一次——能答则答；
      // 复核后仍拒答则维持一稿拒答。复核失败（超时/网络/格式）也维持一稿，不放大故障。
      let verified = null;
      try {
        verified = parseAnswer(await callModel(buildMessages(input, 'verifyRefusal')));
      } catch (error) {
        verified = null;
      }
      if (verified && !isHonestRefusal(verified.answer) && acceptableAnswer(input.question, verified.answer)) {
        return { ...verified, mode: 'chat-evidence', guarded: true };
      }
      return withRefusalGuide({ ...parsed, mode: 'chat-evidence', guarded: true });
    }
    // 答点守卫：第一稿与问点无关（既不覆盖问点词、也不是诚实拒答）→ 带纠正指令重答一次。
    let retried = null;
    try {
      retried = parseAnswer(await callModel(buildMessages(input, 'refocus')));
    } catch (error) {
      // 重答失败（超时/网络/格式）不再向上抛：一稿已判定答非所问，宁可拒答也不返回偏题内容。
      retried = null;
    }
    if (retried && acceptableAnswer(input.question, retried.answer)) {
      if (!isHonestRefusal(retried.answer)) return { ...retried, mode: 'chat-evidence', guarded: true };
      // 纠正重答转成了拒答：同样过一遍拒答复核，避免「重答被推成假拒答」。
      let verified = null;
      try {
        verified = parseAnswer(await callModel(buildMessages(input, 'verifyRefusal')));
      } catch (error) {
        verified = null;
      }
      if (verified && !isHonestRefusal(verified.answer) && acceptableAnswer(input.question, verified.answer)) {
        return { ...verified, mode: 'chat-evidence', guarded: true };
      }
      return withRefusalGuide({ ...retried, mode: 'chat-evidence', guarded: true });
    }
    // 情况 B（命中的果在库里但缺该知识点）：固定模板 + 该果可答方向的建议问法，不再调模型。
    const targetFruit = (input.contexts || [])
      .map(item => (item && typeof item.name === 'string' ? item.name.split('·')[0] : ''))
      .filter(name => FRUIT_TERMS.has(name))[0];
    const guide = targetFruit ? [targetFruit + '几月成熟？', targetFruit + '有什么吃法？'] : REFUSAL_GUIDE.slice();
    return { answer: refusalFallback(input.question, input.contexts), usedEvidence: [], followUps: guide, mode: 'chat-evidence', guarded: true };
  }

  // 果乡名片 AI 润色（P13 果农工作台）：复用同一模型通道，把果农写的介绍润色成温暖短文。
  async function polish({ description, term, fruit }) {
    if (config.provider === 'disabled' || !config.providerBase) {
      throw new InputError('对话服务未配置', 'model_disabled', 503);
    }
    const system = '你是「果物四时记」小程序里的果乡文案助手。任务：把果农写的一段果乡介绍，润色成温暖、有乡土气息、适合游客阅读的短文，100字以内。保留原文的真实信息（地名、人物、果树、节气），不编造、不夸大功效、不出现具体数字。只输出润色后的文字，不要解释、不要引号、不要 JSON 外壳。';
    const user = '节气：' + (term || '当季') + '\n水果：' + (fruit || '当地水果') + '\n原文：' + (description || '');
    const raw = await callModel([{ role: 'system', content: system }, { role: 'user', content: user }]);
    let polished = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const brace = polished.match(/\{[\s\S]*\}/);
    if (brace) { try { const obj = JSON.parse(brace[0]); const val = obj.polishedText || obj.text || obj.answer; if (typeof val === 'string' && val.trim()) polished = val.trim(); } catch (_) {} }
    return { polishedText: cleanText(polished, 300) || description };
  }

  // 解析 challenge/match 的结构化输出，失败时返回 null，由客户端本地数据兜底。
  function parseStructured(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch (error) { const brace = text.match(/\{[\s\S]*\}/); if (brace) { try { parsed = JSON.parse(brace[0]); } catch (error2) {} } }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  }

  // —— 知识库写回：服务端本地文件持久化每题「原因 + 由来」讲解，下次同题优先读取，缺失才现场生成。
  // 2026-10-09 第23 轮：从"只写由来"升级成"原因 + 由来"两段，缓存值也从单个字符串升级成对象；
  // 键前面加 v2，老的（单段）缓存自然失效，不会被读成新结构。
  const KB_FILE = path.join(os.tmpdir(), 'guayouji-challenge-knowledge.json');
  function kbLoad() {
    try { const raw = fs.readFileSync(KB_FILE, 'utf8'); const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
  }
  function kbSave(obj) { try { fs.writeFileSync(KB_FILE, JSON.stringify(obj, null, 2)); } catch (e) {} }
  function kbKey(fruit, term, category) { return 'v2|' + fruit + '|' + term + '|' + category; }
  function kbGet(fruit, term, category) {
    const all = kbLoad();
    const v = all[kbKey(fruit, term, category)];
    if (!v || typeof v !== 'object') return null;
    const cause = typeof v.cause === 'string' ? v.cause : '';
    const origin = typeof v.origin === 'string' ? v.origin : '';
    return (cause || origin) ? { cause: cause, origin: origin } : null;
  }
  function kbSet(fruit, term, category, knowledge) {
    if (!knowledge || (!knowledge.cause && !knowledge.origin)) return;
    const all = kbLoad();
    all[kbKey(fruit, term, category)] = { cause: knowledge.cause || '', origin: knowledge.origin || '' };
    kbSave(all);
  }
  // 两段拼成客户端认识的 knowledgePoints（客户端的知识卡就是逐条渲染这个数组）
  function knowledgePointsOf(knowledge) {
    const out = [];
    if (knowledge && knowledge.cause) out.push('原因：' + knowledge.cause);
    if (knowledge && knowledge.origin) out.push('由来：' + knowledge.origin);
    return out;
  }

  // 农事挑战：针对一道「水果 × 困境」题，输出「原因」+「由来」两段讲解（各约 40-70 字）、果灵寄语。
  // 优先级（2026-10-09 第24 轮）：随包发布的知识库（miniprogram/data/challenge-explanations.js，按题 id 写好）
  //   → 本地临时缓存（AI 生成过的）→ 现调 AI。
  let challengeExplicit = null;
  try { challengeExplicit = require('../miniprogram/data/challenge-explanations'); } catch (e) { challengeExplicit = null; }
  function explicitFor(id) {
    if (!challengeExplicit || !id) return null;
    const e = challengeExplicit[id];
    if (!e || (!e.cause && !e.origin)) return null;
    return { cause: e.cause || '', origin: e.origin || '' };
  }
  async function challenge(input) {
    // 知识库是随包发布的静态内容，**先查它**：命中了就不需要模型（模型没配/挂了也能出两段）。
    const explicit = explicitFor(input.questionId);
    if (explicit) {
      return { correct: input.isCorrect === true, explanation: '', knowledgePoints: knowledgePointsOf(explicit), elfMessage: '' };
    }
    if (config.provider === 'disabled' || !config.providerBase) throw new InputError('对话服务未配置', 'model_disabled', 503);
    const cached = kbGet(input.fruit, input.term, input.category);
    if (cached) {
      return { correct: input.isCorrect === true, explanation: '', knowledgePoints: knowledgePointsOf(cached), elfMessage: '' };
    }
    const system = '你是「果物四时记」小程序的 AI 文化助手「果灵」，正在陪用户玩「农事挑战」游戏。用户刚回答了一道关于水果在特定节气下农事、民俗、储存、食用、礼节或灾害方面的情境选择题。你是陪玩的朋友，语气温暖、鼓励为主。只依据给出的知识库相关段落作答，不编造农事或民俗事实；若知识库段落为空，也需基于公开可靠常识给出讲解，禁止空泛口号。只输出 JSON：{"correct":true/false,"cause":"原因","origin":"由来","elfMessage":"果灵寄语"}。\n要求：\n1. correct 用输入里的 isCorrect 原样回显。\n2. cause 写「原因」：为什么会这样 —— 讲清气候、生理或农事上的道理（为什么这个节气会出现这种困境、为什么这样做才对），约 40-70 字，一段连贯的话，不要分点、不要复述选项原文。\n3. origin 写「由来」：这个讲究或做法从哪来 —— 讲清历史源流、典籍农谚依据、古法或民俗传承，约 40-70 字，一段连贯的话，不要分点、不要复述选项原文，且不要与原因重复。\n4. 材料里确实没有把握的那一段就留空字符串，不要硬编。\n5. elfMessage 保持温暖鼓励（20-40 字），不重复上面两段内容。';
    const user = '节气：' + (input.term || '') + '\n水果：' + (input.fruit || '') + '\n困境类型：' + (input.category || '') + '\n情境：' + (input.situation || '') + '\n用户选择：' + (input.userChoice || '') + '\n是否正确：' + (input.isCorrect ? '是' : '否') + '\n知识库相关段落：\n' + (input.context || '');
    const parsed = parseStructured(await callModel([{ role: 'system', content: system }, { role: 'user', content: user }]));
    if (!parsed) throw new InputError('对话服务返回异常', 'model_invalid_output', 502);
    const knowledge = { cause: cleanText(parsed.cause, 90), origin: cleanText(parsed.origin, 90) };
    const points = knowledgePointsOf(knowledge);
    if (points.length) kbSet(input.fruit, input.term, input.category, knowledge);
    return {
      correct: parsed.correct === true,
      explanation: cleanText(parsed.explanation, 120),
      knowledgePoints: points,
      elfMessage: cleanText(parsed.elfMessage, 60)
    };
  }

  // 文化连连看：针对一对「水果 × 文化标签」，输出点评与文化讲解。
  // 只依据文化库原文作答，不编造诗词、典故、产地或用途。
  async function match(input) {
    if (config.provider === 'disabled' || !config.providerBase) throw new InputError('对话服务未配置', 'model_disabled', 503);
    const system = '你是「果物四时记」小程序的 AI 文化助手「果灵」，正在陪用户玩「文化连连看」游戏。用户刚把一种水果和一个文化标签配成一对。你是陪玩的朋友，语气温暖、鼓励为主。只依据给出的文化库原文作答，不编造诗词、典故、产地或用途。只输出 JSON：{"correct":true/false,"comment":"点评正文（150字以内）","knowledge":"文化讲解正文（150字以内）"}。correct 用输入里的 isCorrect 原样回显。';
    const user = '水果：' + (input.fruit || '') + '\n标签类别：' + (input.category || '') + '\n标签内容：' + (input.label || '') + '\n配对是否正确：' + (input.isCorrect ? '是' : '否') + '\n该条依据的文化库原文：\n' + (input.context || '');
    const parsed = parseStructured(await callModel([{ role: 'system', content: system }, { role: 'user', content: user }]));
    if (!parsed) throw new InputError('对话服务返回异常', 'model_invalid_output', 502);
    return {
      correct: parsed.correct === true,
      comment: cleanText(parsed.comment, 160),
      knowledge: cleanText(parsed.knowledge, 160)
    };
  }

  return { answer, polish, challenge, match, capabilities: { chat: config.provider !== 'disabled', model: config.provider !== 'disabled' ? config.model : '' } };
}

module.exports = { createChatService, SYSTEM, validateBody, buildMessages, parseAnswer, focusTermsOf, answerAddresses, isHonestRefusal, refusalFallback, aliasHintOf };
