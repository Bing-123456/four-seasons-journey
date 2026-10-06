'use strict';
// 发布页：仿朋友圈，只保留「发表」（选图 + 文字 + 发表），不含位置/提醒/可见范围。
// 上传链路（评审 10.5 改造）：callContainer 请求体限制 100KB，无法直接传大图；
// 因此图片与头像先用 wx.cloud.uploadFile 直传云存储拿 fileID，
// 再把 fileID 发给云托管 /api/community/publish 入库（与识图功能同一套已验证链路）。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
const CLOUD_RUN_SERVICE = 'guayouji-server';
// 图片/头像直传 CloudBase 云存储（cloud1 环境，与后端数据库同环境；
// wx.cloud.init 默认指向云托管 prod 环境，所以这里必须显式指定 config.env）。
const CLOUDBASE_UPLOAD_ENV = 'cloud1-d5gcgaukz8cb3f907';

function isCloudFileId(value) { return typeof value === 'string' && value.indexOf('cloud://') === 0; }

function uploadToCloud(cloudPath, filePath) {
  return new Promise((resolve, reject) => wx.cloud.uploadFile({
    config: { env: CLOUDBASE_UPLOAD_ENV },
    cloudPath: cloudPath,
    filePath: filePath,
    success: result => resolve(result.fileID),
    fail: error => reject(new Error('图片上传失败' + (error && error.errMsg ? '（' + error.errMsg + '）' : '')))
  }));
}

function callApi(method, path, body) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: CLOUD_RUN_ENV },
      path: path,
      method: method,
      header: { 'X-WX-SERVICE': CLOUD_RUN_SERVICE, 'Content-Type': 'application/json' },
      data: body || {},
      timeout: 20000,
      success: res => {
        let data = res.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { data = null; } }
        if (res.statusCode >= 200 && res.statusCode < 300 && data && typeof data === 'object') resolve(data);
        else reject(new Error((data && data.error) || i18n.t('network_error')));
      },
      fail: () => reject(new Error(i18n.t('network_error')))
    });
  });
}

// 头像可能是：本地裁剪临时路径（需上传）、cloud:// fileID（直接用）、
// 打包内置资源 /assets/（别人也能访问，不入库，前端渲染时兜底默认头像）、空。
function normalizeAvatar(avatarLocal, stamp) {
  if (!avatarLocal) return Promise.resolve('');
  if (isCloudFileId(avatarLocal)) return Promise.resolve(avatarLocal);
  if (/^https?:/i.test(avatarLocal) || avatarLocal.indexOf('/assets/') === 0) return Promise.resolve('');
  return uploadToCloud('game-community/avatars/' + stamp + '.jpg', avatarLocal).catch(() => '');
}

Page({
  data: { imagePath: '', text: '', publishing: false, L: {} },
  onLoad: function () {
    i18n.applyNav('community_post_title');
    this.setData({ L: i18n.labels(['community_choose_photo', 'community_text_ph', 'community_publish', 'network_error', 'community_offline']) });
  },
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  choosePhoto: function () {
    if (typeof wx === 'undefined' || !wx.chooseMedia) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: res => { const f = res.tempFiles && res.tempFiles[0]; if (f && f.tempFilePath) this.setData({ imagePath: f.tempFilePath }); },
      fail: () => {}
    });
  },
  textInput: function (event) { this.setData({ text: event.detail.value }); },
  publish: function () {
    if (this.data.publishing || !this.data.imagePath) return;
    if (typeof wx === 'undefined' || !wx.cloud) { wx.showToast({ title: i18n.t('community_offline'), icon: 'none' }); return; }
    this.setData({ publishing: true });
    const me = store.getIdentity() || {};
    const nickname = me.nickname || i18n.t('traveller');
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
    uploadToCloud('game-community/posts/' + stamp + '.jpg', this.data.imagePath)
      .then(imageFileId => normalizeAvatar(store.getAvatar(), stamp).then(avatarFileId =>
        callApi('POST', '/api/community/publish', { imageFileId: imageFileId, avatarFileId: avatarFileId, text: this.data.text, nickname: nickname })
      ))
      .then(() => {
        wx.showToast({ title: i18n.t('community_published'), icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1, fail() {} }), 600);
      })
      .catch(error => {
        this.setData({ publishing: false });
        wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' });
      });
  }
});
