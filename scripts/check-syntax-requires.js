'use strict';
/**
 * check-syntax-requires.js
 *
 * 一次跑完项目里所有 .js 的「静态体检」，专补 check-refs.js / check-wxml.js 的两个盲区：
 *   ① 语法错（写入时插进来的乱码行、缺括号等）—— 小程序里会让整页空白
 *   ② 相对 require() 路径能否真实解析 —— 路径写错同样让整页空白，语法检查发现不了
 *   ③ BOM 头（项目约定：零 BOM）
 *
 * 判定说明：
 *   · 注释内容会被屏蔽，字符串原样保留（否则 require('…') 的参数会被吃掉，永远匹配不到）
 *   · 「真实问题」= 相对路径解析不到，且仓库根目录下也不存在对应路径
 *   · 「需人工确认」= 解析不到、但仓库根目录存在 → 该类 require 依赖运行 / 部署时的目录布局
 *
 * 用法：node scripts/check-syntax-requires.js [--root=<目录>]
 * 退出码：0 = 无真实问题；1 = 存在真实问题
 * 本脚本只读文件，不修改任何内容。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_ARG = (process.argv.find(a => a.startsWith('--root=')) || '').split('=')[1];
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG) : path.resolve(__dirname, '..');
const SCAN_DIRS = ROOT_ARG ? ['.'] : ['miniprogram', 'server', 'scripts', 'tests'];
const SKIP_DIRS = /^(node_modules|\.git|cloudrun-deploy.*|.*备份.*|dist|miniprogram_npm|\.dsh)$/;

const files = [];
function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  entries.forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.test(entry.name)) walk(full); return; }
    if (entry.name.endsWith('.js')) files.push(full);
  });
}
SCAN_DIRS.forEach(d => walk(path.join(ROOT, d)));
files.sort();

/** 只把注释替换成等长空格（保留换行）；字符串原样保留 */
function maskComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else { out += ' '; }
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' ');
      i += 1; continue;
    }
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'; out += c; i += 1; continue;
    }
    out += c; i += 1; continue;
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split(/\r?\n/).length;

function resolveRequire(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const cands = [base, base + '.js', base + '.json', path.join(base, 'index.js')];
  for (const c of cands) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return { ok: true, hit: c }; } catch (e) { /* ignore */ }
  }
  try {
    const pkg = path.join(base, 'package.json');
    if (fs.existsSync(pkg)) {
      const main = JSON.parse(fs.readFileSync(pkg, 'utf8')).main;
      if (main) { const m = path.resolve(base, main); if (fs.existsSync(m)) return { ok: true, hit: m }; }
    }
  } catch (e) { /* ignore */ }
  return { ok: false, base };
}

/** 仓库根下是否存在该 require 的末段路径（判断是否依赖运行 / 部署目录布局） */
function rootHas(spec) {
  const tail = spec.replace(/^(\.\.?[\\/])+/, '');
  return [tail, tail + '.js', path.join(tail, 'index.js')].some(c => {
    try { return fs.existsSync(path.join(ROOT, c)); } catch (e) { return false; }
  });
}

const syntaxErrors = [];
const hardRequireErrors = [];
const softRequires = [];
const bomFiles = [];
let requireCount = 0;

files.forEach(file => {
  const buf = fs.readFileSync(file);
  const rel = path.relative(ROOT, file);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) bomFiles.push(rel);
  const src = buf.toString('utf8');

  try { new vm.Script(src, { filename: file }); }
  catch (error) {
    const m = String(error.stack || '').match(/[\\/][^\\/\n]*\.js:(\d+)/);
    syntaxErrors.push({ rel, line: m ? Number(m[1]) : 0, message: error.message });
  }

  const masked = maskComments(src);
  const lines = src.split(/\r?\n/);
  const RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = RE.exec(masked)) !== null) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    requireCount += 1;
    const r = resolveRequire(file, spec);
    if (r.ok) continue;
    const lineNo = lineOf(masked, m.index);
    const rec = { rel, line: lineNo, lineText: String(lines[lineNo - 1] || '').trim().slice(0, 110), spec, resolved: path.relative(ROOT, r.base) };
    if (rootHas(spec)) softRequires.push(rec); else hardRequireErrors.push(rec);
  }
});

const hasHard = syntaxErrors.length + hardRequireErrors.length + bomFiles.length;
if (syntaxErrors.length) {
  console.log('✗ 语法错误 ' + syntaxErrors.length + ' 处（会让页面空白 / 脚本无法加载）');
  syntaxErrors.forEach(e => console.log('   · ' + e.rel + ':' + e.line + ' —— ' + e.message));
}
if (hardRequireErrors.length) {
  console.log('✗ 相对 require 路径确实不存在 ' + hardRequireErrors.length + ' 处（会让页面空白）');
  hardRequireErrors.forEach(e => console.log('   · ' + e.rel + ':' + e.line + "  require('" + e.spec + "')  →  " + e.resolved + '（不存在）'));
}
if (bomFiles.length) {
  console.log('✗ 含 BOM 头的文件 ' + bomFiles.length + ' 个（项目约定零 BOM）');
  bomFiles.forEach(f => console.log('   · ' + f));
}
if (softRequires.length) {
  console.log('⚠ 需人工确认 ' + softRequires.length + ' 处（按文件所在目录解析不到，但仓库根下存在 → 依赖运行/部署目录布局）');
  softRequires.forEach(e => console.log('   · ' + e.rel + ':' + e.line + "  require('" + e.spec + "')"));
}
if (!hasHard) {
  console.log('✓ 检查 ' + files.length + ' 个 .js：语法全部正确、' + requireCount + ' 条相对 require 无"确实不存在"、零 BOM'
    + (softRequires.length ? '（另有 ' + softRequires.length + ' 处依赖目录布局，已列出）' : ''));
}
process.exit(hasHard ? 1 : 0);
