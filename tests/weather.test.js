'use strict';

// Weather signal: public Open-Meteo data keyed by prefecture-city coordinates.
// Unit tests stay offline — only the mapping and summarizer are covered here.
const test = require('node:test');
const assert = require('node:assert/strict');
const weather = require('../miniprogram/lib/weather');

test('region picker values map to public city coordinates or honestly to none', () => {
  const zhengzhou = weather.coordsForRegion(['河南省', '郑州市', '中牟县']);
  assert.equal(zhengzhou.city, '郑州市');
  assert.equal(zhengzhou.latitude, 34.75);
  assert.equal(weather.coordsForRegion(['广东省', '广州市', '天河区']), null, 'only Henan cities are mapped in the prototype');
  assert.equal(weather.coordsForRegion(null), null);
  assert.equal(weather.coordsForRegion(['河南省']), null);
});

test('nearestCity derives a prefecture label from place coordinates within 70km', () => {
  assert.equal(weather.nearestCity({ latitude: 34.7878, longitude: 113.672 }), '郑州市'); // 河南博物院
  assert.equal(weather.nearestCity({ latitude: 34.799, longitude: 114.35 }), '开封市');   // 中牟东部靠开封
  assert.equal(weather.nearestCity({ latitude: 31.23, longitude: 121.47 }), '', 'outside Henan stays unknown');
  assert.equal(weather.nearestCity(null), '');
});

test('summarize counts wet days, temperature range and rain inside the seller window', () => {
  const daily = {
    time: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'],
    weather_code: [0, 61, 2, 80, 0, 3, 0],
    temperature_2m_max: [28, 24, 26, 25, 29, 27, 30],
    temperature_2m_min: [18, 19, 17, 18, 20, 19, 21],
    precipitation_sum: [0, 4.2, 0.1, 0.4, 0, 0, 0.2]
  };
  const summary = weather.summarize(daily, { start: '2026-09-22', end: '2026-09-24' });
  assert.equal(summary.available, true);
  assert.equal(summary.rainDays, 2, '61 中雨 and 80 阵雨 are wet; cloudy/drizzle codes with low precip are not');
  assert.equal(summary.windowRainDays, 2);
  assert.equal(summary.tempRange, '17–30℃');
  assert.ok(summary.label.includes('2 天降雨'));
  assert.ok(summary.source.includes('Open-Meteo'));

  const noWindow = weather.summarize(daily);
  assert.equal(noWindow.windowRainDays, null);
  assert.ok(noWindow.label.includes('未来 7 天'));
});

test('heavy drizzle without a rain code still counts as wet; missing data stays unavailable', () => {
  assert.equal(weather.isWet(0, 1.5), true);
  assert.equal(weather.isWet(61, 0), true);
  assert.equal(weather.isWet(2, 0.4), false);
  const empty = weather.summarize(null);
  assert.equal(empty.available, false);
  assert.equal(weather.summarize({ time: [] }).available, false);
});

test('fetchForecast rejects instead of fabricating when the environment cannot call out', () => {
  global.wx = undefined;
  return weather.fetchForecast({ latitude: 34.75, longitude: 113.63 }).then(
    () => { throw new Error('should reject'); },
    error => assert.match(error.message, /不支持网络请求/)
  );
});

test('missing, null, mismatched and invalid forecast measurements stay unknown', () => {
  const complete = { time: ['2026-09-25'], weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [10], precipitation_sum: [0] };
  for (const field of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum']) {
    for (const value of [undefined, [], [null], [''], [NaN], [Infinity]]) {
      const result = weather.summarize({ ...complete, [field]: value });
      assert.equal(result.available, false, field + ': ' + String(value));
      assert.match(result.label, /未知/);
      assert.equal(result.tempRange, undefined);
    }
  }
  assert.equal(weather.summarize({ time: complete.time }).available, false);
  assert.equal(weather.summarize({ ...complete, precipitation_sum: [-1] }).available, false);
  assert.equal(weather.summarize({ ...complete, temperature_2m_min: [30] }).available, false);
  const freezing = weather.summarize({ ...complete, temperature_2m_max: [0], temperature_2m_min: [0] });
  assert.equal(freezing.available, true, 'real numeric zero remains valid');
  assert.equal(freezing.tempRange, '0–0℃');
  assert.match(freezing.label, /未来 1 天无明显降雨/);
});

test('forecast HTTP success with incomplete weather is rejected before being cached', async t => {
  const previous = global.wx;
  t.after(() => { global.wx = previous; });
  global.wx = { request: options => options.success({ statusCode: 200, data: { daily: { time: ['2026-09-25'] } } }) };
  await assert.rejects(weather.fetchForecast({ latitude: 34.75, longitude: 113.63 }), /不完整/);
  global.wx = { request: options => options.success(null) };
  await assert.rejects(weather.fetchForecast({ latitude: 34.75, longitude: 113.63 }), /不完整/);
});

// P13：果农工作台的信号固定为虚拟演示值——仍按批次接待/采收窗口重算，
// 但不再请求真实公开气象，人流量同样是固定虚拟数据。
test('virtual demo signals are stable, window-aware and clearly labeled as demo data', () => {
  const summary = weather.virtualSummary({ start: '2026-09-26', end: '2026-09-28' }, '2026-09-26');
  assert.equal(summary.available, true);
  assert.equal(summary.label, '晴 · 微风 22℃');
  assert.equal(summary.source, '虚拟演示气象 · 非真实数据');
  assert.equal(summary.rainDays, 1, 'the demo forecast schedules one rain day');
  assert.equal(summary.windowRainDays, 1, 'the rain day falls inside this reception window');
  const before = weather.virtualSummary({ start: '2026-09-26', end: '2026-09-26' }, '2026-09-26');
  const again = weather.virtualSummary({ start: '2026-09-26', end: '2026-09-26' }, '2026-09-26');
  assert.deepEqual(before, again, 'the demo forecast is fixed, not random');
  assert.equal(before.windowRainDays, 0);
  const tourism = weather.virtualTourism();
  assert.equal(tourism.available, true);
  assert.equal(tourism.virtual, true);
  assert.equal(tourism.totalTrips, 12);
  assert.equal(tourism.totalParties, 35);
  assert.ok(Array.isArray(tourism.top) && tourism.top.length > 0);
});
