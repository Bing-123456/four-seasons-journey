'use strict';
// 问果灵（/api/chat）回答质量金标评测：先答问点 / 诚实拒答 / 不答非所问。
//
// 方法学（借鉴 docs/深剖红山朋友…LLM网关-2026-09-28.md 的金标门禁思路）：
//   - 金标题分「调参集 tuning」与「留出集 heldout」：prompt 与机制只依据调参集修改；
//     留出集只在最后跑一次验证，防止对评测题过拟合。
//   - 判据分三层：路由（该本地答复的题不允许打到模型）、must_include（答点必须出现的内容，
//     拒答题要求出现「素材库里没有」）、forbidden（编造类红词，一票否决）。
//   - 评测走真实客户端同源路径：检索与上下文组装直接复用 miniprogram/packageMore/search/search.js
//     导出的 matchFruits/buildContexts，越界判定复用 data/fruit-scope，与线上 ask() 完全一致。
//
// 用法：
//   node scripts/evaluate-chat.js --base https://guayouji.orionsheep.com --token <API_TOKEN> --phase baseline
//   node server/index.js &   # 本地服务（读根目录 .env）
//   node scripts/evaluate-chat.js --base http://127.0.0.1:8787 --phase after --delay 300
//   node scripts/evaluate-chat.js --split tuning   # 只跑调参集（默认 all）
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
function argOf(name, fallback) {
  const at = argv.indexOf(name);
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback;
}
const split = argOf('--split', 'all');
const base = argOf('--base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const token = argOf('--token', '');
const delayMs = Number(argOf('--delay', '3500')); // 生产限速 30 次/分钟 → 串行 + ≥2s 间隔
const phase = argOf('--phase', 'run');
const limit = Number(argOf('--limit', '0'));

// —— 与线上客户端同源的检索/组装（search.js 底部导出，Page 打桩后 require）——
global.wx = { getStorageSync: () => undefined, setStorageSync: () => {}, showToast: () => {}, request: () => {} };
global.Page = () => {};
const searchPage = require('../miniprogram/packageMore/search/search');
const fruitScope = require('../miniprogram/data/fruit-scope');
const farmProverbs = require('../miniprogram/data/farm-proverbs');
const i18n = require('../miniprogram/lib/i18n');

// 金标集：17 题（调参 8 + 留出 9）。must_include 是「全部要命中」的正则；
// forbidden 是「一个都不能出现」的编造红词。expectRoute：local=客户端本地诚实话术，model=/api/chat。
const GOLDEN = [
  // —— 调参集：prompt/机制迭代只看这 8 题 ——
  { id: 'T1', split: 'tuning', type: '事实题', question: '如何挑选西瓜', expectRoute: 'model',
    mustInclude: ['纹', '听声|声音|拍|敲'], forbidden: [] },
  { id: 'T2', split: 'tuning', type: '比较题', question: '李子和杏子有什么区别', expectRoute: 'model',
    mustInclude: ['李子', '杏', '区别|不同|差异|差别'], forbidden: [] },
  { id: 'T3', split: 'tuning', type: '关系题', question: '凤梨和菠萝是什么关系', expectRoute: 'model',
    mustInclude: ['同一种|别名|又叫|又称|两个名字|名字不同|同一品种|同一种水果'],
    forbidden: ['两种不同的水果|不同的果树|近亲|亲戚'] },
  { id: 'T4', split: 'tuning', type: '为什么题·素材无答案', question: '凤梨酥馅为啥要掺冬瓜', expectRoute: 'model',
    mustInclude: ['素材库里没有', '冬瓜|凤梨酥'], forbidden: ['因为便宜|降低成本|省钱|成本低'] },
  { id: 'T5', split: 'tuning', type: '为什么题·素材无答案', question: '为什么苹果叫苹果', expectRoute: 'model',
    mustInclude: ['素材库里没有'], forbidden: ['频婆|梵语|佛经'] },
  { id: 'T6', split: 'tuning', type: '怎么做题', question: '柿子怎么晒柿饼', expectRoute: 'model',
    mustInclude: ['削皮', '晾晒|悬挂|串', '霜'], forbidden: [] },
  { id: 'T7', split: 'tuning', type: '闲聊/越界', question: '今天天气怎么样', expectRoute: 'local',
    mustInclude: ['换个关键词|素材库'], forbidden: [] },
  { id: 'T8', split: 'tuning', type: '境外果品', question: '榴莲是什么季节的', expectRoute: 'local',
    mustInclude: ['外来引进', '荔枝|龙眼|黄皮'], forbidden: [] },

  // —— 留出集：只在最终验证时跑一次 ——
  { id: 'H1', split: 'heldout', type: '事实题', question: '西瓜的名字是怎么来的', expectRoute: 'model',
    mustInclude: ['五代|契丹'], forbidden: [] },
  { id: 'H2', split: 'heldout', type: '为什么题·素材可答', question: '樱桃为什么叫含桃', expectRoute: 'model',
    mustInclude: ['含桃', '黄莺'], forbidden: [] },
  { id: 'H3', split: 'heldout', type: '怎么做题', question: '西瓜酱怎么做', expectRoute: 'model',
    mustInclude: ['黄豆|豆', '晒|发酵'], forbidden: [] },
  { id: 'H4', split: 'heldout', type: '为什么题·素材可答', question: '吃菠萝为什么要用盐水泡', expectRoute: 'model',
    mustInclude: ['蛋白酶', '盐水'], forbidden: [] },
  { id: 'H5', split: 'heldout', type: '为什么题·素材可答', question: '过年为什么摆砂糖橘', expectRoute: 'model',
    mustInclude: ['谐音|吉'], forbidden: [] },
  { id: 'H6', split: 'heldout', type: '关系题·素材无答案', question: '樱桃和车厘子有什么区别', expectRoute: 'model',
    mustInclude: ['素材库里没有'], forbidden: ['欧洲甜樱桃|是进口|个大皮厚'] },
  { id: 'H7', split: 'heldout', type: '为什么题·素材无答案', question: '桃木为什么能辟邪', expectRoute: 'model',
    mustInclude: ['素材库里没有'], forbidden: ['神荼|郁垒|度朔山'] },
  { id: 'H8', split: 'heldout', type: '境外农耕', question: '法国葡萄酒庄是什么样', expectRoute: 'local',
    mustInclude: ['境外农耕文化|不属于'], forbidden: [] },
  { id: 'H9', split: 'heldout', type: '复合词越界', question: '苹果手机多少钱', expectRoute: 'local',
    mustInclude: ['换个关键词|素材库'], forbidden: [] }
];

// —— 客户端 ask() 的路由与本地话术复刻（与 search.js 同一顺序、同一文案）——
function localAnswerFor(question) {
  const scope = fruitScope.classify(question);
  if (scope.scope === 'out') {
    const advice = scope.suggestions && scope.suggestions.length ? '\n可以换成这些本土水果问我：' + scope.suggestions.join('、') + '。' : '';
    return { route: 'local', answer: scope.message + advice };
  }
  const fruits = searchPage.matchFruits(question);
  if (!fruits.length) {
    const proverbHits = farmProverbs.proverbs.filter(item => question.length > 1 && (item.text + item.note).indexOf(question.slice(0, 4)) !== -1).slice(0, 3);
    if (proverbHits.length) return { route: 'local', answer: '素材库里暂时没有直接对应的资料，找到几条相关农谚：\n' + proverbHits.map(item => '「' + item.text + '」').join('\n') };
    return { route: 'local', answer: i18n.t('search_no_result') };
  }
  return { route: 'model', fruits, contexts: searchPage.buildContexts(fruits, question) };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callChat(question, contexts) {
  const response = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ question, history: [], contexts })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + JSON.stringify(data).slice(0, 160));
  if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('空回答 ' + JSON.stringify(data).slice(0, 160));
  return data;
}

