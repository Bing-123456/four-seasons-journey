'use strict';

// Real weather signal from Open-Meteo (public, keyless, non-commercial terms).
// Batch regions come from the WeChat region picker as [province, city, county];
// we map the prefecture city to an approximate public center coordinate. When
// the region is outside the table or the request fails, the signal honestly
// reports unknown — the fetch path never fabricates weather.
// P13 评审修改：果农工作台的展示与解读改用下方固定虚拟演示信号
// （virtualForecast/virtualSummary/virtualTourism），并明确标注为虚拟数据；
// 真实请求通道保留给其他消费方与测试。
const CITY_COORDS = {
  '郑州市': [34.75, 113.63], '开封市': [34.80, 114.31], '洛阳市': [34.66, 112.45], '平顶山市': [33.77, 113.19],
  '安阳市': [36.10, 114.39], '鹤壁市': [35.75, 114.30], '新乡市': [35.30, 113.93], '焦作市': [35.22, 113.24],
  '濮阳市': [35.76, 115.03], '许昌市': [34.04, 113.85], '漯河市': [33.58, 114.05], '三门峡市': [34.77, 111.20],
  '南阳市': [32.99, 112.53], '商丘市': [34.41, 115.66], '信阳市': [32.15, 114.09], '周口市': [33.63, 114.70],
  '驻马店市': [33.01, 114.02], '济源市': [35.07, 112.60]
};

function coordsForRegion(region) {
  if (!Array.isArray(region) || region.length < 2 || typeof region[1] !== 'string') return null;
  const coords = CITY_COORDS[region[1]];
  return coords ? { latitude: coords[0], longitude: coords[1], city: region[1] } : null;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad, dlng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

// Derive the prefecture city label for a catalog place from its GCJ-02
// coordinates; places carry only `province`, so nearest-city within 70 km is
// used for the visitor-flow aggregation.
function nearestCity(point) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return '';
  let best = null;
  Object.keys(CITY_COORDS).forEach(name => {
    const coords = CITY_COORDS[name];
    const distance = distanceKm(point, { latitude: coords[0], longitude: coords[1] });
    if (!best || distance < best.distance) best = { name, distance };
  });
  return best && best.distance <= 70 ? best.name : '';
}

const WEATHER_TEXT = {
  0: '晴', 1: '基本晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '小毛雨', 53: '毛雨', 55: '浓毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨', 71: '小雪', 73: '中雪', 75: '大雪',
  80: '阵雨', 81: '强阵雨', 82: '暴雨', 95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷雨伴冰雹'
};
function codeText(code) { return WEATHER_TEXT[code] || '天气代码 ' + code; }

