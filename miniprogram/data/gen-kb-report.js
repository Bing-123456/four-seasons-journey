'use strict';
// 生成知识库整理报告 HTML：覆盖矩阵 + 问题清单 + 全部 42 种水果正文（折叠审阅）
const fs = require('fs');
const path = require('path');
const WORLD = require('./world-fruit-culture');
const fruitCulture = require('./fruit-culture');
const proverbs = require('./farm-proverbs').proverbs;

const CAT_LABELS = { folk: '民俗仪式与节气食俗', history: '历史源流', craft: '传统手工技艺', story: '乡土故事', tools: '传统农具与种植', health: '时令食养文化' };
const CAT_ORDER = ['folk', 'history', 'craft', 'story', 'tools', 'health'];

const native = new Set();
Object.values(fruitCulture.NATIVE_NAMES).forEach(list => list.forEach(n => native.add(n)));
const coreNames = new Set();
fruitCulture.seasons.forEach(s => s.fruits.forEach(f => coreNames.add(f.name)));

// 季节归属
const seasonOf = {};
fruitCulture.seasons.forEach(s => {
  s.fruits.forEach(f => { seasonOf[f.name] = s.name; });
  (s.moreFruits || []).forEach(f => { if (!seasonOf[f.name]) seasonOf[f.name] = s.name + '（外圈）'; });
});

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function proverbFor(name) {
  return proverbs.filter(p => p.text.indexOf(name) !== -1 || (p.note || '').indexOf(name) !== -1);
}

const names = Object.keys(WORLD);
const rows = names.map(name => {
  const cats = WORLD[name] || [];
  const byCat = {};
  cats.forEach(c => { byCat[c.cat] = c; });
  const totalLen = cats.reduce((sum, c) => sum + (c.text || '').length + (c.detail || '').length, 0);
  return { name, cats, byCat, totalLen, native: native.has(name), core: coreNames.has(name) };
});

// 覆盖矩阵
const matrixRows = rows.map(r => {
  const cells = CAT_ORDER.map(cat => {
    const c = r.byCat[cat];
    if (!c) return '<td class="miss">—</td>';
    return '<td class="hit">' + ((c.text || '').length + (c.detail || '').length) + ' 字</td>';
  }).join('');
  const tag = r.core ? '<span class="tag core">季节核心</span>' : (r.native ? '<span class="tag native">本土内圈</span>' : '<span class="tag world">外圈·世界风物</span>');
  return '<tr><td class="fname">' + esc(r.name) + '<br>' + tag + '</td><td class="sub">' + esc(seasonOf[r.name] || '') + '</td>' + cells + '<td>' + r.totalLen + '</td></tr>';
}).join('\n');

// 全文卡片
const cards = rows.map(r => {
  const secs = r.cats.map(c => {
    return '<section class="dim"><h4>' + esc(CAT_LABELS[c.cat] || c.cat) + '</h4>' +
      '<p class="lead">' + esc(c.text) + '</p>' +
      '<p>' + esc((c.detail || '').startsWith((c.text || '').slice(0, 10)) ? (c.detail || '').slice((c.text || '').length) : (c.detail || '')) + '</p></section>';
  }).join('');
  const ps = proverbFor(r.name);
  const pHtml = ps.length
    ? '<div class="prov"><h4>相关农谚（农谚集）</h4>' + ps.map(p => '<p>「' + esc(p.text) + '」<span class="note">' + esc(p.note) + '</span></p>').join('') + '</div>'
    : '';
  return '<details class="fruit"><summary><span class="sname">' + esc(r.name) + '</span>' +
    '<span class="tag ' + (r.core ? 'core' : (r.native ? 'native' : 'world')) + '">' + (r.core ? '季节核心' : (r.native ? '本土内圈' : '外圈·世界风物')) + '</span>' +
    '<span class="len">' + r.totalLen + ' 字</span></summary>' + secs + pHtml + '</details>';
}).join('\n');

