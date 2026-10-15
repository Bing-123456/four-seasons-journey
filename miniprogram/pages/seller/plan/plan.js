'use strict';
// 活动方案结果页（设计图 3 第 4 版）：上一页点「生成方案」后跳到这里，一屏读完一份能照着办的活动方案。
// 数据来路：pages/seller/publish 把生成结果（连同那份「果乡资料」表单）暂存本机（lib/plan-draft.js）。
// 这一页只做三件事：如实标注方案是谁写的（AI / 手机上按规矩整理）、把方案摆出来、
// 底部的「保存并发布」把这份表单交给合并页同一条发布链路（pages/seller/publish/publish-flow.js）真的发出去。
const i18n = require('../../../lib/i18n');
const planDraft = require('../../../lib/plan-draft');
const ticketFormat = require('../../../lib/ticket-format');
const publishFlow = require('../publish/publish-flow');

const LABEL_KEYS = [
  'plan_nav', 'plan_badge_ai', 'plan_when', 'plan_capacity', 'plan_steps', 'plan_budget', 'plan_alt',
  'plan_cta', 'plan_expired', 'pub_prev'
];

function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}

// 距离「最晚卖到哪天」还有几天（含当天）；填的不是 YYYY-MM-DD 就当没填。
function daysLeft(dateText) {
  const matched = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) return 0;
  const target = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])).getTime();
  if (!Number.isFinite(target)) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((target - today) / 86400000) + 1;
}

// 「建议时间」：日期与场次由本机按他填的日子算，不依赖 AI 写对（设计稿 §7.2 的甲案）。
function whenPlan(dates) {
  const days = daysLeft(dates && dates.deadline);
  if (days > 0) {
    const sessions = days >= 4 ? 2 : 1;
    const start = (dates.openTime || '09:30');
    const end = start < '12:00' ? '12:00' : (dates.closeTime || '17:00');
    return {
      days: days, sessions: sessions, start: start, end: end,
      text: i18n.t('plan_when_line', { date: ticketFormat.whenLabel(dates.deadline), days: days, sessions: sessions, start: start, end: end })
    };
  }
  return { days: 0, sessions: 0, start: '', end: '', text: i18n.t('plan_when_open') };
}

// 缺项清单：键名在生成时记下来、这里按当前语言取词（果乡名称 / 所在地区 等直接用既有键）。
function missingLine(keys) {
  const list = (keys || []).map(function (key) { return i18n.t(key); });
  if (!list.length) return '';
  return i18n.t('plan_missing', { list: list.join(i18n.getLang() === 'en' ? ', ' : '、') });
}

// 发布成功后回到「我的发布」（pages/seller/index）。结果页与合并页都是它上面的一层，一次退回去，
// 不让人再停在被跳过的合并页上；栈里没有它（例如直接从别处进结果页）就换成跳转过去。
function backToMyPublish() {
  if (typeof wx === 'undefined') return;
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i] && stack[i].route === 'pages/seller/index') {
      const delta = stack.length - 1 - i;
      if (delta > 0 && wx.navigateBack) { wx.navigateBack({ delta: delta }); return; }
      break;
    }
  }
  if (wx.redirectTo) { wx.redirectTo({ url: '/pages/seller/index' }); return; }
  if (wx.navigateTo) wx.navigateTo({ url: '/pages/seller/index' });
}

Page({
  data: {
    fontClass: 'fs-normal',
    expired: false,
    isAI: false,
    sourceLine: '',
    missingLine: '',
    title: '',
    whenText: '',
    capacityText: '',
    stepsTitle: '',
    steps: [],
    budgetText: '',
    alternative: '',
    publishing: false,
    L: {}
  },
  onLoad: function () {
    i18n.applyNav('plan_nav');
    const L = i18n.labels(LABEL_KEYS);
    const draft = planDraft.read();
    if (!draft) { this.setData({ fontClass: fontClass(), L: L, expired: true }); return; }

    const when = whenPlan(draft.dates);
    const capacity = Number.isInteger(draft.capacity) && draft.capacity > 0 ? draft.capacity : null;
    const budget = Number.isInteger(draft.budget) && draft.budget > 0 ? draft.budget : null;
    const steps = (draft.steps || []).map(function (step) { return String(step).trim(); }).filter(Boolean);
    const capacityText = capacity ? i18n.t('plan_capacity_value', { n: capacity }) : '';
    // 花费只报 AI（或本机规则）给的那个数：多场时按场次乘出来，是同一件事的算术，不是新数字。
    const budgetText = budget
      ? i18n.t('plan_budget_value', { n: budget }) + (when.sessions > 1 ? i18n.t('plan_budget_total', { sessions: when.sessions, total: budget * when.sessions }) : '。')
      : '';
    // 来源徽标只在真 AI 时出现；手机上整理的不挂「AI 生成」这四个字（来源行已经说清了）。
    const isAI = draft.ai === true;

    this.setData({
      fontClass: fontClass(), L: L, expired: false, isAI: isAI,
      sourceLine: isAI ? i18n.t('plan_src_ai', { n: draft.filled || 0 }) : i18n.t('plan_src_local'),
      missingLine: missingLine(draft.missingKeys),
      title: String(draft.title || ''),
      whenText: when.text,
      capacityText: capacityText,
      stepsTitle: i18n.t('plan_steps', { n: steps.length }),
      steps: steps,
      budgetText: budgetText,
      alternative: String(draft.alternative || '').trim()
    });
  },
  // 结果页底部的「保存并发布」：把合并页那份「果乡资料」读回来，走合并页同一条发布链路
  // （pages/seller/publish/publish-flow.js 的校验 → create/update）真的把这张果乡名片发出去。
  // 编辑态（带 ?id= 进来的）更新原来那张、新建态新建一张，都是既有逻辑；
  // 这里不另写校验、不另拼请求，缺必填项时只给一句可读提示，不发请求。
  saveAndPublish: function () {
    const self = this;
    if (this.data.publishing) return;
    const stored = planDraft.readForm();
    if (!stored) {
      // 读不到那份表单（清过缓存 / 旧版存档）：如实说一句，让人回上一页重新生成，不崩。
      wx.showToast({ title: i18n.t('plan_expired'), icon: 'none' });
      return;
    }
    const errors = publishFlow.step1Errors(stored.form);
    const first = publishFlow.firstErrorField(errors);
    if (first) { wx.showToast({ title: errors[first], icon: 'none' }); return; }
    const step2 = publishFlow.step2Error(stored.form);
    if (step2) { wx.showToast({ title: step2, icon: 'none' }); return; }
    this.setData({ publishing: true });
    publishFlow.saveTown(stored.form, { editing: stored.editing, townId: stored.townId }).then(function () {
      // 成功后不复位：按钮保持 loading/禁用，免得在这 600ms 里再点一次又发一张（与合并页 submit() 一致）。
      wx.showToast({ title: i18n.t(publishFlow.toastKey(stored.editing, true)), icon: 'none' });
      setTimeout(backToMyPublish, 600);
    }).catch(function (error) {
      // 与合并页逐字同一套：服务端拒绝时把真实原因（哪一栏、超了多少字）显示出来，认不出来才用通用文案。
      self.setData({ publishing: false });
      wx.showToast({ title: publishFlow.failureMessage(error, stored.editing), icon: 'none' });
    });
  },
  goBack: function () { if (typeof wx !== 'undefined') wx.navigateBack({ delta: 1 }); }
});
