'use strict';

function positiveInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('服务数字配置超出范围');
  }
  return parsed;
}

function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).toLowerCase());
}

function providerUrl(value) {
  const url = new URL(value || 'https://api.deepseek.com');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('模型地址必须是无内嵌凭证的 HTTP(S) URL');
  }
  if (url.protocol !== 'https:' || isLoopback(url.hostname)) {
    throw new Error('云端模型地址必须使用 HTTPS，且不能是本机地址');
  }
  return url.href.replace(/\/$/, '');
}

function readConfig(env = process.env) {
  const requestedProvider = env.MODEL_PROVIDER || 'disabled';
  if (!['openai-compatible', 'disabled'].includes(requestedProvider)) {
    throw new Error('MODEL_PROVIDER 仅支持 openai-compatible、disabled');
  }
  const provider = requestedProvider === 'openai-compatible' && env.MODEL_NAME && env.OPENAI_API_KEY
    ? 'openai-compatible' : 'disabled';
  const host = env.HOST || '127.0.0.1';
  const token = env.API_TOKEN || '';
  if (!isLoopback(host) && token.length < 24) {
    throw new Error('对外监听必须配置至少 24 字符的 API_TOKEN');
  }
  const config = {
    host,
    port: positiveInteger(env.PORT, 8787, 0, 65535),
    token,
    provider,
    model: env.MODEL_NAME || '',
    providerBase: providerUrl(env.OPENAI_BASE_URL),
    providerKey: env.OPENAI_API_KEY || '',
    timeoutMs: positiveInteger(env.MODEL_TIMEOUT_MS, 30000, 100, 120000),
    vision: {
      baseUrl: providerUrl(env.VISION_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      apiKey: env.VISION_API_KEY || env.DASHSCOPE_API_KEY || '',
      model: env.VISION_MODEL_NAME || 'qwen-vl-plus',
      timeoutMs: positiveInteger(env.VISION_TIMEOUT_MS, 30000, 100, 120000)
    },
    image: {
      provider: env.IMAGE_PROVIDER === 'dashscope' && env.DASHSCOPE_API_KEY ? 'dashscope' : 'disabled',
      apiKey: env.DASHSCOPE_API_KEY || '',
      baseUrl: providerUrl(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com')
    },
    speech: {
      apiKey: env.SPEECH_API_KEY || env.DASHSCOPE_API_KEY || '',
      baseUrl: providerUrl(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com'),
      socketUrl: env.SPEECH_SOCKET_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      timeoutMs: 40000
    },
    // 语音输入（ASR）：与 speech 共用 DashScope key 与端点，但独立配置，
    // 便于单独换模型或单独关掉语音输入而不影响朗读。
    asr: {
      apiKey: env.ASR_API_KEY || env.DASHSCOPE_API_KEY || '',
      baseUrl: providerUrl(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com'),
      model: env.ASR_MODEL_NAME || 'qwen3-asr-flash',
      timeoutMs: positiveInteger(env.ASR_TIMEOUT_MS, 30000, 100, 120000)
    },
    maxBodyBytes: positiveInteger(env.MAX_BODY_BYTES, 16384, 256, 1048576),
    maxConcurrent: positiveInteger(env.MAX_CONCURRENT, 2, 1, 16),
    requestsPerMinute: positiveInteger(env.REQUESTS_PER_MINUTE, 30, 1, 1000)
  };
  return config;
}

module.exports = { readConfig, isLoopback };
