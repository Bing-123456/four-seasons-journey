'use strict';

// An explainable lexical baseline, not an embedding model. Every catalog fact is
// scored, then constrained by reviewed subject/intent annotations. A high lexical
// score alone never authorizes an answer.
const defaultCatalog = require('../data/catalog');
const fruitScope = require('../data/fruit-scope');
const annotations = {
  'f-strawberry-history': ['strawberry', ['overview', 'period'], '草莓 姚家 中牟 种植历史 1990'],
  'f-strawberry-varieties': ['strawberry', ['varieties'], '草莓 品种 宁玉 雪里香 评选'],
  'f-strawberry-chain': ['strawberry', ['storage'], '草莓 保鲜 冷冻 速冻 贮藏 分拣'],
  'f-apple-storage': ['apple', ['storage', 'overview'], '灵宝 苹果 寺河 贮藏 冷库 冬季 采后'],
  'f-apple-sales': ['apple', ['channels'], '灵宝 苹果 寺河 电商 渠道 销售方式'],
  'f-guadou-local': ['sauce', ['overview', 'location', 'heritage'], '瓜豆酱 青谷堆 狼城岗 传承'],
  'f-guadou-process': ['sauce', ['ingredients', 'process', 'overview'], '瓜豆酱 原料 黄豆 西瓜 制作 工序'],
  'f-guadou-table': ['sauce', ['fooduse'], '瓜豆酱 吃法 炒菜 饭桌'],
  'f-local-workshop': ['workshop', ['overview', 'location'], '中牟 农耕博物馆 老家作坊 磨豆腐 展陈'],
  'f-grain-origin': ['grain', ['location', 'structure', 'overview'], '裴李岗 新郑 河南 磨盘 磨棒 石器 四足'],
  'f-grain-motion': ['grain', ['motion'], '磨盘 磨棒 前后 来回 滚碾 旋转 动作'],
  'f-watermelon-heritage': ['watermelon', ['heritage', 'overview'], '西瓜 栽培 种瓜 技艺 市级 郑州 非遗 名录 保护'],
  'f-heritage-batch': ['watermelon', ['batch'], '郑州 第六批 名录 数量 中牟 十二 61 51 10'],
  'f-dragon-name': ['dragon', ['heritage', 'overview'], '西街舞龙 西瓜龙舞 四瓜龙舞 名称'],
  'f-food-craft': ['foodcraft', ['overview', 'heritage'], '五香兔肉 酱腌菜 臭豆汤 非遗 名录'],
  'f-festival-history': ['festival', ['calendar', 'overview'], '吃瓜大会 西瓜节 活动 历史 2024 七月 八月'],
  'f-tourism-collaboration': ['festival', ['collaboration', 'overview'], '农文旅 文旅融合 助农 果农 企业 景点 合作'],
  'f-creative-watermelon': ['festival', ['experience', 'overview'], '创意 吃瓜 西瓜体验 西瓜汁'],
  'f-watermelon-sauce': ['watermelonSauce', ['overview'], '西瓜酱 晒制 乡土记忆'],
  'f-kiwi-case': ['kiwi', ['location', 'overview'], '猕猴桃 刁家乡 辰耕 历史 采摘'],
  'f-kiwi-colors': ['kiwi', ['colors'], '猕猴桃 红心 黄心 绿心 果心 颜色'],
  'f-kiwi-calendar': ['kiwi', ['calendar'], '猕猴桃 采摘时段 农历 公历 八月 九月'],
  'f-kiwi-workshops': ['kiwi', ['experience'], '手工 手作 课程 草莓酱 火龙果酒'],
  'f-kiwi-groups': ['kiwi', ['groups'], '团建 机构 活动 旅游采摘'],
  'f-kiwi-capacity': ['kiwi', ['capacity'], '承载 接待人数 每日 控制'],
  'f-kiwi-local-work': ['kiwi', ['localwork'], '村民 本地协作 临时 工作人员'],
  'f-kiwi-cooperative': ['kiwi', ['cooperative'], '合作社 大棚 种植 销售 交流'],
  'f-henan-museum-address': ['henanMuseum', ['location', 'overview'], '河南博物院 地址 郑州 农业路8号 场馆'],
  'f-henan-museum-visit': ['henanMuseum', ['visit'], '河南博物院 参观 免费 预约 常规 周一 闭馆'],
  'f-dahecun-settlement': ['dahecun', ['overview', 'period'], '大河村 遗址 聚落 仰韶 龙山 二里头 商代'],
  'f-dahecun-opening': ['dahecun', ['calendar'], '大河村 博物馆 新馆 2025年12月6日 开放 历史']
};
const subjects = [
  ['sauce', /瓜豆酱|青谷堆|狼城岗/],
  ['grain', /磨盘|磨棒|裴李岗|谷物加工工具/],
  ['henanMuseum', /河南博物院/],
  ['dahecun', /大河村/],
  ['dragon', /西街舞龙|西瓜龙舞|四瓜龙舞/],
  ['foodcraft', /五香兔肉|兔肉|酱腌菜|臭豆汤/],
  ['watermelonSauce', /西瓜酱/],
  ['kiwi', /猕猴桃|刁家乡|辰耕|红心|黄心|绿心|草莓酱|火龙果酒/],
  ['workshop', /农耕博物馆|老家作坊|磨豆腐/],
  ['festival', /吃瓜大会|西瓜节|农文旅|文旅融合|助农实践|创意吃瓜|西瓜体验/],
  ['watermelon', /西瓜|种瓜|栽培技艺/],
  ['strawberry', /草莓|姚家|宁玉|雪里香/],
  ['apple', /苹果|灵宝|寺河/]
];
const intents = [
  ['varieties', /品种|宁玉|雪里香/],
  ['storage', /贮藏|储藏|储存|保鲜|冷库|冷冻|速冻|采后/],
  ['channels', /电商|销售方式|销售渠道|收购/],
  ['ingredients', /原料|材料|用啥|用什么|哪些东西|什么做的|需要什么|黄豆/],
  ['process', /工序|环节|制作过程|怎么做|如何制作/],
  ['fooduse', /吃法|做菜|菜肴|家常|饭桌|炒菜/],
  ['motion', /怎么使用|怎么操作|怎么用|如何使用|如何操作|怎样使用|怎样操作|怎样用|动作|滚碾|旋转|转动|转圈|推拉|前后|来回/],
  ['heritage', /非遗|哪一级|什么级|级别|省级|国家级|世界级|保护名录/],
  ['batch', /名录.*(?:几项|多少|数量)|第六批|名录/],
  ['structure', /形状|结构|四足|什么工具/],
  ['period', /什么时代|哪些时代|哪个时代|什么文化|哪些文化|仰韶|龙山|二里头|商代/],
  ['visit', /参观|预约|免费|收费|闭馆|周一|有票|能去|开放规则|常规开放/],
  ['calendar', /时间|时段|月份|什么时候|几月|农历|公历|成熟|采摘季|何时|哪天/],
  ['colors', /颜色|红心|黄心|绿心|果心/],
  ['capacity', /承载|接待人数|每日人数/],
  ['cooperative', /合作社/],
  ['localwork', /村民|本地协作|工作人员/],
  ['groups', /团建|机构活动/],
  ['experience', /手工|手作|草莓酱|火龙果酒|创意|西瓜体验/],
  ['collaboration', /农文旅|文旅融合|助农实践|果农.*企业/],
  ['location', /哪里|地方|出土|产地|来自|在哪|地点/],
  ['overview', /介绍|讲讲|故事|文化|资料|认识|了解|是什么|啥/]
];
const refusal = '现有核验资料不足以可靠回答这个问题。可以换问资料中对应的文化对象、原料、工具动作或历史记录。';
function no(message) {
  return { answer: message || refusal, sourceIds: [], evidenceIds: [], mode: 'local-retrieval', unanswerable: true, retrievalMethod: 'lexical-bm25-intent-gates' };
}
function tokens(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ' ');
  const output = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  const result = [];
  output.forEach(part => {
    if (/^[a-z0-9]+$/.test(part)) result.push(part);
    else for (let index = 0; index < part.length - 1; index += 1) result.push(part.slice(index, index + 2));
  });
  return result;
}
function contextSubject(place, catalog) {
  if (!place) return null;
  // Reviewed fact links survive replacing the old fictional POI names.
  const first = (place.factIds || []).map(id => annotations[id]).find(Boolean);
  return first && first[0];
}
function explicitSubjects(question) {
  const spans = [], matched = [];
  subjects.forEach(item => {
    const pattern = new RegExp(item[1].source, 'g');
    let match;
    while ((match = pattern.exec(question))) {
      const start = match.index, end = start + match[0].length;
      // "西瓜" inside "西瓜龙舞/西瓜酱/西瓜节" is not a second entity.
      if (spans.some(span => start >= span.start && end <= span.end)) continue;
      spans.push({ start, end });
      if (!matched.includes(item[0])) matched.push(item[0]);
    }
  });
  return matched;
}
function resolve(question, place, catalog) {
  // 只涉及境外果品或境外农耕文化的问题：先回《四时》板块的固定话术，不借用河南资料替代回答。
  // 这一步必须排在其它闸门之前——否则会被更早的「资料不足」分支拦下，拿不到板块话术。
  const scope = fruitScope.classify(question);
  if (scope.scope === 'out') return { refused: fruitScope.refusalText(scope) };
  const explicit = explicitSubjects(question);
  let subject = explicit[0];
  let intent = (intents.find(item => item[1].test(question)) || [])[0];
  if (/哪一级|什么级|级别|省级|国家级|世界级/.test(question)) intent = 'heritage';
  if (explicit.length > 1) {
    const museumTool = explicit.length === 2 && explicit.includes('grain') && explicit.includes('henanMuseum');
    const sauceIngredient = explicit.length === 2 && explicit.includes('sauce') && explicit.includes('watermelon') &&
      /原料|材料|黄豆|工序|制作|用什么|用啥/.test(question) && !/栽培|种瓜|名录|非遗/.test(question);
    if (!museumTool && !sauceIngredient) return { refused: '现有资料不能确认问题中这些文化对象之间的对应或归属关系。请分别提问，不能用青谷堆等地的资料替代另一个地点的材料。' };
  }
  if (!subject) {
    // Do not substitute a page's topic for an explicit unknown requested object.
    const requested = question.match(/(?:讲讲|介绍|了解|说说)\s*(.+?)(?:的故事|的文化|是什么|[？?。]|$)/);
    if (requested && !/^(?:这里|这儿|这个|这个地方|这里的|当地|它|相关|一下|一下这里|这些)(?:文化|资料|故事)?$/.test(requested[1].trim())) return { refused: refusal };
    const contextual = /这|那|它|本地|当地|原料|材料|工序|手工|手作|采摘时间|成熟时间|农历|公历|几月成熟|几月采摘|明天|今天|预约|有票|开放|营业/.test(question) || /^(?:介绍|讲讲|有什么文化|资料|故事)[？?。！!]*$/.test(question);
    if (contextual) subject = contextSubject(place, catalog);
    if (!subject && /合作社|村民|本地协作|承载|接待人数|团建|机构活动|手工|手作|草莓酱|火龙果酒/.test(question)) subject = 'kiwi';
    if (!subject && /名录|第六批/.test(question) && !/级别|哪一级|省级|国家级|世界级/.test(question) &&
        /^(?:(?:郑州市?|中牟县?|非物质文化遗产|非遗|的|第六批|名录|公布|有|了|多少|几|项|数量|总共|一共|是|什么|介绍|讲讲)|[？?。\s])+$/.test(question)) subject = 'watermelon';
  }
  if (subject === 'strawberry' && /历史|哪年|多少年|何时开始/.test(question)) intent = 'period';
  if (subject === 'henanMuseum' && /地址|在哪|哪里/.test(question)) intent = 'location';
  if (subject === 'dahecun' && /新馆|2025|当年|开放/.test(question) && /什么时候|何时|时间|开放/.test(question)) intent = 'calendar';
  const direction = subject === 'henanMuseum' ? '请到河南博物院官网“参观服务”页核实预约与当日安排。' : subject === 'dahecun' ? '请向大河村遗址博物馆官方服务渠道核实当日安排；2025年的开放报道不代表今天有票。' : '';
  if (subject && /今天|现在|今年|明天|实时|2026|还有名额|余票|有票/.test(question)) return { refused: '这里没有经过核实的当日开放、预约或剩余名额数据。' + (direction || '历史报道不能证明当前状态，请向实际经营方核实。') };
  if (subject === 'sauce' && intent === 'experience' && /故事|文化/.test(question)) intent = 'overview';
  if (!subject || !intent) return { refused: refusal };
  if (/[，,；;。]|同时|分别|以及|并且|还有|和/.test(question)) {
    const requestedIntents = [...new Set(intents.filter(item => item[0] !== 'overview' && item[1].test(question)).map(item => item[0]))];
    // Heritage-level phrases may also contain the generic word "名录".
    const preciseIntents = requestedIntents.filter(value => !(value === 'batch' && requestedIntents.includes('heritage') && !/多少|几项|数量/.test(question)));
    if (preciseIntents.length > 1 && !Object.keys(annotations).some(id => catalog.facts.some(fact => fact.id === id) && annotations[id][0] === subject && preciseIntents.every(value => annotations[id][1].includes(value)))) {
      return { refused: '这个问题包含多个需要分别核实的内容，目前不能用单条相关资料联合回答。请把地点、动作或参观安排等问题分开提问。' };
    }
  }
  // Specific foreign places or objects cannot borrow the page's local evidence.
  const namedRegions = question.match(/[\u4e00-\u9fff]{2,6}(?:省|市|县|乡|镇|村)(?=的|里|境内|当地|产|出土|制作|瓜豆酱|西瓜|猕猴桃|非遗|？|\?|，|。|$)/g) || [];
  const unsupportedRegion = namedRegions.some(region => !/河南省|郑州市|中牟县|新郑市|灵宝市|寺河乡|姚家镇|刁家乡|狼城岗镇|青谷堆村|大河村/.test(region));
  if (unsupportedRegion || /兵马俑|秦始皇|西安|陕西|四川|成都|北京|故宫|安徽|江西|山东|山西|广西|云南|贵州|福建|广东|浙江|江苏|敦煌|南京|杭州|苏州|天津|重庆|湖北|湖南|河北|内蒙古|黑龙江|辽宁|吉林|甘肃|青海|宁夏|新疆|西藏|海南|上海/.test(question)) return { refused: '这份资料库尚无这个地区或对象的核验材料，不能用河南的相关故事替代回答。' };
  if (/1893|百年|130年|四膜一布|开园仪式|王大爷|老种植园|瓜甜麒麟/.test(question)) return { refused: '现有公开资料无法证实这个具体年代、人物或技艺故事，请以资料卡原始记录为准。' };
  const knownAddress = subject === 'henanMuseum' && intent === 'location';
  const historicalOpening = subject === 'dahecun' && intent === 'calendar';
  const publishedVisitPolicy = subject === 'henanMuseum' && intent === 'visit';
  if (/电话|经纬度|怎么去|导航|营业|订票|多少钱|票价|天气|滞销|销量|预测/.test(question) || /地址/.test(question) && !knownAddress || /开放/.test(question) && !historicalOpening && !publishedVisitPolicy) return { refused: '这里提供有出处的文化与历史材料，不能代替当前经营信息。' + (direction || '请向实际经营方核实。') };
  if (/为什么|为何|如何种|怎么种|起源|传说|是谁|创始|最早|发明|药效|治病|功效/.test(question)) return { refused: '当前核验资料不足以解释这个原因、起源或具体技艺细节，不能把相关资料当作结论。' };
  if (subject === 'sauce' && /配方|配比|比例|温度|菌种|几天|多少天|几小时|保质|发霉|腐烂|坏瓜|能吃|安全|参数|进口|有机|转基因|农药|农残|花生|过敏|营养|热量|蛋白质|含糖/.test(question)) return { refused: '资料只支持认识原料与部分工序，没有经过审核的完整配方、原料品质、发酵参数或食品安全判断依据，不能据此制作或食用。' };
  if (/区别|比较|相比|有什么不同|一样吗|比.*更/.test(question) && !(subject === 'grain' && intent === 'motion')) return { refused: '当前资料未提供这个比较结论，不能只用其中一个对象的资料推断两者差异。' };
  if (subject === 'grain' && /效率|产量|多少斤|几斤|尺寸|重量|直径|多少年/.test(question)) return { refused: '课堂只解释来源、结构与动作，没有提供可验证的加工效率或模型测量。请查看馆方资料。' };
  if (intent === 'heritage') {
    if (/哪一级|哪级|什么级|级别|等级|(?:省|国家|世界|市|县|区)级/.test(question) && subject !== 'watermelon' && subject !== 'dragon') return { refused: '现有核验资料没有提供这个对象所问的非遗认定等级，不能把传承报道当作等级名录。' };
    if (subject === 'kiwi' || subject === 'grain' || /省级|国家级|世界级/.test(question) && subject !== 'watermelon' && subject !== 'dragon') return { refused: '现有资料不能确认这个对象的所问非遗身份或级别，不能借用其他项目的名录。' };
  }
  // Cross-region questions may be answered only where the source explicitly
  // distinguishes the objects (the Peiligang origin record names Xinzheng).
  if (subject !== 'grain' && /新郑|裴李岗/.test(question) || subject === 'sauce' && /刁家乡/.test(question)) return { refused: '问题中的地区与当前文化对象不一致，现有材料不足以支持这种对应关系。' };
  return { subject, intent };
}

