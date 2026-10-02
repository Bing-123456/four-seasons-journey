'use strict';

class InputError extends Error {
  constructor(message, code = 'invalid_input', status = 400) {
    super(message); this.code = code; this.status = status;
  }
}

function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new InputError(label + '必须是对象');
  return value;
}

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(label + '为空或过长');
  return value.trim();
}

function finite(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new InputError(label + '超出允许范围');
  }
  return value;
}

function choice(value, label, values) {
  if (!values.includes(value)) throw new InputError(label + '无效');
  return value;
}

function profile(value, catalog, partial = true) {
  object(value, '出行条件');
  const allowed = Object.keys(catalog.defaultProfile);
  const result = {};
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new InputError('未知的出行条件字段');
    const item = value[key];
    switch (key) {
      case 'season': result[key] = choice(item, '季节', catalog.seasons.map(x => x.id)); break;
      case 'date': {
        if (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item)) throw new InputError('日期无效');
        const date = new Date(item + 'T12:00:00Z');
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item) throw new InputError('日期无效');
        result[key] = item; break;
      }
      case 'startTime':
        if (typeof item !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)) throw new InputError('开始时间无效');
        result[key] = item; break;
      case 'duration': result[key] = finite(item, '时长', 30, 720, true); break;
      case 'budget': result[key] = finite(item, '预算', 0, 100000); break;
      case 'partySize': result[key] = finite(item, '人数', 1, 20, true); break;
      case 'transport': result[key] = choice(item, '交通', ['drive', 'walk', 'public', 'bike']); break;
      case 'walking': result[key] = choice(item, '步行强度', ['easy', 'normal']); break;
      case 'interests':
        if (!Array.isArray(item) || item.length > catalog.interests.length || item.some(id => !catalog.interests.some(x => x.id === id))) throw new InputError('兴趣无效');
        result[key] = [...new Set(item)]; break;
      case 'note':
        if (typeof item !== 'string' || item.length > 2000) throw new InputError('备注过长');
        result[key] = item; break;
      case 'optInSupport':
        if (typeof item !== 'boolean') throw new InputError('助农偏好无效');
        result[key] = item; break;
      case 'origin': {
        if (item === null) { result[key] = null; break; }
        object(item, '出发点');
        if (Object.keys(item).some(name => !['name', 'address', 'latitude', 'longitude', 'coordinateSystem', 'source'].includes(name))) throw new InputError('出发点字段无效');
        result[key] = {
          name: text(item.name, '出发点名称', 200), address: text(item.address, '出发点地址', 500),
          latitude: finite(item.latitude, '纬度', -90, 90), longitude: finite(item.longitude, '经度', -180, 180),
          coordinateSystem: choice(item.coordinateSystem, '坐标系', ['gcj02']), source: choice(item.source, '起点来源', ['catalog', 'user'])
        }; break;
      }
      default: throw new InputError('未知的出行条件字段');
    }
  }
  if (!partial && allowed.some(key => !(key in result))) throw new InputError('出行条件不完整');
  return result;
}

