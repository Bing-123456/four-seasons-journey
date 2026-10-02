'use strict';

const { mkdir, writeFile, readFile, readdir, unlink, stat } = require('node:fs/promises');
const path = require('node:path');

// AI 生成结果落盘存储：把供应商的临时 OSS 链接下载回 VPS，
// 通过本服务自己的域名提供下载，客户端无需把第三方域名加入白名单。
const NAME = /^[a-z0-9-]{6,80}\.png$/;

function createArtifactStore(dir, options = {}) {
  const maxAgeMs = options.maxAgeMs || 7 * 24 * 60 * 60 * 1000;
  let ready;
  const ensure = () => (ready = ready || mkdir(dir, { recursive: true }));

  // 下载供应商结果图并保存为 <taskId>.png，返回本服务相对路径。
  async function persistFromUrl(upstreamUrl, taskId) {
    await ensure();
    if (!/^https:\/\//.test(upstreamUrl)) throw new Error('artifact_upstream_invalid');
    const response = await fetch(upstreamUrl);
    if (!response.ok) throw new Error('artifact_download_failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('artifact_empty');
    const filename = taskId + '.png';
    await writeFile(path.join(dir, filename), bytes);
    return '/artifacts/' + filename;
  }

  async function read(filename) {
    if (!NAME.test(filename)) return null;
    try {
      const bytes = await readFile(path.join(dir, filename));
      return { bytes, contentType: 'image/png' };
    } catch (error) { return null; }
  }

  // 清理超过保留期的落盘图片。
  async function purge() {
    try {
      await ensure();
      const now = Date.now();
      for (const name of await readdir(dir)) {
        if (!NAME.test(name)) continue;
        const full = path.join(dir, name);
        const info = await stat(full);
        if (now - info.mtimeMs > maxAgeMs) await unlink(full);
      }
    } catch (error) { /* 清理失败不影响业务 */ }
  }

  return { persistFromUrl, read, purge };
}

module.exports = { createArtifactStore };
