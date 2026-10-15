'use strict';

// 果名 → 英文名（2026-10-11 用户要求：English 模式下两个游戏要全英文）。
// 数据来源：fruit-culture 的 name→id + i18n 的 fruit_<id> 英文名（42 果齐全，已核对）。
// 游戏里另有两个「短名」不在果库的 name 里，按下面这张对照补上 —— 只是给已有水果取英文名，
// 不新增任何内容。
const culture = require('../data/fruit-culture');
const i18n = require('./i18n');

// 游戏（转盘 / 连连看）用的短名 → 正式果名 / 直接给英文名
const OVERRIDE = { '桃': 'Peach', '柑橘': 'Citrus' };

let index = null;
function buildIndex() {
  const map = {};
  (culture.seasons || []).forEach(season => {
    (culture.seasonFruits(season) || []).forEach(fruit => {
      if (map[fruit.name]) return;
      const entry = i18n.dict['fruit_' + fruit.id];
      if (entry && entry[1]) map[fruit.name] = entry[1];
    });
  });
  Object.keys(OVERRIDE).forEach(name => { map[name] = OVERRIDE[name]; });
  return map;
}

// 中文模式下原样返回中文名；英文模式返回英文名；查不到的果名原样返回（不空白、不乱编）
function nameEn(name) {
  const key = String(name == null ? '' : name);
  if (!key) return '';
  if (i18n.getLang() !== 'en') return key;
  if (!index) index = buildIndex();
  return index[key] || key;
}

module.exports = { nameEn };
