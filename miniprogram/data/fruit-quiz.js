'use strict';

// 六种果灵各两题（评审 9.28：至少两轮题目完全不同）：
// 每轮每种水果只出一题，第二轮换上一轮没考过的那道。
// 释义不把地域经验变成全国固定农时，也不宣传环剥等危险操作。
const QUIZ = [
  { id:'watermelon-planting', fruit:'西瓜', fruitId:'watermelon', kind:'proverb',
    text:'农谚讲“清明种瓜，船载车拉”。种西瓜时，这句农谚该怎么用？',
    correct:'它是种瓜的传统农时提示；实际下种要看当地土温与品种，土温不足容易烂种缺苗。',
    wrong:'把它当死日子：不管纬度与天气，各地都必须在清明当天播完西瓜种子。',
    enText:'What does the saying “Plant melons around Qingming, and carts haul the harvest” mean for growing watermelons?',
    enCorrect:'It is a traditional timing hint; real sowing follows local soil warmth and the cultivar, since seeds rot in cold soil.',
    enWrong:'It is a strict date: every region must sow watermelon seeds on Qingming day itself.',
    sourceTitle:'明尼苏达大学推广部 · 瓜类种植', sourceUrl:'https://extension.umn.edu/fruit/growing-melons-home-garden' },
  { id:'watermelon-ripe', fruit:'西瓜', fruitId:'watermelon', kind:'knowledge',
    text:'不切开西瓜，瓜农常用的成熟判断方法是什么？',
    correct:'看果柄旁的卷须是否干枯、贴地果皮是否转黄，敲击声由清变沉也是参考。',
    wrong:'没有任何田间办法，必须每颗都切开看瓤才知道生熟。',
    enText:'How can you tell a watermelon is ripe without cutting it open?',
    enCorrect:'The tendril beside the stem dries up, the ground spot turns yellow, and the tap sound turns dull.',
    enWrong:'There is no field method at all; every melon must be cut open to check.',
    sourceTitle:'明尼苏达大学推广部 · 瓜类种植', sourceUrl:'https://extension.umn.edu/fruit/growing-melons-home-garden' },
  { id:'strawberry-runner', fruit:'草莓', fruitId:'strawberry', kind:'knowledge',
    text:'草莓向外伸出的匍匐茎，可以帮助它做什么？',
    correct:'接触土壤后形成新的小植株，是否留茎要看栽培类型。',
    wrong:'只是一根无用的线，任何品种都必须每天全部剪掉。',
    enText:'What can a strawberry runner do?',
    enCorrect:'Form a new plant after rooting; keeping runners depends on the growing system.',
    enWrong:'Nothing useful: every cultivar must have all its runners cut off every day.',
    sourceTitle:'明尼苏达大学推广部 · 草莓如何生长', sourceUrl:'https://extension.umn.edu/agriculture/specialty-crops/commercial-fruit-production/strawberry-farming/how-strawberry-plants-grow' },
  { id:'strawberry-achene', fruit:'草莓', fruitId:'strawberry', kind:'knowledge',
    text:'草莓表面那些小颗粒，其实是什么？',
    correct:'一颗颗真正的果实（瘦果）；我们吃的红色部分是膨大的花托。',
    wrong:'是没洗净的泥点，吃之前必须全部抠掉。',
    enText:'What are the tiny specks on a strawberry’s surface?',
    enCorrect:'They are the true fruits (achen); the red part we eat is the swollen flower base.',
    enWrong:'They are dirt spots that must all be picked off before eating.',
    sourceTitle:'明尼苏达大学推广部 · 草莓如何生长', sourceUrl:'https://extension.umn.edu/agriculture/specialty-crops/commercial-fruit-production/strawberry-farming/how-strawberry-plants-grow' },
  { id:'apple-pollination', fruit:'苹果', fruitId:'apple', kind:'knowledge',
    text:'为了让苹果树顺利结果，选苗时通常还要考虑什么？',
    correct:'附近是否有花期相合、适合授粉的另一品种。',
    wrong:'只要把所有叶片剪掉，不需要授粉也会结出好果。',
    enText:'What should you consider when choosing apple trees for fruit?',
    enCorrect:'A compatible pollen source with an overlapping flowering period nearby.',
    enWrong:'Removing all the leaves makes good fruit without pollination.',
    sourceTitle:'明尼苏达大学推广部 · 苹果栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-apples' },
  { id:'apple-grafting', fruit:'苹果', fruitId:'apple', kind:'knowledge',
    text:'果园里的苹果树为什么多用嫁接繁殖，而不是直接播种？',
    correct:'播种后代性状分离、结果也晚；嫁接能保持品种特性并提早结果。',
    wrong:'因为苹果种子根本不能发芽，除嫁接外别无他法。',
    enText:'Why are orchard apple trees usually propagated by grafting rather than from seed?',
    enCorrect:'Seedlings vary and take longer to fruit; grafting keeps the cultivar true and bears earlier.',
    enWrong:'Because apple seeds can never germinate, grafting is the only possible method.',
    sourceTitle:'明尼苏达大学推广部 · 苹果栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-apples' },
  { id:'pear-years', fruit:'梨', fruitId:'pear', kind:'proverb',
    text:'“桃三杏四梨五年”能保证每棵梨树第五年结果吗？',
    correct:'不能。它是传统经验，实际还受品种、砧木与管理影响。',
    wrong:'能。所有梨树都严格在第五年结果，与环境无关。',
    enText:'Does “Peach three years, apricot four, pear five” guarantee pears in year five?',
    enCorrect:'No. It is traditional shorthand; cultivar, rootstock and care affect the actual timing.',
    enWrong:'Yes. Every pear tree fruits in its fifth year, regardless of conditions.',
    sourceTitle:'淮安市政协 ·《船城民俗》植树谚语', sourceUrl:'https://zx.huaian.gov.cn/book/xianqushiliao/lianshui/ChuanChengMinSu.pdf' },
  { id:'pear-harvest', fruit:'梨', fruitId:'pear', kind:'knowledge',
    text:'梨为什么不宜留在树上等完全熟透再摘？',
    correct:'树上熟透果肉易发沙变糙；应在成熟期采收，放室内后熟口感更好。',
    wrong:'梨挂树越久越脆甜，熟透到落地才算最好。',
    enText:'Why should pears not be left to fully ripen on the tree?',
    enCorrect:'Overripe-on-tree flesh turns gritty; pick at maturity and ripen indoors instead.',
    enWrong:'The longer pears hang, the crisper and sweeter, so tree-ripened is always best.',
    sourceTitle:'明尼苏达大学推广部 · 梨树栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-pears' },
  { id:'grape-new-shoot', fruit:'葡萄', fruitId:'grape', kind:'knowledge',
    text:'葡萄园为什么需要按树形适当修剪与整理枝蔓？',
    correct:'更新结果枝，给新梢和果串留下合适的光照与空间。',
    wrong:'因为老枝越密越好，只需要放任藤蔓把棚架完全盖住。',
    enText:'Why are grapevines pruned and trained appropriately?',
    enCorrect:'To renew fruiting growth and give shoots and clusters suitable light and space.',
    enWrong:'Because denser old growth is always better, vines should be left unmanaged.',
    sourceTitle:'明尼苏达大学推广部 · 葡萄栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-grapes-home-garden' },
  { id:'grape-winter', fruit:'葡萄', fruitId:'grape', kind:'knowledge',
    text:'北方寒冷地区的葡萄藤入冬前常被下架埋土，这样做是为了什么？',
    correct:'防寒防冻，保护枝蔓和芽眼安全越冬。',
    wrong:'为了压住长势：埋土越深，来年的果串就结得越大。',
    enText:'Why are grapevines taken down and buried with soil before winter in cold regions?',
    enCorrect:'To insulate the canes and buds from freezing damage over winter.',
    enWrong:'To stunt growth: the deeper the burial, the bigger next year’s clusters.',
    sourceTitle:'明尼苏达大学推广部 · 葡萄栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-grapes-home-garden' },
  { id:'kiwi-pollen', fruit:'猕猴桃', fruitId:'kiwi', kind:'knowledge',
    text:'许多猕猴桃品种的果园为什么需要配置雄株？',
    correct:'雄株提供花粉，与结果的雌株配合完成授粉。',
    wrong:'雄株只是装饰，与花粉和雌株结果完全没有关系。',
    enText:'Why do many kiwifruit orchards include male vines?',
    enCorrect:'They provide pollen for the female vines that produce fruit.',
    enWrong:'They are only decorative and have no role in pollination.',
    sourceTitle:'俄勒冈州立大学推广部 · 猕猴桃栽培', sourceUrl:'https://extension.oregonstate.edu/catalog/pnw-507-growing-kiwifruit-guide-kiwiberries-fuzzy-kiwifruit-pacific-northwest-producers' },
  { id:'kiwi-afterripen', fruit:'猕猴桃', fruitId:'kiwi', kind:'knowledge',
    text:'猕猴桃为什么常在果实还偏硬的时候采收？',
    correct:'它是后熟型水果，采后会慢慢变软；硬果耐储运，风味也不受损。',
    wrong:'硬果已经定型，摘下来永远不会变软，只能趁硬吃掉。',
    enText:'Why are kiwifruit often harvested while still firm?',
    enCorrect:'They ripen after picking; firm fruit stores and ships well, then softens.',
    enWrong:'A firm kiwifruit is set forever and will never soften after harvest.',
    sourceTitle:'俄勒冈州立大学推广部 · 猕猴桃栽培', sourceUrl:'https://extension.oregonstate.edu/catalog/pnw-507-growing-kiwifruit-guide-kiwiberries-fuzzy-kiwifruit-pacific-northwest-producers' }
];
function unlockQuiz() { return QUIZ.slice(); }
function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i]; copy[i] = copy[j]; copy[j] = swap;
  }
  return copy;
}
function toQuestion(item, index, english, shuffleOptions) {
  const options = [{ label: english ? item.enCorrect : item.correct, correct: true }, { label: english ? item.enWrong : item.wrong, correct: false }];
  return { id: item.id, fruit: item.fruit, fruitId: item.fruitId, text: english ? item.enText : item.text, kind: item.kind,
    sourceTitle: item.sourceTitle, sourceUrl: item.sourceUrl,
    options: shuffleOptions ? shuffled(options) : index % 2 === 0 ? options : options.slice().reverse() };
}
// 每种水果两题，保持定义顺序（西瓜置顶，与答题解锁的奖励水果对应）。
const FRUIT_ORDER = [];
const BY_FRUIT = {};
for (const item of QUIZ) {
  if (!BY_FRUIT[item.fruitId]) { BY_FRUIT[item.fruitId] = []; FRUIT_ORDER.push(item.fruitId); }
  BY_FRUIT[item.fruitId].push(item);
}
// 首轮（date 为空或旧式日期串）每种水果固定出第一题、顺序固定；
// 复玩（date 传入上一轮已出题的 id 数组）每种水果优先出上一轮没考过的那道题，
// 保证连续两轮题目完全不重复；整轮顺序与每题选项排列重新洗牌。
function buildRound(date, language) {
  const english = language === 'en';
  const used = Array.isArray(date) ? date.filter(id => typeof id === 'string') : null;
  if (!used || !used.length) {
    return FRUIT_ORDER.map((fruitId, index) => toQuestion(BY_FRUIT[fruitId][0], index, english, false));
  }
  const next = FRUIT_ORDER.map(fruitId => BY_FRUIT[fruitId].find(item => used.indexOf(item.id) === -1) || BY_FRUIT[fruitId][0]);
  return shuffled(next).map((item, index) => toQuestion(item, index, english, true));
}
module.exports = { QUIZ, unlockQuiz, buildRound };
