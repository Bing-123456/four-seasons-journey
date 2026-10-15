'use strict';
// 果乡名片的发布链路（校验 → 拼 payload → create / update），从 pages/seller/publish/publish.js 原样搬出来，
// 由两处共用：合并页（publish）自己的「保存修改」按钮，和结果页（pages/seller/plan）的「保存并发布」按钮。
// 结果页只把合并页那份表单读回来（lib/plan-draft.js 本机暂存）再交给这里 ——
// 校验规则、必填项顺序、发给 /api/farmtown/create|update 的字段都与原来一字不差，没有第二套。
const farmtown = require('../../../lib/farmtown-service');
const recentTown = require('../../../lib/recent-town');
const planDraft = require('../../../lib/plan-draft');
const i18n = require('../../../lib/i18n');

// 第 1 步（果乡资料）的必填项顺序：错在哪就标在哪，页面按这个顺序滚到第一个错处。
const STEP1_ORDER = ['name', 'region', 'address', 'fruit', 'openDate', 'openTime', 'closeDate', 'closeTime'];

// ---- 字段上限与「哪一栏错了」的文案（与服务端 server/farmtown.js 的 NAME_MAX / FRUIT_MAX / DESC_MAX 同口径）----
// 2026-10-16 服务端把三项上限放宽到 60 / 30 / 600 字（英文店名「Sunny Hill Fruit Farm」21 字原来根本发不出去）。
// 这里的两件事共用下面这一批键，不写第二套文案：
//   · 本地预校验：提交前就照同一套上限拦下来（超限立刻提示，不必等一个来回）；
//   · 服务端被拒：把响应里的 field / max 翻成同一句话（超限 → pub_err_*_long；没填 → 沿用 pub_err_*）。
const FIELD_MAX = { name: 60, fruit: 30, description: 600 };
const LONG_KEYS = { name: 'pub_err_name_long', fruit: 'pub_err_fruit_long', description: 'pub_err_desc_long' };
const MISSING_KEYS = { name: 'pub_err_name', fruit: 'pub_err_fruit', description: 'pub_err_desc' };
// 服务端的文案以字段名开头（server/farmtown.js 的 text() 用 label 拼句）：果乡名称 / 当季水果 / 果乡介绍。
const LABEL_FIELDS = [['果乡名称', 'name'], ['当季水果', 'fruit'], ['果乡介绍', 'description']];

// 本地预校验：超限就给同一句「哪一栏、多少字上限」，没超限返回空串。
function tooLongMessage(field, value) {
  const limit = FIELD_MAX[field];
  if (!limit) return '';
  if (String(value === null || value === undefined ? '' : value).trim().length <= limit) return '';
  return i18n.t(LONG_KEYS[field], { n: limit });
}

// 从失败里认出错的是哪一栏、上限多少、是「没填」还是「超限」；认不出来返回 null（调用方退回通用文案）。
// 两条路都认：优先服务端响应里机器可读的 field / max / reason；拿不到就从它那句中文文案里认字段与上限。
// 后一条是兜底：从中文文案反推，老回执、老服务端（不带 field / max / reason 的那种）一样认得出，
// 页面因此不依赖 lib/media-service.js 一定挂上了结构化字段。两句都认不出来时返回 null，
// 页面照旧给通用文案 —— 不空白、不崩。
function rejectReason(error) {
  if (!error) return null;
  const message = String(error.message || '');
  const reason = error.reason === 'required' || error.reason === 'too_long' ? error.reason : '';
  let field = FIELD_MAX[error.field] ? error.field : '';
  if (!field) {
    const hit = LABEL_FIELDS.filter(function (pair) { return message.indexOf(pair[0]) === 0; })[0];
    field = hit ? hit[1] : '';
  }
  if (!field) return null;
  const found = message.match(/最多\s*(\d+)\s*字/);
  const max = Number(error.max) > 0 ? Number(error.max) : (found ? Number(found[1]) : FIELD_MAX[field]);
  // 「未填写或过长」这句里也有「过长」两个字，所以判「超限」只认它独有的「最多 N 字」写法。
  const tooLong = reason ? reason === 'too_long' : !!found;
  return { field: field, max: max, tooLong: tooLong };
}

// 失败时给果农看的那一句：认得出是哪一栏就说清哪一栏，认不出就用调用方的通用文案（编辑/新建各一句）。
function failureMessage(error, editing, fallbackKey) {
  const reason = rejectReason(error);
  if (reason) return i18n.t(reason.tooLong ? LONG_KEYS[reason.field] : MISSING_KEYS[reason.field], { n: reason.max });
  return i18n.t(fallbackKey || toastKey(editing, false));
}

