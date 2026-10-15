// 农事转盘 · 英文对照 · 农事维度（25 题）
// 术语处理：节气保留拼音首字母大写（Lixia、Xiaoman）；管理术语用国际通用表达
//（疏果=thinning、坐果=set fruit、日灼=sunburn、倒春寒=late spring frost）。
// 农事转盘 · 英文对照（150 题 = 6 维度 × 25 题），2026-10-06。
// 术语约定：节气保留拼音首字母大写（Lixia / Xiaoman / Guyu / Jingzhe / Mangzhong /
// Hanlu / Shuangjiang / Lidong / Liqiu / Xiaohan / Xiaoxue / Qixi）；管理术语用国际通用表达
//（疏果 thinning、坐果 set fruit、日灼 sunburn、倒春寒 late spring frost）。
// 结构：s=题干，o=4 个选项（与中文侧顺序一致，correct 标记由中文侧保留），k=3 条知识点。
module.exports = {
  "青梅-小满-农事": {
    s: "At Xiaoman the young green plums swell day by day, and the growers are busy easing the load on the trees.",
    o: ["Thin out the weak fruit and keep the canopy airy and well lit", "Spray the trees with a fruit-set hormone to steady the crop", "Pick early to catch the first prices of the season", "Light smoky fires in the orchard to keep the wind off"],
    k: ["At Xiaoman the young plums are swelling and need thinning to ease the load", "Removing the weak fruit lets the ones that stay grow larger", "Green plum ripens gradually from late spring into early summer"]
  },
  "青梅-惊蛰-农事": {
    s: "With Jingzhe here the green plum flower buds are opening, and a cold spell in the night is what the growers fear most.",
    o: ["Guard the blossoms against a late frost, smoking or covering them if needed", "Water the trees during flowering to push fruit set", "Carry out the summer pruning now, months ahead of time", "Apply base fertiliser in autumn"],
    k: ["At Jingzhe the green plum blossoms, and a late frost is what ruins the flowers", "In a cold snap the growers smoke the orchard through the night to keep off the frost", "Green plum is a tree that runs from spring into summer"]
  },
  "c-plum-farm": {
    s: "In the plum grove at the end of spring the young fruit has only just set, and a strong wind can knock it down. The growers are worried about the young fruit being blown off.",
    o: ["Brace the branches and mound soil around the roots to anchor the trees", "Spray the trees with a fruit-set hormone to steady the crop", "Thin out half the young fruit early to protect the yield", "Light smoky fires in the orchard to keep the wind off"],
    k: ["Green plum ripens in late spring, and strong winds easily blow the young fruit down", "When a gale comes, brace the branches and mound soil around the roots", "These growers have kept the old ways for generations — pickled plum, green plum wine"]
  },
  "桑葚-小满-农事": {
    s: "At Xiaoman the mulberries turn from red to purple, and the growers fear the birds coming to peck.",
    o: ["Guard against birds and pick in batches at the right moment", "Light smoky fires to scare off the birds", "Cover the trees with film to keep them warm", "Thin the flowers at flowering"],
    k: ["Mulberries ripen at Xiaoman and are vulnerable to birds", "Picking mulberry leaves to feed silkworms is the great farm work of spring", "Mulberries must be picked in batches"]
  },
  "桑葚-立夏-农事": {
    s: "At Lixia the branches are heavy with purple-black mulberries, and they must come off at peak ripeness.",
    o: ["Pick at the right moment and tend the tree afterwards", "Lay film over the soil back in early spring", "Spray foliar feed at flowering", "Prune hard in winter"],
    k: ["At Lixia the mulberries are at their fullest ripeness", "Caring for the tree after the pick sets up next year", "The old way makes organic fertiliser from fallen leaves and straw"]
  },
  "c-mulberry-farm": {
    s: "The mulberries in the grove are nearly ripe, and the grower wants to look after the mulberry trees. Which practice fits the old ways better?",
    o: ["Use organic fertiliser fermented from fallen leaves and straw", "Spray foliar feed to push leaf growth", "Spread wood ash over the roots to keep them warm", "Cut away the old wood and keep only the new shoots"],
    k: ["Harvesting mulberry leaves to feed silkworms is the most important farm work of spring", "The old way tends the mulberry tree with organic fertiliser fermented from fallen leaves and straw", "Boiling mulberry paste and drying mulberries is the old craft that keeps this season going"]
  },
  "樱桃-小满-农事": {
    s: "At Xiaoman the cherries have turned red, and the growers fear above all the birds and the rain that cracks the fruit.",
    o: ["Guard against birds and against splitting fruit", "Protect the blossoms from frost at flowering", "Apply base fertiliser in autumn", "Prune hard in summer"],
    k: ["Cherries near ripeness at Xiaoman are vulnerable to birds and to splitting", "The cherry season is short, so pick at peak ripeness", "The cherry is the first branch among the hundred fruits"]
  },
  "c-cherry-farm": {
    s: "The cherry is called the \"first branch among the hundred fruits\" and ripens especially early. What should the grower watch in spring?",
    o: ["Cherry blossoms first in spring and the fruit ripens first in summer, so guard against a late spring frost", "Spray an anti-frost solution at flowering to protect flowers and fruit", "Lay mulch over the ground in early spring to raise soil temperature", "Thin the early flowers and keep the late ones to steady the crop"],
    k: ["The cherry takes its Chinese name \"hantao\" from the orioles that carried it away to eat", "The cherry is the first to flower in spring and the first to ripen in summer", "In ancient times the first cherries of the season were offered at the ancestral hall before anything else"]
  },
  "枇杷-小寒-农事": {
    s: "In Xiaohan the weather is cold, yet the loquat is flowering and setting small fruit.",
    o: ["Guard the flowers against the cold and protect the young fruit", "Thin the flowers now", "Water the trees at flowering", "Bag the fruit"],
    k: ["The loquat flowers in autumn and winter and sets fruit in winter", "At Xiaohan the flower buds need protecting from the cold wind", "The loquat carries its fruit across the winter"]
  },
  "c-loquat-farm": {
    s: "The loquat flowers in autumn and winter and fruits in spring, so its care cycle is long. What does the orchard most need guarding against in winter?",
    o: ["Guard the flower buds against frost and cold wind", "Thin the flowers in early spring to improve fruit set", "Water at flowering to prevent drought", "Bag the fruit to keep insects off"],
    k: ["The loquat flowers in autumn and winter, fruits in spring, and carries the fruit across the winter", "In winter the flower buds must be protected from the cold wind", "When the spring rains come, guard against young fruit rotting in the wet"]
  },
  "c-peach-farm": {
    s: "In the peach orchard in spring the blossoms are at their fullest, and what worries the grower most is what?",
    o: ["A late frost damaging the young fruit", "Shaking the tree to shed rain during flowering", "Summer pruning to check excessive growth", "Base fertiliser in autumn"],
    k: ["The peach tree flowers richly in spring and fruits in summer", "In spring the fear is a late frost damaging the young fruit; in a cold snap growers smoke the orchard through the night", "Old practice holds that a peach tree must be thinned of both flowers and fruit"]
  },
  "桃-春分-农事": {
    s: "At the equinox the peach orchard is a wash of pink and white, and the growers watch the sky, afraid of cold.",
    o: ["Guard the blossoms against a late frost and help with pollination", "Thin the fruit now — far too early", "Carry out the summer pruning now", "Prune after picking"],
    k: ["At the spring equinox the peach blossoms, and a late frost can ruin them", "The peach tree flowers richly in spring and fruits in summer", "The old way holds that a peach tree must be thinned of flowers and fruit"]
  },
  "桃-夏至-农事": {
    s: "At the summer solstice the peaches are setting, and the dense branches need air.",
    o: ["Summer pruning, guarding against sunburn and split fruit", "The hard winter pruning, done now", "Frost protection at flowering", "Thinning the flowers"],
    k: ["At the summer solstice the peach fruit is swelling and needs summer pruning for air", "Peaches are afraid of sunburn and of splitting in heavy rain", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  "c-litchi-farm": {
    s: "What weather does the lychee fear most at flowering?",
    o: ["Continuous rain, which soaks the stamens and makes fruit set fail", "Hand pollination at full flowering", "Thinning the young fruit to keep the fruit large", "Pruning after picking to restore the tree"],
    k: ["The lychee fears rain at flowering; continuous rain makes fruit set fail", "Every deep winter the branches are pruned and the diseased, weak wood removed", "The lychee bears well in some years and poorly in others, and breeding new varieties addresses the shortfalls"]
  },
  "c-bayberry-farm": {
    s: "Bayberry is at its peak around the summer solstice. What characterises its best eating window?",
    o: ["The window is short, and around the summer solstice is best", "Polytunnel growing to delay the harvest into autumn", "Cold storage to keep it through the whole summer", "Picking in batches to stretch the season"],
    k: ["The bayberry’s best eating window is short, and around the summer solstice is best", "\"Bayberries redden the hills at the summer solstice; at Xiaoshu the fruit begins to worm\"", "Whether the fruit worms varies with how the trees are managed"]
  },
  "杏-惊蛰-农事": {
    s: "At Jingzhe the apricot blossoms have only just opened, and a single cold spell can ruin them.",
    o: ["Guard the blossoms against a late frost", "Sunburn in summer", "Continuous autumn rain", "Low winter temperatures"],
    k: ["Early spring apricot blossoms are vulnerable to a late frost", "The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a national geographical indication"]
  },
  "c-apricot-farm": {
    s: "The apricots are ripe. What should the grower do at once?",
    o: ["Pick them promptly while they are ripe", "Leave them hanging to get sweeter before picking", "Withhold water before picking to raise the sugar", "Pick early in batches to dodge the rain"],
    k: ["The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a national geographical indication", "Dried apricots, apricot preserves and apricot jam are the traditional ways"]
  },
  "c-hawthorn-farm": {
    s: "When does the hawthorn ripen, and when does one make candied haws on a stick?",
    o: ["It ripens around Hanlu, and candied haws are commonly made after Shuangjiang", "Start at Liqiu — the earliest", "Pick at Lidong, when they are sweetest", "Pick before Shuangjiang, when the sourness suits candied haws"],
    k: ["The hawthorn ripens around Hanlu", "Candied haws on sticks are commonly made after Shuangjiang", "Xinglong in Hebei, Huixian in Henan and Zezhou in Shanxi are the producing areas"]
  },
  "c-persimmon-farm": {
    s: "When is the best time to pick the persimmon?",
    o: ["It ripens after Shuangjiang, and the frost makes it sweeter", "Dry it for a few days after picking so the astringency goes", "Pick early while firm so it travels well", "Soak it in warm water to ripen and sweeten it"],
    k: ["The persimmon ripens after Shuangjiang, and frost makes it sweeter", "Dried persimmon goes through peeling, hanging to dry, and frosting", "The old saying goes, \"a persimmon grove never comes true\""]
  },
  "c-jujube-farm": {
    s: "From the first month to the ninth, what does the jujube grower do every day?",
    o: ["Walk the orchard morning and evening", "Tend the trees only in a concentrated spell at flowering", "Only go in to drain the orchard during the rains", "Hire someone else to manage it"],
    k: ["From pruning in the first month to picking in the ninth, a walk morning and evening, every day", "No herbicide, no hormone, everything picked by hand", "There is no shortcut to growing jujubes; it is all down to care"]
  },
  "c-pear-farm": {
    s: "In the pear orchard in autumn, what weather do the growers fear most?",
    o: ["An early frost", "A late frost at flowering", "Hail during the young fruit stage", "Birds before picking"],
    k: ["The autumn pear fears an early frost, and old growers guard against it in advance", "The old way tends the pear tree with farmyard manure", "The pear flowers in spring and is harvested in autumn"]
  },
  "c-ougan-farm": {
    s: "How is the ougan managed through winter?",
    o: ["Left hanging on the tree through winter, and it tolerates the cold", "Stored in a cellar after picking", "Covered with film against frost to protect the fruit", "Picked early and put into store"],
    k: ["The ougan is an old native citrus of Zhejiang, and it hangs on the tree through winter", "The ougan tolerates cold and ripens in late winter", "In former times the ougan was a prized fresh fruit for the winter months"]
  },
  "c-tangerine-farm": {
    s: "How do sugar tangerines see the winter?",
    o: ["They hang on the tree through winter, slowly building up sugar", "Picked and put into cold store", "Covered with film to keep warm and ripen", "Picked early and stored to build up the sugar"],
    k: ["The sugar tangerine hangs on the tree through winter, slowly accumulating sugar", "Its skin is thin and sandy, sweet and melting in the mouth", "The Wuzhou sugar tangerine has 400 years of history behind it"]
  },
  "c-pomelo-farm": {
    s: "When does the pomelo ripen?",
    o: ["It ripens and goes to market around Mid-Autumn", "It ripens around the Dragon Boat Festival", "It ripens around the Double Ninth Festival", "It ripens around the Lantern Festival"],
    k: ["The pomelo ripens around Mid-Autumn", "Pinghe Guanxi honey pomelo and Xianyou Duwei wendan pomelo are geographical indications", "\"Pomelo\" sounds like \"bless\" in Chinese, so it carries auspicious meaning"]
  },
  "c-kumquat-farm": {
    s: "When does the kumquat ripen?",
    o: ["It ripens at Xiaoxue, and hangs on the tree through winter", "It is picked at Lidong and put into store", "It is ripened under film", "It only ripens at the start of spring"],
    k: ["The kumquat is small and golden, and ripens at Xiaoxue", "The kumquat tolerates cold and hangs on the tree through winter", "Rongan kumquats have nearly 300 years of cultivation behind them"]
  },
  "青梅-小满-民俗": {
    s: "At Xiaoman the young green plums swell day by day, and this hillside plum orchard has an old way of dealing with insects, handed down generation by generation.",
    o: ["Sweep the fallen leaves out of the orchard in winter, and lay a ring of wood ash around the base of each tree to drive insects away", "Spray chemical pesticide during flowering to wipe out the insects completely", "Wrap the trunks in plastic film to keep insects off", "Bury large amounts of chemical fertiliser in the soil to strengthen the trees"],
    k: ["The old way leans on less pesticide — clear the orchard and sweep the leaves in winter", "A ring of wood ash around the tree base; insects will not cross that ash ridge", "One more dressing after the thaw in spring, the way this hillside orchard has always done it"]
  },
  "青梅-惊蛰-民俗": {
    s: "At Jingzhe the green plum flower buds are opening, and the old orchard holds that thinning the branches calls for one particular bamboo tool.",
    o: ["Thin and shape the branches with bamboo pruning shears, opening up the tangle inside the canopy", "Saw the big limbs off flush with a metal saw", "Thin out all the fruit and keep only the flowers", "Paint the trunks white to prevent frost damage"],
    k: ["The plum orchard uses bamboo pruning shears to thin and shape the branches", "The cuts come away clean, opening the tangled inner wood and the drooping limbs", "An airy, well-lit canopy is what lets the fruit hang on"]
  },
  "c-plum-custom": {
    s: "At Mangzhong the plum season lasts barely a fortnight, and the growers have rules about the tools they use.",
    o: ["Lay cloth under the tree and shake the ripe fruit down, then grade and drain it on bamboo sieves", "Rake the fruit into the basket with an iron rake", "Climb the tree and pull the fruit off hard", "Soak it in water to keep it fresh"],
    k: ["When the fruit is ripe, cloth goes under the tree and the branches are shaken gently to collect what falls", "Bamboo sieves are used for grading and draining", "At the end of the day the tools are wiped clean and hung on the mud wall, within reach next year"]
  },
  "桑葚-小满-民俗": {
    s: "At Xiaoman the mulberries turn from red to purple, and in the old mulberry grove the picking vessels are chosen carefully.",
    o: ["Shallow bamboo baskets, layered gently, with soft cloth under the base", "Deep iron barrels packed full and pressed down", "Tipped straight into burlap sacks", "Scooped out with an iron ladle"],
    k: ["Picking mulberries calls for shallow bamboo baskets, layered gently so the purple juice is not pressed out", "A layer of soft cloth goes under the basket, and the fruit rests in two or three light layers", "Purple juice blackens on contact with iron, so the picking tools avoid metal"]
  },
  "c-mulberry-custom": {
    s: "At Lixia the branches are heavy with purple-black mulberries. Which tool is used for pruning branches and picking leaves?",
    o: ["Mulberry shears for pruning and picking, with narrow pointed blades for old wood", "A cleaver to chop the branches", "Branches broken by hand", "An iron rake combed through the leaves"],
    k: ["Mulberry shears have narrow, pointed blades made for crossing old wood", "Neither pruning nor picking leaves can do without them", "For the fruit, shallow bamboo baskets and wicker baskets are best"]
  },
  "桑葚-谷雨-民俗": {
    s: "Around Guyu the mulberries are nearly ripe, and the households that raise silkworms have an old way of making compost.",
    o: ["Tending the mulberry tree with organic fertiliser fermented from fallen leaves and straw", "Spraying foliar feed to push leaf growth", "Spreading wood ash over the roots to keep them warm", "Cutting away the old wood and keeping only the new shoots"],
    k: ["Harvesting mulberry leaves to feed silkworms is the most important farm work of spring", "The old way tends the mulberry tree with organic fertiliser fermented from fallen leaves and straw", "Boiling mulberry paste and drying mulberries is the old craft that keeps the season going"]
  },
  "c-cherry-folk": {
    s: "At Xiaoman the cherries have turned red, and the hillside orchard picks with two bamboo tools.",
    o: ["A bamboo ladder stood high to reach the branches, and shallow ribbed bamboo baskets lined with cloth to set the fruit down gently", "Climb the tree and pull the fruit off hard", "Put the fruit in iron barrels", "Shake the tree and catch what falls"],
    k: ["Picking cherries calls for a bamboo ladder and bamboo baskets", "Where the branches are out of reach, set up a ladder; the fruit is delicate, so a shallow basket and a light hand", "The ladder is made from large mountain bamboo — light and strong"]
  },
  "樱桃-谷雨-民俗": {
    s: "Around Guyu the cherry is called the first branch among the hundred fruits, and its care rests on experience passed down through the hands.",
    o: ["Keep only two or three fruit per cluster, so that a heavy set does not mean small fruit", "Keep every bit of fruit, the more the better", "Strip all the leaves to let in the light", "Bag the fruit in three layers"],
    k: ["Thinning the flowers and fruit rests on experience in the hand", "Keep only two or three fruit per cluster; set too heavy and the fruit stays small and the tree tires", "The cherry flowers first in spring and ripens first in summer"]
  },
  "枇杷-小寒-民俗": {
    s: "In Xiaohan the weather is cold, yet the loquat is flowering and setting small fruit. How does the old grower look after the roots?",
    o: ["Spread pond mud and farmyard manure around the tree, and mound soil over the roots in winter", "Scatter chemical fertiliser every season", "Expose the roots to the air so they can breathe", "Paint the trunks"],
    k: ["The old way of growing begins with looking after the roots", "Spread pond mud and farmyard manure around the tree, and mound soil over the roots in winter", "In spring, watch the sky before thinning the fruit, and leave the nutrition for the good branches"]
  },
  "c-loquat-custom": {
    s: "At Xiaoman the loquat is half yellow on the slope, and at picking the work of the hand matters most.",
    o: ["One hand cradles the fruit cluster while the other cuts the stem, then stack upright into paper-lined shallow baskets", "Grab a handful and pull it off the tree", "Hook the fruit down with an iron hook", "Shake the tree and catch what falls"],
    k: ["The loquat skin is thin, so picking means cradling the fruit and cutting the stem, then layering it in shallow baskets", "A single fingerprint dulls the skin", "A layer of paper between each layer of fruit, and no more than two or three layers to a basket"]
  },
  "桃-惊蛰-民俗": {
    s: "In the peach orchard in spring the blossoms are at their fullest, and the old experience insists on one thinning job.",
    o: ["Thin the flowers and the fruit, so that the fruit grows large", "Keep all the fruit, the more the better", "Cut all the flowers away", "Bag every single flower"],
    k: ["Old experience holds that a peach tree must be thinned of both flowers and fruit", "Thin away the surplus flowers and fruit so that what remains grows large", "The peach tree flowers richly in spring and fruits in summer"]
  },
  "c-peach-custom": {
    s: "At the spring equinox the peach blossoms are a wash of pink and white. What guards the flowering?",
    o: ["Guard the blossoms against a late frost and help with pollination", "Thin the fruit now — far too early", "Prune now what is only pruned in summer", "Prune after picking"],
    k: ["At the spring equinox the peach blossoms, and a late frost can ruin them", "The peach tree flowers richly in spring and fruits in summer", "The old way holds that a peach tree must be thinned of flowers and fruit"]
  },
  "桃-夏至-民俗": {
    s: "At the summer solstice the peaches are setting and the dense branches need air. How does the old way prune?",
    o: ["Summer pruning, guarding against sunburn and split fruit", "The winter pruning, done now", "Frost protection at flowering", "Thinning the flowers"],
    k: ["At the summer solstice the peach fruit is swelling and needs summer pruning for air", "Peaches are afraid of sunburn and of splitting in heavy rain", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  "c-litchi-custom": {
    s: "The lychee bears well in some years and poorly in others. How does the old grower tend the tree in deep winter?",
    o: ["Prune in deep winter, cutting out diseased and weak wood and balancing the tree", "Spray a fruit-set hormone at flowering", "Thin the young fruit to keep the fruit large", "Prune hard after picking to restore the tree"],
    k: ["Every deep winter the branches are pruned and the diseased, weak wood removed", "The lychee bears well in some years and poorly in others, and breeding new varieties addresses the shortfalls", "The lychee fears rain at flowering; continuous rain makes fruit set fail"]
  },
  "c-bayberry-custom": {
    s: "The bayberry is delicate and has no skin, so what is the old rule of the hand at picking?",
    o: ["Trim the nails flat, and line the basket with pine needles and fern fronds to prevent bruising", "Pick hard in iron gloves", "Pack deep in iron barrels", "Carry it in sacks"],
    k: ["Bayberries are picked into shallow bamboo baskets lined with pine needles and fern fronds so the fruit is not pressed", "Never piled deep, never tipped from sacks", "The bayberry has no skin; its surface is its face, and one pinch leaves a mark — hence, trim the nails flat"]
  },
  "杏-惊蛰-民俗": {
    s: "Dunhuang has an apricot craft passed down generation by generation. What is it?",
    o: ["Apricot skin water, an intangible heritage of Dunhuang, boiled by the old method", "Apricots dried mechanically", "Apricot wine fermented industrially", "Apricot preserves coloured with chemicals"],
    k: ["Apricot skin water is an intangible cultural heritage of Dunhuang", "Dried apricots, apricot preserves and apricot jam are the traditional ways", "The Dunhuang Ligong apricot takes its name from this"]
  },
  "c-apricot-custom": {
    s: "At Mangzhong the apricots have turned yellow. How does the grower judge the moment to pick?",
    o: ["Pick promptly while they are ripe, without clinging to the branch", "Leave them hanging to get sweeter before picking", "Withhold water before picking to raise the sugar", "Pick early in batches to dodge the rain"],
    k: ["The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a national geographical indication", "Dried apricots, apricot preserves and apricot jam are the traditional ways"]
  },
  "c-hawthorn-custom": {
    s: "When is the most natural time to make candied haws on a stick?",
    o: ["The fruit ripens around Hanlu, and candied haws are commonly made after Shuangjiang", "Start at Liqiu — the earliest", "Pick at Lidong, when they are sweetest", "Pick before Shuangjiang, when the sourness suits candied haws"],
    k: ["The hawthorn ripens around Hanlu", "Candied haws on sticks are commonly made after Shuangjiang", "Xinglong in Hebei, Huixian in Henan and Zezhou in Shanxi are the producing areas"]
  },
  "c-persimmon-custom": {
    s: "Making dried persimmon cake — how many stages does the old craft have?",
    o: ["Peel, hang to dry, then frost", "Dry it straight in the sun without peeling", "Soak it in a solution to force the frost", "Press it flat in a machine"],
    k: ["Dried persimmon goes through peeling, hanging to dry, and frosting", "Moon-shaped dried persimmon had its processing technique by the Qing dynasty", "Gongcheng moon persimmons account for 18.4% of national output"]
  },
  "c-jujube-custom": {
    s: "From the first month to the ninth, what characterises the old jujube grower’s care?",
    o: ["Walk the orchard morning and evening, with no herbicide and no hormone", "Tend the trees only in a concentrated spell at flowering", "Only go in to drain the orchard during the rains", "Hire someone else to manage it"],
    k: ["From pruning in the first month to picking in the ninth, a walk morning and evening, every day", "No herbicide, no hormone, everything picked by hand", "There is no shortcut to growing jujubes; it is all down to care"]
  },
  "c-pear-custom": {
    s: "In the pear orchard in autumn, how does the old grower look after the pear tree?",
    o: ["Tend the pear tree with farmyard manure, the old way", "Scatter chemical fertiliser every season", "Expose the roots to the air so they can breathe", "Paint the trunks"],
    k: ["The old way tends the pear tree with farmyard manure", "When the pear ripens there is a folk custom of tasting the new fruit in autumn", "The Dangshan su pear is a geographical indication (sandy soil of the old Yellow River course)"]
  },
  "c-ougan-custom": {
    s: "The ougan is an old native citrus of Zhejiang. How is it tended in winter?",
    o: ["Left hanging on the tree through winter, and it tolerates the cold", "Stored in a cellar after picking", "Covered with film against frost to protect the fruit", "Picked early and put into store"],
    k: ["The ougan is an old native citrus of Zhejiang, and it hangs on the tree through winter", "The ougan tolerates cold and ripens in late winter", "In former times the ougan was a prized fresh fruit for the winter months"]
  },
  "c-tangerine-custom": {
    s: "How do sugar tangerines build up their sugar over winter?",
    o: ["They hang on the tree through winter, slowly building up sugar", "Picked and put into cold store", "Covered with film to keep warm and ripen", "Picked early and stored to build up the sugar"],
    k: ["The sugar tangerine hangs on the tree through winter, slowly accumulating sugar", "Its skin is thin and sandy, sweet and melting in the mouth", "The Wuzhou sugar tangerine has 400 years of history behind it"]
  },
  "c-pomelo-custom": {
    s: "When does the pomelo ripen and go to market?",
    o: ["It ripens and goes to market around Mid-Autumn", "It ripens around the Dragon Boat Festival", "It ripens around the Double Ninth Festival", "It ripens around the Lantern Festival"],
    k: ["The pomelo ripens around Mid-Autumn", "Pinghe Guanxi honey pomelo and Xianyou Duwei wendan pomelo are geographical indications", "\"Pomelo\" sounds like \"bless\" in Chinese, so it carries auspicious meaning"]
  },
  "c-kumquat-custom": {
    s: "The kumquat ripens at Xiaoxue. How is it tended in winter?",
    o: ["It ripens at Xiaoxue, and hangs on the tree through winter", "It is picked at Lidong and put into store", "It is ripened under film", "It only ripens at the start of spring"],
    k: ["The kumquat is small and golden, and ripens at Xiaoxue", "The kumquat tolerates cold and hangs on the tree through winter", "Rongan kumquats have nearly 300 years of cultivation behind them"]
  },
  "c-plum-store": {
    s: "A great many green plums came in at once, and you want to keep them to eat slowly through the summer. What is the best way to store them?",
    o: ["Pickle them in an earthenware jar as preserved plum, or brew green plum wine", "Vacuum-freeze them, which keeps them longest", "Dry them in the shade into dried plum and store them sealed", "Make plum jam and keep it bottled in the fridge"],
    k: ["For preserved plum, salt first to draw the moisture out of the fruit", "For green plum wine, keep the fruit whole, lay rock sugar underneath, and let the wine cover the fruit", "The plum season lasts only a fortnight, so the fruit goes into the jars while it is fresh"]
  },
  "青梅-惊蛰-储存": {
    s: "The green plums around Jingzhe have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Pickle them in an earthenware jar as preserved plum, or brew green plum wine", "Vacuum-freeze them, which keeps them longest", "Dry them in the shade into dried plum and store them sealed", "Make plum jam and keep it bottled in the fridge"],
    k: ["For preserved plum, salt first to draw the moisture out of the fruit", "For green plum wine, keep the fruit whole, lay rock sugar underneath, and let the wine cover the fruit", "The plum season lasts only a fortnight, so the fruit goes into the jars while it is fresh"]
  },
  "青梅-芒种-储存": {
    s: "The green plums around Mangzhong have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Pickle them in an earthenware jar as preserved plum, or brew green plum wine", "Vacuum-freeze them, which keeps them longest", "Dry them in the shade into dried plum and store them sealed", "Make plum jam and keep it bottled in the fridge"],
    k: ["For preserved plum, salt first to draw the moisture out of the fruit", "For green plum wine, keep the fruit whole, lay rock sugar underneath, and let the wine cover the fruit", "The plum season lasts only a fortnight, so the fruit goes into the jars while it is fresh"]
  },
  "c-mulberry-store": {
    s: "Mulberries ripen fast, and you want to keep them a few more days. Which method suits them?",
    o: ["Boil them down to a paste or dry them, so the fruit keeps once the moisture is gone", "Refrigerate them for half a year without spoiling", "Press them into a jar, seal them, and let them ferment into wine", "Freeze them quickly so the nutrition does not fade"],
    k: ["For the paste, use an earthen pot rather than iron, and boil the mulberries with rock sugar", "For drying, keep them in a airy, sunny place and turn them once in the morning and once in the evening", "One paste and one drying extend the mulberry season by a full year"]
  },
  "桑葚-立夏-储存": {
    s: "The mulberries around Lixia have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Boil them down to a paste or dry them, so the fruit keeps once the moisture is gone", "Refrigerate them for half a year without spoiling", "Press them into a jar, seal them, and let them ferment into wine", "Freeze them quickly so the nutrition does not fade"],
    k: ["For the paste, use an earthen pot rather than iron, and boil the mulberries with rock sugar", "For drying, keep them in a airy, sunny place and turn them once in the morning and once in the evening", "One paste and one drying extend the mulberry season by a full year"]
  },
  "桑葚-谷雨-储存": {
    s: "The mulberries around Guyu have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Boil them down to a paste or dry them, so the fruit keeps once the moisture is gone", "Refrigerate them for half a year without spoiling", "Press them into a jar, seal them, and let them ferment into wine", "Freeze them quickly so the nutrition does not fade"],
    k: ["For the paste, use an earthen pot rather than iron, and boil the mulberries with rock sugar", "For drying, keep them in a airy, sunny place and turn them once in the morning and once in the evening", "One paste and one drying extend the mulberry season by a full year"]
  },
  "c-cherry-store": {
    s: "Cherries ripen fast and are easily bruised. A basket of cherries has just come in — what is the best way to handle them?",
    o: ["Eat them fresh as soon as possible; they do not keep well", "Salt them and they will keep a whole season", "Pip and freeze them for half a year", "Dry them into cherries and they will keep longest"],
    k: ["The cherry season is short, and eating them fresh is the best use", "A basket carried to someone is the earliest sweetness of the year, delivered", "In former times the folk carried fresh cherries to relatives and friends"]
  },
  "樱桃-谷雨-储存": {
    s: "The cherries around Guyu have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Eat them fresh as soon as possible; they do not keep well", "Salt them and they will keep a whole season", "Pip and freeze them for half a year", "Dry them into cherries and they will keep longest"],
    k: ["The cherry season is short, and eating them fresh is the best use", "A basket carried to someone is the earliest sweetness of the year, delivered", "In former times the folk carried fresh cherries to relatives and friends"]
  },
  "枇杷-小寒-储存": {
    s: "The loquats around Xiaohan have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Boil them down into loquat paste and use it slowly", "Candied loquat keeps the longest", "Freeze them and keep them through the winter", "Dry them into dried loquat, which keeps easily"],
    k: ["Pickling loquat and boiling loquat paste are traditional crafts", "Loquat paste is commonly used to soothe the throat", "Fresh loquat does not keep well"]
  },
  "c-loquat-store": {
    s: "A good many loquats have come in and you want to keep part of them. What does the old way do best?",
    o: ["Boil them down into loquat paste and use it slowly", "Candied loquat keeps the longest", "Freeze them and keep them through the winter", "Dry them into dried loquat, which keeps easily"],
    k: ["Pickling loquat and boiling loquat paste are traditional crafts", "Loquat paste is commonly used to soothe the throat", "Fresh loquat does not keep well"]
  },
  "桃-惊蛰-储存": {
    s: "The peaches around Jingzhe have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Make dried peach preserves to keep them", "Freeze the whole fruit for the best freshness", "Make peach fruit vinegar, which keeps a long time", "Dry them into peach slices, which keep easily"],
    k: ["Dried peach preserves are a traditional craft", "When the peaches ripen, visitors come to the orchard to pick their own", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  "桃-春分-储存": {
    s: "The peaches around the spring equinox have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Make dried peach preserves to keep them", "Freeze the whole fruit for the best freshness", "Make peach fruit vinegar, which keeps a long time", "Dry them into peach slices, which keep easily"],
    k: ["Dried peach preserves are a traditional craft", "When the peaches ripen, visitors come to the orchard to pick their own", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  "c-peach-store": {
    s: "The peaches are ripe and there are more than you can eat. What is the traditional way?",
    o: ["Make dried peach preserves to keep them", "Freeze the whole fruit for the best freshness", "Make peach fruit vinegar, which keeps a long time", "Dry them into peach slices, which keep easily"],
    k: ["Dried peach preserves are a traditional craft", "When the peaches ripen, visitors come to the orchard to pick their own", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  "c-litchi-store": {
    s: "Lychees spoil easily. How are they traditionally handled?",
    o: ["Dry them in the sun into dried lychees", "Shell them, freeze them, and keep them for a year", "Candied lychees keep the longest", "Dry them out into lychee flesh in a kiln"],
    k: ["Drying lychees in the sun is a traditional craft", "Dried lychees keep a long time", "The fresh lychee season is short"]
  },
  "c-bayberry-store": {
    s: "Too many bayberries have come in and you want to keep them. What is the traditional way?",
    o: ["Soak them in wine, or dry them in the sun", "Candied bayberries in jars keep a long time", "Freeze them to lock in freshness for a whole year", "Make bayberry jam and keep it chilled"],
    k: ["Bayberries soaked in wine, or dried in the sun, are the traditional ways", "Bayberries in rock sugar syrup are also common", "The bayberry eating window is short"]
  },
  "杏-惊蛰-储存": {
    s: "The apricots around Jingzhe have been picked, and you want to keep them to eat slowly. How does the old way store them best?",
    o: ["Dry them into dried apricots, make apricot preserves, or boil apricot jam", "Pip, freeze them, and keep them for a year", "Make apricot fruit vinegar", "Candied, they keep a long time"],
    k: ["Dried apricots, apricot preserves and apricot jam are the traditional ways", "Apricot kernels are used in pastries", "Apricot skin water is an intangible heritage of Dunhuang"]
  },
  "c-apricot-store": {
    s: "The apricots will not all be eaten. What are the traditional ways of keeping them?",
    o: ["Dry them into dried apricots, make apricot preserves, or boil apricot jam", "Pip, freeze them, and keep them for a year", "Make apricot fruit vinegar", "Candied, they keep a long time"],
    k: ["Dried apricots, apricot preserves and apricot jam are the traditional ways", "Apricot kernels are used in pastries", "Apricot skin water is an intangible heritage of Dunhuang"]
  },
  "c-hawthorn-store": {
    s: "Too many hawthorns have come in and you want to keep them. What do you do?",
    o: ["Make hawthorn cakes, hawthorn slices, or hawthorn wine", "Freeze the whole fruit", "Candied hawthorns keep a long time", "Dry them into dried hawthorn"],
    k: ["Hawthorn cakes, hawthorn slices and hawthorn wine are the traditional ways", "Hawthorn aids digestion and is used in medicine", "The hawthorn keeps well"]
  },
  "c-persimmon-store": {
    s: "Too many persimmons have come in and you want to keep them. What is the traditional way?",
    o: ["Make dried persimmons — peel, hang to dry, and frost", "Freeze firm persimmons and keep them for a year", "Sprinkle with white spirit to ripen them for storage", "Vacuum-pack fresh persimmons to keep them long"],
    k: ["Dried persimmon goes through peeling, hanging to dry, and frosting", "The Qing dynasty already had the technique for moon-shaped dried persimmon", "Gongcheng moon persimmons account for 18.4% of national output"]
  },
  "c-jujube-store": {
    s: "The red jujubes have come in and you want to keep them to winter. What do you do?",
    o: ["Dry them in the sun into red jujube raisins", "Freeze fresh jujubes and keep them for a year", "Keep them in sealed wine-soaked jujubes", "Dry them in a kiln into jujube grains"],
    k: ["Drying red jujubes in the sun is the traditional method", "Dried red jujubes keep a long time", "Jujubes can be dried, used in medicine, and made into jujube cakes"]
  },
  "c-pear-store": {
    s: "Too many autumn pears have come in and you want to keep them. What is the traditional way?",
    o: ["Make pear paste or dried pear", "Bury them in sand in a cellar for the winter", "Freeze whole pears to keep them a long time", "Candied pear slices"],
    k: ["Pear paste and stewed pear to ease dryness are traditional", "Dried pear is a traditional craft", "The Dangshan su pear keeps well"]
  },
  "c-ougan-store": {
    s: "What is the most outstanding characteristic of the ougan?",
    o: ["It keeps well in store", "It keeps six months in the fridge", "Made into aged peel it keeps long", "Candied, it keeps"],
    k: ["The ougan stores well", "The ougan hangs on the tree through winter", "The ougan is eaten mainly fresh"]
  },
  "c-tangerine-store": {
    s: "You have bought sugar tangerines and want to keep them a few more days. How do you store them?",
    o: ["In a cool, airy place, avoiding pressure on the fruit", "In the fridge, which is best", "Hanging them in a mesh bag to air", "Sealed in a carton to keep them long"],
    k: ["The sugar tangerine skin is thin and delicate — avoid pressure on the fruit", "A cool, airy place lets them keep a little longer", "The sugar tangerine is eaten mainly fresh"]
  },
  "c-pomelo-store": {
    s: "Too many pomelos have come in and you want to use them up. What is the traditional way?",
    o: ["Make candied pomelo peel", "Store the whole fruit in a cellar", "Peel and freeze the segments", "Make it into jam"],
    k: ["Candied pomelo peel is a traditional craft", "The pomelo is eaten mainly fresh", "The pomelo keeps well"]
  },
  "c-kumquat-store": {
    s: "Too many kumquats have come in and you want to keep them. What do you do?",
    o: ["Make kumquats preserved in honey", "Freeze them whole", "Dry them into dried kumquat", "Candied, they keep a long time"],
    k: ["Kumquats preserved in honey are a traditional craft", "The kumquat tolerates cold and hangs on the tree", "Fresh kumquat is eaten with the skin on"]
  },
  "青梅-小满-食用": {
    s: "Xiaoman has arrived, and green plum is the fruit in season. What is the right way to eat it?",
    o: ["The fresh fruit is too sour and astringent to eat raw; it is usually pickled or cooked before eating", "Soak it in salt water for half an hour and it can be eaten as fruit", "Let it soften beside an apple and it will taste sweeter", "Blend it into juice, add sugar, and drink it straight away"],
    k: ["Fresh green plum is too sour and astringent to go straight into the mouth", "Its acidity is high, so those with sensitive stomachs should only taste a little", "The point is to taste the sourness as the flavour of the season"]
  },
  "青梅-惊蛰-食用": {
    s: "Jingzhe has arrived, and green plum is the fruit in season. What is the right way to eat it?",
    o: ["The fresh fruit is too sour and astringent to eat raw; it is usually pickled or cooked before eating", "Soak it in salt water for half an hour and it can be eaten as fruit", "Let it soften beside an apple and it will taste sweeter", "Blend it into juice, add sugar, and drink it straight away"],
    k: ["Fresh green plum is too sour and astringent to go straight into the mouth", "Its acidity is high, so those with sensitive stomachs should only taste a little", "The point is to taste the sourness as the flavour of the season"]
  },
  "c-plum-eat": {
    s: "Someone picked green plums and ate them straight off the tree, only to pull a face at the sourness. How should green plum be eaten?",
    o: ["The fresh fruit is too sour and astringent to eat raw; it is usually pickled or cooked before eating", "Soak it in salt water for half an hour and it can be eaten as fruit", "Let it soften beside an apple and it will taste sweeter", "Blend it into juice, add sugar, and drink it straight away"],
    k: ["Fresh green plum is too sour and astringent to go straight into the mouth", "Its acidity is high, so those with sensitive stomachs should only taste a little", "The point is to taste the sourness as the flavour of the season"]
  },
  "桑葚-小满-食用": {
    s: "Xiaoman has arrived, and mulberry is the fruit in season. What is the right way to eat it?",
    o: ["Mulberry is cooling in nature; a small handful at a time is enough", "Cooked, it is gentler and brings on no internal heat", "A glass of juice every day is the healthiest", "Mixed with yoghurt it boosts immunity"],
    k: ["Traditional food culture holds that mulberry is nourishing to yin", "Mulberry is cooling in nature, so those with sensitive stomachs should not eat too much", "In dried fruit and paste the sugar is more concentrated, so taste a little at a time"]
  },
  "c-mulberry-eat": {
    s: "A child has eaten a large plate of mulberries and wants more. How should the adult remind them?",
    o: ["Mulberry is cooling in nature; a small handful at a time is enough", "Cooked, it is gentler and brings on no internal heat", "A glass of juice every day is the healthiest", "Mixed with yoghurt it boosts immunity"],
    k: ["Traditional food culture holds that mulberry is nourishing to yin", "Mulberry is cooling in nature, so those with sensitive stomachs should not eat too much", "In dried fruit and paste the sugar is more concentrated, so taste a little at a time"]
  },
  "桑葚-谷雨-食用": {
    s: "Guyu has arrived, and mulberry is the fruit in season. What is the right way to eat it?",
    o: ["Mulberry is cooling in nature; a small handful at a time is enough", "Cooked, it is gentler and brings on no internal heat", "A glass of juice every day is the healthiest", "Mixed with yoghurt it boosts immunity"],
    k: ["Traditional food culture holds that mulberry is nourishing to yin", "Mulberry is cooling in nature, so those with sensitive stomachs should not eat too much", "In dried fruit and paste the sugar is more concentrated, so taste a little at a time"]
  },
  "c-cherry-eat": {
    s: "The cherries have come in. How best to eat them so as to bring out their \"earliness\"?",
    o: ["Taste them fresh, as the first bite of early summer", "Served cold with yoghurt, they are more refreshing", "Brewed into wine and kept until winter", "Made into jam and spread on bread"],
    k: ["The cherry is the most graceful gift of early summer", "In the Tang dynasty the court ate them with cream", "From the ancestral hall to the village household, this first branch is cherished"]
  },
  "樱桃-谷雨-食用": {
    s: "Guyu has arrived, and cherry is the fruit in season. What is the right way to eat it?",
    o: ["Taste them fresh, as the first bite of early summer", "Served cold with yoghurt, they are more refreshing", "Brewed into wine and kept until winter", "Made into jam and spread on bread"],
    k: ["The cherry is the most graceful gift of early summer", "In the Tang dynasty the court ate them with cream", "From the ancestral hall to the village household, this first branch is cherished"]
  },
  "枇杷-小寒-食用": {
    s: "Xiaohan has arrived, and loquat is the fruit in season. What is the right way to eat it?",
    o: ["Eat it fresh, or boil it down to a paste, or pickle it", "Stewed with rock sugar it is best for the lungs", "Steeped in honey water as a tea", "Made into jam to eat with meals"],
    k: ["The loquat is mainly eaten fresh", "Boiling loquat paste is a folk tradition", "Bencao Gangmu records the loquat as \"harmonising the stomach and settling qi, clearing heat and relieving summer heat\""]
  },
  "c-loquat-eat": {
    s: "A visitor has picked loquats and wants to learn how the old Chinese ate them. Which account has a basis?",
    o: ["Eat it fresh, or boil it down to a paste, or pickle it", "Stewed with rock sugar it is best for the lungs", "Steeped in honey water as a tea", "Made into jam to eat with meals"],
    k: ["The loquat is mainly eaten fresh", "Boiling loquat paste is a folk tradition", "Bencao Gangmu records the loquat as \"harmonising the stomach and settling qi, clearing heat and relieving summer heat\""]
  },
  "桃-惊蛰-食用": {
    s: "Jingzhe has arrived, and peach is the fruit in season. What is the right way to eat it?",
    o: ["Wash it and eat it fresh, or make dried peach preserves", "Peel it to remove the fuzz, which aids digestion", "Roast it to warm the stomach", "Candied peach slices as a snack"],
    k: ["The peach is a summer fruit in season", "Visitors come to the orchard to pick and eat it fresh", "In old times the custom of tasting the new fruit carried the folklore of peach and plum"]
  },
  "桃-春分-食用": {
    s: "The spring equinox has arrived, and peach is the fruit in season. What is the right way to eat it?",
    o: ["Wash it and eat it fresh, or make dried peach preserves", "Peel it to remove the fuzz, which aids digestion", "Roast it to warm the stomach", "Candied peach slices as a snack"],
    k: ["The peach is a summer fruit in season", "Visitors come to the orchard to pick and eat it fresh", "In old times the custom of tasting the new fruit carried the folklore of peach and plum"]
  },
  "c-peach-eat": {
    s: "Peaches just picked in the orchard — how best to eat them for the fullest country flavour?",
    o: ["Wash it and eat it fresh, or make dried peach preserves", "Peel it to remove the fuzz, which aids digestion", "Roast it to warm the stomach", "Candied peach slices as a snack"],
    k: ["The peach is a summer fruit in season", "Visitors come to the orchard to pick and eat it fresh", "In old times the custom of tasting the new fruit carried the folklore of peach and plum"]
  },
  "c-litchi-eat": {
    s: "The Lingnan saying goes \"one lychee, three fires\" — what is it warning about?",
    o: ["Lychee is warming in nature; eating a lot of it brings on internal heat", "Taken with light salt water, it clears the heat", "Chilled, it is the best way to clear heat", "Boiled into a sweet soup, it brings on no internal heat"],
    k: ["The Cantonese saying \"one lychee, three fires\"", "Lychee is warming in nature and constitutions differ widely, so take this as a general note only", "Dried lychee is a traditional way to eat it"]
  },
  "c-bayberry-eat": {
    s: "How best to eat fresh bayberries?",
    o: ["Wash them and eat them fresh, or soak them in wine, or dry them", "Soaked in lightly salted boiling water they taste sweeter", "Boiled into bayberry soup to beat the heat", "Made into fruit vinegar to drink"],
    k: ["The bayberry is mainly eaten fresh", "Bayberries soaked in wine, dried in the sun, or preserved in rock sugar syrup are the traditional ways", "Around the summer solstice is the bayberry’s best eating window"]
  },
  "杏-惊蛰-食用": {
    s: "Jingzhe has arrived, and apricot is the fruit in season. What is the right way to eat it?",
    o: ["Do not eat too many apricots", "Fully ripe apricots can stand in for a staple", "Eat apricot kernels as a snack every day", "Drink apricot skin water daily for health"],
    k: ["The old folk saying goes \"the peach nourishes people, the apricot harms them\"", "That is experience talking, not a scientific conclusion", "Dried apricots and apricot preserves are the traditional ways to eat them"]
  },
  "c-apricot-eat": {
    s: "The old say \"the peach nourishes people, the apricot harms them\" — what is that warning about?",
    o: ["Do not eat too many apricots", "Fully ripe apricots can stand in for a staple", "Eat apricot kernels as a snack every day", "Drink apricot skin water daily for health"],
    k: ["The old folk saying goes \"the peach nourishes people, the apricot harms them\"", "That is experience talking, not a scientific conclusion", "Dried apricots and apricot preserves are the traditional ways to eat them"]
  },
  "c-hawthorn-eat": {
    s: "Hawthorn is very sour. How is it better eaten?",
    o: ["Coated in sugar and made as candied haws on a stick, or made into cakes", "Pipped and boiled to drink as a sweet soup", "Chewed raw, it is the most appetising", "Candied hawthorn as a snack"],
    k: ["Hawthorn is sour; coating it in sugar as candied haws is the classic way", "Hawthorn cakes and hawthorn slices are sweet and sour", "Hawthorn aids digestion and is used in medicine"]
  },
  "c-persimmon-eat": {
    s: "You have just picked persimmons and want to eat them at once. What should you watch for?",
    o: ["Persimmons are only sweet after frost or after ripening off the tree", "Soaking them in warm water removes the astringency, and they can be eaten fresh", "Drying them soft makes them sweetest to eat", "Steaming them is sweeter and takes away the astringency"],
    k: ["After frost, the persimmon is sweeter than before", "The persimmon can be eaten fresh or made into dried persimmon cake", "Shuangjiang is the persimmon’s best eating window"]
  },
  "c-jujube-eat": {
    s: "How best to eat red jujubes for the fullest traditional flavour?",
    o: ["Eat them fresh, dry them, or make jujube cake", "Red jujube goes better with spring onion and garlic, and is more nourishing", "Eat a handful a day in place of meals", "The skins must be spat out, they are not eaten"],
    k: ["Jujubes can be eaten fresh, dried, used in medicine, and made into jujube cake", "Drying red jujubes in the sun is traditional", "The jujube is the fruit of the old jujube tree, a fruit in season"]
  },
  "c-pear-eat": {
    s: "In autumn when the throat is dry, how do the old use the pear?",
    o: ["Stew the pear to ease dryness, and boil it down to pear paste", "Juice the raw pear and drink a glass a day", "Bake the pear with rock sugar — the most soothing", "Dried pear as a snack"],
    k: ["Stewing the pear to ease dryness and boiling pear paste are traditional", "The pear can be eaten fresh", "The autumn pear is the fruit in season at the autumn equinox"]
  },
  "c-ougan-eat": {
    s: "How is the ougan eaten?",
    o: ["Eaten fresh", "Juiced and taken with honey", "Made into jam and spread on bread", "Stewed in soup to remove any fishiness"],
    k: ["The ougan is mainly eaten fresh", "The ougan stores well", "The ougan is a winter fresh fruit"]
  },
  "c-tangerine-eat": {
    s: "What is the best way to enjoy a sugar tangerine?",
    o: ["Peel it and eat it fresh — the skin is thin, sweet and melting", "Juice the whole fruit", "Can it as tangerines", "Roast it for a sweeter taste"],
    k: ["The sugar tangerine skin is thin and sandy, sweet and melting in the mouth", "Eating it fresh is the main way", "The sugar tangerine is an auspicious fruit of the New Year season"]
  },
  "c-pomelo-eat": {
    s: "How is the pomelo eaten?",
    o: ["Peel the segments and eat them fresh; the peel can be made into candied peel", "Eat the white pith too, for the sake of the throat", "Juice it and serve it over ice", "Stew it with meat to cut the grease"],
    k: ["The pomelo is eaten fresh, segment by segment", "The peel can be made into candied peel", "\"Pomelo\" sounds like \"bless\" in Chinese, so it is auspicious"]
  },
  "c-kumquat-eat": {
    s: "How best to eat a kumquat?",
    o: ["Eat it fresh with the skin on, or make it into candied fruit", "Peel it — it tastes sweeter that way", "Juice it and drink it warm", "Salt it to take away the sourness"],
    k: ["Fresh kumquat is eaten with the skin on", "Candied kumquat is a tradition", "The kumquat is the fruit in season in winter"]
  },
  "青梅-小满-礼节": {
    s: "A squall at Xiaoman has knocked a good many green plums to the ground. What does the old orchard do with the fallen fruit?",
    o: ["Gather them and dry them into smoked plums, wasting nothing", "Throw them away so they do not attract insects", "Bury them in the soil as fertiliser", "Feed them to the fish"],
    k: ["The fallen green fruit is not wasted — it is gathered and dried into smoked plum", "Smoked plum is the base of a sweet soup", "In the village, tending the trees is not thought a skill but simply part of making a living"]
  },
  "青梅-惊蛰-礼节": {
    s: "A spell of late spring cold at Jingzhe is about to ruin the flower buds. How do the mountain folk hold them?",
    o: ["Carry smoky fire basins out and keep them burning until dawn, the smoke covering the treetops", "Put plastic bags over the flower buds", "Water them to thaw them out", "Cut away the frozen branches"],
    k: ["When the late cold comes, the whole family carries smoky fire basins out and stays until dawn", "The smoke has to drift over the treetops for the buds to be saved", "Green plum is a tree that runs from spring into summer"]
  },
  "c-plum-courtesy": {
    s: "At Mangzhong the plum rains go on and on, the air in the green plum orchard is heavy with damp, and what worries the old grower most?",
    o: ["Draining the water in time to prevent fruit drop and disease", "More fertiliser to push the fruit", "Bagging the fruit", "Lighting smoky fires to drive off the damp"],
    k: ["At Mangzhong the plum rains are heavy, and green plum fears fruit drop and disease", "In a gale, brace the branches and mound soil around the roots", "Green plum ripens in late spring and early summer"]
  },
  "桑葚-小满-礼节": {
    s: "The mulberries at Xiaoman are nearly ripe. How does the old mulberry grove look after the soil?",
    o: ["Compost the fallen leaves and weeds with wood ash and farmyard manure, and turn it into the tree basins after the thaw", "Scatter chemical fertiliser every season", "Burn the fallen leaves to ash and scatter them away", "Shovel away all the weeds under the tree and sow vegetables"],
    k: ["Composting to feed the mulberry is old foundational work", "Fallen leaves and hoed weeds, with wood ash and farmyard manure, are composted at the corner of the field", "Turned into the tree basins after the thaw, the soil turns black and glossy"]
  },
  "c-mulberry-courtesy": {
    s: "At Lixia the mulberries are at their fullest. How should they be picked so the tree is not stripped?",
    o: ["Pick at the right moment, then tend the tree for next year", "Strip everything in one go, leaving nothing for seed", "Shake the tree and knock all the fruit down", "Cut the branches off with the fruit"],
    k: ["At Lixia the mulberries are at their fullest ripeness", "Caring for the tree after the pick sets up next year", "The old way makes organic fertiliser from fallen leaves and straw"]
  },
  "桑葚-谷雨-礼节": {
    s: "How do the mulberry trees in the old grove keep multiplying?",
    o: ["Fallen fruit sprouts on its own, so a seedling is dug up and taken home to plant", "Buy saplings and graft them", "Take cuttings", "Sow the walnut-sized seeds"],
    k: ["The mulberry is not delicate; fallen fruit sprouts by itself", "Whoever wants one digs up a seedling and plants it at home", "The orchard passes down generation by generation in this way"]
  },
  "c-cherry-custom": {
    s: "The cherries at Xiaoman are ready to pick, and rain makes them split. How do the mountain folk beat the weather?",
    o: ["Race to clear the drains after the rain so the fruit will not split", "Put plastic bags over the fruit", "More fertiliser to ripen them", "Light smoky fires"],
    k: ["After the rain they race to clear the drains, and only then will the fruit not split", "The cherry season is short, so pick while it is fresh", "The cherry is the first branch among the hundred fruits"]
  },
  "樱桃-谷雨-礼节": {
    s: "The cherries are flowering around Guyu. What does the hillside orchard fear most would ruin the blossoms?",
    o: ["A night of frost at flowering wiping out half the slope’s buds", "Sunburn in summer", "A typhoon in autumn", "Dry cold in winter"],
    k: ["The hillside cherry orchard fears frost and rain alike", "A single night of frost at flowering can wipe out every bud on half the slope", "In the village each household keeps watch on the weather, and when word comes of a cold snap they are up the hill before dawn"]
  },
  "枇杷-小寒-礼节": {
    s: "The loquat flowers in winter at Xiaohan, and the mountain folk fear the buds freezing. How do they hold them?",
    o: ["On a frost night, pile grass on the slope and smoke to shield the buds", "Bag the flower buds", "Water against the frost", "Cut away the old branches"],
    k: ["The loquat flowers in winter, and the mountain folk fear the buds freezing", "On a frost night they pile grass on the slope and light smoke", "In the story of the bare hills turning into fruit orchards, shielding the buds came first"]
  },
  "c-loquat-courtesy": {
    s: "The young loquat fruit at Xiaoman fears endless rain. How is it protected?",
    o: ["Before and after the rain the whole family goes up the slope to shake the trees and shed the water, and to thin out the split fruit", "Bag every fruit", "Light smoky fires", "Add more fertiliser"],
    k: ["Spring fruit fears rain; before and after the rain the family goes up to shake the water off", "Thin out the split fruit and leave the nutrition for the good ones", "Today the old trees on the slope are thicker than a bowl mouth"]
  },
  "桃-惊蛰-礼节": {
    s: "What does the peach orchard fear at night at Jingzhe, that the grower has to sit up for?",
    o: ["A late frost damaging the young fruit — in a cold snap, smoke the orchard through the night", "Hail in summer", "Continuous autumn rain", "Dry cold in winter"],
    k: ["In spring the peach tree fears above all a late frost damaging the young fruit", "In a cold snap the grower smokes the orchard through the night", "A peach tree must be thinned of flowers and fruit"]
  },
  "c-peach-courtesy": {
    s: "At the spring equinox the peach blossoms are open. Wind alone will not do — what else does the old grower do to raise fruit set?",
    o: ["Aid pollination to raise the fruit set", "Spray the flowers with hormone", "Strip all the blossoms", "Flood the roots with water"],
    k: ["At the spring equinox the peach blossoms, and a late frost can ruin them", "Aiding pollination raises the fruit set", "The peach tree flowers richly in spring and fruits in summer"]
  },
  "桃-夏至-礼节": {
    s: "At the summer solstice the peaches hang on the branch. What does the old grower worry most about in protecting the fruit?",
    o: ["Guard against sunburn and splitting in heavy rain, and summer-prune for air", "More fertiliser to make them bigger", "Three layers of bagging on every fruit", "Light smoky fires"],
    k: ["Peaches are afraid of sunburn and of splitting in heavy rain", "At the summer solstice the peach fruit is swelling and needs summer pruning for air", "A peach tree must be thinned of flowers and fruit"]
  },
  "c-litchi-courtesy": {
    s: "Continuous rain falls during the lychee flowering. What worries the grower most?",
    o: ["The stamens are soaked and fruit set fails, cutting the year’s yield", "Sunburn on the fruit in summer", "High heat in the young fruit stage", "A downpour before picking"],
    k: ["The lychee fears rain at flowering; continuous rain makes fruit set fail", "Every deep winter the branches are pruned and the diseased, weak wood removed", "The lychee bears well in some years and poorly in others"]
  },
  "c-bayberry-courtesy": {
    s: "Bayberries fall as soon as they ripen and rot easily after rain. How do the mountain folk beat the clock?",
    o: ["Pick in the cool of the early morning, lift them gently into shallow baskets and get them down the mountain the same day", "Pick at noon in the full sun", "Transport them the next day", "Shake the tree to knock the fruit down"],
    k: ["The bayberry is delicate — it falls as soon as it ripens and rots easily after rain", "The mountain folk pick in the cool of the early morning, lift the fruit gently into shallow baskets, and get it down the mountain the same day", "Leave it a day late and the fruit is past its best"]
  },
  "杏-惊蛰-礼节": {
    s: "The apricots are flowering at Jingzhe. What must the grower guard against at night?",
    o: ["A late frost damaging the flowers — protection through a cold snap", "High heat in summer", "Autumn downpours", "Low winter temperatures"],
    k: ["Early spring apricot blossoms are vulnerable to a late frost", "The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a geographical indication"]
  },
  "c-apricot-courtesy": {
    s: "At Mangzhong the apricots have turned yellow, and one spell of rain can split a whole tree. How is that guarded against?",
    o: ["Guard against splitting in continuous rain and against birds, and pick in good time", "An early frost", "Winter freeze damage", "Spring drought"],
    k: ["At Mangzhong the ripening apricots fear splitting in continuous rain", "The apricot is a summer-ripening fruit", "Dried apricots and apricot preserves are the traditional ways"]
  },
  "c-hawthorn-courtesy": {
    s: "The hawthorn ripens around Hanlu. What does it fear most that would hurt the fruit?",
    o: ["An early frost — get the harvest in before Shuangjiang", "Summer downpours", "Spring drought", "Winter freeze damage"],
    k: ["The hawthorn ripens around Hanlu and fears an early frost", "Candied haws on sticks are commonly made after Shuangjiang", "Xinglong in Hebei and Huixian in Henan are the producing areas"]
  },
  "c-persimmon-courtesy": {
    s: "Before the persimmons ripen, what must the grower guard against?",
    o: ["An early frost coming in to hurt the fruit — pick promptly after Shuangjiang", "Sunburn in summer", "Spring drought", "Winter freeze damage"],
    k: ["The persimmon is sweetened by frost, but an early frost hurts the fruit", "The persimmon ripens after Shuangjiang", "Dried persimmon goes through peeling, hanging to dry, and frosting"]
  },
  "c-jujube-courtesy": {
    s: "As the red jujubes near ripeness, what weather do they fear most for splitting the fruit?",
    o: ["Continuous rain, which splits the fruit — pick in good time", "Dry cold in winter", "Summer drought", "A late spring frost"],
    k: ["As they ripen, red jujubes fear splitting in continuous rain", "From pruning in the first month to picking in the ninth, a walk morning and evening", "There is no shortcut to growing jujubes; it is all down to care"]
  },
  "c-pear-courtesy": {
    s: "In the pear orchard in autumn, what does the grower fear most that would hurt the fruit?",
    o: ["An early frost — the old growers guard against it in advance", "Spring rain rotting the blossoms", "Summer storms breaking branches", "Winter snow bringing branches down"],
    k: ["The autumn pear fears an early frost, and old growers guard against it in advance", "The old way tends the pear tree with farmyard manure", "The pear tree flowers in spring and is harvested in autumn"]
  },
  "c-ougan-courtesy": {
    s: "The ougan hangs on the tree through winter. What does it fear most?",
    o: ["Freeze damage — though it tolerates cold, it still needs guarding", "High heat in summer", "Autumn drought", "A late spring frost"],
    k: ["The ougan hangs on the tree through winter and fears freeze damage", "The ougan tolerates cold but still needs guarding", "In former times the ougan was a prized winter fresh fruit"]
  },
  "c-tangerine-courtesy": {
    s: "Sugar tangerines hang on the tree through winter. How are they guarded against frost?",
    o: ["Whitewash the trunks and mound soil around the roots", "Bag the fruit", "Water against the frost", "Prune the branches"],
    k: ["Whitewashing the trunks and mounding soil around the roots prevents frost damage", "The sugar tangerine hangs on the tree through winter and fears freeze damage", "The sugar tangerine builds up its sugar by hanging on the tree through winter"]
  },
  "c-pomelo-courtesy": {
    s: "The pomelo ripens hanging on the tree. What weather does it fear most?",
    o: ["Frost — guard it in good time before it ripens", "Summer downpours", "Spring drought", "Winter freeze damage"],
    k: ["The pomelo fears frost as it ripens", "Pinghe Guanxi honey pomelo is a geographical indication", "The pomelo ripens around Mid-Autumn"]
  },
  "c-kumquat-courtesy": {
    s: "The kumquat hangs on the tree through winter. What does it fear most?",
    o: ["Freeze damage — though it is hardy, it still needs guarding", "Sunburn in summer", "A typhoon in autumn", "A late spring frost"],
    k: ["The kumquat hangs on the tree through winter and fears freeze damage", "The kumquat tolerates cold but still needs guarding", "Rongan kumquats have nearly 300 years of cultivation behind them"]
  },
  "青梅-小满-灾害": {
    s: "A squall at Xiaoman, and the young green plums are dropping straight to the ground.",
    o: ["Wind and rain knock the young fruit down and invite disease and insects", "An early frost", "Summer drought", "Winter freeze damage"],
    k: ["At Xiaoman the young fruit fears fruit drop in wind and rain", "The branches need to be braced", "Green plum is a tree that runs from spring into summer"]
  },
  "c-plum-disaster": {
    s: "In the plum orchard in early spring, what weather is feared most for the young fruit?",
    o: ["A spell of late spring cold, or a late frost", "Sunburn on the fruit in summer", "Fruit drop in continuous autumn rain", "Branches splitting in dry winter cold"],
    k: ["In early spring, late spring cold and a late frost hurt the young fruit", "In a gale, brace the branches and mound soil around the roots", "Green plum ripens in late spring"]
  },
  "青梅-芒种-灾害": {
    s: "At Mangzhong the plum rains go on and on, and the air in the green plum orchard is heavy with damp.",
    o: ["Continuous rain brings fruit drop, and the high humidity brings disease", "Sunburn on the fruit in summer", "Branches splitting in dry winter cold", "A late frost in early spring"],
    k: ["At Mangzhong the plum rains are heavy, and green plum fears fruit drop and disease", "In a gale, brace the branches and mound soil", "Green plum ripens in late spring and early summer"]
  },
  "桑葚-小满-灾害": {
    s: "The mulberries at Xiaoman are nearly ripe, and the weather is not cooperating.",
    o: ["Birds and continuous rain rot the fruit", "Summer drought", "Winter freeze damage", "A late frost in early spring"],
    k: ["Mulberries at Xiaoman are vulnerable to birds and to continuous rain", "Harvesting mulberry leaves to feed silkworms is the farm work of spring", "The mulberry eating window is short"]
  },
  "桑葚-立夏-灾害": {
    s: "The mulberries are ripening at Lixia, and rain ruins them.",
    o: ["Continuous rain rots the fruit", "A late frost in early spring", "Summer drought", "Winter freeze damage"],
    k: ["At Lixia the mulberries are at their fullest and fear continuous rain", "Mulberries must be picked in batches", "The old way makes organic fertiliser from fallen leaves and straw"]
  },
  "c-mulberry-disaster": {
    s: "As the mulberries near ripeness, what worries the grower most?",
    o: ["Birds pecking at the fruit", "Spring rain rotting the fruit", "Sunburn in summer", "Winter freeze damage"],
    k: ["As they near ripeness, mulberries are vulnerable to birds", "Harvesting mulberry leaves to feed silkworms is the most important farm work of spring", "The old way makes organic fertiliser from fallen leaves and straw"]
  },
  "樱桃-小满-灾害": {
    s: "The cherries at Xiaoman are ready to pick, and rain makes them split.",
    o: ["Continuous rain splits the fruit, and birds take their share", "An early frost", "Dry cold in winter", "Spring drought"],
    k: ["Cherries near ripeness at Xiaoman fear splitting in continuous rain", "The cherry season is short, so pick while it is fresh", "The cherry is the first branch among the hundred fruits"]
  },
  "c-cherry-disaster": {
    s: "The cherry ripens especially early. What weather does it fear most?",
    o: ["A spell of late spring cold that freezes the flowers", "Summer downpours knocking the fruit down", "A typhoon in autumn", "Dry cold in winter"],
    k: ["The cherry flowers first in spring and fears a late spring cold that freezes the blossoms", "The cherry is the first branch among the hundred fruits", "The cherry season is short, so pick while it is fresh"]
  },
  "c-loquat-disaster": {
    s: "The loquat flowers in autumn and winter. What does it fear most in winter?",
    o: ["A cold snap that freezes the flowers", "A late frost in spring", "Sunburn in summer", "Continuous rain in autumn"],
    k: ["The loquat flowers in autumn and winter and fears a cold snap that freezes the blossoms", "In winter the flower buds must be protected from the cold wind", "When the spring rains come, guard against young fruit rotting in the wet"]
  },
  "枇杷-小满-灾害": {
    s: "The young loquat fruit at Xiaoman fears endless rain.",
    o: ["Rain rots the young fruit", "An early frost", "Sunburn in summer", "Winter freeze damage"],
    k: ["The young loquat fruit at Xiaoman fears rotting in the rain", "The loquat flowers in autumn and winter and sets fruit in winter", "When the spring rains come, guard against young fruit rotting"]
  },
  "c-peach-disaster": {
    s: "In the peach orchard in spring, what must the grower guard against at night?",
    o: ["A late frost — smoke the orchard to keep off the frost", "Hail in summer", "Continuous rain in autumn", "Dry cold in winter"],
    k: ["In spring the peach tree fears above all a late frost damaging the young fruit", "In a cold snap the grower smokes the orchard through the night", "A peach tree must be thinned of flowers and fruit"]
  },
  "桃-春分-灾害": {
    s: "At the spring equinox the peach blossoms are gay, and they fear frost coming in the night.",
    o: ["A late frost damaging the flowers", "Hail in summer", "A typhoon in autumn", "Dry cold in winter"],
    k: ["At the spring equinox the peach blossoms fear a late frost", "The peach tree flowers richly in spring and fruits in summer", "In a cold snap the grower smokes the orchard through the night"]
  },
  "桃-夏至-灾害": {
    s: "The peaches have reached the summer solstice, and the grower is worrying about something.",
    o: ["A late frost — smoke the orchard to keep off the frost", "Hail in summer", "Continuous rain in autumn", "Dry cold in winter"],
    k: ["In spring the peach tree fears above all a late frost damaging the young fruit", "In a cold snap the grower smokes the orchard through the night", "A peach tree must be thinned of flowers and fruit"]
  },
  "c-litchi-disaster": {
    s: "What weather does the lychee fear most at flowering?",
    o: ["Continuous rain, which soaks the stamens and makes fruit set fail", "Strong wind at full flowering", "High heat in the young fruit stage", "A downpour before picking"],
    k: ["The lychee fears rain at flowering; continuous rain makes fruit set fail", "Every deep winter the branches are pruned and the diseased, weak wood removed", "The lychee bears well in some years and poorly in others"]
  },
  "c-bayberry-disaster": {
    s: "Bayberries in the plum rains fear what most?",
    o: ["Fruit drop in continuous rain", "Sunburn in summer", "Winter freeze damage", "A late frost in early spring"],
    k: ["Bayberry is at its peak around the summer solstice and fears fruit drop in continuous rain", "\"At Xiaoshu the bayberries begin to worm\"", "The bayberry eating window is short"]
  },
  "c-apricot-disaster": {
    s: "The apricot flowers in early spring. What worries the grower most?",
    o: ["A late frost damaging the flowers", "High heat in summer", "Autumn downpours", "Low winter temperatures"],
    k: ["Early spring apricot blossoms are vulnerable to a late frost", "The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a geographical indication"]
  },
  "杏-芒种-灾害": {
    s: "At Mangzhong the apricots have turned yellow, and one spell of rain can split a whole tree.",
    o: ["Continuous rain splits the fruit, and birds take their share", "An early frost", "Winter freeze damage", "Spring drought"],
    k: ["At Mangzhong the ripening apricots fear splitting in continuous rain", "The apricot is a summer-ripening fruit", "Dried apricots and apricot preserves are the traditional ways"]
  },
  "c-hawthorn-disaster": {
    s: "The hawthorn ripens around Hanlu. What does it fear most?",
    o: ["An early frost", "Summer downpours", "Spring drought", "Winter freeze damage"],
    k: ["The hawthorn ripens around Hanlu and fears an early frost", "Candied haws on sticks are commonly made after Shuangjiang", "Xinglong in Hebei and Huixian in Henan are the producing areas"]
  },
  "c-persimmon-disaster": {
    s: "Before the persimmons ripen, what must the grower guard against?",
    o: ["An early frost arriving ahead of time", "Sunburn in summer", "Spring drought", "Winter freeze damage"],
    k: ["The persimmon is sweetened by frost, but an early frost hurts the fruit", "The persimmon ripens after Shuangjiang", "Dried persimmon goes through peeling, hanging to dry, and frosting"]
  },
  "c-jujube-disaster": {
    s: "As the red jujubes near ripeness, what weather do they fear most?",
    o: ["Continuous rain, which splits the fruit", "Dry cold in winter", "Summer drought", "A late frost in early spring"],
    k: ["As they ripen, red jujubes fear splitting in continuous rain", "From pruning in the first month to picking in the ninth, a walk morning and evening", "There is no shortcut to growing jujubes; it is all down to care"]
  },
  "c-pear-disaster": {
    s: "In the pear orchard in autumn, what does the grower fear most?",
    o: ["An early frost", "Spring rain rotting the blossoms", "Summer storms breaking branches", "Winter snow bringing branches down"],
    k: ["The autumn pear fears an early frost, and old growers guard against it in advance", "The old way tends the pear tree with farmyard manure", "The pear tree flowers in spring and is harvested in autumn"]
  },
  "c-ougan-disaster": {
    s: "The ougan hangs on the tree through winter. What does it fear most?",
    o: ["Freeze damage", "High heat in summer", "Autumn drought", "A late frost in spring"],
    k: ["The ougan hangs on the tree through winter and fears freeze damage", "The ougan tolerates cold but still needs guarding", "In former times the ougan was a prized winter fresh fruit"]
  },
  "c-tangerine-disaster": {
    s: "Sugar tangerines hang on the tree through winter. What do they fear most?",
    o: ["Freeze damage", "Sunburn in summer", "A typhoon in autumn", "A late frost in spring"],
    k: ["The sugar tangerine hangs on the tree through winter and fears freeze damage", "Whitewashing the trunks and mounding soil around the roots prevents frost damage", "The sugar tangerine builds up its sugar by hanging on the tree through winter"]
  },
  "c-pomelo-disaster": {
    s: "The pomelo ripens hanging on the tree. What weather does it fear most?",
    o: ["Frost", "Summer downpours", "Spring drought", "Winter freeze damage"],
    k: ["The pomelo fears frost as it ripens", "Pinghe Guanxi honey pomelo is a geographical indication", "The pomelo ripens around Mid-Autumn"]
  },
  "c-kumquat-disaster": {
    s: "The kumquat hangs on the tree through winter. What does it fear most?",
    o: ["Freeze damage", "Sunburn in summer", "A typhoon in autumn", "A late frost in spring"],
    k: ["The kumquat hangs on the tree through winter and fears freeze damage", "The kumquat tolerates cold but still needs guarding", "Rongan kumquats have nearly 300 years of cultivation behind them"]
  }
};
