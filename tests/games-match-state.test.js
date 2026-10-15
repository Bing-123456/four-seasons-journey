'use strict';

// 2026-10-12：用户批准的「文脉连连」三条问题（诊断报告 《八条中英文问题-诊断与方案.md》 §4 / §5 / §6）。
//   第 5 条：切语言后左右两列不跟着变（两列文字在发牌/恢复时算好就冻在 data 里）。
//   第 6 条：最后的总结切语言后不跟着变（label/source 存的是写入时那份语言的成品文字）。
//   第 4 条：状态没固定住 —— ① 连完一对的讲解页退出再进就没了（恢复时把气泡清空）
//                             ② 第一局打完退出再进应停在「最后一题讲解 + 四条连线总结」页，
//                                以前却直接跳第二轮（lastRound 没存 round/pairs）。
// 这个文件守的就是上面四条，全部走「真跑一次 init / 真打一局」的集成路径（不用只看源码字符串）。
const test = require('node:test');
const assert = require('node:assert/strict');

const map = new Map();
global.wx = {
  getStorageSync: key => map.get(key),
  setStorageSync: (key, value) => map.set(key, value),
  removeStorageSync: key => map.delete(key),
  setNavigationBarTitle() {},
  navigateTo() {},
  showToast() {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  // match-game 只用到 select().fields()/boundingClientRect() + exec()；测试里 _closed 一直为 true，
  // drawLines 的 exec 回调不会碰它，这里给个安全空壳。
  createSelectorQuery: () => ({ select: () => ({ fields: () => {}, boundingClientRect: () => {} }), exec: cb => { if (cb) cb(null); } })
};

const createPlaygroundController = require('../miniprogram/packageGame/lib/playground-controller');
const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const pool = require('../miniprogram/packageGame/data/match-questions');

const MATCH_KEY = 'guayouji.match.v1.' + store.capturePartition();
const LOG_KEY = 'guayouji.match.log.v1.' + store.capturePartition();
const LOCALE = /[\u4e00-\u9fa5]/;

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

function gamePage() {
  const definition = createPlaygroundController({ hub: false });
  return Object.assign(definition, {
    setData(patch, done) {
      Object.keys(patch || {}).forEach(key => {
        if (key.indexOf('.') === -1) { this.data[key] = patch[key]; return; }
        const parts = key.split('.');
        let node = this.data;
        for (let i = 0; i < parts.length - 1; i += 1) { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
        node[parts[parts.length - 1]] = patch[key];
      });
      if (done) done();
    },
    getTabBar() { return { setData() {} }; }
  });
}

// 开一页「文脉连连」并初始化到指定语言（onShow 就是页面每次进来时走的那条路）。
// seed 是「本机存档」的可选替换（默认一局固定素材），与真实 buildRound 写出来的形状一致。
// 注意顺序：先切语言，再放存档（切语言会 saveSettings，避免把存档覆盖掉）。
function openMatch(lang, seed) {
  useLang(lang);
  map.set(MATCH_KEY, seed || matchState());
  const page = gamePage();
  page.onLoad({ game: 'match' });
  page.onShow();
  return page;
}

// 「退出页面再进来」：不动本机存档，只新建一页 + 重跑 onShow（就是用户那两步）。
function reopenMatch(lang) {
  useLang(lang);
  const page = gamePage();
  page.onLoad({ game: 'match' });
  page.onShow();
  return page;
}

// 页面当前这一轮实际发到的 4 对（id 与素材表一一对应）
function byId(id) { return pool.find(p => p.id === id); }

// 本机存档夹具。为了不依赖随机发牌，默认就放「一局固定素材、一对都还没连」的 currentRound
// —— init 会走 restoreRound 这条路，把它原样恢复出来（实测可复现）。
const FIXTURE_IDS = ['m-litchi-poetry', 'm-bayberry-poetry', 'm-persimmon-history', 'm-jujube-poetry'];
function roundFixture(matchedIds) {
  const pairs = FIXTURE_IDS.map(byId);
  const matched = {};
  (matchedIds || []).forEach(id => { matched[id] = true; });
  return {
    fruits: pairs.map(p => ({ id: p.id, name: p.fruit, nameEn: p.fruit })),
    labels: pairs.map(p => ({ id: p.id, label: p.label })),
    matched: matched,
    round: pairs.map(p => ({ id: p.id, fruit: p.fruit, label: p.label, source: p.source, category: p.category })),
    pairs: pairs.filter(p => matched[p.id]).map(p => ({ id: p.id, fruit: p.fruit, label: p.label, source: p.source, knowledge: null }))
  };
}
function matchState(extra) {
  return Object.assign({
    lastPlayDate: new Date().toISOString().slice(0, 10),
    playedToday: 0,
    seenFruits: [],
    lastRound: null,
    currentRound: roundFixture([])
  }, extra || {});
}

// 真打一局：每次进入都对，走的是 matchTapFruit → tryMatch → showKnowledge → finishRound 全链路。
// 用页面当前这一轮实际发到的 4 个 id（不自己另配素材，否则会污染 page._round）。
function playFullRound(page) {
  if (!page._matchElfCache) page._matchElfCache = {};
  const ids = (page._round || []).map(p => p.id);
  assert.equal(ids.length, 4, '开局应有 4 对');
  ids.forEach(id => { page._matchElfCache[id] = '讲解原文 ' + id + ' 的讲解'; });
  ids.forEach(id => {
    page.matchTapFruit({ currentTarget: { dataset: { id } } });
    page.matchTapLabel({ currentTarget: { dataset: { id } } });
  });
  return ids;
}

test.beforeEach(() => {
  map.clear();
  store.exitDemo();
  store.clearAll();
  useLang('zh');
});

test('issue 5: the two columns follow the current language in both directions (EN→ZH and ZH→EN)', () => {
  // EN 开局：左列英文果名（nameEn=Persimmon…）、右列英文标签
  const page = openMatch('en');
  const enFruits = page.data.matchFruits.map(it => it.nameEn);
  assert.equal(enFruits.length, 4);
  assert.deepEqual(page.data.matchLabels.map(it => it.label).slice().sort(),
    ['A galloping red dust', 'A jade plate set for you', 'Picking dates in the eighth month', 'Two thousand years of cultivation']);
  assert.doesNotMatch(enFruits.join('|'), LOCALE, 'EN 开局左列必须是英文');

  // ── EN → ZH：只重进页面（不重建），两列都要变回中文 ──
  useLang('zh');
  page.onShow();
  assert.ok(!/Lychee|Bayberry|Persimmon|Jujube/.test(page.data.matchFruits.map(it => it.nameEn).join('|')), 'EN→ZH 后左列应回到中文');
  assert.doesNotMatch(page.data.matchLabels.map(it => it.label).join('|'), /[A-Za-z]{4,}/, 'EN→ZH 后右列应回到中文标签');
  assert.deepEqual(page.data.matchFruits.map(it => it.name).slice().sort(), ['杨梅', '枣', '柿子', '荔枝']);

  // ── ZH → EN：再切回英文，两列都要变英文（证明不是单向冻结）──
  useLang('en');
  page.onShow();
  assert.deepEqual(page.data.matchFruits.map(it => it.nameEn).slice().sort(), ['Bayberry', 'Jujube', 'Lychee', 'Persimmon']);
  assert.deepEqual(page.data.matchLabels.map(it => it.label).slice().sort(),
    ['A galloping red dust', 'A jade plate set for you', 'Picking dates in the eighth month', 'Two thousand years of cultivation']);
  useLang('zh');
});

test('issue 6: the summary label follows the language, and a legacy save without ids still renders', () => {
  const seedLog = () => map.set(LOG_KEY, {
    day: new Date().toISOString().slice(0, 10),
    items: [{ id: 'm-litchi-poetry', fruit: '荔枝', label: '一骑红尘', correct: true, note: '讲解', round: 1 }]
  });

  seedLog();
  const page = openMatch('en');
  assert.equal(page.data.matchRoundLog[0].label, 'A galloping red dust', '英文下总结要取英文标签');
  assert.equal(page.data.matchRoundLog[0].source, 'Du Mu, "A galloping red dust, and the consort smiles"');
  assert.equal(page.data.matchRoundLog[0].fruit, 'Lychee', '果名照旧跟着语言');

  // 切中文：不重建页面，重新读一次总结 → 标签变中文（第 6 条）
  useLang('zh');
  page.__loadMatchLog();
  assert.equal(page.data.matchRoundLog[0].label, '一骑红尘', 'ZH 下总结标签应回到中文');
  assert.equal(page.data.matchRoundLog[0].source, '杜牧「一骑红尘妃子笑」');
  assert.equal(page.data.matchRoundLog[0].fruit, '荔枝');

  // 再切回英文：还能回去（不是单向冻结）
  useLang('en');
  page.__loadMatchLog();
  assert.equal(page.data.matchRoundLog[0].label, 'A galloping red dust');
  useLang('zh');

  // 老存档兼容：只有成品文字、没有 id → 不崩，按现状显示
  map.set(LOG_KEY, {
    day: new Date().toISOString().slice(0, 10),
    items: [{ fruit: '荔枝', label: '一骑红尘', correct: true, note: '旧讲解', source: '旧出处', round: 1 }]
  });
  const legacy = openMatch('zh');
  assert.equal(legacy.data.matchRoundLog.length, 1);
  assert.equal(legacy.data.matchRoundLog[0].label, '一骑红尘', '老存档没有 id：原样显示旧标签');
  assert.equal(legacy.data.matchRoundLog[0].note, '旧讲解');
});

test('issue 4-A: a finished round is snapshotted with its materials and replays the last explanation', () => {
  const page = openMatch('zh');
  playFullRound(page);

  const saved = map.get(MATCH_KEY);
  assert.equal(saved.playedToday, 1, '打完一局：当日局数 +1');
  assert.equal(saved.currentRound, undefined, '本局结束：续玩存档清掉');
  assert.equal(Object.keys(saved.lastRound.matched).length, 4, '快照里 4 对都在');
  assert.equal(saved.lastRound.round.length, 4, 'lastRound 要补存 round（第 4 条②）');
  assert.equal(saved.lastRound.pairs.length, 4, 'lastRound 要补存 pairs（第 4 条②）');

  // 退出再进：用真存档重新 init，应停在总结页 + 重放最后一对的讲解
  const again = reopenMatch('zh');
  assert.equal(again.data.matchDone, true, '应停在总结页');
  assert.equal(again.data.matchFruits.length, 4, '棋盘 4 张卡还在');
  assert.equal(again.data.matchRoundLog.length, 4, '「今日连线图谱」4 行都在');
  assert.equal(again.data.matchBubble.visible, true, '第 4 条①：最后一对的讲解要重放出来');
  assert.equal(again.data.matchBubble.text, '讲解原文 ' + FIXTURE_IDS[3] + ' 的讲解', '重放的就是最后配成那一对的讲解');
});

test('issue 4-B: a finished first round resumes on the summary page, not the second round', () => {
  const page = openMatch('zh');
  playFullRound(page);
  assert.equal(map.get(MATCH_KEY).playedToday, 1, '刚打完第 1 局');
  assert.ok(1 < 2, '第 2 局还没开始');

  const again = reopenMatch('zh');
  assert.equal(again.data.matchDone, true, '第一局打完退出再进：必须停在总结页（不是第二轮）');
  assert.equal(again.data.matchFruits.length, 4);
  assert.equal(again.data.matchMatched && Object.keys(again.data.matchMatched).length, 4, '四条连线都还连着');
  assert.equal(again.data.matchRoundLog.length, 4, '四条连线的总结 4 行');
  assert.equal(again.data.matchLeft, 1, '只剩 1 局的名额（轮次规则没动）');
  assert.equal(again.data.matchBubble.visible, true, '讲解气泡也在');
  assert.equal(typeof again.matchRestart, 'function', 'Play again 按钮的处理函数保留');
});

test('issue 4-B: an old save whose lastRound kept only fruits/labels still rebuilds a round (no crash)', () => {
  map.set(MATCH_KEY, {
    lastPlayDate: new Date().toISOString().slice(0, 10),
    playedToday: 1,
    seenFruits: ['荔枝', '杨梅', '柿子', '枣'],
    lastRound: { fruits: [{ id: 'm-litchi-poetry', name: '荔枝', nameEn: 'Litchi' }], labels: [{ id: 'm-litchi-poetry', label: '一骑红尘' }], matched: { 'm-litchi-poetry': true } }
  });
  const page = openMatch('zh');
  assert.equal(page.data.matchDone, false, '老存档（没有 round/pairs）退回老行为：开新一局');
  assert.equal(page.data.matchFruits.length, 4);
});

test('restarting after a finished round starts a fresh round and keeps the daily rule at 2', () => {
  const page = openMatch('zh');
  playFullRound(page);
  const again = reopenMatch('zh');
  assert.equal(again.data.matchDone, true);
  again.matchRestart();               // 页面上那个「再来一局」
  assert.equal(again.data.matchDone, false, '点 Play again 才开新局');
  assert.equal(again.data.matchFruits.length, 4);
  assert.equal(again.data.matchRoundLog.length, 4, '上一轮的总结记录还在（已写进今日连线图谱）');

  // 第 2 局也真打完：当日名额用满，重进仍停在总结页 + 重放最后一对的讲解，且 Play again 不再开新局
  playFullRound(again);
  assert.equal(map.get(MATCH_KEY).playedToday, 2, '当日 2 局已用完');
  const third = reopenMatch('zh');
  assert.equal(third.data.matchDone, true, '名额用满后重进仍停在总结页');
  assert.equal(third.data.matchLeft, 0, '每天 2 局的规则没变');
  assert.equal(third.data.matchRoundLog.length, 8, '两局各 4 对，连线图谱记录都在');
  assert.equal(third.data.matchBubble.visible, true, '名额用满这一屏也要重放最后一对的讲解');
  third.matchRestart();
  assert.equal(third.data.matchDone, true, '名额用满后 Play again 不再开新局');
  assert.equal(map.get(MATCH_KEY).playedToday, 2, '局数不会被点出第 3 局');
});

test('issue 4-A: an unfinished round resumes with its cells and replays the stored explanation', () => {
  // 未打完的一局：连对 1 对 + 那一对的讲解已经存进 currentRound.pairs[].knowledge
  const seed = matchState({ currentRound: roundFixture([FIXTURE_IDS[0]]) });
  seed.currentRound.pairs[0].knowledge = '已存下的讲解原文';
  seed.lastPlayDate = new Date().toISOString().slice(0, 10);
  const page = openMatch('zh', seed);
  assert.equal(page.data.matchDone, false, '未打完：继续玩，不到总结页');
  assert.equal(Object.keys(page.data.matchMatched).length, 1, '已连对的那一对保留');
  assert.equal(page.data.matchBubble.visible, true, '第 4 条①：退出再进要把讲解重放出来');
  assert.equal(page.data.matchBubble.text, '已存下的讲解原文');
  assert.equal(page.data.matchFruits.length, 4);
});
