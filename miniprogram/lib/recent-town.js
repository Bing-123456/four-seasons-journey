'use strict';
// 本机记住「最近发布 / 保存修改」的果乡名片 id（方案 A：不改服务端、不部署）。
// 服务端 createdAt 只到日期，同日发布的几张排序会「平手」→ 快讯页与行程页「① 去哪」把它提到 index 0。
const store = require('./store');
const KEY = 'guayouji.town.lastPublished.';

// 没发布过 / 读不到 / 存档坏了 → 空串（调用方保持原顺序，不报错、不空白）。
function read() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return '';
    const value = wx.getStorageSync(KEY + store.capturePartition());
    return typeof value === 'string' && value.length <= 80 ? value : '';
  } catch (e) { return ''; }
}

// 只在真正发布 / 保存成功后调用；写失败只影响列表顺序，不抛错。
function remember(id) {
  if (typeof id !== 'string' || !id) return '';
  const value = id.slice(0, 80);
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(KEY + store.capturePartition(), value); } catch (e) { /* 忽略 */ }
  return value;
}

// 命中的那项移到 index 0，其余项相对顺序不变；id 省略时取本机记住的，匹配不到就原样返回。
function promote(list, id) {
  const rows = Array.isArray(list) ? list.slice() : [];
  const want = id === undefined ? read() : id;
  if (!want) return rows;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i].id === want) { rows.unshift(rows.splice(i, 1)[0]); break; }
  }
  return rows;
}

module.exports = { KEY, read, remember, promote };
