'use strict';

const catalog = require('../data/catalog');
const round = number => Math.round(number * 1000000) / 1000000;
const clone = value => JSON.parse(JSON.stringify(value));
const MARKER_ICON = '/assets/map-marker.png';
const MARKER_ICON_ACTIVE = '/assets/map-marker-active.png';
const MARKER_SIZE = 24;
const MARKER_SIZE_ACTIVE = 30;
const POLYLINE_COLOR = '#234B3CFF';

function formatDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '日期待确认';
  const parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '日期待确认';
  return Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日 · 周' + '日一二三四五六'[parsed.getUTCDay()];
}

function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) return '';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return remainder + '分钟';
  return hours + '小时' + (remainder ? remainder + '分' : '');
}

function displayName(name) {
  return typeof name === 'string' ? name.replace(/\s*[·・]\s*演示\s*$/, '').trim() : '';
}

function shortReason(reason) {
  if (typeof reason !== 'string') return '';
  let text = reason.trim().replace(/^匹配你的/, '').replace(/偏好$/, '');
  if (text === '补充本季文化体验') text = '本季文化体验';
  const chars = Array.from(text);
  return chars.length > 20 ? chars.slice(0, 19).join('') + '…' : text;
}

function validLocation(location) {
  return !!location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}

// Coordinates are sourced real reference locations in GCJ-02, not entrances.
function emptyMap() {
  return { mode: 'native', markers: [], polyline: [], includePoints: [], center: null, scale: 12,
    label: '地点参考图', note: '公开地点参考位置，入口请向场馆确认；虚线仅表示顺序，不是道路路线。' };
}
function buildMap(stops, origin) {
  const map = emptyMap();
  if (!stops.length || !stops.every(stop => validLocation(stop.location)) || !validLocation(origin)) return map;
  map.markers = stops.map(function (stop, index) {
    return { id: index, placeId: stop.placeId, latitude: round(stop.location.latitude), longitude: round(stop.location.longitude),
      iconPath: MARKER_ICON, width: MARKER_SIZE, height: MARKER_SIZE, anchor: { x: 0.5, y: 0.5 },
      callout: { content: stop.number + ' · ' + stop.displayName, display: 'BYCLICK', textAlign: 'center',
        bgColor: '#FBFAF1', color: '#2E4A38', fontSize: 11, borderRadius: 8, borderWidth: 1, borderColor: '#CBD8C4', padding: 6 } };
  });
  const start = { latitude: origin.latitude, longitude: origin.longitude };
  const stopPoints = map.markers.map(m => ({ latitude: m.latitude, longitude: m.longitude }));
  if (!stopPoints.some(p => Math.abs(p.latitude - start.latitude) + Math.abs(p.longitude - start.longitude) < 0.0001)) {
    map.markers.push({ id: 1000, placeId: '', latitude: start.latitude, longitude: start.longitude,
      iconPath: MARKER_ICON, width: 20, height: 20,
      callout: { content: '出发 · ' + origin.name, display: 'BYCLICK', color: '#234B3C', bgColor: '#FFFFFF', padding: 6, fontSize: 11, borderRadius: 8 } });
  }
  const points = [start].concat(stopPoints);
  const minLat = Math.min.apply(null, points.map(p => p.latitude)), maxLat = Math.max.apply(null, points.map(p => p.latitude));
  const minLng = Math.min.apply(null, points.map(p => p.longitude)), maxLng = Math.max.apply(null, points.map(p => p.longitude));
  const latPad = Math.max((maxLat-minLat)*0.32,0.002), lngPad = Math.max((maxLng-minLng)*0.35,0.003);
  map.includePoints = points.concat([{latitude:Math.max(-90,minLat-latPad),longitude:Math.max(-180,minLng-lngPad)},
    {latitude:Math.min(90,maxLat+latPad),longitude:Math.min(180,maxLng+lngPad)}]);
  map.center = { latitude: (minLat+maxLat)/2, longitude: (minLng+maxLng)/2 };
  map.polyline = [{ points: points.concat([start]), color: POLYLINE_COLOR, width: 3, dottedLine: true,
    arrowLine: true, borderColor: '#F3F1E4FF', borderWidth: 1 }];
  map.originName = origin.name;
  return map;
}

