'use strict';
// 估算微信开发者工具的上传包体积：miniprogramRoot 下全部文件，减去各分包 root 目录。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const subRoots = (app.subPackages || []).map(s => s.root + '/');
const ignored = (cfg.packOptions && cfg.packOptions.ignore || [])
  .filter(r => r.type === 'folder')
  .map(r => r.value.replace(/\\/g, '/'));

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const base = path.join(root, 'miniprogram');
const files = walk(base, []).filter(f => {
  const rel = path.relative(base, f).replace(/\\/g, '/');
  return !subRoots.some(s => rel.startsWith(s)) && !ignored.some(s => rel === s || rel.startsWith(s + '/'));
});

let main = 0;
const rows = files.map(f => {
  const size = fs.statSync(f).size;
  main += size;
  return { size, name: path.relative(base, f).replace(/\\/g, '/') };
}).sort((a, b) => b.size - a.size);

const subs = subRoots.map(s => {
  const dir = path.join(base, s);
  let size = 0;
  if (fs.existsSync(dir)) walk(dir, []).forEach(f => { size += fs.statSync(f).size; });
  return s + ' = ' + (size / 1024).toFixed(0) + 'KB';
});

console.log('主包（会被上传的那一坨）: ' + (main / 1024).toFixed(0) + 'KB / 硬线 2048KB');
console.log('  余量: ' + ((2048 - main / 1024)).toFixed(0) + 'KB');
console.log('分包: ' + subs.join(' | '));
console.log('主包最大 12 个文件:');
rows.slice(0, 12).forEach(r => console.log('  ' + (r.size / 1024).toFixed(1) + 'KB  ' + r.name));