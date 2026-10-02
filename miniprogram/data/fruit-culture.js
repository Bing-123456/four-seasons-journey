'use strict';

// 核心与外围仅按产品方案的季节名单排布，不作为植物起源的科学结论。
const WORLD = require('./world-fruit-culture');
const CATEGORIES = [{"id":"folk","label":"民俗仪式与节气食俗"},{"id":"history","label":"历史源流"},{"id":"craft","label":"传统手工技艺"},{"id":"story","label":"乡土故事"},{"id":"tools","label":"传统农具与种植"},{"id":"health","label":"时令食养文化"}];
const seasons = [{"id":"spring","name":"春序撷芳","months":[2,3,4],"crop":"青梅 · 桑葚 · 樱桃","fruits":[{"id":"plum","name":"青梅"},{"id":"mulberry","name":"桑葚"},{"id":"cherry","name":"樱桃"}],"moreFruits":[{"id":"loquat","name":"枇杷"},{"id":"banana","name":"香蕉"},{"id":"mango","name":"芒果"},{"id":"strawberry-w","name":"草莓"},{"id":"sugarcane-sp","name":"甘蔗"}]},{"id":"summer","name":"炎夏撷实","months":[5,6,7,8],"crop":"西瓜 · 桃子 · 李子","fruits":[{"id":"watermelon","name":"西瓜"},{"id":"peach","name":"桃子"},{"id":"plum-fruit","name":"李子"}],"moreFruits":[{"id":"pineapple","name":"菠萝"},{"id":"lychee","name":"荔枝"},{"id":"longan","name":"龙眼"},{"id":"wampee","name":"黄皮"},{"id":"hami-melon","name":"哈密瓜"},{"id":"grape-w","name":"葡萄"},{"id":"coconut","name":"椰子"},{"id":"dragon-fruit","name":"火龙果"},{"id":"passion-fruit","name":"百香果"},{"id":"apricot-w","name":"杏"},{"id":"lemon","name":"柠檬"},{"id":"bayberry","name":"杨梅"},{"id":"mangosteen","name":"山竹"}]},{"id":"autumn","name":"霜天凝果","months":[9,10,11],"crop":"秋梨 · 柿子 · 枣 · 猕猴桃 · 山楂","fruits":[{"id":"persimmon","name":"柿子"},{"id":"pomegranate","name":"石榴"},{"id":"pear","name":"秋梨"},{"id":"apple","name":"苹果"},{"id":"jujube","name":"枣"}],"moreFruits":[{"id":"kiwi-w","name":"猕猴桃"},{"id":"grape-a","name":"葡萄"},{"id":"pomelo","name":"柚子"},{"id":"hawthorn","name":"山楂"},{"id":"winter-jujube-w","name":"冬枣"},{"id":"fig","name":"无花果"},{"id":"orange-w","name":"脐橙"},{"id":"sugarcan-a","name":"甘蔗"}]},{"id":"winter","name":"寒岁藏珍","months":[12,1,2],"crop":"砂糖橘 · 瓯柑 · 冬枣","fruits":[{"id":"tangerine","name":"砂糖橘"},{"id":"mandarin","name":"瓯柑"},{"id":"winter-jujube","name":"冬枣"}],"moreFruits":[{"id":"navel-orange","name":"脐橙"},{"id":"pomelo-w","name":"柚子"},{"id":"sugarcane","name":"甘蔗"},{"id":"kumquat","name":"金桔"},{"id":"starfruit","name":"杨桃"},{"id":"papaya","name":"木瓜"},{"id":"carambola-w","name":"释迦"},{"id":"dates-w","name":"椰枣"}]}].map(season => Object.assign({}, season, {
  fruits: season.fruits.map(fruit => Object.assign({}, fruit, { categories: WORLD[fruit.name] })),
  moreFruits: season.moreFruits.map(worldFruit)
}));

// 外圈水果：与内圈同结构，只是排布在链图外环；内容取自世界风物库。
function worldFruit(fruit) {
  return Object.assign({}, fruit, { world: true, categories: WORLD[fruit.name] || [] });
}

// 中国本土水果（链图内圈、可点开，按团队定稿名单）；未列出的排外圈灰色。
const NATIVE_NAMES = {
  spring: ['青梅', '桑葚', '樱桃', '枇杷'],
  summer: ['桃子', '李子', '杏', '荔枝', '龙眼', '黄皮', '杨梅'],
  autumn: ['秋梨', '柿子', '枣', '猕猴桃', '山楂'],
  winter: ['砂糖橘', '瓯柑', '柚子', '金桔']
};

// 一季的全部水果：本土（内圈可点开）在前，世界水果（外圈灰色）在后。
function seasonFruits(season) {
  const names = NATIVE_NAMES[season.id] || [];
  const native = [];
  const world = [];
  for (const fruit of season.fruits) {
    const core = names.includes(fruit.name);
    (core ? native : world).push(Object.assign({}, fruit, { world: !core }));
  }
  for (const fruit of (season.moreFruits || [])) {
    const wrapped = worldFruit(fruit);
    if (names.includes(fruit.name)) native.push(Object.assign(wrapped, { world: false }));
    else world.push(wrapped);
  }
  return native.concat(world);
}

function fruitsForSeason(seasonId) {
  const season = seasons.find(item => item.id === seasonId) || seasons[0];
  return seasonFruits(season).map(fruit => Object.assign({}, fruit, {
    fullId: season.id + '-' + fruit.id,
    seasonId: season.id, seasonName: season.name,
    categoryLabels: CATEGORIES.map(category => ({ id: category.id, label: category.label }))
  }));
}

function findFruit(fullId) {
  for (const season of seasons) {
    for (const fruit of seasonFruits(season)) {
      if (season.id + '-' + fruit.id === fullId) {
        return Object.assign({}, fruit, { fullId, seasonId: season.id, seasonName: season.name, seasonMonths: season.months });
      }
    }
  }
  return null;
}

// 按水果名查找（果灵搜索/识果跳转用），返回 {season, fruit}。
function findFruitByName(name) {
  for (const season of seasons) {
    for (const fruit of seasonFruits(season)) {
      if (fruit.name === name || fruit.name === name.replace(/子$/, '')) {
        return { seasonId: season.id, seasonName: season.name, fullId: season.id + '-' + fruit.id, fruit };
      }
    }
  }
  return null;
}

// 所有可点开的水果清单（名称+所属季节），供果灵搜索识别。
function knownFruitNames() {
  const names = [];
  seasons.forEach(season => seasonFruits(season).forEach(fruit => names.push(fruit.name)));
  return names;
}

module.exports = { CATEGORIES, seasons, seasonFruits, fruitsForSeason, findFruit, findFruitByName, knownFruitNames, NATIVE_NAMES };
