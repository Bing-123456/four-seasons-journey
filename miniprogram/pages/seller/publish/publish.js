'use strict';
// 发布果乡名片表单（P13 果农工作台 / 果乡发布站）。设计文档 3.3。
// 3 步表单：基本信息（地区用 picker mode=region 三级联动）→ 体验与介绍 → AI 润色与确认。
// 编辑模式（?id=xxx）：回填已有数据，「确认发布」变为「保存修改」。
const farmtown = require('../../../lib/farmtown-service');
const i18n = require('../../../lib/i18n');

const EXPERIENCES = ['采摘', '观光', '手作', '餐饮', '文化讲解'];
function fontClass() {
  if (typeof getApp === 'function' && getApp() && typeof getApp().getFontClass === 'function') return getApp().getFontClass();
  return 'fs-normal';
}
function emptyForm() {
  return { name: '', province: '', city: '', county: '', fruit: '', experiences: [], description: '', transport: '', contact: '', location: null, locationName: '' };
}
// 体验标签选中态映射：wxml 不支持 indexOf，这里预计算好每个标签是否选中。
function expSelectedMap(experiences) {
  const map = {};
  (experiences || []).forEach(function (exp) { map[exp] = true; });
  return map;
}

Page({
  data: {
    fontClass: 'fs-normal',
    step: 1,
    editing: false,
    townId: '',
    form: emptyForm(),
    polishedText: '',
    polishing: false,
    submitting: false,
    error: '',
    experiences: EXPERIENCES,
    expSelected: {},
    L: {}
  },
  onLoad: function (options) {
    this.setData({ fontClass: fontClass(), L: i18n.labels(['pub_name', 'pub_region', 'pub_location', 'pub_fruit', 'pub_desc', 'pub_transport', 'pub_your_desc', 'pub_polished', 'pub_repolish', 'pub_next', 'pub_experience', 'pub_contact']) });
    const id = options && options.id;
    if (id) {
      this.setData({ editing: true, townId: id });
      this.loadTown(id);
    }
  },
  loadTown: function (id) {
    const self = this;
    farmtown.getTown(id).then(function (town) {
      if (!town) { self.setData({ error: '果乡不存在或已下架' }); return; }
      const hasLoc = farmtown.validTownLocation(town.location);
      self.setData({
        form: {
          name: town.name, province: town.province, city: town.city, county: town.county,
          fruit: town.fruit, experiences: town.experiences || [],
          description: town.description || town.polishedDescription || '',
          transport: town.transport || '', contact: town.contact || '',
          location: hasLoc ? { latitude: town.location.latitude, longitude: town.location.longitude } : null,
          locationName: hasLoc ? ((town.province || '') + (town.city || '') + (town.county || '')) : ''
        },
        polishedText: town.polishedDescription || '',
        expSelected: expSelectedMap(town.experiences || [])
      });
    }).catch(function () { self.setData({ error: '加载失败，请重试' }); });
  },
  // ---- 第 1 步：基本信息 ----
  inputName: function (e) { this.setData({ 'form.name': e.detail.value }); },
  inputFruit: function (e) { this.setData({ 'form.fruit': e.detail.value }); },
  onRegionChange: function (e) {
    const v = e.detail.value || [];
    this.setData({ 'form.province': v[0] || '', 'form.city': v[1] || '', 'form.county': v[2] || '' });
  },
  next1: function () {
    const f = this.data.form;
    if (!f.name.trim()) { wx.showToast({ title: '请填写果乡名称', icon: 'none' }); return; }
    if (!f.province || !f.city || !f.county) { wx.showToast({ title: '请选择所在地区', icon: 'none' }); return; }
    if (!f.fruit.trim()) { wx.showToast({ title: '请填写当季水果', icon: 'none' }); return; }
    if (!farmtown.validTownLocation(f.location)) { wx.showToast({ title: '请选择地图位置', icon: 'none' }); return; }
    this.setData({ step: 2 });
  },
  chooseLocation: function () {
    const self = this;
    wx.chooseLocation({
      success: function (res) {
        if (!Number.isFinite(res.latitude) || !Number.isFinite(res.longitude)) { wx.showToast({ title: '位置无效，请重选', icon: 'none' }); return; }
        self.setData({
          'form.location': { latitude: res.latitude, longitude: res.longitude },
          'form.locationName': res.name || res.address || '已选择位置'
        });
      },
      fail: function () {}
    });
  },
  // ---- 第 2 步：体验与介绍 ----
  toggleExp: function (e) {
    const exp = e.currentTarget.dataset.exp;
    const list = this.data.form.experiences.slice();
    const expSelected = Object.assign({}, this.data.expSelected);
    const i = list.indexOf(exp);
    if (i !== -1) { list.splice(i, 1); expSelected[exp] = false; }
    else {
      if (list.length >= 3) { wx.showToast({ title: '最多选 3 个', icon: 'none' }); return; }
      list.push(exp); expSelected[exp] = true;
    }
    this.setData({ 'form.experiences': list, expSelected: expSelected });
  },
  inputDesc: function (e) { this.setData({ 'form.description': e.detail.value }); },
  inputTransport: function (e) { this.setData({ 'form.transport': e.detail.value }); },
  inputContact: function (e) { this.setData({ 'form.contact': e.detail.value }); },
  next2: function () { this.setData({ step: 3 }); },
  back: function (e) { this.setData({ step: Number(e.currentTarget.dataset.step) }); },
  goBack: function () { wx.navigateBack({ delta: 1 }); },
  // ---- 第 3 步：AI 润色与确认 ----
  polish: function () {
    const self = this;
    if (this.data.polishing) return;
    const f = this.data.form;
    if (!f.description.trim()) { wx.showToast({ title: '请先填写果乡介绍', icon: 'none' }); return; }
    this.setData({ polishing: true });
    farmtown.polishDescription(f.description, f.fruit).then(function (text) {
      self.setData({ polishedText: text, polishing: false });
    }).catch(function () {
      self.setData({ polishing: false });
      wx.showToast({ title: '润色失败，请重试', icon: 'none' });
    });
  },
  submit: function () {
    const self = this;
    if (this.data.submitting) return;
    const f = this.data.form;
    if (!farmtown.validTownLocation(f.location)) { wx.showToast({ title: '请选择地图位置', icon: 'none' }); return; }
    const polished = (this.data.polishedText || '').trim();
    const payload = {
      name: f.name, province: f.province, city: f.city, county: f.county,
      fruit: f.fruit, experiences: f.experiences,
      description: polished || f.description,
      transport: f.transport, contact: f.contact,
      location: f.location,
      polishedDescription: polished
    };
    if (this.data.editing) payload.id = this.data.townId;
    this.setData({ submitting: true });
    const op = this.data.editing ? farmtown.updateTown(payload) : farmtown.createTown(payload);
    op.then(function () {
      wx.showToast({ title: self.data.editing ? '保存成功' : '发布成功', icon: 'none' });
      setTimeout(function () { wx.navigateBack({ delta: 1 }); }, 600);
    }).catch(function () {
      self.setData({ submitting: false });
      wx.showToast({ title: self.data.editing ? '保存失败' : '发布失败', icon: 'none' });
    });
  }
});
