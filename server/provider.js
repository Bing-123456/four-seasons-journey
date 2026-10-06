'use strict';

class ModelFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function readLimited(response, maximum = 131072) {
  if (!response.body) throw new ModelFailure('model_empty_response');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw new ModelFailure('model_response_too_large');
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ModelFailure('model_invalid_json'); }
}

// CloudBase SDK 模型工厂：供 provider.js transport 与 chat.js 的 callModelOnce 共用，
// 避免两处各自维护 SDK 初始化（chat.js 曾因绕过此通道直连 HTTP 被网关拒绝）。
function createCloudbaseModel(config, sdk) {
  const cloudbase = sdk || require('@cloudbase/node-sdk');
  const app = cloudbase.init({
    env: config.cloudbase.envId,
    accessKey: config.cloudbase.accessKey,
    timeout: Math.max(60000, (config.timeoutMs || 30000) + 10000)
  });
  return app.ai().createModel('cloudbase');
}

function createTransport(config, fetchImpl = globalThis.fetch, sdk) {
  // 腾讯 CloudBase SDK 通道：小程序成长计划仅允许「云开发 SDK」调用 AI（HTTP 网关会报
  // AI_CHANNEL_NOT_ALLOWED），因此文字模型走 @cloudbase/node-sdk。鉴权用 CloudBase API Key
  // （accessKey，即控制台 AI+ 页面的 Key），无需腾讯云 SecretId/SecretKey（实测无 tcb 权限）。
  // SDK 的 doGenerate 会把整个入参对象透传给 chat/completions，max_tokens/thinking 均可携带。
  if (config.provider === 'cloudbase') {
    const model = createCloudbaseModel(config, sdk);
    return async function transport({ prompt, signal }) {
      if (prompt.image) throw new ModelFailure('vision_disabled');
      if (signal && signal.aborted) throw new ModelFailure('model_timeout');
      const payload = {
        model: config.model,
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0,
        max_tokens: prompt.maxTokens || 600,
        // hy3 是思考型模型：不关思考 token 全烧在 reasoning_content 上，content 为空。
        thinking: { type: 'disabled' }
      };
      let result;
      try { result = await model.generateText(payload); }
      catch (error) {
        if (signal && signal.aborted) throw new ModelFailure('model_timeout');
        throw new ModelFailure('model_unavailable');
      }
      if (result && result.error) throw new ModelFailure('model_http_error');
      const content = result && result.text;
      if (typeof content !== 'string' || !content.trim()) throw new ModelFailure('model_empty_response');
      return content;
    };
  }
  return async function transport({ prompt, signal }) {
    // 带图请求走视觉通道（阿里云百炼 OpenAI 兼容端点，qwen-vl 系列）。
    if (prompt.image) {
      if (!config.vision || !config.vision.apiKey) throw new ModelFailure('vision_disabled');
      const visionUrl = config.vision.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const visionPayload = {
        model: config.vision.model,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:' + prompt.image.mimeType + ';base64,' + prompt.image.base64 } },
          { type: 'text', text: prompt.system + '\n' + prompt.user }
        ] }],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      };
      let visionResponse;
      try { visionResponse = await fetchImpl(visionUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.vision.apiKey }, body: JSON.stringify(visionPayload), signal }); }
      catch (error) { console.error('[vision]', error && error.stack || error); if (signal && signal.aborted) throw new ModelFailure('model_timeout'); throw new ModelFailure('model_unavailable'); }
      if (!visionResponse.ok) {
        let detail = '';
        try { detail = String((await visionResponse.text()) || '').slice(0, 4000); } catch (error) { detail = '<body unreadable>'; }
        console.error('[vision] http', visionResponse.status, detail);
        if (visionResponse.body) await visionResponse.body.cancel().catch(() => {});
        throw new ModelFailure('model_http_error');
      }
      const visionData = await readLimited(visionResponse);
      const visionContent = visionData.choices?.[0]?.message?.content;
      if (typeof visionContent !== 'string' || !visionContent.trim()) throw new ModelFailure('model_empty_response');
      return visionContent;
    }
    if (config.provider === 'disabled') throw new ModelFailure('model_disabled');
    const url = config.providerBase + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (config.providerKey) headers.authorization = 'Bearer ' + config.providerKey;
    const payload = {
        model: config.model,
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0,
        max_tokens: prompt.maxTokens || 600,
        response_format: { type: 'json_object' }
    };
    // DeepSeek 与腾讯 CloudBase 混元（hy3）都是思考型模型：不显式关闭思考，
    // token 会全部消耗在 reasoning_content 上，正式 content 为空触发空响应保护。
    const providerHost = new URL(config.providerBase).hostname;
    if (providerHost === 'api.deepseek.com' || providerHost.endsWith('.tcloudbasegateway.com')) {
      payload.thinking = { type: 'disabled' };
    }
    let response;
    try { response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload), signal }); }
    catch (error) {
      if (signal && signal.aborted) throw new ModelFailure('model_timeout');
      throw new ModelFailure('model_unavailable');
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new ModelFailure('model_http_error');
    }
    const data = await readLimited(response);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ModelFailure('model_empty_response');
    return content;
  };
}

async function callModel(transport, task, prompt, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelFailure('model_timeout'));
    }, timeoutMs);
  });
  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => transport({ task, prompt, signal: controller.signal })),
      timeout
    ]);
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || raw.length > 65536) throw new ModelFailure('model_invalid_json');
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let value;
    try { value = JSON.parse(cleaned); }
    catch {
      // 模型偶尔在 JSON 前后附带说明文字；提取首个完整大括号块再试一次。
      const braceMatch = cleaned.match(/{[\s\S]*}/);
      if (!braceMatch) throw new ModelFailure('model_invalid_json');
      try { value = JSON.parse(braceMatch[0]); }
      catch { throw new ModelFailure('model_invalid_json'); }
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new ModelFailure('model_invalid_json');
    return value;
  } finally { clearTimeout(timer); }
}

module.exports = { createTransport, createCloudbaseModel, callModel, ModelFailure };
