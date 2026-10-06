// 农事转盘 · 英文对照 · 农事维度（25 题）
// 术语处理：节气保留拼音首字母大写（Lixia、Xiaoman）；管理术语用国际通用表达
//（疏果=thinning、坐果=set fruit、日灼=sunburn、倒春寒=late spring frost）。
module.exports = {
  '青梅-小满-农事': {
    s: 'At Xiaoman the young green plums swell day by day, and the growers are busy easing the load on the trees.',
    o: ['Thin out the weak fruit and keep the canopy airy and well lit', 'Spray the trees with a fruit-set hormone to steady the crop', 'Pick early to catch the first prices of the season', 'Light smoky fires in the orchard to keep the wind off'],
    k: ['At Xiaoman the young plums are swelling and need thinning to ease the load', 'Removing the weak fruit lets the ones that stay grow larger', 'Green plum ripens gradually from late spring into early summer']
  },
  '青梅-惊蛰-农事': {
    s: 'With Jingzhe here the green plum flower buds are opening, and a cold spell in the night is what the growers fear most.',
    o: ['Guard the blossoms against a late frost, smoking or covering them if needed', 'Water the trees during flowering to push fruit set', 'Carry out the summer pruning now, months ahead of time', 'Apply base fertiliser in autumn'],
    k: ["At Jingzhe the green plum blossoms, and a late frost is what ruins the flowers", "In a cold snap the growers smoke the orchard through the night to keep off the frost", "Green plum is a tree that runs from spring into summer"]
  },
  'c-plum-farm': {
    s: 'In the plum grove at the end of spring the young fruit has only just set, and a strong wind can knock it down. The growers are worried about the young fruit being blown off.',
    o: ['Brace the branches and mound soil around the roots to anchor the trees', 'Spray the trees with a fruit-set hormone to steady the crop', 'Thin out half the young fruit early to protect the yield', 'Light smoky fires in the orchard to keep the wind off'],
    k: ["Green plum ripens in late spring, and strong winds easily blow the young fruit down", "When a gale comes, brace the branches and mound soil around the roots", "These growers have kept the old ways for generations — pickled plum, green plum wine"]
  },
  '桑葚-小满-农事': {
    s: 'At Xiaoman the mulberries turn from red to purple, and the growers fear the birds coming to peck.',
    o: ['Guard against birds and pick in batches at the right moment', 'Light smoky fires to scare off the birds', 'Cover the trees with film to keep them warm', 'Thin the flowers at flowering'],
    k: ["Mulberries ripen at Xiaoman and are vulnerable to birds", "Picking mulberry leaves to feed silkworms is the great farm work of spring", "Mulberries must be picked in batches"]
  },
  '桑葚-立夏-农事': {
    s: 'At Lixia the branches are heavy with purple-black mulberries, and they must come off at peak ripeness.',
    o: ['Pick at the right moment and tend the tree afterwards', 'Lay film over the soil back in early spring', 'Spray foliar feed at flowering', 'Prune hard in winter'],
    k: ["At Lixia the mulberries are at their fullest ripeness", "Caring for the tree after the pick sets up next year", "The old way makes organic fertiliser from fallen leaves and straw"]
  },
  'c-mulberry-farm': {
    s: 'The mulberries in the grove are nearly ripe, and the grower wants to look after the mulberry trees. Which practice fits the old ways better?',
    o: ['Use organic fertiliser fermented from fallen leaves and straw', 'Spray foliar feed to push leaf growth', 'Spread wood ash over the roots to keep them warm', 'Cut away the old wood and keep only the new shoots'],
    k: ["Harvesting mulberry leaves to feed silkworms is the most important farm work of spring", "The old way tends the mulberry tree with organic fertiliser fermented from fallen leaves and straw", "Boiling mulberry paste and drying mulberries is the old craft that keeps this season going"]
  },
  '樱桃-小满-农事': {
    s: 'At Xiaoman the cherries have turned red, and the growers fear above all the birds and the rain that cracks the fruit.',
    o: ['Guard against birds and against splitting fruit', 'Protect the blossoms from frost at flowering', 'Apply base fertiliser in autumn', 'Prune hard in summer'],
    k: ["Cherries near ripeness at Xiaoman are vulnerable to birds and to splitting", "The cherry season is short, so pick at peak ripeness", "The cherry is the first branch among the hundred fruits"]
  },
  'c-cherry-farm': {
    s: 'The cherry is called the "first branch among the hundred fruits" and ripens especially early. What should the grower watch in spring?',
    o: ['Cherry blossoms first in spring and the fruit ripens first in summer, so guard against a late spring frost', 'Spray an anti-frost solution at flowering to protect flowers and fruit', 'Lay mulch over the ground in early spring to raise soil temperature', 'Thin the early flowers and keep the late ones to steady the crop'],
    k: ["The cherry takes its Chinese name \"hantao\" from the orioles that carried it away to eat", "The cherry is the first to flower in spring and the first to ripen in summer", "In ancient times the first cherries of the season were offered at the ancestral hall before anything else"]
  },
  '枇杷-小寒-农事': {
    s: 'In Xiaohan the weather is cold, yet the loquat is flowering and setting small fruit.',
    o: ['Guard the flowers against the cold and protect the young fruit', 'Thin the flowers now', 'Water the trees at flowering', 'Bag the fruit'],
    k: ["The loquat flowers in autumn and winter and sets fruit in winter", "At Xiaohan the flower buds need protecting from the cold wind", "The loquat carries its fruit across the winter"]
  },
  'c-loquat-farm': {
    s: 'The loquat flowers in autumn and winter and fruits in spring, so its care cycle is long. What does the orchard most need guarding against in winter?',
    o: ['Guard the flower buds against frost and cold wind', 'Thin the flowers in early spring to improve fruit set', 'Water at flowering to prevent drought', 'Bag the fruit to keep insects off'],
    k: ["The loquat flowers in autumn and winter, fruits in spring, and carries the fruit across the winter", "In winter the flower buds must be protected from the cold wind", "When the spring rains come, guard against young fruit rotting in the wet"]
  },
  'c-peach-farm': {
    s: 'In the peach orchard in spring the blossoms are at their fullest, and what worries the grower most is what?',
    o: ['A late frost damaging the young fruit', 'Shaking the tree to shed rain during flowering', 'Summer pruning to check excessive growth', 'Base fertiliser in autumn'],
    k: ["The peach tree flowers richly in spring and fruits in summer", "In spring the fear is a late frost damaging the young fruit; in a cold snap growers smoke the orchard through the night", "Old practice holds that a peach tree must be thinned of both flowers and fruit"]
  },
  '桃-春分-农事': {
    s: 'At the equinox the peach orchard is a wash of pink and white, and the growers watch the sky, afraid of cold.',
    o: ['Guard the blossoms against a late frost and help with pollination', 'Thin the fruit now — far too early', 'Carry out the summer pruning now', 'Prune after picking'],
    k: ["At the spring equinox the peach blossoms, and a late frost can ruin them", "The peach tree flowers richly in spring and fruits in summer", "The old way holds that a peach tree must be thinned of flowers and fruit"]
  },
  '桃-夏至-农事': {
    s: 'At the summer solstice the peaches are setting, and the dense branches need air.',
    o: ['Summer pruning, guarding against sunburn and split fruit', 'The hard winter pruning, done now', 'Frost protection at flowering', 'Thinning the flowers'],
    k: ["At the summer solstice the peach fruit is swelling and needs summer pruning for air", "Peaches are afraid of sunburn and of splitting in heavy rain", "A peach tree must be thinned of flowers and fruit for the fruit to grow large"]
  },
  'c-litchi-farm': {
    s: 'What weather does the lychee fear most at flowering?',
    o: ['Continuous rain, which soaks the stamens and makes fruit set fail', 'Hand pollination at full flowering', 'Thinning the young fruit to keep the fruit large', 'Pruning after picking to restore the tree'],
    k: ["The lychee fears rain at flowering; continuous rain makes fruit set fail", "Every deep winter the branches are pruned and the diseased, weak wood removed", "The lychee bears well in some years and poorly in others, and breeding new varieties addresses the shortfalls"]
  },
  'c-bayberry-farm': {
    s: 'Bayberry is at its peak around the summer solstice. What characterises its best eating window?',
    o: ['The window is short, and around the summer solstice is best', 'Polytunnel growing to delay the harvest into autumn', 'Cold storage to keep it through the whole summer', 'Picking in batches to stretch the season'],
    k: ["The bayberry’s best eating window is short, and around the summer solstice is best", "\"Bayberries redden the hills at the summer solstice; at Xiaoshu the fruit begins to worm\"", "Whether the fruit worms varies with how the trees are managed"]
  },
  '杏-惊蛰-农事': {
    s: 'At Jingzhe the apricot blossoms have only just opened, and a single cold spell can ruin them.',
    o: ['Guard the blossoms against a late frost', 'Sunburn in summer', 'Continuous autumn rain', 'Low winter temperatures'],
    k: ["Early spring apricot blossoms are vulnerable to a late frost", "The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a national geographical indication"]
  },
  'c-apricot-farm': {
    s: 'The apricots are ripe. What should the grower do at once?',
    o: ['Pick them promptly while they are ripe', 'Leave them hanging to get sweeter before picking', 'Withhold water before picking to raise the sugar', 'Pick early in batches to dodge the rain'],
    k: ["The apricot is a summer-ripening fruit", "The Dunhuang Ligong apricot is a national geographical indication", "Dried apricots, apricot preserves and apricot jam are the traditional ways"]
  },
  'c-hawthorn-farm': {
    s: 'When does the hawthorn ripen, and when does one make candied haws on a stick?',
    o: ['It ripens around Hanlu, and candied haws are commonly made after Shuangjiang', 'Start at Liqiu — the earliest', 'Pick at Lidong, when they are sweetest', 'Pick before Shuangjiang, when the sourness suits candied haws'],
    k: ["The hawthorn ripens around Hanlu", "Candied haws on sticks are commonly made after Shuangjiang", "Xinglong in Hebei, Huixian in Henan and Zezhou in Shanxi are the producing areas"]
  },
  'c-persimmon-farm': {
    s: 'When is the best time to pick the persimmon?',
    o: ['It ripens after Shuangjiang, and the frost makes it sweeter', 'Dry it for a few days after picking so the astringency goes', 'Pick early while firm so it travels well', 'Soak it in warm water to ripen and sweeten it'],
    k: ["The persimmon ripens after Shuangjiang, and frost makes it sweeter", "Dried persimmon goes through peeling, hanging to dry, and frosting", "The old saying goes, \"a persimmon grove never comes true\""]
  },
  'c-jujube-farm': {
    s: 'From the first month to the ninth, what does the jujube grower do every day?',
    o: ['Walk the orchard morning and evening', 'Tend the trees only in a concentrated spell at flowering', 'Only go in to drain the orchard during the rains', 'Hire someone else to manage it'],
    k: ["From pruning in the first month to picking in the ninth, a walk morning and evening, every day", "No herbicide, no hormone, everything picked by hand", "There is no shortcut to growing jujubes; it is all down to care"]
  },
  'c-pear-farm': {
    s: 'In the pear orchard in autumn, what weather do the growers fear most?',
    o: ['An early frost', 'A late frost at flowering', 'Hail during the young fruit stage', 'Birds before picking'],
    k: ["The autumn pear fears an early frost, and old growers guard against it in advance", "The old way tends the pear tree with farmyard manure", "The pear flowers in spring and is harvested in autumn"]
  },
  'c-ougan-farm': {
    s: 'How is the ougan managed through winter?',
    o: ['Left hanging on the tree through winter, and it tolerates the cold', 'Stored in a cellar after picking', 'Covered with film against frost to protect the fruit', 'Picked early and put into store'],
    k: ["The ougan is an old native citrus of Zhejiang, and it hangs on the tree through winter", "The ougan tolerates cold and ripens in late winter", "In former times the ougan was a prized fresh fruit for the winter months"]
  },
  'c-tangerine-farm': {
    s: 'How do sugar tangerines see the winter?',
    o: ['They hang on the tree through winter, slowly building up sugar', 'Picked and put into cold store', 'Covered with film to keep warm and ripen', 'Picked early and stored to build up the sugar'],
    k: ["The sugar tangerine hangs on the tree through winter, slowly accumulating sugar", "Its skin is thin and sandy, sweet and melting in the mouth", "The Wuzhou sugar tangerine has 400 years of history behind it"]
  },
  'c-pomelo-farm': {
    s: 'When does the pomelo ripen?',
    o: ['It ripens and goes to market around Mid-Autumn', 'It ripens around the Dragon Boat Festival', 'It ripens around the Double Ninth Festival', 'It ripens around the Lantern Festival'],
    k: ["The pomelo ripens around Mid-Autumn", "Pinghe Guanxi honey pomelo and Xianyou Duwei wendan pomelo are geographical indications", "\"Pomelo\" sounds like \"bless\" in Chinese, so it carries auspicious meaning"]
  },
  'c-kumquat-farm': {
    s: 'When does the kumquat ripen?',
    o: ['It ripens at Xiaoxue, and hangs on the tree through winter', 'It is picked at Lidong and put into store', 'It is ripened under film', 'It only ripens at the start of spring'],
    k: ["The kumquat is small and golden, and ripens at Xiaoxue", "The kumquat tolerates cold and hangs on the tree through winter", "Rongan kumquats have nearly 300 years of cultivation behind them"]
  }
};
