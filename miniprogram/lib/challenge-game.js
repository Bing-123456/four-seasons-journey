'use strict';

// 农事挑战游戏逻辑：真实三圈转盘（外圈节气锁定为水果生长的节气）+ 情境出题 + 知识卡 + 每日 6 次 + 一大轮。
const QUESTIONS = require('../data/challenge-questions');
const solar = require('../data/solar-term-notes');
const media = require('./media-service');
const store = require('./store');
const i18n = require('./i18n');

const KEY = 'guayouji.challenge.v2';
const DAILY_LIMIT = 6;
// 一大轮 = 所有「水果 × 生长节气 × 困境」搭配各出现一次。16 水果共 25 个水果-节气搭配 × 6 困境 = 150。
const ROUND_TARGET = 150;

// 转盘三圈内容：最外圈 节气（含中秋，因柚子以中秋为时令）、第二圈 16 水果、最内圈 6 困境。
const FRUITS = ['青梅', '桑葚', '樱桃', '枇杷', '桃', '荔枝', '杨梅', '杏', '柿子', '枣', '秋梨', '山楂', '砂糖橘', '瓯柑', '柚子', '金桔'];
const CATEGORIES = ['农事', '古法', '储存', '食养', '管护', '灾害'];
// 外圈展示的节气（24 节气 + 中秋）；锁定的节气必须是水果真实生长的节气，绝不跨节气乱配。
const WHEEL_TERMS = (solar.TERMS || []).map(function (t) { return t.name; }).slice(0, 24).concat(['中秋']);
// 每种水果真实生长的节气（1~3 个）；转出的节气只能从这里抽。
const FRUIT_TERMS = {
  '青梅': ['小满', '惊蛰', '芒种'],
  '桑葚': ['小满', '立夏', '谷雨'],
  '樱桃': ['小满', '谷雨'],
  '枇杷': ['小寒', '小满'],
  '桃': ['惊蛰', '春分', '夏至'],
  '荔枝': ['小暑'],
  '杨梅': ['夏至'],
  '杏': ['惊蛰', '芒种'],
  '山楂': ['寒露'],
  '柿子': ['霜降'],
  '枣': ['白露'],
  '秋梨': ['秋分'],
  '瓯柑': ['冬至'],
  '砂糖橘': ['立冬'],
  '柚子': ['中秋'],
  '金桔': ['小雪']
};

const FONT_SCALE = { normal: 1, large: 1.15, xlarge: 1.32 };

// 三圈配色（每圈统一一色）：外圈节气=琥珀、中圈水果=绿、内圈困境=蓝。
const RING_COLORS = {
  term: { fill: '#FAEEDA', stroke: '#FAC775', text: '#633806', selFill: '#FAC775', selText: '#412402' },
  fruit: { fill: '#EAF3DE', stroke: '#C0DD97', text: '#27500A', selFill: '#C0DD97', selText: '#173404' },
  category: { fill: '#E6F1FB', stroke: '#B5D4F4', text: '#0C447C', selFill: '#B5D4F4', selText: '#042C53' }
};

const RESTORABLE = ['answering', 'correct', 'wrong', 'reveal', 'saved'];

