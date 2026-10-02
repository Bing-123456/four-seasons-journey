'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { InputError } = require('./validation');
const { callModel } = require('./provider');

// Broad outdoor harvest windows, not a promise of availability at a real farm.
// Cultivar, latitude and weather vary; winter jujube is harvested in autumn.
const HARVEST_MONTHS = {
  青梅: [4, 5, 6], 枇杷: [4, 5, 6], 桑葚: [4, 5, 6],
  西瓜: [6, 7, 8, 9], 李子: [6, 7, 8], 桃子: [6, 7, 8, 9],
  柿子: [9, 10, 11], 石榴: [8, 9, 10], 秋梨: [8, 9, 10],
  冬枣: [9, 10], 瓯柑: [11, 12], 砂糖橘: [12, 1, 2]
};
const ACTIVITIES = ['pick', 'photo', 'taste'];
const TIMINGS = ['soon', 'next', 'unset'];
const TERMINAL = ['succeeded', 'partial', 'failed'];
const BAD_CLAIM = /https?:|www\.|预约|营业|联系电话|真实地址|已开园|保证|包采|无限采/i;
const HARVEST_CLAIM = /采|摘|鲜果|现尝|当季|果熟|丰收|成熟|满枝|挂满/;

function validatePlaceBody(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['fruits', 'activity', 'timing', 'requestId'].includes(key))) throw new InputError('推荐参数无效');
  if (!Array.isArray(body.fruits) || !body.fruits.length || body.fruits.length > 12 || body.fruits.some(fruit => !Object.prototype.hasOwnProperty.call(HARVEST_MONTHS, fruit))) throw new InputError('请选择问卷中的水果');
  if (!ACTIVITIES.includes(body.activity) || !TIMINGS.includes(body.timing)) throw new InputError('请完成玩法与出游时间选择');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId)) throw new InputError('请求标识无效');
  return { fruits: [...new Set(body.fruits)], activity: body.activity, timing: body.timing, requestId: body.requestId };
}

function buildPlans(body, now = Date.now()) {
  const date = new Date(Number(now) + 8 * 3600000);
  let month = date.getUTCMonth() + 1, year = date.getUTCFullYear();
  if (body.timing === 'next') { month += 1; if (month === 13) { month = 1; year += 1; } }
  if (body.timing === 'unset') month = null;
  return body.fruits.map((fruit, index) => {
    const harvestMonths = HARVEST_MONTHS[fruit];
    const inSeason = month !== null && harvestMonths.includes(month);
    const experience = body.activity === 'photo' ? 'orchard-view' : body.activity === 'taste' ? (inSeason ? 'seasonal-taste' : 'preserved-taste') : inSeason ? 'harvest' : month === null ? 'harvest-planning' : 'fruit-workshop';
    return { fruit, harvestMonths, month, year, inSeason, canHarvest: inSeason && body.activity === 'pick', experience, order: index };
  }).sort((a, b) => Number(b.inSeason) - Number(a.inSeason) || a.order - b.order).slice(0, 4).map(({ order, ...plan }) => plan);
}

function promptFor(body, plans, retry) {
  return {
    system: '你是乡野旅行创意编辑。仅输出 JSON {"places":[{"fruit":"水果名","name":"虚拟地点名称","intro":"简短介绍"}]}。严格按输入计划顺序每项生成一个虚构创意地点，1至4项，不得增减。名称2至18个字符，介绍1至15个字符（含标点）。名称和介绍必须由你创作，不要返回固定模板。所有内容是虚拟创意，不能编造真实地址、营业、预约、库存或承诺。体验遵守 experience：harvest 可写采摘，seasonal-taste 可写果品品尝，orchard-view 只写景观拍照，preserved-taste 只写果干、蜜饯、果酱品鉴，fruit-workshop 只写果酱、果干等加工体验，harvest-planning 只写果树观察和未来果期规划。inSeason 不为 true 时，名称与介绍不得使用采、摘、鲜果、现尝、当季、果熟、丰收、成熟、满枝或挂满。没有确定出游时间不能承诺当前有果可采。',
    user: JSON.stringify({ answers: { fruits: body.fruits, activity: body.activity, timing: body.timing }, plans, note: '按中国常见露天果期粗略匹配，具体地区和品种可能不同；非真实可预约地点。', ...(retry ? { correction: '上次格式或约束未通过，请逐一核对水果、数量、介绍15字符上限及果期限制。' } : {}) }),
    maxTokens: 1100
  };
}

