'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { carouselLayout, mergeActivities } = require('../miniprogram/lib/home-carousel');

test('active cards align with the measured shortcut row across screen widths', () => {
  for (const [width, contentWidth] of [[320, 296], [375, 347], [430, 398], [768, 710]]) {
    const { sideMargin } = carouselLayout(width, contentWidth);
    const cardWidth = width - 2 * sideMargin - 10;
    assert.equal(cardWidth, contentWidth);
    assert.equal(sideMargin + 5, (width - contentWidth) / 2);
    assert.ok(sideMargin >= 0);
  }
});

test('activity responses preserve the selected poster and do not duplicate real activities', () => {
  const samples = ['a', 'b', 'c'].map(id => ({ id, bookable: false }));
  const real = [{ id: 'live', bookable: true }];
  const result = mergeActivities(samples, 2, real);
  assert.equal(result.forecastPosters[result.featureIndex].id, 'c');
  assert.equal(result.featureIndex, 2);
  const repeated = mergeActivities(result.forecastPosters, 3, real);
  assert.equal(repeated.forecastPosters.length, 4);
  assert.equal(repeated.forecastPosters[repeated.featureIndex].id, 'live');
});

test('removing the selected live activity returns to a valid poster', () => {
  const result = mergeActivities([{ id: 'sample', bookable: false }, { id: 'gone', bookable: true }], 1, []);
  assert.equal(result.featureIndex, 0);
  assert.equal(result.forecastPosters[0].id, 'sample');
});
