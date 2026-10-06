'use strict';
// 校验所有 .wxml 的标签是否正确闭合。
// 开发者工具只会说「编译 .wxml 文件错误」而不指出行号，必须自己扫一遍。
// 规则够用即可：跳过注释<!-- -->、<wxs> 内部、属性值里的尖括号。
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..', 'miniprogram');
const problems = [];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.wxml')) out.push(p);
  }
  return out;
}

// 自闭合标签（HTML/SGML 允许无斜杠闭合）
const VOID = new Set(['image', 'input', 'br', 'hr', 'icon', 'import', 'include', 'wxs', 'slot']);

function check(file) {
  let src = fs.readFileSync(file, 'utf8');
  // 去掉注释
  src = src.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  // 把属性值里的 > 换掉，避免 <view a="a>b"> 被误切
  src = src.replace(/="[^"]*"/g, m => '"' + 'x'.repeat(Math.max(0, m.length - 2)) + '"');

  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosed = m[4] === '/';
    if (tag === 'wxs') { selfCloseWxs(src, re.lastIndex); continue; }
    if (VOID.has(tag) || selfClosed) {
      if (closing) problems.push(path.relative(base, file) + '第 ' + lineOf(src, m.index) + ' 行：</' + tag + '> 是自闭合/void 标签，不该有结束标签');
      continue;
    }
    if (closing) {
      const top = stack.pop();
      if (!top) problems.push(path.relative(base, file) + '第 ' + lineOf(src, m.index) + ' 行：多出来的 </' + tag + '>');
      else if (top.tag !== tag) problems.push(path.relative(base, file) + '第 ' + lineOf(src, m.index) + ' 行：</' + tag + '> 与未闭合的 <' + top.tag + '>（第 ' + top.line + ' 行）不匹配');
    } else {
      stack.push({ tag, line: lineOf(src, m.index) });
    }
  }
  stack.forEach(s => problems.push(path.relative(base, file) + '：<' + s.tag + '>（第 ' + s.line + ' 行）到文件结束都没闭合'));
}

// wxs 块内部是 JS，里面的 < > 会干扰，跳过整块
function selfCloseWxs(src, from) {
  const end = src.indexOf('</wxs>', from);
  if (end < 0) return;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

const files = walk(base, []);
files.forEach(check);

if (problems.length) {
  console.log('发现 ' + problems.length + ' 个标签问题：');
  problems.forEach(p => console.log('  ✗ ' + p));
  process.exitCode = 1;
} else {
  console.log('✓ ' + files.length + ' 个 .wxml 标签全部正确闭合');
}