'use strict';

// 农谚 → 水果映射表（决策 15）：农谚问时「其它水果随机题」的数据来源。
// 只标注「该农谚是否主讲 6 种定制水果」，用于把主讲定制果的农谚排除出随机池，
// 保证随机题始终来自「其它水果」。不修改 farm-proverbs.js 正文。
const farmProverbs = require('./farm-proverbs');

// 6 种定制水果（答对首次解锁），随机池排除主讲这些水果的农谚。
const CUSTOM_FRUIT_IDS = ['watermelon', 'strawberry', 'apple', 'pear', 'grape', 'kiwi'];

// 主讲 6 定制果之一的农谚 id（据 farm-proverbs.js 文本手工判定）：
// 102 桃三杏四梨五年 → 梨；104 七月核桃八月梨 → 梨；108 谷雨草莓红 → 草莓；
// 113 白露葡萄串 → 葡萄；118 霜降苹果甜 → 苹果；120 秋分猕猴桃 → 猕猴桃；
// 133 吐鲁番的葡萄哈密的瓜 → 葡萄；140 立秋啃西瓜 → 西瓜。
const CUSTOM_PROVERB_IDS = new Set([102, 104, 108, 113, 118, 120, 133, 140]);

const proverbById = {};
for (const p of farmProverbs.proverbs) proverbById[p.id] = p;

// 随机池：所有农谚，去掉主讲定制果的，保证随机题来自「其它水果」。
const RANDOM_PROVERB_IDS = farmProverbs.proverbs
  .map(function (p) { return p.id; })
  .filter(function (id) { return !CUSTOM_PROVERB_IDS.has(id); });

module.exports = { CUSTOM_FRUIT_IDS, CUSTOM_PROVERB_IDS, RANDOM_PROVERB_IDS, proverbById };
