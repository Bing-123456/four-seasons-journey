'use strict';

// 二十四节气札：按 24 节气整理的果树农事札记（团队定稿内容）。
// 农谚与民俗为民间流传；用于发现页「二十四节气札」与「农事活动预告」轮播。
const TERMS = [
  {
    id: 'lichun', name: '立春', season: 'spring', headline: '万物始发，果木抽芽',
    text: '春气始发，冻土消融，是全年果树管护的开端。本土樱桃、青梅、枇杷果树结束休眠，枝间隐现芽点。老农讲究“立春修枝，一树结果”，立春轻剪枯枝病枝，减少养分消耗，为春果挂果打底。立春无鲜果采收，重在养树护土、积蓄地力，静待春来万物生发。',
    enName: 'Start of Spring', enHeadline: 'All things stir; fruit trees bud',
    enText: 'Spring qi begins and frozen soil thaws — the start of the year\'s orchard care. Native cherry, green plum and loquat trees end dormancy, buds hidden among the branches. Old farmers say “prune at Lichun and a tree bears fruit”: light pruning of dead and diseased wood cuts nutrient drain and lays the base for spring fruit. No fresh harvest yet — the focus is nourishing trees and soil, storing strength for spring.'
  },
  {
    id: 'yushui', name: '雨水', season: 'spring', headline: '润雨滋木，春果蓄力',
    text: '雨水落，地气润，江南梅林、桑林、枇杷林快速返青。此时桑树抽新叶、青梅孕花芽，最怕春旱干风。乡土农谚：“雨水有雨庄稼好，果树满枝花蕾饱”。果农多会浅松树根土壤、薄覆草木灰，保水护根，守护春果花芽分化，是春果丰收的关键铺垫期。',
    enName: 'Rain Water', enHeadline: 'Nourishing rain; spring fruit gathers strength',
    enText: 'Rain falls, the earth softens, and plum, mulberry and loquat groves green quickly. Mulberries push new leaves and green plums form flower buds, most fearing spring drought and dry winds. A folk saying goes: “rain at Yushui makes good crops and branches full of buds.” Growers loosen root soil and dust with plant ash to hold water — key groundwork for flower-bud differentiation and the spring harvest.'
  },
  {
    id: 'jingzhe', name: '惊蛰', season: 'spring', headline: '春雷启蛰，百果萌动',
    text: '春雷始鸣，虫醒土活，樱桃、青梅、桑葚果树全面抽芽展叶。果树病虫开始复苏，古法不施浓药，以清园扫叶、树干轻刷石灰防虫防病。此时桑树枝繁叶嫩，是古时采桑养蚕的黄金期，也是桑葚挂果的初始阶段。惊蛰管护到位，春果坐果率翻倍提升。',
    enName: 'Awakening of Insects', enHeadline: 'Spring thunder wakes the orchard',
    enText: 'First thunder; insects wake and soil comes alive. Cherry, green plum and mulberry trees leaf out fully. Pests revive too — the old way avoids heavy sprays, cleaning fallen leaves and whitewashing trunks with lime instead. Mulberry branches are lush and tender, the golden season of silkworm raising and the first stage of mulberry fruit. Good care at Jingzhe doubles spring fruit set.'
  },
  {
    id: 'chunfen', name: '春分', season: 'spring', headline: '昼夜均分，繁花满枝',
    text: '春分百花盛放，樱桃满树白花、青梅缀满花苞、枇杷次第开花。乡土讲究“春分不刮风，果子挂满棚”，春风狂风最易吹落花蕊，造成落花减产。果农顺势疏除过密花枝，保证通风透光，让留存花芽养分充足，为春季第一批本土鲜果筑牢挂果基础。',
    enName: 'Spring Equinox', enHeadline: 'Day and night equal; blossoms fill the branches',
    enText: 'Flowers burst at Chunfen: cherry trees in white, green plums dotted with buds, loquats opening in turn. Farmers say “if the wind stays calm at Chunfen, fruit will fill the trellis” — fierce winds knock down blossoms and cut yield. Growers thin crowded flower branches for air and light, so the remaining buds are well fed, laying a firm base for the first fresh fruit of spring.'
  },
  {
    id: 'qingming', name: '清明', season: 'spring', headline: '春和景明，幼果初成',
    text: '清明风暖雨润，樱桃幼果成型、青梅坐果稳定、桑葚逐步膨大。古时清明有尝新祭祖习俗，静待春果成熟、感恩天地馈赠。此时最怕倒春寒，一夜寒霜便会冻伤幼果。老农夜间果园熏烟防霜、日间浅灌保湿，细心守护初春来之不易的幼果。',
    enName: 'Pure Brightness', enHeadline: 'Warm and bright; young fruit takes shape',
    enText: 'Warm wind and gentle rain: cherry fruit sets, green plums hold, mulberries swell. Qingming carries old customs of tasting the new and honouring ancestors while awaiting spring fruit — gratitude for the land\'s gift. The danger is a late cold snap: one frosty night can hurt young fruit. Growers smoke orchards at night against frost and irrigate lightly by day, guarding the season\'s tender fruit.'
  },
  {
    id: 'guyu', name: '谷雨', season: 'spring', headline: '雨生百谷，春果渐熟',
    text: '谷雨是春季农事收官节气，雨水丰沛、光照柔和。枇杷率先成熟上市，青梅饱满可采、桑葚乌黑多汁、樱桃粉嫩挂枝。农谚“谷雨摘春果，一年滋味足”，谷雨时节及时采收春果、清整果园，结束春季果事，静待盛夏瓜果繁盛。',
    enName: 'Grain Rain', enHeadline: 'Rain feeds a hundred grains; spring fruit ripens',
    enText: 'Guyu closes the spring farming calendar with ample rain and gentle light. Loquats reach market first; green plums fill out, mulberries darken, cherries hang pink on the branch. “Pick spring fruit at Guyu and the year tastes good” — harvest in time, tidy the orchard, close the spring season and await the abundance of summer melons.'
  },
  {
    id: 'lixia', name: '立夏', season: 'summer', headline: '夏木繁茂，夏果初长',
    text: '立夏万物繁茂，桃树、杏树、李树结束花期，幼果迅速膨大，岭南荔枝、龙眼进入关键膨果期。古有“立夏看夏”之说，夏果收成，立夏定大半。果农重点疏果控量，摘除畸形小果，避免果树养分透支，保证留存果实体型饱满、口感纯正。',
    enName: 'Start of Summer', enHeadline: 'Summer foliage; young summer fruit grows',
    enText: 'All things flourish: peach, apricot and plum finish flowering and young fruit swells fast; lychee and longan in the south enter a critical swelling stage. The saying “Lixia shows the summer” means most of the harvest is decided now. Growers thin fruit to control load, removing malformed small fruit so trees are not drained and the rest grows full and well flavoured.'
  },
  {
    id: 'xiaoman', name: '小满', season: 'summer', headline: '果粒渐满，万物充盈',
    text: '小满之名，万物饱满。桃李杏果实日渐充盈，荔枝果皮转青、果肉蓄糖。农谚“小满不满，干断田坎”，此时需及时补水保湿，杜绝干旱落果。夏季果树枝叶繁茂，需及时除草通风，减少高温病害，守护盛夏本土鲜果生长。',
    enName: 'Grain Buds', enHeadline: 'Fruit fills; the world brims',
    enText: 'Xiaoman means fullness. Peaches, plums and apricots plump daily; lychee skin turns green as flesh stores sugar. “If Xiaoman brings no fullness, field dykes crack dry” — water promptly to prevent drought drop. Summer canopies grow dense, so weed and ventilate in time to limit heat-driven disease and guard the summer\'s native fruit.'
  },
  {
    id: 'mangzhong', name: '芒种', season: 'summer', headline: '三夏大忙，鲜果繁盛',
    text: '芒种为三夏大忙之时，收种并行、农事最繁。岭南黄皮、早熟李子次第成熟，荔枝进入最佳采收期。“芒种忙，果满筐”，果农抢晴采收成熟鲜果，同时管护晚熟夏果，修枝控旺，防止枝叶徒长争抢果实养分。',
    enName: 'Grain in Ear', enHeadline: 'The busy season; fresh fruit abounds',
    enText: 'Mangzhong is the busiest stretch, with harvest and planting overlapping. Wampee and early plums ripen in turn; lychee enters its best picking window. “Busy at Mangzhong, baskets full of fruit”: growers pick ripe fruit in fine weather while tending late varieties, pruning to check wild shoots from stealing nutrition from the fruit.'
  },
  {
    id: 'xiazhi', name: '夏至', season: 'summer', headline: '暑气鼎盛，夏果飘香',
    text: '夏至白昼最长、光照最足，是夏果蓄糖关键期。桃子、杏子、李子全面成熟，荔枝、龙眼甜度顶峰。此时高温闷热，果树最怕积水烂根、高温灼果。老农遵循古法，早晚浇水、行间通风，避开正午高温管护，锁住果实糖分与水分。',
    enName: 'Summer Solstice', enHeadline: 'Peak heat; summer fruit perfumes the air',
    enText: 'Longest days and strongest light — the key stage for sugar. Peaches, apricots and plums ripen fully; lychee and longan reach peak sweetness. Hot, muggy weather brings waterlogged roots and sun-scalded fruit. Following old practice, growers water morning and evening, keep rows ventilated and avoid midday work, locking in sugar and juice.'
  },
  {
    id: 'xiaoshu', name: '小暑', season: 'summer', headline: '伏夏初至，岭南果丰',
    text: '小暑入伏，岭南暑气蒸腾。黄皮大量上市，晚熟龙眼逐步成熟。乡土讲究“小暑食鲜果，消暑安度夏”，本土夏果酸甜适口，是天然消暑风物。此时病虫害高发，果农以草木灰防虫、人工清理病叶，守护伏夏最后一批夏果。',
    enName: 'Minor Heat', enHeadline: 'First dog days; southern fruit is plentiful',
    enText: 'The dog days begin and southern heat rises. Wampee floods the market and late longan matures in turn. Locals say “eat fresh fruit at Xiaoshu to cool through summer” — native summer fruit, sweet-tart, is a natural cooler. Pests peak now; growers dust with plant ash and hand-remove diseased leaves, guarding the last summer fruit.'
  },
  {
    id: 'dashu', name: '大暑', season: 'summer', headline: '盛夏收官，蓄力迎秋',
    text: '大暑暑气最盛，晚熟龙眼收尾采收。夏季果树经过整季挂果，养分消耗极大。大暑农事重在养树休养，修剪残枝、清理果园、埋施农家肥，修复树体元气，为秋季柿子、枣子、梨等秋果生长蓄力铺垫。',
    enName: 'Major Heat', enHeadline: 'High summer closes; strength gathers for autumn',
    enText: 'Peak heat; the last late longan is picked. Summer trees, having borne fruit all season, are drained of nutrients. Care now focuses on recovery — pruning spent branches, cleaning the orchard, working in farmyard manure — rebuilding the trees for autumn persimmon, jujube and pear.'
  },
  {
    id: 'liqiu', name: '立秋', season: 'autumn', headline: '秋意初起，秋果灌浆',
    text: '立秋暑退秋生，昼夜温差拉大，是秋果蓄糖增甜的黄金节点。梨、柿子、红枣、山楂开始快速灌浆上色。农谚“立秋三场雨，秕果变成宝”，立秋适度降雨，果实饱满度、甜度大幅提升，秋果丰收自此开启。',
    enName: 'Start of Autumn', enHeadline: 'First hints of autumn; fruit fills',
    enText: 'Heat fades and day-night gaps widen — the golden window for sugar. Pears, persimmons, red dates and hawthorn begin rapid filling and colouring. “Three rains at Liqiu turn thin fruit into treasure”: timely rain greatly improves fullness and sweetness, opening the autumn harvest.'
  },
  {
    id: 'chushu', name: '处暑', season: 'autumn', headline: '暑气终结，百果转甜',
    text: '处暑暑气消散，秋风干爽，昼夜温差进一步扩大。猕猴桃果肉饱满、梨子清甜多汁、石榴籽粒充盈。此时停止大水漫灌，控水增糖，让果实自然沉淀风味，是古法种植产出优质秋果的核心技巧。',
    enName: 'End of Heat', enHeadline: 'Heat ends; fruit turns sweet',
    enText: 'Heat disperses into crisp autumn air as day-night gaps widen further. Kiwifruit flesh fills, pears turn juicy-sweet, pomegranate seeds plump. Flood irrigation stops; controlled water stress lets flavour settle naturally — the core old-technique for fine autumn fruit.'
  },
  {
    id: 'bailu', name: '白露', season: 'autumn', headline: '露凝果熟，果香满园',
    text: '白露凝霜，秋意渐浓，红枣率先红熟，梨子全面成熟、山楂渐红。白露昼夜温差极大，果实糖分快速累积，本土秋果风味达到巅峰。此时及时采收成熟鲜果，晾晒果干、制作传统果脯，留存秋日风物滋味。',
    enName: 'White Dew', enHeadline: 'Dew condenses; orchard fragrance everywhere',
    enText: 'Dew thickens and autumn deepens. Red dates redden first, pears ripen fully, hawthorn blushes. Huge day-night gaps stack sugar rapidly — native autumn fruit at its flavour peak. Ripe fruit is picked promptly, dried or made into traditional preserved fruit, keeping the taste of autumn.'
  },
  {
    id: 'qiufen', name: '秋分', season: 'autumn', headline: '秋收正盛，硕果盈枝',
    text: '秋分昼夜均分，正值中国农民丰收节。柿子挂满枝头、猕猴桃成熟上市、石榴硕果累累。秋收大忙，果农分批采收秋果，晾晒储存、加工传统手作果品。秋分清园剪枝，梳理树形，为果树越冬做初步准备。',
    enName: 'Autumn Equinox', enHeadline: 'Harvest in full swing; branches heavy with fruit',
    enText: 'Day and night equal at the Chinese Farmers\' Harvest Festival. Persimmons crowd the branches, kiwifruit reach market, pomegranates weigh heavy. In the busy harvest, growers pick in batches, dry and store, and craft traditional fruit products. Cleaning and pruning begin the trees\' move toward winter.'
  },
  {
    id: 'hanlu', name: '寒露', season: 'autumn', headline: '霜染秋果，甜满人间',
    text: '寒露轻霜，最养秋果。山楂漫山红遍、柿子通体橙红、晚熟梨子风味醇厚。轻霜打过的本土秋果，涩味尽去、甜度倍增，是自然赋予的独特风味。此时全面采收秋果，结束秋季核心果事。',
    enName: 'Cold Dew', enHeadline: 'Light frost sweetens the fruit',
    enText: 'Light frost at Hanlu nurtures autumn fruit: hawthorn covers the hills in red, persimmons turn orange, late pears deepen in flavour. Touched by frost, native fruit loses astringency and gains sweetness — a flavour only nature gives. The full autumn pick now closes the core season.'
  },
  {
    id: 'shuangjiang', name: '霜降', season: 'autumn', headline: '霜打百果，岁物丰成',
    text: '霜降秋深，万物归藏。最后一批柿子、山楂采收完毕。农谚“霜打果子分外甜”，霜降低温锁住果实全部糖分。果农彻底清园、深埋基肥、修剪病弱枝条，让果树休养蓄力，安然越冬。',
    enName: 'Frost\'s Descent', enHeadline: 'Frost-touched fruit; the year runs rich',
    enText: 'Autumn deepens and all things turn to storage. The last persimmons and hawthorn come in. “Frost-kissed fruit is extra sweet”: falling cold locks in the season\'s sugars. Growers clean the orchard thoroughly, dig in base fertiliser and prune sick wood, letting trees rest safely into winter.'
  },
  {
    id: 'lidong', name: '立冬', season: 'winter', headline: '冬藏开启，柑柚初熟',
    text: '立冬万物蛰伏，南方本土冬果登场。柚子率先成熟、柑橘开始转色。冬果生长周期漫长，历经三季滋养，果肉醇厚多汁。立冬农事以护树保果为主，防风防冻，守护挂树越冬的柑桔鲜果。',
    enName: 'Start of Winter', enHeadline: 'Winter storage begins; citrus ripens',
    enText: 'Growth quiets and southern winter fruit takes the stage. Pomelo ripens first; mandarins begin to colour. Winter fruit, nourished across three seasons, is dense and juicy. Care now centres on protecting trees and hanging fruit — windbreaks and frost guards for the citrus wintering on the branch.'
  },
  {
    id: 'xiaoxue', name: '小雪', season: 'winter', headline: '天寒地冻，金桔含香',
    text: '小雪气温骤降，金桔次第成熟、小巧金黄、香气浓郁。柑橘、瓯柑持续挂树蓄甜。冬日干燥少雨，果农做好果树根部培土护根、树干涂白，抵御寒风冻害，保护越冬果树与挂树鲜果。',
    enName: 'Minor Snow', enHeadline: 'Deep cold; kumquats hold their fragrance',
    enText: 'Temperatures plunge; kumquats ripen in turn — small, golden and fragrant. Mandarins and Ou mandarins keep sweetening on the tree. Dry winter air calls for mounding soil around roots and whitewashing trunks against wind and frost, protecting overwintering trees and fruit.'
  },
  {
    id: 'daxue', name: '大雪', season: 'winter', headline: '寒深果熟，冬味正浓',
    text: '大雪天寒，瓯柑、柑橘全面成熟上市，是本土冬日核心鲜果。冬果历经风霜洗礼，酸甜均衡、风味沉稳。大雪不重农事采收，重在养护树势、清理果园杂草，杜绝冬日病虫滋生。',
    enName: 'Major Snow', enHeadline: 'Deep cold, deep flavour',
    enText: 'In the cold of Daxue, Ou mandarins and mandarins ripen fully — the core fresh fruit of winter. Weathered by wind and frost, their sweet-tart balance is steady and deep. Farm work eases; the focus is tree vigour and clearing orchard weeds to starve winter pests.'
  },
  {
    id: 'dongzhi', name: '冬至', season: 'winter', headline: '岁末天寒，冬甜收官',
    text: '冬至阴极之至，柚子采收收尾，柑桔甜度达到全年顶峰。民间冬至食冬果，寓意岁末圆满、清甜收官。冬至之后万物休养生息，果树进入深度休眠，静待来年春生。',
    enName: 'Winter Solstice', enHeadline: 'The year\'s cold peaks; winter sweetness closes',
    enText: 'At Dongzhi the pomelo harvest finishes and mandarin sweetness peaks for the year. Folk custom eats winter fruit at the solstice — a sweet, complete close to the year. Afterwards trees enter deep dormancy, resting for the spring to come.'
  },
  {
    id: 'xiaohan', name: '小寒', season: 'winter', headline: '万物蛰伏，蓄势待春',
    text: '小寒深冬严寒，果树完全休眠，无鲜果采收。老农讲究“冬养一树，春收满筐”，小寒深耕土地、埋施冬肥、修剪树形，修复全年挂果损耗，为来年四季鲜果丰收筑牢根基。',
    enName: 'Minor Cold', enHeadline: 'All lies dormant; strength waits for spring',
    enText: 'Deep winter cold; trees sleep fully, with no fresh harvest. Old farmers say ‛raise the tree in winter, harvest baskets in spring”: deep cultivation, winter manure and formative pruning repair the year\'s fruiting drain and build the base for the seasons ahead.'
  },
  {
    id: 'dahan', name: '大寒', season: 'winter', headline: '岁暮归藏，静待新生',
    text: '大寒为终，四时闭环。果园彻底休养生息，土地冻土保肥、树木蓄存元气。一岁耕耘、一岁收获，所有乡土果事归于沉静，静待春风再起、繁花再开、百果重生。',
    enName: 'Major Cold', enHeadline: 'The year closes in storage; awaiting rebirth',
    enText: 'Dahan ends the cycle and the four seasons close their loop. Orchards rest thoroughly; frozen soil holds fertility and trees store vitality. A year of work, a year of harvest — all country fruit-keeping falls quiet, awaiting spring wind, blossom and fruit again.'
  }
];