function grade(item, answer) {
  const misses = item.mustInclude.filter(pattern => !new RegExp(pattern).test(answer));
  const violations = item.forbidden.filter(pattern => new RegExp(pattern).test(answer));
  return { pass: !misses.length && !violations.length, misses, violations };
}

async function main() {
  const rows = GOLDEN.filter(row => split === 'all' || row.split === split).slice(0, limit || Infinity);
  const detail = [];
  for (const item of rows) {
    const routed = localAnswerFor(item.question);
    let answer = '';
    let error = null;
    let guarded = false;
    if (routed.route === 'model') {
      try { const data = await callChat(item.question, routed.contexts); answer = data.answer.trim(); guarded = !!data.guarded; }
      catch (failure) { error = failure.message; }
    } else {
      answer = routed.answer;
    }
    const routeOk = routed.route === item.expectRoute;
    const result = error ? { pass: false, misses: ['请求失败:' + error], violations: [] } : grade(item, answer);
    const pass = routeOk && result.pass;
    detail.push({ id: item.id, split: item.split, type: item.type, question: item.question, expectRoute: item.expectRoute, route: routed.route, routeOk, pass, misses: result.misses, violations: result.violations, guarded, answer });
    console.log((pass ? 'PASS' : 'FAIL') + ' [' + item.id + '·' + item.split + '·' + item.type + '] ' + item.question +
      (routed.route !== item.expectRoute ? ' | 路由不符:' + routed.route : '') +
      (result.misses.length ? ' | 缺:' + result.misses.join(' & ') : '') +
      (result.violations.length ? ' | 红词:' + result.violations.join(' & ') : '') +
      (guarded ? ' | 守卫介入' : ''));
    console.log('     ↳ ' + (answer || error || '').replace(/\s+/g, ' ').slice(0, 110));
    await sleep(delayMs);
  }
  const rate = subset => {
    const rowsOf = detail.filter(row => subset === 'all' || row.split === subset);
    return rowsOf.length ? { passed: rowsOf.filter(row => row.pass).length, total: rowsOf.length, rate: Math.round(rowsOf.filter(row => row.pass).length / rowsOf.length * 1000) / 10 } : null;
  };
  const summary = { tuning: rate('tuning'), heldout: rate('heldout'), overall: rate('all') };
  console.log('\n== 汇总（' + phase + ' @ ' + base + '）==');
  console.log(JSON.stringify(summary));
  const output = path.resolve(__dirname, '../test-results/chat-eval-' + phase + '.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), base, phase, split, summary, detail }, null, 2));
  console.log('明细已写入 ' + output);
}

main().catch(error => { console.error('问答评测失败：' + ((error && error.message) || error)); process.exitCode = 1; });
