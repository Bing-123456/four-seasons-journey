const solarTermNotes = require('../../data/solar-term-notes');
const cloudImg = require('../../lib/cloud-images');
const farmerStories = require('../data/farmer-stories');
const i18n = require('../../lib/i18n');
Page({
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  data: { termExpanded: true, storyExpanded: true },
  onLoad: function () {
    const en = i18n.getLang() === 'en';
    wx.setNavigationBarTitle({ title: en ? 'Seasonal stories' : '节气与故事' });
    const term = solarTermNotes.currentTerm();
    // 故事水果的季节跟随当前节气（评审 9.28②：秋分页不再出现春末的青梅故事）。
    const story = farmerStories.storyForSeason(term.season) || { text: '', fruit: '', name: '', place: '', illustration: cloudImg.img('illustrations/farmer-story-care') };
    this.setData({
      L: i18n.labels(['home_news','news_term','news_story','note_verify','collapse_full','expand_full']),
      termNote: en ? Object.assign({}, term, { name: term.enName || term.name, headline: term.enHeadline || term.headline, text: term.enText || term.text }) : term,
      // 果农故事为真实人物故事（含地名与来源），来源行随正文展示；上方不再重复提示（评审 9.28③④）。
      seasonStory: story,
      visualCopy: { illustration: en ? 'Illustrated orchard scene' : '果园劳作场景插图' }
    });
  },
  toggleTerm: function () { this.setData({ termExpanded: !this.data.termExpanded }); },
  toggleStory: function () { this.setData({ storyExpanded: !this.data.storyExpanded }); },
});