function rankFacts(question, sourceCatalog) {
  const catalog = sourceCatalog || defaultCatalog;
  const documents = catalog.facts.map(fact => ({ fact, terms: tokens(fact.title + ' ' + fact.text + ' ' + (annotations[fact.id] || [])[2]) }));
  const queryTerms = [...new Set(tokens(question))];
  const meanLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / Math.max(1, documents.length);
  const frequency = {};
  queryTerms.forEach(term => { frequency[term] = documents.filter(document => document.terms.includes(term)).length; });
  return documents.map(document => {
    let score = 0;
    queryTerms.forEach(term => {
      const count = document.terms.filter(value => value === term).length;
      if (!count) return;
      const idf = Math.log(1 + (documents.length - frequency[term] + 0.5) / (frequency[term] + 0.5));
      score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * document.terms.length / meanLength));
    });
    return { id: document.fact.id, score, fact: document.fact };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// L4 RRF（Reciprocal Rank Fusion）：只依赖名次、不依赖分数尺度，
// 因此可以把「BM25 的任意分值」与「余弦相似度」安全地放在一起融合。
// k=60 取自原论文（Cormack et al., 2009）的常用取值。
//
// weights 是可选的逐列表权重。等权 RRF 隐含假设「各排序器质量相当」；
// 实测中这个假设不成立时（BM25 hit@1 0.714 vs 稠密 0.929），等权融合会被弱排序器拖累，
// 需要给强排序器更高权重。权重只在 dev 拆分上确定，evaluation 拆分不参与调参。
function rrf(lists, k, weights) {
  const rank = k === undefined ? 60 : k;
  const scores = new Map();
  lists.forEach((list, listIndex) => {
    const weight = weights && weights[listIndex] !== undefined ? weights[listIndex] : 1;
    if (!weight) return;
    (list || []).forEach((entry, position) => {
      const id = typeof entry === 'string' ? entry : entry && entry.id;
      if (!id) return;
      scores.set(id, (scores.get(id) || 0) + weight / (rank + position + 1));
    });
  });
  return [...scores.entries()].map(item => ({ id: item[0], score: item[1] })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// 候选排序：默认纯词法（与旧版行为完全一致）。
// 传入 denseRanking 后才启用语义层——小程序端不调向量接口，走的始终是词法路径；
// 服务端可用时注入稠密名次，得到混合排序。降级是显式的，不是静默的。
function orderCandidates(pool, options) {
  const dense = options && options.denseRanking;
  const ranker = (options && options.ranker) || 'lexical';
  if (ranker === 'lexical' || !Array.isArray(dense) || !dense.length) return pool;
  const denseRank = new Map();
  dense.forEach((entry, position) => {
    const id = typeof entry === 'string' ? entry : entry && entry.id;
    if (id) denseRank.set(id, position);
  });
  if (ranker === 'dense') {
    // 只按语义名次排；未进入稠密结果的候选排到最后，内部仍按词法分。
    return pool.slice().sort((a, b) => (denseRank.has(a.id) ? denseRank.get(a.id) : Infinity) - (denseRank.has(b.id) ? denseRank.get(b.id) : Infinity) || b.score - a.score || a.id.localeCompare(b.id));
  }
  // hybrid：词法名次与稠密名次各投一票。
  // 注意融合结果仍被限制在 pool 内——pool 已经过 subject/intent 审校闸门，
  // 语义层只能改变「谁排前面」，不能把不该回答这个问题的事实推上来。
  const fused = new Map(rrf([pool.map(item => item.id), dense.map(entry => (typeof entry === 'string' ? entry : entry && entry.id))]).map(item => [item.id, item.score]));
  return pool.slice().sort((a, b) => (fused.get(b.id) || 0) - (fused.get(a.id) || 0) || b.score - a.score || a.id.localeCompare(b.id));
}

function retrieve(question, placeId, sourceCatalog, options) {
  const catalog = sourceCatalog || defaultCatalog;
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) return { candidates: [], local: no('请输入2000字以内的文化问题。') };
  const place = placeId ? catalog.places.find(item => item.id === placeId) : null;
  if (placeId && !place) return { candidates: [], local: no('没有找到这个文化条目，请重新选择。') };
  const q = question.trim();
  const query = resolve(q, place, catalog);
  if (query.refused) return { candidates: [], local: no(query.refused) };
  const ranked = rankFacts(q, catalog).map(item => {
    const annotation = annotations[item.id];
    const supported = annotation && annotation[0] === query.subject && annotation[1].includes(query.intent);
    return Object.assign({}, item, { supported, score: item.score + (supported && place && (place.factIds || []).includes(item.id) ? 0.5 : 0) });
  }).filter(item => item.supported).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // Subject/intent compatibility is an explicit reviewed support relation. It
  // enables colloquial questions with no exact lexical overlap, not guessed facts.
  const ordered = orderCandidates(ranked, options);
  const candidates = ordered.slice(0, 4).map(item => ({ id: item.id, text: item.fact.text, score: Math.round(item.score * 1000) / 1000 }));
  const selected = candidates.slice(0, query.intent === 'overview' ? 2 : 1).map(item => item.id);
  return { candidates, subject: query.subject, intent: query.intent, local: selected.length ? answerFromEvidence(selected, catalog) : no() };
}

function answerFromEvidence(ids, sourceCatalog) {
  const catalog = sourceCatalog || defaultCatalog;
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length) return no();
  const facts = ids.map(id => catalog.facts.find(fact => fact.id === id));
  if (facts.some(fact => !fact || !fact.sourceIds.length || fact.sourceIds.some(id => !catalog.sources.some(source => source.id === id)))) return no();
  return { answer: facts.map(fact => fact.text).join('\n\n'), evidenceIds: ids.slice(), sourceIds: [...new Set([].concat.apply([], facts.map(fact => fact.sourceIds)))], mode: 'local-retrieval', unanswerable: false, grounding: 'verified-evidence-selection', retrievalMethod: 'lexical-bm25-intent-gates' };
}
function answerQuestion(question, placeId, sourceCatalog) { return retrieve(question, placeId, sourceCatalog).local; }

// 2026-09-28：「文化活动构想」彻底下线（页面 + 服务端任务 + 本模块的活动建议逻辑一并移除）。
// 原 suggestActivity / activityFormats / activitySteps 见 git 历史（删除前提交 0bb5cf5）。
module.exports = { rankFacts, retrieve, answerQuestion, answerFromEvidence, rrf };
