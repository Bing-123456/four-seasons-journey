'use strict';

// Visitor-flow aggregation: anonymous counts of tourist trip planning, keyed by
// place + trip month, feeding the seller AI prediction signal.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../miniprogram/data/catalog');
const flow = require('../miniprogram/lib/visitor-flow');

const originalWx = global.wx;
let memory;
const venue = catalog.places[0];
const cityOfVenue = require('../miniprogram/lib/weather').nearestCity(venue.location);

function route(id, date, partySize, placeIds) {
  return {
    ok: true, id,
    stops: (placeIds || [venue.id]).map(placeId => ({ placeId })),
    profileSnapshot: { date, partySize }
  };
}

test.beforeEach(() => {
  memory = new Map();
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
    removeStorageSync: key => memory.delete(key)
  };
  flow.clearAll();
});
test.after(() => { global.wx = originalWx; });

test('records trips per place and month with party sizes, idempotent per route id', () => {
  assert.equal(flow.recordTrip(route('r1', '2026-09-18', 3)), true);
  assert.equal(flow.recordTrip(route('r1', '2026-09-18', 3)), false, 'same route id must not double count');
  assert.equal(flow.recordTrip(route('r2', '2026-09-20', 2)), true);
  const snapshot = flow.snapshot();
  const entry = snapshot.months['2026-09'].places[venue.id];
  assert.equal(entry.trips, 2);
  assert.equal(entry.parties, 5);
  assert.equal(entry.name, venue.name);
  assert.equal(snapshot.months['2026-09'].trips, 2);
});

test('invalid routes and unknown months are ignored instead of polluting the signal', () => {
  assert.equal(flow.recordTrip(null), false);
  assert.equal(flow.recordTrip({ ok: false }), false);
  assert.equal(flow.recordTrip({ ok: true, stops: [], profileSnapshot: { date: '2026-09-18', partySize: 2 } }), false);
  assert.equal(flow.recordTrip({ ok: true, stops: [{ placeId: venue.id }], profileSnapshot: { date: 'not-a-date', partySize: 2 } }), false);
  assert.equal(flow.recordTrip({ ok: true, stops: [{ placeId: 'ghost-place' }], profileSnapshot: { date: '2026-09-18', partySize: 2 } }), false);
  assert.deepEqual(flow.snapshot().months, {});
});

test('summarize aggregates months, ranks top places and honours the city filter', () => {
  flow.recordTrip(route('r1', '2026-09-18', 3));
  flow.recordTrip(route('r2', '2026-08-09', 2));
  const all = flow.summarize({});
  assert.equal(all.totalTrips, 2);
  assert.equal(all.totalParties, 5);
  assert.equal(all.top[0].placeId, venue.id);
  assert.ok(all.label.includes('人次'));

  const sameCity = flow.summarize({ city: cityOfVenue });
  assert.equal(sameCity.totalTrips, 2, 'venue city is derived from its coordinates');
  const otherCity = flow.summarize({ city: '洛阳市' });
  assert.equal(otherCity.totalTrips, 0);

  const fromSeptember = flow.summarize({ from: '2026-09' });
  assert.equal(fromSeptember.totalTrips, 1);
});

test('aggregation keeps at most six months and stores no personal data', () => {
  for (let index = 0; index < 8; index += 1) {
    const month = String(2026 - Math.floor(index / 12)).padStart(4, '0') + '-' + String(12 - (index % 12)).padStart(2, '0');
    flow.recordTrip(route('r' + index, month + '-10', 2));
  }
  const snapshot = flow.snapshot();
  assert.ok(Object.keys(snapshot.months).length <= 6, 'older months must be pruned');
  const serialized = JSON.stringify(snapshot);
  for (const banned of ['profile', 'nickname', 'note', 'optInSupport', 'origin']) {
    assert.equal(serialized.includes(banned), false, 'signal must stay anonymous: ' + banned);
  }
});

test('corrupted storage is re-normalized instead of crashing the seller view', () => {
  memory.set('guayouji.visitor-flow.v1', { version: 1, months: { '2026-13': { places: {} }, '2026-09': 'not-an-object', garbage: true } });
  assert.deepEqual(flow.snapshot().months, {});
  const summary = flow.summarize({});
  assert.equal(summary.totalTrips, 0);
  assert.ok(summary.label.includes('未知'));
});
