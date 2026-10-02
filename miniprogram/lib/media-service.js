'use strict';

const store = require('./store');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// 微信云托管环境 ID 与服务名；小程序端通过 wx.cloud.callContainer 直连，无需配置服务器域名。
const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
const CLOUD_RUN_SERVICE = 'guayouji-server';

function isCloudRunApiBase(apiBase) {
  return typeof apiBase === 'string' && apiBase.indexOf('tcloudbase.com') !== -1;
}

function cloudApiAvailable() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callContainer === 'function';
}

function capture() {
  const connection = store.getCloudConnection();
  if (!connection.token) throw new Error('先在「我的」配对云端服务，配对后演示账户也能生成');
  return { apiBase: connection.apiBase, token: connection.token, partition: store.capturePartition() };
}

function isCurrent(context) {
  const connection = store.getCloudConnection();
  return context.apiBase === connection.apiBase && context.token === connection.token;
}

function safeParseData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try { const parsed = JSON.parse(data); if (parsed && typeof parsed === 'object') return parsed; } catch (error) {}
  }
  return null;
}
function handleResponse(context, response, resolve, reject) {
  if (!isCurrent(context)) { reject(new Error('服务连接或账户已变更，请重新操作')); return; }
  const data = safeParseData(response.data) || {};
  if (response.statusCode >= 200 && response.statusCode < 300 && typeof data === 'object') { resolve(data); return; }
  if (response.statusCode === 401) {
    store.clearSession();
    reject(new Error('开发会话未配对或已过期，请在「我的」重新配对'));
  } else {
    const error = new Error(data.error || (response.statusCode === 429 ? '请求过于频繁，请稍后重试' : '图片服务暂不可用，请稍后重试'));
    error.retryable = response.statusCode === 429 || response.statusCode >= 500;
    reject(error);
  }
}

function networkErrorMessage(error, fallback) {
  const errMsg = (error && error.errMsg) || '';
  if (/timeout/i.test(errMsg)) return '图片服务响应超时，请稍后重试';
  return (fallback || '未连接图片服务') + (errMsg ? '（' + errMsg + '）' : '') + '，请在「我的」检查连接';
}

function cloudRequest(context, method, path, body, resolve, reject) {
  wx.cloud.callContainer({
    config: { env: CLOUD_RUN_ENV },
    path,
    method,
    header: {
      'X-WX-SERVICE': CLOUD_RUN_SERVICE,
      'Authorization': 'Bearer ' + context.token,
      'Content-Type': 'application/json'
    },
    data: body,
    timeout: 45000,
    success: response => handleResponse(context, response, resolve, reject),
    fail: error => reject(new Error(networkErrorMessage(error, '云托管服务调用失败')))
  });
}

function httpRequest(context, method, path, body, resolve, reject) {
  const header = { 'Content-Type': 'application/json' };
  if (context.token) header.Authorization = 'Bearer ' + context.token;
  wx.request({
    url: context.apiBase + path, method, data: body, header, timeout: 45000,
    success: response => handleResponse(context, response, resolve, reject),
    fail: error => reject(new Error(networkErrorMessage(error, '未连接图片服务')))
  });
}

function request(context, method, path, body) {
  return new Promise((resolve, reject) => {
    if (!isCurrent(context)) { reject(new Error('服务连接或账户已变更，请重新操作')); return; }
    if (isCloudRunApiBase(context.apiBase) && cloudApiAvailable()) {
      cloudRequest(context, method, path, body, resolve, reject);
    } else {
      httpRequest(context, method, path, body, resolve, reject);
    }
  });
}

function prepareEditingImage(filePath) {
  if (typeof wx.getImageInfo !== 'function') return Promise.resolve(filePath);
  return new Promise((resolve, reject) => wx.getImageInfo({ src: filePath, success: info => {
    if (Math.min(info.width, info.height) >= 512 && Math.max(info.width, info.height) <= 4096) { resolve(filePath); return; }
    if (!info.width || !info.height || !wx.createOffscreenCanvas || !wx.canvasToTempFilePath) { reject(new Error('请使用宽高均为 512–4096 像素的照片')); return; }
    try {
      const scale = Math.min(1, 2048 / Math.max(info.width, info.height));
      const w = Math.round(info.width * scale), h = Math.round(info.height * scale);
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: Math.max(512,w), height: Math.max(512,h) });
      const ctx = canvas.getContext('2d'), image = canvas.createImage();
      image.onload = () => {
        try {
          ctx.fillStyle = '#FFFDF8'; ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
          wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.85,
            success: result => resolve(result.tempFilePath), fail: () => reject(new Error('照片处理失败，请重新选择')) });
        } catch (error) { reject(new Error('照片处理失败，请重新选择')); }
      };
      image.onerror = () => reject(new Error('照片读取失败，请重新选择'));
      image.src = filePath;
    } catch (error) { reject(new Error('照片处理失败，请重新选择')); }
  }, fail: () => reject(new Error('照片信息读取失败，请重新选择')) }));
}

