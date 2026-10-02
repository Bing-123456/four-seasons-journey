'use strict';

const catalog = require('../data/catalog');
const geo = require('./geo');
const evidence = require('./evidence');
const allowedTransport = ['drive', 'walk', 'public', 'bike'];
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round(value * 100) / 100;
const byId = id => catalog.places.find(place => place.id === id);
const timeMinutes = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const timeLabel = value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');

function profileErrors(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return ['出行条件格式不正确'];
  const errors = [];
  if (!catalog.seasons.some(s => s.id === profile.season)) errors.push('请选择有效的四时文化专题');
  if (typeof profile.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(profile.date) || Number.isNaN(Date.parse(profile.date + 'T12:00:00Z')) || new Date(profile.date + 'T12:00:00Z').toISOString().slice(0, 10) !== profile.date) errors.push('请输入有效日期');
  if (!Number.isFinite(timeMinutes(profile.startTime))) errors.push('出发时间格式应为 HH:mm');
  if (!Number.isInteger(profile.duration) || profile.duration < 30 || profile.duration > 720) errors.push('行程时长应为30—720分钟');
  if (typeof profile.budget !== 'number' || !Number.isFinite(profile.budget) || profile.budget < 0 || profile.budget > 100000) errors.push('团队总预算应为0—100000元');
  if (!Number.isInteger(profile.partySize) || profile.partySize < 1 || profile.partySize > 20) errors.push('同行人数应为1—20人');
  if (!allowedTransport.includes(profile.transport)) errors.push('请选择有效交通方式');
  if (!['easy', 'normal'].includes(profile.walking)) errors.push('请选择有效步行强度');
  if (!Array.isArray(profile.interests) || profile.interests.length > 6 || profile.interests.some(id => !catalog.interests.some(interest => interest.id === id)) || new Set(profile.interests).size !== profile.interests.length) errors.push('偏好标签不正确');
  if (typeof profile.note !== 'string' || profile.note.length > 2000) errors.push('出行备注不能超过2000字');
  if (typeof profile.optInSupport !== 'boolean') errors.push('助农偏好需由用户确认');
  if (profile.origin != null && !geo.validOrigin(profile.origin)) errors.push('请选择有效的真实出发地点');
  return errors;
}

function chineseNumber(value) {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const nums = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let digit = 0;
  for (const c of value) {
    if (Object.prototype.hasOwnProperty.call(nums, c)) digit = nums[c];
    else if (c === '十' || c === '百' || c === '千') { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[c]); digit = 0; }
    else return NaN;
  }
  return total + digit;
}

