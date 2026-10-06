'use strict';

// DashScope（阿里云百炼）图像编辑适配器：照片 → 水果伙伴卡通插画。
// Qwen Image Edit Max 使用同步供应商接口；本地有界任务保留 create/status 异步协议。
// 未配置 DASHSCOPE_API_KEY 时返回 null，服务端保持 image_provider_disabled 的诚实降级。
const https = require('node:https');
const { URL } = require('node:url');
const { randomUUID } = require('node:crypto');

const MODEL = 'qwen-image-edit-max';
const PROMPT = '请把参考照片重新绘制为一张全新的水果伙伴角色设计图。只选照片中最主要、面积最大的一个水果作为唯一主体，严格保留它的水果种类、颜色、轮廓与果梗特征，绝不能改成其他品种。将它设计为一个可爱的Q版水果角色，圆润轮廓、精致柔和线描、简洁的小眼睛和微笑、短小四肢。整张输出图必须从纯白色画布重新绘制，仅有这一个完整角色居中，占画面约65%，四周有充足纯白留白。彻底删除原照片中的全部背景、树枝、远景树叶、其他水果、地面、山、建筑和人物，不保留任何原照片背景像素，不要在原照片上贴卡通贴纸。不做拼图，不画第二个角色，不加文字、水印、边框或场景。';
const PARAMETERS = { n: 1, size: '1024*1024', watermark: false, prompt_extend: false, negative_prompt: '原照片背景，写实背景，果园，山川，风景，树林，背景树叶，树枝，地面，建筑，多角色，多个水果，拼图，海报，文字，标牌，水印，杂乱背景，改变水果种类' };
const TIMEOUT_MS = 30000;

function callJson(base, pathname, options, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(base.replace(/\/+$/, '') + pathname);
    if (target.protocol !== 'https:' || target.username || target.password) { reject(new Error('dashscope_invalid_url')); return; }
    const body = payload === undefined ? null : JSON.stringify(payload);
    let timer;
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    const request = https.request({
      hostname: target.hostname, port: target.port || 443, path: target.pathname + target.search, method: body ? 'POST' : 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + options.apiKey }, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}, options.extraHeaders || {})
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { request.destroy(); response.destroy(); finish(new Error('dashscope_response_too_large')); return; }
        chunks.push(chunk);
      });
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('dashscope_response_aborted')));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = null; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(new Error('dashscope_http_' + response.statusCode)); return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { finish(new Error('dashscope_invalid_json')); return; }
        finish(null, parsed);
      });
    });
    // An absolute deadline also covers DNS/connect and a response that trickles forever.
    timer = setTimeout(() => { request.destroy(new Error('dashscope_timeout')); }, options.timeoutMs || TIMEOUT_MS);
    request.on('error', error => finish(error));
    if (body) request.write(body);
    request.end();
  });
}

function mapTaskStatus(taskStatus) {
  if (taskStatus === 'SUCCEEDED') return 'succeeded';
  if (taskStatus === 'RUNNING') return 'generating';
  if (taskStatus === 'PENDING') return 'queued';
  return 'failed';
}