function request(path, body, catalog) {
  object(body, '请求');
  if (path === '/api/profile') return {
    text: text(body.text, '出行描述', 2000),
    base: { ...catalog.defaultProfile, ...profile(body.base === undefined ? {} : body.base, catalog) }
  };
  if (path === '/api/ask') {
    const question = text(body.question, '问题', 1000);
    if (body.placeId !== undefined && body.placeId !== null && !catalog.places.some(x => x.id === body.placeId)) throw new InputError('地点不存在');
    return { question, placeId: body.placeId || undefined };
  }
  if (path === '/api/seller-insight') return sellerInsightRequest(body);
  if (path === '/api/translate') {
    const blocks = body.blocks;
    if (!Array.isArray(blocks) || !blocks.length || blocks.length > 10 || blocks.some(b => typeof b !== 'string' || !b.trim() || b.length > 600)) throw new InputError('翻译内容无效');
    return { blocks, target: choice(body.target || 'en', '目标语言', ['en', 'zh']) };
  }
  if (path === '/api/identify-fruit') {
    if (body.imageUrl && typeof body.imageUrl === 'string' && /^https?:\/\//.test(body.imageUrl)) {
      return { imageUrl: body.imageUrl };
    }
    // 兼容旧版 base64 直连（本地开发/旧客户端）
    const result = { base64: text(body.base64, '照片数据', 3000000), mimeType: choice(body.mimeType, '图片类型', ['image/jpeg', 'image/png', 'image/webp']) };
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64) || result.base64.length % 4) throw new InputError('照片数据无效', 'invalid_image');
    const bytes = Buffer.from(result.base64, 'base64');
    if (bytes.length > 2 * 1024 * 1024) throw new InputError('图片超过2MB限制', 'body_too_large', 413);
    const signature = result.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : result.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!signature) throw new InputError('图片格式与文件内容不符', 'invalid_image');
    return result;
  }
  if (path === '/api/fruit-story') {
    const keyword = text(body.keyword, '关键词', 24);
    const language = choice(body.language || 'zh', '语言', ['zh', 'en']);
    return { keyword, language };
  }
  throw new InputError('接口不存在', 'not_found', 404);
}