function parseProfile(text, base) {
  if (typeof text !== 'string' || text.length > 2000) throw new Error('请用2000字以内描述出行需求');
  const profile = Object.assign(clone(catalog.defaultProfile), base && typeof base === 'object' && !Array.isArray(base) ? clone(base) : {});
  const seen = {};
  const value = text.trim();
  let match;
  const number = '([0-9一二两三四五六七八九十百千]+(?:\\.[0-9]+)?)';
  if (/秋|猕猴桃/.test(value)) { profile.season = 'autumn'; seen.season = true; }
  else if (/春|草莓/.test(value)) { profile.season = 'spring'; seen.season = true; }
  else if (/冬|苹果/.test(value)) { profile.season = 'winter'; seen.season = true; }
  else if (/夏|西瓜/.test(value)) { profile.season = 'summer'; seen.season = true; }
  if ((match = value.match(/(20\d{2})[年\-/](\d{1,2})[月\-/](\d{1,2})日?/))) {
    profile.date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0'); seen.date = true;
  } else if ((match = value.match(/(\d{1,2})月(\d{1,2})[日号]/))) {
    profile.date = profile.date.slice(0, 4) + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0'); seen.date = true;
  }
  if (seen.date && !seen.season) {
    const month = Number(profile.date.slice(5, 7));
    if (month >= 6 && month <= 8) profile.season = 'summer';
    if (month >= 9 && month <= 11) profile.season = 'autumn';
    if (month >= 3 && month <= 5) profile.season = 'spring';
    if ([12, 1, 2].includes(month)) profile.season = 'winter';
  }
  if ((match = value.match(/(上午|下午|晚上|早上|中午)?\s*(\d{1,2})[:：](\d{2})/))) {
    let hour = Number(match[2]); if (['下午', '晚上'].includes(match[1]) && hour < 12) hour += 12;
    profile.startTime = String(hour).padStart(2, '0') + ':' + match[3]; seen.startTime = true;
  } else if ((match = value.match(new RegExp('(上午|下午|晚上|早上|中午)?\\s*' + number + '点(半)?')))) {
    let hour = chineseNumber(match[2]); if (['下午', '晚上'].includes(match[1]) && hour < 12) hour += 12;
    profile.startTime = String(hour).padStart(2, '0') + ':' + (match[3] ? '30' : '00'); seen.startTime = true;
  }
  if ((match = value.match(new RegExp(number + '(?:个)?半小时')))) { profile.duration = chineseNumber(match[1]) * 60 + 30; seen.duration = true; }
  else if ((match = value.match(new RegExp(number + '(?:个)?小时(半)?')))) { profile.duration = chineseNumber(match[1]) * 60 + (match[2] ? 30 : 0); seen.duration = true; }
  else if ((match = value.match(new RegExp(number + '分钟')))) { profile.duration = chineseNumber(match[1]); seen.duration = true; }
  else if (/半天/.test(value)) { profile.duration = 240; seen.duration = true; }
  else if (/一天|一整天/.test(value)) { profile.duration = 480; seen.duration = true; }
  const partyMentions = [], partyPattern = new RegExp(number + '(?:个)?人', 'g');
  while ((match = partyPattern.exec(value))) {
    if (!/(?:不是|不要|不想|不带)\s*$/.test(value.slice(Math.max(0, match.index - 5), match.index))) partyMentions.push(match);
  }
  if (partyMentions.length === 1) { profile.partySize = chineseNumber(partyMentions[0][1]); seen.partySize = true; }
  // Per-person budgets are intentionally not misread as a team total.
  if ((match = value.match(new RegExp('人均\\s*(?:预算)?\\s*[¥￥]?\\s*' + number)))) {
    if (seen.partySize) { profile.budget = chineseNumber(match[1]) * profile.partySize; seen.budget = true; }
  } else if ((match = value.match(new RegExp('(?:总预算|预算|总共|总计)\\s*(?:是|为|在|不超过)?\\s*[¥￥]?\\s*' + number)))) { profile.budget = chineseNumber(match[1]); seen.budget = true; }
  const transportText = value.replace(/(?:不想|不要|不愿|不能|不|别|没有)(?:再|去|坐)?(?:自驾|开车|骑行|骑车|自行车|公交|公共交通|坐车|步行|走路)/g, '');
  const transportMentions = [
    ['drive', /自驾|开车/], ['bike', /骑行|骑车|自行车/], ['public', /公交|公共交通|坐车/], ['walk', /步行|走路/]
  ].filter(item => item[1].test(transportText) && !(item[0] === 'walk' && /少走路/.test(transportText)));
  if (transportMentions.length === 1) { profile.transport = transportMentions[0][0]; seen.transport = true; }
  if (/少走|轻松|老人|慢|不想走路/.test(value)) profile.walking = 'easy';
  if (/正常步行|能走路/.test(value)) profile.walking = 'normal';
  const patterns = { culture: /文化|历史|非遗/, family: /亲子|孩子|儿童|带娃/, nature: /自然|采摘|果园|田园/, photo: /拍照|摄影/, food: /美食|吃|风味|手作/, slow: /慢|轻松|休息/ };
  const negatives = { culture: /(?:不想|不要|不喜欢|不|别)(?:去)?(?:看|了解|听)?(?:文化|历史|非遗)/, family: /不带娃|没有孩子/, nature: /(?:不想|不要|不|别)(?:去)?(?:采摘|自然|果园|田园)/, photo: /(?:不想|不要|不喜欢|不|别)(?:去)?(?:拍照|摄影)/, food: /不(?:想|要)?吃/, slow: /不想慢/ };
  const selected = Object.keys(patterns).filter(key => patterns[key].test(value) && !negatives[key].test(value));
  if (selected.length) profile.interests = selected;
  else profile.interests = (Array.isArray(profile.interests) ? profile.interests : []).filter(key => negatives[key] && !negatives[key].test(value));
  profile.note = value;
  const missingFields = ['date', 'startTime', 'duration', 'budget', 'partySize'].filter(key => !seen[key]);
  if (/自驾|开车|骑行|骑车|自行车|公交|公共交通|坐车|步行|走路/.test(value) && !seen.transport && !/少走路|不想走路|不要走路/.test(value)) missingFields.push('transport');
  // Missing fields retain the editable base values. Invalid explicit values are returned for UI correction.
  return { profile, missingFields, mode: 'local-rules' };
}

