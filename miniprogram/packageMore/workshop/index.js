'use strict';

const lesson = require('../data/workshop');
const workshop = require('../lib/workshop');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

// 内容层固定课程：数据文件带 en 字段，此处按语言组装视图。
// lib.transition 的交互反馈为中文契约（测试锁定），英文展示在页面层映射。
const FEEDBACK_EN = {
  '选两项就好。先取消一项，再换个选择。': 'Only two. Unselect one first, then pick again.',
  '请选出报道中提到的两种主要原料。': 'Pick the two main ingredients named in the report.',
  '再想一想：名字里的“瓜”和“豆”，分别是什么？': 'Think again: which ingredients do the “melon” and “bean” in the name refer to?',
  '选对了，是西瓜和黄豆。一起看看它们经过哪些工序。': 'Correct — watermelon and soybean. Now see the steps they go through.',
  '正是如此。手艺的价值，也在食材与人的连接里。': 'Exactly. The value of the craft lies in connecting ingredients and people.',
  '还差一点。报道提到多道工序，并不是混合后就能食用。': 'Not quite. The report lists several steps; mixing alone does not make it edible.',
  '文化资料讲的是手艺与生活，不能据此预测当年的销量。': 'Culture notes describe craft and life — they cannot forecast this year\'s watermelon sales.',
  '先选一个答案。可以回看工序，再试一次。': 'Choose an answer first. Revisit the steps and try again.'
};
function localizeView(view) {
  if (i18n.getLang() !== 'en') return view;
  const out = Object.assign({}, view);
  out.ingredientItems = (view.ingredientItems || []).map(item => Object.assign({}, item, { name: item.enName || item.name, detail: item.enDetail || item.detail }));
  out.processItems = (view.processItems || []).map(item => Object.assign({}, item, { title: item.enTitle || item.title }));
  if (view.activeProcess) out.activeProcess = Object.assign({}, view.activeProcess, { title: view.activeProcess.enTitle || view.activeProcess.title, kicker: view.activeProcess.enKicker || view.activeProcess.kicker, text: view.activeProcess.enText || view.activeProcess.text, note: view.activeProcess.enNote || view.activeProcess.note });
  out.answerItems = (view.answerItems || []).map(item => Object.assign({}, item, { text: item.enText || item.text }));
  if (view.feedback) {
    const dynamic = view.feedback.indexOf('翻到还没看过的') === 0;
    out.feedback = FEEDBACK_EN[view.feedback] || (dynamic && view.activeProcess && view.activeProcess.enTitle ? 'Turn to the unread "' + view.activeProcess.enTitle + '". Continue after reading.' : view.feedback);
  }
  return out;
}
function localizeLesson(lesson) {
  if (i18n.getLang() !== 'en') return lesson;
  return Object.assign({}, lesson, { title: lesson.enTitle, subtitle: lesson.enSubtitle, location: lesson.enLocation, intro: lesson.enIntro, question: Object.assign({}, lesson.question, { title: lesson.question.enTitle }) });
}