// Qwen image editing accepts an image data URL in input.messages. The cloud
// endpoint is synchronous, so only this adapter owns the background work; callers
// still receive an immediate task ID and poll fast in-memory status snapshots.
// Protocol: https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
function createDashScopeImageAdapter(options = {}) {
  const apiKey = options.apiKey;
  const base = options.baseUrl || 'https://dashscope.aliyuncs.com';
  const transport = options.transport || callJson;
  if (!apiKey) return null;
  const now = options.now || Date.now;
  const ttl = options.ttl || 30 * 60 * 1000;
  const maxJobs = options.maxJobs || 100, maxConcurrent = options.maxConcurrent || 2;
  const uploaded = new Map(), jobs = new Map();
  let active = 0;
  function purge() {
    for (const map of [uploaded, jobs]) for (const [id, value] of map) if (value.expiresAt <= now()) map.delete(id);
  }
  async function run(job, imageUrl) {
    job.status = 'generating';
    try {
      const response = await transport(base, '/api/v1/services/aigc/multimodal-generation/generation', { apiKey, timeoutMs: options.timeoutMs || 100000 }, {
        model: MODEL,
        input: { messages: [{ role: 'user', content: [{ image: imageUrl }, { text: PROMPT }] }] },
        parameters: { ...PARAMETERS }
      });
      const choices = response && response.output && response.output.choices;
      const content = Array.isArray(choices) && choices[0] && choices[0].message && choices[0].message.content;
      const images = Array.isArray(content) ? content.filter(item => item && typeof item.image === 'string') : [];
      if (images.length !== 1) throw new Error('dashscope_missing_image');
      const url = new URL(images[0].image);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('dashscope_invalid_image');
      job.imageUrl = url.href; job.status = 'succeeded';
    } catch (_) { job.status = 'failed'; }
    finally { active -= 1; }
  }
  return {
    async upload({ bytes, mimeType }) {
      purge();
      if (uploaded.size >= 200) throw new Error('dashscope_upload_limit');
      const id = randomUUID();
      uploaded.set(id, { dataUrl: 'data:' + mimeType + ';base64,' + bytes.toString('base64'), expiresAt: now() + ttl });
      return id;
    },
    async create({ resource, requestId }) {
      purge();
      const stored = typeof resource === 'string' ? uploaded.get(resource) : null;
      if (!stored) throw new Error('dashscope_invalid_resource');
      if (requestId) {
        for (const [id, job] of jobs) if (job.requestId === requestId) {
          if (job.resource !== resource) throw new Error('dashscope_request_conflict');
          return id;
        }
      }
      if (jobs.size >= maxJobs || active >= maxConcurrent) throw new Error('dashscope_server_busy');
      const id = randomUUID();
      const job = { resource, requestId, status: 'queued', expiresAt: now() + ttl };
      jobs.set(id, job); active += 1;
      Promise.resolve().then(() => run(job, stored.dataUrl));
      return id;
    },
    async status(providerId) {
      purge();
      const job = jobs.get(providerId);
      if (!job) throw new Error('dashscope_task_expired');
      return job.status === 'succeeded' ? { status: job.status, imageUrl: job.imageUrl } : { status: job.status };
    }
  };
}

// 文生图适配器：关键词 → 国风插画（wanx2.1-t2i-turbo 异步任务）。
function createDashScopeText2ImageAdapter(options = {}) {
  const apiKey = options.apiKey;
  const base = options.baseUrl || 'https://dashscope.aliyuncs.com';
  const transport = options.transport || callJson;
  if (!apiKey) return null;
  const MODEL_T2I = 'wanx2.1-t2i-turbo';
  return {
    async create({ prompt }) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('dashscope_missing_prompt');
      const response = await transport(base, '/api/v1/services/aigc/text2image/image-synthesis', { apiKey, extraHeaders: { 'X-DashScope-Async': 'enable' } }, {
        model: MODEL_T2I,
        input: { prompt },
        parameters: { size: '768*768', n: 1 }
      });
      const taskId = response && response.output && response.output.task_id;
      if (typeof taskId !== 'string' || !taskId) throw new Error('dashscope_missing_task_id');
      return taskId;
    },
    async status(providerId) {
      const response = await transport(base, '/api/v1/tasks/' + encodeURIComponent(providerId), { apiKey });
      const output = response && response.output || {};
      const status = mapTaskStatus(output.task_status);
      const imageUrl = typeof output.image_url === 'string' ? output.image_url
        : Array.isArray(output.results) && output.results[0] && typeof output.results[0].url === 'string' ? output.results[0].url : null;
      if (status === 'succeeded' && imageUrl) return { status, imageUrl };
      return { status };
    }
  };
}

// 腾讯 CloudBase 混元生图适配器（Node SDK 渠道）。
// 该能力仅允许 SDK 调用（HTTP 网关不开放）；SDK 用 CloudBase API Key（accessKey）鉴权，
// 与文字通道同一套凭证，无需腾讯云 SecretId/SecretKey。generateImage 为同步长耗时接口
//（10-60s+），与 DashScope 照片适配器一致：create() 立即返回任务 id，后台执行，status() 查询内存快照。
const TCB_T2I_MODEL = 'HY-Image-3.0-Plus-4090-Tob-v1.0';    // 文生图
const TCB_I2I_MODEL = 'HY-Image-v3.0-I2I-ToB-v1.0.1';        // 图生图（垫图）
const TCB_SIZE = '1024x1024';