function rand(n) { return Math.floor(Math.random() * n); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function partition() { try { return store.capturePartition(); } catch (e) { return 'personal'; } }
function readState() {
  const key = KEY + '.' + partition();
  try { const v = wx.getStorageSync(key); if (v && typeof v === 'object') return v; } catch (e) {}
  return null;
}
function writeState(state) {
  const key = KEY + '.' + partition();
  try { wx.setStorageSync(key, state); } catch (e) {}
}
// 每日计数（playedToday/answeredIds/todayCards/challengeState）跨天重置；seenCombos（一大轮进度）持久保留。
function loadState() {
  let state = readState();
  const t = today();
  if (!state || state.lastPlayDate !== t) {
    const keepCombos = state && Array.isArray(state.seenCombos) ? state.seenCombos : [];
    state = { lastPlayDate: t, playedToday: 0, seenCombos: keepCombos, answeredIds: [], correctTotal: 0, todayCards: [], challengeState: 'idle' };
    writeState(state);
  }
  if (!Array.isArray(state.seenCombos)) state.seenCombos = [];
  if (!Array.isArray(state.answeredIds)) state.answeredIds = [];
  if (!Array.isArray(state.todayCards)) state.todayCards = [];
  return state;
}
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function decorateQuestion(q) {
  const opts = shuffle(q.options || []);
  return Object.assign({}, q, { options: opts.map(function (o, i) { return Object.assign({}, o, { letter: String.fromCharCode(65 + i) }); }) });
}
// 精确匹配 水果+节气+困境；降级到 水果+困境（忽略节气）；再降级到 困境；最后任意。
function pickQuestion(state, fruit, category, term) {
  const pool = QUESTIONS.filter(function (q) { return state.answeredIds.indexOf(q.id) === -1; });
  const poolAll = pool.length ? pool : QUESTIONS;
  let list = poolAll.filter(function (q) { return q.fruit === fruit && q.term === term && q.category === category; });
  if (!list.length) list = poolAll.filter(function (q) { return q.fruit === fruit && q.category === category; });
  if (!list.length) list = poolAll.filter(function (q) { return q.category === category; });
  if (!list.length) list = poolAll;
  return list[Math.floor(Math.random() * list.length)] || QUESTIONS[0];
}
function fontScale() {
  try { return FONT_SCALE[store.getFontScale()] || 1; } catch (e) { return 1; }
}
// 让第 index 个扇区中心停到正上方（指针处）所需的旋转角。
function targetRotation(index, count) {
  if (index < 0 || count <= 0) return 0;
  const sweep = Math.PI * 2 / count;
  return -(index * sweep + sweep / 2);
}
// 额外多转几圈，做出"转盘"观感。
function spinOffset(count) {
  const turns = 3 + rand(3); // 3~5 圈
  return turns * Math.PI * 2 * (Math.random() < 0.5 ? 1 : 1);
}

function ensureWheel(page, cb) {
  if (page._wheelCanvas && page._wheelCtx) { cb(page._wheelCanvas, page._wheelCtx); return; }
  if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') { cb(null, null); return; }
  wx.createSelectorQuery().select('#challengeWheel').fields({ node: true, size: true }).exec(function (res) {
    if (!res || !res[0] || !res[0].node) { cb(null, null); return; }
    const canvas = res[0].node;
    const ctx = canvas.getContext('2d');
    const width = res[0].width;
    const height = res[0].height;
    const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    page._wheelCanvas = canvas;
    page._wheelCtx = ctx;
    page._wheelSize = { width: width, height: height };
    cb(canvas, ctx);
  });
}

function drawWheel(page) {
  ensureWheel(page, function (canvas, ctx) {
    if (!canvas || !ctx) return;
    const size = page._wheelSize || { width: 300, height: 300 };
    const width = size.width, height = size.height;
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    const maxR = Math.min(width, height) / 2 - 4;
    const wheel = page.data.wheel;
    const rot = page.data.wheelRot || { term: 0, fruit: 0, category: 0 };
    const scale = fontScale();
    // 顺序：外圈=节气，中圈=水果，内圈=困境；每圈独立旋转，选中扇区停到正上方。
    const rings = [
      { type: 'term', names: wheel.terms, rOut: maxR, rIn: maxR * 0.68, font: maxR * 0.072 * scale },
      { type: 'fruit', names: wheel.fruits, rOut: maxR * 0.64, rIn: maxR * 0.42, font: maxR * 0.095 * scale },
      { type: 'category', names: wheel.categories, rOut: maxR * 0.38, rIn: maxR * 0.20, font: maxR * 0.11 * scale }
    ];
    rings.forEach(function (ring) {
      const cfg = RING_COLORS[ring.type];
      const count = ring.names.length;
      const sweep = Math.PI * 2 / count;
      const ringRot = rot[ring.type] || 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringRot);
      ring.names.forEach(function (name, i) {
        const start = i * sweep - Math.PI / 2;
        const end = start + sweep;
        const selected = (ring.type === 'fruit' && name === wheel.selectedFruit) ||
                         (ring.type === 'term' && name === wheel.selectedTerm) ||
                         (ring.type === 'category' && name === wheel.selectedCategory);
        ctx.beginPath();
        ctx.arc(0, 0, ring.rOut, start, end);
        ctx.arc(0, 0, ring.rIn, end, start, true);
        ctx.closePath();
        ctx.fillStyle = selected ? cfg.selFill : cfg.fill;
        ctx.fill();
        ctx.strokeStyle = cfg.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        const mid = start + sweep / 2;
        const tr = (ring.rOut + ring.rIn) / 2;
        const tx = tr * Math.cos(mid);
        const ty = tr * Math.sin(mid);
        ctx.save();
        ctx.font = (selected ? 'bold ' : '') + Math.max(8, Math.round(ring.font)) + 'px sans-serif';
        ctx.fillStyle = selected ? cfg.selText : cfg.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (ring.type === 'term') {
          let r = mid + Math.PI / 2;
          if (r > Math.PI / 2 && r < Math.PI * 1.5) r += Math.PI;
          ctx.translate(tx, ty);
          ctx.rotate(r);
          ctx.fillText(name, 0, 0);
        } else {
          ctx.fillText(name, tx, ty);
        }
        ctx.restore();
      });
      ctx.restore();
    });
  });
}

