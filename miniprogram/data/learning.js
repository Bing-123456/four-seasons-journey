'use strict';

// Lessons appear only beside related stories, never as a generic exhibit on every page.
const sauce = {
  id: 'guadoujiang', url: '/packageMore/workshop/index?id=guadoujiang',
  kicker: '一分钟，认识一门地方手艺', title: '西瓜的另一种乡味',
  description: '从西瓜与黄豆开始，走进中牟青谷堆村的瓜豆酱故事。',
  label: '认识原料 · 探索工序 · 带走故事', symbol: '酱',
  action: '动手读一读', sourceIds: ['S7', 'S8'], placeId: 'summer-kitchen'
};
const grain = {
  id: 'grain-mill', url: '/packageMore/heritage/index?id=grain-mill',
  kicker: '延伸阅读 · 河南农耕小课堂', title: '一粒谷物，怎样入口？',
  description: '走近新郑裴李岗的磨盘与磨棒，观察来回滚碾的动作。',
  label: '观察结构 · 试试动作 · 理解原理', symbol: '谷',
  action: '走近这件农具', sourceIds: ['S9'], placeId: 'summer-culture'
};
function forPlace(placeId) {
  if (placeId === 'summer-kitchen' || placeId === 'summer-field') return sauce;
  if (placeId === 'summer-culture') return grain;
  return null;
}
module.exports = { sauce: sauce, grain: grain, forPlace: forPlace };