function createCloudBaseImageAdapters(options = {}) {
  const { envId, accessKey } = options;
  if (!envId || !accessKey) return null;
  const sdk = options.sdk || require('@cloudbase/node-sdk');
  const now = options.now || Date.now;
  const ttl = options.ttl || 30 * 60 * 1000;
  const maxJobs = options.maxJobs || 100, maxConcurrent = options.maxConcurrent || 2;
  const app = sdk.init({ env: envId, accessKey, timeout: 180000 });
  const imageModel = app.ai().createImageModel('hunyuan-image');
  const uploads = new Map(), jobs = new Map();
  let active = 0;
  function purge() {
    for (const map of [uploads, jobs]) for (const [id, value] of map) if (value.expiresAt <= now()) map.delete(id);
  }
  function validateImageUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('tcb_invalid_image');
    return parsed.href;
  }
  async function run(job, payload) {
    job.status = 'generating';
    try {
      const response = await imageModel.generateImage(payload);
      const url = response && Array.isArray(response.data) && response.data[0] && response.data[0].url;
      if (typeof url !== 'string' || !url) throw new Error('tcb_missing_image');
      job.imageUrl = validateImageUrl(url); job.status = 'succeeded';
    } catch (error) { console.error('[tcb-image]', error && error.stack || error); job.status = 'failed'; }
    finally { active -= 1; }
  }
  function launch(job, payload) {
    jobs.set(job.id, job); active += 1;
    Promise.resolve().then(() => run(job, payload));
    return job.id;
  }
  async function statusOf(providerId) {
    purge();
    const job = jobs.get(providerId);
    if (!job) throw new Error('tcb_task_expired');
    return job.status === 'succeeded' ? { status: job.status, imageUrl: job.imageUrl } : { status: job.status };
  }
  return {
    // 照片 → 水果伙伴卡通插画（图生图，垫图走 images base64）
    companion: {
      async upload({ bytes, mimeType }) {
        purge();
        if (uploads.size >= 200) throw new Error('tcb_upload_limit');
        const id = randomUUID();
        uploads.set(id, { base64: bytes.toString('base64'), expiresAt: now() + ttl });
        void mimeType;
        return id;
      },
      async create({ resource, requestId }) {
        purge();
        const stored = typeof resource === 'string' ? uploads.get(resource) : null;
        if (!stored) throw new Error('tcb_invalid_resource');
        if (requestId) {
          for (const [id, job] of jobs) if (job.requestId === requestId) {
            if (job.resource !== resource) throw new Error('tcb_request_conflict');
            return id;
          }
        }
        if (jobs.size >= maxJobs || active >= maxConcurrent) throw new Error('tcb_server_busy');
        return launch({ id: randomUUID(), resource, requestId, status: 'queued', expiresAt: now() + ttl },
          { model: TCB_I2I_MODEL, prompt: PROMPT, images: [stored.base64], size: TCB_SIZE });
      },
      status: statusOf
    },
    // 关键词 → 国风插画（文生图）
    text2image: {
      async create({ prompt, requestId }) {
        purge();
        if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('tcb_missing_prompt');
        if (requestId) {
          for (const [id, job] of jobs) if (job.requestId === requestId) return id;
        }
        if (jobs.size >= maxJobs || active >= maxConcurrent) throw new Error('tcb_server_busy');
        return launch({ id: randomUUID(), requestId, status: 'queued', expiresAt: now() + ttl },
          { model: TCB_T2I_MODEL, prompt, size: TCB_SIZE, revise: { value: false }, enable_thinking: { value: false } });
      },
      status: statusOf
    }
  };
}

module.exports = { createDashScopeImageAdapter, createDashScopeText2ImageAdapter, createCloudBaseImageAdapters, MODEL };
