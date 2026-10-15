'use strict';

// 农事转盘游戏逻辑：真实三圈转盘（外圈节气锁定为水果生长的节气）+ 情境出题 + 知识卡 + 每日 6 次 + 一大轮。
const QUESTIONS = require('../data/challenge-questions');
const solar = require('../../data/solar-term-notes');
const media = require('../../lib/media-service');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const fruitCulture = require('../../data/fruit-culture');
const explanations = require('../data/challenge-explanations');
// 英文版知识库（10.11 新增，与中文侧同一批 id）。文件缺失时也不影响中文模式与英文界面的其它部分。
let explanationsEn = null;
try { explanationsEn = require('../data/challenge-explanations-en'); } catch (e) { explanationsEn = null; }
const fruitNameEn = require('../../lib/fruit-name-en');
const termNameEn = require('../../lib/term-name-en');

// —— 转盘/卡片的英文名（2026-10-11 用户要求：English 模式下这个游戏要全英文）——
// 注意：**只影响画出来的字**（canvas 上的圈名、卡片标题），转盘状态与判定仍然用中文原名，
// 这样持久化的选中态、题目匹配逻辑一个字都不用改，也不会因切换语言而错乱。
// 节气口径：与项目已有英文语料一致，用**拼音**（Jingzhe / Shuangjiang…），改口径只需改 term-name-en.js。
const CATEGORY_KEYS = { '农事': 'challenge_cat_farming', '古法': 'challenge_cat_traditional', '储存': 'challenge_cat_storage', '食养': 'challenge_cat_health', '管护': 'challenge_cat_care', '灾害': 'challenge_cat_disaster' };
function termLabel(name) {
  const key = String(name || '');
  if (!key) return '';
  const lang = i18n.getLang() === 'en' ? 'en' : 'zh';
  const hit = (solar.TERMS || []).find(function (t) { return t.name === key; });
  return termNameEn.termEn(hit ? hit.name : key, lang);
}
function categoryLabel(name) { return i18n.t(CATEGORY_KEYS[name] || name); }

// 转盘专用短名（2026-10-11，用户同意）：转盘一格放不下官方英文长名（实测中圈最长名要 0.78R，
// 而一格切向只有 ≈0.21R），所以**只在转盘上**用短名；果详情/搜索页仍用官方英文名。
const WHEEL_SHORT_EN = {
  '砂糖橘': 'Tangerine', '秋梨': 'Pear', '猕猴桃': 'Kiwi',
  '农事': 'Farming', '古法': 'Methods', '储存': 'Storage', '食养': 'Health', '管护': 'Care', '灾害': 'Hazards'
};

// 知识卡标题（当场卡片与「今日 6 张卡」共用）：按当前语言由原始字段生成，
// 不再存成品字符串（否则中文时生成的卡切到英文还是中文）。
function cardTitle(term, fruit, category) {
  return termLabel(term) + ' · ' + fruitNameEn.nameEn(fruit) + ' · ' + categoryLabel(category);
}
// 正解文案（字母 + 文字都取自题库里 correct: true 的那一项，不编造）。
// 注意：题库里的选项**没有 letter**（字母是每次显示时洗牌后临时加的），所以这里按选项序号补，
// 保证"重算出来的卡片"也有稳定的字母。
function answerTextOf(q) {
  const options = (q && q.options) || [];
  const idx = options.findIndex(function (o) { return o && o.correct; });
  if (idx < 0) return '';
  const ans = options[idx];
  const letter = ans.letter || String.fromCharCode(65 + idx);
  return letter + '. ' + (ans.text || '');
}
// 当场知识卡标题：优先用存档里的**题目原始字段**按当前语言重算（这样中文时生成的卡切到英文也变英文）；
// 老存档没有 challengeData 时才退回当时存下来的那串标题。
function stateCardTitle(state) {
  const cd = state && state.challengeData;
  if (cd && cd.term && cd.fruit && cd.category) return '📖 ' + cardTitle(cd.term, cd.fruit, cd.category);
  return (state && state.challengeCardTitle) || '';
}
function wheelDisplayName(ringType, name) {
  const key = String(name || '');
  if (i18n.getLang() !== 'en') return key;
  if (WHEEL_SHORT_EN[key]) return WHEEL_SHORT_EN[key];
  if (ringType === 'fruit') return fruitNameEn.nameEn(key);
  if (ringType === 'term') return termLabel(key);
  return categoryLabel(key);
}