function spinWheel(page) {
  page.setData({ wheelSpinning: true });
  const target = page._wheelRotTarget;
  const canvas = page._wheelCanvas, ctx = page._wheelCtx;
  if (!canvas || !ctx || !target) {
    setTimeout(function () { if (page._closed) return; page.setData({ wheelSpinning: false }); finishSpin(page); }, 1200);
    return;
  }
  const from = {
    term: (page.data.wheelRot && page.data.wheelRot.term) || 0,
    fruit: (page.data.wheelRot && page.data.wheelRot.fruit) || 0,
    category: (page.data.wheelRot && page.data.wheelRot.category) || 0
  };
  const dur = 1200;
  const startT = Date.now();
  const raf = canvas.requestAnimationFrame ? canvas.requestAnimationFrame.bind(canvas) : function (cb) { return setTimeout(cb, 16); };
  function frame() {
    const t = Math.min(1, (Date.now() - startT) / dur);
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const cur = {
      term: from.term + (target.term - from.term) * e,
      fruit: from.fruit + (target.fruit - from.fruit) * e,
      category: from.category + (target.category - from.category) * e
    };
    page.data.wheelRot = cur;
    drawWheel(page);
    if (t < 1) { raf(frame); }
    else {
      page.setData({ wheelSpinning: false, wheelRot: cur });
      finishSpin(page);
    }
  }
  raf(frame);
}

function finishSpin(page) {
  const q = page._challengePending;
  page._challengePending = null;
  if (q) emitQuestion(page, q, false);
}

function showLocked(page) {
  const state = loadState();
  page.setData({
    challengeLocked: true,
    challengeState: 'locked',
    challengeCards: state.todayCards || [], challengeCardRows: chunk(state.todayCards || [], 2),
    challengeLeft: 0
  });
}

function emitQuestion(page, question, spin) {
  page._challengeQuestion = question;
  page.setData({
    challenge: question,
    challengeState: 'answering',
    challengeSelected: -1,
    challengeCorrectIndex: question.options.findIndex(function (o) { return o.correct; }),
    challengeKnowledge: null,
    challengeLoadingKnowledge: false,
    challengeSaved: false,
    challengeSaving: false,
    challengeCardTitle: '📖 ' + question.term + question.fruit + question.category,
    'wheel.selectedFruit': question.fruit,
    'wheel.selectedTerm': question.term,
    'wheel.selectedCategory': question.category
  });
  drawWheel(page);
  persist(page);
  if (spin) spinWheel(page);
}

