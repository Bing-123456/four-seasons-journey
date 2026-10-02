'use strict';

// 我的小农场：每日浇水打卡。数据存 store 顶层 farm 字段（个人/演示分区隔离）。
// 设计边界：果苗不枯死、不倒退——漏浇只清零连续天数；成长只看累计浇水次数。
const clone = value => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;

// 成长阶段：阈值按累计浇水次数；阶段名取自真实生长过程。
const STAGES = [
  { key: 'seedling', label: '果苗', threshold: 0, note: '一株小苗，等待每天的照料。' },
  { key: 'sprout', label: '新芽', threshold: 2, note: '嫩芽舒展开，枝叶开始长大。' },
  { key: 'leaf', label: '展叶', threshold: 5, note: '真叶舒展，小苗更有精神了。' },
  { key: 'vine', label: '壮苗', threshold: 10, note: '枝叶渐渐茂盛，根系慢慢扎深。' },
  { key: 'flower', label: '开花', threshold: 18, note: '花朵开了，小果园迎来新的颜色。' },
  { key: 'fruit', label: '结果', threshold: 30, note: '累计照料满30天，小果园结果了。' }
];

const CROPS = [
  { id: 'watermelon', label: '西瓜' },
  { id: 'strawberry', label: '草莓' },
  { id: 'apple', label: '苹果' },
  { id: 'pear', label: '梨' },
  { id: 'grape', label: '葡萄' },
  { id: 'kiwi', label: '猕猴桃' }
];

function localDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const bits = value.split('-').map(Number);
    return new Date(bits[0], bits[1] - 1, bits[2], 12);
  }
  return value === undefined ? new Date() : new Date(value);
}
function today(date) {
  const target = localDate(date);
  if (!Number.isFinite(target.getTime())) throw new Error('日期无效');
  return target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0');
}
function yesterday(date) {
  const target = localDate(date);
  target.setDate(target.getDate() - 1);
  return today(target);
}
function daysBetween(from, to) {
  const a = localDate(from), b = localDate(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
}
function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && today(value) === value; }
function streakThrough(dates, end) {
  const days = new Set(dates); let cursor = end, streak = 0;
  while (days.has(cursor)) { streak += 1; cursor = yesterday(cursor); }
  return streak;
}

function blank(now) {
  return { version: 2, crop: '', plantedAt: today(now), totalWatered: 0, lastWateredDate: '', streak: 0, wateredDates: [], lastProverbDate: '', lastProverbId: -1 };
}
function normalize(value, now) {
  const base = blank(now);
  if (!value || typeof value !== 'object') return base;
  const out = base;
  if (typeof value.crop === 'string') {
    const match = CROPS.find(crop => crop.id === value.crop);
    if (match) out.crop = match.id;
  }
  if (typeof value.plantedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.plantedAt)) out.plantedAt = value.plantedAt;
  // 日历是累计成长的依据：去重、过滤非法/未来日期，避免旧计数与月历不一致。
  const currentDay = today(now);
  const recorded = Array.isArray(value.wateredDates) ? value.wateredDates : [value.lastWateredDate];
  out.wateredDates = Array.from(new Set(recorded.filter(date => validDay(date) && date <= currentDay))).sort().slice(-9999);
  out.totalWatered = out.wateredDates.length;
  out.lastWateredDate = out.wateredDates[out.wateredDates.length - 1] || '';
  out.streak = streakThrough(out.wateredDates, out.lastWateredDate === currentDay ? currentDay : yesterday(currentDay));
  if (typeof value.lastProverbDate === 'string') out.lastProverbDate = value.lastProverbDate.slice(0, 10);
  if (Number.isInteger(value.lastProverbId)) out.lastProverbId = value.lastProverbId;
  return out;
}

function stageOf(totalWatered) {
  let index = 0;
  STAGES.forEach((stage, i) => { if (totalWatered >= stage.threshold) index = i; });
  const current = STAGES[index];
  const next = STAGES[index + 1] || null;
  const progress = next ? Math.min(100, Math.round((totalWatered - current.threshold) / (next.threshold - current.threshold) * 100)) : 100;
  return { index, key: current.key, label: current.label, note: current.note, next: next ? next.key : null, wateringsToNext: next ? next.threshold - totalWatered : 0, progress };
}

function storage() {
  return (typeof wx !== 'undefined' && wx.getStorageSync) ? wx : null;
}

// 与 lib/store.js 的分区约定保持一致（personal/demo 两套存储键）。
const KEYS = { personal: 'guayouji.farm.v1', demo: 'guayouji.farm.demo.v1' };
function readRaw(partition) {
  const key = KEYS[partition] || KEYS.personal;
  const handle = storage();
  if (!handle) return global.__farmMemory && global.__farmMemory[key] || null;
  try { return handle.getStorageSync(key); } catch (error) { return null; }
}
function writeRaw(partition, value) {
  const key = KEYS[partition] || KEYS.personal;
  const handle = storage();
  if (!handle) { global.__farmMemory = global.__farmMemory || {}; global.__farmMemory[key] = value; return; }
  try { handle.setStorageSync(key, value); } catch (error) { /* 打卡失败不阻塞页面，下次可重试 */ }
}

function getState(partition, now) { return normalize(readRaw(partition), now); }
function plant(crop, partition, now) {
  const match = CROPS.find(item => item.id === crop);
  if (!match) throw new Error('请先选择一种水果');
  const state = blank(now ? today(now) : undefined);
  state.crop = match.id;
  writeRaw(partition, state);
  return clone(state);
}

// 返回 {ok, reason?, state, proverb?}。ok=false 表示今天已经浇过。
function water(proverbForDate, partition, now) {
  const nowDate = today(now);
  const state = normalize(readRaw(partition), now);
  if (!state.crop) throw new Error('先选一种水果，再开始浇水');
  if (state.wateredDates.includes(nowDate)) return { ok: false, reason: '今天已经浇过水啦，明早再来。', state: clone(state) };
  state.totalWatered += 1;
  state.streak = state.lastWateredDate === yesterday(nowDate) ? state.streak + 1 : 1;
  state.lastWateredDate = nowDate;
  state.wateredDates = (state.wateredDates || []).filter(date => date !== nowDate).concat(nowDate).sort().slice(-9999);
  const proverb = proverbForDate ? proverbForDate(nowDate) : null;
  if (proverb && proverb.id !== undefined) { state.lastProverbDate = nowDate; state.lastProverbId = proverb.id; }
  writeRaw(partition, state);
  return { ok: true, state: clone(state), stage: stageOf(state.totalWatered), proverb, firstTime: state.totalWatered === 1 };
}

function summary(partition, now) {
  const nowDate = today(now);
  const state = getState(partition, now);
  return {
    planted: !!state.crop,
    crop: state.crop, cropLabel: (CROPS.find(item => item.id === state.crop) || {}).label || '',
    stage: stageOf(state.totalWatered),
    growthProgress: Math.min(100, Math.round(state.totalWatered / 30 * 100)),
    totalWatered: state.totalWatered, streak: state.streak,
    wateredDates: state.wateredDates || [],
    canWater: !!state.crop && state.lastWateredDate !== nowDate,
    daysPlanted: Math.max(1, daysBetween(state.plantedAt, nowDate) + 1)
  };
}

module.exports = { STAGES, CROPS, getState, plant, water, summary, stageOf, today, yesterday, daysBetween, _normalize: normalize, _blank: blank };