// 海报排版常量（用户 2026-10-09 第 25 轮定稿：变体乙 = 高度贴合内容 + 正文 17px + 标签更大）
const POSTER = { title: 21, titleLine: 30, gapAfterTitle: 28, body: 17, label: 21, line: 26, pointGap: 14, pad: 22 };

// 题库里的水果名与文化库的名字偶有出入（例：题库写「桃」，文化库叫「桃子」）。
// 之前直接按名查，查不到就**整块材料没有送出去**（18 道桃题都受影响）。这里补别名。
const FRUIT_ALIAS = { 桃: '桃子' };
function fruitEntryFor(name) {
  const tries = [FRUIT_ALIAS[name], name, name + '子', name + '果'].filter(Boolean);
  for (let i = 0; i < tries.length; i++) {
    try {
      const brief = fruitCulture.findFruitByName(tries[i]);
      const full = brief && brief.fullId ? fruitCulture.findFruit(brief.fullId) : null;
      if (full) return full;
    } catch (e) { /* 换下一个名字再试 */ }
  }
  return null;
}

// 知识卡内容优先级（2026-10-09 第24 轮）：知识库写好的「原因/由来」→ AI → 题目自带的短事实
// 10.11：英文模式改用 challenge-explanations-en.js（同一批 id），标签也跟着语言走；
// 中文侧输出与以前逐字一致（标签仍是「原因：」「由来：」）。
function knowledgePointsFromKb(question) {
  if (!question) return null;
  const en = i18n.getLang() === 'en';
  const book = en ? explanationsEn : explanations;
  if (!book) return null;
  const entry = book[question.id];
  if (!entry) return null;
  const out = [];
  if (entry.cause) out.push(i18n.t('challenge_kb_cause') + entry.cause);
  if (entry.origin) out.push(i18n.t('challenge_kb_origin') + entry.origin);
  return out.length ? out : null;
}

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
  // 2026-10-11：开局时按当前语言现挑题库（模块加载时挑一次会"冻结"，切换语言后题目不跟着换）
  const bank = typeof QUESTIONS.current === 'function' ? QUESTIONS.current() : QUESTIONS;
  const pool = bank.filter(function (q) { return state.answeredIds.indexOf(q.id) === -1; });
  const poolAll = pool.length ? pool : bank;
  let list = poolAll.filter(function (q) { return q.fruit === fruit && q.term === term && q.category === category; });
  if (!list.length) list = poolAll.filter(function (q) { return q.fruit === fruit && q.category === category; });
  if (!list.length) list = poolAll.filter(function (q) { return q.category === category; });
  if (!list.length) list = poolAll;
  return list[Math.floor(Math.random() * list.length)] || bank[0];
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
  // 尺寸取到 0 时不缓存（缓存了会永久空白），下次重画重新查一次
  const cached = page._wheelSize && page._wheelSize.width > 0 && page._wheelSize.height > 0;
  if (page._wheelCanvas && page._wheelCtx && cached) { cb(page._wheelCanvas, page._wheelCtx); return; }
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

