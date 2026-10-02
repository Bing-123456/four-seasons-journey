const core = require('./core');
const store = require('./store');
const catalog = require('../data/catalog');

// 微信云托管环境 ID 与服务名；小程序端通过 wx.cloud.callContainer 直连，无需配置服务器域名。
const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
const CLOUD_RUN_SERVICE = 'guayouji-server';

function isCloudRunApiBase(apiBase) {
  return typeof apiBase === 'string' && apiBase.indexOf('tcloudbase.com') !== -1;
}

function cloudApiAvailable() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callContainer === 'function';
}

function clearMatchingSession(apiBase, token) {
  const cloud = store.getCloudConnection();
  if (!store.isDemoMode() && apiBase === cloud.apiBase && (token || '') === cloud.token) store.clearSession();
}

function networkErrorMessage(error, fallback) {
  const errMsg = (error && error.errMsg) || '';
  if (/timeout/i.test(errMsg)) return 'AI 请求超时';
  return (fallback || '未连接 AI 服务') + (errMsg ? '（' + errMsg + '）' : '');
}

function safeParseData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try { const parsed = JSON.parse(data); if (parsed && typeof parsed === 'object') return parsed; } catch (error) {}
  }
  return null;
}
function handleResponse(response, resolve, reject, path, current, token, target) {
  if (path !== '/health' && current && !current()) { reject(new Error('服务连接或账户已变更，请重新操作')); return; }
  const parsedData = safeParseData(response.data) || response.data;
  if (response.statusCode >= 200 && response.statusCode < 300 && parsedData && typeof parsedData === 'object') {
    resolve(parsedData);
  } else {
    const code = parsedData && parsedData.code;
    if (response.statusCode === 401 && path !== '/api/pair') {
      try { clearMatchingSession(target || '', token); } catch (error) {}
      reject(new Error('开发会话未配对或已过期，请在「我的」重新配对'));
    } else if (path === '/api/pair') {
      const messages = { pairing_invalid: '配对码无效或已使用', pairing_expired: '配对码已过期，请查看服务终端的新码', pairing_rate_limited: '配对尝试过多，请 5 分钟后重试', pairing_not_required: '此本机服务无需配对' };
      reject(new Error(messages[code] || '配对失败，请重试'));
    } else reject(new Error(response.statusCode === 429 ? '请求过于频繁，请稍后重试' : 'AI 服务暂时不可用'));
  }
}

function cloudRequest(path, body, method, token, current, resolve, reject) {
  wx.cloud.callContainer({
    config: { env: CLOUD_RUN_ENV },
    path,
    method: method || 'POST',
    header: {
      'X-WX-SERVICE': CLOUD_RUN_SERVICE,
      'authorization': 'Bearer ' + token,
      'content-type': 'application/json'
    },
    data: body,
    timeout: 45000,
    success: function (response) { handleResponse(response, resolve, reject, path, current, token, ''); },
    fail: function (error) { reject(new Error(networkErrorMessage(error, '云托管服务调用失败'))); }
  });
}

function httpRequest(path, body, apiBase, method, token, current, extraHeader, resolve, reject) {
  const header = Object.assign({ 'content-type': 'application/json' }, extraHeader || {}, token ? { authorization: 'Bearer ' + token } : {});
  wx.request({
    url: apiBase + path,
    method: method || 'POST',
    header,
    data: body,
    timeout: 45000,
    success: function (response) { handleResponse(response, resolve, reject, path, current, token, apiBase); },
    fail: function (error) { reject(new Error(networkErrorMessage(error, '未连接 AI 服务'))); }
  });
}

function request(path, body, apiBase, method) {
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || !wx.request) {
      reject(new Error('当前环境没有微信网络接口'));
      return;
    }
    const cloud = store.getCloudConnection(); const partition = store.capturePartition();
    const target = String(apiBase || cloud.apiBase).replace(new RegExp('/+$'), '');
    const bound = target === cloud.apiBase;
    const current = () => { const latest = store.getCloudConnection(); return partition === store.capturePartition() && cloud.apiBase === latest.apiBase && cloud.token === latest.token; };
    const token = path !== '/api/pair' && bound ? cloud.token : '';
    const extraHeader = {};
    if (bound && path === '/api/seller-insight') {
      const credential = require('./booking-service').getCredential('seller');
      if (credential) extraHeader['X-Booking-Client'] = credential;
    }
    if (isCloudRunApiBase(target) && cloudApiAvailable()) {
      cloudRequest(path, body, method, token, current, resolve, reject);
    } else {
      httpRequest(path, body, target, method, token, current, extraHeader, resolve, reject);
    }
  });
}

function validProfile(result) {
  const p = result && result.profile;
  return !!(p && ['openai-compatible', 'local-rules'].indexOf(result.mode) !== -1 &&
    Array.isArray(result.missingFields) && result.missingFields.every(function (field) {
      return Object.prototype.hasOwnProperty.call(catalog.defaultProfile, field);
    }) && core.profileErrors(p).length === 0);
}

