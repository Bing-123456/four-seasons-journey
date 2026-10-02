'use strict';

// 微信云存储中转：服务端在云托管容器内把 AI 生成的音频/图片上传到微信云存储，
// 客户端用 wx.cloud.downloadFile 直接下载本地文件，避免 callContainer 100KB 限制
// 和云托管多实例/缩容导致的本地文件丢失。
const ENV = process.env.CLOUD_RUN_ENV || process.env.CLOUDENV || 'prod-d8gw4a7vm69f14375';

let cloud = null;
let initialized = false;

try {
  cloud = require('wx-server-sdk');
  cloud.init({ env: ENV });
  initialized = true;
} catch (error) {
  // 本地测试或未安装依赖时降级：返回 null，调用方应回退到本地文件方案。
  initialized = false;
}

function isAvailable() { return initialized && cloud; }

function randomName(prefix, ext) {
  const crypto = require('node:crypto');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return `${prefix}/${date}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
}

async function uploadBuffer(buffer, cloudPath, contentType) {
  if (!isAvailable()) throw new Error('cloud_storage_unavailable');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('cloud_storage_empty');
  const result = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  if (!result || !result.fileID) throw new Error('cloud_storage_upload_failed');
  return result.fileID;
}

async function downloadBuffer(fileID) {
  if (!isAvailable()) throw new Error('cloud_storage_unavailable');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const tempPath = path.join(os.tmpdir(), 'guoling-cloud-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  try {
    await cloud.downloadFile({ fileID, tempFilePath: tempPath });
    const buffer = await fs.readFile(tempPath);
    await fs.unlink(tempPath).catch(() => {});
    return buffer;
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function downloadBufferFromUrl(url, maxBytes = 5 * 1024 * 1024) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('cloud_storage_download_failed');
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength > maxBytes) throw new Error('cloud_storage_download_too_large');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('cloud_storage_download_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = {
  isAvailable,
  randomName,
  uploadBuffer,
  downloadBuffer,
  downloadBufferFromUrl,
  env: ENV
};