function shortText(value, label, max) { return text(value, label, max).trim(); }
function optionalText(value, label, max) { return value === undefined || value === null || value === '' ? '' : text(value, label, max).trim(); }
function sellerInsightRequest(body) {
  const batch = object(body.batch, '批次');
  const risk = object(body.risk, '测算');
  const region = Array.isArray(batch.region) && (batch.region.length === 0 || batch.region.length === 3) && batch.region.every(x => typeof x === 'string' && x.length <= 40)
    ? batch.region : (() => { throw new InputError('地区无效'); })();
  const reception = batch.reception === undefined || batch.reception === null ? {} : object(batch.reception, '接待条件');
  const weather = body.weather === undefined || body.weather === null ? { available: false } : object(body.weather, '天气');
  const tourism = body.tourism === undefined || body.tourism === null ? {} : object(body.tourism, '游客信号');
  const top = Array.isArray(tourism.top) ? tourism.top.slice(0, 5).map(item => ({
    name: shortText(object(item, '地点').name, '地点名', 80),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(item.month)) ? String(item.month) : (() => { throw new InputError('月份无效'); })(),
    parties: finite(item.parties, '人次', 0, 10000, true)
  })) : [];
  const culture = Array.isArray(body.culture) ? body.culture.slice(0, 3).map(item => ({
    title: shortText(object(item, '文化资料').title, '资料标题', 80),
    text: shortText(item.text, '资料内容', 300)
  })) : [];
  const status = choice(risk.status, '测算状态', ['insufficient', 'clear', 'attention', 'urgent']);
  return {
    batch: {
      id: optionalText(batch.id, '批次编号', 80),
      name: shortText(batch.name, '批次名', 80), crop: optionalText(batch.crop, '作物', 40), variety: optionalText(batch.variety, '品种', 60),
      region, areaMu: finite(batch.areaMu, '面积', 0, 100000),
      harvestStart: shortText(batch.harvestStart, '采收开始', 10), harvestEnd: shortText(batch.harvestEnd, '采收结束', 10), deadline: shortText(batch.deadline, '截止', 10),
      matureDate: optionalText(batch.matureDate, '预计成熟时间', 40), growthNote: optionalText(batch.growthNote, '生长概况', 300),
      reception: { enabled: !!reception.enabled, capacity: finite(reception.capacity || 0, '容量', 0, 10000, true), staff: finite(reception.staff || 0, '人员', 0, 1000, true) }
    },
    risk: {
      status, label: shortText(risk.label, '测算标签', 20),
      windowDays: finite(risk.windowDays, '窗口天数', 0, 7, true),
      remainingKg: finite(risk.remainingKg, '预计剩余', 0, 10000000, true),
      supplyKg: finite(risk.supplyKg, '可售供给', 0, 10000000, true),
      expectedSalesKg: risk.expectedSalesKg === null || risk.expectedSalesKg === undefined ? null : finite(risk.expectedSalesKg, '预计销售', 0, 10000000, true),
      pendingKg: finite(risk.pendingKg || 0, '待交付', 0, 10000000, true)
    },
    weather: {
      available: !!weather.available, label: optionalText(weather.label, '天气摘要', 120),
      rainDays: weather.rainDays === null || weather.rainDays === undefined ? null : finite(weather.rainDays, '降雨天数', 0, 7, true),
      windowRainDays: weather.windowRainDays === null || weather.windowRainDays === undefined ? null : finite(weather.windowRainDays, '窗口降雨', 0, 7, true)
    },
    tourism: {
      totalTrips: finite(tourism.totalTrips || 0, '行程次数', 0, 10000, true),
      totalParties: finite(tourism.totalParties || 0, '人次', 0, 100000, true), top
    },
    culture,
    limits: {
      maxCapacity: finite((body.limits || {}).maxCapacity === undefined ? 999 : body.limits.maxCapacity, '人数上限', 1, 999, true),
      maxBudget: finite((body.limits || {}).maxBudget === undefined ? 100000 : body.limits.maxBudget, '预算上限', 0, 100000, true)
    }
  };
}
// The model may phrase the reading and plan, but the deterministic status is
// the only risk authority: a mismatched echo invalidates the whole output.
function sellerInsight(output, input) {
  object(output, '模型结果');
  const status = choice(output.status, '状态回显', ['insufficient', 'clear', 'attention', 'urgent']);
  if (status !== input.risk.status) throw new InputError('模型状态与程序测算不一致');
  const reading = shortText(output.reading, '解读', 160);
  if (reading.length < 10) throw new InputError('解读过短');
  const suggestions = output.suggestions;
  if (!Array.isArray(suggestions) || suggestions.length < 2 || suggestions.length > 4 || suggestions.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 60)) throw new InputError('建议无效');
  const steps = output.planSteps;
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 6 || steps.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 90)) throw new InputError('步骤无效');
  const capacity = output.capacity === null || output.capacity === undefined ? null : finite(output.capacity, '人数', 1, input.limits.maxCapacity, true);
  const budget = output.budget === null || output.budget === undefined ? null : finite(output.budget, '预算', 0, input.limits.maxBudget, true);
  return {
    status, reading, suggestions: suggestions.map(item => item.trim()),
    planTitle: shortText(output.planTitle, '方案标题', 40) || 'AI 文旅方案草案',
    planSteps: steps.map(item => item.trim()), capacity, budget,
    alternative: output.alternative === null || output.alternative === undefined ? '' : shortText(output.alternative, '备选', 120)
  };
}

