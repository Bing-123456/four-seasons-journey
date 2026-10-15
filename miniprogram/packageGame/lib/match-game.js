'use strict';

// 文脉连连游戏逻辑：点水果 → 点标签 → 判定配对 → 果灵气泡讲解。
// 后台 server/chat.js 的 taskType==='match' 分支已能返回 AI 点评，本文件只改前端，
// 不改动后端。
const MATCH_POOL = require('../data/match-questions');
const notesEn = require('../data/match-notes-en');
const media = require('../../lib/media-service');
const i18n = require('../../lib/i18n');
const fruitNameEn = require('../../lib/fruit-name-en');

const KEY = 'guayouji.match.v1';
const DAILY_LIMIT = 2;
const ROUND_TARGET = 18; // 知识库共 18 种水果，见过了全部即完成一大轮

// 「正在讲解」占位符（2026-10-11）：改用**语言无关的常量**存日志，渲染时才翻成当前语言。
// 原因：原来直接拿中文文案「果灵正在讲解…」当状态标记去比对，一旦按语言改文案，
// 切换语言后旧日志里的中文占位就比对不上、会把占位当成讲解原文存下去。旧的占位值也认。
const NOTE_PENDING = '__elf_explaining__';
const NOTE_PENDING_LEGACY = '果灵正在讲解…';
function isPendingNote(note) { return note === NOTE_PENDING || note === NOTE_PENDING_LEGACY; }

// 当前语言的配对素材（模块加载时挑的那份会「冻结」在旧语言，一律走 current() 现挑）
function currentPool() { return typeof MATCH_POOL.current === 'function' ? MATCH_POOL.current() : MATCH_POOL; }
function poolHit(id) {
  if (!id) return null;
  const hit = currentPool().find(function (x) { return x.id === id; });
  return hit || null;
}

// 渲染用副本：把占位符/讲解按当前语言现取、果名也换成当前语言（存储值保持中文，避免切语言后状态错乱）。
// 2026-10-12：中线右侧的 label / source 也改成**按 id 从当前语言素材现取**——
// 以前标签是写入时那份「成品文字」被冻在本机，切语言后总结页仍是旧语言（第 6 条）。
// 老存档（没有 id，或该 id 已不在素材里）原样回退到存下来的文字，绝不出现空白。
function logView(items) {
  return (items || []).map(function (it) {
    const hit = poolHit(it && it.id);
    const view = Object.assign({}, it, {
      label: (hit && hit.label) || it.label,
      source: (hit && hit.source) || it.source,
      fruit: fruitNameEn.nameEn(it.fruit)
    });
    // 讲解也按当前语言现取：兜底句要用**上面这三行换好的当前语言文字**去拼（不是存档里那份旧语言）。
    view.note = noteForLang({ id: it && it.id, label: view.label, source: view.source, fruit: view.fruit, note: it && it.note });
    return view;
  });
}

// 每次进页面（含恢复两条路）都按当前语言重算左右两列的文字。
// 以前 nameEn / label 是发牌那一刻算好就冻在 data 里，切语言后两列不跟着变（第 5 条）。
// 左列：果名照旧存中文原名（fruitNameEn.nameEn 在中文模式原样返回），只在渲染字段 nameEn 上按语言现算。
// 右列：按 id 从当前语言素材取 label。
function relabelColumns(page) {
  const pool = currentPool();
  const data = page.data || {};
  const fruits = (data.matchFruits || []).map(function (it) {
    let name = it.name;
    if (!name) {
      const hit = pool.find(function (x) { return x.id === it.id; });
      name = hit ? hit.fruit : '';
    }
    return Object.assign({}, it, { name: name, nameEn: fruitNameEn.nameEn(name) });
  });
  const labels = (data.matchLabels || []).map(function (it) {
    const hit = pool.find(function (x) { return x.id === it.id; });
    return Object.assign({}, it, { label: hit ? hit.label : it.label });
  });
  if (fruits.length || labels.length) page.setData({ matchFruits: fruits, matchLabels: labels });
}

