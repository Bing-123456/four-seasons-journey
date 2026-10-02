'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'check-project.js')], { stdio: 'inherit' });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'guayouji-release-'));
const target = path.join(staging, 'guayouji-wechat');
fs.mkdirSync(target);
const allowlist = ['miniprogram', 'server', 'scripts', 'tests', 'docs', 'README.md', 'package.json', 'package-lock.json', 'project.config.json', '.env.example', '.gitignore'];
for (const name of allowlist) if (fs.existsSync(path.join(root, name))) fs.cpSync(path.join(root, name), path.join(target, name), { recursive: true, filter: p => !p.endsWith('.DS_Store') });
const release = path.join(root, 'release'); fs.mkdirSync(release, { recursive: true });
const archive = path.join(release, 'guayouji-wechat-dev.zip');
if (fs.existsSync(archive)) fs.unlinkSync(archive);
// Python writes the UTF-8 filename flag, so Chinese docs also extract correctly
// on Windows and tools that otherwise interpret the legacy zip names as CP437.
execFileSync('python3', ['-c', [
  'import pathlib, sys, zipfile',
  'root, output = map(pathlib.Path, sys.argv[1:])',
  'with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as bundle:',
  '    for item in sorted(root.rglob("*")):',
  '        if item.is_file(): bundle.write(item, item.relative_to(root.parent).as_posix())'
].join('\n'), target, archive]);
const entries = execFileSync('/usr/bin/unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
if (entries.some(p => /(^|\/)\.env$|node_modules|project\.private|\.git\//.test(p))) throw Error('压缩包包含不应交付的本地文件');
console.log('已生成 ' + archive + '，不含 API 密钥与本机私有配置。');
