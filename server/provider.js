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

function createTransport(config, fetchImpl = globalThis.fetch) {
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
      catch (error) { if (signal && signal.aborted) throw new ModelFailure('model_timeout'); throw new ModelFailure('model_unavailable'); }
      if (!visionResponse.ok) { if (visionResponse.body) await visionResponse.body.cancel().catch(() => {}); throw new ModelFailure('model_http_error'); }
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
    if (new URL(config.providerBase).hostname === 'api.deepseek.com') {
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

module.exports = { createTransport, callModel, ModelFailure };
