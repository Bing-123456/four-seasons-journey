'use strict';
// 活动方案草稿的本机暂存：上一页点「生成方案」成功后写进来，结果页（pages/seller/plan）onLoad 读出来渲染。
// 键名与 lib/batch-local.js 同一套（带演示 / 个人分区后缀，两种身份各存各的）。
// 除了方案本身，还一并存下这份方案是照哪份「果乡资料」生成的（form / editing / townId）：
// 结果页那颗「保存并发布」要把名片真的发出去，得拿回合并页填的那份表单过同一条发布链路
// （pages/seller/publish/publish-flow.js），不另写一套校验与请求。
// 只存这一次生成出来的东西，不落库；读不到（清缓存 / 换语言重进）就当没存过，
// 结果页显示「方案已过期」，不白屏。
const store = require('./store');
const KEY = 'guayouji.town.planDraft.';

function blank() { return null; }

function read() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return blank();
    const value = wx.getStorageSync(KEY + store.capturePartition());
    // 形状不对（存档被改坏 / 别的东西占了这个键）→ 当没存过，页面走「已过期」分支。
    // 判定只看方案本身（title / steps）：老存档没有 form 那几个字段，照样读得出来。
    if (!value || typeof value !== 'object' || Array.isArray(value)) return blank();
    if (typeof value.title !== 'string' || !Array.isArray(value.steps) || !value.steps.length) return blank();
    return value;
  } catch (error) { return blank(); }
}

// 写失败只影响这一次展示（结果页会显示过期提示），不抛错、也不挡跳转。
function remember(draft) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return;
    wx.setStorageSync(KEY + store.capturePartition(), JSON.parse(JSON.stringify(draft)));
  } catch (error) { /* 忽略 */ }
}

// 结果页发布要用的那份表单：{ form, editing, townId }。
// 老存档 / 存档被改坏 / 表单形状不对 → null，结果页据此给一句可读提示，不崩也不发请求。
function readForm(draft) {
  try {
    const value = draft === undefined ? read() : draft;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const form = value.form;
    if (!form || typeof form !== 'object' || Array.isArray(form)) return null;
    return {
      form: JSON.parse(JSON.stringify(form)),
      editing: value.editing === true,
      townId: typeof value.townId === 'string' ? value.townId : ''
    };
  } catch (error) { return null; }
}

module.exports = { KEY, read, remember, readForm };
