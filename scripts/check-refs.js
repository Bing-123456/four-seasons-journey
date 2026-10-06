'use strict';
// 校验 app.json / 各页面 json / 组件 json 里声明的每个文件是否真实存在。
// devtools 遇到悬空引用时只会抛 ENOENT，不告诉你是哪一行，所以这里主动扫一遍。
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..', 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(base, 'app.json'), 'utf8'));

const problems = [];
const seen = new Set();

// app.json 顶层引用
if (app.sitemapLocation && !fs.existsSync(path.join(base, app.sitemapLocation))) {
  problems.push('app.json sitemapLocation 指向不存在的文件: ' + app.sitemapLocation);
}
const declaredPlugins = Object.keys(app.plugins || {});
const usedPlugins = new Set();

function checkComponentMap(map, where) {
  for (const [tag, ref] of Object.entries(map || {})) {
    if (!ref || typeof ref !== 'string') continue;
    if (/^plugin:\/\//.test(ref)) { usedPlugins.add(ref); continue; }
    const target = ref.startsWith('/') ? path.join(base, ref) : path.resolve(path.dirname(where), ref);
    if (seen.has(target)) continue;
    seen.add(target);
    // usingComponents 省略了扩展名：xxx 实际是 xxx.wxml / xxx.json / xxx.js
    const cands = ['', '.wxml', '.json', '.js', '/index.wxml', '/index.json', '/index.js'];
    if (!cands.some(ext => fs.existsSync(target + ext))) {
      problems.push(where + ' 里的 <' + tag + '> 指向不存在的文件: ' + path.relative(base, target));
    }
  }
}

checkComponentMap(app.usingComponents, 'app.json');

// 收集所有页面目录
const pageDirs = app.pages.map(p => path.join(base, p));
for (const sp of app.subPackages || []) for (const p of sp.pages) pageDirs.push(path.join(base, sp.root, p));

for (const dir of pageDirs) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(dir + '.' + ext)) problems.push('页面四件套缺文件: ' + path.relative(base, dir) + '.' + ext);
  }
  const jsonPath = dir + '.json';
  if (!fs.existsSync(jsonPath)) continue;
  let json;
  try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { problems.push('JSON 解析失败 ' + path.relative(base, jsonPath) + ': ' + e.message); continue; }
  checkComponentMap(json.usingComponents, path.relative(base, jsonPath));
}

// 递归所有自定义组件的 usingComponents
function walkComponents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (!fs.statSync(sub).isDirectory()) continue;
    const jsonPath = path.join(sub, name + '.json');
    if (fs.existsSync(jsonPath)) {
      let json;
      try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { problems.push('组件 JSON 解析失败 ' + path.relative(base, jsonPath)); json = null; }
      if (json) checkComponentMap(json.usingComponents, path.relative(base, jsonPath));
    }
    walkComponents(sub);
  }
}
walkComponents(path.join(base, 'components'));
walkComponents(path.join(base, 'custom-tab-bar'));

// 未声明却用到的插件
for (const p of usedPlugins) {
  if (!declaredPlugins.some(d => p.indexOf(d) >= 0)) problems.push('代码用了未在 app.json 声明的插件: ' + p);
}

if (problems.length) {
  console.log('发现 ' + problems.length + ' 个悬空引用：');
  problems.forEach(p => console.log('  ✗ ' + p));
  process.exitCode = 1;
} else {
  console.log('✓ 页面 ' + pageDirs.length + ' 个、组件引用全部存在，无悬空路径');
}