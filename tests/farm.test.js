'use strict';

// 我的小农场：每日浇水打卡、成长阶段、连续天数与农谚按日轮换。
const test = require('node:test');
const assert = require('node:assert/strict');
const proverbs = require('../miniprogram/data/farm-proverbs');

const originalWx = global.wx;
let memory;
const farm = require('../miniprogram/lib/farm');
const DAY = 86400000;

function proverbFor(date) { return proverbs.proverbForDate(date); }

test.beforeEach(() => {
  memory = new Map();
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
    removeStorageSync: key => memory.delete(key)
  };
  global.__farmMemory = undefined;
});
test.after(() => { global.wx = originalWx; });

test('planting requires a known crop and starts at stage zero', () => {
  assert.throws(() => farm.plant('durian', 'personal'), /请先选择一种水果/);
  const state = farm.plant('watermelon', 'personal', '2026-09-20T08:00:00');
  assert.equal(state.crop, 'watermelon');
  assert.equal(state.totalWatered, 0);
  const summary = farm.summary('personal', '2026-09-20T08:00:00');
  assert.equal(summary.stage.label, '果苗');
  assert.equal(summary.canWater, true);
});

test('watering is once per local day and resumes across days', () => {
  farm.plant('strawberry', 'personal', '2026-09-20T08:00:00');
  const day1 = farm.water(proverbFor, 'personal', '2026-09-20T08:00:00');
  assert.equal(day1.ok, true);
  assert.equal(day1.firstTime, true);
  const again = farm.water(proverbFor, 'personal', '2026-09-20T15:00:00');
  assert.equal(again.ok, false);
  assert.match(again.reason, /今天已经浇过/);
  const day2 = farm.water(proverbFor, 'personal', '2026-09-21T08:00:00');
  assert.equal(day2.ok, true);
  assert.equal(day2.state.streak, 2, 'consecutive days increment the streak');
  const day3 = farm.water(proverbFor, 'personal', '2026-09-22T08:00:00');
  assert.equal(day3.state.streak, 3);
});

test('a missed day resets the streak but never removes growth', () => {
  farm.plant('apple', 'personal', '2026-09-20T08:00:00');
  farm.water(proverbFor, 'personal', '2026-09-20T08:00:00');
  farm.water(proverbFor, 'personal', '2026-09-21T08:00:00');
  assert.equal(farm.summary('personal', '2026-09-21T08:00:00').streak, 2);
  farm.water(proverbFor, 'personal', '2026-09-24T08:00:00'); // skipped 22nd & 23rd
  const summary = farm.summary('personal', '2026-09-24T08:00:00');
  assert.equal(summary.streak, 1, 'streak resets after a gap');
  assert.equal(summary.totalWatered, 3, 'cumulative growth is preserved');
  assert.equal(summary.stage.index >= 1, true);
});

test('growth stages advance by cumulative waterings and cap at fruit', () => {
  farm.plant('kiwi', 'personal', '2026-01-01T08:00:00');
  let last;
  // 30 actual watering days reach fruit; the 31st remains at the last stage.
  for (let i = 0; i < 31; i += 1) {
    const date = new Date(new Date('2026-01-01T08:00:00').getTime() + i * DAY).toISOString();
    last = farm.water(proverbFor, 'personal', date);
    assert.equal(last.ok, true, 'each day waters once at ' + date.slice(0, 10));
  }
  assert.equal(last.stage.label, '结果');
  assert.equal(last.stage.wateringsToNext, 0);
  assert.equal(last.stage.progress, 100);
});

test('daily proverb is stable within a day, differs across days, and follows the month', () => {
  farm.plant('pear', 'personal', '2026-09-23T08:00:00');
  const first = farm.water(proverbFor, 'personal', '2026-09-23T08:00:00');
  const second = farm.water(proverbFor, 'personal', '2026-09-23T20:00:00');
  assert.equal(second.ok, false, 'same day second attempt is blocked');
  assert.equal(first.proverb.id, proverbs.proverbForDate('2026-09-23').id);
  const next = farm.water(proverbFor, 'personal', '2026-09-24T08:00:00');
  assert.notEqual(next.proverb.id, first.proverb.id, 'next day brings another proverb');
  assert.equal(next.state.lastProverbDate, '2026-09-24');
});

test('personal and demo partitions never mix farm progress', () => {
  farm.plant('grape', 'personal', '2026-09-20T08:00:00');
  farm.water(proverbFor, 'personal', '2026-09-20T08:00:00');
  farm.plant('watermelon', 'demo', '2026-09-20T08:00:00');
  assert.equal(farm.summary('personal', '2026-09-20T08:00:00').crop, 'grape');
  assert.equal(farm.summary('demo', '2026-09-20T08:00:00').crop, 'watermelon');
  assert.equal(farm.summary('demo', '2026-09-20T08:00:00').totalWatered, 0);
});

test('corrupted storage normalizes instead of crashing the page', () => {
  memory.set('guayouji.farm.v1', { version: 1, crop: 'not-a-fruit', totalWatered: -5, streak: 'many', lastWateredDate: 'yesterday' });
  const summary = farm.summary('personal', '2026-09-20T08:00:00');
  assert.equal(summary.planted, false);
  assert.equal(summary.totalWatered, 0);
  assert.equal(summary.canWater, false, 'no crop planted, nothing to water');
});

test('proverb library is clean, large enough for daily rotation and honest', () => {
  assert.ok(proverbs.proverbs.length >= 4, 'rotate sourced sayings instead of padding with invented proverbs');
  for (const item of proverbs.proverbs) {
    assert.ok(item.text && item.text.length >= 6 && item.text.length <= 40, 'proverb length: ' + item.text);
    assert.ok(item.note && item.note.length >= 4, 'proverb needs a plain note');
    // 有 URL 必须是合法 https；民间口传/现代经验类不给 URL，但必须标注来源性质，绝不编造链接。
    if (item.sourceUrl) assert.match(item.sourceUrl, /^https:\/\//);
    assert.ok(item.sourceTitle && item.sourceTitle.length > 5, 'reader can identify the provenance');
    assert.equal(/[a-zA-Z]/.test(item.text), false, 'proverbs must not contain stray latin text');
    assert.equal(item.text.includes('。'), true);
  }
});