Page({
  data: Object.assign(workshop.viewState(workshop.initialState()), {
    lesson, lessonView: lesson, validLesson: true, favorite: false, saveStatus: '', error: '', sourceVisible: false, sources: [], L: {}
  }),
  onLoad: function (options) { i18n.applyNav('nav_workshop');
    this.setData({ L: i18n.labels(Object.keys(i18n.dict).filter(key => key.indexOf('ws_') === 0)) });
    if (options && options.id && options.id !== lesson.id) {
      this.setData({ validLesson: false, error: i18n.t('ws_err_invalid') });
      return;
    }
    this._state = workshop.initialState();
    this.setData(localizeView(Object.assign(workshop.viewState(this._state), { lessonView: localizeLesson(lesson) })));
    this.refreshFavorite();
    this.record('workshop_open');
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 this.refreshFavorite(); },
  refreshFavorite: function () {
    try { this.setData({ favorite: store.getFavorites().includes(lesson.placeId) }); }
    catch (error) { this.setData({ error: i18n.t('ws_err_fav') }); }
  },
  record: function (type, details) {
    // Reading must remain available when local storage is full or unavailable.
    try { store.logEvent(type, Object.assign({ placeId: lesson.placeId, mode: 'workshop' }, details)); } catch (error) {}
  },
  advance: function (action, value) {
    if (!this.data.validLesson) return;
    const previous = this._state || workshop.initialState();
    this._state = workshop.transition(previous, action, value);
    this.setData(localizeView(workshop.viewState(this._state)));
    if (this._state.step !== previous.step) wx.pageScrollTo({ scrollTop: 0, duration: 220 });
    if (this._state.completed && !previous.completed) this.record('workshop_complete', { ok: true, count: this._state.visitedProcessIds.length });
  },
  backHome: function () { wx.switchTab({ url: '/pages/index/index' }); },
  selectIngredient: function (event) { this.advance('ingredient', event.currentTarget.dataset.id); },
  confirmIngredients: function () { this.advance('confirm-ingredients'); },
  selectProcess: function (event) { this.advance('process', Number(event.currentTarget.dataset.index)); },
  continueToQuiz: function () { this.advance('continue'); },
  selectAnswer: function (event) { this.advance('answer', event.currentTarget.dataset.id); },
  completeLesson: function () { this.advance('complete'); },
  previousStep: function () { this.advance('previous'); },
  navigate: function (url) {
    const page = this;
    this.setData({ error: '' });
    const fail = function () {
      page.setData({ error: i18n.t('ws_err_nav') });
    };
    if (url === '/pages/culture/culture?id=' + lesson.placeId && typeof getCurrentPages === 'function') {
      const pages = getCurrentPages();
      // Reuse the nearest matching note so its reading state survives the lesson.
      // A different culture page in the stack must not receive this handoff.
      for (let index = pages.length - 2; index >= 0; index -= 1) {
        const entry = pages[index];
        const placeId = entry.data && entry.data.place && entry.data.place.id || entry.options && entry.options.id;
        if (entry.route === 'pages/culture/culture' && placeId === lesson.placeId) {
          wx.navigateBack({ delta: pages.length - 1 - index, fail });
          return;
        }
      }
    }
    wx.navigateTo({ url, fail });
  },
  skipToReading: function () { this.record('workshop_skip', { count: this.data.step }); this.navigate('/pages/culture/culture?id=' + lesson.placeId); },
  readNote: function () { this.navigate('/pages/culture/culture?id=' + lesson.placeId); },
  openMill: function () { this.navigate('/packageMore/heritage/index?id=grain-mill'); },
  saveNote: function () {
    this.setData({ error: '', saveStatus: '' });
    try {
      if (!store.getFavorites().includes(lesson.placeId)) store.toggleFavorite(lesson.placeId);
      this.setData({ favorite: true, saveStatus: i18n.t('ws_saved_status') });
      wx.showToast({ title: i18n.t('ws_fav_done'), icon: 'success' });
    } catch (error) { this.setData({ error: i18n.t('ws_err_save') }); }
  },
  viewSources: function () {
    const ids = this.data.step === 0 ? lesson.ingredientSourceIds : this.data.step === 1 ? this.data.activeProcess.sourceIds : lesson.question.sourceIds;
    this.setData({ sourceVisible: true, sources: lesson.sources.filter(source => ids.includes(source.id)) });
  },
  viewAllSources: function () { this.setData({ sourceVisible: true, sources: lesson.sources }); },
  closeSources: function () { this.setData({ sourceVisible: false }); },
  copySource: function (event) {
    const source = lesson.sources.find(item => item.id === event.currentTarget.dataset.id);
    if (!source) return;
    const page = this;
    wx.setClipboardData({ data: source.url, fail: function () { page.setData({ error: i18n.t('ws_err_copy') }); } });
  },
  noop: function () {}
});