// These guards describe the small, deterministic extraction grammar. Unknown
// expressions remain editable defaults instead of being accepted on model trust.
const expression = {
  date: /20\d{2}[年\-/]\d{1,2}[月\-/]\d{1,2}|\d{1,2}月\d{1,2}[日号]/,
  startTime: /(?:\d{1,2}[:：]\d{2}|[0-9一二两三四五六七八九十]+点)/,
  duration: /[0-9一二两三四五六七八九十百]+(?:\.[0-9]+)?(?:个)?半?小时|[0-9一二两三四五六七八九十百]+分钟|半天|一天|一整天/,
  budget: /人均|总预算|预算|总共|总计/,
  partySize: /[0-9一二两三四五六七八九十]+(?:个)?人/,
  season: /春|夏|秋|冬|草莓|西瓜|猕猴桃|苹果/,
  transport: /自驾|开车|骑行|骑车|自行车|公交|公共交通|坐车|步行|走路/,
  walking: /少走|轻松|老人|慢|不想走路|正常步行|能走路/,
  interests: /文化|历史|非遗|亲子|孩子|儿童|带娃|自然|采摘|果园|田园|拍照|摄影|美食|吃|风味|手作|慢|轻松|休息/
};
const requiredFields = ['date', 'startTime', 'duration', 'budget', 'partySize'];
function fieldExpressed(field, value) {
  if (!expression[field] || !expression[field].test(value)) return false;
  const ambiguousNegation = {
    date: /(?:不是|不要|取消)[^，。；,;]{0,12}(?:年|月|日|号)/,
    startTime: /(?:不是|不要|取消)[^，。；,;]{0,8}(?:点|[:：])/,
    duration: /(?:不是|不要|不想|取消)[^，。；,;]{0,10}(?:小时|分钟|半天|一天)/,
    budget: /(?:不是|不要)[^，。；,;]{0,10}(?:元|预算)|(?:预算|总共|总计)[^，。；,;]{0,4}(?:不是|不要)/,
    season: /(?:不要|不去|不想|别去)[^，。；,;]{0,4}(?:春|夏|秋|冬|草莓|西瓜|猕猴桃|苹果)/
  };
  if (ambiguousNegation[field] && ambiguousNegation[field].test(value)) return false;
  if (field === 'transport') {
    const positive = value.replace(/(?:不想|不要|不愿|不能|不|别|没有)(?:再|去|坐)?(?:自驾|开车|骑行|骑车|自行车|公交|公共交通|坐车|步行|走路)/g, '');
    if (!expression.transport.test(positive)) return false;
  }
  return true;
}

function groundedProfile(input, base, catalog, parseProfile) {
  const parsed = parseProfile(input, base);
  const next = { ...base, note: input };
  const expressed = [];
  Object.keys(expression).forEach(field => {
    if (!fieldExpressed(field, input) || parsed.missingFields.includes(field)) return;
    try {
      const accepted = profile({ [field]: parsed.profile[field] }, catalog);
      next[field] = accepted[field]; expressed.push(field);
    } catch (_) { /* Invalid explicit values need manual confirmation. */ }
  });
  // A fully expressed date determines the demo season without inventing a date.
  if (expressed.includes('date') && !expressed.includes('season')) {
    const month = Number(next.date.slice(5, 7));
    next.season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
  }
  const missingFields = requiredFields.filter(field => !expressed.includes(field));
  Object.keys(expression).filter(field => !requiredFields.includes(field) && expression[field].test(input) && !expressed.includes(field)).forEach(field => missingFields.push(field));
  return { profile: next, missingFields, mode: 'local-rules' };
}

function profileChanges(output, input, base, catalog, parseProfile) {
  object(output, '模型结果');
  if (Object.keys(output).some(key => key !== 'changes') || !Array.isArray(output.changes) || output.changes.length > Object.keys(expression).length) throw new InputError('模型必须返回字段增量');
  const baseline = groundedProfile(input, base, catalog, parseProfile);
  const seen = new Set();
  output.changes.forEach(change => {
    object(change, '字段增量');
    if (Object.keys(change).some(key => !['field', 'value', 'evidenceSpan'].includes(key)) || seen.has(change.field)) throw new InputError('字段增量格式无效');
    seen.add(change.field);
    const span = text(change.evidenceSpan, '原文证据', 2000);
    if (!input.includes(span) || !fieldExpressed(change.field, span)) throw new InputError('字段缺少原文依据');
    const candidate = profile({ [change.field]: change.value }, catalog);
    const fromSpan = groundedProfile(span, base, catalog, parseProfile);
    if (fromSpan.missingFields.includes(change.field) ||
        JSON.stringify(candidate[change.field]) !== JSON.stringify(fromSpan.profile[change.field]) ||
        JSON.stringify(candidate[change.field]) !== JSON.stringify(baseline.profile[change.field])) throw new InputError('字段语义与原文不一致');
  });
  // The model may propose changes, but cannot suppress missing-field notices or
  // mutate consent. Deterministic, source-backed extraction is the final authority.
  return baseline;
}

module.exports = { InputError, object, text, profile, request, groundedProfile, profileChanges, sellerInsightRequest, sellerInsight };