// 节气的大致公历时段（每月两个），用于推断“当前节气”。
const TERM_CALENDAR = [
  { term: '小寒', month: 1, day: 5 }, { term: '大寒', month: 1, day: 20 },
  { term: '立春', month: 2, day: 4 }, { term: '雨水', month: 2, day: 19 },
  { term: '惊蛰', month: 3, day: 6 }, { term: '春分', month: 3, day: 21 },
  { term: '清明', month: 4, day: 5 }, { term: '谷雨', month: 4, day: 20 },
  { term: '立夏', month: 5, day: 6 }, { term: '小满', month: 5, day: 21 },
  { term: '芒种', month: 6, day: 6 }, { term: '夏至', month: 6, day: 21 },
  { term: '小暑', month: 7, day: 7 }, { term: '大暑', month: 7, day: 23 },
  { term: '立秋', month: 8, day: 7 }, { term: '处暑', month: 8, day: 23 },
  { term: '白露', month: 9, day: 8 }, { term: '秋分', month: 9, day: 23 },
  { term: '寒露', month: 10, day: 8 }, { term: '霜降', month: 10, day: 23 },
  { term: '立冬', month: 11, day: 7 }, { term: '小雪', month: 11, day: 22 },
  { term: '大雪', month: 12, day: 7 }, { term: '冬至', month: 12, day: 22 }
];

