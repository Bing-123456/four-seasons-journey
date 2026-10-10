'use strict';

const farmProverbsMap = require('./fruit-proverb-map');
const proverbById = farmProverbsMap.proverbById;
const RANDOM_PROVERB_IDS = farmProverbsMap.RANDOM_PROVERB_IDS;

// 六种果灵各两题（评审 9.28：至少两轮题目完全不同）：
// 每轮每种水果只出一题，第二轮换上一轮没考过的那道。
// 释义不把地域经验变成全国固定农时，也不宣传环剥等危险操作。
const QUIZ = [
  { id:'watermelon-planting', fruit:'西瓜', fruitId:'watermelon', kind:'proverb',
    text:'农谚讲“清明种瓜，船载车拉”。种西瓜时，这句农谚该怎么用？',
    correct:'它是种瓜的传统农时提示；实际下种要看当地土温与品种，土温不足容易烂种缺苗。',
    wrong:'指清明后雨水渐多，瓜田要先开好排水沟、起高畦，防止积水烂根。',
    enText:'What does the saying “Plant melons around Qingming, and carts haul the harvest” mean for growing watermelons?',
    enCorrect:'It is a traditional timing hint; real sowing follows local soil warmth and the cultivar, since seeds rot in cold soil.',
    enWrong:'It means rain increases after Qingming, so fields must be drained and ridged to keep roots from rotting.',
    sourceTitle:'明尼苏达大学推广部 · 瓜类种植', sourceUrl:'https://extension.umn.edu/fruit/growing-melons-home-garden' },
  { id:'watermelon-ripe', fruit:'西瓜', fruitId:'watermelon', kind:'knowledge',
    text:'不切开西瓜，瓜农常用的成熟判断方法是什么？',
    correct:'看果柄旁的卷须是否干枯、贴地果皮是否转黄，敲击声由清变沉也是参考。',
    wrong:'敲上去声音越清脆，说明果肉越紧实、越新鲜；声音发闷的反而是放久了的。',
    enText:'How can you tell a watermelon is ripe without cutting it open?',
    enCorrect:'The tendril beside the stem dries up, the ground spot turns yellow, and the tap sound turns dull.',
    enWrong:'The crisper the tap sounds, the firmer and fresher the flesh; a dull sound means it has sat too long.',
    sourceTitle:'明尼苏达大学推广部 · 瓜类种植', sourceUrl:'https://extension.umn.edu/fruit/growing-melons-home-garden' },
  { id:'strawberry-runner', fruit:'草莓', fruitId:'strawberry', kind:'knowledge',
    text:'草莓向外伸出的匍匐茎，可以帮助它做什么？',
    correct:'接触土壤后形成新的小植株，是否留茎要看栽培类型。',
    wrong:'伸出去是为了从土里吸养分回传给母株，让母株结出更大的果。',
    enText:'What can a strawberry runner do?',
    enCorrect:'Form a new plant after rooting; keeping runners depends on the growing system.',
    enWrong:'It reaches out to draw nutrients from the soil and send them back, so the mother plant bears bigger berries.',
    sourceTitle:'明尼苏达大学推广部 · 草莓如何生长', sourceUrl:'https://extension.umn.edu/agriculture/specialty-crops/commercial-fruit-production/strawberry-farming/how-strawberry-plants-grow' },
  { id:'strawberry-achene', fruit:'草莓', fruitId:'strawberry', kind:'knowledge',
    text:'草莓表面那些小颗粒，其实是什么？',
    correct:'一颗颗真正的果实（瘦果）；我们吃的红色部分是膨大的花托。',
    wrong:'是花开完后留在果面上的花瓣残迹，晒干就变成一颗颗小硬粒。',
    enText:'What are the tiny specks on a strawberry’s surface?',
    enCorrect:'They are the true fruits (achen); the red part we eat is the swollen flower base.',
    enWrong:'They are dried petal remains left on the surface after flowering, hardening into tiny grains.',
    sourceTitle:'明尼苏达大学推广部 · 草莓如何生长', sourceUrl:'https://extension.umn.edu/agriculture/specialty-crops/commercial-fruit-production/strawberry-farming/how-strawberry-plants-grow' },
  { id:'apple-pollination', fruit:'苹果', fruitId:'apple', kind:'knowledge',
    text:'为了让苹果树顺利结果，选苗时通常还要考虑什么？',
    correct:'附近是否有花期相合、适合授粉的另一品种。',
    wrong:'要看树苗嫁接的砧木是不是矮化的，砧木越矮，结出的果子越甜。',
    enText:'What should you consider when choosing apple trees for fruit?',
    enCorrect:'A compatible pollen source with an overlapping flowering period nearby.',
    enWrong:'What matters is whether the tree sits on a dwarfing rootstock: the shorter the stock, the sweeter the fruit.',
    sourceTitle:'明尼苏达大学推广部 · 苹果栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-apples' },
  { id:'apple-grafting', fruit:'苹果', fruitId:'apple', kind:'knowledge',
    text:'果园里的苹果树为什么多用嫁接繁殖，而不是直接播种？',
    correct:'播种后代性状分离、结果也晚；嫁接能保持品种特性并提早结果。',
    wrong:'是因为苹果种子发芽率太低，几乎长不出苗，只能用枝条来繁育。',
    enText:'Why are orchard apple trees usually propagated by grafting rather than from seed?',
    enCorrect:'Seedlings vary and take longer to fruit; grafting keeps the cultivar true and bears earlier.',
    enWrong:'Because apple seed rarely germinates, so cuttings are the only practical way to multiply trees.',
    sourceTitle:'明尼苏达大学推广部 · 苹果栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-apples' },
  { id:'pear-years', fruit:'梨', fruitId:'pear', kind:'proverb',
    text:'“桃三杏四梨五年”能保证每棵梨树第五年结果吗？',
    correct:'不能。它是传统经验，实际还受品种、砧木与管理影响。',
    wrong:'能保证，但前提是必须嫁接在山梨砧木上；用实生苗栽的还要再等五年。',
    enText:'Does “Peach three years, apricot four, pear five” guarantee pears in year five?',
    enCorrect:'No. It is traditional shorthand; cultivar, rootstock and care affect the actual timing.',
    enWrong:'Yes, as long as it is grafted onto mountain-pear rootstock; seedling trees need another five years.',
    sourceTitle:'淮安市政协 ·《船城民俗》植树谚语', sourceUrl:'https://zx.huaian.gov.cn/book/xianqushiliao/lianshui/ChuanChengMinSu.pdf' },
  { id:'pear-harvest', fruit:'梨', fruitId:'pear', kind:'knowledge',
    text:'梨为什么不宜留在树上等完全熟透再摘？',
    correct:'树上熟透果肉易发沙变糙；应在成熟期采收，放室内后熟口感更好。',
    wrong:'是因为熟透的梨容易被鸟啄、被风吹落，留在树上会掉下来摔烂。',
    enText:'Why should pears not be left to fully ripen on the tree?',
    enCorrect:'Overripe-on-tree flesh turns gritty; pick at maturity and ripen indoors instead.',
    enWrong:'Because fully ripe pears get pecked by birds and blown down, so they would fall and bruise.',
    sourceTitle:'明尼苏达大学推广部 · 梨树栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-pears' },
  { id:'grape-new-shoot', fruit:'葡萄', fruitId:'grape', kind:'knowledge',
    text:'葡萄园为什么需要按树形适当修剪与整理枝蔓？',
    correct:'更新结果枝，给新梢和果串留下合适的光照与空间。',
    wrong:'是为了让藤蔓长得更旺：枝条留得越多，来年结果就越多。',
    enText:'Why are grapevines pruned and trained appropriately?',
    enCorrect:'To renew fruiting growth and give shoots and clusters suitable light and space.',
    enWrong:'To push growth: the more shoots you keep, the more bunches it will bear next year.',
    sourceTitle:'明尼苏达大学推广部 · 葡萄栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-grapes-home-garden' },
  { id:'grape-winter', fruit:'葡萄', fruitId:'grape', kind:'knowledge',
    text:'北方寒冷地区的葡萄藤入冬前常被下架埋土，这样做是为了什么？',
    correct:'防寒防冻，保护枝蔓和芽眼安全越冬。',
    wrong:'为了保墒防风：埋土能锁住土壤水分，防止藤蔓被冬季干风吹抽条。',
    enText:'Why are grapevines taken down and buried with soil before winter in cold regions?',
    enCorrect:'To insulate the canes and buds from freezing damage over winter.',
    enWrong:'To hold moisture and block wind: the soil cover keeps water in and stops shoots drying out in winter.',
    sourceTitle:'明尼苏达大学推广部 · 葡萄栽培', sourceUrl:'https://extension.umn.edu/fruit/growing-grapes-home-garden' },
  { id:'kiwi-pollen', fruit:'猕猴桃', fruitId:'kiwi', kind:'knowledge',
    text:'许多猕猴桃品种的果园为什么需要配置雄株？',
    correct:'雄株提供花粉，与结果的雌株配合完成授粉。',
    wrong:'雄株能挡风遮阳，给结果的雌株创造更稳定的小气候。',
    enText:'Why do many kiwifruit orchards include male vines?',
    enCorrect:'They provide pollen for the female vines that produce fruit.',
    enWrong:'Male vines shelter the rows from wind and sun, giving the fruiting vines a steadier microclimate.',
    sourceTitle:'俄勒冈州立大学推广部 · 猕猴桃栽培', sourceUrl:'https://extension.oregonstate.edu/catalog/pnw-507-growing-kiwifruit-guide-kiwiberries-fuzzy-kiwifruit-pacific-northwest-producers' },
  { id:'kiwi-afterripen', fruit:'猕猴桃', fruitId:'kiwi', kind:'knowledge',
    text:'猕猴桃为什么常在果实还偏硬的时候采收？',
    correct:'它是后熟型水果，采后会慢慢变软；硬果耐储运，风味也不受损。',
    wrong:'因为硬果的维生素含量最高，一旦放软，营养就流失掉了。',
    enText:'Why are kiwifruit often harvested while still firm?',
    enCorrect:'They ripen after picking; firm fruit stores and ships well, then softens.',
    enWrong:'Because firm fruit holds the most vitamins; once it softens, the nutrients are gone.',
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
// 取农谚 note 的第一句，避免选项文字过长。
function firstSentence(text) {
  if (!text) return '';
  const cuts = [text.indexOf('；'), text.indexOf('。'), text.indexOf(';'), text.indexOf('.')].filter(c => c !== -1);
  const end = cuts.length ? Math.min.apply(null, cuts) : -1;
  return end === -1 ? text : text.slice(0, end);
}
// 决策 15：复轮/后续轮从「其它水果」的农谚池随机抽题。
// 题干=农谚原文；正确项=农谚 note（首句，真实释义）；错误项=模式化「全国统一死规矩」误解（非编造事实）。
// fruitId 留空 → 答对不解锁定制果（对应水果不在定制清单，符合「库无此果」）。
// 42 条非定制水果农谚题的干扰项（10.5：把一眼假的套话换成需要想一想的选项）。
// 风格混合：一部分直接取知识库里的真实内容（是真话，但不回答本题），
// 一部分是针对题意改写的常见误解（读起来很像正确答案，需要真懂才分得清）。
const PROVERB_DISTRACTORS = {
  100: { zh: "意思是樱桃树要栽在房前屋后避风向阳处，露天大田栽一棵死一棵。", en: "It means cherry trees only survive by the house where it is sheltered and sunny; in open fields they always die." },
  101: { zh: "意思是谷雨这天雨水足，种下去不用浇水也能活，所以老辈都挑这一天种。", en: "It means rain is ample on Guyu day, so seeds survive without watering; that is why elders always sowed then." },
  102: { zh: "意思是桃树要长满三年才许嫁接，杏四年、梨五年，早嫁接树就废了。", en: "It means peach may only be grafted after three full years, apricot four, pear five; grafting earlier ruins the tree." },
  103: { zh: "意思是蜜蜂会啃掉一部分花，剩下的谎花不结果，果子才长得大。", en: "It means bees bite off part of the blossoms, and the leftover false flowers make the fruit grow bigger." },
  104: { zh: "说的是农历月份：七月核桃、八月梨、九月柿子，按农历算全国通用。", en: "It counts by the lunar calendar: walnut in the seventh month, pear the eighth, persimmon the ninth, valid everywhere." },
  105: { zh: "意思是芒种这天煮一锅青梅，家里人喝了整个夏天都不会中暑。", en: "It means a pot of green plums boiled on Mangzhong keeps the whole family safe from summer heat." },
  106: { zh: "意思是桑葚要等麦子黄了才能吃，麦子没黄的桑葚都是酸的。", en: "It means mulberries are only edible once the wheat yellows; before that they are all sour." },
  107: { zh: "意思是小满时枇杷已经全部黄透，错过这几天就要等明年。", en: "It means loquats are fully yellow by Xiaoman, and missing those days means waiting a whole year." },
  108: { zh: "意思是大棚草莓不算数，只有露地自然红的才甜，谷雨前后最便宜。", en: "It means greenhouse berries do not count; only field-ripened ones are sweet, and they are cheapest around Guyu." },
  109: { zh: "意思是李子树下不能久站，落叶和树根会散出有毒的气。", en: "It means you must not stand long under a plum tree, since its leaves and roots give off a poisonous air." },
  110: { zh: "意思是吃一颗荔枝要配三杯凉茶才压得住，吃之前先把凉茶备好。", en: "It means one lychee needs three cups of herbal tea to balance it, so brew the tea first." },
  111: { zh: "意思是南方人吃桂圆就像北方人吃人参，桂圆可以代替人参补身体。", en: "It means longan is to the south what ginseng is to the north, so longan can replace ginseng as a tonic." },
  112: { zh: "意思是杨梅必须夏至当天采，过一天就生虫，不能吃了。", en: "It means bayberries must be picked on the summer solstice itself; a day later they have worms." },
  113: { zh: "葡萄架下的活儿四季不停，核心是控产：按树势留穗定穗，果串才匀、糖度才上得来。", en: "Work under the vine never stops, and the core is crop control: set bunches by vine vigour so they ripen evenly." },
  114: { zh: "意思是芒果开花时天越暖，立夏结的果就越甜；天冷的年份就不甜。", en: "It means the warmer the bloom, the sweeter the fruit at Lixia; in a cool year the mangoes stay bland." },
  115: { zh: "意思是香蕉要等黄了再摘，青的时候摘下来就永远不会变黄。", en: "It means bananas must be picked yellow; picked green, they will never turn yellow." },
  116: { zh: "意思是盐水能把菠萝的酸味泡掉，泡得越久果肉越甜。", en: "It means salt water soaks the sourness out, and the longer it soaks the sweeter the flesh." },
  117: { zh: "意思是石榴裂口就是坏果，好石榴皮要完整、一颗都不裂。", en: "It means a cracked pomegranate is spoiled; a good one has an unbroken skin with no splits at all." },
  118: { zh: "意思是苹果必须在霜降这天摘，早一天酸、晚一天也酸。", en: "It means apples must be picked on Frost Descent day; a day early or late and they turn sour." },
  119: { zh: "打枣用长竿轻敲，树下铺布接果，一竿下去红雨纷纷；晾晒架、去核器、筛网，是把鲜枣变成干枣枣泥的整套家什。", en: "Jujubes are knocked down with a long pole onto cloth spread below, then dried, pitted and sieved into paste." },
  120: { zh: "猕猴桃是藤本，园里先立柱拉丝搭棚架，让藤蔓顺架铺开，通风透光才少生病。", en: "Kiwifruit is a vine: posts and wires go up first so the canopy opens to light and air and stays healthy." },
  121: { zh: "意思是霜降一过山楂就酸得不能生吃，只能串成糖葫芦。", en: "It means after Frost Descent hawthorn turns too sour to eat raw and can only be made into candied skewers." },
  122: { zh: "意思是柚子要留到中秋分着吃才吉利，提前摘下来味道就散了。", en: "It means pomelo must be kept until mid-autumn and shared, or its flavour is lost." },
  123: { zh: "意思是砂糖橘越冷越甜，必须打过霜才能摘。", en: "It means the colder it gets the sweeter it is, so it must be picked only after a frost." },
  124: { zh: "温州叶老伯世代种瓯柑，瓯柑是浙江本土古老柑种，挂树过冬，叶老伯保留古法种植，农家肥养护。", en: "Old Ye of Wenzhou grows Ou citrus, a native Zhejiang variety that hangs on the tree through winter, tended with farmyard manure." },
  125: { zh: "意思是冬枣比雪花梨脆，所以营养也比梨高。", en: "It means winter jujube is crisper than snow pear, so it is more nutritious too." },
  126: { zh: "意思是金桔泡茶能治咳嗽，咳了喝一杯就好。", en: "It means kumquat tea cures a cough; one cup and the cough is gone." },
  127: { zh: "意思是火龙果要晒足太阳才开花，所以要在太阳出来前把花搬到阳光下。", en: "It means dragon fruit needs full sun to bloom, so the flowers must be moved into sunlight before sunrise." },
  128: { zh: "意思是释迦埋在米里能吸干水分，果肉会更甜更紧实。", en: "It means burying sugar apple in rice draws water out, making the flesh sweeter and firmer." },
  129: { zh: "意思是霜降后的木瓜才有药效，青木瓜煲汤没有用。", en: "It means only papaya after Frost Descent has medicinal value; green papaya in soup does nothing." },
  130: { zh: "意思是杨桃要横着切才好吃，竖着切味道会发涩。", en: "It means carambola must be cut across to taste good; sliced lengthwise it turns astringent." },
  131: { zh: "意思是山竹壳越硬越好，硬壳的果肉才脆甜不烂。", en: "It means the harder the mangosteen shell, the crisper and sweeter the flesh inside." },
  132: { zh: "意思是饿的时候只能吃荔枝、吃饱了只能吃黄皮，两样不能一起吃。", en: "It means eat lychee when hungry and wampee when full; the two must never be eaten together." },
  133: { zh: "意思是吐鲁番只产葡萄、哈密只产瓜，别的地方种不出来。", en: "It means Turpan grows only grapes and Hami only melons; nowhere else can grow them." },
  134: { zh: "意思是立冬吃甘蔗能治牙疼，冬天嚼甘蔗牙就不痛了。", en: "It means chewing cane at the start of winter cures toothache for the whole season." },
  135: { zh: "意思是海南一半的土地都种椰子，另一半才种别的作物。", en: "It means half of Hainan is planted with coconut and only the other half grows anything else." },
  136: { zh: "意思是无花果吃了能通便，便秘吃几个就见效。", en: "It means figs relieve constipation; a few and the problem is solved." },
  137: { zh: "意思是脐橙要留到冬至才最甜，霜降摘的都还酸。", en: "It means navel oranges are sweetest only at the winter solstice; those picked at Frost Descent are still sour." },
  138: { zh: "意思是百香果越皱越好，皱得厉害说明放得久、糖分都凝住了。", en: "It means the more wrinkled the passion fruit, the better; heavy wrinkling means sugar has concentrated." },
  139: { zh: "意思是椰枣是骆驼运来的，只有沙漠里长的才正宗。", en: "It means dates arrived by camel, so only desert-grown ones are authentic." },
  140: { zh: "意思是立秋这天吃了西瓜，整个秋天都不会中暑。", en: "It means eating watermelon on the day of Liqiu protects you from heat illness all autumn." },
  141: { zh: "意思是孕妇吃了酸的开胃，所以柠檬才叫宜母子。", en: "It means sour fruit whets the appetite during pregnancy, which is why lemon is called the mother-pleasing fruit." },
};

function buildRandomProverbQuestions(count, english, excludeIds) {
  const exclude = excludeIds || [];
  let pool = RANDOM_PROVERB_IDS.filter(function (id) { return exclude.indexOf('proverb-' + id) === -1; });
  // 42 条农谚全部出过一遍后，排除列表把池子掏空：此时重置池子从头再来，不再卡在「无题可出」。
  if (pool.length === 0) pool = RANDOM_PROVERB_IDS.slice();
  const picked = shuffled(pool).slice(0, Math.min(count, pool.length));
  return picked.map(function (id) {
    const p = proverbById[id];
    const text = english
      ? 'What does the proverb “' + p.en + '” mean?'
      : '关于农谚「' + p.text + '」，正确的理解是？';
    const correct = english ? firstSentence(p.noteEn) : firstSentence(p.note);
    const distractor = PROVERB_DISTRACTORS[id] || null;
    const wrong = english
      ? (distractor ? distractor.en : 'It is a rigid national rule every region must follow exactly.')
      : (distractor ? distractor.zh : '这是全国各地都必须严格照办的硬性农时，不用看当地气候和品种。');
    return {
      id: 'proverb-' + id,
      fruit: null, fruitId: undefined, kind: 'proverb',
      text: text, sourceTitle: p.sourceTitle, sourceUrl: p.sourceUrl,
      options: shuffled([{ label: correct, correct: true }, { label: wrong, correct: false }])
    };
  });
}
// 每种水果两题，保持定义顺序（西瓜置顶，与答题解锁的奖励水果对应）。
const FRUIT_ORDER = [];
const BY_FRUIT = {};
for (const item of QUIZ) {
  if (!BY_FRUIT[item.fruitId]) { BY_FRUIT[item.fruitId] = []; FRUIT_ORDER.push(item.fruitId); }
  BY_FRUIT[item.fruitId].push(item);
}
// 出题规则（10.5 游戏③，用户确认版）：
//   1. 先给「还没解锁」的定制水果出题，每种出一道上一轮没考过的题（两题轮换）；
//      已经解锁的水果不再出题，空出的名额用非定制水果（知识库其它水果）的农谚题补上。
//   2. 定制水果全部解锁后，整轮都是非定制水果的题；非定制题出过的记下来，
//      全部出过一遍后自动洗牌重来（buildRandomProverbQuestions 池空时重置）。
//   3. 某种定制水果两题都答错过（一直没解锁）时继续出该水果的题，直到答对解锁为止。
// 起始水果（2026-10-08 第18 轮 · 用户规则）：西瓜开局就拥有，所以它永远在"已解锁"名单里
// （计数一开始就是 1/6、答对也不弹「恭喜获得」）；但它的题必须出到"答对一次"为止 ——
// 之前组题循环会把已解锁的水果整段跳过，西瓜题因此从来没出过。
const STARTER_FRUIT = 'watermelon';

// 入参：input 可以是 { unlocked, askedIds, askedProverbs, starterPassed, starter }，也兼容旧式的「已出题 id 数组」。
function buildRound(input, language) {
  const english = language === 'en';
  const options = Array.isArray(input)
    ? { askedIds: input.filter(id => typeof id === 'string') }
    : (input && typeof input === 'object' ? input : {});
  const unlocked = Array.isArray(options.unlocked) ? options.unlocked : [];
  const askedIds = Array.isArray(options.askedIds) ? options.askedIds : [];
  const askedProverbs = Array.isArray(options.askedProverbs) ? options.askedProverbs : [];
  const starter = typeof options.starter === 'string' && options.starter ? options.starter : STARTER_FRUIT;
  const starterPassed = !!options.starterPassed;
  const questions = [];
  // 0) 起始水果：没答对过就一直占一题；答对过就不再出，这一格让给别的。
  //    两道题严格轮换：优先没出过的；都出过了就取"上一轮没用过的那道"（askedIds 里最后出现的那个
  //    就是上一轮用的），这样相邻两轮不会出同一道，也不破坏"两轮题目不重复"的规则。
  if (!starterPassed) {
    const starterPool = BY_FRUIT[starter] || [];
    if (starterPool.length) {
      const freshStarter = starterPool.find(item => askedIds.indexOf(item.id) === -1);
      let lastStarter = '';
      for (let i = askedIds.length - 1; i >= 0; i--) {
        if (starterPool.some(item => item.id === askedIds[i])) { lastStarter = askedIds[i]; break; }
      }
      const pickedStarter = freshStarter
        || starterPool.filter(item => item.id !== lastStarter)[0]
        || starterPool[0];
      questions.push(toQuestion(pickedStarter, 0, english, false));
    }
  }
  // 1) 未解锁的定制水果：各出一道（优先没出过的那道，两题轮换）
  for (const fruitId of FRUIT_ORDER) {
    if (fruitId === starter && !starterPassed) continue; // 起始水果上面已经放进去了
    if (unlocked.indexOf(fruitId) >= 0) continue;
    const pool = BY_FRUIT[fruitId] || [];
    if (!pool.length) continue;
    const fresh = pool.find(item => askedIds.indexOf(item.id) === -1);
    const picked = fresh || pool[askedIds.length % pool.length] || pool[0];
    questions.push(toQuestion(picked, questions.length, english, false));
    if (questions.length >= 6) break;
  }
  // 2) 不足 6 题的部分用非定制水果的农谚题补齐
  if (questions.length < 6) {
    const extra = buildRandomProverbQuestions(6 - questions.length, english, askedProverbs);
    for (const item of extra) questions.push(item);
  }
  return questions;
}
// 按 id 取回同一道题（2026-10-08 第17 轮：给「接着打上一局」用）。
// 定制水果题：选项顺序由 index 决定，传回原来的序号就能还原；
// 农谚题：首次生成时选项是随机的，所以调用方会用存档里的 flip 位把它摆回原样。
function findQuestion(id, index, language, flip) {
  const english = language === 'en';
  let question = null;
  const fruitItem = QUIZ.find(function (item) { return item.id === id; });
  if (fruitItem) {
    question = toQuestion(fruitItem, index, english, false);
  } else if (String(id).indexOf('proverb-') === 0) {
    const raw = String(id).slice('proverb-'.length);
    const p = proverbById[raw];
    if (!p) return null;
    const text = english
      ? 'What does the proverb “' + p.en + '” mean?'
      : '关于农谚「' + p.text + '」，正确的理解是？';
    const correct = english ? firstSentence(p.noteEn) : firstSentence(p.note);
    const distractor = PROVERB_DISTRACTORS[raw] || null;
    const wrong = english
      ? (distractor ? distractor.en : 'It is a rigid national rule every region must follow exactly.')
      : (distractor ? distractor.zh : '这是全国各地都必须严格照办的硬性农时，不用看当地气候和品种。');
    question = {
      id: 'proverb-' + raw, fruit: null, fruitId: undefined, kind: 'proverb',
      text: text, sourceTitle: p.sourceTitle, sourceUrl: p.sourceUrl,
      options: [{ label: correct, correct: true }, { label: wrong, correct: false }]
    };
  }
  if (!question) return null;
  // 存档里的 flip = 正确项是否被摆到了第二位；和现在生成的不一致就翻过来
  const nowFlip = question.options[0] && question.options[0].correct ? 0 : 1;
  if ((flip ? 1 : 0) !== nowFlip) question.options = question.options.slice().reverse();
  return question;
}
module.exports = { QUIZ, unlockQuiz, buildRound, buildRandomProverbQuestions, findQuestion, STARTER_FRUIT, FRUIT_ORDER, PROVERB_DISTRACTORS };
