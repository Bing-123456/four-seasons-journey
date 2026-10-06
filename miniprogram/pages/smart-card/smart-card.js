'use strict';

// 知识卡：把农事转盘答对后的知识点画成图片，保存到手机相册。
const i18n = require('../../lib/i18n');

Page({
  data: { fruit: '', term: '', points: [], elf: '', posterPath: '', ready: false },
  onLoad: function (options) {
    this.setData({
      fruit: options.fruit ? decodeURIComponent(options.fruit) : '',
      term: options.term ? decodeURIComponent(options.term) : '',
      points: options.points ? decodeURIComponent(options.points).split('|').filter(Boolean) : [],
      elf: options.elf ? decodeURIComponent(options.elf) : ''
    });
    this.draw();
  },
  draw: function () {
    const self = this;
    const query = wx.createSelectorQuery();
    query.select('#cardCanvas').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
      const W = 600, H = 800;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#FFFDF8';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8C8066';
      ctx.font = '22px sans-serif';
      ctx.fillText('果物四时记 · 农事转盘 · 知识卡', W / 2, 56);
      ctx.fillStyle = '#234B3C';
      ctx.font = 'bold 56px sans-serif';
      ctx.fillText(self.data.fruit, W / 2, 132);
      ctx.fillStyle = '#8C8066';
      ctx.font = '26px sans-serif';
      ctx.fillText(self.data.term, W / 2, 176);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4A554C';
      ctx.font = '28px sans-serif';
      let y = 250;
      self.data.points.slice(0, 5).forEach(function (p) {
        const lines = String(p).match(/.{1,16}/g) || [String(p)];
        lines.forEach(function (line) { ctx.fillText('· ' + line, 64, y); y += 44; });
        y += 10;
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3C6B4F';
      ctx.font = '26px sans-serif';
      ctx.fillText('果灵寄语：' + self.data.elf, W / 2, H - 80);
      wx.canvasToTempFilePath({
        canvas: canvas,
        success: function (r) { self.setData({ posterPath: r.tempFilePath, ready: true }); }
      });
    });
  },
  save: function () {
    const self = this;
    const path = this.data.posterPath;
    if (!path) return;
    const doSave = function () {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: function () { wx.showToast({ title: i18n.t('saved_album_toast'), icon: 'success' }); },
        fail: function (err) {
          if (err && /auth/i.test(err.errMsg || '')) {
            wx.showModal({ title: i18n.t('album_perm_title'), content: i18n.t('album_perm_body'), confirmText: i18n.t('go_settings'), success: function (r) { if (r.confirm) wx.openSetting({}); } });
          } else wx.showToast({ title: i18n.t('save_fail_retry'), icon: 'none' });
        }
      });
    };
    wx.getSetting({
      success: function (res) {
        if (res.authSetting && res.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({ title: i18n.t('album_perm_title'), content: i18n.t('album_perm_body'), confirmText: i18n.t('go_settings'), success: function (r) { if (r.confirm) wx.openSetting({}); } });
        } else doSave();
      },
      fail: doSave
    });
  },
  back: function () { wx.navigateBack({ delta: 1 }); },
  noop: function () {}
});