// 把最后配成的那一对接上「当前语言」的讲解（与图谱的 noteForLang 同一条路，2026-10-14）。
// 以前这里有存档就把存档那份成品文字原样吐回（旧语言，切语言一动不动），没存档时又固定取英文库
// （中文模式下也会给英文句）。现在一律交给 noteForLang：存档讲解存在 pairs[].knowledge 里，当 note 传进去。
function lastMatchedNote(pairs) {
  const last = (pairs || [])[pairs.length - 1] || null;
  if (!last) return null;
  const text = noteForLang({
    id: last.id, label: last.label, source: last.source, fruit: last.fruit, note: last.knowledge
  });
  return { id: last.id, text: text || i18n.t('match_elf_explaining') };
}

// 当前语言该显示的那段讲解（2026-10-14 用户批准：果灵讲解 + 图谱讲解都要「当场」跟着语言变）。
// 照仓库已有的正确范例 lib/playground-controller.js:37-54 的 quizLogView——只存编号，渲染时按当前语言现取；
// 气泡（lastMatchedNote）与图谱（noteForView）**共用这一个函数**，两处都不再自己判语言。
//   英文：有官方英文讲解库就用库；缺库的 4 条（桃 ×2 / 柑橘 ×2）用现成的英文兜底句，**绝不回落中文**。
//   中文：存档里是中文原文就用原文（AI 针对本题生成过的那段），否则用中文兜底句。
// 判据用「有没有汉字」（同 tests/games-match-state.test.js:34 的 /[\u4e00-\u9fa5]/），
// 不再用「的/了/是/这/在/不」六个虚词——实测「融安金桔皮薄肉厚，味甜而香。」一个虚词都没有，
// 旧判据会把它误判成英文、英文界面下原样显示中文。
const HAN = /[\u4e00-\u9fa5]/;
function noteFallback(it) {
  return i18n.t('match_note_fallback', {
    label: (it && it.label) || '',
    fruit: fruitNameEn.nameEn((it && it.fruit) || ''),
    source: (it && it.source) || ''
  });
}
function noteForLang(it) {
  const stored = String((it && it.note) || '');
  const id = it && it.id;
  if (i18n.getLang() === 'en') return (id && notesEn[id]) || noteFallback(it);
  const zh = (!isPendingNote(stored) && HAN.test(stored)) ? stored : '';
  return zh || noteFallback(it);
}
function noteForView(it) { return noteForLang(it); }

// 英文模式下连连看的「讲解」（2026-10-11 用户选方案 B，要求全英文）：
// 服务端 match() 的提示词写死中文、只会回中文，所以英文模式**不调服务端**，
// 直接用从英文文化库原样抽出来的 match-notes-en.js（脚本 _生连连看英文讲解.js 生成）；
// 没有对应段落的水果（桃 / 柑橘 共 4 对）退回英文兜底文案。中文模式一个字不改，仍走 AI。
function localNoteEn(pair) {
  const hit = pair && pair.id ? notesEn[pair.id] : '';
  return hit || noteFallback(pair);
}

