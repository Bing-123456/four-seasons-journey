'use strict';

const artifacts = [{
  id: 'grain-mill',
  title: '石磨盘与磨棒',
  eyebrow: '河南农耕小课堂 / 01',
  subtitle: '一粒谷物，怎样入口？',
  sourceName: '河南博物院 · 石磨盘及磨棒',
  sourceUrl: 'https://www.chnmus.net/sitesources/hnsbwy/page_pc/dzjp/mzyp/smpjmb/list1.html',
  description: '谷物收获之后，还要经过加工。借一件出土于新郑裴李岗的农具，看看祖先怎样让谷壳与谷粒分离。',
  notice: '依据公开资料制作的结构与运动教学示意，非馆藏扫描复原。谷粒变化用于帮助观察，不表示实际加工速度或效果。',
  observations: [
    { number: '01', title: '认一认：盘与棒', text: '椭圆形磨盘承接谷物，四个小足位于盘底；横在上方的是近圆柱形磨棒。' },
    { number: '02', title: '动一动：来回滚碾', text: '这套器具的操作方式是用磨棒来回滚碾，帮助谷壳与谷粒分离。留意磨棒的位置与滚动方向。' },
    { number: '03', title: '想一想：一餐之前', text: '从收获到入口，加工也是农耕生活的一部分。再看一看家乡的食物，哪些需要经过人的双手？' }
  ],
  experienceLink: '/pages/workshop/index?id=guadoujiang',
  experienceLabel: '再认识一种河南乡味',
  question: '这套石磨盘与磨棒，怎样配合工作？',
  choices: [
    { id: 'rolling', text: '磨棒在磨盘上来回滚碾', correct: true },
    { id: 'spinning', text: '整个磨盘绕中心不停旋转', correct: false }
  ]
}];

module.exports = { artifacts: artifacts };