// 估算字宽（单位 em）：CJK 按 1.0em/字，其余按 0.6em/字。只在 canvas 的 measureText 不可用时兜底。
function emOf(label, measure) {
  const text = String(label == null ? '' : label);
  if (measure) {
    try {
      const m = measure(text);
      if (m && typeof m.width === 'number' && isFinite(m.width) && m.width > 0) return m.width / 100;
    } catch (e) { /* 落到下面的估算 */ }
  }
  let em = 0;
  for (let i = 0; i < text.length; i += 1) em += text.charCodeAt(i) > 0x2e80 ? 1 : 0.6;
  return Math.max(0.5, em);
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
    // 2026-10-11 修复「English 下三圈文字互相压」：三圈**都沿半径排字**（横排必然压：
    // 中圈一格切向只有 ≈0.21R，而 'Sugar tangerine' 横排要 ≈0.78R），并按各圈**最长名字**
    // 自动缩字号（可用长度 = 该圈径向宽度 × 0.92），保证不出扇区、不互相压。
    const ringDefs = [
      { type: 'term', names: wheel.terms, rOut: maxR, rIn: maxR * 0.72, base: maxR * 0.072 },
      { type: 'fruit', names: wheel.fruits, rOut: maxR * 0.68, rIn: maxR * 0.41, base: maxR * 0.095 },
      { type: 'category', names: wheel.categories, rOut: maxR * 0.39, rIn: maxR * 0.19, base: maxR * 0.11 }
    ];
    const rings = ringDefs.map(function (def) {
      const labels = (def.names || []).map(function (name) { return String(wheelDisplayName(def.type, name) || ''); });
      // 量字宽：设备上万一 measureText 不可用/返回异常/抛错，就用估算兜底。
      // 注意顺序 —— 这一步原来放在画扇区之前，一旦抛错整块转盘会全空白（2026-10-11 实机踩到过）。
      let measure = null;
      try {
        ctx.font = '100px sans-serif';
        const probe = ctx.measureText('M');
        if (probe && typeof probe.width === 'number') measure = function (text) { return ctx.measureText(text); };
      } catch (e) { measure = null; }
      let maxEm = 0.1;
      labels.forEach(function (label) { const em = emOf(label, measure); if (em > maxEm) maxEm = em; });
      const avail = (def.rOut - def.rIn) * 0.92;
      return { type: def.type, names: def.names, labels: labels, rOut: def.rOut, rIn: def.rIn, font: Math.max(6, Math.min(def.base * scale, avail / maxEm)) };
    });
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
        const shown = ring.labels[i] || '';   // 画出来的字按当前语言（状态仍用中文原名）
        ctx.save();
        // 单个标签画不出来（字号/字体异常等）也不许影响其它标签与扇区
        try {
          ctx.font = (selected ? 'bold ' : '') + Math.max(6, Math.round(ring.font)) + 'px sans-serif';
          ctx.fillStyle = selected ? cfg.selText : cfg.text;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // 三圈一律沿半径排字：左半圈翻转，避免倒字
          let r = mid + Math.PI / 2;
          if (r > Math.PI / 2 && r < Math.PI * 1.5) r += Math.PI;
          ctx.translate(tx, ty);
          ctx.rotate(r);
          ctx.fillText(shown, 0, 0);
        } catch (e) { /* 忽略：宁可少一个字，也不能让整块转盘空白 */ }
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
    challengeCards: state.todayCards || [], challengeCardRows: chunk(cardsWithView(state.todayCards || []), 2),
    challengeLeft: 0
  });
}