// 果灵讲解的页内缓存（2026-10-14）：以前按配对 id 存**成品文字**，而且只在页面实例内，
// 同一次页面存活期内切语言（返回再进、页面没销毁）会把旧语言的缓存直接吐回气泡。
// 现在记下这条缓存是**哪门语言**下写的：语言一对不上就当没有缓存、按当前语言现取。
// 没打语言标记的缓存（老版本/自测脚本直接塞的）照旧信任，行为不变。
function elfCacheGet(page, id) {
  const cache = page && page._matchElfCache;
  if (!cache || !id || !cache[id]) return '';
  const langs = page._matchElfCacheLang;
  if (langs && langs[id] && langs[id] !== i18n.getLang()) return '';
  return cache[id];
}
function elfCacheSet(page, id, text) {
  if (!page._matchElfCache) page._matchElfCache = {};
  page._matchElfCache[id] = text;
  if (!page._matchElfCacheLang) page._matchElfCacheLang = {};
  page._matchElfCacheLang[id] = i18n.getLang();
}

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function partition() { try { return require('../../lib/store').capturePartition(); } catch (e) { return 'personal'; } }
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
    // 跨天不再恢复「昨天的总结页」：lastRound 是「今日连线图谱」的素材，跨天要一起清（否则第二天进来
    // 会先看到昨天那一屏）。轮次规则（每天 2 局）一个字没动。
    state.lastRound = null;
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
  // ── 今日连线图谱（2026-10-08 新增）────────────────────────────
  // 只记"今天"的结果：果实名 / 文脉标签 / 对错；跨天不看
  const LOG_KEY = 'guayouji.match.log.v1';
  function logToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function readLog() {
  try {
    const v = wx.getStorageSync(LOG_KEY + '.' + partition());
    if (v && v.day === logToday() && Array.isArray(v.items)) return v.items;
  } catch (e) {}
  return [];
  }
  function writeLog(items) {
  try { wx.setStorageSync(LOG_KEY + '.' + partition(), { day: logToday(), items: items }); } catch (e) {}
  }
  page.__loadMatchLog = function () { const items = readLog(); page.setData({ matchLog: items, matchRoundLog: logView(items) }); };
page.__pushMatchLog = function (fruitId, labelId, correct) {
  try {
    // 名字从本轮题目里取（page._round：判定时一定还在），绝不事后查 data（那会被重置清空）
    const pair = (page._round || []).filter(function (p) { return p.id === fruitId; })[0];
    const fruitName = (pair && pair.fruit) || '';
    const labelName = (pair && pair.label) || '';
    // 只保留有效条目：名字不全的一律不记、也不画（杜绝空白行）
    if (!fruitName || !labelName) return;
    const items = readLog().slice();
    // 2026-10-12：只存 id + 果名（中文原名）+ 结果，label/source 交给 logView 按当前语言现取；
    // 下面存的 label/source 是「写入时那份语言的成品文字」（英文局里就是英文），
    // **只为老版本兼容**，渲染一律以 logView 按 id 现取的为准（第 6 条根因）。
    items.push({ id: pair.id, fruit: fruitName, label: labelName, correct: !!correct, note: '', source: pair.source || '', round: page.__matchRound || 1 });
    writeLog(items);
    page.setData({ matchLog: items });
  } catch (e) { /* 存不上不影响游戏 */ }
};
// 把气泡里那段讲解词（原文）挂到刚记下的这一对上 —— 气泡显示什么就存什么
page.showBubble = function (type, text) {
  page.__showBubbleBase(type, text);
  // 讲解走的是 'success'；第一句是占位「果灵正在讲解…」，跳过它，只存真正的讲解原文
  if (type === 'success') {
    const t = String(text || '').trim();
    if (t && !isPendingNote(t)) page.__attachNote(t);
  }
};

