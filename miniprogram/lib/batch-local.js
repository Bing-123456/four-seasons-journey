'use strict';
// 本机记住「这一批果子」的两项（大概还剩多少 / 一次能接待多少人）。
// 服务端果乡名片接口不收这两项（server/farmtown.js 不认），所以只存本机。
// 键名与 lib/recent-town.js 同一套：带演示 / 个人分区后缀，两种身份各存各的。
const store = require('./store');
const KEY = 'guayouji.town.batch.';
const MAX = 40;

function text(value) { return typeof value === 'string' ? value.slice(0, MAX) : ''; }
function blank() { return { left: '', people: '' }; }

// 没填过 / 读不到 / 存档坏了 → 两项都空（页面照常显示，不报错、不预填假数字）。
function read() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return blank();
    const value = wx.getStorageSync(KEY + store.capturePartition());
    if (!value || typeof value !== 'object') return blank();
    return { left: text(value.left), people: text(value.people) };
  } catch (e) { return blank(); }
}

// 写失败只影响这次本机留存，不抛错、不挡住名片保存。
function remember(left, people) {
  const value = { left: text(left), people: text(people) };
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(KEY + store.capturePartition(), value); } catch (e) { /* 忽略 */ }
  return value;
}

module.exports = { KEY, read, remember };
