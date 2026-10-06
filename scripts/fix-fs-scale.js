'use strict';
const fs = require('fs');
const path = require('path');

const targets = [
  'miniprogram/pages/fruit-town/fruit-town.wxss',
  'miniprogram/pages/route/route.wxss',
  'miniprogram/pages/season-journal/season-journal.wxss',
  'miniprogram/pages/seller/index.wxss',
  'miniprogram/pages/seller/publish/publish.wxss'
];

const re = /font-size:\s*(\d+(?:\.\d+)?rpx)([^;}]+)?/g;

for (const rel of targets) {
  const p = path.resolve(rel);
  let css = fs.readFileSync(p, 'utf8');
  let count = 0;
  css = css.replace(re, (m, num, rest) => {
    if (m.includes('var(--fs-scale')) return m;
    count++;
    return 'font-size: calc(' + num + ' * var(--fs-scale, 1))' + (rest || '');
  });
  fs.writeFileSync(p, css);
  console.log(rel + ': wrapped ' + count + ' font-size declarations');
}