// 第 1 步校验：字段名 → 提示文案。全部通过时返回空对象。
function step1Errors(form) {
  const f = form || {};
  const errors = {};
  if (!f.name || !String(f.name).trim()) errors.name = i18n.t('pub_err_name');
  else { const long = tooLongMessage('name', f.name); if (long) errors.name = long; }
  if (!f.province || !f.city || !f.county) errors.region = i18n.t('pub_err_region');
  if (!f.fruit || !String(f.fruit).trim()) errors.fruit = i18n.t('pub_err_fruit');
  else { const long = tooLongMessage('fruit', f.fruit); if (long) errors.fruit = long; }
  if (!f.address || !String(f.address).trim()) errors.address = i18n.t('pub_err_address');
  if (!f.openDate) errors.openDate = i18n.t('pub_err_open_date');
  if (!f.openTime) errors.openTime = i18n.t('pub_err_open_time');
  if (!f.closeDate) errors.closeDate = i18n.t('pub_err_close_date');
  if (!f.closeTime) errors.closeTime = i18n.t('pub_err_close_time');
  return errors;
}

// 第一个出错的字段（用于滚到那个字段 / 挑一句提示），没错时返回空串。
function firstErrorField(errors) {
  return STEP1_ORDER.filter(function (key) { return errors && errors[key]; })[0] || '';
}

// 第 2 步（体验与介绍）的必填：返回提示文案，没问题时返回空串。
// 「介绍超限」也在这里拦：与服务端 DESC_MAX 同一套上限、同一句话（tooLongMessage，见上）。
function step2Error(form) {
  const f = form || {};
  if (!(f.experiences || []).length) return i18n.t('pub_err_exp_required');
  if (!String(f.description || '').trim()) return i18n.t('pub_err_desc');
  return tooLongMessage('description', f.description);
}

// 方案（AI 生成的 / 手机上按规矩整理的）跟名片一起存服务端：来源还是本机那份暂存
// （lib/plan-draft.js，上一页点「生成方案」时写进去的 planTitle/planSteps），不新造存储、
// 也不动那份存档的形状。读不到（没生成过 / 存档被清 / 换了语言重进）或存档里没有方案本体
// → 这个字段整个不带，服务端照旧什么都不存：老名片、老存档都不会因为这一项出问题。
function planPayload() {
  const draft = planDraft.read();
  if (!draft) return null;
  const title = String(draft.title || '').trim();
  const steps = (Array.isArray(draft.steps) ? draft.steps : [])
    .map(function (step) { return String(step).trim(); })
    .filter(Boolean);
  if (!title || !steps.length) return null;
  return { title: title, steps: steps };
}

// 交给 /api/farmtown/create|update 的字段：与原 publish.js 的 submit() 里那一份逐字一致。
function townPayload(form) {
  const f = form || {};
  const payload = {
    name: f.name, province: f.province, city: f.city, county: f.county,
    fruit: f.fruit, activityDate: f.activityDate || '', experiences: f.experiences,
    address: f.address, openDate: f.openDate, openTime: f.openTime, closeDate: f.closeDate, closeTime: f.closeTime,
    description: f.description,
    wechat: f.wechat, phone: f.phone,
    location: f.location,
    polishedDescription: ''
  };
  // 有方案才多带这一项（键名与 server/farmtown.js 的 planOf 对齐）：没有就不出现，
  // 后面那几个字段的位置、语义一个字没动。
  const plan = planPayload();
  if (plan) payload.plan = plan;
  return payload;
}

// 编辑态（?id=xxx 进来的）更新原来那张，新建态新建一张 —— 这个分支是既有逻辑，一个字没改。
// 成功后记本机「最近发布」（失败路径不写；两个 id 都取不到时 remember('') 自己不动）。
function saveTown(form, options) {
  const config = options || {};
  const payload = townPayload(form);
  if (config.editing) payload.id = config.townId;
  const op = config.editing ? farmtown.updateTown(payload) : farmtown.createTown(payload);
  return Promise.resolve(op).then(function (town) {
    recentTown.remember((town && town.id) || (config.editing ? config.townId : ''));
    return town;
  });
}

// 成功后 / 失败后的 toast 文案键（两种模式各一句，与合并页原来用的完全一样）。
function toastKey(editing, ok) {
  if (ok) return editing ? 'pub_toast_saved' : 'pub_toast_published';
  return editing ? 'pub_toast_save_failed' : 'pub_toast_publish_failed';
}

module.exports = {
  STEP1_ORDER, step1Errors, firstErrorField, step2Error, townPayload, saveTown, toastKey,
  FIELD_MAX, rejectReason, failureMessage
};
