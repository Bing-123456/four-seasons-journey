'use strict';

// 文化连连看游戏逻辑：点水果 → 点标签 → 判定配对 → 果灵气泡讲解。
// 后台 server/chat.js 的 taskType==='match' 分支已能返回 AI 点评，本文件只改前端，
// 不改动后端。
const MATCH_POOL = require('../data/match-questions');
const media = require('./media-service');
const i18n = require('./i18n');

const KEY = 'guayouji.match.v1';
const DAILY_LIMIT = 2;
const ROUND_TARGET = 18; // 知识库共 18 种水果，见过了全部即完成一大轮

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function partition() { try { return require('./store').capturePartition(); } catch (e) { return 'personal'; } }
function readState() { try { const v = wx.getStorageSync(KEY + '.' + partition()); if (v && typeof v === 'object') return v; } catch (e) {} return null; }
function writeState(state) { try { wx.setStorageSync(KEY + '.' + partition(), state); } catch (e) {} }
function loadState() {
  let state = readState();
  const t = today();
  if (!state || typeof state !== 'object') {
    state = { lastPlayDate: t, playedToday: 0, seenFruits: [], lastRound: null };
    writeState(state);
    return state;
  }
  // 跨天：只重置当日局数，保留 seenFruits（已见过的水果种类跨天累计，遍历完 18 种才在 finishRound 清）。
  if (state.lastPlayDate !== t) {
    state.lastPlayDate = t;
    state.playedToday = 0;
  }
  if (!Array.isArray(state.seenFruits)) state.seenFruits = [];
  if (typeof state.playedToday !== 'number') state.playedToday = 0;
  writeState(state);
  return state;
}
function shuffle(list) { const a = list.slice(); for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// 同步清空连线画布：用首次 drawLines 缓存的 canvas 节点直接重设尺寸（重设即清空），无需再次 query，避免异步泄漏。
function clearLines(page) {
  const node = page._matchCanvasNode;
  if (!node || !page._matchCanvasRect) return;
  const dpr = page._matchCanvasDpr || 2;
  const rect = page._matchCanvasRect;
  node.width = rect.width * dpr;
  node.height = rect.height * dpr;
  const ctx = node.getContext('2d');
  ctx.clearRect(0, 0, rect.width, rect.height);
}

module.exports = {
  init: function (page) {
    const self = this;
    const state = loadState();
    page._matchState = state;

    // 气泡打字机：逐字显示，成功从上淡入，失败从下「蹦」出，选中为静态提示。
    page.showBubble = function (type, text) {
      page._bubbleTimer && clearInterval(page._bubbleTimer);
      page._bubbleChars = String(text || '').split('');
      page._bubbleIndex = 0;
      page.setData({ matchBubble: { visible: true, type: type, text: '' } });
      page._bubbleTimer = setInterval(function () {
        page._bubbleIndex += 1;
        const shown = page._bubbleChars.slice(0, page._bubbleIndex).join('');
        page.setData({ 'matchBubble.text': shown });
        if (page._bubbleIndex >= page._bubbleChars.length) clearInterval(page._bubbleTimer);
      }, 60);
    };

    // Canvas 真连线：从水果卡右侧画一条贝塞尔曲线到标签卡左侧，每次重画所有历史连线。
    page.drawLines = function () {
      const matched = page.data.matchMatched;
      const pairIds = Object.keys(matched).filter(id => matched[id]);
      const query = wx.createSelectorQuery();
      query.select('#matchLines').fields({ node: true, size: true, rect: true });
      pairIds.forEach(function (id) {
        query.select('#match-fruit-' + id).boundingClientRect();
        query.select('#match-label-' + id).boundingClientRect();
      });
      query.exec(function (res) {
        if (!res || !res[0] || !res[0].node) return;
        const canvasNode = res[0].node;
        const rect = res[0];
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        canvasNode.width = rect.width * dpr;
        canvasNode.height = rect.height * dpr;
        const ctx = canvasNode.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);
        if (!pairIds.length) return;
        ctx.strokeStyle = '#3C9D6E';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        pairIds.forEach(function (id, i) {
          const fruitRect = res[1 + i * 2];
          const labelRect = res[2 + i * 2];
          if (!fruitRect || !labelRect) return;
          const x1 = fruitRect.right - rect.left;
          const y1 = fruitRect.top - rect.top + fruitRect.height / 2;
          const x2 = labelRect.left - rect.left;
          const y2 = labelRect.top - rect.top + labelRect.height / 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1 + 28, y1, x2 - 28, y2, x2, y2);
          ctx.stroke();
        });
        page._matchCanvasNode = canvasNode;
        page._matchCanvasDpr = dpr;
        page._matchCanvasRect = rect;
      });
    };

    page.matchTapFruit = function (e) {
      const id = e.currentTarget.dataset.id;
      if (page.data.matchMatched[id]) return;
      page.setData({ matchSelectedFruit: id });
      const pair = page._round.find(function (p) { return p.id === id; });
      page.showBubble('select', '「' + (pair ? pair.fruit : '') + '」已选中，再点一个文化标签。');
      this.tryMatch();
    }.bind(page);

    page.matchTapLabel = function (e) {
      const id = e.currentTarget.dataset.id;
      if (page.data.matchMatched[id]) return;
      page.setData({ matchSelectedLabel: id });
      const pair = page._round.find(function (p) { return p.id === id; });
      page.showBubble('select', '「' + (pair ? pair.label : '') + '」已选中，再点一个水果。');
      this.tryMatch();
    }.bind(page);

    // 判定：选中水果 + 标签后，比对 pair id 是否一致。
    page.tryMatch = function () {
      const fruit = page.data.matchSelectedFruit, label = page.data.matchSelectedLabel;
      if (!fruit || !label) return;
      const pair = page._round.find(function (p) { return p.id === fruit; });
      const correct = pair && label === pair.id;
      if (correct) {
        const matched = Object.assign({}, page.data.matchMatched);
        matched[fruit] = true;
        if (!page._matchedPairs) page._matchedPairs = [];
        page._matchedPairs.push({ id: pair.id, fruit: pair.fruit, label: pair.label, source: pair.source, knowledge: null });
        const learned = (page.data.matchLearned || []).concat([pair.fruit + ' 与 ' + pair.label]);
        page.setData({ matchMatched: matched, matchSelectedFruit: '', matchSelectedLabel: '', matchLearned: learned });
        const st = page._matchState;
        // 决策1-A：每成功配对一对即持久化当前局，退出后重进可续玩（选中态不恢复）。
        st.currentRound = {
          fruits: page.data.matchFruits,
          labels: page.data.matchLabels,
          matched: page.data.matchMatched,
          // 决策1-A：必须存完整4对题目，否则重进后 page._round 只剩已配对项，未配对项会变成"无答案孤儿"（怎么点都不对）。
          round: (page._round || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, category: p.category }; }),
          pairs: (page._matchedPairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, knowledge: p.knowledge || null }; })
        };
        if (st.seenFruits.indexOf(pair.fruit) === -1) st.seenFruits.push(pair.fruit);
        this.showKnowledge(pair, true);
        setTimeout(function () { page.drawLines(); }, 60);
        if (Object.keys(matched).length >= 4) this.finishRound();
      } else {
        page.setData({ matchWrong: { fruit: fruit, label: label } });
        const labelPair = page._round.find(function (p) { return p.id === label; });
        page.showBubble('fail', '这个标签说的是「' + (labelPair ? labelPair.fruit : '某水果') + '」的线索，再试一次。');
        setTimeout(function () { page.setData({ matchWrong: null, matchSelectedFruit: '', matchSelectedLabel: '' }); }, 600);
      }
    }.bind(page);

    page.showKnowledge = function (pair, correct) {
      // 只解释一次：先显示「正在讲解」，等知识库(AI)返回后显示唯一一段讲解；AI 无返回才用本地原文兜底一次。
      page.showBubble('success', '果灵正在讲解…');
      const cacheKey = pair.id;
      if (page._matchElfCache && page._matchElfCache[cacheKey]) {
        page.showBubble('success', page._matchElfCache[cacheKey]);
        return;
      }
      if (!page._matchElfCache) page._matchElfCache = {};
      let context;
      try { context = media.capture(); } catch (e) { context = null; }
      function deliver(text) {
        page.showBubble('success', text);
        page._matchElfCache[cacheKey] = text;
        // 回写进已配对记录，结算时合并成大泡泡。
        const entry = (page._matchedPairs || []).find(function (p) { return p.id === pair.id; });
        if (entry) entry.knowledge = text;
        // 同步持久化到当前局，退出重进后结算讲解仍完整。
        const cr = page._matchState && page._matchState.currentRound;
        if (cr && cr.pairs) {
          const pe = cr.pairs.find(function (p) { return p.id === pair.id; });
          if (pe) { pe.knowledge = text; writeState(page._matchState); }
        }
      }
      const fallback = '「' + pair.label + '」说的是' + pair.fruit + '：' + pair.source + '。';
      if (!context) { deliver(fallback); return; }
      media.request(context, 'POST', '/api/chat', {
        taskType: 'match', fruit: pair.fruit, category: pair.category, label: pair.label, isCorrect: true, context: pair.source
      }).then(function (data) {
        const text = (data && data.knowledge && data.knowledge.length) ? data.knowledge : fallback;
        deliver(text);
      }).catch(function () { deliver(fallback); });
    };

    page.finishRound = function () {
      const st = page._matchState;
      st.playedToday += 1;
      // 持久化最后这局，杀进程重进也能固定显示结束页（4 张配对成功的卡 + 底部讲解）。
      st.lastRound = {
        fruits: page.data.matchFruits,
        labels: page.data.matchLabels,
        matched: page.data.matchMatched
      };
      delete st.currentRound; // 决策1-A：本局结束，清除续玩存档
      // 结算：不再生成 4 对合并长文；保留最后一对的果灵讲解（finishRound 不清空 matchBubble）。
      page.setData({
        matchLeft: DAILY_LIMIT - st.playedToday,
        matchDone: true
      });
      writeState(st);
      if (st.seenFruits.length >= ROUND_TARGET) { page.setData({ matchRoundVisible: true }); st.seenFruits = []; writeState(st); }
      // 每日结束不再弹白框，改为结束页按钮下方文字（见 playground.wxml）。
    };

      page.matchRestart = function () {
        const st = page._matchState;
        if (st.playedToday >= DAILY_LIMIT) { return; }
        delete st.currentRound; writeState(st); // 决策1-A：重开即放弃续玩存档
        self.buildRound(page, st);
      }.bind(page);

    page.closeMatchLimit = function () { page.setData({ matchLimitVisible: false }); };
    page.closeMatchRound = function () { page.setData({ matchRoundVisible: false }); };

    // 今日已玩满 2 局：不再发新题，直接恢复/显示结束页（杀进程重进也固定停在最后结算页）。
    if (state.playedToday >= DAILY_LIMIT) {
      const lr = state.lastRound || null;
      page.setData({
        matchLeft: 0,
        matchDailyLimit: DAILY_LIMIT,
        matchDone: true,
        matchFruits: lr ? lr.fruits : [],
        matchLabels: lr ? lr.labels : [],
        matchMatched: lr ? lr.matched : {},
        matchBubble: { visible: false, type: '', text: '' }
      });
      // 需求3：每日结束页保留最后一局的连线（棋盘卡片仍在渲染，重绘连线即可）。
      setTimeout(function () { if (!page._closed) page.drawLines(); }, 80);
      return;
    }
      // 决策1-A：若当前局未玩完（已配对但未满 4 对），重进时恢复到已完成配对，继续玩。
      if (state.currentRound && Object.keys(state.currentRound.matched || {}).length < 4) {
        this.restoreRound(page, state);
      } else {
        this.buildRound(page, state);
      }
  },

  restoreRound: function (page, state) {
    // 决策1-A：恢复到未完成的当前局（已完成配对保留，选中态不恢复），继续玩。
    const cr = state.currentRound;
    page._round = (cr.round || cr.pairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, category: p.category }; });
    page._matchedPairs = (cr.pairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, knowledge: p.knowledge || null }; });
    page.setData({
      matchFruits: cr.fruits, matchLabels: cr.labels, matchMatched: cr.matched || {},
      matchSelectedFruit: '', matchSelectedLabel: '', matchWrong: null,
      matchDone: false, matchLearned: (cr.pairs || []).map(function (p) { return p.fruit + ' 与 ' + p.label; }),
      matchLeft: DAILY_LIMIT - state.playedToday, matchDailyLimit: DAILY_LIMIT,
      matchBubble: { visible: false, type: '', text: '' }
    });
    setTimeout(function () { if (!page._closed) page.drawLines(); }, 60);
  },

  buildRound: function (page, state) {
    // 每轮 4 对：抽「本轮/历史未见过的水果种类」4 种不同水果（按 18 种去重，同水果多标签随机取其一）；
    // seenFruits 跨天累计，遍历完 18 种后由 finishRound 重置。不足 4 种新水果时，先取完剩余新水果，
    // 再重置已见列表并从全部水果补满 4 对（允许再出之前出过的题目）。
    const fruitNames = [];
    MATCH_POOL.forEach(function (p) { if (fruitNames.indexOf(p.fruit) === -1) fruitNames.push(p.fruit); });
    const availFruits = fruitNames.filter(function (f) { return state.seenFruits.indexOf(f) === -1; });
    let chosenFruits;
    if (availFruits.length >= 4) {
      chosenFruits = shuffle(availFruits).slice(0, 4);
    } else {
      chosenFruits = availFruits.slice();
      state.seenFruits = [];
      const freshFruits = shuffle(fruitNames.filter(function (f) { return chosenFruits.indexOf(f) === -1; }));
      chosenFruits = chosenFruits.concat(freshFruits.slice(0, 4 - chosenFruits.length));
      writeState(state);
    }
    // 每种水果随机取一个配对条目，避免同水果多标签在同一局出现两次。
    const picked = chosenFruits.map(function (f) {
      const entries = MATCH_POOL.filter(function (p) { return p.fruit === f; });
      return entries[Math.floor(Math.random() * entries.length)];
    });
    const fruits = picked.map(function (p) { return { id: p.id, name: p.fruit }; });
    const labels = shuffle(picked).map(function (p) { return { id: p.id, label: p.label }; });
    page._round = picked;
    page._matchedPairs = [];
    page.setData({
      matchFruits: fruits, matchLabels: labels, matchMatched: {}, matchSelectedFruit: '', matchSelectedLabel: '',
      matchWrong: null, matchDone: false, matchLearned: [], matchDoneSummary: '', matchLeft: DAILY_LIMIT - state.playedToday,
      matchDailyLimit: DAILY_LIMIT, matchBubble: { visible: false, type: '', text: '' }
    });
    // 开新局时同步清空连线画布（覆盖「再来一局」与切后台回来两种场景），避免旧线残留。
    clearLines(page);
  }
};
