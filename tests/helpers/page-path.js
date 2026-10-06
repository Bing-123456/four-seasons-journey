'use strict';
// 测试辅助：页面路径解析。
//
// 2026-10-06 起 13 个非 tab 页面从 `miniprogram/pages/` 迁到 `miniprogram/packageMore/`
// （为把主包压到微信 2048KB 硬线以内）。测试里大量按路径拼页面文件，统一走本模块查找，
// 页面以后再挪位置也不必改测试。
//
// 支持的调用形式：
//   pageFile('search')                      → packageMore/search/search.js
//   pageFile('index/index')                 → pages/index/index.js（relative 形如 'dir/base'）
//   pageFile('workshop', 'index')           → packageMore/workshop/index.js
//   pageFile('pages/search/search')         → 主包 pages 优先，找不到再扫分包
//   pageFile('packageMore/search/search')   → 指定分包根
//   pagePath('packageFruit', '.wxml', 'pages/fruit-detail/fruit-detail')
const fs = require('fs');
const path = require('path');

const MP = path.resolve(__dirname, '../../miniprogram');
const PKG_DIRS = ['packageMore', 'packageFruit', 'packageTrip', 'packageWorld'];

// 把各种输入拆成候选的绝对路径，按优先级排列。
function candidates(name, base, ext) {
  const list = [];
  const push = abs => { if (list.indexOf(abs) < 0) list.push(abs); };
  const suffix = ext || '';

  // 情况 A：name 本身就是分包根（packageX），base 是包内相对路径
  if (PKG_DIRS.indexOf(name) >= 0) {
    push(path.join(MP, name, base + suffix));
    return list;
  }

  let n = String(name);
  // 情况 B：显式带分包根前缀，如 'packageMore/search/search'
  const withPkg = PKG_DIRS.find(p => n.indexOf(p + '/') === 0);
  if (withPkg) {
    push(path.join(MP, n + suffix));
  }
  n = n.replace(/^(pages|packageMore|packageFruit|packageTrip|packageWorld)\//, '');
  // name 恰好就是某个根名（如 'pages'）且未带尾斜杠时，上面正则不匹配，这里补一次
  if (n === 'pages' || PKG_DIRS.indexOf(n) >= 0) n = '';
  if (n === '') {
    push(path.join(MP, 'pages', base + suffix));
    PKG_DIRS.forEach(p => push(path.join(MP, p, base + suffix)));
    return list;
  }

  if (base) {
    // 情况 C：dir + 显式 base
    push(path.join(MP, 'pages', n, base + suffix));
    PKG_DIRS.forEach(p => push(path.join(MP, p, n, base + suffix)));
    return list;
  }

  // 情况 D：'dir/base' 或 'dir'
  const parts = n.split('/');
  if (parts.length >= 2) {
    const dir = parts[0];
    const file = parts.slice(1).join('/');
    push(path.join(MP, 'pages', dir, file + suffix));
    PKG_DIRS.forEach(p => push(path.join(MP, p, dir, file + suffix)));
  } else {
    push(path.join(MP, 'pages', n, n + suffix));
    PKG_DIRS.forEach(p => push(path.join(MP, p, n, n + suffix)));
  }
  return list;
}

function find(name, base, ext) {
  const list = candidates(name, base, ext);
  for (const p of list) if (fs.existsSync(p)) return p;
  // 全部落空时返回主包的首选路径（保持与旧行为一致的报错信息）
  return list[0];
}

const pageFile = (name, base) => find(name, base, '.js');
const pagePath = (name, ext, base) => find(name, base, ext || '.wxml');

module.exports = { MP, PKG_DIRS, pageFile, pagePath };