function resizeWithCanvas(filePath, maxSide, quality) {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: filePath,
    success: info => {
      if (!info.width || !info.height || !wx.createOffscreenCanvas || !wx.canvasToTempFilePath) { reject(new Error('照片处理失败，请重新选择')); return; }
      const scale = Math.min(1, maxSide / Math.max(info.width, info.height));
      const w = Math.round(info.width * scale), h = Math.round(info.height * scale);
      try {
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: Math.max(64, w), height: Math.max(64, h) });
        const ctx = canvas.getContext('2d'), image = canvas.createImage();
        image.onload = () => {
          try {
            ctx.fillStyle = '#FFFDF8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, w, h);
            wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality,
              success: result => resolve(result.tempFilePath), fail: () => reject(new Error('照片处理失败，请重新选择')) });
          } catch (error) { reject(new Error('照片处理失败，请重新选择')); }
        };
        image.onerror = () => reject(new Error('照片读取失败，请重新选择'));
        image.src = filePath;
      } catch (error) { reject(new Error('照片处理失败，请重新选择')); }
    },
    fail: () => reject(new Error('照片信息读取失败，请重新选择'))
  }));
}

function compressToLimit(filePath, limit, read) {
  // 先缩放到最长边 640，再逐档降低质量，直到 base64 低于限制。
  const tryCompress = (quality) => resizeWithCanvas(filePath, 640, quality).then(path => read(path)).then(base64 => {
    if (base64.length <= limit) return base64;
    if (quality <= 30) throw new Error('照片压缩后仍过大，请换一张更小的图片');
    return tryCompress(Math.max(30, quality - 20));
  });
  return tryCompress(70);
}

function uploadImageToCloud(filePath) {
  return new Promise((resolve, reject) => wx.cloud.uploadFile({
    cloudPath: 'identify/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.jpg',
    filePath,
    success: result => resolve(result.fileID),
    fail: error => reject(new Error('图片上传失败' + (error && error.errMsg ? '（' + error.errMsg + '）' : '')))
  }));
}

function getTempFileURL(fileID) {
  return new Promise((resolve, reject) => wx.cloud.getTempFileURL({
    fileList: [fileID],
    success: result => {
      const item = result.fileList && result.fileList[0];
      if (item && item.tempFileURL) resolve(item.tempFileURL);
      else reject(new Error('图片链接生成失败'));
    },
    fail: error => reject(new Error('图片链接生成失败' + (error && error.errMsg ? '（' + error.errMsg + '）' : '')))
  }));
}

function readImage(filePath, options) {
  // 微信云托管 callContainer 请求体限制 100KB，无法直接传 base64 大图。
  // 真机/预览环境：先上传到微信云存储，再用 wx.cloud.getTempFileURL 换取临时 HTTPS URL，
  // 服务端直接用 fetch 下载识别；这样既避开 body 限制，也不依赖服务端 wx-server-sdk。
  // Node 测试环境：wx.cloud.uploadFile 不存在，回退到 base64 旧路，保证单测可跑。
  if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.uploadFile === 'function') {
    return (options && options.forEditing ? prepareEditingImage(filePath) : Promise.resolve(filePath))
      .then(path => uploadImageToCloud(path))
      .then(fileID => getTempFileURL(fileID))
      .then(imageUrl => ({ imageUrl }));
  }
  const read = path => new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath: path, encoding: 'base64', success: result => resolve(result.data), fail: () => reject(new Error('照片读取失败，请重新选择'))
  }));
  const limit = options && options.maxBase64Length ? options.maxBase64Length : Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
  let source = filePath;
  return (options && options.forEditing ? prepareEditingImage(filePath) : Promise.resolve(filePath)).then(path => { source = path; return read(path); }).then(async base64 => {
    if (base64.length > limit && typeof wx.compressImage === 'function') {
      const path = await new Promise((resolve, reject) => wx.compressImage({ src: source, quality: 60,
        success: result => resolve(result.tempFilePath), fail: () => reject(new Error('照片过大，请选择 2 MB 以内的图片')) }));
      base64 = await read(path);
    }
    if (base64.length > limit && options && options.maxBase64Length) {
      try { base64 = await compressToLimit(source, limit, read); } catch (error) { /* keep original and let next check throw if still over */ }
    }
    if (base64.length > limit) throw new Error(options && options.maxBase64Length ? '照片压缩后仍过大，请换一张更小的图片' : '照片过大，请选择 2 MB 以内的图片');
    const mimeType = base64.startsWith('/9j/') ? 'image/jpeg' : base64.startsWith('iVBORw0KGgo') ? 'image/png' : '';
    if (!mimeType) throw new Error('请选择 JPG 或 PNG 图片');
    return { mimeType, base64 };
  });
}

module.exports = { capture, isCurrent, request, readImage };
