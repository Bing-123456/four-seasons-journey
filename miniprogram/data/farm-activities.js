'use strict';

// 农事活动预告：四季采摘与手作活动，供「发现」页自动轮播。
// 此库仅为内容灵感示例，无主办方确认，不开放预约。
// 真实活动由果农通过预约服务发布，预约按活动 ID 和日期隔离。
const ACTIVITIES = [
  { id: 'act-spring-plum', season: 'spring', seasonLabel: '春', title: '青梅采摘・青梅酒封坛', note: '跟着果农摘青梅，亲手封一坛青梅酒，把春天的酸涩酿成甜。', open: '3 月 25 日起' },
  { id: 'act-spring-loquat', season: 'spring', seasonLabel: '春', title: '枇杷采摘・枇杷膏熬制', note: '树上现摘的枇杷，学熬一罐润喉的枇杷膏，清甜养人。', open: '4 月 10 日起' },
  { id: 'act-spring-mulberry', season: 'spring', seasonLabel: '春', title: '桑葚采摘・果酱手作', note: '钻桑葚园现摘现吃，摘完做一罐桑葚果酱，甜到指尖发紫。', open: '4 月 20 日起' },
  { id: 'act-summer-watermelon', season: 'summer', seasonLabel: '夏', title: '西瓜消夏节', note: '西瓜园开园现摘现吃，晚上还有瓜田民俗晚会和西瓜雕刻。', open: '6 月 1 日起' },
  { id: 'act-summer-plum', season: 'summer', seasonLabel: '夏', title: '李子采摘・李子干制作', note: '现摘脆李，跟着果农学晒李子干，把夏日的酸甜存下来。', open: '6 月 15 日起' },
  { id: 'act-summer-peach', season: 'summer', seasonLabel: '夏', title: '蜜桃采摘・桃胶手作', note: '树上现摘蜜桃，配果农手把手教的桃胶熬煮，吃桃又养生。', open: '6 月 25 日起' },
  { id: 'act-autumn-persimmon', season: 'autumn', seasonLabel: '秋', title: '柿子采摘・柿饼制作', note: '摘挂霜的柿子，学做传统柿饼，感受“霜降吃柿”的老讲究。', open: '9 月 15 日起' },
  { id: 'act-autumn-pomegranate', season: 'autumn', seasonLabel: '秋', title: '石榴采摘・石榴汁手作', note: '裂开的石榴现摘现榨，一杯红宝石般的石榴汁，甜上心头。', open: '9 月 25 日起' },
  { id: 'act-autumn-pear', season: 'autumn', seasonLabel: '秋', title: '秋梨采摘・秋梨膏熬制', note: '现摘秋梨，学熬一罐润肺秋梨膏，秋燥不愁。', open: '10 月 5 日起' },
  { id: 'act-winter-jujube', season: 'winter', seasonLabel: '冬', title: '冬枣采摘・脆甜尝鲜', note: '树上现摘的冬枣，一口一个嘎嘣脆，冬日里的清甜。', open: '11 月 25 日起' },
  { id: 'act-winter-ougan', season: 'winter', seasonLabel: '冬', title: '瓯柑采摘・瓯柑酿制', note: '现摘瓯柑，学做传统瓯柑酿，把苦后回甘藏进坛里。', open: '12 月 5 日起' },
  { id: 'act-winter-tangerine', season: 'winter', seasonLabel: '冬', title: '砂糖橘采摘・暖冬甜橘', note: '树上熟的砂糖橘，剥开就是满屋甜香，摘一篮甜过冬。', open: '12 月 20 日起' }
];

// 当前季节的活动（按月份归属季节，与四时页的季节划分一致）。
function forSeason(seasonId) {
  return ACTIVITIES.filter(item => item.season === seasonId);
}

ACTIVITIES.forEach(item => { item.bookable = false; item.sample = true; });
module.exports = { ACTIVITIES, forSeason };