function parsePlaces(output, plans) {
  if (!output || !Array.isArray(output.places) || output.places.length !== plans.length) throw new Error('invalid_place_response');
  const names = new Set();
  return plans.map((plan, index) => {
    const item = output.places[index];
    if (!item || item.fruit !== plan.fruit || typeof item.name !== 'string' || typeof item.intro !== 'string') throw new Error('invalid_place_response');
    const name = item.name.trim(), intro = item.intro.trim();
    if ([...name].length < 2 || [...name].length > 18 || !intro || [...intro].length > 15 || BAD_CLAIM.test(name + intro) || /[\r\n<>]/.test(name + intro) || names.has(name)) throw new Error('invalid_place_response');
    if (!plan.inSeason && HARVEST_CLAIM.test(name + intro)) throw new Error('invalid_season_claim');
    if (plan.experience !== 'harvest' && /采摘|现摘/.test(intro)) throw new Error('invalid_activity_claim');
    names.add(name);
    return { id: 'place-' + (index + 1), ...plan, name, intro, virtual: true, image: '', imageStatus: 'queued', imageAttempt: 0 };
  });
}

function createPlaceRecommendService(adapter, options = {}) {
  const { artifacts, transport } = options;
  const now = options.now || Date.now;
  const jobs = new Map();
  const maxJobs = options.maxJobs || 100, maxActive = options.maxActive || 4;
  const ttl = options.ttl || 30 * 60000, pollMs = options.pollMs === undefined ? 3000 : options.pollMs;
  const imageTimeout = options.imageTimeout || 180000, providerTimeout = options.providerTimeout || 30000;
  const maxImageConcurrent = options.maxImageConcurrent || 2;
  let imageActive = 0;
  const imageQueue = [];
  const capabilities = { configured: typeof transport === 'function', imageConfigured: !!adapter && !!artifacts, virtualOnly: true };
  const snapshot = job => JSON.parse(JSON.stringify({ taskId: job.id, status: job.status, places: job.places, expiresAt: job.expiresAt, message: job.message || '', virtual: true }));
  function purge() { for (const [id, job] of jobs) if (job.expiresAt <= now()) { job.expired = true; jobs.delete(id); } }
  function lookup(id, owner) { purge(); const job = jobs.get(id); if (!job || job.owner !== owner) throw new InputError('任务不存在或已过期', 'not_found', 404); return job; }
  function ready() { if (typeof transport !== 'function') throw new InputError('AI 推荐服务尚未配置', 'model_disabled', 503); }
  function within(promise, milliseconds) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider_timeout')), milliseconds); if (timer.unref) timer.unref(); })]).finally(() => clearTimeout(timer));
  }
  function pause(milliseconds) { return new Promise(resolve => { const timer = setTimeout(resolve, milliseconds); if (timer.unref) timer.unref(); }); }
  function imageSlot(work) {
    return new Promise((resolve, reject) => { imageQueue.push({ work, resolve, reject }); drainImages(); });
  }
  function drainImages() {
    while (imageActive < maxImageConcurrent && imageQueue.length) {
      const item = imageQueue.shift(); imageActive += 1;
      Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => { imageActive -= 1; drainImages(); });
    }
  }
  function settle(job) {
    if (job.expired || now() >= job.expiresAt) { job.expired = true; return; }
    if (job.places.some(place => ['queued', 'generating'].includes(place.imageStatus))) { job.status = 'generating-images'; return; }
    job.status = job.places.every(place => place.imageStatus === 'succeeded') ? 'succeeded' : 'partial';
    job.message = job.status === 'partial' ? '推荐已生成，部分配图失败，可单独重试。' : '';
  }
  async function generateImage(job, place) {
    if (job.expired || now() >= job.expiresAt) { job.expired = true; return; }
    place.imageStatus = 'generating'; place.imageAttempt += 1;
    try {
      if (!adapter || !artifacts) throw new Error('image_provider_disabled');
      const prompt = '原创精致乡野插画，柔和自然光，留白，低饱和淡彩，无文字无标牌。虚构创意地点：' + place.name + '。水果主题：' + place.fruit + '。体验：' + place.intro + '。场景类型：' + place.experience + '。' + (place.inSeason ? '使用相应月份景致。' : '非采收场景，不画可采摘的满树成熟果实；呈现果树、手作台或果品加工。');
      const providerId = await within(adapter.create({ prompt, requestId: job.id + '-' + place.id + '-' + place.imageAttempt }), providerTimeout);
      const deadline = Date.now() + imageTimeout;
      for (;;) {
        if (job.expired || now() >= job.expiresAt) throw new Error('expired');
        if (Date.now() >= deadline) throw new Error('image_timeout');
        const result = await within(adapter.status(providerId), Math.min(providerTimeout, Math.max(1, deadline - Date.now())));
        if (!result || !['queued', 'generating', 'succeeded', 'failed'].includes(result.status)) throw new Error('invalid_image_status');
        if (result.status === 'failed') throw new Error('image_failed');
        if (result.status === 'succeeded') {
          if (typeof result.imageUrl !== 'string' || !/^https:\/\//.test(result.imageUrl)) throw new Error('invalid_image_url');
          const image = await within(artifacts.persistFromUrl(result.imageUrl, job.id + '-' + place.id + '-' + place.imageAttempt), providerTimeout);
          if (typeof image !== 'string' || !/^\/artifacts\/[a-z0-9-]+\.png$/.test(image)) throw new Error('invalid_artifact');
          place.image = image; place.imageStatus = 'succeeded'; place.imageError = ''; break;
        }
        await pause(pollMs);
      }
    } catch (error) {
      place.imageStatus = 'failed'; place.imageError = error.message === 'image_provider_disabled' ? '配图服务尚未配置' : '配图生成失败，请重试';
    }
    settle(job);
  }
  async function run(job) {
    job.status = 'generating-text';
    try {
      const plans = buildPlans(job.body, job.createdAt);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const output = await callModel(transport, 'place-recommend', promptFor(job.body, plans, attempt > 0), options.timeoutMs || 30000);
        try { job.places = parsePlaces(output, plans); break; }
        catch (error) { if (attempt) throw error; }
      }
      if (job.expired || now() >= job.expiresAt) { job.expired = true; return; }
      job.status = 'generating-images';
      await Promise.all(job.places.map(place => imageSlot(() => generateImage(job, place))));
      settle(job);
    } catch (error) {
      job.status = 'failed'; job.message = 'AI 推荐暂未生成，请稍后重试。';
    }
  }
  async function submit(input, owner = 'local-development') {
    ready(); purge();
    const body = validatePlaceBody(input);
    const fingerprint = createHash('sha256').update(JSON.stringify({ fruits: body.fruits, activity: body.activity, timing: body.timing })).digest('hex');
    for (const job of jobs.values()) {
      if (job.owner !== owner) continue;
      if (job.body.requestId === body.requestId) {
        if (job.fingerprint !== fingerprint) throw new InputError('请求标识已用于另一份问卷', 'request_conflict', 409);
        return snapshot(job);
      }
      if (!TERMINAL.includes(job.status)) {
        if (job.fingerprint === fingerprint) return snapshot(job);
        throw new InputError('已有推荐正在生成，请等待完成', 'task_in_progress', 409);
      }
    }
    if (jobs.size >= maxJobs || [...jobs.values()].filter(job => !TERMINAL.includes(job.status)).length >= maxActive) throw new InputError('推荐服务忙，请稍后重试', 'server_busy', 503);
    const id = randomUUID(), createdAt = now();
    const job = { id, owner, body, fingerprint, createdAt, expiresAt: createdAt + ttl, status: 'queued', places: [] };
    jobs.set(id, job);
    // Submission does not wait for model or image-provider network round trips.
    Promise.resolve().then(() => run(job));
    return snapshot(job);
  }
  async function status(id, owner = 'local-development') { return snapshot(lookup(id, owner)); }
  async function retry(id, body, owner = 'local-development') {
    const job = lookup(id, owner);
    if (!body || typeof body.placeId !== 'string' || Object.keys(body).some(key => key !== 'placeId')) throw new InputError('配图参数无效');
    const place = job.places.find(item => item.id === body.placeId);
    if (!place) throw new InputError('配图不存在', 'not_found', 404);
    // Duplicate taps reuse the in-flight image; completed images are not charged twice.
    if (place.imageStatus !== 'failed') return snapshot(job);
    if (place.imageAttempt >= 3) throw new InputError('此配图已重试两次，请稍后重新生成推荐', 'retry_limit', 429);
    if ([...jobs.values()].filter(value => !TERMINAL.includes(value.status)).length >= maxActive && TERMINAL.includes(job.status)) throw new InputError('推荐服务忙，请稍后重试', 'server_busy', 503);
    place.imageStatus = 'queued'; job.status = 'generating-images'; job.message = '';
    imageSlot(() => generateImage(job, place)).catch(() => { place.imageStatus = 'failed'; settle(job); });
    return snapshot(job);
  }
  return { submit, status, retry, purge, capabilities };
}

module.exports = { createPlaceRecommendService, validatePlaceBody, buildPlans, parsePlaces, HARVEST_MONTHS };