// Swap the marker icon of the expanded stop; idempotent so the page can apply
// it after every selection change without rebuilding the layer.
function activeMap(map, activePlaceId) {
  if (!map || !Array.isArray(map.markers) || !map.markers.length) return map;
  return Object.assign({}, map, {
    markers: map.markers.map(function (marker) {
      const active = !!activePlaceId && marker.placeId === activePlaceId;
      return Object.assign({}, marker, {
        iconPath: active ? MARKER_ICON_ACTIVE : MARKER_ICON,
        width: active ? MARKER_SIZE_ACTIVE : MARKER_SIZE,
        height: active ? MARKER_SIZE_ACTIVE : MARKER_SIZE,
        callout: Object.assign({}, marker.callout, { display: active ? 'ALWAYS' : 'BYCLICK' })
      });
    })
  });
}

function buildRoutePresentation(route, profile) {
  const context = route && route.profileSnapshot || profile || {};
  const dateLabel = formatDate(context.date);
  const transportLabel = { drive: '自驾', walk: '步行', public: '公交', bike: '骑行' }[context.transport] || '';
  const partyLabel = Number.isInteger(context.partySize) && context.partySize > 0 ? context.partySize + '人同行' : '';
  const result = { ok: false, dateLabel, durationLabel: '', timeLabel: '', summary: dateLabel, partyLabel, costLabel: '', transportLabel, stopCount: 0, stops: [], map: emptyMap(), reason: '' };
  if (!route || route.ok !== true || !Array.isArray(route.stops) || !route.stops.length) {
    result.reason = route && typeof route.reason === 'string' ? route.reason : '';
    return result;
  }
  const ids = new Set();
  const validStops = route.stops.length <= 5 && route.stops.every(function (stop) {
    if (!stop || typeof stop.placeId !== 'string' || ids.has(stop.placeId) || !catalog.places.some(place => place.id === stop.placeId)) return false;
    ids.add(stop.placeId);
    return true;
  });
  if (!validStops) {
    result.reason = '路线站点信息异常，请重新生成行程。';
    return result;
  }
  const stops = route.stops.map(function (stop, index) {
    const place = catalog.places.find(item => item.id === stop.placeId);
    const fact = catalog.facts.find(item => item.id === stop.factId);
    const tags = Array.isArray(stop.tags) ? stop.tags : [];
    return Object.assign(clone(stop), {
      displayName: displayName(stop.name || place.name), number: index + 1,
      shortReason: shortReason(stop.reason),
      tagLabels: tags.map(function (tag) {
        const interest = catalog.interests.find(item => item.id === tag);
        return interest ? interest.label : tag;
      }),
      hasSource: !!(fact && fact.sourceIds.length),
      location: place.location || null, address: place.address || ''
    });
  });
  const durationLabel = formatDuration(route.totalMinutes);
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const timeLabel = validTime(route.startTime) && validTime(route.endTime) ? route.startTime + '—' + route.endTime : '';
  const costLabel = typeof route.totalCost === 'number' && Number.isFinite(route.totalCost) && route.totalCost >= 0 ? '¥' + Number(route.totalCost.toFixed(2)) : '总费用待确认';
  return Object.assign(result, {
    ok: true, durationLabel, timeLabel, costLabel,
    summary: [dateLabel, durationLabel ? durationLabel + '估算含往返' : ''].filter(Boolean).join(' · '),
    stopCount: stops.length, stops, map: buildMap(stops, context.origin)
  });
}

function buildCatalogMap() {
  const venues = catalog.places.filter(p => p.routeEligible && validLocation(p.location));
  if (!venues.length) return emptyMap();
  const stops = venues.map((p, i) => ({ placeId: p.id, displayName: p.name, number: i + 1, location: p.location }));
  const map = buildMap(stops, Object.assign({ name: venues[0].name }, venues[0].location));
  return Object.assign(map, { mode: 'preview', polyline: [], originName: '', label: '河南文化地点',
    note: '真实地点参考图 · 选择起点后安排路线' });
}
module.exports = { buildRoutePresentation, activeMap, buildCatalogMap };
