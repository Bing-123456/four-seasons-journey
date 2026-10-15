'use strict';
// 入口壳（2026-10-15）：本页是 tabBar 页，必须留在主包，所以这里**不再 require 玩法链**
// （lib/playground-controller + 游戏逻辑 + 题库共 539.55 KiB 已整体下沉到 packageGame 分包）。
// 首屏只需要三样东西：3 个 i18n 标签、4 行文案、3 张封面图路径 —— 全部来自主包内的小文件。
// 页面行为与原 hub 模式（createPlaygroundController({ hub: true })）逐条对齐：
//   字体档位 / 导航标题 / tabBar 选中态 / 3 张卡片点击进分包 / 封面图加载失败回退纯色 / 分享文案。
const i18n = require('../../lib/i18n');
const gameArtConfig = require('../../lib/game-art');

Page({
  data: {
    fontClass: 'fs-normal',
    L: {},
    copy: {},
    gameArt: { quiz: '', challenge: '', match: '' },
    gameArtError: { quiz: false, challenge: false, match: false }
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
    i18n.applyNav('app_name');
    const bar = this.getTabBar && this.getTabBar();
    if (bar) { bar.setData({ selected: 2 }); if (bar.applyLang) bar.applyLang(); }
    this.setData({ L: i18n.labels(['game_quiz', 'game_challenge', 'game_match']) });
    const en = i18n.getLang() === 'en';
    this.setData({
      copy: { title: en ? 'Games' : '游戏', quiz: en ? 'Proverb quiz' : '农谚问答', challenge: en ? 'Farming wheel' : '农事转盘', match: en ? 'Heritage match' : '文脉连连' },
      gameArt: gameArtConfig
    });
  },
  onShareAppMessage: function () {
    return { title: i18n.t('learn_share_title'), path: '/pages/learn/learn' };
  },
  openGame: function (event) {
    const game = event.currentTarget.dataset.game;
    if (['quiz', 'challenge', 'match'].includes(game)) wx.navigateTo({ url: '/packageGame/pages/playground/playground?game=' + game });
  },
  // 卡片背景图加载失败：隐藏该图，卡片回退到纯色（learn.wxss .game-entry 的 #F3E3C8）。
  onGameArtError: function (event) {
    const game = event.currentTarget.dataset.game;
    if (game) this.setData({ ['gameArtError.' + game]: true });
  }
});
