'use strict';

// 我的资料：设置头像（相册照片）与修改昵称，独立子页面；与打招呼小水果（伙伴）无关。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

Page({
  data: { avatarPath: '', nicknameInput: '', saving: false, L: {} },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 i18n.applyNav('nav_account'); this.refresh(); },
  refresh: function () {
    const identity = store.getIdentity();
    this.setData({
      avatarPath: store.getAvatar(),
      nicknameInput: identity.nickname,
      L: i18n.labels(['nav_account','avatar_fallback','avatar_edit','avatar_set_hint','account_nickname_label','nickname_ph','save','account_nickname_hint','account_back','profile_saved','acc_avatar_aria','acc_nick_aria'])
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
            try {
              const fs = wx.getFileSystemManager();
              try { fs.mkdirSync(wx.env.USER_DATA_PATH + '/avatar', true); } catch (error) {}
              const target = wx.env.USER_DATA_PATH + '/avatar/me-' + Date.now() + '.jpg';
              fs.copyFile({ srcPath: file.tempFilePath, destPath: target, success: () => { try { store.saveAvatar(target); page.refresh(); wx.showToast({ title: i18n.t('avatar_saved'), icon: 'success' }); } catch (error) { wx.showToast({ title: error.message || i18n.t('avatar_save_fail'), icon: 'none' }); } }, fail: () => { try { store.saveAvatar(file.tempFilePath); page.refresh(); } catch (error) { wx.showToast({ title: error.message || i18n.t('avatar_save_fail'), icon: 'none' }); } } });
            } catch (error) { wx.showToast({ title: error.message || i18n.t('avatar_save_fail'), icon: 'none' }); }
          },
          fail: () => {}
        });
      }
    });
  },
  // ---- 昵称 ----
  nicknameChange: function (event) { this.setData({ nicknameInput: event.detail.value }); },
  saveNickname: function () {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      store.saveIdentity({ nickname: this.data.nicknameInput });
      wx.showToast({ title: i18n.t('profile_saved'), icon: 'success' });
    } catch (error) { wx.showToast({ title: error.message || i18n.t('save_fail_retry'), icon: 'none' }); }
    this.setData({ saving: false });
  },
  back: function () { wx.navigateBack({ delta: 1, fail: () => wx.navigateTo({ url: '/pages/mine/mine' }) }); },
  noop: function () {}
});
