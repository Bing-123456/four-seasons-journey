'use strict';
// 社群共用模块：云托管 API 调用、相对时间格式化（列表页/详情页共用，10.5 抽出）。
const i18n = require('./i18n');

const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
const CLOUD_RUN_SERVICE = 'guayouji-server';

function cloudAvailable() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callContainer === 'function';
}

// 10.5 之后：云托管「实例副本数最小值为 0」时，半小时无请求会缩容到 0、服务暂停；
// 再次请求需冷启动，耗时可能超过 timeout —— 官方文档明确 callContainer 的 timeout 上限是 15 秒。
// 因此：首试给短超时（尽快进入重试），失败后等 1.2 秒自动重试一次（此时实例已被唤醒）；
// 只对"超时/网络类"失败重试，业务错误（4xx/5xx 且有返回）不重试。
const FIRST_TIMEOUT_MS = 8000;
const RETRY_TIMEOUT_MS = 15000;

function classifyError(error) {
  const code = Number((error && error.errCode) || 0);
  const msg = String((error && error.errMsg) || '');
  if (code === 102002 || /timeout|超时/i.test(msg)) return 'community_err_timeout';
  if (code === -601031 || code === -601027) return 'community_err_service';
  if (code === -606003) return 'community_err_arrears';
  if (code === -601034) return 'community_err_noperm';
  return 'network_error';
}

function once(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: CLOUD_RUN_ENV },
      path: path,
      method: method,
      header: { 'X-WX-SERVICE': CLOUD_RUN_SERVICE, 'Content-Type': 'application/json' },
      data: body || {},
      timeout: timeoutMs,
      success: res => {
        let data = res.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { data = null; } }
        if (res.statusCode >= 200 && res.statusCode < 300 && data && typeof data === 'object') resolve(data);
        else reject(Object.assign(new Error((data && data.error) || (res.statusCode === 429 ? i18n.t('community_rate_limited') : i18n.t('network_error'))), { httpStatus: res.statusCode }));
      },
      fail: err => reject(Object.assign(new Error(i18n.t('network_error')), { errCode: err && err.errCode, errMsg: err && err.errMsg }))
    });
  });
}

// 是否值得重试：没有 HTTP 返回（网络/冷启动超时）才重试；服务端已给出状态码的不重试
function retryable(error) {
  if (!error) return false;
  if (error.httpStatus) return false;
  return true;
}

function callApi(method, path, body, hooks) {
  return once(method, path, body, FIRST_TIMEOUT_MS).catch(error => {
    if (!retryable(error)) throw new Error(error.message || i18n.t('network_error'));
    if (hooks && typeof hooks.onRetry === 'function') { try { hooks.onRetry(); } catch (e) { /* 忽略 */ } }
    return new Promise(resolve => setTimeout(resolve, 1200)).then(() => once(method, path, body, RETRY_TIMEOUT_MS));
  }).catch(error => {
    if (error && error.httpStatus) throw new Error(error.message || i18n.t('network_error'));
    const key = classifyError(error);
    const code = error && error.errCode ? '（' + error.errCode + '）' : '';
    throw new Error(i18n.t(key) + code);
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
