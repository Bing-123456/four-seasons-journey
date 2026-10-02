'use strict';

// 右上角「我的」入口：个人照片优先，默认头像与 AI 伙伴分开。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

Component({
  data: { avatarPath: '', aria: '' },
  lifetimes: { attached() { this.refresh(); } },
  pageLifetimes: { show() { this.refresh(); } },
  methods: {
    refresh() {
      this.setData({ avatarPath: store.getAvatar(), aria: i18n.t('comp_me_aria') });
    },
    go() { wx.navigateTo({ url: '/pages/mine/mine' }); }
  }
});