// 题面「提问引导语」（2026-10-09 用户要求）：有些题面只是陈述情境（如"小满一阵风雨，青梅幼果直往地上掉。"），
// 没告诉用户要干什么 —— 这类题在题面**紧跟其后**补一行引导语；本身已经是问句的题不加（避免两句问句打架）。
// 知识卡的"参考材料"（2026-10-09 第23 轮）：以前只把题目自带的 3 句短事实当成"知识库段落"送给 AI，
// AI 手里只有这些，只能把它们换句话写 —— 于是卡片看着就是"复述选项"。
// 现在把真材料一起送过去：
//   ① 题目情境事实（原样保留，说明这道题在问什么）
//   ② 该节气的札记（气候物候，讲"原因"要用）
//   ③ 这道题那个水果的六维文化条目（典籍源流、古法、民俗、食养，讲"由来"要用）
function knowledgeContext(q) {
  const parts = [];
  const facts = (q.knowledgePoints || []).slice(0, 3);
  if (facts.length) parts.push('【题目情境事实】' + facts.join('；'));
  try {
    const term = solar.byName(q.term);
    if (term) parts.push('【' + q.term + '节气札记】' + (term.headline ? term.headline + '。' : '') + (term.text || ''));
  } catch (e) { /* 拿不到节气材料就不放 */ }
  try {
    const full = fruitEntryFor(q.fruit);
    if (full && Array.isArray(full.categories)) {
      const lines = full.categories.map(function (c) { return String((c && (c.detail || c.text)) || '').trim(); }).filter(Boolean);
      if (lines.length) parts.push('【' + q.fruit + '文化库原文】' + lines.join(' '));
    }
  } catch (e) { /* 拿不到文化库就不放 */ }
  return parts.join('\n');
}

function promptFor(question) {
  const situation = String((question && question.situation) || '');
  if (!situation) return '';
  return /[？?]/.test(situation) ? '' : i18n.t('challenge_prompt');
}

function emitQuestion(page, question, spin) {
  page._challengeQuestion = question;
  page.setData({
    challenge: Object.assign({}, question, { prompt: promptFor(question) }),
    challengeState: 'answering',
    challengeSelected: -1,
    challengeCorrectIndex: question.options.findIndex(function (o) { return o.correct; }),
    challengeKnowledge: null,
    challengeLoadingKnowledge: false,
    challengeSaved: false,
    challengeSaving: false,
    challengeCardTitle: '📖 ' + cardTitle(question.term, question.fruit, question.category),
    // 转盘下方那行「节气 · 水果 · 困境」（playground.wxml 的 .wheel-summary）也按语言生成
    wheelSummary: cardTitle(question.term, question.fruit, question.category),
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
    wheelSummary: cardTitle(term, fruit, category),
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
    challengeCards: state.todayCards || [], challengeCardRows: chunk(cardsWithView(state.todayCards || []), 2),
    challengeLeft: 0
  });
}

