'use strict';

// 2026-10-11：用户要求「文脉连连」英文模式下讲解也是英文（两张截图：局末补讲 + 局中讲解）。
// 根因：讲解是服务端 AI 生成的，而 server/chat.js 的 match() 提示词写死中文、只会回中文
// （我用线上接口实测过：英文素材 + lang=en 仍回中文）。用户选方案 B：英文模式不调服务端，
// 直接用 App 自带英文文化库抽出的 miniprogram/data/match-notes-en.js。
// 这个测试守：① 每对都有英文讲解（除英文文化库缺的两个水果）② 是英文散文 ③ 两条路径都先判英文。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const map = new Map();
global.wx = { getStorageSync: key => map.get(key), setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key), showToast() {}, navigateTo() {} };

const store = require('../miniprogram/lib/store');
const i18n = require('../miniprogram/lib/i18n');
const pool = require('../miniprogram/packageGame/data/match-questions');
const notes = require('../miniprogram/packageGame/data/match-notes-en');
const matchGame = require('../miniprogram/packageGame/lib/match-game');

function useLang(code) { store.saveSettings({ language: code }); i18n.invalidateLang(); }

test.beforeEach(() => { map.clear(); store.exitDemo(); store.clearAll(); useLang('zh'); });

test('every match pair has an English note, except the two fruits missing from the English culture base', () => {
  // 英文文化库里没有 桃 / 柑橘 这两果（grep 过 42 果名单），对应的 4 对走英文兜底文案
  const NO_PARAGRAPH = ['桃', '柑橘'];
  const missing = pool.filter(p => !notes[p.id] && NO_PARAGRAPH.indexOf(p.fruit) === -1);
  assert.deepEqual(missing.map(p => p.id), [], '除缺段落的水果外，每对都要有英文讲解');
  assert.equal(Object.keys(notes).length, pool.length - 4, '34 对里 30 对来自文化库');
  Object.keys(notes).forEach(id => {
    assert.equal(typeof notes[id], 'string');
    assert.ok(notes[id].trim().length > 80, id + ' 太短，像是没抽到内容');
  });
});

test('the English notes are English prose (no Chinese function words)', () => {
  // 英文文化库的正文是英文，只保留专名/诗名/古称（如《荔枝图序》「一日而色变…」）；
  // 中文虚词（的/了/是/这/在/不）一个都不该出现 —— 出现就说明混进了中文句子。
  const bad = ['的', '了', '是', '这', '在', '不', '我们', '很'];
  const offenders = [];
  Object.keys(notes).forEach(id => bad.forEach(w => { if (notes[id].indexOf(w) !== -1) offenders.push(id + ' → ' + w); }));
  assert.deepEqual(offenders, []);
});

test('English mode takes the note from the local English table; the 桃 fallback is English too', () => {
  useLang('en');
  // 注意：要取"当前语言"那份题库（match-questions.current()）—— 模块默认导出是加载时挑的那份
  const enPool = require('../miniprogram/packageGame/data/match-questions').current();
  const litchi = enPool.find(p => p.id === 'm-litchi-origin');
  assert.equal(matchGame.noteEnFor(litchi), notes['m-litchi-origin']);
  assert.match(matchGame.noteEnFor(litchi), /Zengcheng/);

  const peach = enPool.find(p => p.id === 'm-peach-poetry');
  const peachNote = matchGame.noteEnFor(peach);
  assert.match(peachNote, /Peach/, '兜底文案里水果用英文名');
  assert.doesNotMatch(peachNote, /[\u4e00-\u9fa5]{3,}/, '兜底文案不该是中文句子');
});

test('English mode never asks the server for the match explanation', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/lib/match-game.js'), 'utf8');
  const calls = [src.indexOf("taskType: 'match', fruit: it.fruit"), src.indexOf("taskType: 'match', fruit: pair.fruit")];
  assert.ok(calls[0] > 0 && calls[1] > 0, '两处请求都在');
  assert.match(src.slice(Math.max(0, calls[0] - 700), calls[0]), /getLang\(\) === 'en'\) \{ fill\(localNoteEn\(it\)\)/, '局末补讲那条要先判英文');
  assert.match(src.slice(Math.max(0, calls[1] - 700), calls[1]), /getLang\(\) === 'en'\) \{ deliver\(localNoteEn\(pair\)\)/, '局中讲解那条要先判英文');
});

test('stored Chinese notes from earlier sessions are shown in English (and Chinese mode is untouched)', () => {
  // 用户截图那种情况：今天早些时候服务端回的中文讲解已经存进本地日志
  const storedChinese = '据文化库记载，广东增城栽培荔枝已有1600年历史，自2012年起获国家地理标志保护。是荔枝悠久种植历史的见证。';
  const item = { id: 'm-litchi-origin', fruit: '荔枝', label: 'Zengcheng ancient tribute orchard', note: storedChinese, round: 1 };

  useLang('en');
  assert.equal(matchGame.noteViewFor(item), notes['m-litchi-origin'], '英文模式：换成英文文化库那段');

  useLang('zh');
  assert.equal(matchGame.noteViewFor(item), storedChinese, '中文模式：一个字都不改');

  useLang('en');
  // 已经是英文原文的（本地那段）不重复处理
  assert.equal(matchGame.noteViewFor(Object.assign({}, item, { note: notes['m-litchi-origin'] })), notes['m-litchi-origin']);
  // 2026-10-14（用户批准的任务 A）：英文库缺这 4 条（桃 ×2 / 柑橘 ×2）时**走现成的英文兜底句**，
  // 不再把存档里的中文原样吐回（这是旧期望值，本轮跟着修复改掉：以前英文界面下这几行必是中英混排）。
  const peach = matchGame.noteViewFor({ id: 'm-peach-poetry', fruit: '桃', label: 'Garden has peaches', source: 'The Book of Songs', note: '园有桃，其实之肴。' });
  assert.notEqual(peach, '园有桃，其实之肴。', '缺库的这 4 条不再回落中文存档');
  assert.match(peach, /Peach/, '缺库的这 4 条要回落到英文兜底句');
  assert.doesNotMatch(peach, /[\u4e00-\u9fa5]{3,}/, '兜底句里不该有中文句子');
  // 讲解还没回来（占位符）：英文模式下直接给英文那段
  assert.equal(matchGame.noteViewFor({ id: 'm-litchi-origin', fruit: '荔枝', note: '果灵正在讲解…' }), notes['m-litchi-origin']);
});

test('Chinese mode is untouched: the local English note is not used there', () => {
  useLang('zh');
  const src = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageGame/lib/match-game.js'), 'utf8');
  // 本地英文讲解只在 getLang()==='en' 分支出现，中文分支仍走原来的 fallback / 服务端
  assert.match(src, /if \(!context\) \{ deliver\(fallback\); return; \}/, '中文侧原来的兜底逻辑还在');
  assert.match(src, /const text = \(data && data\.knowledge && data\.knowledge\.length\) \? data\.knowledge : fallback;/, '中文侧仍用服务端讲解');
});
