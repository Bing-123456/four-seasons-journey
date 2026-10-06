'use strict';

// 果灵对话：P16 搜索页改版为「与果灵对话」。
// 回答路径与证据约束主线一致：
// ① 客户端检索四时素材库（matchFruits + 农谚）→ ② 资料作为证据随问题发给
//    /api/chat，模型只允许依据资料组织口语回答，并标注引用与建议追问；
// ③ 云端不可用/超时/回答异常时，降级为本地 composeAnswer（离线检索兜底），
//    不编造新的农谚、民俗、果农故事；素材不足时明确标注。
// 语音输入（评审增强）：原生录音 + 服务端 /api/asr 识别，只要输入、不需要输出。
const fruitCulture = require('../../data/fruit-culture');
const fruitScope = require('../../data/fruit-scope');
const farmProverbs = require('../../data/farm-proverbs');
const solarTermNotes = require('../../data/solar-term-notes');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const media = require('../../lib/media-service');
const { createSpeechInput } = require('../../lib/speech-input');
const chatHistory = require('../../lib/chat-history');

const RECENT_KEY = 'guoling.search.recent.v1';
const CAT_LABEL = { folk: 'ans_cat_folk', history: 'ans_cat_history', craft: 'ans_cat_craft', story: 'ans_cat_story', tools: 'ans_cat_tools', health: 'ans_cat_health' };
const CAT_NAMES = { folk: '农谚与时令', history: '历史渊源', craft: '传统手艺', story: '果农故事', tools: '农具与劳作', health: '食养习俗' };
const catLabel = cat => i18n.t(CAT_LABEL[cat] || cat);

function readRecent() {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const value = wx.getStorageSync(RECENT_KEY);
      return Array.isArray(value) ? value.slice(0, 8) : [];
    }
  } catch (error) {}
  return [];
}
function writeRecent(list) {
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(RECENT_KEY, list.slice(0, 8)); } catch (error) {}
}

// P16 修复「答案与问题没有逻辑关系」：
// ① 问题里出现与水果无关的常见复合词（如「苹果手机」「梅雨」）时，先剔除再检索，
//    避免单字别名把这些词误当成水果，拼出与提问无关的回答。
const NON_FRUIT_COMPOUNDS = ['苹果手机', '苹果电脑', '苹果系统', '凤梨花', '凤梨酥', '梅雨季', '梅雨', '酸梅汤', '话梅', '梨花木', '芭蕉扇', '芭蕉叶', '樱桃小丸子'];
// 单字别名的排斥词：问题里出现这些词时，说明该字并非指这种水果。
const ALIAS_BLOCKS = { 秋梨: ['凤梨', '梨花木'], 青梅: ['梅雨', '酸梅', '话梅'], 桃子: ['樱桃', '猕猴桃', '杨桃', '核桃', '胡桃', '樱桃'], 李子: ['行李'] };
function stripNonFruit(question) {
  let text = question;
  NON_FRUIT_COMPOUNDS.forEach(word => { text = text.split(word).join(' '); });
  return text;
}

// —— 问点词与相关性排序（2026-09-28 答非所问修复，与服务端 focusTermsOf 同源思路）——
// 抽「双实义字」词作为问点词，统计资料分块与问题的问点词重合数：相关分块排在上下文前面。
// 作用有二：模型优先看到与问点相关的材料，不容易被无关维度带偏；1800 字截断优先保住
// 相关分块，不再可能把最相关的内容截掉。纯词法重合，不含任何具体问题的特判。
const FUNCTION_CHARS = '的一是在了有和与跟对对于会被把不没就都很也还又并或者吗呢吧啊呀么什怎啥这那哪此如为因所但而且如果到从给让用叫要能想请说告诉知道可应该';
function focusTermsOf(text) {
  const terms = [];
  const segments = String(text || '').match(/[\u4e00-\u9fa5]+/g) || [];
  segments.forEach(segment => {
    for (let i = 0; i + 1 < segment.length; i += 1) {
      const pair = segment.slice(i, i + 2);
      if (FUNCTION_CHARS.indexOf(pair[0]) === -1 && FUNCTION_CHARS.indexOf(pair[1]) === -1 && terms.indexOf(pair) === -1) terms.push(pair);
    }
  });
  return terms;
}
function relevanceScore(question, text) {
  const terms = focusTermsOf(question);
  if (!terms.length) return 0;
  return terms.reduce((sum, term) => sum + (String(text || '').indexOf(term) !== -1 ? 1 : 0), 0);
}

