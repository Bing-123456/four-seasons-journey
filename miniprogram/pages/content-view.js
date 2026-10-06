'use strict';

const catalog = require('../data/catalog');
const i18n = require('../lib/i18n');
const cloudImg = require('../lib/cloud-images');

// 把catalog 里记录的本地图片路径（如 /assets/henan-museum-real.jpg）换成云存储地址。
// 未在云图清单里配置的图保持原路径不变，行为与此前一致。
function toCloud(src) {
  if (typeof src !== 'string' || src.indexOf('/assets/') !== 0) return src;
  const key = src.replace('/assets/', '').replace(/\.(jpg|jpeg|png)$/i, '');
  const cloud = cloudImg.CLOUD[key];
  return cloud ? cloud : src;
}

function mediaFor(item) {
  item = item || {};
  let media = item.image;
  const collection = catalog.media || {};
  if (!media && item.mediaId) media = Array.isArray(collection) ? collection.find(entry => entry.id === item.mediaId) : collection[item.mediaId];
  if (typeof media === 'string') media = { src: media, credit: item.credit || '' };
  if (!media || !(media.src || media.path || media.url)) return null;
  return { src: toCloud(media.src || media.path || media.url), credit: media.credit || media.attribution || item.credit || i18n.t('cv_public_credit'), caption: media.caption || '', sourceUrl: media.sourceUrl || '', licenseUrl: media.licenseUrl || '' };
}

function placeView(place) {
  const image = mediaFor(place);
  const type = place.type || place.kind;
  const kindLabel = type === 'historical' ? i18n.t('cv_kind_history') : type === 'topic' ? i18n.t('cv_kind_topic') : i18n.t('cv_kind_place');
  const shownName = i18n.getLang() === 'en' && place.enName ? place.enName : place.name;
  return Object.assign({}, place, { name: shownName, imageView: image, kindLabel, statusLabel: place.routeEligible ? i18n.t('cv_status_route') : i18n.t('cv_status_info'), initial: shownName ? shownName.slice(0, 1) : i18n.t('cv_initial') });
}

function seasonalPlaces(season) {
  return catalog.places.filter(place => !place.season || place.season === 'all' || place.season === season || Array.isArray(place.seasons) && place.seasons.includes(season)).map(placeView);
}

module.exports = { mediaFor, placeView, seasonalPlaces };