function startRound(page) {
  const st = page._challengeState;
  if (st.playedToday >= DAILY_LIMIT) { showLocked(page); return; }
  // 决策5-B：转盘结果（水果名/节气/困境）不能出现在选项文字里；循环挑一道不冲突的题。
  function pickNonOverlap() {
    const fruit = FRUITS[rand(FRUITS.length)];
    const terms = FRUIT_TERMS[fruit] || [WHEEL_TERMS[0]];
    const term = terms[rand(terms.length)];
    const category = CATEGORIES[rand(CATEGORIES.length)];
    const q = decorateQuestion(pickQuestion(st, fruit, category, term));
    const txt = q.options.map(function (o) { return o.text; }).join('');
    return { fruit: fruit, term: term, category: category, q: q, txt: txt };
  }
  let picked = null;
  for (let i = 0; i < 60 && !picked; i += 1) {
    const c = pickNonOverlap();
    if (c.txt.indexOf(c.fruit) === -1 && c.txt.indexOf(c.term) === -1 && c.txt.indexOf(c.category) === -1) picked = c;
  }
  // 降级：困境词较泛，仅排除水果名与节气词。
  if (!picked) {
    for (let i = 0; i < 60 && !picked; i += 1) {
      const c = pickNonOverlap();
      if (c.txt.indexOf(c.fruit) === -1 && c.txt.indexOf(c.term) === -1) picked = c;
    }
  }
  if (!picked) picked = pickNonOverlap();
  const fruit = picked.fruit, term = picked.term, category = picked.category, question = picked.q;
  page._challengePending = question;
  // 计算三圈目标旋转角，使选中扇区停到正上方。
  page._wheelRotTarget = {
    term: targetRotation(WHEEL_TERMS.indexOf(term), WHEEL_TERMS.length) + spinOffset(WHEEL_TERMS.length),
    fruit: targetRotation(FRUITS.indexOf(fruit), FRUITS.length) + spinOffset(FRUITS.length),
    category: targetRotation(CATEGORIES.indexOf(category), CATEGORIES.length) + spinOffset(CATEGORIES.length)
  };
  // 先转：隐藏结果与题目，转盘空格子（已设选中，停稳后高亮）。
  page.setData({
    challengeState: 'spinning',
    wheelSpinning: true,
    challenge: null,
    challengeSelected: -1,
    challengeCorrectIndex: -1,
    challengeKnowledge: null,
    challengeLoadingKnowledge: false,
    challengeSaved: false,
    challengeSaving: false,
    'wheel.selectedFruit': fruit,
    'wheel.selectedTerm': term,
    'wheel.selectedCategory': category
  });
  persist(page);
  spinWheel(page);
}

function finishToday(page) {
  const state = loadState();
  state.challengeData = null;
  state.challengeState = 'locked';
  writeState(state);
  page.setData({
    challengeLocked: true,
    challengeState: 'locked',
    challengeCards: state.todayCards || [], challengeCardRows: chunk(state.todayCards || [], 2),
    challengeLeft: 0
  });
}

// 把当前答题状态持久化到本地，保证退出页面再回来仍是当前状态（同一天）。
function persist(page) {
  const st = page._challengeState;
  if (!st) return;
  st.challengeState = page.data.challengeState;
  st.challengeData = page.data.challenge;
  st.challengeSelected = page.data.challengeSelected;
  st.challengeCorrectIndex = page.data.challengeCorrectIndex;
  st.challengeKnowledge = page.data.challengeKnowledge;
  st.challengeSaved = page.data.challengeSaved;
  st.challengeCardTitle = page.data.challengeCardTitle;
  st.wheelRot = page.data.wheelRot || { term: 0, fruit: 0, category: 0 };
  const wheel = page.data.wheel || {};
  st.wheelSelection = { fruit: wheel.selectedFruit || '', term: wheel.selectedTerm || '', category: wheel.selectedCategory || '' };
  writeState(st);
}

function comboKey(q) { return q.fruit + '|' + q.term + '|' + q.category; }

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function setCards(page, cards) {
  page.setData({ challengeCards: cards, challengeCardRows: chunk(cards, 2) });
}

function afterKnowledge(page, q, points, correct) {
  const st = page._challengeState;
  if (!st.todayCards) st.todayCards = [];
  const sig = q.id + ':' + (correct ? '1' : '0');
  const last = st.todayCards[st.todayCards.length - 1];
  if (!last || last.sig !== sig) {
    st.todayCards.push({ sig: sig, fruit: q.fruit, term: q.term, category: q.category, situation: q.situation, points: points });
    if (st.todayCards.length > DAILY_LIMIT) st.todayCards = st.todayCards.slice(-DAILY_LIMIT);
  }
  writeState(st);
  setCards(page, st.todayCards);
}

