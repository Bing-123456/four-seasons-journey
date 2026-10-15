'use strict';

const store = require('../../lib/store');
const media = require('../../lib/media-service');
const fruitQuiz = require('../data/fruit-quiz');
const companionLib = require('../../lib/companion');
const i18n = require('../../lib/i18n');
const gameArtConfig = require('../../lib/game-art');

// 每轮固定 6 题（口径来自 data/fruit-quiz.js 的 buildRound：:261 的 break 与 :264 的补齐；
// pages/index/index.js 的 QUESTIONS_PER_ROUND 是同一口径）。
// 「今天已打完」那一屏不重新发题，总结页「答对 X / Y 题」的分母就用它。
const QUIZ_ROUND_SIZE = 6;

// 每天最多 2 局（产品规则本身没变，只把已有的「2」写成常量，供 restartQuiz 的逻辑层守卫使用）。
// 跨天归零由 lib/store.js 的 normalizeQuizProgress 负责（day 不同 → roundsDone 归 0）。
const QUIZ_DAILY_ROUNDS = 2;

// 水果名按当前语言出（2026-10-11 用户要求：English 下「水果卡」上的水果名也要英文）。
// 复用伴宠页已有的 comp_fruit_<模板id> 英文键（6 个水果模板都有：Watermelon/Strawberry/
// Apple/Pear/Grapes/Kiwifruit），这样「解锁弹窗 / 水果卡轮播 / 伴宠页」三处显示同一个英文名；
// 中文模式或键不存在时原样返回，绝不出现空白。
function fruitDisplayName(id, fallbackName) {
  const zhName = fallbackName || '';
  if (!id || i18n.getLang() !== 'en') return zhName;
  const key = 'comp_fruit_' + id;
  return i18n.dict[key] ? i18n.t(key) : zhName;
}

// ── 今日问答簿：「存 key 不存文案」（2026-10-11）─────────────────────────────
// 以前把回答那一刻的成品文字（题面/正解/出处）整条落盘，切到英文后问答簿还是中文（中英混排）。
// 现在写入只留 id + 对错，读回时按 id 用**当前语言**现取文字。
// 出处（sourceTitle）仓库只有中文、没有英文对照 —— 按用户口径（方案 A）：英文界面下保留中文原样，不翻译。
function quizLogIdentity(item) {
  if (!item) return '';
  // 有 id 就用 id 当身份（同一题切语言后仍是同一题，不会被重复入册）
  if (item.id) return 'id:' + item.id;
  // 老存档（只有 text、没有 id）→ 退回用文字当身份，行为与改动前一致
  return 'text:' + String(item.text || '');
}
// 按 id 用当前语言重建问答簿每一行：题目 / 正解现取，出处保留中文原样。
// 老存档（无 id）→ 原样显示（不崩、不变空）；题库里查不到 → 也原样显示。
function quizLogView(items) {
  const lang = i18n.getLang();
  return (items || []).map(function (it, i) {
    if (!it || !it.id || typeof fruitQuiz.findQuestion !== 'function') return Object.assign({}, it);
    let q = null;
    try { q = fruitQuiz.findQuestion(it.id, i, lang, it.flip); } catch (e) { q = null; }
    if (!q) return Object.assign({}, it);
    const right = (q.options || []).filter(function (o) { return o && o.correct; })[0];
    return Object.assign({}, it, {
      text: q.text || it.text || '',
      kind: q.kind || it.kind || '',
      answer: (right && (right.label || right.text)) || '',
      source: q.sourceTitle || ''   // 仓库暂无英文出处 → 英文界面下也是中文原样（方案 A）
    });
  });
}