// 口语别名路由表：命中别名时替换为本体名再检索资料，只做路由不改资料内容。
// 全部为常见口语、商品名、品种名或写法变体（提子=葡萄、桂圆=龙眼、车厘子=樱桃……），
// 与 server/chat.js 的 FRUIT_ALIASES 保持同源，两边一起改。
// 2026-10-01 合入用户整理并人工审核的《现代别名→古籍果名》字典（约 90 组，需求文档任务 1）。
// 数组内按「长词在前」排列：先替换长别名再替换短别名，保证「脆柿子→脆柿→柿子」
// 「阳光玫瑰葡萄→阳光玫瑰→葡萄」这类最长匹配不被短词破坏（需求文档注意事项 1）。
const FRUIT_ALIASES = {
  // —— 本土原生果 ——
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
  // —— 外来引种·本土化果 ——
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

// 语音/手写常见错字纠错：把同声字、形近字先替换成正确别名，再走别名归一化。
// 例如微信语音把「番荔枝」识别成「番茄枝」，直接 here 纠正为「番荔枝」，否则后续别名
// 表里「番荔枝→释迦」无法命中。
const VOICE_MISRECOGNITIONS = {
  '番茄枝': '番荔枝',
  '山竺': '山竹',
  '百相果': '百香果',
  '忙果': '芒果',
  '鸡旦果': '鸡蛋果'
};
function correctVoiceErrors(text) {
  let normalized = text;
  Object.keys(VOICE_MISRECOGNITIONS).forEach(wrong => {
    if (normalized.indexOf(wrong) !== -1) normalized = normalized.split(wrong).join(VOICE_MISRECOGNITIONS[wrong]);
  });
  return normalized;
}

// 归一化替换：问题里的别名先替换成本体名（「番荔枝好吃吗」→「释迦好吃吗」），
// 替换法天然避免子串误伤——替换后文本不再含「荔枝」，不会同时命中荔枝本体。
function normalizeAliases(text) {
  let normalized = text;
  Object.keys(FRUIT_ALIASES).forEach(fruit => {
    FRUIT_ALIASES[fruit].forEach(alias => {
      if (normalized.indexOf(alias) !== -1) normalized = normalized.split(alias).join(fruit);
    });
  });
  return normalized;
}

// 从问题里识别提到的水果（支持“李子和杏子有什么区别”这类对比问法）。
// 覆盖链图全部节点：内圈当季水果与外圈世界风物都能被检索到。
function matchFruits(question) {
  const hits = [];
  const text = normalizeAliases(correctVoiceErrors(stripNonFruit(question)));
  // 长果名清单（≥2 字）：用于「单字被长名占用」判定——问题里出现「冬枣」时不再把
  // 单字「枣」当独立水果（冬枣、椰枣之于枣；杨梅、青梅之于梅；猕猴桃、樱桃之于桃）。
  const longNames = [];
  fruitCulture.seasons.forEach(season => fruitCulture.seasonFruits(season).forEach(fruit => {
    if (fruit.name.length >= 2) longNames.push(fruit.name);
  }));
  fruitCulture.seasons.forEach(season => {
    fruitCulture.seasonFruits(season).forEach(fruit => {
      const names = [fruit.name];
      if (fruit.name === '秋梨') names.push('梨');
      if (fruit.name === '青梅') names.push('梅');
      // 「*子」类果名的单字根（桃木/李树这类问法仍能路由到对应水果）；排斥词防止樱桃、猕猴桃误伤。
      if (fruit.name === '桃子') names.push('桃');
      if (fruit.name === '李子') names.push('李');
      // 「柿饼上的霜」这类问法不含「柿子」二字，单字根「柿」无歧义，直接路由。
      if (fruit.name === '柿子') names.push('柿');
      names.forEach(name => {
        // 单字名只在问题里确实指这种水果时命中：
        // ① 出现排斥词（凤梨之对梨、梅雨之对梅、核桃之对桃）时跳过；
        // ② 单字已被更长的果名占用（问「冬枣」时不重复命中「枣」）时跳过。
        const alias = name.length === 1 && name !== fruit.name;
        if (name.length === 1 && longNames.some(long => long !== fruit.name && long.indexOf(name) !== -1 && text.indexOf(long) !== -1)) return;
        if (alias && ALIAS_BLOCKS[fruit.name] && ALIAS_BLOCKS[fruit.name].some(word => text.indexOf(word) !== -1)) return;
        // 同一水果可能跨季节出现（如柚子在 autumn/winter），按 fruit.name 去重避免本地兜底重复输出同一条目。
        if (text.indexOf(name) !== -1 && !hits.some(hit => hit.fruit.name === fruit.name)) hits.push({ seasonId: season.id, seasonName: season.name, fullId: season.id + '-' + fruit.id, fruit });
      });
    });
  });
  return hits;
}

// 从跳转卡的 fullId 反查水果命中对象，供追问（followUp）继承上文上下文使用。
function fruitsFromChips(chips) {
  if (!Array.isArray(chips) || !chips.length) return [];
  const hits = [];
  for (const chip of chips) {
    if (!chip || typeof chip.fullId !== 'string') continue;
    const idx = chip.fullId.lastIndexOf('-');
    if (idx <= 0 || idx >= chip.fullId.length - 1) continue;
    const seasonId = chip.fullId.slice(0, idx);
    const fruitId = chip.fullId.slice(idx + 1);
    const season = fruitCulture.seasons.find(s => s.id === seasonId);
    if (!season) continue;
    const fruit = (fruitCulture.seasonFruits(season) || []).find(f => f.id === fruitId);
    if (!fruit) continue;
    if (!hits.some(hit => hit.fullId === chip.fullId)) {
      hits.push({ seasonId, seasonName: chip.seasonName || season.name || '', fullId: chip.fullId, fruit });
    }
  }
  return hits;
}

function catOf(fruit, cat) {
  const found = (fruit.categories || []).find(item => item.cat === cat);
  return found || null;
}

// 农谚与水果的显式归属：老 5 条是跨品类通用谚语，按字面对应到库内水果，
// 瓜类谚语对所有带「瓜」的果名通用；不做单字模糊匹配，避免「桃子」误配「樱桃」农谚。
// 2026-10-01 农谚扩展：新增 37 条覆盖全部 42 种水果，每果至少命中一条。
const PROVERB_FRUITS = {
  '樱桃好吃树难栽，不下功夫花不开。': ['樱桃'],
  '谷雨前后，种瓜点豆。': '@瓜',
  '桃三杏四梨五年。': ['桃子', '杏', '秋梨'],
  '七月核桃八月梨，九月柿子乱赶集。': ['柿子', '秋梨'],
  '芒种煮青梅，暑气不缠身。': ['青梅'],
  '桑椹紫，麦梢黄，孩童染得满嘴香。': ['桑葚'],
  '小满枇杷半坡黄。': ['枇杷'],
  '谷雨草莓红，酸甜正当令。': ['草莓'],
  '桃养人，杏伤人，李子树下埋死人。': ['李子', '杏', '桃子'],
  '一颗荔枝三把火。': ['荔枝'],
  '南方桂圆北方参。': ['龙眼'],
  '夏至杨梅满山红，小暑杨梅要出虫。': ['杨梅'],
  '白露葡萄串，霜降甜如蜜。': ['葡萄'],
  '芒果花开暖，立夏果才甜。': ['芒果'],
  '香蕉青时摘，黄时香到家。': ['香蕉'],
  '菠萝泡盐水，嘴不刺来心不烦。': ['菠萝'],
  '八月半，石榴笑，裂嘴露籽红玛瑙。': ['石榴'],
  '霜降苹果甜，过了立冬酸。': ['苹果'],
  '七月十五枣红圈，八月十五枣落竿。': ['枣'],
  '秋分猕猴桃，酸甜刚刚好。': ['猕猴桃'],
  '寒露山楂红，霜降串糖葫。': ['山楂'],
  '中秋柚子圆，阖家分甘酸。': ['柚子'],
  '立冬砂糖橘，一剥满堂香。': ['砂糖橘'],
  '冬至瓯柑甜，藏到过年鲜。': ['瓯柑'],
  '立冬枣子脆，赛过雪花梨。': ['冬枣'],
  '腊月金桔黄，泡茶化痰忙。': ['金桔'],
  '火龙果花开夜，人工点花赶日头。': ['火龙果'],
  '释迦软了才够甜，硬果催熟放米边。': ['释迦'],
  '霜降木瓜黄，家常煲汤忙。': ['木瓜'],
  '杨桃横切五角星，端午前后最清鲜。': ['杨桃'],
  '山竹紫衣绿蒂鲜，按壳微软才够甜。': ['山竹'],
  '饥食荔枝，饱食黄皮。': ['黄皮', '荔枝'],
  '吐鲁番的葡萄，哈密的瓜。': ['哈密瓜', '葡萄'],
  '立冬食蔗齿不痛。': ['甘蔗'],
  '文昌椰子半海南。': ['椰子'],
  '白露无花果，润喉又润肠。': ['无花果'],
  '霜降脐橙黄，冬至甜过糖。': ['脐橙'],
  '百香果皮皱一分，甜到十分。': ['百香果'],
  '椰枣甜如蜜，驼铃万里来。': ['椰枣'],
  '立秋啃西瓜，秋老虎不咬人。': ['西瓜'],
  '宜母子蜜渍，酸香开胃。': ['柠檬']
};
function proverbMatches(fruitName, text) {
  const fruits = PROVERB_FRUITS[text];
  if (!fruits) return false;
  if (fruits === '@瓜') return fruitName.indexOf('瓜') !== -1;
  return fruits.indexOf(fruitName) !== -1;
}

// 组装结构化回答：【农谚与时令】【乡土食养与习俗】【拓展科普】+ 素材不足标注。
// P16 附带：本页回答只保留中文，不再提供英文译文切换。
// 9.27 反馈：各块内容与标题严格对应——「农谚与时令」只放真农谚与时令信息，
// 民俗仪式类正文（folk）移入「乡土食养与习俗」，避免出现标题讲农谚、正文讲人情往来的错位。
function composeAnswer(fruits, question) {
  const compare = fruits.length >= 2;
  const titleFarming = i18n.t('answer_farming');
  const titleFood = i18n.t('answer_food');
  const titleExtra = i18n.t('answer_extra');
  const titleCompare = '一句话对比';
  const noFarmingNote = '素材库暂无{name}的农谚条目';
  const noFoodNote = '素材库暂有条目待补充';
  const craftPrefix = '传统手艺：';
  const blocks = [];
  let thinMaterial = false;
  const farming = fruits.map(hit => {
    const proverb = farmProverbs.proverbs.find(item => proverbMatches(hit.fruit.name, item.text));
    const parts = [];
    if (proverb) parts.push(i18n.t('search_proverb_a') + proverb.text + i18n.t('search_proverb_b') + proverb.note + i18n.t('search_proverb_c'));
    else { parts.push(noFarmingNote.replace('{name}', hit.fruit.name)); thinMaterial = true; }
    const season = fruitCulture.seasons.find(item => item.id === hit.seasonId);
    if (season) parts.push('时令：' + hit.seasonName + '（' + season.months[0] + '-' + season.months[season.months.length - 1] + ' 月）');
    return '【' + hit.fruit.name + '】' + parts.join('');
  });
  blocks.push({ title: titleFarming, text: farming.join('\n') });
  const food = fruits.map(hit => {
    const folk = catOf(hit.fruit, 'folk');
    const health = catOf(hit.fruit, 'health');
    const craft = catOf(hit.fruit, 'craft');
    const parts = [];
    if (folk) parts.push(folk.text);
    if (health) parts.push(health.detail);
    if (craft) parts.push(craftPrefix + craft.text);
    if (!parts.length) thinMaterial = true;
    return '【' + hit.fruit.name + '】' + (parts.join(' ') || noFoodNote.replace('{name}', hit.fruit.name));
  });
  blocks.push({ title: titleFood, text: food.join('\n') });
  const extra = fruits.map(hit => {
    const history = catOf(hit.fruit, 'history');
    if (!history) { thinMaterial = true; return '【' + hit.fruit.name + '】' + noFoodNote.replace('{name}', hit.fruit.name); }
    return '【' + hit.fruit.name + '】' + history.detail;
  });
  blocks.push({ title: titleExtra, text: extra.join('\n') });
  if (compare) blocks.push({ title: titleCompare, text: fruits.map(hit => hit.fruit.name).join(' 与 ') + '的关键差别见上方各段；两者成熟时节、吃法与养护重点都不同。' });
  return { blocks, thinMaterial, question };
}

// 拼接一条资料：正文（detail）已包含导语（text）时，不再重复贴一遍导语。
function composeCategoryText(cat) {
  const header = '【' + (CAT_NAMES[cat.cat] || cat.cat) + '】';
  const lead = cat.text || '';
  const detail = cat.detail || '';
  if (lead && detail.startsWith(lead)) return header + detail;
  return header + lead + (detail ? '　' + detail : '');
}

// 对话证据包：命中的水果（最多 3 个）各维度资料 + 相关农谚，交给 /api/chat 作答。
// 9.28 修复：各维度分块先按「与问点的问点词重合数」排序再拼接——相关材料在前，
// 无关材料在后，截断（1800 字）只可能吃掉无关尾巴，不再把最相关的内容截掉。
function buildContexts(fruits, question) {
  const contexts = fruits.slice(0, 3).map(hit => {
    const sections = (hit.fruit.categories || [])
      .map(cat => ({ cat, text: composeCategoryText(cat) }))
      .map((section, index) => Object.assign({}, section, { index, score: relevanceScore(question, section.text) }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map(section => section.text);
    return { name: hit.fruit.name + '·四时素材', text: sections.join('\n').slice(0, 1800) };
  });
  const proverbText = farmProverbs.proverbs
    .filter(item => fruits.some(hit => proverbMatches(hit.fruit.name, item.text)))
    .slice(0, 2)
    .map(item => '「' + item.text + '」' + item.note)
    .join('\n');
  if (proverbText) contexts.push({ name: '农谚集', text: proverbText.slice(0, 600) });
  return contexts;
}

// —— 无水果名问题的时令上下文（2026-10-01 泛化改造）——
// 真实用户常问「现在十月吃什么水果好」「立冬有什么讲究」这类不带水果名的问题，
// 旧版客户端检索不到水果就直接落本地兜底话术，AI 根本没机会回答。现在改为
// 自动拼一份「当季时令包」（当季果品清单 + 本季节气札 + 相关农谚）发给云端，
// 由模型依据资料作答；云端失败时才落本地兜底。
function currentSeasonId() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
function buildSeasonalContexts() {
  const season = fruitCulture.seasons.find(item => item.id === currentSeasonId()) || fruitCulture.seasons[0];
  const fruits = fruitCulture.seasonFruits(season) || [];
  const listText = fruits.map(fruit => {
    const first = (fruit.categories || [])[0];
    const intro = first ? String(first.text || '').replace(/\s+/g, '').slice(0, 50) : '';
    return '·' + fruit.name + (intro ? '：' + intro : '');
  }).join('\n');
  // 二十四节气全量收录（名称+一句话果事）：用户可能问任何节气的讲究（十月的用户
  // 就可能问立冬——立冬属冬季节气），只放当前季节会误拒答；当前季节的节气再附全文。
  const termList = solarTermNotes.TERMS.map(term => '·' + term.name + '（' + term.headline + '）').join('\n');
  const seasonTerms = solarTermNotes.TERMS
    .filter(term => term.season === season.id)
    .map(term => '·' + term.name + '：' + term.text)
    .join('\n');
  const termText = '二十四节气果事一览：\n' + termList + '\n\n本季节气详解：\n' + seasonTerms;
  const proverbText = farmProverbs.proverbs
    .filter(item => fruits.some(fruit => proverbMatches(fruit.name, item.text)))
    .slice(0, 4)
    .map(item => '「' + item.text + '」' + item.note)
    .join('\n');
  const contexts = [
    { name: '当季果品·' + season.name + '（' + season.months.join('-') + '月）', text: ('当前正当季的果品清单：\n' + listText).slice(0, 1800) },
    { name: '二十四节气札·' + season.name, text: termText.slice(0, 1800) }
  ];
  if (proverbText) contexts.push({ name: '农谚集', text: proverbText.slice(0, 600) });
  return contexts;
}

// 纯问候/道谢/告别：本地直接回应，不消耗模型调用。
const TRIVIAL_CHATS = [
  { match: /^(你好|您好|哈喽|嗨|hello|hi)[!！。～~\s]*$/i, reply: '你好呀，我是果灵🌱 四时果园里的小精灵。想聊哪种水果都可以，问我时令、挑选、吃法或习俗都行～' },
  { match: /^(谢谢|感谢|多谢|thanks|thank you)[!！。～~\s]*$/i, reply: '不客气～有果的问题随时来问我。' },
  { match: /^(再见|拜拜|bye)[!！。～~\s]*$/i, reply: '再见啦，四时果园随时欢迎你回来。' }
];

// 本地拒答的指路（与服务端 REFUSAL_GUIDE 同思路）：拒答不能是死胡同，
// 拒答的同时给两条可点的建议问法，帮不知道能问什么的用户找到入口。
const REFUSAL_GUIDE = ['当季吃什么水果好？', '怎么挑西瓜？'];

let messageSeq = 0;
function uid() { messageSeq += 1; return 'm' + Date.now().toString(36) + '-' + messageSeq; }

// 对话气泡下方的跳转卡：与 finishSearch 的 matched 同一命名逻辑。
function matchedChips(question) {
  const nameOf = hit => { const key = 'fruit_' + hit.fruit.id; return i18n.dict[key] ? i18n.t(key) : hit.fruit.name; };
  const seasonOf = hit => { const key = 'season_name_' + (hit.seasonId || ''); return i18n.dict[key] ? i18n.t(key) : hit.seasonName; };
  return matchFruits(question).map(hit => ({ fullId: hit.fullId, name: nameOf(hit), seasonName: seasonOf(hit), jumpLabel: '前往四时【' + nameOf(hit) + '】' }));
}

Page({
  data: { L: {}, keyword: '', recent: [], messages: [], pending: false, pendingStep: 0, pendingSteps: [], scrollInto: '', listening: false, recognizing: false, keyboardHeight: 0,
    suggestions: ['现在吃什么水果当季', '如何挑选西瓜', '西瓜是怎么传入中国的', '李子和杏子有什么区别', '立冬有什么讲究', '凤梨和菠萝是什么关系'],
    companion: null,
    // 兼容保留：finishSearch 作为离线兜底引擎，仍写入这些字段（测试与降级路径使用）。
    searching: false, step: 0, steps: [], result: null, answerBlocks: [], thinMaterial: false, matched: [], proverbs: [], terms: [], empty: false, emptyNote: '' },
  onLoad: function () { i18n.applyNav('id_search_title');
    // 聊天记录只存本机（按账户分区），重新进入自动恢复；服务端不留存。
    this.setData({ recent: readRecent(), messages: chatHistory.load(), L: i18n.labels(['guoling','guoling_intro','search_recent','search_recent_empty','search_clear','search_action','search_thinking','search_step1','search_step2','search_step3','search_no_result','answer_farming','answer_food','answer_extra','answer_tag','search_jump_hint','ask_guoling','side_proverbs','news_term','id_search_aria','chat_input_hint','chat_send','chat_voice','chat_listening','chat_recognizing','chat_thinking','chat_step1','chat_step2','chat_step3','chat_evidence','chat_offline','chat_followups','chat_welcome','chat_clear','chat_clear_confirm','chat_cleared','chat_header_sub','chat_suggest_title']), companion: store.getCompanion(),
      pendingSteps: [i18n.t('chat_step1'), i18n.t('chat_step2'), i18n.t('chat_step3')] });
    // 恢复历史后滚到最新一条，避免停在顶部看不到对话。
    if (this.data.messages.length) {
      const self = this;
      setTimeout(function () { if (!self._disposed) self.setData({ scrollInto: 'chat-bottom' }); }, 350);
    }
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 this.setData({ companion: store.getCompanion() }); },
  onInput: function (event) { this.setData({ keyword: event.detail.value }); },
  clearRecent: function () { writeRecent([]); this.setData({ recent: [] }); },
  tapRecent: function (event) { const word = event.currentTarget.dataset.word; this.ask(word); },

  // 对话发送入口：键盘确认、发送按钮、最近提问、追问建议、语音终稿都走这里。
  // options.fruits：追问建议可继承上一条消息的水果上下文，避免「立夏尝新还有什么讲究」这类
  // 不带水果名的追问被本地检索判为空。
  ask: function (raw, options) {
    const word = typeof raw === 'string' ? raw : this.data.keyword;
    const question = String(word || '').trim();
    if (!question) { wx.showToast({ title: i18n.t('search_kw_toast'), icon: 'none' }); return; }
    if (this.data.pending) return;
    this.setData({ keyword: '', pending: true, pendingStep: 0 });
    const recent = [question].concat(readRecent().filter(item => item !== question)).slice(0, 8);
    writeRecent(recent);
    this.setData({ recent });
    this.appendMessage({ id: uid(), role: 'user', text: question });
    // 境外果品/境外农耕：固定话术本地直接回答，不消耗模型调用，也不编内容。
    // 拒答同时把本土替代果做成可点的追问，给用户指路（2026-10-01 用户反馈）。
    const scope = fruitScope.classify(question);
    if (scope.scope === 'out') {
      const advice = scope.suggestions && scope.suggestions.length ? '\n可以换成这些本土水果问我：' + scope.suggestions.join('、') + '。' : '';
      this.appendElf(scope.message + advice, { local: true, followUps: (scope.suggestions || []).slice(0, 2) });
      return;
    }
    // 先检索；命中的水果走证据包问答。没有命中任何水果的问题不再一棍子打死：
    // ① 纯问候/道谢/告别本地直接回应；② 其余（时令推荐、节气讲究、闲聊、离题）
    // 拼当季时令包交给云端作答，由模型判断，云端失败才落本地兜底。
    // 追问建议优先继承上一条消息的水果上下文。
    const fruits = (options && options.fruits && options.fruits.length) ? options.fruits : matchFruits(question);
    // 历史只传用户问题，不传果灵答案。原因：服务端要求助手消息必须是它自己生成的 JSON 格式，
    // 而客户端存储的 assistant 内容是已经提取出来的纯文本；混进去会让模型 confused，
    // 导致追问时输出非 JSON 或空 answer，被服务端判为 model_invalid_output/502。
    const history = this.data.messages.filter(item => item.role === 'user').slice(-3)
      .map(item => ({ role: 'user', content: item.text }));
    if (!fruits.length) {
      const trivial = TRIVIAL_CHATS.find(item => item.match.test(question));
      if (trivial) { this.appendElf(trivial.reply, { local: true }); return; }
      this.runPendingSteps();
      this.requestChat({ question, history, contexts: buildSeasonalContexts(), seasonal: true });
      return;
    }
    this.runPendingSteps();
    this.requestChat({ question, history, contexts: buildContexts(fruits, question) });
  },
  doSearch: function (raw) { this.ask(raw); },

  runPendingSteps: function () {
    clearTimeout(this._stepTimer);
    const steps = [this.data.L.chat_step1 || this.data.L.search_step1, this.data.L.chat_step2 || this.data.L.search_step2, this.data.L.chat_step3 || this.data.L.search_step3];
    let cursor = 0;
    const advance = () => {
      cursor += 1;
      if (cursor <= 2 && this.data.pending) { this.setData({ pendingStep: cursor }); this._stepTimer = setTimeout(advance, 700); }
    };
    this._stepTimer = setTimeout(advance, 700);
  },

  requestChat: function (payload, attempt) {
    let context;
    try { context = media.capture(); } catch (error) { context = null; }
    if (!context || !context.token) {
      this.appendElf('连接云端失败：没有可用凭证。', { local: true });
      return;
    }
    const seq = (this._chatSeq = (this._chatSeq || 0) + 1);
    const doRequest = () => media.request(context, 'POST', '/api/chat', payload).then(result => {
      if (seq !== this._chatSeq) return;
      clearTimeout(this._stepTimer);
      const answer = result && typeof result.answer === 'string' ? result.answer.trim() : '';
      if (!answer) {
        if (!attempt) { this.requestChat(payload, true); return; }
        if (payload.seasonal) { this.fallbackLocal(payload.question); return; }
        this.appendElf('云端返回了空答案，请稍后再试。', { local: true });
        return;
      }
      this.appendElf(answer, { evidence: Array.isArray(result.usedEvidence) ? result.usedEvidence : [], followUps: Array.isArray(result.followUps) ? result.followUps : [], chips: matchedChips(payload.question) });
    }).catch((error) => {
      // 云端失败：先重试一次；再失败时，时令类问题落本地兜底（仍有诚实话术可答），
      // 其余直接提示用户，不再用本地兜底糊弄。
      if (seq !== this._chatSeq) return;
      clearTimeout(this._stepTimer);
      if (!attempt) {
        this.requestChat(payload, true);
        return;
      }
      if (payload.seasonal) { this.fallbackLocal(payload.question); return; }
      this.appendElf('连接云端失败：' + (error.message || '请检查网络后重试') + '。', { local: true });
    });
    doRequest();
  },

  // 本地兜底：与改版前的 finishSearch 同一检索与组织逻辑，渲染为果灵气泡。
  // 拒答（没命中素材）时必须带 REFUSAL_GUIDE 指路，不做死胡同（2026-10-01 用户反馈）。
  fallbackLocal: function (question) {
    this.finishSearch(question);
    let text;
    if (this.data.result) {
      text = this.data.answerBlocks.map(block => '【' + block.title + '】\n' + block.lines.join('\n')).join('\n\n');
    } else if (this.data.empty) {
      text = this.data.emptyNote || '这个问题素材库里还没有答案，换个水果关键词试试。';
    } else if (this.data.proverbs && this.data.proverbs.length) {
      text = '素材库里暂时没有直接对应的资料，找到几条相关农谚：\n' + this.data.proverbs.map(item => '「' + item.text + '」').join('\n');
    } else {
      text = '这个问题素材库里还没有答案，可以问：挑选、时令、吃法、习俗，或直接说一个水果名字。';
    }
    this.appendElf(text, { local: true, chips: this.data.result ? this.data.matched : [], followUps: this.data.result ? [] : REFUSAL_GUIDE.slice() });
  },

  appendMessage: function (message) {
    const messages = this.data.messages.concat([message]).slice(-chatHistory.MAX_MESSAGES);
    // 滚动锚点固定为底部哨兵：最新消息永远完整滚出输入栏。
    this.setData({ messages, pending: message.role === 'user' ? this.data.pending : false, scrollInto: 'chat-bottom' });
    chatHistory.save(messages);
  },
  onKeyboardHeight: function (event) {
    this.setData({ keyboardHeight: (event && event.detail && event.detail.height) || 0 });
  },
  clearChat: function () {
    wx.showModal({
      title: i18n.t('chat_clear'),
      content: i18n.t('chat_clear_confirm'),
      confirmText: i18n.t('chat_clear'),
      cancelText: i18n.t('search_clear'),
      success: result => {
        if (!result.confirm) return;
        chatHistory.clear();
        this.setData({ messages: [], pending: false, scrollInto: '' });
        wx.showToast({ title: i18n.t('chat_cleared'), icon: 'none' });
      }
    });
  },
  appendElf: function (text, extras) {
    const options = extras || {};
    clearTimeout(this._stepTimer);
    this.appendMessage({
      id: uid(), role: 'elf', text,
      local: !!options.local,
      evidence: options.evidence || [],
      followUps: options.followUps || [],
      chips: options.chips || []
    });
    this.setData({ pending: false, pendingStep: 0 });
  },
  tapFollowUp: function (event) {
    const word = event.currentTarget.dataset.word;
    const msgId = event.currentTarget.dataset.msgId;
    if (!word) return;
    const message = (this.data.messages || []).find(item => item.id === msgId);
    const fruits = message && fruitsFromChips(message.chips);
    this.ask(word, fruits && fruits.length ? { fruits } : undefined);
  },

  // 语音输入（评审增强）：点一下开始录音，再点一下结束并自动提问。
  // 双引擎（见 lib/speech-input.js）：微信同声传译插件优先（流式，边说边出字），
  // 插件不可用时自动切到「原生录音 + 服务端 /api/asr」（多一个「识别中」等待态）。
  toggleVoice: function () {
    if (!this._voice) {
      this._voice = createSpeechInput({
        onInterim: text => this.setData({ keyword: text }),
        onFinal: text => {
          this.setData({ listening: false, recognizing: false, keyword: text });
          if (text) this.ask(text);
        },
        onStateChange: state => this.setData({ listening: state === 'recording', recognizing: state === 'recognizing' }),
        onError: message => { this.setData({ listening: false, recognizing: false }); wx.showToast({ title: message, icon: 'none' }); }
      });
    }
    // 英文界面下提问可能是英文；其余走 zh（含川/闽南/吴方言）。
    // 注意：插件引擎没有粤语档，选 yue 只能落到服务端引擎才生效。
    this._voice.toggle(i18n.getLang() === 'en' ? 'en' : 'zh');
  },

  finishSearch: function (question) {
    this.lastQuestion = question;
    const fruits = matchFruits(question);
    // 兜底路径不经 doSearch 预清场，这里自带完整清场，保证可重复调用。
    const patch = { searching: false, step: 3, result: null, answerBlocks: [], thinMaterial: false, matched: [], proverbs: [], terms: [], empty: false, emptyNote: this.data.L.search_no_result || '' };
    if (fruits.length) {
      const answer = composeAnswer(fruits, question);
      patch.result = { question };
      patch.answerBlocks = answer.blocks.map(block => ({ title: block.title, text: block.text, lines: block.text.split('\n') }));
      patch.thinMaterial = answer.thinMaterial;
      const nameOf = hit => { const key = 'fruit_' + hit.fruit.id; return i18n.dict[key] ? i18n.t(key) : hit.fruit.name; };
      const seasonOf = hit => { const key = 'season_name_' + (hit.seasonId || ''); return i18n.dict[key] ? i18n.t(key) : hit.seasonName; };
      patch.matched = fruits.map(hit => ({ fullId: hit.fullId, name: nameOf(hit), seasonName: seasonOf(hit), jumpLabel: '前往四时' + '【' + nameOf(hit) + '】' }));
      // 相关农谚与节气札：丰富搜索结果。
      patch.proverbs = farmProverbs.proverbs.filter(item => fruits.some(hit => item.text.indexOf(hit.fruit.name) !== -1)).slice(0, 3);
      patch.terms = solarTermNotes.TERMS.filter(term => fruits.some(hit => term.text.indexOf(hit.fruit.name) !== -1)).slice(0, 2);
    } else {
      // 只涉及境外果品或境外农耕文化的问题：用《四时》板块的固定话术婉拒，不编内容。
      const scope = fruitScope.classify(question);
      if (scope.scope === 'out') {
        patch.empty = true;
        patch.emptyNote = fruitScope.refusalText(scope);
      } else {
        // P16：不再用「问题前四字」去碰农谚原文拼答案卡——那条路选出的内容与提问
        // 多半无关，还会渲染一张没有正文的答案卡。素材不足就诚实说明并给出关键词。
        const proverbHits = farmProverbs.proverbs.filter(item => question.length > 1 && (item.text + item.note).indexOf(question.slice(0, 4)) !== -1).slice(0, 3);
        if (proverbHits.length) patch.proverbs = proverbHits;
        else patch.empty = true;
      }
    }
    this.setData(patch);
  },
  goFruit: function (event) {
    const fullId = event.currentTarget.dataset.id;
    if (!fullId) return;
    const seasonId = fullId.split('-')[0];
    wx.switchTab({ url: '/pages/calendar/calendar', success: () => {
      setTimeout(() => {
        const calendar = getCurrentPages().find(item => item.route === 'pages/calendar/calendar');
        if (calendar && typeof calendar.render === 'function' && typeof calendar.selectFruit === 'function') {
          calendar.render(seasonId);
          calendar.selectFruit({ currentTarget: { dataset: { id: fullId } } });
        }
      }, 600);
    } });
  },
  onUnload: function () { clearTimeout(this._timer); clearTimeout(this._stepTimer); try { this._voice && this._voice.stop(); } catch (error) {} },
  noop: function () {}
});

// 供 tests/chat-quality.test.js 与 scripts/evaluate-chat.js 复用同一套检索与上下文组装
// （保证评测与线上同源）。小程序运行时没有模块会 require 本页，这里的赋值不影响页面注册。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchFruits, buildContexts, buildSeasonalContexts, focusTermsOf, relevanceScore, composeAnswer, stripNonFruit };
}