page.__attachNote = function (text) {
  try {
    const clean = String(text || '').trim();
    if (!clean) return;
    const pid = page.__knowledgePairId;
    const items = readLog().slice();
    if (!items.length) return;
    let hit = 0;
    // 优先挂到"当前正在讲解的那一对"；找不到就退回最后一条（兜底）
    items.forEach(function (it) { if (pid && it.id === pid) { it.note = clean; hit++; } });
    if (!hit) items[items.length - 1].note = clean;
    writeLog(items);
    page.setData({ matchLog: items });
  } catch (e) { /* 忽略 */ }
};
// 本轮结算：缺讲解的对"静默补查"一次（先显示"果灵正在讲解…"，拿到就替换；失败用知识库原文兜底）
page.__ensureRoundNotes = function (roundNo) {
  const items = readLog();
  const targets = items.filter(function (it) { return (it.round || 1) <= roundNo && !it.note; });
  if (!targets.length) return;
  targets.forEach(function (it) { it.note = NOTE_PENDING; });
  writeLog(items);
  page.setData({ matchRoundLog: logView(items.filter(function (it) { return (it.round || 1) <= roundNo; })) });
  targets.forEach(function (it) {
    const cached = elfCacheGet(page, it.id);
    const fallback = i18n.t('match_note_fallback', { label: it.label, fruit: fruitNameEn.nameEn(it.fruit), source: it.source });
    function fill(text) {
      const list = readLog();
      list.forEach(function (x) { if (x.id === it.id && (x.round || 1) <= roundNo && isPendingNote(x.note)) x.note = text; });
      writeLog(list);
      page.setData({ matchRoundLog: logView(list.filter(function (x) { return (x.round || 1) <= roundNo; })) });
    }
    if (cached) { fill(cached); return; }
    // 英文模式：同上，直接用英文文化库抽出的讲解（不调服务端）
    if (i18n.getLang() === 'en') { fill(localNoteEn(it)); return; }
    let context = null;
    try { context = media.capture(); } catch (e) { context = null; }
    if (!context) { fill(fallback); return; }
    media.request(context, 'POST', '/api/chat', {
      taskType: 'match', fruit: it.fruit, category: '', label: it.label, isCorrect: true, context: it.source, lang: i18n.getLang() === 'en' ? 'en' : 'zh'
    }).then(function (data) {
      const text = (data && data.knowledge && data.knowledge.length) ? data.knowledge : fallback;
      fill(text);
    }).catch(function () { fill(fallback); });
  });
};
// 展示本轮图谱（只本轮 4 对）
page.__showRoundGraph = function (roundNo) {
  const items = readLog().filter(function (it) { return (it.round || 1) <= roundNo; });
  page.setData({ matchRoundLog: logView(items) });
};

  page.__loadMatchLog();
    const self = this;
    const state = loadState();
    page._matchState = state;

    // 气泡打字机：逐字显示，成功从上淡入，失败从下「蹦」出，选中为静态提示。
