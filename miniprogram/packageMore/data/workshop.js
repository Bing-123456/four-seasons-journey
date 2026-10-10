'use strict';

// Source-backed cultural reading. These fragments are intentionally not a recipe.
const catalog = require('../../data/catalog');
const sources = catalog.sources.filter(source => ['S7', 'S8'].includes(source.id)).map(source => Object.assign({}, source, { date: source.publishedAt }));

const ingredients = [
  { id: 'watermelon', name: '西瓜', enName: 'Watermelon', detail: '瓜田里的夏天', enDetail: 'Summer in the melon fields', kind: 'melon' },
  { id: 'soybean', name: '黄豆', enName: 'Soybean', detail: '田间的一粒金黄', enDetail: 'A golden grain of the fields', kind: 'beans' },
  { id: 'rice', name: '稻米', enName: 'Rice', detail: '另一种田间收获', enDetail: 'Another harvest of the fields', kind: 'rice' },
  { id: 'apple', name: '苹果', enName: 'Apple', detail: '果园里的秋意', enDetail: 'Autumn mood of the orchard', kind: 'apple' }
];

const processes = [
  { id: 'boil', title: '煮豆', enTitle: 'Boiling', kicker: '从一粒豆开始', enKicker: 'It starts with a bean', text: '报道记下了煮豆这一环节。家常食材，要经过一道道处理，才成为记忆里的酱。', enText: 'The report records the boiling step. Everyday ingredients pass through many hands-on stages before becoming the sauce of memory.', note: '这里认识工序，不模拟真实火候。', enNote: 'Learn the steps here; real cooking heat is not simulated.', illustration: 'boil', sourceIds: ['S8'] },
  { id: 'coat', title: '裹面', enTitle: 'Coating', kicker: '细节也是手艺', enKicker: 'Detail is craft too', text: '裹面是报道列举的另一道工序。它提示我们：这门手艺包含鲜果与黄豆之外的处理步骤。', enText: 'Coating with flour is another step listed in the report — a reminder that the craft goes beyond fresh fruit and soybean.', note: '原料认识题不等于完整配方。', enNote: 'Recognizing ingredients is not a full recipe.', illustration: 'coat', sourceIds: ['S8'] },
  { id: 'rest', title: '捂豆', enTitle: 'Resting', kicker: '给变化留些时间', enKicker: 'Give change some time', text: '报道在裹面之后提到捂豆。工序名称背后，是需要传授和学习的制作经验。', enText: 'The report mentions resting after coating. Behind each step name lies know-how that must be taught and learned.', note: '不推算捂豆时间或制作条件。', enNote: 'Resting time and conditions are not estimated.', illustration: 'rest', sourceIds: ['S8'] },
  { id: 'sun', title: '晒酱', enTitle: 'Sun-drying', kicker: '把夏日留在瓦盆里', enKicker: 'Summer kept in a clay pot', text: '采访记录了瓦盆晒酱的场景，也介绍了自然晾晒发酵的做法。阳光与器具，进入了这份乡味。', enText: 'Interviews record clay pots sun-drying in the open, with natural fermentation. Sunshine and vessels both enter this hometown flavor.', note: '四个片段只是报道中列举的部分工序。', enNote: 'These four clips are only some of the steps listed in the report.', illustration: 'sun', sourceIds: ['S8'] }
];

const question = {
  title: '这一盆酱，为什么值得了解？', enTitle: 'Why is this jar of sauce worth knowing?',
  options: [
    { id: 'instant', text: '把西瓜和黄豆混合，就能马上做成', enText: 'Mixing watermelon and soybean makes it ready to eat at once' },
    { id: 'craft', text: '它把当地食材、多道工序和家乡记忆连在一起', enText: 'It ties local ingredients, many steps and hometown memory together' },
    { id: 'forecast', text: '了解这门手艺，就能预测今年西瓜的销量', enText: 'Knowing the craft would predict this year\'s watermelon sales' }
  ],
  correctId: 'craft', sourceIds: ['S7', 'S8']
};

module.exports = {
  id: 'guadoujiang', placeId: 'summer-kitchen',
  title: '一盆瓜豆酱', enTitle: 'A Jar of Melon-bean Sauce',
  subtitle: '西瓜的另一种乡味', enSubtitle: 'Another hometown taste of watermelon',
  location: '河南 · 中牟 · 青谷堆村', enLocation: 'Qingudui Village · Zhongmu · Henan',
  intro: '西瓜不只是一口清甜。在中牟青谷堆村，它也走进一份代代相传的家乡味。',
  enIntro: 'Watermelon is more than a sweet bite. In Qingudui Village, Zhongmu, it also becomes a hometown flavor passed down through generations.',
  ingredientSourceIds: ['S8'], introSourceIds: ['S7', 'S8'],
  ingredientAnswer: ['watermelon', 'soybean'], ingredients, processes, question, sources
};