module.exports = function createPlaygroundController(options) {
  const isHub = !!(options && options.hub);
  return {
    data: {
      quiz: [], quizIndex: 0, quizAnswered: false, quizCorrect: false, quizScore: 0, quizDone: false, quizLog: [],
      quizProgress: '', quizProgressWidth: 0, quizScoreLine: '', unlockCelebration: null,
      unlockCards: [], coverflowIndex: 0, coverflowName: '', coverflowCount: 0, quizRound: 1,
      coverflowCards: [], coverflowDrag: 0, coverflowDragging: false, coverflowFaceSize: 340,
      unlockedCount: 1, totalFruits: 6, companion: null,
      game: 'quiz', isHub, copy: {}, activeTitle: '', L: {},
      gameArt: { quiz: '', challenge: '', match: '' },
      gameArtError: { quiz: false, challenge: false, match: false }
    },
    onLoad: function (query) {
      const requested = query && query.game;
      this.setData({ game: ['quiz', 'challenge', 'match'].includes(requested) ? requested : 'quiz' });
    },
    onUnload: function () { this._closed = true; },
    onHide: function () {
      // 农事转盘切后台时：强制停止转盘旋转，避免回来后转盘自己转。
      if (this._challengeSpinTimer) { clearTimeout(this._challengeSpinTimer); this._challengeSpinTimer = null; }
      if (this.data.wheelSpinning) { this.setData({ wheelSpinning: false }); }
    },
    onShow: function () {
      this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
      i18n.applyNav(isHub ? 'app_name' : this.data.game === 'challenge' ? 'game_challenge' : this.data.game === 'match' ? 'game_match' : 'game_quiz');
      this._closed = false;
      const bar = isHub && this.getTabBar && this.getTabBar();
      if (bar) { bar.setData({ selected: 2 }); if (bar.applyLang) bar.applyLang(); }
      this.setData({ L: i18n.labels(['quiz_proverb_type','quiz_knowledge_type','game_quiz','quiz_pill','quiz_prompt','quiz_correct','quiz_wrong','quiz_next','quiz_done','quiz_again','quiz_finished','quiz_unlock_title','game_challenge','game_match','unlock_title','unlock_body_suffix','unlock_go','unlock_continue','unlock_owned_title','unlock_owned_body','loading','challenge_left','challenge_knowledge_loading','challenge_save_card','challenge_save_album','challenge_next','challenge_day_limit','challenge_round_done','challenge_elf_says','challenge_auto','challenge_saved_toast','challenge_saving','match_left','match_tip','match_again','match_day_limit','match_round_done','match_exhausted','match_day_end', 'qlog_title', 'qlog_empty', 'qlog_you', 'qlog_right', 'qlog_from', 'mgraph_title', 'mgraph_empty', 'mgraph_hint', 'mgraph_loading', 'qlog_loading', 'qlog_by', 'challenge_card_answer', 'qlog_source_fallback', 'coverflow_prev', 'coverflow_next']) });
      const en = i18n.getLang() === 'en';
      this.setData({
        copy: { title: en ? 'Games' : '游戏', quiz: en ? 'Proverb quiz' : '农谚问答', challenge: en ? 'Farming wheel' : '农事转盘', match: en ? 'Heritage match' : '文脉连连' },
        activeTitle: i18n.t(this.data.game === 'challenge' ? 'game_challenge' : this.data.game === 'match' ? 'game_match' : 'game_quiz'),
        gameArt: gameArtConfig
      });
      // 出题按「解锁状态 + 已出过的题」决定：解锁过的水果不再出题，换非定制水果的题。
      // 跨天（_quizDay 与今天不一致）也要重新发题，让第二天能从头玩。
      const progress = store.getQuizProgress();
      // ★2026-10-14：今天已经打完任意一轮（存档里没有「没打完的那一局」）→ 这一屏就是那一轮的总结页。
      //   以前只有 roundsDone >= 2 才认这个状态，roundsDone === 1 时会被下面那段「发新题」逻辑
      //   当成"还没开始打第二局"，直接 buildQuizRound(roundsDone + 1) → 第一轮的总结页（含「再来一轮」）被顶掉。
      //   （切语言、退出再进、被系统回收后再进，走的都是这里。）
      //   依赖 finishQuizRound 结算时把 round 清成 null（抽屉要用它算剩余题数，不能改）。
      //   两轮名额已用满（roundsDone >= 2）时也一律算"已打完"：旧存档可能残留一份第 3 轮的快照
      //   （修复前那个 roundsDone >= 1 漏判缺陷留下的），这一屏必须是「今日已结束」而不是第 3 轮。
      const roundsDone = progress.roundsDone || 0;
      const finishedRound = (roundsDone >= 1 && (!progress.round || roundsDone >= 2))
        ? Math.min(roundsDone, 2) : 0;
      if (!isHub && !finishedRound && (!this.data.quiz.length || this._quizLang !== i18n.getLang() || (this._quizDay && this._quizDay !== progress.day))) {
        this._quizLang = i18n.getLang();
        // ★先看有没有「今天没打完的那一局」：有就接着打（题、第几题、得分全部还原），
        //   没有（或题对不上了）才新开一局。这是"从发现页进来不该从头开始"的关键。
        if (!this.restoreQuizRound(progress)) this.buildQuizRound(roundsDone + 1);
      }
      // 当天打完的那一轮：固定停在它的总结页（第 1 轮 = 问答簿 + 再来一轮；第 2 轮 = 今日已结束）。
      // 只有用户点「再来一轮」（restartQuiz）才开下一局；第二天由 normalizeQuizProgress 自动解锁重玩。
      if (!isHub && this.data.game === 'quiz' && finishedRound) {
        this.restoreFinishedQuizRound(finishedRound);
      }
      // 解锁进度由同一份账户数据提供给问答。
      const unlocks = store.getFruitUnlocks();
      const totalFruits = require('../../data/companion-templates').templates.length;
      this.setData({ unlockedCount: Math.min(unlocks.length, totalFruits), totalFruits, companion: store.getCompanion() });
      this.updateQuizTexts();
      // 每次进页面都按**当前语言**重算问答簿（切语言后立刻是当前语言，不再中英混排）
      this.__loadQuizLog();
      if (this.data.quizDone) this.buildCoverflow();
      // 两个新游戏各自初始化（见 lib/challenge-game.js / lib/match-game.js）。
      if (!isHub && this.data.game === 'challenge') require('./challenge-game').init(this);
      if (!isHub && this.data.game === 'match') require('./match-game').init(this);
    },
    onShareAppMessage: function () {
      return { title: i18n.t('learn_share_title'), path: isHub ? '/pages/learn/learn' : '/packageGame/pages/playground/playground?game=' + this.data.game };
    },
    openGame: function (event) {
      const game = event.currentTarget.dataset.game;
      if (['quiz', 'challenge', 'match'].includes(game)) wx.navigateTo({ url: '/packageGame/pages/playground/playground?game=' + game });
    },
    goCompanion: function () { this.setData({ unlockCelebration: null }); wx.navigateTo({ url: '/pages/companion/companion' }); },
    goSetup: function () { wx.navigateTo({ url: '/pages/mine/mine' }); },
    noop: function () {},
    // 游戏板块背景图加载失败：隐藏该图，卡片回退到纯色 #EDE6D3。
    onGameArtError: function (event) {
      const game = event.currentTarget.dataset.game;
      if (game) this.setData({ ['gameArtError.' + game]: true });
    },
    // ---- 农谚问时：水果农谚，答对解锁定制水果 ----
    updateQuizTexts: function () {
      const quiz = this.data.quiz, index = this.data.quizIndex;
      // 总结页（quizDone）恢复出来时题目数组是空的（不重新发题）：分母退回"每轮固定 6 题"。
      const size = quiz.length || (this.data.quizDone ? QUIZ_ROUND_SIZE : 0);
      if (!size) { this.setData({ quizProgress: '', quizScoreLine: '', quizProgressWidth: 0 }); return; }
      const unlocks = store.getFruitUnlocks();
      const total = require('../../data/companion-templates').templates.length;
      const unlockText = i18n.t('quiz_unlock_short', { n: Math.min(unlocks.length, total), total });
      const answered = Math.min(index + (this.data.quizAnswered ? 1 : 0), size);
      const width = Math.round(answered / size * 100);
      this.setData({
        quizProgress: i18n.t('quiz_progress', { n: index + 1, total: size, score: this.data.quizScore }) + ' · ' + unlockText,
        quizScoreLine: i18n.t('quiz_score_line', { score: this.data.quizScore, total: size }),
        quizProgressWidth: width
      });
    },
    // 10.3 / P23：结果改为扇形封面流（决策 13）——中心卡最大最亮、两侧逐级旋转缩小压暗；卡片附带伙伴 config。
    buildCoverflow: function () {
      const templates = require('../../data/companion-templates').templates;
      const unlocks = store.getFruitUnlocks();
      const owned = templates.filter(item => unlocks.indexOf(item.id) >= 0);
      const list = owned.length ? owned : [templates[0]];
      const cards = list.map(item => ({ id: item.id, name: fruitDisplayName(item.id, item.name), config: companionLib.defaultConfig(item.id) }));
      this._coverflowSwipe = null;
      this.setData({ unlockCards: cards, coverflowIndex: 0, coverflowDrag: 0, coverflowDragging: false, coverflowCount: cards.length, coverflowFaceSize: 340 }, () => this.updateCoverflowStyles());
    },
    // 层次连续化：offset 可为小数（跟手拖动时），缩放/亮度在整数档之间平滑过渡，
    // 保证「中心最大最亮 → 两侧逐级旋转缩小压暗」的同时，拖动过程也不会跳档。
    updateCoverflowStyles: function () {
      const cards = this.data.unlockCards;
      const drag = Number(this.data.coverflowDrag) || 0;
      const center = this.data.coverflowIndex + drag; // 左滑 drag>0，中心向后面的卡移动
      const coverflowCards = cards.map((card, i) => {
        const offset = i - center;
        const abs = Math.min(Math.abs(offset), 2);
        const rotate = offset * 25; // 两侧逐级旋转 ±25°
        const scale = abs <= 1 ? 1 - 0.2 * abs : 0.8 - 0.18 * (abs - 1); // 1 → 0.8 → 0.62
        const brightness = abs <= 1 ? 1 - 0.3 * abs : 0.7 - 0.25 * (abs - 1); // 100% → 70% → 45%
        return Object.assign({}, card, {
          style: 'transform: translateX(' + (offset * 62) + '%) rotateY(' + rotate + 'deg) scale(' + scale + '); filter: brightness(' + brightness + '); z-index:' + (10 - Math.round(abs)) + ';'
        });
      });
      this.setData({ coverflowCards });
    },
    // 一张卡的位移步长（px）：卡片 560rpx × 位移系数 62%，换算成 px 后用于把手势位移折算成「几张卡」。
    _coverflowUnit: function () {
      if (this._coverflowUnitPx) return this._coverflowUnitPx;
      const sys = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
      const unit = ((sys && sys.windowWidth) || 375) / 750;
      this._coverflowUnitPx = Math.max(1, 560 * 0.62 * unit);
      return this._coverflowUnitPx;
    },
    // 手指左右滑动翻卡：拖动时整组卡片跟着手指走（关闭过渡），松手后过半则翻页、否则回弹。
    coverflowTouchStart: function (event) {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      this._coverflowSwipe = { startX: touch.clientX || 0, startY: touch.clientY || 0, dx: 0, locked: false };
      this.setData({ coverflowDragging: true });
    },
    coverflowTouchMove: function (event) {
      const touch = event.touches && event.touches[0];
      const swipe = this._coverflowSwipe;
      if (!touch || !swipe) return;
      const dx = (touch.clientX || 0) - swipe.startX;
      const dy = (touch.clientY || 0) - swipe.startY;
      if (!swipe.locked) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // 纵向手势交还页面滚动，不抢事件
        if (Math.abs(dy) > Math.abs(dx)) { this._coverflowSwipe = null; this.setData({ coverflowDragging: false, coverflowDrag: 0 }); return; }
        swipe.locked = true;
      }
      swipe.dx = dx;
      this.setData({ coverflowDrag: -dx / this._coverflowUnit() }, () => this.updateCoverflowStyles());
    },
    coverflowTouchEnd: function () {
      const swipe = this._coverflowSwipe;
      this._coverflowSwipe = null;
      if (!swipe || !swipe.locked) { this.setData({ coverflowDragging: false, coverflowDrag: 0 }); return; }
      const moved = -swipe.dx / this._coverflowUnit(); // >0 表示往后翻一张
      const total = (this.data.unlockCards || []).length;
      let next = this.data.coverflowIndex;
      if (Math.abs(moved) > 0.35) next = this.data.coverflowIndex + (moved > 0 ? 1 : -1);
      next = Math.max(0, Math.min(Math.max(0, total - 1), Math.round(next)));
      this.setData({ coverflowDragging: false, coverflowDrag: 0, coverflowIndex: next }, () => this.updateCoverflowStyles());
    },
    coverflowPrev: function () {
      const next = Math.max(0, this.data.coverflowIndex - 1);
      this.setData({ coverflowIndex: next }, () => this.updateCoverflowStyles());
    },
    coverflowNext: function () {
      const total = (this.data.unlockCards || []).length;
      const next = Math.min(Math.max(0, total - 1), this.data.coverflowIndex + 1);
      this.setData({ coverflowIndex: next }, () => this.updateCoverflowStyles());
    },
    coverflowTo: function (event) {
      const index = Number(event.currentTarget.dataset.index);
      if (Number.isFinite(index)) this.setData({ coverflowIndex: index }, () => this.updateCoverflowStyles());
    },
    onResultSwipe: function (event) {
      const index = Number(event.detail && event.detail.current);
      if (Number.isFinite(index)) this.setData({ coverflowIndex: index }, () => this.updateCoverflowStyles());
    },
    copyQuizSource: function () { const item = this.data.quiz[this.data.quizIndex]; if (item && item.sourceUrl) wx.setClipboardData({ data: item.sourceUrl }); },
    answer: function (event) {
      if (this.data.quizAnswered) return;
      const correct = event.currentTarget.dataset.correct === '1';
      this.setData({ quizAnswered: true, quizCorrect: correct, quizScore: this.data.quizScore + (correct ? 1 : 0) }, () => {
      // 今日问答簿：把这一题记进"今天"的记录（按天存，跨天自然重置）
      this.__pushQuizLog();
        this.updateQuizTexts();
        this.saveQuizRound();   // 答了就存：中途退出再进来，这一题仍是"已答"且得分保留
        if (correct) this.markStarterPassed();
        if (correct) this.unlockForCurrentQuestion();
      });
    },
    // 起始水果（西瓜）答对了：只记下"这一格以后可以让给别的水果"，**不解锁、不弹窗**
    // —— 它本来就拥有（getFruitUnlocks 强制含 watermelon），答对的反馈与普通题完全一样。
    markStarterPassed: function () {
      const question = this.data.quiz[this.data.quizIndex];
      if (!question || question.fruitId !== fruitQuiz.STARTER_FRUIT) return;
      try { store.saveQuizProgress({ starterPassed: true }); } catch (error) { /* 写不进去不影响答题 */ }
    },
    unlockForCurrentQuestion: function () {
      const question = this.data.quiz[this.data.quizIndex];
      if (!question || !question.fruitId) return;
      // 起始水果永远在已解锁名单里，不走解锁分支（也就不会弹「恭喜获得」）
      if (question.fruitId === fruitQuiz.STARTER_FRUIT) return;
      try {
        const result = store.unlockFruit(question.fruitId);
        // 决策 14：仅在首次答对该水果时弹「恭喜答对」，重复答对不再弹。
        if (!result.added) return;
        const templates = require('../../data/companion-templates').templates;
        const template = templates.find(item => item.id === question.fruitId);
        this.setData({ unlockCelebration: { name: fruitDisplayName(question.fruitId, question.fruit), config: companionLib.defaultConfig(question.fruitId), templateName: template ? template.name : question.fruit, alreadyOwned: !result.added } });
      } catch (error) { /* 解锁失败不影响答题 */ }
    },
    closeUnlock: function () { this.setData({ unlockCelebration: null }); },
    goMine: function () { this.setData({ unlockCelebration: null }); wx.navigateTo({ url: '/pages/companion/companion' }); },
    // 组一轮题：未解锁的定制水果优先（出题池里已解锁的自动换成非定制水果的农谚题）
    buildQuizRound: function (round) {
      const progress = store.getQuizProgress();
      const quiz = fruitQuiz.buildRound({
        unlocked: store.getFruitUnlocks(),
        askedIds: progress.askedIds,
        askedProverbs: progress.askedProverbs,
        // 起始水果（西瓜）：默认就拥有，但题要出到答对为止（答对前每轮都带一道，见 data/fruit-quiz.js）
        starter: fruitQuiz.STARTER_FRUIT,
        starterPassed: !!progress.starterPassed
      }, i18n.getLang());
      // 题一发出就记进「已出过」，下一轮才不会重复出到同一道。
      const askedIds = quiz.map(item => item.id).filter(id => typeof id === 'string');
      const askedProverbs = quiz
        .filter(item => typeof item.id === 'string' && item.id.indexOf('proverb-') === 0)
        .map(item => item.id.slice('proverb-'.length));
      try {
        store.saveQuizProgress({
          askedIds: progress.askedIds.concat(askedIds),
          askedProverbs: progress.askedProverbs.concat(askedProverbs)
        });
      } catch (error) { /* 进度写不进去也要能继续答题 */ }
      this._quizDay = store.getQuizProgress().day; // 记住本轮出题日期，跨天后再进要重新发题
      this.setData({ quiz: quiz, quizIndex: 0, quizAnswered: false, quizCorrect: false, quizScore: 0, quizDone: false, quizRound: round }, () => this.updateQuizTexts());
    this.__loadQuizLog();
      this.saveQuizRound();
    },
    // 把「当前这一局的进度」写进存档（2026-10-08 第17 轮）：
    // 存的只有题号顺序 + 每题选项的正误位 + 打到第几题 + 得分，页面重建时能一模一样地还原。
    saveQuizRound: function () {
      const quiz = this.data.quiz || [];
      if (!quiz.length) return;
      try {
        store.saveQuizProgress({
          round: {
            no: this.data.quizRound || 1,
            ids: quiz.map(function (item) { return item.id; }),
            // 1 = 正确项被摆到了第二位（农谚题选项是随机的，不记下来就还原不成原样）
            flips: quiz.map(function (item) { return item.options && item.options[0] && item.options[0].correct ? 0 : 1; }),
            index: this.data.quizIndex || 0,
            score: this.data.quizScore || 0,
            answered: !!this.data.quizAnswered,
            correct: !!this.data.quizCorrect
          }
        });
      } catch (error) { /* 写不进去也不能影响答题 */ }
    },
    // 接着打上一局：题目按 id 重建、选项按 flips 摆回原样、恢复第几题与得分。
    // 任何一步对不上（题没了 / 已经打完 / 轮次错位）就返回 false，让调用方新开一局。
    restoreQuizRound: function (progress) {
      const snap = progress && progress.round;
      if (!snap || !snap.ids || !snap.ids.length) return false;
      if (snap.no !== (progress.roundsDone || 0) + 1) return false;
      const lang = i18n.getLang();
      const quiz = [];
      for (let i = 0; i < snap.ids.length; i++) {
        const question = fruitQuiz.findQuestion(snap.ids[i], i, lang, snap.flips[i]);
        if (!question) return false;
        quiz.push(question);
      }
      this._quizLang = lang;
      this._quizDay = progress.day;
      this.setData({
        quiz: quiz,
        quizIndex: snap.index,
        quizAnswered: snap.answered,
        quizCorrect: snap.correct,
        quizScore: snap.score,
        quizDone: false,
        quizRound: snap.no
      }, () => this.updateQuizTexts());
      this.__loadQuizLog();   // 中途退出再进来：把今天已答过的题也读回来
      return true;
    },
    // 2026-10-14：恢复到「今天刚打完的那一轮」的总结页（与 lib/match-game.js 的 restoreFinishedRound 同一套思路）。
    // 素材全部现按当前语言取：得分走 __readQuizScore、问答簿走 __loadQuizLog、水果卡走 buildCoverflow，
    // 所以切语言后这一屏的文字会跟着变、页面位置不动。
    // 题目本身在总结页里不显示（packageGame/pages/playground/playground.wxml 的 wx:if="{{!quizDone}}" 挡住了），
    // 只有「总题数」这个分母要用 → 用常量 QUIZ_ROUND_SIZE，不重新发题、不消耗题库。
    restoreFinishedQuizRound: function (round) {
      const rec = this.__readQuizScore();
      const lang = i18n.getLang();
      this._quizLang = lang;
      this._quizDay = store.getQuizProgress().day;
      this.setData({
        quiz: [],                       // 总结页不显示题目；quizScoreLine 的分母下面用常量补
        quizIndex: 0,
        quizAnswered: false,
        quizCorrect: false,
        quizScore: (rec && typeof rec.last === 'number') ? rec.last : 0,
        quizDone: true,                 // ← 停在总结页，不是下一轮
        quizRound: round
      }, () => this.updateQuizTexts());
      this.__loadQuizLog();
      return true;
    },
    // 答完一轮：记下当天完成的轮数 + 这一轮出过的题（跨天也保证题目不重复，出完自动洗牌重来）
    finishQuizRound: function (round) {
    // 记下这一轮得分（今日"最后一轮得分"用，回答"记录全是 0"的问题）
    try {
      const prev = this.__readQuizScore() || { last: 0, total: 0, rounds: 0 };
      this.__writeQuizScore({ last: this.data.quizScore || 0, total: (prev.total || 0) + (this.data.quizScore || 0), rounds: (prev.rounds || 0) + 1 });
    } catch (e) {}
      const askedIds = this.data.quiz.map(item => item.id).filter(id => typeof id === 'string');
      const askedProverbs = this.data.quiz
        .filter(item => typeof item.id === 'string' && item.id.indexOf('proverb-') === 0)
        .map(item => item.id.slice('proverb-'.length));
      const progress = store.getQuizProgress();
      try {
        store.saveQuizProgress({
          roundsDone: round,
          askedIds: progress.askedIds,
          askedProverbs: progress.askedProverbs,
          // 这一局打完了 → 清掉快照，抽屉里才不会再显示「进行中」
          round: null
        });
      } catch (error) { /* 进度写不进去不影响本轮结果展示 */ }
      this.setData({ quizDone: true, quizRound: round }, () => this.buildCoverflow());
    },
  // ── 今日问答簿（2026-10-08 新增）────────────────────────────────
  // 只记"今天"的作答：题目 / 对错 / 正解 / 出处；跨天不看（符合"只看今天玩的"）
  __pushQuizLog: function () {
    const q = (this.data.quiz || [])[this.data.quizIndex];
    if (!q) return;
    // 只存语言无关的键：id + 客观结果（题面/正解/出处一律渲染时按当前语言现取）
    const item = { id: q.id || '', correct: !!this.data.quizCorrect };
    // 今天已存的（只增不减）+ 页面当前（双保险）：身份用 id（老存档回退用文字）
    const storedItems = this.__readQuizLog();
    const merged = storedItems.map(function (x) { return Object.assign({}, x); });
    const keys = merged.map(quizLogIdentity);
    (this.data.quizLog || []).forEach(function (x) {
      const key = quizLogIdentity(x);
      if (!key || keys.indexOf(key) !== -1) return;
      keys.push(key);
      // 页面上的老式条目（无 id）原样带上：题面/正解不丢，行为与改动前一致
      merged.push({ id: x.id || '', correct: !!x.correct, text: x.text || '', kind: x.kind || '', answer: x.answer || '', source: x.source || '' });
    });
    // 本题：同题（同 id）已存在则只更新结果，否则追加（保证 12 题都在）
    const key = quizLogIdentity(item);
    const at = key ? keys.indexOf(key) : -1;
    if (at >= 0) merged[at] = Object.assign({}, merged[at], { correct: item.correct });
    else merged.push(item);
    this.__writeQuizLog(merged);
    this.__loadQuizLog();
  },
  __quizLogDay: function () { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  __readQuizScore: function () {
    try {
      let part = 'personal';
      try { part = require('../../lib/store').capturePartition(); } catch (e) { part = 'personal'; }
      const v = wx.getStorageSync('guayouji.quiz.score.v1.' + part);
      const d = new Date();
      const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (v && v.day === day) return v;
    } catch (e) {}
    return null;
  },
  __writeQuizScore: function (patch) {
    try {
      let part = 'personal';
      try { part = require('../../lib/store').capturePartition(); } catch (e) { part = 'personal'; }
      const d = new Date();
      const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const prev = this.__readQuizScore() || { last: 0, total: 0, rounds: 0 };
      wx.setStorageSync('guayouji.quiz.score.v1.' + part, {
        day: day,
        last: patch && typeof patch.last === 'number' ? patch.last : prev.last,
        total: patch && typeof patch.total === 'number' ? patch.total : prev.total,
        rounds: patch && typeof patch.rounds === 'number' ? patch.rounds : prev.rounds
      });
    } catch (e) {}
  },
  __readQuizLog: function () {
    try {
      let part = 'personal';
      try { part = require('../../lib/store').capturePartition(); } catch (e) { part = 'personal'; }
      const v = wx.getStorageSync('guayouji.quiz.log.v1.' + part);
      if (v && v.day === this.__quizLogDay() && Array.isArray(v.items)) return v.items;
    } catch (e) {}
    return [];
  },
  __writeQuizLog: function (items) {
    try {
      let part = 'personal';
      try { part = require('../../lib/store').capturePartition(); } catch (e) { part = 'personal'; }
      wx.setStorageSync('guayouji.quiz.log.v1.' + part, { day: this.__quizLogDay(), items: items });
    } catch (e) {}
  },
  __loadQuizLog: function () {
    const storedItems = this.__readQuizLog();
    // 身份用 id（老存档回退用文字）去重合并，页面上已有的条目绝不清空
    const raw = storedItems.map(function (x) { return Object.assign({}, x); });
    const keys = raw.map(quizLogIdentity);
    (this.data.quizLog || []).forEach(function (x) {
      const key = quizLogIdentity(x);
      if (!key || keys.indexOf(key) !== -1) return;
      keys.push(key);
      raw.push(Object.assign({}, x));
    });
    // 老存档里带 text 的条目，一旦这次能按 id 重算，就把落盘的文案换成只留 key（下次切语言才不会被旧文案绊住）
    const slim = raw.map(function (x) { return x && x.id ? { id: x.id, correct: !!x.correct } : Object.assign({}, x); });
    if (JSON.stringify(slim) !== JSON.stringify(storedItems)) this.__writeQuizLog(slim);
    this.setData({ quizLog: quizLogView(slim) });
  },
    nextQuiz: function () {
      const next = this.data.quizIndex + 1;
      if (next >= this.data.quiz.length) { this.finishQuizRound(this.data.quizRound || 1); return; }
      this.setData({ quizIndex: next, quizAnswered: false, quizCorrect: false }, () => { this.updateQuizTexts(); this.saveQuizRound(); });
    },
    // 「再来一轮」的逻辑层守卫：当天两局已用满 → 静默拒绝，不新开第 3 局。
    // 以前只靠 packageGame/pages/playground/playground.wxml 不渲染「再来一轮」按钮兜住，绕过界面直接调用
    // restartQuiz 照样能开出第 3 局（题照发、存档照写）。口径与 lib/match-game.js 的 matchRestart
    // （playedToday >= DAILY_LIMIT → 直接 return）一致：静默拒绝，不动任何存档、不动当前那一屏
    // （仍是「今日已结束」的总结页）；第二天由 normalizeQuizProgress 把 roundsDone 归零后自动放行。
    restartQuiz: function () {
      if ((store.getQuizProgress().roundsDone || 0) >= QUIZ_DAILY_ROUNDS) return;
      this.buildQuizRound(2);
    },
  };
};

// 给自测用：水果名按当前语言显示（解锁弹窗 / 水果卡轮播共用）
module.exports.fruitDisplayName = fruitDisplayName;
