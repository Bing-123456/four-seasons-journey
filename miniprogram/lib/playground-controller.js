'use strict';

const store = require('./store');
const media = require('./media-service');
const fruitQuiz = require('../data/fruit-quiz');
const companionLib = require('./companion');
const i18n = require('./i18n');

const PAINT_EXAMPLES = ['霜降摘柿', '芒种采梅', '老农晒枣', '古法制作果脯'];
const pendingPaintSubmissions = new Map();
function samePaintOwner(session, context) {
  return session && session.apiBase === context.apiBase && session.owner === context.token;
}
function readPaintSession(context) {
  const sessions = store.readPartitionField('paintSessions', context.partition);
  return Array.isArray(sessions) ? sessions.find(session => samePaintOwner(session, context)) || null : null;
}
function writePaintSession(context, session) {
  const saved = store.readPartitionField('paintSessions', context.partition);
  const sessions = Array.isArray(saved) ? saved.filter(item => !samePaintOwner(item, context)) : [];
  // Like the existing pairing record, ownership stays in this local account
  // partition. Retain only the latest task for up to four service identities.
  const next = Object.assign({}, session, { apiBase: context.apiBase, owner: context.token });
  store.writePartitionField('paintSessions', sessions.concat([next]).slice(-4), context.partition);
  return next;
}
function updatePaintSession(context, id, patch) {
  const session = readPaintSession(context);
  // Never resurrect a cleared account or overwrite a newer submission.
  if (!session || session.id !== id) return null;
  return writePaintSession(context, Object.assign({}, session, patch));
}
function paintFileExists(filePath) {
  try {
    if (!filePath || !wx.getFileSystemManager) return false;
    wx.getFileSystemManager().accessSync(filePath); return true;
  } catch (error) { return false; }
}