module.exports = {
  init: function (page) {
    const state = loadState();
    page._challengeState = state;
    page._challengeInited = true;
    page._elfCache = {};
    page._elfPoints = page._elfPoints || {};

    // 次数用完 → 状态 6（全屏瀑布流）
    if (state.playedToday >= DAILY_LIMIT) { showLocked(page); return; }

    // 同一天内、退出再回来：恢复到退出前的答题状态（一大轮进度 seenCombos 跨天保留）。
    if (state.challengeState && RESTORABLE.indexOf(state.challengeState) !== -1 && state.challengeData) {
      page._challengeQuestion = state.challengeData;
      const sel = state.wheelSelection || {};
      page.setData({
        challengeLocked: false,
        challengeState: state.challengeState,
        challenge: state.challengeData,
        challengeSelected: state.challengeSelected != null ? state.challengeSelected : -1,
        challengeCorrectIndex: state.challengeCorrectIndex != null ? state.challengeCorrectIndex : -1,
        challengeKnowledge: state.challengeKnowledge || null,
        challengeSaved: !!state.challengeSaved,
        challengeSaving: false,
        challengeCardTitle: state.challengeCardTitle || '',
        challengeLoadingKnowledge: false,
        challengeLeft: DAILY_LIMIT - state.playedToday,
        challengeCards: state.todayCards || [], challengeCardRows: chunk(state.todayCards || [], 2),
        wheelRot: state.wheelRot || { term: 0, fruit: 0, category: 0 },
        wheel: { fruits: FRUITS, terms: WHEEL_TERMS, categories: CATEGORIES, selectedFruit: sel.fruit || '', selectedTerm: sel.term || '', selectedCategory: sel.category || '' }
      });
      setTimeout(function () { if (!page._closed) drawWheel(page); }, 60);
      this.bind(page);
      return;
    }

    // 状态 1：转盘静止，等待点「自动转盘」。
    page.setData({
      challengeLocked: false,
      challengeState: 'idle',
      wheelRot: { term: 0, fruit: 0, category: 0 },
      wheel: { fruits: FRUITS, terms: WHEEL_TERMS, categories: CATEGORIES, selectedFruit: '', selectedTerm: '', selectedCategory: '' },
      challenge: null,
      challengeSelected: -1,
      challengeCorrectIndex: -1,
      challengeKnowledge: null,
      challengeLoadingKnowledge: false,
      challengeSaved: false,
      challengeSaving: false,
      challengeCardTitle: '',
      challengeLeft: DAILY_LIMIT - state.playedToday,
      challengeCards: state.todayCards || []
    });
    setTimeout(function () { if (!page._closed) drawWheel(page); }, 60);
    this.bind(page);
  },

  bind: function (page) {
    // 自动转盘：先转，停稳后再出结果 + 题目（节气锁定为该水果生长的节气）。
    page.challengeAutoSpin = function () {
      if (page.data.challengeLocked || page.data.challengeState === 'spinning') return;
      startRound(page);
    }.bind(page);

    // 答题：无论对错都算一次游玩；记录「水果|节气|困境」搭配到一大轮进度。
    page.challengeAnswer = function (e) {
      if (page.data.challengeState !== 'answering') return;
      const index = Number(e.currentTarget.dataset.index);
      const opt = page.data.challenge.options[index];
      if (!opt) return;
      const correct = !!opt.correct;
      const correctIndex = page.data.challenge.options.findIndex(function (o) { return o.correct; });
      const st = page._challengeState;
      const q = page.data.challenge;
      st.answeredIds.push(q.id);
      st.playedToday += 1;
      if (correct) st.correctTotal += 1;
      const key = comboKey(q);
      if (st.seenCombos.indexOf(key) === -1) st.seenCombos.push(key);
      page.setData({
        challengeState: correct ? 'correct' : 'wrong',
        challengeSelected: index,
        challengeCorrectIndex: correctIndex,
        challengeLeft: DAILY_LIMIT - st.playedToday
      });
      writeState(st);
      // 一大轮完成：所有 150 搭配都出现过一次。
      if (st.seenCombos.length >= ROUND_TARGET) {
        st.seenCombos = [];
        writeState(st);
        page.setData({ challengeRoundVisible: true });
      }
      this.showKnowledge(correct);
      persist(page);
    }.bind(page);

    // 知识卡：先显示占位，等 AI 一次性返回后定稿（不再中途变内容）。
    page.showKnowledge = function (correct) {
      const q = page._challengeQuestion;
      if (!q) return;
      if (!page._elfCache) page._elfCache = {};
      if (!page._elfPoints) page._elfPoints = {};
      const cacheKey = q.id + ':' + (correct ? '1' : '0');
      if (page._elfPoints[cacheKey]) {
        page.setData({ challengeKnowledge: { points: page._elfPoints[cacheKey] }, challengeLoadingKnowledge: false });
        return;
      }
      page.setData({ challengeKnowledge: null, challengeLoadingKnowledge: true });
      this.requestElf(q, correct, cacheKey);
    }.bind(page);

    page.requestElf = function (q, correct, cacheKey) {
      if (page._elfCache[cacheKey]) return;
      page._elfCache[cacheKey] = true;
      const finish = function (points) {
        page._elfPoints[cacheKey] = points;
        page.setData({ challengeKnowledge: { points: points }, challengeLoadingKnowledge: false });
        afterKnowledge(page, q, points, correct);
        persist(page); // 决策3：AI 返回知识卡后持久化，退出再进恢复完整知识卡页
      };
      let context;
      try { context = media.capture(); } catch (e) { context = null; }
      if (!context) { finish((q.knowledgePoints || []).slice(0, 3)); return; }
      const optText = page.data.challenge.options[page.data.challengeSelected] ? page.data.challenge.options[page.data.challengeSelected].text : '';
      media.request(context, 'POST', '/api/chat', {
        taskType: 'challenge', term: q.term, fruit: q.fruit, category: q.category, situation: q.situation,
        userChoice: optText, isCorrect: correct, context: (q.knowledgePoints || []).join('；')
      }).then(function (data) {
        if (!data || !Array.isArray(data.knowledgePoints) || !data.knowledgePoints.length) { finish((q.knowledgePoints || []).slice(0, 3)); return; }
        finish(data.knowledgePoints.slice(0, 4));
      }).catch(function () { finish((q.knowledgePoints || []).slice(0, 3)); });
    }.bind(page);

    // 保存知识卡 → 先请求相册权限，再合成图片并保存，成功后按钮变灰“已保存”。
    page.saveKnowledgeCard = function () {
      if (!page.data.challengeKnowledge || page.data.challengeState === 'saved' || page.data.challengeSaving) return;
      page.setData({ challengeSaving: true });
      requestAlbumPermission(function (granted) {
        if (!granted) { page.setData({ challengeSaving: false }); return; }
        saveAlbum(page, function (success) {
          page.setData({ challengeSaving: false });
          if (success) {
            page.setData({ challengeSaved: true, challengeState: 'saved' });
            persist(page);
          }
        });
      });
    }.bind(page);

    // 继续下一题：满 6 次则进入状态 6；否则重新转盘。
    page.challengeNext = function () {
      const st = page._challengeState;
      if (st.playedToday >= DAILY_LIMIT) { finishToday(page); return; }
      startRound(page);
    }.bind(page);

    // 关闭一大轮完成弹窗
    page.closeChallengeRound = function () { page.setData({ challengeRoundVisible: false }); };
  }
};

