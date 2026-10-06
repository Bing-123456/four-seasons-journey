'use strict';
const fs = require('fs');
const path = require('path');

const files = [
  'miniprogram/pages/route/route.wxml',
  'miniprogram/pages/fruit-town/fruit-town.wxml',
  'miniprogram/packageMore/season-journal/season-journal.wxml',
  'miniprogram/pages/seller/index.wxml',
  'miniprogram/pages/seller/publish/publish.wxml'
];

const re = /<view class="(?:page|route-screen)[^"]*\{\{fontClass\}\}"/;

for (const rel of files) {
  const p = path.resolve(rel);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('<demo-notice id="demo-mode-notice"')) {
    console.log(rel + ': already has demo-notice, skip');
    continue;
  }
  const lines = s.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { idx = i; break; }
  }
  if (idx === -1) {
    console.log(rel + ': root view pattern not found, SKIP');
    continue;
  }
  lines.splice(idx + 1, 0, '  <demo-notice id="demo-mode-notice"/>');
  fs.writeFileSync(p, lines.join('\n'));
  console.log(rel + ': inserted demo-notice after line ' + (idx + 1));
}
