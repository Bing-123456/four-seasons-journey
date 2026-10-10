'use strict';
// 票的展示格式化（行程页与发现页抽屉共用）：
//   日期时间「10月12日 周一 · 09:00」、距出发「距出发 3 天」、交通工具「自驾」。
// 2026-10-07 第9 轮抽出：原先 route.js 有一份 countdown/transport，index.js 抽屉里又写了一份 when。
const i18n = require('./i18n');

const CN_WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(dateTime) {
  const m = String(dateTime || '').replace(/\//g, '-')
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), hh: m[4] || '', mm: m[5] || '' };
}

// 票上的「日期时间」一行（设计稿第⑤⑥⑦屏：10月12日 周六 · 09:00）
function whenLabel(dateTime) {
  const p = parts(dateTime);
  if (!p) return String(dateTime || '');
  const clock = p.hh ? p.hh + ':' + p.mm : '';
  if (i18n.getLang() === 'en') {
    const wd = EN_WEEK[new Date(p.y, p.mo - 1, p.d).getDay()] || '';
    return (wd ? wd + ' ' : '') + (EN_MON[p.mo - 1] || '') + ' ' + p.d + (clock ? ' · ' + clock : '');
  }
  return p.mo + '月' + p.d + '日 ' + (CN_WEEK[new Date(p.y, p.mo - 1, p.d).getDay()] || '') + (clock ? ' · ' + clock : '');
}

// 距出发天数：目标日期时间 − 今天，实时算，不存字段。跨天显示「距出发 N 天」，当天显示「今天出发」。
function countdownLabel(dateTime) {
  const p = parts(dateTime);
  if (!p) return '';
  const targetDay = new Date(p.y, p.mo - 1, p.d).getTime();
  if (Number.isNaN(targetDay)) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((targetDay - today) / 86400000);
  if (days < 0) return i18n.t('rt_expired');
  if (days === 0) return i18n.t('rt_depart_today');
  // i18n 不支持插值：「距出发 N 天」在页内拼（i18n 只放纯文案）。
  return i18n.getLang() === 'en' ? 'In ' + days + ' ' + i18n.t('rt_days_left') : '距出发 ' + days + ' ' + i18n.t('rt_days_left');
}

const TRANSPORT_KEYS = { self: 'rt_transport_self', share: 'rt_transport_share', public: 'rt_transport_public' };
function transportLabel(value) { return i18n.t(TRANSPORT_KEYS[value] || 'rt_transport_self'); }

module.exports = { whenLabel, countdownLabel, transportLabel, TRANSPORT_KEYS };