module.exports = function createPlaygroundController(options) {
  const isHub = !!(options && options.hub);
  return {
    data: {
      quiz: [], quizIndex: 0, quizAnswered: false, quizCorrect: false, quizScore: 0, quizDone: false,
      quizProgress: '', quizScoreLine: '', unlockCelebration: null,
      identifyBusy: false, identifyResult: null, unlockedCount: 1, totalFruits: 6, companion: null,
      paintExamples: PAINT_EXAMPLES.slice(), paintKeyword: '', paintBusy: false, paintNote: '', paintImage: '', L: {},
      game: 'quiz', isHub, copy: {}, activeTitle: ''
    },
    onLoad: function (query) {
      const requested = query && query.game;
      this.setData({ game: requested === 'story' ? 'identify' : ['quiz', 'identify', 'paint'].includes(requested) ? requested : 'quiz' });
    },
    onUnload: function () { this._closed = true; this.cancelPaint(); },
    cancelPaint: function () {
      this._paintRevision = (this._paintRevision || 0) + 1;
      clearTimeout(this._paintTimer);
      if (this.data.paintBusy) this.setData({ paintBusy: false, paintNote: i18n.t('paint_paused') });
    },
    onShow: function () {
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });       i18n.applyNav(isHub ? 'tab_games' : this.data.game === 'paint' ? 'game_paint' : this.data.game === 'identify' ? 'game_identify' : 'game_quiz');
      this._closed = false;
      const bar = isHub && this.getTabBar && this.getTabBar(); if (bar) bar.setData({ selected: 2 });
      this.setData({ L: i18n.labels(['quiz_proverb_type','quiz_knowledge_type','games_title1','games_title2','game_identify','game_identify_pill','game_identify_desc','identify_btn','identify_result_prefix','game_quiz','quiz_pill','quiz_prompt','quiz_correct','quiz_wrong','quiz_next','quiz_done','quiz_again','game_paint','game_paint_desc','paint_ph','paint_btn','paint_local','unlock_title','unlock_body_suffix','unlock_go','unlock_continue','unlock_repeat','go_seasons_story','save_album','share_friend','loading','story_pill','unlock_owned_title','unlock_owned_body','learn_go_setup']) });
      const en = i18n.getLang() === 'en';
      this.setData({
        copy: { title: en ? 'Games' : '游戏', subtitle: en ? '' : '', featured: en ? 'CREATE WITH AI' : '今日创作', paint: en ? 'Ink painting' : '国风绘画', paintHint: en ? 'Generate from a few keywords' : '输入关键词生成插画', quiz: en ? 'Proverb quiz' : '农谚问答', quizHint: en ? 'Learn & unlock companions' : '答对农谚，解锁果灵', identify: en ? 'Guoling Fruit ID' : '果灵识果', identifyHint: en ? 'A photo reveals its story' : '拍张照片，认识它的故事', start: en ? 'Open' : '开始', illustration: en ? 'Illustration' : '插画', back: en ? 'Games' : '游戏' },
        activeTitle: i18n.t(this.data.game === 'paint' ? 'game_paint' : this.data.game === 'identify' ? 'game_identify' : 'game_quiz')
      });
      if (!isHub && (!this.data.quiz.length || this._quizLang !== i18n.getLang())) { this._quizLang = i18n.getLang(); this.setData({ quiz: fruitQuiz.buildRound(null, this._quizLang) }); }
      // 解锁进度由同一份账户数据提供给问答。
      const unlocks = store.getFruitUnlocks();
      const totalFruits = require('../data/companion-templates').templates.length;
      this.setData({ unlockedCount: Math.min(unlocks.length, totalFruits), totalFruits, companion: store.getCompanion() });
      this.updateQuizTexts();
      if (!isHub && this.data.game === 'paint') this.restorePaintSession();
    },
    onShareAppMessage: function () {
      return { title: i18n.t('learn_share_title'), path: isHub ? '/pages/learn/learn' : '/pages/playground/playground?game=' + this.data.game };
    },
    openGame: function (event) {
      const game = event.currentTarget.dataset.game;
      if (['quiz', 'identify', 'paint'].includes(game)) wx.navigateTo({ url: '/pages/playground/playground?game=' + game });
    },
    goCompanion: function () { this.setData({ unlockCelebration: null }); wx.navigateTo({ url: '/pages/companion/companion' }); },
    goSetup: function () { wx.navigateTo({ url: '/pages/mine/mine' }); },
    noop: function () {},
    // ---- ① 果灵识果：拍照识别，跳转四时对应文化详情 ----
    // 识果链路（拍照→上传→/api/identify-fruit→结果）依赖视觉模型；上游偶发抖动
    // （qwen-vl 偶尔输出不合法 JSON、瞬时 5xx/超时）会被服务端降级为 model_* 兜底。
    // 这里对这类瞬时失败自动重试两次，避免把一次抖动当成功能不可用。
    IDENTIFY_RETRIES: 2,
    requestIdentify: function (context, image, attempt) {
      return media.request(context, 'POST', '/api/identify-fruit', image).then(data => {
        const transient = data && data.identified !== true && /^model_/.test(data.fallbackReason || '');
        if (!transient || attempt >= this.IDENTIFY_RETRIES || this._closed || !media.isCurrent(context)) return data;
        return new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
          .then(() => this.requestIdentify(context, image, attempt + 1));
      }, error => {
        if (!error || error.retryable !== true || attempt >= this.IDENTIFY_RETRIES || this._closed || !media.isCurrent(context)) throw error;
        return new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
          .then(() => this.requestIdentify(context, image, attempt + 1));
      });
    },
    identifyFruit: function () {
      if (this.data.identifyBusy) return;
      let context;
      try { context = media.capture(); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); return; }
      wx.showModal({
        title: i18n.t('identify_menu_title'), content: i18n.t('identify_privacy'), confirmText: '选择照片',
        success: consent => {
          if (!consent.confirm) return;
          wx.chooseMedia({
            count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'],
            success: result => {
              const file = result.tempFiles && result.tempFiles[0];
              if (!file || !file.tempFilePath || this._closed || !media.isCurrent(context)) return;
              this.setData({ identifyBusy: true, identifyResult: null });
              this._identifyPromise = media.readImage(file.tempFilePath)
                .then(image => this.requestIdentify(context, image, 0))
                .then(data => {
                  if (this._closed || !media.isCurrent(context)) return;
                  this.setData({ identifyResult: data.identified && typeof data.fruit === 'string' ? { fruit: data.fruit } :
                    { fruit: null, message: data.message || i18n.t('identify_fail') } });
                }).catch(error => {
                  if (!this._closed) this.setData({ identifyResult: { fruit: null, message: error.message } });
                }).finally(() => { if (!this._closed) this.setData({ identifyBusy: false }); });
            },
            fail: error => { if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: i18n.t('identify_pick_fail'), icon: 'none' }); }
          });
        }
      });
    },
    viewFruit: function () {
      const fruit = this.data.identifyResult && this.data.identifyResult.fruit;
      if (!fruit) return;
      const hit = require('../data/fruit-culture').findFruitByName(fruit);
      if (!hit) { wx.showToast({ title: i18n.t('identify_not_in_graph'), icon: 'none' }); return; }
      wx.navigateTo({ url: '/pages/fruit-detail/fruit-detail?fruit=' + encodeURIComponent(hit.fullId) });
    },

    // ---- ② 农谚问答：水果农谚，答对解锁定制水果 ----
    updateQuizTexts: function () {
      const quiz = this.data.quiz, index = this.data.quizIndex;
      if (!quiz.length) { this.setData({ quizProgress: '', quizScoreLine: '' }); return; }
      const unlocks = store.getFruitUnlocks();
      const total = require('../data/companion-templates').templates.length;
      const unlockText = i18n.t('quiz_unlock_short', { n: Math.min(unlocks.length, total), total });
      this.setData({
        quizProgress: i18n.t('quiz_progress', { n: index + 1, total: quiz.length, score: this.data.quizScore }) + ' · ' + unlockText,
        quizScoreLine: i18n.t('quiz_score_line', { score: this.data.quizScore, total: quiz.length })
      });
    },
    copyQuizSource: function () { const item = this.data.quiz[this.data.quizIndex]; if (item && item.sourceUrl) wx.setClipboardData({ data: item.sourceUrl }); },
    answer: function (event) {
      if (this.data.quizAnswered) return;
      const correct = event.currentTarget.dataset.correct === '1';
      this.setData({ quizAnswered: true, quizCorrect: correct, quizScore: this.data.quizScore + (correct ? 1 : 0) }, () => {
        this.updateQuizTexts();
        if (correct) this.unlockForCurrentQuestion();
      });
    },
    unlockForCurrentQuestion: function () {
      const question = this.data.quiz[this.data.quizIndex];
      if (!question || !question.fruitId) return;
      // 答对水果题即弹出解锁画面；已解锁过的水果显示“已获得”文案。
      try {
        const result = store.unlockFruit(question.fruitId);
        const templates = require('../data/companion-templates').templates;
        const template = templates.find(item => item.id === question.fruitId);
        this.setData({ unlockCelebration: { name: question.fruit, config: companionLib.defaultConfig(question.fruitId), templateName: template ? template.name : question.fruit, alreadyOwned: !result.added } });
      } catch (error) { /* 解锁失败不影响答题 */ }
    },
    closeUnlock: function () { this.setData({ unlockCelebration: null }); },
    // 「去[我的]看看」：解锁后直达「我的水果伙伴」创作页，方便立即定制卡通形象。
    goMine: function () { this.setData({ unlockCelebration: null }); wx.navigateTo({ url: '/pages/companion/companion' }); },
    nextQuiz: function () {
      const next = this.data.quizIndex + 1;
      if (next >= this.data.quiz.length) { this.setData({ quizDone: true }); return; }
      this.setData({ quizIndex: next, quizAnswered: false, quizCorrect: false }, () => this.updateQuizTexts());
    },
    // 再来一轮：把上一轮已出题的 id 序列交给 buildRound 做去重，
    // 保证连续两轮的题目顺序与选项排列都不相同。
    restartQuiz: function () {
      const previousIds = this.data.quiz.map(item => item.id);
      this.setData({ quiz: fruitQuiz.buildRound(previousIds, i18n.getLang()), quizIndex: 0, quizAnswered: false, quizCorrect: false, quizScore: 0, quizDone: false }, () => this.updateQuizTexts());
    },

    // ---- ③ AI国风图像生成：关键词 → 农耕国风插画，可保存分享 ----
    paintInput: function (event) { this.setData({ paintKeyword: event.detail.value }); },
    usePaintExample: function (event) { this.setData({ paintKeyword: event.currentTarget.dataset.word }); },
    restorePaintSession: function () {
      this.cancelPaint();
      this.setData({ paintKeyword: '', paintImage: '', paintBusy: false, paintNote: '', paintGoSetup: false });
      this._paintContext = null; this._paintSessionId = '';
      let context, session;
      try { context = media.capture(); session = readPaintSession(context); }
      catch (error) { return; }
      this._paintContext = context;
      if (!session) return;
      this._paintSessionId = session.id;
      const revision = this._paintRevision;
      const imagePath = paintFileExists(session.imagePath) ? session.imagePath : '';
      this.setData({ paintKeyword: session.keyword || '', paintImage: imagePath, paintNote: session.message || '' });
      if (session.status === 'succeeded') {
        if (!imagePath && /^https:\/\//.test(session.imageUrl || '')) {
          this.setData({ paintBusy: true, paintNote: i18n.t('paint_resume') });
          return this.downloadPaint(context, session, revision);
        }
        return;
      }
      if (session.status === 'failed') return;
      if (session.taskId) {
        this.setData({ paintBusy: true, paintNote: i18n.t('paint_resume') });
        this.pollPaint(context, session.taskId, 0, revision);
        return;
      }
      const pending = pendingPaintSubmissions.get(session.id);
      if (pending) {
        this.setData({ paintBusy: true, paintNote: i18n.t('paint_busy') });
        return pending.then(() => { if (this.paintCurrent(context, revision)) return this.restorePaintSession(); });
      }
      // A process restart can interrupt submission before a task ID arrives.
      // Do not automatically repeat a paid POST; leave an explicit retry action.
      this.setData({ paintNote: i18n.t('paint_paused') });
      try { updatePaintSession(context, session.id, { status: 'failed', message: i18n.t('paint_paused') }); } catch (error) { this.setData({ paintNote: error.message }); }
    },
    generatePaint: function () {
      if (this.data.paintBusy) return;
      const keyword = this.data.paintKeyword.trim();
      if (!keyword) { wx.showToast({ title: i18n.t('paint_kw_hint'), icon: 'none' }); return; }
      let context, previous;
      try { context = media.capture(); previous = readPaintSession(context); }
      catch (error) { this.setData({ paintNote: error.message, paintGoSetup: true }); return; }
      if (previous && (['submitting', 'queued', 'generating', 'paused'].includes(previous.status) ||
          previous.status === 'succeeded' && previous.keyword === keyword && !paintFileExists(previous.imagePath))) {
        return this.restorePaintSession();
      }
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      try { writePaintSession(context, { id, keyword, status: 'submitting', taskId: '', imageUrl: '', imagePath: '', message: '' }); }
      catch (error) { this.setData({ paintNote: error.message, paintBusy: false }); return; }
      const revision = this._paintRevision = (this._paintRevision || 0) + 1;
      this._paintContext = context; this._paintSessionId = id;
      this.setData({ paintBusy: true, paintNote: i18n.t('paint_busy'), paintImage: '', paintGoSetup: false });
      const submission = media.request(context, 'POST', '/api/ink-painting', { keyword }).then(data => {
        if (data.status === 'failed' || typeof data.taskId !== 'string' || !data.taskId) throw new Error(data.message || i18n.t('paint_fail'));
        const session = updatePaintSession(context, id, { taskId: data.taskId, status: 'queued', message: '' });
        if (this.paintCurrent(context, revision) && session) this.pollPaint(context, data.taskId, 0, revision);
      }).catch(error => {
        try { updatePaintSession(context, id, { status: 'failed', message: error.message }); } catch (saveError) { /* Keep the original request error actionable. */ }
        if (this.paintCurrent(context, revision)) this.setData({ paintBusy: false, paintNote: error.message, paintGoSetup: /演示|配对|检查连接/.test(error.message || '') });
      }).finally(() => { pendingPaintSubmissions.delete(id); });
      pendingPaintSubmissions.set(id, submission);
      return submission;
    },
    paintCurrent: function (context, revision) {
      if (this._closed || revision !== this._paintRevision) return false;
      const session = readPaintSession(context);
      if (store.capturePartition() !== context.partition || !media.isCurrent(context) || !session || session.id !== this._paintSessionId) {
        this.setData({ paintBusy: false, paintImage: '', paintNote: i18n.t('svc_changed') }); return false;
      }
      return true;
    },
    downloadPaint: function (context, session, revision) {
      const save = imagePath => {
        const saved = updatePaintSession(context, session.id, { imagePath, message: '' });
        if (this.paintCurrent(context, revision) && saved) this.setData({ paintBusy: false, paintNote: '', paintImage: imagePath });
      };
      return new Promise((resolve, reject) => wx.downloadFile({ url: session.imageUrl,
        success: result => result.statusCode === 200 && result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error(i18n.t('download_fail'))),
        fail: () => reject(new Error(i18n.t('download_fail_domain')))
      })).then(save).catch(error => {
        try { updatePaintSession(context, session.id, { message: error.message }); } catch (saveError) { /* Re-entry can retry the saved remote result. */ }
        if (this.paintCurrent(context, revision)) this.setData({ paintBusy: false, paintNote: error.message });
      });
    },
    pollPaint: function (context, taskId, count, revision, failures) {
      if (!this.paintCurrent(context, revision)) return;
      const id = this._paintSessionId;
      if (count >= 48) {
        try { updatePaintSession(context, id, { status: 'paused', message: i18n.t('paint_timeout') }); } catch (error) { /* Keep the task ID already on disk. */ }
        this.setData({ paintBusy: false, paintNote: i18n.t('paint_timeout') }); return;
      }
      this._paintTimer = setTimeout(() => {
        if (!this.paintCurrent(context, revision)) return;
        media.request(context, 'GET', '/api/ink-painting/' + encodeURIComponent(taskId)).then(data => {
          const hasImageUrl = /^https:\/\//.test(data.imageUrl || '');
          if (data.status === 'succeeded' && hasImageUrl) {
            const session = updatePaintSession(context, id, { status: 'succeeded', imageUrl: data.imageUrl || '', message: '' });
            if (this.paintCurrent(context, revision) && session) return this.downloadPaint(context, session, revision);
          } else if (data.status === 'failed') throw Object.assign(new Error(data.message || i18n.t('paint_fail')), { retryable: false });
          else if (['queued', 'generating'].includes(data.status)) {
            const session = updatePaintSession(context, id, { status: data.status, message: '' });
            if (this.paintCurrent(context, revision) && session) this.pollPaint(context, taskId, count + 1, revision);
          } else throw Object.assign(new Error(i18n.t('paint_invalid')), { retryable: false });
        }).catch(error => {
          try { updatePaintSession(context, id, { status: error.retryable === false ? 'failed' : 'paused', message: error.message }); } catch (saveError) { /* A local write failure must not strand the busy state. */ }
          if (!this.paintCurrent(context, revision)) return;
          if (error.retryable !== false && (failures || 0) < 3) {
            this.setData({ paintNote: i18n.t('paint_resume') });
            this.pollPaint(context, taskId, count + 1, revision, (failures || 0) + 1);
          } else this.setData({ paintBusy: false, paintNote: error.message });
        });
      }, 2500);
    },
    savePaint: function () {
      if (!this._paintContext || !this.paintCurrent(this._paintContext, this._paintRevision)) return;
      const filePath = this.data.paintImage;
      if (!filePath) return;
      const doSave = () => wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: i18n.t('saved_album_toast'), icon: 'success' }),
        fail: error => {
          if (error && /auth/i.test(error.errMsg || '')) {
            wx.showModal({ title: i18n.t('album_perm_title'), content: i18n.t('album_perm_body'), confirmText: i18n.t('go_settings'), success: result => { if (result.confirm) wx.openSetting({}); } });
          } else wx.showToast({ title: i18n.t('save_fail_retry'), icon: 'none' });
        }
      });
      wx.getSetting({ success: result => {
        if (result.authSetting && result.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({ title: i18n.t('album_perm_title'), content: i18n.t('album_perm_body'), confirmText: i18n.t('go_settings'), success: modalResult => { if (modalResult.confirm) wx.openSetting({}); } });
        } else doSave();
      }, fail: doSave });
    }
  };
};
