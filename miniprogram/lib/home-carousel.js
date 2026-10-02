'use strict';

// Match the measured shortcut row; each swiper item has a 5px card gutter.
function carouselLayout(width, contentWidth) {
  const cardWidth = Math.min(width - 10, Math.max(0, contentWidth));
  return { sideMargin: Math.max(0, (width - cardWidth - 10) / 2) };
}

// An async activity response must not reset a card the user is already reading.
function mergeActivities(previous, current, real) {
  const active = previous[current];
  const forecastPosters = previous.filter(item => !item.bookable).concat(real);
  const index = active ? forecastPosters.findIndex(item => item.id === active.id) : 0;
  return { forecastPosters, featureIndex: Math.max(0, index) };
}

module.exports = { carouselLayout, mergeActivities };
