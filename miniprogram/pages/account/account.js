'use strict';

// 我的资料：设置头像（相册照片）与修改昵称，独立子页面；与打招呼小水果（伙伴）无关。
// 头像裁剪（10.5 改版·微信式）：照片完整铺在舞台上不动，白色正方形裁剪框可拖动、
// 四角与四边中点可拉伸；确认后按框的位置从原图裁出 512×512 头像。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const cropMath = require('../../lib/crop-math');
const community = require('../../lib/community');

Page({
  data: { avatarPath: '', nicknameInput: '', saving: false, cropping: false, cropImage: '', disp: null, frame: null, L: {} },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
    i18n.applyNav('nav_account'); this.refresh();
  },
  refresh: function () {
    const identity = store.getIdentity();
    this.setData({
      avatarPath: store.getAvatar(),
      nicknameInput: identity.nickname,
      L: i18n.labels(['nav_account','avatar_fallback','avatar_edit','avatar_set_hint','account_nickname_label','nickname_ph','save','account_nickname_hint','account_back','profile_saved','acc_avatar_aria','acc_nick_aria','crop_title','crop_confirm','crop_hint','cancel'])
    });
  },
  // ---- 头像：隐私弹窗（允许/取消）→ 相册/相机，仅保存在本机 ----
  changeAvatar: function () {
    const page = this;
    wx.showModal({
      title: i18n.t('acc_avatar_title'),
      content: i18n.t('avatar_privacy'),
      confirmText: i18n.t('allow'),
      cancelText: i18n.t('cancel'),
      success: result => {
        if (!result.confirm) return;
        wx.chooseMedia({
          count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
          success: chosen => {
            const file = chosen.tempFiles && chosen.tempFiles[0];
            if (!file || !file.tempFilePath) return;
            page.prepareCrop(file.tempFilePath);
          },
          fail: () => {}
        });
      }
    });
  },
  // ---- 裁剪准备：先渲染蒙层，量出舞台真实尺寸，再按 contain 铺照片并放好初始裁剪框 ----
  prepareCrop: function (path) {
    const page = this;
    wx.getImageInfo({
      src: path,
      success: info => {
        page._cropInfo = info;
        page._cropGesture = null;
        page.setData({ cropImage: path, cropping: true, disp: null, frame: null }, () => {
          page.measureStage(stage => {
            const disp = cropMath.fitPhoto(info, stage.width, stage.height);
            if (!disp) { page.setData({ cropping: false, cropImage: '' }); wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' }); return; }
            page._cropStage = stage;
            page.setData({ disp: disp, frame: cropMath.initialFrame(disp) });
          });
        });
      },
      fail: () => wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' })
    });
  },
  // 量舞台：优先用节点真实矩形；拿不到时按屏幕尺寸估算（保底不崩）。
  measureStage: function (callback) {
    const sys = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
    const fallback = { left: 0, top: 0, width: (sys && sys.windowWidth) || 375, height: Math.max(160, ((sys && sys.windowHeight) || 667) - 160) };
    if (typeof wx.createSelectorQuery !== 'function') { callback(fallback); return; }
    wx.createSelectorQuery().in(this).select('.crop-stage').boundingClientRect(rect => {
      if (rect && rect.height) callback({ left: rect.left || 0, top: rect.top || 0, width: rect.width, height: rect.height });
      else callback(fallback);
    }).exec();
  },
  // 触点 → 舞台坐标
  _stagePoint: function (touch) {
    const stage = this._cropStage || { left: 0, top: 0 };
    return { x: (touch.clientX || 0) - (stage.left || 0), y: (touch.clientY || 0) - (stage.top || 0) };
  },
  // 单指：命中把手=改大小，命中框内=移动框，框外不响应（微信同款）。
  cropTouchStart: function (event) {
    const touch = event.touches && event.touches[0];
    if (!touch || !this.data.frame) { this._cropGesture = null; return; }
    const point = this._stagePoint(touch);
    const handle = cropMath.hitHandle(this.data.frame, point.x, point.y, 26);
    if (handle) { this._cropGesture = { mode: 'resize', handle: handle }; return; }
    if (cropMath.insideFrame(this.data.frame, point.x, point.y)) { this._cropGesture = { mode: 'move', lastX: point.x, lastY: point.y }; return; }
    this._cropGesture = null;
  },
  cropTouchMove: function (event) {
    const touch = event.touches && event.touches[0];
    if (!touch || !this._cropGesture || !this.data.frame || !this.data.disp) return;
    const point = this._stagePoint(touch);
    if (this._cropGesture.mode === 'resize') {
      this.setData({ frame: cropMath.resizeFrame(this.data.frame, this._cropGesture.handle, point.x, point.y, this.data.disp) });
    } else if (this._cropGesture.mode === 'move') {
      const dx = point.x - this._cropGesture.lastX;
      const dy = point.y - this._cropGesture.lastY;
      this._cropGesture.lastX = point.x; this._cropGesture.lastY = point.y;
      this.setData({ frame: cropMath.clampFrame({ x: this.data.frame.x + dx, y: this.data.frame.y + dy, size: this.data.frame.size }, this.data.disp) });
    }
  },
  cropTouchEnd: function () { this._cropGesture = null; },
  cancelCrop: function () { this.setData({ cropping: false, cropImage: '', disp: null, frame: null }); },
  confirmCrop: function () {
    const page = this;
    const info = this._cropInfo;
    if (!info || !this.data.disp || !this.data.frame || !this.data.cropImage || typeof wx.createOffscreenCanvas !== 'function') { wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' }); return; }
    const rect = cropMath.computeRectFromFrame(info, this.data.disp, this.data.frame);
    if (!rect || !rect.sw) { wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' }); return; }
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: 512, height: 512 });
    const ctx = canvas.getContext('2d');
    const image = canvas.createImage();
    image.onload = () => {
      try {
        ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sw, 0, 0, 512, 512);
        wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: 512, height: 512, destWidth: 512, destHeight: 512, fileType: 'jpg', success: res => page.saveCroppedAvatar(res.tempFilePath), fail: () => wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' }) });
      } catch (error) { wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' }); }
    };
    image.onerror = () => wx.showToast({ title: i18n.t('avatar_save_fail'), icon: 'none' });
    image.src = this.data.cropImage;
  },
  saveCroppedAvatar: function (tempPath) {
    const page = this;
    const fs = wx.getFileSystemManager();
    try { fs.mkdirSync(wx.env.USER_DATA_PATH + '/avatar', true); } catch (error) {}
    const target = wx.env.USER_DATA_PATH + '/avatar/me-' + Date.now() + '.jpg';
    fs.copyFile({
      srcPath: tempPath, destPath: target,
      success: () => { try { store.saveAvatar(target); page.setData({ cropping: false, cropImage: '', disp: null, frame: null }); page.refresh(); wx.showToast({ title: i18n.t('avatar_saved'), icon: 'success' }); } catch (error) { wx.showToast({ title: error.message || i18n.t('avatar_save_fail'), icon: 'none' }); } },
      fail: () => { try { store.saveAvatar(tempPath); page.setData({ cropping: false, cropImage: '', disp: null, frame: null }); page.refresh(); } catch (error) { wx.showToast({ title: error.message || i18n.t('avatar_save_fail'), icon: 'none' }); } }
    });
  },
  // ---- 昵称 ----
  nicknameChange: function (event) { this.setData({ nicknameInput: event.detail.value }); },
  // 保存昵称：先问后端「新名是否被人占用」→ 占用则弹窗拦截且不改；否则本地保存并触发历史发言改名。
  saveNickname: function () {
    if (this.data.saving) return;
    const page = this;
    const raw = (this.data.nicknameInput || '').trim();
    const oldNickname = store.getIdentity().nickname || '';
    // 空名 / 默认名「旅人」/ 没变化：直接保存，不查重也不触发历史改写（避免默认名互相冲突）。
    if (!raw || raw === '旅人' || raw === oldNickname) { this.commitNickname(raw, ''); return; }
    this.setData({ saving: true });
    community.callApi('GET', '/api/community/nickname-exists?nickname=' + encodeURIComponent(raw))
      .then(function (res) {
        if (res && res.exists) {
          page.setData({ saving: false });
          wx.showModal({ title: '昵称重复', content: '该昵称已被其他果友使用，请换一个', showCancel: false });
          return;
        }
        page.commitNickname(raw, oldNickname);
      })
      .catch(function () {
        // 查重接口异常：保守起见仍允许本地保存，但不触发历史改写（避免误覆盖）。
        page.commitNickname(raw, '');
      });
  },
  // 本地保存昵称；若提供了旧昵称，则异步把历史帖子/评论里的旧名改成新名（失败不打断本地保存）。
  commitNickname: function (raw, oldNickname) {
    const page = this;
    try {
      store.saveIdentity({ nickname: raw });
      if (oldNickname) {
        community.callApi('POST', '/api/community/rename', { oldNickname: oldNickname, newNickname: raw })
          .catch(function () { /* 历史改写失败不打断：本地已保存成功 */ });
      }
      wx.showToast({ title: i18n.t('profile_saved'), icon: 'success' });
    } catch (error) { wx.showToast({ title: error.message || i18n.t('save_fail_retry'), icon: 'none' }); }
    this.setData({ saving: false });
  },
  back: function () { wx.navigateBack({ delta: 1, fail: () => wx.navigateTo({ url: '/pages/mine/mine' }) }); },
  noop: function () {}
});
