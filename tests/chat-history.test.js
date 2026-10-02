'use strict';

// 果灵对话 · 本地聊天记录基础设施：只存本机（分区隔离）、不上服务器。
// 覆盖：读写往返、字段净化（防脏数据回填 UI 与提示词）、容量上限、
// 分区隔离（个人/演示互不可见）、损坏数据容错、清空。
const test = require('node:test');
const assert = require('node:assert/strict');
const chatHistory = require('../miniprogram/lib/chat-history');
const store = require('../miniprogram/lib/store');

const originalWx = global.wx;

function memoryStorage() {
  const map = new Map();
  return {
    getStorageSync: key => (map.has(key) ? map.get(key) : ''),
    setStorageSync: (key, value) => { map.set(key, value); },
    removeStorageSync: key => { map.delete(key); },
    _map: map
  };
}

function elf(text, extra = {}) { return Object.assign({ id: 'm1', role: 'elf', text }, extra); }

test.beforeEach(() => {
  global.wx = memoryStorage();
  store.exitDemo(); store.clearAll();
});
test.after(() => { global.wx = originalWx; });

test('save and load round-trip keeps whitelist fields only', () => {
  const saved = chatHistory.save([
    elf('西瓜七月最甜。', { evidence: ['西瓜·四时素材'], followUps: ['西瓜怎么挑？'], chips: [{ fullId: 'summer-watermelon', name: '西瓜', seasonName: '夏', jumpLabel: '前往四时【西瓜】' }], junk: 'drop-me' }),
    { id: 'm2', role: 'user', text: '那冬瓜呢', hacker: 'inject' },
    { id: 'm3', role: 'system', text: 'should be dropped' },
    { id: 'm4', role: 'elf', text: '' },
    null
  ]);
  assert.equal(saved, true);
  const messages = chatHistory.load();
  assert.equal(messages.length, 2, 'system roles, empty texts and junk entries are dropped');
  assert.equal(messages[0].text, '西瓜七月最甜。');
  assert.deepEqual(messages[0].evidence, ['西瓜·四时素材']);
  assert.deepEqual(messages[0].followUps, ['西瓜怎么挑？']);
  assert.equal(messages[0].chips[0].fullId, 'summer-watermelon');
  assert.equal('junk' in messages[0], false, 'unknown fields never survive');
  assert.equal('hacker' in messages[1], false);
});

test('oversized history is capped and long texts truncated', () => {
  const many = [];
  for (let i = 0; i < 130; i += 1) many.push({ id: 'm' + i, role: 'user', text: '问题' + i + '：' + '长'.repeat(2000) });
  chatHistory.save(many);
  const messages = chatHistory.load();
  assert.equal(messages.length, chatHistory.MAX_MESSAGES, 'history caps at the newest 100 messages');
  assert.match(messages[messages.length - 1].text, /^问题129：/, 'newest message survives the cap');
  assert.ok(messages[0].text.length <= chatHistory.MAX_TEXT, 'each text is truncated');
  assert.ok(messages.every(item => item.text.length <= chatHistory.MAX_TEXT + 10));
});

test("personal and demo partitions never see each other's history", () => {
  chatHistory.save([elf('个人分区的对话')]);
  store.enterDemo();
  assert.equal(chatHistory.load().length, 0, 'demo starts with its own empty history');
  chatHistory.save([elf('演示分区的对话')]);
  store.exitDemo();
  const messages = chatHistory.load();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, '个人分区的对话');
});

test('corrupted storage degrades to an empty history instead of crashing', () => {
  global.wx.getStorageSync = () => ({ broken: 'not-an-array' });
  assert.deepEqual(chatHistory.load(), []);
  global.wx.getStorageSync = () => { throw new Error('storage broken'); };
  assert.deepEqual(chatHistory.load(), []);
  global.wx.setStorageSync = () => { throw new Error('quota exceeded'); };
  assert.equal(chatHistory.save([elf('依然能问')]), false, 'save failure is silent and non-blocking');
});

test('clear empties the stored history', () => {
  chatHistory.save([elf('要被清掉的')]);
  assert.equal(chatHistory.clear(), true);
  assert.deepEqual(chatHistory.load(), []);
});