page.__showBubbleBase = function (type, text) {
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
      page.showBubble('select', i18n.t('match_select_fruit', { name: fruitNameEn.nameEn(pair ? pair.fruit : '') }));
      this.tryMatch();
    }.bind(page);

    page.matchTapLabel = function (e) {
      const id = e.currentTarget.dataset.id;
      if (page.data.matchMatched[id]) return;
      page.setData({ matchSelectedLabel: id });
      const pair = page._round.find(function (p) { return p.id === id; });
      page.showBubble('select', i18n.t('match_select_label', { name: pair ? pair.label : '' }));
      this.tryMatch();
    }.bind(page);

    // 判定：选中水果 + 标签后，比对 pair id 是否一致。
    page.tryMatch = function () {
      const fruit = page.data.matchSelectedFruit, label = page.data.matchSelectedLabel;
      if (!fruit || !label) return;
      const pair = page._round.find(function (p) { return p.id === fruit; });
      const correct = pair && label === pair.id;
    // 今日连线图谱：把这一对的结果记进"今天"的记录（实线=对 / 虚线=错）
    page.__pushMatchLog(fruit, label, correct);
      if (correct) {
        const matched = Object.assign({}, page.data.matchMatched);
        matched[fruit] = true;
        if (!page._matchedPairs) page._matchedPairs = [];
        page._matchedPairs.push({ id: pair.id, fruit: pair.fruit, label: pair.label, source: pair.source, knowledge: null });
        const learned = (page.data.matchLearned || []).concat([i18n.t('match_learned_pair', { fruit: fruitNameEn.nameEn(pair.fruit), label: pair.label })]);
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
        page.showBubble('fail', i18n.t('match_wrong_hint', { name: labelPair ? fruitNameEn.nameEn(labelPair.fruit) : i18n.t('match_some_fruit') }));
        setTimeout(function () { page.setData({ matchWrong: null, matchSelectedFruit: '', matchSelectedLabel: '' }); }, 600);
      }
    }.bind(page);

    page.showKnowledge = function (pair, correct) {
  // 记住当前正在讲解的那一对：后面异步返回的讲解就挂到它身上（按 id，不靠"最近一条"）
  if (pair && pair.id) page.__knowledgePairId = pair.id;
      // 只解释一次：先显示「正在讲解」，等知识库(AI)返回后显示唯一一段讲解；AI 无返回才用本地原文兜底一次。
      page.showBubble('success', i18n.t('match_elf_explaining'));
      const cacheKey = pair.id;
      const cachedText = elfCacheGet(page, cacheKey);
      if (cachedText) {
        page.showBubble('success', cachedText);
        // 2026-10-12：走缓存这条路以前直接 return，没把讲解回写进「已配对记录」，
        // 于是 currentRound.pairs[].knowledge 一直是 null → 退出重进既没得重放、总结也缺讲解。
        // 补上与 deliver() 同样的回写（两个字段都写，退出重进后讲解才真的留住）。
        const hitEntry = (page._matchedPairs || []).find(function (p) { return p.id === pair.id; });
        if (hitEntry) hitEntry.knowledge = cachedText;
        const hitCr = page._matchState && page._matchState.currentRound;
        if (hitCr && hitCr.pairs) {
          const hitPe = hitCr.pairs.find(function (p) { return p.id === pair.id; });
          if (hitPe) { hitPe.knowledge = cachedText; writeState(page._matchState); }
        }
        return;
      }
      let context;
      try { context = media.capture(); } catch (e) { context = null; }
      function deliver(text) {
        page.showBubble('success', text);
        elfCacheSet(page, cacheKey, text);
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
      const fallback = i18n.t('match_note_fallback', { label: pair.label, fruit: fruitNameEn.nameEn(pair.fruit), source: pair.source });
      // 英文模式：服务端 match 提示词是中文、只会回中文，所以这里不调服务端，直接用英文文化库抽出的讲解
      if (i18n.getLang() === 'en') { deliver(localNoteEn(pair)); return; }
      if (!context) { deliver(fallback); return; }
      media.request(context, 'POST', '/api/chat', {
        taskType: 'match', fruit: pair.fruit, category: pair.category, label: pair.label, isCorrect: true, context: pair.source, lang: i18n.getLang() === 'en' ? 'en' : 'zh'
      }).then(function (data) {
        const text = (data && data.knowledge && data.knowledge.length) ? data.knowledge : fallback;
        deliver(text);
      }).catch(function () { deliver(fallback); });
    };

    page.finishRound = function () {
  // 本轮结算（2026-10-08 新增）：先展示"本轮 4 对"的图谱，再补查缺讲解的条目
  let rn = page.__matchRound || 1;   // 先取本轮编号：结算要按它捞记录，快照也要存它（第 4 条②）
  try {
    page.__showRoundGraph(rn);
    page.__ensureRoundNotes(rn);
    page.__matchRound = rn + 1;   // 下一轮用新编号（本轮的记录保持原编号）
  } catch (e) { /* 结算失败不影响游戏 */ }
      const st = page._matchState;
      st.playedToday += 1;
      // 持久化最后这局，杀进程重进也能固定显示结束页（4 张配对成功的卡 + 底部讲解）。
      // 2026-10-12：除渲染好的 fruits/labels 外，把「整局素材」round/pairs 也存下来——
      // 否则重进时拿不到「4 条连线对应的题面/标签/讲解」，总结页恢复不出来（第 4 条②）。
      st.lastRound = {
        fruits: page.data.matchFruits,
        labels: page.data.matchLabels,
        matched: page.data.matchMatched,
        round: (page._round || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, category: p.category }; }),
        pairs: (page._matchedPairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, knowledge: p.knowledge || null }; }),
        roundNo: rn
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
    // 2026-10-12：恢复的是「最后一局」——用 lastRound 里存的 round/pairs 重放最后一对讲解 +
    // 按当前语言重算两列与总结（第 4/5/6 条）。
    function finishedSnapshot(s) {
      const lr = (s && s.lastRound) || null;
      if (!lr) return null;
      if (!Array.isArray(lr.round) || !lr.round.length) return null;
      if (!Array.isArray(lr.pairs) || !lr.pairs.length) return null;
      if (Object.keys(lr.matched || {}).length < 4) return null;
      return lr;
    }
    if (state.playedToday >= DAILY_LIMIT) {
      const snap = finishedSnapshot(state);
      if (snap) {
        this.restoreFinishedRound(page, state, true);
      } else {
        // 老存档（lastRound 没存 round/pairs）：与以前逐字一致，只把两列文字按当前语言重算
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
        relabelColumns(page);
      }
      // 需求3：每日结束页保留最后一局的连线（棋盘卡片仍在渲染，重绘连线即可）。
      setTimeout(function () { if (!page._closed) page.drawLines(); }, 80);
      return;
    }
      // 决策1-A：若当前局未玩完（已配对但未满 4 对），重进时恢复到已完成配对，继续玩。
      if (state.currentRound && Object.keys(state.currentRound.matched || {}).length < 4) {
        this.restoreRound(page, state);
      } else if (finishedSnapshot(state)) {
        // 第 4 条②：这一局刚打完（playedToday 还没满）→ 停回「最后一对讲解 + 四条连线总结」，
        // 不再直接发第二轮。只有用户点「再来一局」（matchRestart）才开新局。
        this.restoreFinishedRound(page, state, false);
      } else {
        this.buildRound(page, state);
      }
  },

  // 第 4 条②：恢复到「刚打完的那一局」——固定停在总结页（4 条连线 + 最后一对的讲解）。
  // 素材全部现按当前语言重取（与 restoreRound 同一套 relabel），所以切语言后这一屏也跟着变。
  restoreFinishedRound: function (page, state, exhausted) {
    const lr = state.lastRound;
    page._matchState = state;   // 与 init 里一致：后续 matchRestart 等仍读 page._matchState
    const relabel = function (p) {
      const hit = poolHit(p.id);
      return hit ? Object.assign({}, p, { label: hit.label, source: hit.source }) : p;
    };
    page._round = (lr.round || []).map(relabel);
    page._matchedPairs = (lr.pairs || []).map(function (p) {
      const merged = relabel(p);
      // 恢复时若这局是在另一种语言下玩的，用「当前语言」重写讲解（与气泡同源：一律走 noteForLang 现取；
      // 存档讲解存在 knowledge 里，当 note 传进去，中文原文才会被认出来）
      const note = noteForView({ id: merged.id, label: merged.label, source: merged.source, fruit: merged.fruit, note: merged.knowledge });
      return Object.assign({}, merged, { knowledge: note || merged.knowledge || null });
    });
    page.__matchRound = lr.roundNo || 1;
    const note = lastMatchedNote(page._matchedPairs);
    const patches = {
      matchFruits: (lr.fruits || []).map(function (it) { return Object.assign({}, it); }),
      matchLabels: (lr.labels || []).map(function (it) { return Object.assign({}, it); }),
      matchMatched: lr.matched || {},
      matchSelectedFruit: '', matchSelectedLabel: '', matchWrong: null,
      matchDone: true,   // ← 停在总结页，不是第二轮
      matchDailyLimit: DAILY_LIMIT,
      matchLeft: exhausted ? 0 : (DAILY_LIMIT - state.playedToday),
      matchLearned: page._matchedPairs.map(function (p) {
        return i18n.t('match_learned_pair', { fruit: fruitNameEn.nameEn(p.fruit), label: p.label });
      }),
      // 第 4 条①：把最后一对的讲解重放出来（退出再进不再丢讲解页）
      matchBubble: note
        ? { visible: true, type: 'success', text: note.text }
        : { visible: false, type: '', text: '' }
    };
    if (exhausted) patches.matchRoundVisible = page.data.matchRoundVisible || false;
    page.setData(patches);
    relabelColumns(page);
    page.__loadMatchLog();   // 四条连线的总结（走 logView，按当前语言现取标签）
    setTimeout(function () { if (!page._closed) page.drawLines(); }, 60);
  },

  restoreRound: function (page, state) {
    // 决策1-A：恢复到未完成的当前局（已完成配对保留，选中态不恢复），继续玩。
    const cr = state.currentRound;
    page._round = (cr.round || cr.pairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, category: p.category }; });
    page._matchedPairs = (cr.pairs || []).map(function (p) { return { id: p.id, fruit: p.fruit, label: p.label, source: p.source, knowledge: p.knowledge || null }; });
    // 2026-10-11：恢复的这局若存的是另一种语言的 label/source，按 id 从当前语言的素材里换回来
    function relabel(p) {
      const hit = poolHit(p.id);
      return hit ? Object.assign({}, p, { label: hit.label, source: hit.source }) : p;
    }
    page._round = page._round.map(relabel);
    page._matchedPairs = page._matchedPairs.map(relabel);
    // 第 4 条①：讲解原文其实已经存在 currentRound.pairs[].knowledge 里，恢复时按当前语言重放出来，
    // 不再一行清空气泡（以前退出再进就没了讲解页）。
    const note = lastMatchedNote(page._matchedPairs);
    page.setData({
      matchFruits: (cr.fruits || []).map(function (it) { return Object.assign({}, it); }),
      matchLabels: (cr.labels || []).map(function (it) { return Object.assign({}, it); }),
      matchMatched: cr.matched || {},
      matchSelectedFruit: '', matchSelectedLabel: '', matchWrong: null,
      matchDone: false, matchLearned: page._matchedPairs.map(function (p) { return i18n.t('match_learned_pair', { fruit: fruitNameEn.nameEn(p.fruit), label: p.label }); }),
      matchLeft: DAILY_LIMIT - state.playedToday, matchDailyLimit: DAILY_LIMIT,
      matchBubble: note ? { visible: true, type: 'success', text: note.text } : { visible: false, type: '', text: '' }
    });
    relabelColumns(page);
    setTimeout(function () { if (!page._closed) page.drawLines(); }, 60);
  },

  buildRound: function (page, state) {
    // 每轮 4 对：抽「本轮/历史未见过的水果种类」4 种不同水果（按 18 种去重，同水果多标签随机取其一）；
    // seenFruits 跨天累计，遍历完 18 种后由 finishRound 重置。不足 4 种新水果时，先取完剩余新水果，
    // 再重置已见列表并从全部水果补满 4 对（允许再出之前出过的题目）。
    const fruitNames = [];
    // 2026-10-11：开局按当前语言现挑配对素材（模块加载时挑一次会"冻结"）
    const pool = currentPool();
    pool.forEach(function (p) { if (fruitNames.indexOf(p.fruit) === -1) fruitNames.push(p.fruit); });
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
      const entries = pool.filter(function (p) { return p.fruit === f; });
      return entries[Math.floor(Math.random() * entries.length)];
    });
    const fruits = picked.map(function (p) { return { id: p.id, name: p.fruit, nameEn: fruitNameEn.nameEn(p.fruit) }; });
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
  },
  // 给自测用：英文模式下这条配对的讲解（英文文化库抽出的原文，不调服务端）
  noteEnFor: localNoteEn,
  // 给自测用：图谱/气泡展示时用的讲解 —— 按**当前语言**现取（中英两个方向都会换）
  noteViewFor: noteForView
};
