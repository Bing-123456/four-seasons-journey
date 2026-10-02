'use strict';

// Device-level aggregation of tourist trip planning: when a visitor customizes
// a trip containing a place, we count {place, trip month, party size}. Only
// anonymous counts are stored — never names, notes or any personal data. The
// seller's AI prediction page reads this as the local visitor-flow signal.
const catalog = require('../data/catalog');
const weather = require('./weather');
const KEY = 'guayouji.visitor-flow.v1';
const MAX_MONTHS = 6;
const MAX_PLACES_PER_MONTH = 100;
const memory = {};

function readRaw() {
  try { return typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync(KEY) : memory[KEY]; } catch (error) { return memory[KEY]; }
}
function writeRaw(value) {
  if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try { wx.setStorageSync(KEY, value); } catch (error) { /* 存储失败时保留内存态，信号非关键数据 */ }
  }
  memory[KEY] = value;
}
function empty() { return { version: 1, months: {} }; }
function normalize(value) {
  if (!value || typeof value !== 'object' || typeof value.months !== 'object' || Array.isArray(value.months)) return empty();
  const months = {};
  Object.keys(value.months).filter(key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)).forEach(key => {
    const month = value.months[key];
    if (!month || typeof month !== 'object' || typeof month.places !== 'object') return;
    const places = {};
    Object.keys(month.places).slice(0, MAX_PLACES_PER_MONTH).forEach(id => {
      const item = month.places[id];
      if (!item || typeof item !== 'object' || typeof item.name !== 'string') return;
      places[id] = {
        name: String(item.name).slice(0, 80), city: typeof item.city === 'string' ? item.city.slice(0, 40) : '',
        trips: Math.max(0, Math.floor(Number(item.trips) || 0)), parties: Math.max(0, Math.floor(Number(item.parties) || 0))
      };
    });
    months[key] = { places, trips: Math.max(0, Math.floor(Number(month.trips) || 0)), lastFingerprint: typeof month.lastFingerprint === 'string' ? month.lastFingerprint.slice(0, 500) : '' };
  });
  return { version: 1, months };
}
function monthKey(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : ''; }
function pruneMonths(state) {
  const keys = Object.keys(state.months).sort();
  while (keys.length > MAX_MONTHS) { delete state.months[keys.shift()]; }
  return state;
}

function placeMeta(placeId) {
  const place = catalog.places.find(item => item.id === placeId);
  if (!place) return null;
  return { name: place.name, city: place.city || weather.nearestCity(place.location), province: place.province || '' };
}

// route: the object saved by store.saveRoute — stops carry placeId, the
// snapshot carries the trip date and party size. Idempotent per route id so
// regenerating unchanged trips does not double count.
function recordTrip(route) {
  if (!route || route.ok !== true || !Array.isArray(route.stops) || !route.stops.length) return false;
  const month = monthKey(route.profileSnapshot && route.profileSnapshot.date);
  if (!month) return false;
  const parties = Number(route.profileSnapshot && route.profileSnapshot.partySize);
  const partySize = Number.isInteger(parties) && parties > 0 && parties <= 20 ? parties : 2;
  const state = normalize(readRaw());
  const bucket = state.months[month] || { places: {}, trips: 0 };
  const fingerprint = 't' + String(route.id || '') + '|' + route.stops.map(stop => stop.placeId).join(',');
  if (bucket.lastFingerprint === fingerprint) return false;
  let known = 0;
  route.stops.forEach(stop => {
    const meta = placeMeta(stop.placeId);
    if (!meta) return;
    known += 1;
    const entry = bucket.places[stop.placeId] || { name: meta.name, city: meta.city, trips: 0, parties: 0 };
    entry.name = meta.name; entry.city = meta.city;
    entry.trips += 1; entry.parties += partySize;
    bucket.places[stop.placeId] = entry;
  });
  if (!known) return false; // 行程里没有可识别地点时不制造信号
  bucket.trips += 1;
  bucket.lastFingerprint = fingerprint;
  state.months[month] = bucket;
  writeRaw(pruneMonths(state));
  return true;
}

// Seller-side summary: months from `from` (YYYY-MM) onward, optionally limited
// to places near the seller's city. Returns a plain, sortable list.
function summarize(options) {
  const config = options || {};
  const from = monthKey((config.from || '') + '-01') ? String(config.from).slice(0, 7) : '';
  const state = normalize(readRaw());
  const rows = [];
  Object.keys(state.months).sort().forEach(month => {
    if (from && month < from) return;
    const bucket = state.months[month];
    Object.keys(bucket.places).forEach(id => {
      const entry = bucket.places[id];
      if (config.city && entry.city && entry.city !== config.city) return;
      rows.push({ placeId: id, month, name: entry.name, city: entry.city, trips: entry.trips, parties: entry.parties });
    });
  });
  rows.sort((a, b) => b.parties - a.parties || (a.month < b.month ? 1 : -1));
  const totalParties = rows.reduce((sum, row) => sum + row.parties, 0);
  // totalTrips counts distinct planned trips (per-month buckets), so a
  // multi-stop itinerary is one trip, not one per stop. A city filter counts
  // only months that actually contain a matching place.
  const monthsWithRows = new Set(rows.map(row => row.month));
  const totalTrips = [...monthsWithRows].reduce((sum, month) => sum + (state.months[month].trips || 0), 0);
  return {
    months: rows.length ? [rows[rows.length - 1].month, rows[0].month].filter((v, i, a) => a.indexOf(v) === i) : [],
    totalTrips, totalParties, top: rows.slice(0, 5), all: rows,
    label: rows.length
      ? '近' + (rows.length > 5 ? '多期' : rows.map(row => row.month).filter((v, i, a) => a.indexOf(v) === i).join('、')) + ' 本机游客行程 ' + totalTrips + ' 次 Mention ' + totalParties + ' 人次'
      : '未知 · 本机还没有游客行程信号',
    simulated: false
  };
}

function clearAll() { writeRaw(empty()); }
function snapshot() { return normalize(readRaw()); }

module.exports = { recordTrip, summarize, snapshot, clearAll, _normalize: normalize };