// 把一段文本按像素宽度换行绘制，返回绘制后的 y 坐标。
function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = String(text).split('');
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = chars[i]; y += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

// 相册权限：已授权直接过；曾被拒→引导去设置；未询问→先 authorize。callback(granted)
function requestAlbumPermission(callback) {
  wx.getSetting({
    success: function (res) {
      const auth = res.authSetting['scope.writePhotosAlbum'];
      if (auth === true) { callback(true); return; }
      if (auth === false) {
        wx.showModal({ title: '需要相册权限', content: '保存图片需要访问你的相册，请在设置中开启。', confirmText: '去设置', success: function (m) { if (m.confirm) wx.openSetting(); } });
        callback(false);
        return;
      }
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: function () { callback(true); },
        fail: function () {
          wx.showModal({ title: '需要相册权限', content: '保存图片需要访问你的相册，请在设置中开启。', confirmText: '去设置', success: function (m) { if (m.confirm) wx.openSetting(); } });
          callback(false);
        }
      });
    },
    fail: function () { callback(true); }
  });
}

// 把「转盘 + 知识卡」合成一张图保存到相册：先抓转盘 canvas，再画到离屏合成 canvas 上，叠加知识卡文字。
function saveAlbum(page, onDone) {
  const wheelCanvas = page._wheelCanvas;
  if (!wheelCanvas) { wx.showToast({ title: '暂不支持保存', icon: 'none' }); onDone(false); return; }
  const win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
  const W = win.windowWidth;
  const points = (page.data.challengeKnowledge && page.data.challengeKnowledge.points) || [];
  const title = page.data.challengeCardTitle || '';
  const shareH = Math.round(W * 2.0);
  wx.canvasToTempFilePath({
    canvas: wheelCanvas,
    success: function (wr) {
      wx.createSelectorQuery().select('#challengeShare').fields({ node: true, size: true }).exec(function (res2) {
        if (!res2 || !res2[0] || !res2[0].node) { wx.showToast({ title: '保存失败', icon: 'none' }); onDone(false); return; }
        const sc = res2[0].node;
        const sctx = sc.getContext('2d');
        const dpr = win.pixelRatio || 2;
        sc.width = W * dpr;
        sc.height = shareH * dpr;
        sctx.scale(dpr, dpr);
        sctx.fillStyle = '#F5F5F7';
        sctx.fillRect(0, 0, W, shareH);
        const wheelSize = W * 0.82;
        const wx0 = (W - wheelSize) / 2;
        const wy = W * 0.04;
        const img = sc.createImage();
        img.onload = function () {
          sctx.drawImage(img, wx0, wy, wheelSize, wheelSize);
          let y = wy + wheelSize + 28;
          sctx.fillStyle = '#234B3C';
          sctx.font = 'bold 19px sans-serif';
          sctx.textAlign = 'left';
          sctx.textBaseline = 'top';
          y = wrapText(sctx, title, 22, y, W - 44, 26);
          y += 18;
          sctx.strokeStyle = '#C0DD97';
          sctx.lineWidth = 1;
          sctx.beginPath(); sctx.moveTo(22, y); sctx.lineTo(W - 22, y); sctx.stroke();
          y += 20;
          sctx.fillStyle = '#333333';
          sctx.font = '15px sans-serif';
          points.forEach(function (p, idx) {
            if (idx > 0) y += 12;
            y = wrapText(sctx, '· ' + p, 22, y, W - 44, 24) + 16;
          });
          wx.canvasToTempFilePath({
            canvas: sc,
            success: function (sr) {
              wx.saveImageToPhotosAlbum({
                filePath: sr.tempFilePath,
                success: function () { wx.showToast({ title: '已保存到相册', icon: 'success' }); onDone(true); },
                fail: function (e) {
                  if (e && /auth|deny/i.test(e.errMsg || '')) {
                    wx.showModal({ title: '需要相册权限', content: '保存图片需要访问你的相册，请在设置中开启。', confirmText: '去设置', success: function (m) { if (m.confirm) wx.openSetting(); } });
                  } else {
                    wx.showToast({ title: '保存失败', icon: 'none' });
                  }
                  onDone(false);
                }
              });
            },
            fail: function () { wx.showToast({ title: '生成图片失败', icon: 'none' }); onDone(false); }
          });
        };
        img.onerror = function () { wx.showToast({ title: '生成图片失败', icon: 'none' }); onDone(false); };
        img.src = wr.tempFilePath;
      });
    },
    fail: function () { wx.showToast({ title: '抓取转盘失败', icon: 'none' }); onDone(false); }
  });
}