function readableReason(reason) {
  const reasons = {
    model_disabled: '未启用云端模型，当前使用本地能力',
    model_timeout: 'AI 响应超时，已自动使用本地能力',
    model_unavailable: 'AI 暂不可用，已自动使用本地能力',
    model_http_error: 'AI 暂不可用，已自动使用本地能力',
    model_empty_response: 'AI 未返回可用内容，已使用本地能力',
    model_response_too_large: 'AI 返回内容异常，已使用本地能力',
    model_invalid_json: 'AI 返回内容未通过校验，已使用本地能力',
    model_invalid_output: 'AI 返回内容未通过校验，已使用本地能力'
  };
  return reasons[reason] || reason;
}

function validAnswer(result) {
  if (!result || ['openai-compatible', 'local-retrieval'].indexOf(result.mode) === -1 ||
      typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 16000 ||
      typeof result.unanswerable !== 'boolean' || !Array.isArray(result.sourceIds) ||
      !Array.isArray(result.evidenceIds) || result.sourceIds.length > catalog.sources.length ||
      result.evidenceIds.length > catalog.facts.length) return false;
  if (result.unanswerable) return result.sourceIds.length === 0 && result.evidenceIds.length === 0;
  if (!result.sourceIds.length || !result.evidenceIds.length) return false;
  const expectedSources = [];
  for (let index = 0; index < result.evidenceIds.length; index += 1) {
    const fact = catalog.facts.find(function (item) { return item.id === result.evidenceIds[index]; });
    if (!fact) return false;
    fact.sourceIds.forEach(function (id) { if (expectedSources.indexOf(id) === -1) expectedSources.push(id); });
  }
  return result.sourceIds.length === expectedSources.length && result.sourceIds.every(function (id) {
    return expectedSources.indexOf(id) !== -1 && catalog.sources.some(function (source) { return source.id === id; });
  });
}

function withFallback(path, body, fallback, validate) {
  const settings = store.getSettings();
  if (!settings.useAI) {
    return Promise.resolve(Object.assign({}, fallback(), { fallbackReason: '已选择本地演示模式' }));
  }
  return request(path, body, store.getCloudConnection().apiBase).then(function (result) {
    if (!validate(result)) throw new Error('AI 返回内容未通过校验');
    if (result.fallbackReason) result.fallbackReason = readableReason(result.fallbackReason);
    return result;
  }).catch(function (error) {
    return Object.assign({}, fallback(), { fallbackReason: error.message || 'AI 服务异常' });
  });
}

module.exports = {
  getHealth: function () {
    const cloud = store.getCloudConnection();
    const token = cloud.token;
    return request('/health', undefined, cloud.apiBase, 'GET').then(function (health) {
      if (!health || health.ok !== true || !health.auth || typeof health.auth.authenticated !== 'boolean' || !health.model) throw new Error('服务版本不兼容，请更新后端');
      if (health.auth.required && !health.auth.authenticated) clearMatchingSession(cloud.apiBase, token);
      return health;
    });
  },
  pair: function (code) {
    if (store.isDemoMode()) return Promise.reject(new Error('演示账户不连接云端，请退出演示后配对'));
    const value = String(code || '').trim();
    if (!/^\d{8}$/.test(value)) return Promise.reject(new Error('请输入终端显示的 8 位配对码'));
    const apiBase = store.getSettings().apiBase;
    return request('/api/pair', { code: value }, apiBase).then(function (session) {
      return store.saveSession(session, apiBase);
    });
  },
  parseProfile: function (text, base) {
    const safeBase = Object.assign({}, base || catalog.defaultProfile);
    if (Object.prototype.hasOwnProperty.call(safeBase, 'origin')) safeBase.origin = null;
    return withFallback('/api/profile', { text: text, base: safeBase }, function () {
      return core.parseProfile(text, base);
    }, validProfile).then(function (result) {
      if (Object.prototype.hasOwnProperty.call(catalog.defaultProfile, 'origin')) result.profile.origin = base && base.origin ? JSON.parse(JSON.stringify(base.origin)) : null;
      return result;
    });
  },
  // 文化内容按需英译：服务端 AI 翻译，无本机兜底（不做机器假翻译）。
  translate: function (blocks, target) {
    return request('/api/translate', { blocks: blocks, target: target || 'en' }, store.getCloudConnection().apiBase).then(function (result) {
      if (!(result && result.translated && Array.isArray(result.items) && result.items.length === blocks.length && result.items.every(item => typeof item === 'string' && item.trim()))) throw new Error('翻译结果无效');
      return result.items;
    });
  },
  answerQuestion: function (question, placeId) {
    return withFallback('/api/ask', { question: question, placeId: placeId }, function () {
      return core.answerQuestion(question, placeId);
    }, validAnswer);
  },
  sellerInsight: function (payload, fallback) {
    // The server validates the model echo against the deterministic status;
    // the client re-checks the shape so a bad proxy can never reach the page.
    return withFallback('/api/seller-insight', payload, fallback, function (result) {
      return !!(result && typeof result.status === 'string' && ['insufficient', 'clear', 'attention', 'urgent'].includes(result.status) &&
        typeof result.reading === 'string' && result.reading.length >= 10 && result.reading.length <= 160 &&
        Array.isArray(result.suggestions) && result.suggestions.length >= 2 && result.suggestions.length <= 4 &&
        result.suggestions.every(function (item) { return typeof item === 'string' && item.trim().length > 0 && item.length <= 60; }) &&
        Array.isArray(result.planSteps) && result.planSteps.every(function (item) { return typeof item === 'string' && item.length <= 90; }));
    });
  }
};