function byName(name) { return TERMS.find(item => item.name === name) || null; }

// 当前节气：按公历日期落入的时段判断。
function currentTerm(date) {
  const now = date ? new Date(date) : new Date();
  if (!Number.isFinite(now.getTime())) return TERMS[0];
  const month = now.getMonth() + 1;
  const day = now.getDate();
  let name = '冬至';
  TERM_CALENDAR.forEach(item => { if (item.month === month && day >= item.day) name = item.term; });
  if (!TERM_CALENDAR.some(item => item.month === month && day >= item.day)) {
    const previous = TERM_CALENDAR.filter(item => item.month < month).pop();
    if (previous) name = previous.term;
  }
  return byName(name) || TERMS[0];
}

// 某月的节气（两个），用于按月轮换札记。
function termsOfMonth(month) {
  const names = TERM_CALENDAR.filter(item => item.month === month).map(item => item.term);
  return names.map(byName).filter(Boolean);
}

// 发现页海报的日期行要用「秋分 · 第 15 天 ｜ 距霜降 8 天」。
// 全部按 TERM_CALENDAR 的公历时段推算，不写死任何数字。
function termProgress(date) {
  const now = date ? new Date(date) : new Date();
  if (!Number.isFinite(now.getTime())) return null;
  const year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate());
  const DAY = 86400000;

  let cur = null;
  let next = null;
  TERM_CALENDAR.forEach(function (item, index) {
    const start = new Date(year, item.month - 1, item.day);
    if (today.getTime() >= start.getTime()) {
      cur = { term: item.term, start: start };
      const nx = TERM_CALENDAR[index + 1];
      next = nx ? { term: nx.term, start: new Date(year, nx.month - 1, nx.day) }
        : { term: TERM_CALENDAR[0].term, start: new Date(year + 1, TERM_CALENDAR[0].month - 1, TERM_CALENDAR[0].day) };
    }
  });
  // 一月初还没到小寒：仍属上一年冬至，下一个节气是当年小寒。
  if (!cur) {
    cur = { term: '冬至', start: new Date(year - 1, 11, 22) };
    next = { term: TERM_CALENDAR[0].term, start: new Date(year, TERM_CALENDAR[0].month - 1, TERM_CALENDAR[0].day) };
  }

  const curNote = byName(cur.term) || {};
  const nextNote = byName(next.term) || {};
  return {
    name: cur.term,
    nameEn: curNote.enName || cur.term,
    dayIndex: Math.round((today.getTime() - cur.start.getTime()) / DAY) + 1,
    nextName: next.term,
    nextEn: nextNote.enName || next.term,
    daysToNext: Math.round((next.start.getTime() - today.getTime()) / DAY)
  };
}

module.exports = { TERMS, currentTerm, termsOfMonth, byName, termProgress };