function validForecast(daily) {
  if (!daily || !Array.isArray(daily.time) || !daily.time.length) return false;
  if (daily.time.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')))) return false;
  const fields = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'];
  if (fields.some(field => !Array.isArray(daily[field]) || daily[field].length !== daily.time.length || daily[field].some(value => typeof value !== 'number' || !Number.isFinite(value)))) return false;
  return daily.time.every((_, index) => Number.isInteger(daily.weather_code[index]) && daily.weather_code[index] >= 0 && daily.precipitation_sum[index] >= 0 && daily.temperature_2m_max[index] >= daily.temperature_2m_min[index]);
}

function fetchForecast(coords) {
  return new Promise((resolve, reject) => {
    if (!coords) { reject(new Error('地区暂无坐标映射')); return; }
    if (typeof wx === 'undefined' || !wx.request) { reject(new Error('当前环境不支持网络请求')); return; }
    wx.request({
      url: 'https://api.open-meteo.com/v1/forecast',
      method: 'GET',
      data: {
        latitude: coords.latitude, longitude: coords.longitude,
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'Asia/Shanghai', forecast_days: 7
      },
      timeout: 8000,
      success: response => {
        const daily = response && response.data && response.data.daily;
        if (!response || response.statusCode !== 200 || !validForecast(daily)) { reject(new Error('气象数据缺失或不完整')); return; }
        resolve(daily);
      },
      fail: error => reject(new Error((error && error.errMsg) || '气象请求失败'))
    });
  });
}

function isWet(code, precipitation) { return [61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(Number(code)) || Number(precipitation) >= 1; }

// Build the display summary. `window` is optional ({start, end} ISO dates) to
// flag rain days falling inside the seller's reception/harvest window.
function summarize(daily, window) {
  if (!validForecast(daily)) return { available: false, reason: '气象数据缺失或不完整', label: '未知 · 气象数据缺失或不完整' };
  const codeAt = index => daily.weather_code[index];
  const days = daily.time.map((date, index) => ({
    date, code: codeAt(index), text: codeText(codeAt(index)),
    max: Math.round(daily.temperature_2m_max[index]),
    min: Math.round(daily.temperature_2m_min[index]),
    precipitation: Math.round(daily.precipitation_sum[index] * 10) / 10
  }));
  const rainDays = days.filter(day => isWet(day.code, day.precipitation));
  const temps = days.map(day => day.max).concat(days.map(day => day.min)).filter(value => Number.isFinite(value));
  const windowStart = window && window.start || '';
  const windowEnd = window && window.end || '';
  const inWindow = windowStart && windowEnd ? days.filter(day => day.date >= windowStart && day.date <= windowEnd) : [];
  const rainInWindow = inWindow.filter(day => isWet(day.code, day.precipitation));
  return {
    available: true,
    source: 'Open-Meteo 公开气象 · 仅供参考',
    days, rainDays: rainDays.length,
    tempRange: temps.length ? Math.min.apply(null, temps) + '–' + Math.max.apply(null, temps) + '℃' : '未知',
    windowRainDays: inWindow.length ? rainInWindow.length : null,
    label: '未来 ' + days.length + ' 天' + (rainDays.length ? '有 ' + rainDays.length + ' 天降雨' : '无明显降雨') + '，气温 ' + (temps.length ? Math.min.apply(null, temps) + '–' + Math.max.apply(null, temps) + '℃' : '未知')
      + (inWindow.length ? '；接待/采收窗口内 ' + rainInWindow.length + ' 天有雨' : '')
  };
}

// P13 评审修改：果农工作台的信号改为固定虚拟演示值，不再请求真实公开气象，
// 也不再展示「未知 · 正在获取公开气象」。虚拟预报仍走 summarize 的窗口计算，
// 让「重新生成解读」拿到的天气/人流量与页面展示同一口径（中牟西瓜演示批次）。
const VIRTUAL_LABEL = '晴 · 微风 22℃';
const VIRTUAL_DAILY = {
  weather_code: [0, 80, 0, 1, 0, 2, 0],
  temperature_2m_max: [26, 24, 27, 25, 26, 23, 25],
  temperature_2m_min: [15, 16, 15, 14, 16, 13, 15],
  precipitation_sum: [0, 1.2, 0, 0, 0, 0, 0]
};
// 与 seller-core.today() 同口径的本地日期，避免 UTC 日期在深夜与本地相差一天。
function localToday() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
function virtualForecast(now) {
  const base = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now) ? now : localToday();
  const startMs = Date.parse(base + 'T00:00:00Z');
  const time = VIRTUAL_DAILY.weather_code.map((_, index) => new Date(startMs + index * 86400000).toISOString().slice(0, 10));
  return {
    time,
    weather_code: VIRTUAL_DAILY.weather_code.slice(),
    temperature_2m_max: VIRTUAL_DAILY.temperature_2m_max.slice(),
    temperature_2m_min: VIRTUAL_DAILY.temperature_2m_min.slice(),
    precipitation_sum: VIRTUAL_DAILY.precipitation_sum.slice()
  };
}
// 固定虚拟天气摘要：label 用演示口径短句；windowRainDays 仍按接待/采收窗口计算，
// 供解读体现「天气影响采收」。
function virtualSummary(window, now) {
  const summary = summarize(virtualForecast(now), window);
  if (!summary.available) return summary;
  summary.source = '虚拟演示气象 · 非真实数据';
  summary.label = VIRTUAL_LABEL;
  return summary;
}
// 固定虚拟人流量：演示口径的预约/到访信号，不来自真实预约数据。
function virtualTourism() {
  return {
    available: true,
    source: 'virtual-demo',
    virtual: true,
    totalTrips: 12,
    totalParties: 35,
    top: [{ name: '周末亲子到访', count: 14 }, { name: '研学团队到访', count: 12 }]
  };
}

module.exports = { CITY_COORDS, coordsForRegion, nearestCity, fetchForecast, summarize, codeText, isWet, virtualForecast, virtualSummary, virtualTourism };
