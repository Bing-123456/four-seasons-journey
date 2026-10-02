'use strict';
// 向量客户端：DashScope 原生多模态向量端点（qwen3-vl-embedding，2560 维）。
//
// 为什么选多模态向量而不是纯文本向量（text-embedding-v4）：
// 文本、图片、视频在这套模型里落在**同一个语义空间**。L8 跨模态检索（用一张照片检索
// 文本事实）因此可以直接复用同一个索引，不需要为图片单独建一套库。
//
// 缓存策略：向量按 (model, text) 的哈希缓存到磁盘。31 条事实 + 22 条评测问题一共
// 五十几次调用，缓存后重跑评测是零成本、可离线复现的。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

class EmbeddingFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
// 端点硬限制：单次请求的 contents 不得超过 20 条。
// 官方文档没写这一条，是实测报 InvalidParameter（batch size is invalid, it should not be larger than 20）才发现的。
const MAX_BATCH = 20;

function createEmbeddingClient(options = {}) {
  const apiKey = options.apiKey || '';
  const model = options.model || 'qwen3-vl-embedding';
  const endpoint = options.endpoint || ENDPOINT;
  const timeoutMs = options.timeoutMs || 20000;
  const cacheFile = options.cacheFile || null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const memory = new Map();
  let dimension = null;

  if (cacheFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (saved && saved.model === model && saved.vectors) for (const [key, value] of Object.entries(saved.vectors)) memory.set(key, value);
    } catch { /* 缓存缺失或损坏都不该影响主流程 */ }
  }

  const cacheKey = text => createHash('sha256').update(model + '\n' + text).digest('hex').slice(0, 32);

  function persist() {
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ model, vectors: Object.fromEntries(memory) }));
    } catch { /* 写缓存失败不应让检索失败 */ }
  }

  async function requestVectors(texts) {
    if (!apiKey) throw new EmbeddingFailure('embedding_disabled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model, input: { contents: texts.map(text => ({ text })) } }),
        signal: controller.signal
      });
    } catch (error) {
      throw new EmbeddingFailure(controller.signal.aborted ? 'embedding_timeout' : 'embedding_unavailable');
    } finally { clearTimeout(timer); }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new EmbeddingFailure('embedding_http_error');
    }
    let data;
    try { data = await response.json(); } catch { throw new EmbeddingFailure('embedding_invalid_json'); }
    let vectors = data && data.output && data.output.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new EmbeddingFailure('embedding_invalid_output');
    // 端点会带 index 字段；有就按它排序，避免依赖返回顺序。
    if (vectors.every(item => item && typeof item.index === 'number')) vectors = vectors.slice().sort((a, b) => a.index - b.index);
    return vectors.map(raw => {
      const vector = Array.isArray(raw) ? raw : raw && raw.embedding;
      if (!Array.isArray(vector) || !vector.length) throw new EmbeddingFailure('embedding_invalid_output');
      return vector;
    });
  }

  async function embed(texts) {
    const list = texts.map(value => String(value));
    if (!list.length) return [];
    if (list.some(value => !value.trim())) throw new EmbeddingFailure('embedding_empty_input');
    const output = new Array(list.length);
    const missing = [];
    list.forEach((text, index) => {
      const hit = memory.get(cacheKey(text));
      if (hit) output[index] = hit; else missing.push(index);
    });
    if (!missing.length) return output;
    for (let start = 0; start < missing.length; start += MAX_BATCH) {
      const chunk = missing.slice(start, start + MAX_BATCH);
      const vectors = await requestVectors(chunk.map(index => list[index]));
      chunk.forEach((target, position) => {
        dimension = vectors[position].length;
        memory.set(cacheKey(list[target]), vectors[position]);
        output[target] = vectors[position];
      });
    }
    persist();
    return output;
  }

  return {
    model,
    embed,
    embedOne: async text => (await embed([text]))[0],
    cached: () => memory.size,
    get dimension() { return dimension; }
  };
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

module.exports = { createEmbeddingClient, cosine, EmbeddingFailure, ENDPOINT };
