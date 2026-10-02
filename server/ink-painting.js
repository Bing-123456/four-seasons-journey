'use strict';

const { randomUUID } = require('node:crypto');
const { InputError } = require('./validation');

// AI 国风图像生成：关键词 → 农耕主题国风插画（文生图异步任务）。
// 与照片转卡通一致：未配置图像服务时诚实降级（image_provider_disabled）。
const PROMPT_TEMPLATE = '中国传统水墨国风插画，农耕文化主题：{keyword}。柔和留白，宣纸质感，淡彩设色，古朴田园意境，适合作为文旅小程序配图。';
const MAX_JOBS = 100;
const TTL = 30 * 60 * 1000;

function normalizeKeyword(value) {
  if (typeof value !== 'string') throw new InputError('请填写插画关键词', 'invalid_keyword');
  const keyword = value.trim();
  if (!keyword || keyword.length > 40) throw new InputError('关键词请控制在 40 字以内', 'invalid_keyword');
  if (/https?:|www\./i.test(keyword)) throw new InputError('关键词不能包含链接', 'invalid_keyword');
  return keyword;
}

function createInkPaintingService(adapter, options = {}) {
  const artifacts = options.artifacts || null;
  const jobs = new Map();
  function ready() { if (!adapter) throw new InputError('图像生成服务尚未配置，暂时无法生成国风插画', 'image_provider_disabled', 503); }
  function purge() { for (const [id, job] of jobs) if (job.expiresAt <= Date.now()) jobs.delete(id); }
  async function submit(body, owner = 'local-development') {
    ready(); purge();
    const keyword = normalizeKeyword(body && body.keyword);
    if (jobs.size >= MAX_JOBS) throw new InputError('生成任务已满，请稍后重试', 'server_busy', 503);
    const id = randomUUID();
    const task = { id, keyword, owner, status: 'queued', expiresAt: Date.now() + TTL };
    jobs.set(id, task);
    try { task.providerId = await adapter.create({ prompt: PROMPT_TEMPLATE.replace('{keyword}', keyword), requestId: id }); }
    catch (error) { task.status = 'failed'; }
    return { taskId: id, status: task.status };
  }
  async function status(id, owner = 'local-development', origin = '') {
    ready(); purge();
    const job = jobs.get(id);
    if (!job || job.owner !== owner) throw new InputError('任务不存在或已过期', 'not_found', 404);
    if (job.result) return { ...job.result };
    if (job.status === 'failed') return { taskId: id, status: 'failed', message: '生成失败，请更换关键词重试' };
    if (!job.providerId) return { taskId: id, status: 'queued' };
    let result;
    try { result = await adapter.status(job.providerId); }
    catch { throw new InputError('图像服务查询暂不可用，请稍后重试', 'image_provider_unavailable', 502); }
    if (!result || !['queued', 'generating', 'succeeded', 'failed'].includes(result.status)) throw new InputError('图像服务返回无效状态', 'invalid_image_response', 502);
    if (result.status === 'succeeded' && (typeof result.imageUrl !== 'string' || !/^https:\/\//.test(result.imageUrl))) throw new InputError('图像结果无效', 'invalid_image_response', 502);
    job.status = result.status;
    // 把供应商临时 OSS 图片拉回服务端本地持久化，客户端用 wx.downloadFile 从本服务域名下载。
    let imageUrl = result.imageUrl;
    if (result.status === 'succeeded' && artifacts) {
      try {
        const relative = await artifacts.persistFromUrl(result.imageUrl, id);
        imageUrl = origin + relative;
      } catch (error) { imageUrl = result.imageUrl; }
    }
    const response = Object.assign({ taskId: id, status: result.status, keyword: job.keyword },
      result.status === 'succeeded' ? { imageUrl, label: '果灵国风插画' } : {},
      result.status === 'failed' ? { message: '生成失败，请更换关键词重试' } : {});
    if (['succeeded', 'failed'].includes(result.status)) job.result = response;
    return { ...response };
  }
  return { submit, status, purge, capabilities: { configured: !!adapter, availability: adapter ? 'not-checked' : 'disabled' } };
}

module.exports = { createInkPaintingService, normalizeKeyword };
