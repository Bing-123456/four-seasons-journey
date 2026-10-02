'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { InputError } = require('./validation');

// Uploads and generation jobs are scoped to the authenticated session.
function createCompanionService(adapter, options = {}) {
  const artifacts = options.artifacts || null;
  const uploads = new Map(), jobs = new Map();
  const ttl = 30 * 60 * 1000;
  const capabilities = { configured: !!adapter, availability: adapter ? 'not-checked' : 'disabled', uploadEnabled: !!adapter, maxImageBytes: 2 * 1024 * 1024, styles: ['fruit-line-art'] };
  function owner(request) { return createHash('sha256').update(request.headers.authorization || 'local-development').digest('hex'); }
  function purge() { for (const map of [uploads, jobs]) for (const [id, item] of map) if (item.expiresAt <= Date.now()) map.delete(id); }
  function ready() { if (!adapter) throw new InputError('照片生成服务尚未配置，图片未接收', 'image_provider_disabled', 503); purge(); }
  function lookup(map, id, user) { const value = map.get(id); if (!value || value.owner !== user) throw new InputError('资源不存在或已过期', 'not_found', 404); return value; }
  async function upload(body, user) {
    ready();
    if (!body || body.confirmed !== true || !['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType) || typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) || body.base64.length % 4) throw new InputError('请确认上传并选择有效图片', 'invalid_image');
    const bytes = Buffer.from(body.base64, 'base64');
    if (!bytes.length || bytes.length > capabilities.maxImageBytes) throw new InputError('图片超过2MB限制', 'body_too_large', 413);
    const signature = body.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : body.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!signature) throw new InputError('图片格式与文件内容不符', 'invalid_image');
    if (uploads.size >= 100) throw new InputError('临时图片已满，请稍后重试', 'server_busy', 503);
    let resource;
    try { resource = await adapter.upload({ bytes, mimeType: body.mimeType }); }
    catch { throw new InputError('照片服务暂不可用，请稍后重试', 'image_provider_unavailable', 502); }
    const resourceId = randomUUID(); const expiresAt = Date.now() + ttl;
    uploads.set(resourceId, { resource, owner: user, expiresAt });
    return { resourceId, expiresAt };
  }
  async function generate(body, user) {
    ready();
    if (!body || body.style !== 'fruit-line-art' || typeof body.resourceId !== 'string' || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId)) throw new InputError('生成参数无效');
    const source = lookup(uploads, body.resourceId, user);
    for (const [id, job] of jobs) if (job.owner === user && job.requestId === body.requestId) {
      if (job.resourceId !== body.resourceId) throw new InputError('请求标识已用于另一张图片', 'request_conflict', 409);
      return { taskId: id, status: job.status };
    }
    if (jobs.size >= 100) throw new InputError('生成任务已满', 'server_busy', 503);
    const id = randomUUID();
    const task = { owner: user, requestId: body.requestId, resourceId: body.resourceId, status: 'queued', expiresAt: Date.now() + ttl };
    jobs.set(id, task);
    try { task.providerId = await adapter.create({ resource: source.resource, style: body.style, requestId: id }); }
    catch (error) { task.status = 'failed'; }
    return { taskId: id, status: task.status };
  }
  async function status(id, user, origin = '') {
    ready(); const job = lookup(jobs, id, user);
    if (job.result) return { ...job.result };
    if (job.status === 'failed') return { taskId: id, status: 'failed', message: '生成失败，请重试或使用内置模板' };
    if (!job.providerId) return { taskId: id, status: 'queued' };
    let result;
    try { result = await adapter.status(job.providerId); }
    catch { throw new InputError('图像服务查询暂不可用，请稍后重试', 'image_provider_unavailable', 502); }
    if (!result || !['queued', 'generating', 'succeeded', 'failed'].includes(result.status)) throw new InputError('图像服务返回无效状态', 'invalid_image_response', 502);
    if (result.status === 'succeeded' && (typeof result.imageUrl !== 'string' || !/^https:\/\//.test(result.imageUrl))) throw new InputError('图像结果无效', 'invalid_image_response', 502);
    job.status = result.status;
    // 成品落盘到 VPS，客户端从本服务域名下载（供应商临时 OSS 链接不出网）。
    let imageUrl = result.imageUrl;
    if (result.status === 'succeeded' && artifacts) {
      try {
        const relative = await artifacts.persistFromUrl(result.imageUrl, id);
        imageUrl = origin + relative;
      } catch (error) { imageUrl = result.imageUrl; }
    }
    const response = { taskId: id, status: result.status, ...(result.status === 'succeeded' ? { imageUrl, label: 'AI创作插画' } : {}), ...(result.status === 'failed' ? { message: '生成失败，请重试或使用内置模板' } : {}) };
    if (['succeeded', 'failed'].includes(result.status)) job.result = response;
    return { ...response };
  }
  return { capabilities, owner, ready, upload, generate, status, purge: null };
}
module.exports = { createCompanionService };
