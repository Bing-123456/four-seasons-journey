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
  return { name: '', province: '', city: '', county: '', fruit: '', activityDate: '', address: '', openDate: '', openTime: '', closeDate: '', closeTime: '', experiences: [], description: '', wechat: '', phone: '', location: null, locationName: '' };
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
    errors: {},
    editing: false,
    townId: '',
    form: emptyForm(),
    polishedText: '',
  polishSource: '',
    polishing: false,
    submitting: false,
    error: '',
    experiences: EXPERIENCES,
    expSelected: {},
    L: {}
  },
  onLoad: function (options) {
    this.setData({ fontClass: fontClass(), L: i18n.labels(['pub_name', 'pub_region', 'pub_location', 'pub_fruit', 'pub_activity_date', 'pub_desc', 'pub_transport', 'pub_your_desc', 'pub_polished', 'pub_repolish', 'pub_next', 'pub_experience', 'pub_contact', 'pub_wechat', 'pub_phone', 'pub_address', 'pub_address_ph', 'pub_date_window', 'pub_open_date', 'pub_open_time', 'pub_close_date', 'pub_close_time']) });
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
          fruit: town.fruit, activityDate: town.activityDate || '', address: town.address || '', openDate: town.openDate || '', openTime: town.openTime || '', closeDate: town.closeDate || '', closeTime: town.closeTime || '', experiences: town.experiences || [],
          description: town.description || town.polishedDescription || '',
          wechat: town.wechat || '', phone: town.phone || '',
          location: hasLoc ? { latitude: town.location.latitude, longitude: town.location.longitude } : null,
          locationName: hasLoc ? ((town.province || '') + (town.city || '') + (town.county || '')) : ''
        },
        polishedText: town.polishedDescription || '',
        expSelected: expSelectedMap(town.experiences || [])
      });
    }).catch(function () { self.setData({ error: '加载失败，请重试' }); });
  },
  // ---- 第 1 步：基本信息 ----
  inputName: function (e) { this.setData({ 'form.name': e.detail.value, 'errors.name': '' }); },
  inputFruit: function (e) { this.setData({ 'form.fruit': e.detail.value, 'errors.fruit': '' }); },
  onRegionChange: function (e) {
    const v = e.detail.value || [];
    this.setData({ 'form.province': v[0] || '', 'form.city': v[1] || '', 'form.county': v[2] || '' });
  },
  // 可去的日期（选填）；没填就是空串，快讯名片上整行不显示。
  onDateChange: function (e) { this.setData({ 'form.activityDate': (e.detail && e.detail.value) || '' }); },
  inputAddress: function (e) { this.setData({ 'form.address': e.detail.value, 'errors.address': '' }); },
  onOpenDate: function (e) { this.setData({ 'form.openDate': (e.detail && e.detail.value) || '', 'errors.openDate': '' }); },
  onOpenTime: function (e) { this.setData({ 'form.openTime': (e.detail && e.detail.value) || '', 'errors.openTime': '' }); },
  onCloseDate: function (e) { this.setData({ 'form.closeDate': (e.detail && e.detail.value) || '', 'errors.closeDate': '' }); },
  onCloseTime: function (e) { this.setData({ 'form.closeTime': (e.detail && e.detail.value) || '', 'errors.closeTime': '' }); },
  next1: function () {
    const f = this.data.form;
    // 字段级校验：错在哪就标在哪，并滚到那个字段（不再只弹一句一闪而过的提示）
    const errors = {};
    if (!f.name || !String(f.name).trim()) errors.name = '请填写果乡名称';
    if (!f.province || !f.city || !f.county) errors.region = '请选择所在地区';
    if (!f.fruit || !String(f.fruit).trim()) errors.fruit = '请填写当季水果';
if (!f.address || !String(f.address).trim()) errors.address = '请填写具体位置';
    if (!f.openDate) errors.openDate = '请选择开门日期';
    if (!f.openTime) errors.openTime = '请选择开门时间';
    if (!f.closeDate) errors.closeDate = '请选择关门日期';
    if (!f.closeTime) errors.closeTime = '请选择关门时间';
const order = ['name', 'region', 'address', 'fruit', 'openDate', 'openTime', 'closeDate', 'closeTime'];
    const first = order.filter(function (key) { return errors[key]; })[0];
    if (first) {
      this.setData({ errors: errors });
      wx.showToast({ title: errors[first], icon: 'none' });
      if (wx.pageScrollTo) wx.pageScrollTo({ selector: '#field-' + first, duration: 200 });
      return;
    }
    this.setData({ errors: {}, step: 2 });
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
      if (list.length >= 5) { wx.showToast({ title: '最多选 5 个', icon: 'none' }); return; }
      list.push(exp); expSelected[exp] = true;
    }
    this.setData({ 'form.experiences': list, expSelected: expSelected });
  },
  inputDesc: function (e) { this.setData({ 'form.description': e.detail.value }); },
  inputWechat: function (e) { this.setData({ 'form.wechat': e.detail.value }); },
  inputPhone: function (e) { this.setData({ 'form.phone': e.detail.value }); },
  next2: function () { this.setData({ step: 3 }); },
  back: function (e) { this.setData({ step: Number(e.currentTarget.dataset.step) }); },
  goBack: function () { wx.navigateBack({ delta: 1 }); },
  // ---- 第 3 步：AI 润色与确认 ----
  polish: function () {
    const self = this;
    if (this.data.polishing) return;
    const f = this.data.form;
    if (!f.description || !f.description.trim()) { wx.showToast({ title: '请先填写果乡介绍', icon: 'none' }); return; }
    // 点下就有反馈（不再"点了没反应"）
    this.setData({ polishing: true, polishNote: i18n.t('pub_polishing') });
    farmtown.polishDescription(f.description, f.fruit).then(function (result) {
      const text = (result && result.text) || (typeof result === 'string' ? result : f.description);
      const source = (result && result.source) || 'local';
      // 如实标注来源：本地整理绝不冒充 AI
      const note = source === 'server' ? '' : i18n.t(source === 'local-short' ? 'pub_polish_short' : 'pub_polish_local');
      self.setData({ polishedText: text, polishSource: source, polishNote: note, polishing: false });
    }).catch(function () {
      // 最后兜底：本地整理，绝不把用户卡在"润色失败"
      const fb = farmtown.localPolish ? farmtown.localPolish(f.description) : { text: f.description, source: 'local' };
      self.setData({
        polishedText: fb.text, polishSource: fb.source, polishing: false,
        polishNote: i18n.t(fb.source === 'local-short' ? 'pub_polish_short' : 'pub_polish_local')
      });
    });
  },
  submit: function () {
    const self = this;
    if (this.data.submitting) return;
    const f = this.data.form;
if (!f.address || !String(f.address).trim()) { wx.showToast({ title: '请填写具体位置', icon: 'none' }); return; }
    const polished = (this.data.polishedText || '').trim();
    const payload = {
      name: f.name, province: f.province, city: f.city, county: f.county,
      fruit: f.fruit, activityDate: f.activityDate || '', experiences: f.experiences,
      address: f.address, openDate: f.openDate, openTime: f.openTime, closeDate: f.closeDate, closeTime: f.closeTime,
      description: polished || f.description,
      wechat: f.wechat, phone: f.phone,
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
