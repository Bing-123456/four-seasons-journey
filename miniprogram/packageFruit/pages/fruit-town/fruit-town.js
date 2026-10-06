'use strict';
// 果乡详情页（P13 行程 / 果农工作台重构）。
// 设计文档 2.3：返回、果园图、果乡故事、当季水果文化（AI 失败回退知识库静态片段）、
// 可体验标签、导航前往（wx.openLocation）。
const farmtown = require('../../../lib/farmtown-service');
const WORLD = require('../../../data/world-fruit-culture');
const i18n = require('../../../lib/i18n');

// 水果 → 默认插画（assets/fruit-art/）。文档要求「没有实拍图时显示该水果的默认插画」。
// 苹果/猕猴桃/石榴已替换为用户生成的国风 AI 插画。
const ART_MAP = {
  '苹果': 'guofeng-apple.jpg', '樱桃': 'spring-cherry.jpg', '杨梅': 'summer-bayberry.jpg',
  '荔枝': 'summer-lychee.jpg', '猕猴桃': 'guofeng-kiwi.jpg', '石榴': 'guofeng-pomegranate.jpg',
  '葡萄': 'autumn-grape-a.jpg', '梨': 'autumn-pear.jpg', '柿子': 'autumn-persimmon.jpg',
  '柑橘': 'autumn-orange-w.jpg', '柚子': 'autumn-pomelo.jpg', '枣': 'autumn-jujube.jpg',
  '冬枣': 'autumn-winter-jujube-w.jpg', '青梅': 'spring-plum.jpg', '桑葚': 'spring-mulberry.jpg',
  '草莓': 'spring-strawberry-w.jpg', '李子': 'summer-plum-fruit.jpg', '桃子': 'summer-peach.jpg',
  '西瓜': 'summer-watermelon.jpg', '芒果': 'spring-mango.jpg', '枇杷': 'spring-loquat.jpg',
  '香蕉': 'spring-banana.jpg', '菠萝': 'summer-pineapple.jpg', '龙眼': 'summer-longan.jpg',
  '火龙果': 'summer-dragon-fruit.jpg', '椰子': 'summer-coconut.jpg', '柠檬': 'summer-lemon.jpg',
  '木瓜': 'winter-papaya.jpg', '杨桃': 'winter-starfruit.jpg', '金桔': 'winter-kumquat.jpg',
  '橘子': 'winter-mandarin.jpg'
};
function artForFruit(fruit) {
  const file = ART_MAP[String(fruit || '').trim()] || 'autumn-apple.jpg';
  // guofeng-* 三张国风插画已移入分包，其余水果插画仍在主包。
  const base = file.indexOf('guofeng-') === 0 ? '/packageFruit/assets/fruit-art/' : '/assets/fruit-art/';
  return base + file;
}
// 当季水果文化静态回退：取知识库的民俗食俗一段，截断到 90 字以内。
function staticCulture(fruit) {
  const p = WORLD && WORLD[String(fruit || '').trim()];
  if (p && typeof p.folk === 'string' && p.folk.trim()) {
    const text = p.folk.trim();
    return text.length > 90 ? text.slice(0, 90) + '…' : text;
  }
  return '暂无该水果的静态文化资料，欢迎来果乡实地感受四季风物。';
}
// 果乡故事扩充（按 county 定位，覆盖已上架的三张国风插画果园）；未命中回退后端 description。
const STORY_OVERRIDES = {
  '洛川县': '黄土高原的沟峁之间，王大爷家的苹果园已经传了三代人。这里海拔高、昼夜温差大，苹果慢慢把糖分攒足；王大爷说，剪枝、疏果、套袋一样都不能省，果子才红得透、甜得脆。霜降一过，满园红果压枝，摘一颗擦一擦就能咬，是黄土塬上最地道的秋味。',
  '蒲江县': '四川蒲江气候温润，是红心猕猴桃的家乡。从春天开花到秋分采摘，果农像照看孩子一样，等它慢慢膨大、转甜。猕猴桃是「会等的果子」——摘早了酸，放软了才甜，急不得。切开一颗，红心像一圈小太阳，软糯清甜，是川西坝子秋天的味道。',
  '蒙自市': '云南蒙自日照充足，种出来的石榴皮薄粒大、汁多味甜。石榴园从春到秋都忙个不停，疏花、套袋、防虫，就为中秋前后那一树红果。成熟时石榴咧嘴露籽，像满树红玛瑙；剥开抓一把塞进嘴里，是高原阳光攒下的甜。'
};
function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

Page({
  data: {
    fontClass: 'fs-normal',
    town: null,
    storyText: '',
    cultureText: '',
    cultureFrom: 'ai',
    imagePath: '',
    loading: true,
    error: '',
    L: {}
  },
  onLoad: function (options) {
    this.setData({ fontClass: fontClass(), L: i18n.labels(['ft_story', 'ft_culture', 'ft_experience', 'ft_nav', 'loading']) });
    const id = options && options.id;
    if (!id) { this.setData({ loading: false, error: '缺少果乡参数' }); return; }
    this.loadTown(id);
  },
  loadTown: function (id) {
    const self = this;
    this.setData({ loading: true, error: '' });
    farmtown.getTown(id).then(function (town) {
      if (!town) { self.setData({ loading: false, error: '果乡不存在或已下架' }); return; }
      const imagePath = (town.image && typeof town.image === 'string' && town.image) ? town.image : artForFruit(town.fruit);
      const storyText = STORY_OVERRIDES[town.county] || town.description || '';
      if (typeof wx !== 'undefined' && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: town.name });
      self.setData({ town: town, storyText: storyText, imagePath: imagePath, loading: false });
      self.loadCulture(town);
    }).catch(function () {
      self.setData({ loading: false, error: '果乡数据加载失败，请在「我的」检查云端连接' });
    });
  },
  loadCulture: function (town) {
    const self = this;
    farmtown.cultureText(town.term, town.fruit).then(function (text) {
      if (text) self.setData({ cultureText: text, cultureFrom: 'ai' });
      else self.setData({ cultureText: staticCulture(town.fruit), cultureFrom: 'static' });
    }).catch(function () {
      self.setData({ cultureText: staticCulture(town.fruit), cultureFrom: 'static' });
    });
  },
  openLocation: function () {
    const town = this.data.town;
    if (!town || !town.location) return;
    wx.openLocation({
      latitude: town.location.latitude,
      longitude: town.location.longitude,
      name: town.name,
      address: (town.province || '') + (town.city || '') + (town.county || ''),
      fail: function () {}
    });
  },
  goBack: function () { wx.navigateBack({ delta: 1 }); }
});