function travel(fromId, toId, profile) {
  const from = fromId ? byId(fromId) : null, to = toId ? byId(toId) : null;
  return geo.estimateLeg(from ? from.location : profile.origin, to ? to.location : profile.origin, profile);
}
function routeFailure(profile, reason) {
  return { ok: false, id: '', reason, warnings: [], totalMinutes: 0, totalCost: null,
    travelMinutes: 0, visitMinutes: 0, startTime: profile && profile.startTime || '', endTime: '',
    season: profile && profile.season || '', mode: 'estimated', stops: [] };
}
function knownFee(place, size) { return typeof place.price === 'number' && Number.isFinite(place.price) ? round(place.price * size) : null; }
function isClosed(place, date) { return (place.closedWeekdays || []).includes(new Date(date + 'T12:00:00Z').getUTCDay()); }
function eligible(place, profile) {
  return place.routeEligible === true && place.demo === false && geo.validLocation(place.location)
    && !isClosed(place, profile.date)
    && (!Number.isInteger(place.capacity) || place.capacity >= profile.partySize);
}
function generateRoute(profile, options) {
  const errors = profileErrors(profile);
  if (errors.length) return routeFailure(profile, errors.join('；'));
  if (!geo.validOrigin(profile.origin)) return routeFailure(profile, '请先选择真实出发地点，再安排路线。');
  if (profile.transport === 'public') return routeFailure(profile, '公交需班次与换乘信息，当前暂不生成公交时间表；请选择步行、自驾或骑行。');
  const excludedIds = options && Array.isArray(options.excludedIds) ? [...new Set(options.excludedIds.filter(id => byId(id)))] : [];
  const candidates = catalog.places.filter(p => eligible(p, profile) && !excludedIds.includes(p.id));
  if (!candidates.length) return routeFailure(profile, '没有符合日期与排除条件的可规划地点，请调整日期或恢复站点。');
  if (candidates.every(p => geo.distanceKm(profile.origin, p.location) > 80)) return routeFailure(profile, '当前路线覆盖郑州文化地点；起点距离过远，请先选择郑州附近的出发位置。');
  const start = timeMinutes(profile.startTime), deadline = Math.min(start + profile.duration, 1020);
  if (start < 540 || start >= 1020) return routeFailure(profile, '当前只安排09:00—17:00的白天参观建议，请调整出发时间；这不是场馆开放时间承诺。');
  let best = null;
  function search(stops, now, knownCost, transit, visits, waiting, utility) {
    const last = stops.length ? stops[stops.length - 1].placeId : null;
    if (last) {
      const back = travel(last, null, profile), finish = now + back.minutes, totalTransit = transit + back.minutes;
      const walkingOk = profile.transport !== 'walk' || profile.walking !== 'easy' || totalTransit <= 90;
      if (finish <= deadline && knownCost <= profile.budget && walkingOk) {
        const score = utility - totalTransit / 12 - waiting / 30;
        if (!best || score > best.score) best = { stops: clone(stops), finish, knownCost, totalTransit, visits, waiting, back, score };
      }
    }
    if (stops.length >= 5) return;
    for (const place of candidates) {
      if (stops.some(s => s.placeId === place.id)) continue;
      const leg = travel(last, place.id, profile);
      const earliest = Number.isInteger(place.openMinutes) ? place.openMinutes : start;
      const latest = Number.isInteger(place.closeMinutes) ? place.closeMinutes : 1439;
      const arrival = Math.max(now + leg.minutes, earliest), departure = arrival + place.duration;
      const fee = knownFee(place, profile.partySize), cost = knownCost + (fee === null ? 0 : fee), back = travel(place.id, null, profile);
      if (departure > latest || departure + back.minutes > deadline || cost > profile.budget) continue;
      const matches = place.tags.filter(tag => profile.interests.includes(tag));
      const labels = matches.map(tag => catalog.interests.find(i => i.id === tag).label);
      // 每站推荐理由（可解释规划）：偏好/花费/顺路/节奏，至多两条，全部基于已计算字段。
      const reasons = [];
      if (labels.length) reasons.push('匹配' + labels.join('、') + '偏好');
      if (fee === 0) reasons.push('免费');
      else if (fee !== null) reasons.push('门票约' + fee + '元/人');
      if (leg.minutes <= 35) reasons.push('距上一站约' + leg.minutes + '分钟');
      if (place.duration <= 60) reasons.push('停留约' + place.duration + '分钟');
      const stop = { placeId: place.id, name: place.name, arrival: timeLabel(arrival), departure: timeLabel(departure),
        duration: place.duration, travelMinutes: leg.minutes, straightDistanceKm: leg.straightDistanceKm,
        travelMode: leg.mode, waitMinutes: arrival - now - leg.minutes, cost: fee,
        reason: reasons.slice(0, 2).join(' · ') || '认识河南农耕文化',
        factId: place.factIds[0], tags: clone(place.tags), cover: place.cover, estimated: true };
      search(stops.concat(stop), departure, cost, transit + leg.minutes, visits + place.duration,
        waiting + stop.waitMinutes, utility + 15 + matches.length * 7);
    }
  }
  search([], start, 0, 0, 0, 0, 0);
  if (!best) return routeFailure(profile, '目前无法在时间与已知费用内安排往返。可增加时间、调整起点，或修改交通方式。未知费用仍需另行确认。');
  const route = { ok: true, id: 'route-' + Date.now().toString(36), dataVersion: catalog.dataVersion,
    reason: '真实地点上的距离估算行程；开放、预约和未知费用需出发前核实',
    warnings: ['交通时长由同一组地图坐标按距离粗估，非道路导航或实时路况；请以地图实际路线为准。',
      '公开点位为地点参考位置，非实测入口；开放时间和预约请向场馆确认。',
      '只汇总有来源的已知费用；交通、餐饮及未知票价未计入，不保证全程预算已满足。',
      '停留时长和09:00—17:00白天安排是规划建议，不是营业时段；历史照片不代表场馆今天的状态。'],
    totalMinutes: best.finish - start, totalCost: null, knownCost: best.knownCost, budgetStatus: 'partial',
    travelMinutes: best.totalTransit, visitMinutes: best.visits, waitMinutes: best.waiting,
    returnMinutes: best.back.minutes, returnCost: null, transportCost: null,
    startTime: profile.startTime, endTime: timeLabel(best.finish), season: profile.season, mode: 'estimated',
    stops: best.stops, profileSnapshot: clone(profile), excludedIds };
  const checked = validateRoute(route, profile);
  return checked.valid ? route : routeFailure(profile, '路线校验未通过：' + checked.errors.join('；'));
}
function validateRoute(route, profile) {
  const errors = profileErrors(profile);
  if (!geo.validOrigin(profile && profile.origin)) errors.push('缺少真实出发点');
  if (errors.length) return { valid: false, errors };
  if (!route || route.ok !== true || !Array.isArray(route.stops) || !route.stops.length || route.stops.length > 5) return { valid: false, errors: ['路线无有效站点'] };
  if (!Array.isArray(route.excludedIds) || route.excludedIds.some(id => typeof id !== 'string' || !byId(id)) || new Set(route.excludedIds).size !== route.excludedIds.length) return { valid: false, errors: ['排除站点格式不正确'] };
  if (profile.transport === 'public') return { valid: false, errors: ['没有公交班次数据'] };
  if (route.dataVersion !== catalog.dataVersion || route.mode !== 'estimated' || route.season !== profile.season || route.startTime !== profile.startTime) errors.push('路线资料版本或条件不一致');
  let now = timeMinutes(profile.startTime), knownCost = 0, transit = 0, visits = 0, waiting = 0, previous = null;
  const seen = new Set();
  for (const stop of route.stops) {
    const place = stop && byId(stop.placeId);
    if (!place || !eligible(place, profile)) { errors.push('包含不可规划的资料或关闭地点'); continue; }
    if (seen.has(place.id)) errors.push('站点重复'); seen.add(place.id);
    if ((route.excludedIds || []).includes(place.id)) errors.push('包含已排除站点');
    if (stop.name !== place.name || stop.cover !== place.cover) errors.push('地点展示内容不一致');
    const leg = travel(previous, place.id, profile);
    const arrival = Math.max(now + leg.minutes, Number.isInteger(place.openMinutes) ? place.openMinutes : timeMinutes(profile.startTime));
    const departure = arrival + place.duration, fee = knownFee(place, profile.partySize);
    if (stop.arrival !== timeLabel(arrival) || stop.departure !== timeLabel(departure) || stop.travelMinutes !== leg.minutes || stop.duration !== place.duration || stop.waitMinutes !== arrival - now - leg.minutes) errors.push('路线时间不一致');
    if (stop.straightDistanceKm !== leg.straightDistanceKm || stop.travelMode !== 'distance-estimate' || stop.estimated !== true) errors.push('空间数据或估算标志不一致');
    // Independent physical lower bound catches accidental grid/time regressions.
    const speedLimit = { walk: 6, bike: 35, drive: 130 }[profile.transport];
    if (leg.straightDistanceKm > 0.03 && stop.travelMinutes < leg.straightDistanceKm / speedLimit * 60) errors.push('交通时间低于空间合理下限');
    if (Number.isInteger(place.closeMinutes) && departure > place.closeMinutes) errors.push('超出已知开放时段');
    if (stop.cost !== fee) errors.push('未知费用被替换或已知费用不一致');
    if (!place.factIds.includes(stop.factId)) errors.push('文化引用与地点不一致');
    knownCost += fee === null ? 0 : fee; transit += leg.minutes; visits += place.duration; waiting += arrival - now - leg.minutes;
    now = departure; previous = place.id;
  }
  if (!previous) return { valid: false, errors: errors.concat('没有可校验站点') };
  const back = travel(previous, null, profile); transit += back.minutes; now += back.minutes;
  if (route.totalMinutes !== now - timeMinutes(profile.startTime) || route.endTime !== timeLabel(now) || route.travelMinutes !== transit || route.visitMinutes !== visits || route.waitMinutes !== waiting || route.returnMinutes !== back.minutes) errors.push('汇总或返程时间不一致');
  if (route.totalCost !== null || route.transportCost !== null || route.returnCost !== null || route.knownCost !== round(knownCost) || route.budgetStatus !== 'partial') errors.push('不能把未知总费用写成确定费用');
  if (knownCost > profile.budget) errors.push('已知费用超过预算');
  if (now - timeMinutes(profile.startTime) > profile.duration || now > 1020 || timeMinutes(profile.startTime) < 540) errors.push('超出行程时间或白天规划窗口');
  if (profile.transport === 'walk' && profile.walking === 'easy' && transit > 90) errors.push('超出轻松步行上限');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
function answerQuestion(question, placeId) { return evidence.answerQuestion(question, placeId); }
module.exports = { parseProfile, generateRoute, validateRoute, answerQuestion, profileErrors, travel };
