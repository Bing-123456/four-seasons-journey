'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = ['miniprogram', 'server', 'scripts', 'tests'].flatMap(d => walk(path.join(root, d)));
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json')));
const appRoots = (app.subPackages || app.subpackages || []).map(pkg => pkg.root.replace(/\/$/, ''));
let js = 0, json = 0, bytes = 0, subBytes = 0;
for (const file of files) {
  const ext = path.extname(file);
  if (['.js', '.cjs'].includes(ext)) { execFileSync(process.execPath, ['--check', file]); js++; }
  if (ext === '.json') { JSON.parse(fs.readFileSync(file, 'utf8')); json++; }
  if (file.includes('/miniprogram/')) {
    const rel = file.slice(file.indexOf('/miniprogram/') + '/miniprogram/'.length);
    const subRoot = rel.split('/')[0];
    if ((appRoots || []).includes(subRoot)) subBytes += fs.statSync(file).size;
    else bytes += fs.statSync(file).size;
  }
  // iOS 上 image 组件不解析本地 WebP（webp 属性仅支持网络资源），本地位图只用 jpg/png。
  if (ext === '.webp' && file.includes(`${path.sep}miniprogram${path.sep}`)) throw Error('小程序内禁止本地 WebP 资源（iOS 不渲染）：' + path.relative(root, file));
  if (['.js', '.json', '.wxml', '.wxss', '.md'].includes(ext)) {
    const s = fs.readFileSync(file, 'utf8');
    if (/sk-[a-zA-Z0-9]{20,}/.test(s)) throw Error('代码中发现疑似密钥：' + path.relative(root, file));
    if (ext === '.wxml' && /wx:(?:if|elif)="[A-Za-z_$][A-Za-z0-9_$]*"/.test(s)) throw Error('WXML 条件缺少数据绑定：' + file);
    if (ext === '.wxml' && /\{\{[^}]*&(?:amp|gt|lt);/.test(s)) throw Error('WXML 表达式含不支持的 HTML 转义：' + file);
    // WXML 表达式引擎不执行数组/字符串方法（indexOf 实测恒为假，会让 wx:if 永不成立），布尔值请在 JS 里算好。
    if (ext === '.wxml' && /\{\{[^}]*\b[A-Za-z_$][\w$]*\s*\.\s*(?:indexOf|lastIndexOf|includes|slice|filter|map|join|split|concat|replace|toFixed|find|findIndex|some|every|reduce|trim|sort|substring|charAt|padStart|padEnd|startsWith|endsWith)\s*\(/.test(s)) throw Error('WXML 表达式调用了数组/字符串方法，请改在 JS 里计算：' + file);
  }
}
for (const page of app.pages) for (const ext of ['js','json','wxml','wxss']) if (!fs.existsSync(path.join(root, 'miniprogram', page + '.' + ext))) throw Error('页面缺失：' + page + '.' + ext);
// 插件声明一致性，两个方向都要查——两边都出过事：
//   ① 代码 requirePlugin('X') 但 app.json 没声明 plugins.X
//      → 0.7.7 为放行上传摘掉 WechatSI 声明，语音输入线上静默降级为「暂不可用」，check 全绿；
//   ② app.json 声明了 plugins.X 但代码里没人用
//      → 声明本身就是一次「后台未授权」的风险（上传报 80082），没人用的声明只赔不赚。
// 当前状态（2026-09-28）：语音输入是**双引擎**——插件优先、服务端 /api/asr 兜底。
// 插件那条路已实测授权成功（requirePlugin('WechatSI') 在模拟器里返回 ok），所以声明保留；
// 兜底那条路由下面的 /api 检查守着。两条检查都要活着，任一边出问题都要能拦下来。
// 只扫 miniprogram/：requirePlugin 是小程序端专属 API，扫本脚本自身会误伤注释里的示例。
//
// ⚠️ 插件名可以写成常量（本项目就是 `requirePlugin(PLUGIN_NAME)`）。只认字面量会让检查
// **静默失效**：声明被误判成「没人用」，或者更糟——真正的用法被漏掉、check 照样全绿。
// 所以这里把同文件里的 `const X = '字面量'` 收集起来做一次解析；解析不出来就直接报错，
// 宁可让人显式写清楚，也不要一个假装在工作的检查。
const pluginUse = new Set();
const pluginDeclared = new Set(Object.keys(app.plugins || {}));
const unresolvedPluginNames = [];
for (const file of files) {
  const rel = path.relative(root, file);
  if (!rel.startsWith('miniprogram' + path.sep)) continue;
  if (!['.js', '.cjs', '.wxml', '.json'].includes(path.extname(file))) continue;
  const source = fs.readFileSync(file, 'utf8');
  const constants = new Map();
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    constants.set(match[1], match[2]);
  }
  for (const match of source.matchAll(/requirePlugin\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) pluginUse.add(match[1]);
  for (const match of source.matchAll(/requirePlugin\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const resolved = constants.get(match[1]);
    if (resolved) pluginUse.add(resolved);
    else unresolvedPluginNames.push(path.relative(root, file) + ' 的 requirePlugin(' + match[1] + ')');
  }
  // 插件也可以作为自定义组件使用（usingComponents 里的 plugin://X/...），同样算「用到了」。
  for (const match of source.matchAll(/plugin:\/\/([A-Za-z0-9_]+)\//g)) pluginUse.add(match[1]);
}
if (unresolvedPluginNames.length) throw Error('无法解析插件名：' + unresolvedPluginNames.join('、') +
  '。请改成字面量，或在同一文件里写成 const 常量——否则「代码是否用到插件」这条检查会失效。');
for (const name of pluginUse) {
  const declared = app.plugins && app.plugins[name];
  if (!declared) throw Error('代码用到了插件 ' + name + '，但 miniprogram/app.json 没有声明 plugins.' + name +
    ' —— 线上会静默降级。二选一：① 小程序后台「设置 → 第三方设置 → 插件管理」添加该插件，再在 app.json 补声明（顺序不能颠倒，否则上传报 80082）；② 改走服务端实现，移除对插件的依赖。');
  if (!declared.provider) throw Error('app.json 的 plugins.' + name + ' 缺少 provider');
  if (!declared.version) throw Error('app.json 的 plugins.' + name + ' 缺少 version');
}
for (const name of pluginDeclared) {
  if (!pluginUse.has(name)) throw Error('app.json 声明了 plugins.' + name + '，但 miniprogram/ 里没有任何代码使用它。' +
    '未使用的插件声明仍然要求后台完成授权，上传会报 80082 —— 请删掉这条声明。');
}
// 语音输入的兜底链路：客户端调用的接口必须真实存在于 server/app.js：
// 路由漏写不会让 check 变红，只会让用户点麦克风时静默降级——正是要拦的那类失配。
const voiceSource = fs.readFileSync(path.join(root, 'miniprogram/lib/speech-input.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
for (const match of voiceSource.matchAll(/['"](\/api\/[a-z0-9-]+)['"]/g)) {
  if (!serverSource.includes("'" + match[1] + "'")) throw Error('语音输入调用了 ' + match[1] + '，但 server/app.js 没有对应路由（语音会静默降级）');
}
const photos = require('../miniprogram/data/photo-credits.json');
const catalog = require('../miniprogram/data/catalog');
// 评测集引用完整性：culture-seed.json 里的 placeId / relevantFactIds 必须真实存在于 catalog。
// 2026-09-28 发现 q004/q019/q026 引用了一个不存在的 autumn-field（正确是 autumn-orchard），
// 系统于是返回「没有找到这个文化条目，请重新选择」——一条给用户的报错文案被当成模型失败计入了指标，
// 把误拒率从 0.071 抬到 0.143。评测数据引用错位会静默污染实验结论，必须由脚本拦下。
const evaluationSets = [path.join(root, 'evaluation/culture-seed.json')];
for (const file of evaluationSets) {
  if (!fs.existsSync(file)) continue;
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const placeIds = new Set(catalog.places.map(place => place.id));
  const factIds = new Set(catalog.facts.map(fact => fact.id));
  for (const row of seed.items || []) {
    if (row.placeId && !placeIds.has(row.placeId)) throw Error('评测集 ' + path.relative(root, file) + ' 的 ' + row.id + ' 引用了不存在的 placeId：' + row.placeId + '（系统会返回「没有找到这个文化条目」，污染误拒率）');
    for (const id of row.relevantFactIds || []) if (!factIds.has(id)) throw Error('评测集 ' + path.relative(root, file) + ' 的 ' + row.id + ' 引用了不存在的事实 ID：' + id);
  }
}
for (const photo of photos) {
  if (!/^\/assets\/[a-z0-9-]+\.jpg$/.test(photo.src) || !photo.creator || !photo.sourceUrl) throw Error('实拍图片缺少资源或署名信息');
  if (!photo.licenseUrl && !(photo.rightsStatus === 'not-declared' && photo.usageScope === 'local-prototype-reference' && photo.rightsNote)) throw Error('实拍图片缺少许可或原型引用边界');
  const file = path.join(root, 'miniprogram', photo.src);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) throw Error('实拍图片未包含在小程序包内：' + photo.src);
  if (!catalog.media[photo.id] || catalog.media[photo.id].src !== photo.src) throw Error('实拍图片清单与页面资料不一致：' + photo.id);
}
for (const file of walk(path.join(root, 'docs')).concat(path.join(root, 'README.md'))) {
  if (['.md', '.json'].includes(path.extname(file)) && /sk-[a-zA-Z0-9]{20,}/.test(fs.readFileSync(file, 'utf8'))) throw Error('文档含疑似密钥：' + path.relative(root, file));
}
for (const pkg of app.subPackages || []) for (const page of pkg.pages) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) if (!fs.existsSync(path.join(root, 'miniprogram', pkg.root, page + '.' + ext))) throw Error('分包页面缺失：' + pkg.root + '/' + page + '.' + ext);
}
if (bytes >= 2 * 1024 * 1024) throw Error('主包超出 2 MB 开发预算，需要拆分子包');
if (subBytes >= 2 * 1024 * 1024) throw Error('分包超出 2 MB 开发预算');
console.log(JSON.stringify({ pages: app.pages.length, subPackages: (app.subPackages || []).length, javascriptFiles: js, jsonFiles: json, mainPackageBytes: bytes, subPackageBytes: subBytes, attributedPhotos: photos.length, secretScan: 'passed' }, null, 2));