// 把当前答题状态持久化到本地，保证退出页面再回来仍是当前状态（同一天）。
function persist(page) {
  const st = page._challengeState;
  if (!st) return;
  st.challengeState = page.data.challengeState;
  st.challengeData = storedQuestionFor(page.data.challenge);
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

// 知识卡的两条是「原因：…」「由来：…」这种"标签+正文"的字符串。
// 用户 2026-10-09 第 25 轮要求：**标签要比正文更大**，所以把标签单独拆出来给模板渲染：
//   { label: '原因：', text: '…' }  → 模板里 <text class="challenge-k-label">{{label}}</text>{{text}}
function splitPoint(point) {
  const s = String(point == null ? '' : point);
  // 中文知识卡是「原因：…」，英文模式是「Reason: …」——两种都要能拆（标签单独渲染，用户要求标签比正文大）。
  // 半角冒号只在「行首是英文字母标签」时才当分隔符，避免把中文里的比例（如 1:2）误拆。
  const ascii = /^([A-Za-z][A-Za-z ]{0,11}):\s*/.exec(s);
  if (ascii) return { label: ascii[1] + ': ', text: s.slice(ascii[0].length) };
  const i = s.indexOf('：');
  if (i <= 0) return { label: '', text: s };
  return { label: s.slice(0, i + 1), text: s.slice(i + 1) };
}
function pointsView(points) { return (points || []).map(splitPoint); }
// 给知识卡对象补一份"可渲染视图"，points（字符串数组）保持原样（海报/持久化还在用）
function withPointsView(kb) {
  if (!kb || !Array.isArray(kb.points)) return kb;
  return { points: kb.points, pointsView: pointsView(kb.points) };
}
// 今日知识卡（2 列网格）：**按题目 id 用当前语言的题库与知识库重算**标题/题面/正解/原因由来，
// 取不到才退回存档值 —— 中文看中文、英文看英文，切换语言后旧卡片也跟着换。
function cardsWithView(cards) {
  const bank = (typeof QUESTIONS.current === 'function' ? QUESTIONS.current() : QUESTIONS) || [];
  const byId = {};
  bank.forEach(function (q) { byId[q.id] = q; });
  return (cards || []).map(function (card) {
    const c = card || {};
    const id = String(c.sig || '').split(':')[0];
    const q = id ? byId[id] : null;
    const term = (q && q.term) || c.term || '';
    const fruit = (q && q.fruit) || c.fruit || '';
    const category = (q && q.category) || c.category || '';
    const points = (q && knowledgePointsFromKb(q)) || c.points || [];
    return Object.assign({}, c, {
      term: term, fruit: fruit, category: category,
      title: cardTitle(term, fruit, category),
      situation: (q && q.situation) || c.situation || '',
      answer: q ? answerTextOf(q) : (c.answer || ''),
      points: points,
      pointsView: pointsView(points)
    });
  });
}
function setCards(page, cards) {
  page.setData({ challengeCards: cards, challengeCardRows: chunk(cardsWithView(cards), 2) });
}
// 存档里的「当场那道题」只留 id + 显示顺序 + 判定所需的字母/正误，
// 题面与选项文字一律不落盘 —— 恢复时按当前语言现取（否则中文时存下的题切英文后题面还是中文）。
function storedQuestionFor(q) {
  if (!q || !q.id) return q || null;
  const options = (q.options || []).map(function (o) {
    const opt = o || {};
    const out = { correct: !!opt.correct };
    if (opt.letter) out.letter = opt.letter;
    return out;
  });
  return { id: q.id, term: q.term || '', fruit: q.fruit || '', category: q.category || '', options: options };
}
// 按 id 从当前语言的题库重取题面与选项（复用 cardsWithView 的套路）：
// 选项按**下标**一一对应替换文字，字母位与正误标记保持存档原样，判分逻辑零影响。
// 老存档没有 id、或题库里已无此题 → 原样返回存档值，不白屏、不崩。
function localizeStoredQuestion(stored) {
  if (!stored || !stored.id) return stored;
  const bank = (typeof QUESTIONS.current === 'function' ? QUESTIONS.current() : QUESTIONS) || [];
  const fresh = bank.find(function (q) { return q && q.id === stored.id; });
  if (!fresh) return stored;
  const freshOptions = fresh.options || [];
  const options = (stored.options || []).map(function (o, i) {
    const opt = o || {};
    const text = (freshOptions[i] && freshOptions[i].text) || opt.text;
    return text != null ? Object.assign({}, opt, { text: text }) : opt;
  });
  return Object.assign({}, stored, {
    term: fresh.term || stored.term,
    fruit: fresh.fruit || stored.fruit,
    category: fresh.category || stored.category,
    situation: fresh.situation || stored.situation,
    options: options,
    knowledgePoints: fresh.knowledgePoints || stored.knowledgePoints
  });
}

function afterKnowledge(page, q, points, correct) {
  const st = page._challengeState;
  if (!st.todayCards) st.todayCards = [];
  const sig = q.id + ':' + (correct ? '1' : '0');
  const last = st.todayCards[st.todayCards.length - 1];
  if (!last || last.sig !== sig) {
    // 知识卡加「正解」：字母 + 文字都取自题库里 correct: true 的那一项（不编造）
    st.todayCards.push({ sig: sig, fruit: q.fruit, term: q.term, category: q.category, situation: q.situation, points: points, answer: answerTextOf(q) });
    if (st.todayCards.length > DAILY_LIMIT) st.todayCards = st.todayCards.slice(-DAILY_LIMIT);
  }
  writeState(st);
  setCards(page, st.todayCards);
}

module.exports = {
  // 给自测用：拼一道题的"知识卡参考材料"（真材料：情境事实 + 节气札记 + 水果六维文化库）
  contextFor: knowledgeContext,
  // 给自测用：取这道题知识库里写好的「原因 / 由来」（没有则 null）
  knowledgePointsFor: knowledgePointsFromKb,
  // 给自测用：知识卡标题 / 今日 6 张卡的重算视图 / 转盘上的名字 / 正解文案
  cardTitleFor: cardTitle,
  cardsFor: cardsWithView,
  wheelLabelFor: wheelDisplayName,
  answerTextFor: answerTextOf,
  // 给自测用：真画一次转盘（传一个假 page + 假 2d ctx，用来复现/回归"转盘不显示"这类问题）
  drawWheelFor: drawWheel,
  // 给自测用：存档里的当场那道题「只存 id」与「按当前语言重取题面/选项」，以及落盘入口
  storedQuestionFor: storedQuestionFor,
  localizeStoredQuestion: localizeStoredQuestion,
  persist: persist,
  // 给自测用：标签/正文拆分（「原因：」「由来：」单独渲染成更大字号）与海报高度计算
  splitPoint: splitPoint,
  pointsView: pointsView,
  posterHeight: posterHeight,
  POSTER: POSTER,
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
      // 老存档里存的是「当时中文的整题」→ 这里按题目 id 用当前语言的题库重新取题面与选项。
      const restored = localizeStoredQuestion(state.challengeData);
      page._challengeQuestion = restored;
      const sel = state.wheelSelection || {};
      page.setData({
        challengeLocked: false,
        challengeState: state.challengeState,
        challenge: Object.assign({}, restored, { prompt: promptFor(restored) }),
        challengeSelected: state.challengeSelected != null ? state.challengeSelected : -1,
        challengeCorrectIndex: state.challengeCorrectIndex != null ? state.challengeCorrectIndex : -1,
        challengeKnowledge: withPointsView(state.challengeKnowledge) || null,
        challengeSaved: !!state.challengeSaved,
        challengeSaving: false,
        challengeCardTitle: stateCardTitle(state),
        challengeLoadingKnowledge: false,
        challengeLeft: DAILY_LIMIT - state.playedToday,
        challengeCards: state.todayCards || [], challengeCardRows: chunk(cardsWithView(state.todayCards || []), 2),
        wheelRot: state.wheelRot || { term: 0, fruit: 0, category: 0 },
        wheelSummary: cardTitle(sel.term, sel.fruit, sel.category),
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
      wheelSummary: '',
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

    // 知识卡：**知识库优先**（2026-10-09 第24 轮）——
    // data/challenge-explanations.js 里逐题写好了「原因 / 由来」，有就直接用：
    //   · 保证每道题都是两段（不再看模型心情）
    //   · 离线、弱网也有内容
    //   · 省掉一次模型调用
    // 知识库里没有这一题时，才走原来的 AI 路径；AI 也拿不到内容才回落到题目自带的短事实。
    page.showKnowledge = function (correct) {
      const q = page._challengeQuestion;
      if (!q) return;
      if (!page._elfCache) page._elfCache = {};
      if (!page._elfPoints) page._elfPoints = {};
      const cacheKey = q.id + ':' + (correct ? '1' : '0');
      if (page._elfPoints[cacheKey]) {
        page.setData({ challengeKnowledge: { points: page._elfPoints[cacheKey], pointsView: pointsView(page._elfPoints[cacheKey]) }, challengeLoadingKnowledge: false });
        return;
      }
      const fromKb = knowledgePointsFromKb(q);
      if (fromKb) {
        page._elfPoints[cacheKey] = fromKb;
        page.setData({ challengeKnowledge: { points: fromKb, pointsView: pointsView(fromKb) }, challengeLoadingKnowledge: false });
        afterKnowledge(page, q, fromKb, correct);
        persist(page);
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
        page.setData({ challengeKnowledge: { points: points, pointsView: pointsView(points) }, challengeLoadingKnowledge: false });
        afterKnowledge(page, q, points, correct);
        persist(page); // 决策3：AI 返回知识卡后持久化，退出再进恢复完整知识卡页
      };
      let context;
      try { context = media.capture(); } catch (e) { context = null; }
      if (!context) { finish((q.knowledgePoints || []).slice(0, 3)); return; }
      const optText = page.data.challenge.options[page.data.challengeSelected] ? page.data.challenge.options[page.data.challengeSelected].text : '';
      // 中文模式才把题目 id 带给服务端（服务端也用知识库）；英文模式不带，走 AI
      media.request(context, 'POST', '/api/chat', (function () {
        const isEn = (function () { try { return i18n.getLang && i18n.getLang() === 'en'; } catch (e) { return false; } })();
        const body = {
          taskType: 'challenge', term: q.term, fruit: q.fruit, category: q.category, situation: q.situation,
          userChoice: optText, isCorrect: correct, context: knowledgeContext(q),
          // 2026-10-11：带上语言，服务端支持后知识卡就能按语言出（本轮服务端尚未改，暂不生效但不影响）
          lang: isEn ? 'en' : 'zh'
        };
        if (!isEn) body.questionId = q.id;
        return body;
      })()
      ).then(function (data) {
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
function wrapText(ctx, text, x, y, maxW, lh, firstIndent) {
  const chars = String(text).split('');
  let line = '';
  let lineX = x + (firstIndent || 0);
  let lineMax = maxW - (firstIndent || 0);
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > lineMax && line) {
      ctx.fillText(line, lineX, y);
      line = chars[i];
      y += lh;
      lineX = x; lineMax = maxW;   // 第二行起顶格
    } else line = test;
  }
  if (line) ctx.fillText(line, lineX, y);
  return y;
}

// 相册权限：已授权直接过；曾被拒→引导去设置；未询问→先 authorize。callback(granted)
// 相册权限提示（英文模式下也要英文）：抽成一个函数，三处调用共用
function albumPermissionModal() {
  wx.showModal({
    title: i18n.t('challenge_album_title'),
    content: i18n.t('challenge_album_body'),
    confirmText: i18n.t('challenge_album_go'),
    success: function (m) { if (m.confirm) wx.openSetting(); }
  });
}
function requestAlbumPermission(callback) {
  wx.getSetting({
    success: function (res) {
      const auth = res.authSetting['scope.writePhotosAlbum'];
      if (auth === true) { callback(true); return; }
      if (auth === false) {
        albumPermissionModal();
        callback(false);
        return;
      }
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: function () { callback(true); },
        fail: function () {
          albumPermissionModal();
          callback(false);
        }
      });
    },
    fail: function () { callback(true); }
  });
}

// 把「转盘 + 知识卡」合成一张图保存到相册：先抓转盘 canvas，再画到离屏合成 canvas 上，叠加知识卡文字。
// 海报高度原来固定 2.0 倍窗宽；知识卡改成「原因 + 由来」两段后文字变长，末尾容易被切掉 ✗
// → 按内容估算行数，高度贴合内容（变体乙），照片永远是"满"的。
function posterHeight(win, title, points) {
  const W = win.windowWidth;
  const textW = W - POSTER.pad * 2;
  const perLine = Math.max(8, Math.floor(textW / POSTER.body));
  let bodyLines = 0;
  (points || []).forEach(function (p) {
    const parts = splitPoint(p);
    bodyLines += Math.max(1, Math.ceil((parts.text.length + parts.label.length + 1) / perLine));
  });
  const titleLines = Math.max(1, Math.ceil(String(title || '').length / Math.max(6, Math.floor(textW / POSTER.title))));
  const need = W * 0.04 + W * 0.82 + 28                     // 转盘 + 标题前留白
    + titleLines * POSTER.titleLine + POSTER.gapAfterTitle  // 标题 + 与横线的间距
    + 20                                                    // 横线到正文
    + bodyLines * POSTER.line
    + Math.max(0, (points || []).length - 1) * POSTER.pointGap
    + 30;                                                   // 底部留白
  // 不再兜底 2 倍窗宽：高度按内容贴合，照片永远是"满"的（变体乙）
  return Math.round(need);
}
function saveAlbum(page, onDone) {
  const wheelCanvas = page._wheelCanvas;
  if (!wheelCanvas) { wx.showToast({ title: i18n.t('challenge_toast_unsupported'), icon: 'none' }); onDone(false); return; }
  const win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
  const W = win.windowWidth;
  const points = (page.data.challengeKnowledge && page.data.challengeKnowledge.points) || [];
  const title = page.data.challengeCardTitle || '';
  const shareH = posterHeight(win, title, points);
  wx.canvasToTempFilePath({
    canvas: wheelCanvas,
    success: function (wr) {
      wx.createSelectorQuery().select('#challengeShare').fields({ node: true, size: true }).exec(function (res2) {
        if (!res2 || !res2[0] || !res2[0].node) { wx.showToast({ title: i18n.t('challenge_toast_save_failed'), icon: 'none' }); onDone(false); return; }
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
          sctx.font = 'bold ' + POSTER.title + 'px sans-serif';
          sctx.textAlign = 'left';
          sctx.textBaseline = 'top';
          y = wrapText(sctx, title, 22, y, W - 44, POSTER.titleLine);
          y += POSTER.gapAfterTitle;                     // 标题与横线之间留足间距（原来 18px，字几乎贴线）
          sctx.strokeStyle = '#C0DD97';
          sctx.lineWidth = 1;
          sctx.beginPath(); sctx.moveTo(22, y); sctx.lineTo(W - 22, y); sctx.stroke();
          y += 20;
          points.forEach(function (p, idx) {
            if (idx > 0) y += POSTER.pointGap;
            // 「原因：」「由来：」用更大的字号单独画，正文接着首行往下排
            const parts = splitPoint(p);
            let firstIndent = 0;
            if (parts.label) {
              sctx.font = 'bold ' + POSTER.label + 'px sans-serif';
              sctx.fillStyle = '#234B3C';
              sctx.fillText(parts.label, 22, y);
              firstIndent = sctx.measureText(parts.label).width;
            }
            sctx.font = POSTER.body + 'px sans-serif';
            sctx.fillStyle = '#333333';
            y = wrapText(sctx, (firstIndent ? '' : '· ') + parts.text, 22, y, W - 44, POSTER.line, firstIndent) + POSTER.line - 4;
          });
          wx.canvasToTempFilePath({
            canvas: sc,
            success: function (sr) {
              wx.saveImageToPhotosAlbum({
                filePath: sr.tempFilePath,
                success: function () { wx.showToast({ title: i18n.t('challenge_toast_saved'), icon: 'success' }); onDone(true); },
                fail: function (e) {
                  if (e && /auth|deny/i.test(e.errMsg || '')) {
                    albumPermissionModal();
                  } else {
                    wx.showToast({ title: i18n.t('challenge_toast_save_failed'), icon: 'none' });
                  }
                  onDone(false);
                }
              });
            },
            fail: function () { wx.showToast({ title: i18n.t('challenge_toast_image_failed'), icon: 'none' }); onDone(false); }
          });
        };
        img.onerror = function () { wx.showToast({ title: i18n.t('challenge_toast_image_failed'), icon: 'none' }); onDone(false); };
        img.src = wr.tempFilePath;
      });
    },
    fail: function () { wx.showToast({ title: i18n.t('challenge_toast_wheel_failed'), icon: 'none' }); onDone(false); }
  });
}