const proverbList = proverbs.map(p => '<div class="prov-item"><p class="ptext">「' + esc(p.text) + '」</p><p class="note">' + esc(p.note) + '</p></div>').join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>果物四时记 · 知识库内容整理报告</title>
<style>
  :root { --ink:#2b2622; --sub:#8a7f74; --paper:#faf7f2; --card:#ffffff; --line:#e8e0d4; --accent:#b3543a; --accent2:#7a8b5c; --warn:#c0392b; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; background: var(--paper); color: var(--ink); line-height: 1.75; padding: 32px 20px 80px; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .meta { color: var(--sub); font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 20px; margin: 40px 0 14px; padding-left: 12px; border-left: 4px solid var(--accent); }
  h3 { font-size: 16px; margin: 20px 0 8px; }
  p { margin-bottom: 10px; font-size: 14.5px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); font-size: 13px; }
  th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: center; }
  th { background: #f3ede3; font-weight: 600; }
  td.fname { text-align: left; font-weight: 600; white-space: nowrap; }
  td.sub { color: var(--sub); font-size: 12px; white-space: nowrap; }
  td.hit { color: var(--accent2); }
  td.miss { color: #d0c6b8; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; margin-left: 6px; white-space: nowrap; }
  .tag.core { background: #fdeee8; color: var(--accent); }
  .tag.native { background: #eef3e6; color: #5c7040; }
  .tag.world { background: #eef0f4; color: #6b7a94; }
  .stat { display: flex; gap: 14px; flex-wrap: wrap; margin: 14px 0; }
  .stat .box { flex: 1; min-width: 150px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; text-align: center; }
  .stat .num { font-size: 26px; font-weight: 700; color: var(--accent); }
  .stat .lbl { font-size: 12px; color: var(--sub); }
  .issue { border-left: 4px solid var(--warn); }
  .issue h3 { color: var(--warn); margin-top: 0; }
  .issue .sev { font-size: 11px; color: #fff; background: var(--warn); border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: 2px; }
  .issue .sev.mid { background: #d68910; }
  .issue .sev.low { background: #7a8b5c; }
  details.fruit { background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
  details.fruit summary { padding: 12px 18px; cursor: pointer; display: flex; align-items: center; gap: 10px; list-style: none; }
  details.fruit summary::-webkit-details-marker { display: none; }
  details.fruit summary::before { content: "▸"; color: var(--sub); transition: transform .15s; }
  details.fruit[open] summary::before { transform: rotate(90deg); }
  details.fruit summary:hover { background: #f7f2ea; }
  .sname { font-size: 16px; font-weight: 700; }
  .len { margin-left: auto; color: var(--sub); font-size: 12px; }
  .dim { padding: 4px 22px 12px; border-top: 1px dashed var(--line); }
  .dim h4 { font-size: 13px; color: var(--accent); margin: 10px 0 4px; }
  .dim .lead { color: var(--sub); font-size: 13px; }
  .dim p { font-size: 14px; }
  .prov { margin: 6px 22px 14px; background: #f7f2ea; border-radius: 8px; padding: 10px 14px; }
  .prov h4 { font-size: 13px; color: var(--accent2); margin-bottom: 4px; }
  .prov .note { color: var(--sub); font-size: 12.5px; }
  .prov-item { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 18px; margin-bottom: 10px; }
  .ptext { font-weight: 600; font-size: 15px; }
  .note { color: var(--sub); font-size: 13px; }
  code { background: #f0eae0; border-radius: 4px; padding: 1px 6px; font-size: 13px; }
  ul { padding-left: 22px; margin-bottom: 10px; }
  li { font-size: 14.5px; margin-bottom: 6px; }
  .hint { font-size: 12.5px; color: var(--sub); background: #f3ede3; border-radius: 8px; padding: 8px 14px; margin-bottom: 14px; }
</style>
</head>
<body>
<div class="wrap">

<h1>果物四时记 · 知识库内容整理报告</h1>
<p class="meta">生成时间 2026-10-01 · 数据来源 miniprogram/data/（组员整理的现有素材）· 用于你逐条审阅、标记调整</p>

<div class="hint">👇 每个水果卡片可点开查看 6 个维度的完整正文（导语与正文已去重合并）；看中哪里不合适，直接告诉我水果名 + 维度 + 要改的点即可。</div>

<h2>一、知识库总览</h2>
<div class="stat">
  <div class="box"><div class="num">42</div><div class="lbl">收录水果（world-fruit-culture）</div></div>
  <div class="box"><div class="num">6</div><div class="lbl">每果维度（民俗/历史/手艺/故事/农具/食养）</div></div>
  <div class="box"><div class="num">252</div><div class="lbl">资料条目（42×6，全部齐全）</div></div>
  <div class="box"><div class="num">5</div><div class="lbl">农谚（farm-proverbs）</div></div>
  <div class="box"><div class="num">24</div><div class="lbl">节气札记（solar-term-notes，中英双语）</div></div>
</div>

<h3>问果灵回答时实际用到的数据（即「知识库边界」）</h3>
<div class="card">
<ul>
  <li><b>world-fruit-culture.js</b>：42 种水果 × 6 维度正文。搜索命中水果后，按与问题的相关度排序拼接（每果截 1800 字）发给 AI —— 这是知识库的主体。</li>
  <li><b>farm-proverbs.js</b>：5 条农谚，命中水果相关时附加（最多 2 条）。</li>
  <li><b>fruit-scope.js</b>：拦截规则。35 种外来果（榴莲、车厘子、蓝莓等）直接拒答并推荐本土替代果，不进 AI。</li>
  <li><b>fruit-culture.js</b>：季节排布 + 本土/外圈名单（决定哪些果在链图内圈可点）。</li>
</ul>
<p style="color:var(--sub);font-size:13px;">不进问果灵、仅作页面展示的数据：catalog.js（中牟地方资料）、farmer-stories.js（果农故事）、heritage.js（河南博物院农具）、solar-term-notes.js（节气卡片，只做跳转建议）、fruit-quiz.js（农谚问答题库）、workshop.js（瓜豆酱手作专题）、farm-activities.js（农事活动）。</p>
</div>

<h2>二、覆盖矩阵（字数 = 该维度 导语+正文 总字数）</h2>
<table>
<thead><tr><th>水果</th><th>季节</th><th>民俗仪式与节气食俗</th><th>历史源流</th><th>传统手工技艺</th><th>乡土故事</th><th>传统农具与种植</th><th>时令食养文化</th><th>合计</th></tr></thead>
<tbody>
${matrixRows}
</tbody>
</table>

<h2>三、审阅时建议重点看的问题（我发现的，供你定夺）</h2>

<div class="card issue">
<h3>① 每条资料的导语与正文开头完全重复<span class="sev">建议修</span></h3>
<p>252/252 条全部如此：<code>text</code>（导语）是 <code>detail</code>（正文）的开头一段。拼包发给 AI 时同一段话出现两遍，每果 1800 字上限里约 15-20% 被重复内容占用，还可能让 AI 复述时显得啰嗦。<b>建议：拼包时只用正文（或去掉正文开头的重复段），不用改数据本身。</b></p>
</div>

<div class="card issue">
<h3>② 「只答中国本土」边界与实际收录有出入<span class="sev">需要你拍板</span></h3>
<p>服务端铁律写的是「境外果品不在资料范围」，fruit-scope 也拦截榴莲/车厘子等 35 种外来果；但 WORLD 库实际给 <b>22 种外圈果</b>（释迦、椰枣、杨桃、木瓜、火龙果、山竹、香蕉、芒果、菠萝、草莓、苹果、葡萄、哈密瓜、椰子、百香果、柠檬、石榴、无花果、脐橙、甘蔗、冬枣、西瓜<sup>*</sup>）写了完整 6 维内容。用户问「释迦怎么吃、有什么讲究」时，这些内容会正常引用作答。</p>
<p style="color:var(--sub);font-size:13px;">* 注：西瓜、苹果、石榴、葡萄、哈密瓜是「季节核心果」却不在 NATIVE_NAMES 本土名单里——名单口径本身不一致。内容视角都是「传入中国后的中国风物」，与「境外农耕不答」不冲突，但和你理解的边界可能不同。</p>
<p><b>两个选项</b>：A. 维持现状（资料里有的就答，符合你说的「严格只答知识库」）；B. 问果灵只对本土内圈 20 种果作答，外圈果跳转到果谱页看资料。</p>
</div>

<div class="card issue">
<h3>③ 答点守卫的水果名名单不全<span class="sev mid">小问题</span></h3>
<p>昨天修的「如何挑选西瓜」守卫，排除水果名时只取了 14 个季节核心果名，漏了 moreFruits 里的 28 个（杏、枇杷、荔枝、杨梅、香蕉等）。影响很小（只会让守卫略宽松），下次部署可以顺手修。</p>
</div>

<div class="card issue">
<h3>④ 个别水果重复收录<span class="sev low">留意即可</span></h3>
<p>「枣」与「冬枣」是两个独立条目，各有 6 维内容，内容主题有部分重叠（冬枣也是枣）；葡萄、柚子、脐橙、甘蔗在两个季节各出现一次，共用同一份 WORLD 内容（季节归属问题，不是内容问题）。</p>
</div>

<div class="card issue">
<h3>⑤ 农谚集只有 5 条<span class="sev low">覆盖薄</span></h3>
<p>只覆盖樱桃、瓜类、桃杏梨、柿子等，42 种水果绝大多数没有对应农谚（搜索离线答案会显示「素材库暂无农谚条目」）。每条都带适用范围注解，质量是好的，就是量少。</p>
</div>

<h2>四、内容质量抽查（西瓜 / 杏 / 释迦 全文）</h2>
<div class="card">
<p>抽查了三个代表（本土核心 / 本土内圈 / 外圈外来果），整体判断：</p>
<ul>
<li><b>有出处意识</b>：历史维度引用了《陷虏记》《松漠纪闻》、范成大/文天祥诗、董奉杏林典故等，未见明显硬伤。</li>
<li><b>有分寸说明</b>：农谚注解都标注了适用范围（如「七月核桃八月梨」注明是山东招远歌谣、不能推定全国果期）；食养维度不谈疗效，杏条目明确「苦杏仁切勿生食」。</li>
<li><b>口径与「严格只答知识库」边界吻合</b>：内容都是文化向（民俗/历史/手艺/农事/食养），没有挑选方法、营养数字这类需要常识通道兜底的内容——与你定的边界正好互补。</li>
<li><b>风险点</b>：果农故事维度的细节很具体（如「十四五岁替父亲相瓜」「旱年四十天挑水」），是文学化写法不是实录，如果答辩时被追问出处，注意口径是「依据乡土素材整理的故事」。</li>
</ul>
</div>

<h2>五、42 种水果全文审阅（点开查看）</h2>
${cards}

<h2>六、农谚集全文（5 条）</h2>
${proverbList}

</div>
</body>
</html>
`;

const out = path.resolve(__dirname, '../../知识库内容整理报告.html');
fs.writeFileSync(out, html);
console.log('written: ' + out + ' (' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB)');
