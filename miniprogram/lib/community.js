'use strict';
// 社群共用模块：云托管 API 调用、相对时间格式化（列表页/详情页共用，10.5 抽出）。
const i18n = require('./i18n');

const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
const CLOUD_RUN_SERVICE = 'guayouji-server';

function cloudAvailable() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callContainer === 'function';
}

function callApi(method, path, body) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: CLOUD_RUN_ENV },
      path: path,
      method: method,
      header: { 'X-WX-SERVICE': CLOUD_RUN_SERVICE, 'Content-Type': 'application/json' },
      data: body || {},
      timeout: 20000,
      success: res => {
        let data = res.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { data = null; } }
        if (res.statusCode >= 200 && res.statusCode < 300 && data && typeof data === 'object') resolve(data);
        else reject(new Error((data && data.error) || (res.statusCode === 429 ? i18n.t('community_rate_limited') : i18n.t('network_error'))));
      },
      fail: () => reject(new Error(i18n.t('network_error')))
    });
  });
}

function formatRelativeTime(ts) {
  const time = Number(ts);
  if (!time || time <= 0) return '';
  const diff = Date.now() - time;
  if (diff < 60 * 1000) return i18n.t('community_time_now');
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' ' + i18n.t('community_time_min');
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' ' + i18n.t('community_time_hour');
  if (diff < 30 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' ' + i18n.t('community_time_day');
  return '';
}

module.exports = { cloudAvailable, callApi, formatRelativeTime, CLOUD_RUN_ENV, CLOUD_RUN_SERVICE };
