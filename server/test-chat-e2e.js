'use strict';
// 端到端测试：模拟小程序 /api/chat 请求，走真实 DeepSeek API
// 运行前设置环境变量 OPENAI_API_KEY 等（与云托管相同配置）
const { createChatService } = require('./chat');
const fruitCulture = require('../miniprogram/data/fruit-culture');
let WORLD;
try { WORLD = require('./world-fruit-culture'); }
catch (e) { WORLD = require('../miniprogram/data/world-fruit-culture'); }

// 模拟客户端 buildContexts：给定水果名，拼出该水果各维度资料卡（含去重）
function categoryText(cat) {
  const lead = cat.text || '';
  const detail = cat.detail || '';
  if (lead && detail.startsWith(lead)) return '【' + cat.cat + '】' + detail;
  return '【' + cat.cat + '】' + lead + (detail ? '　' + detail : '');
}
function buildFruitContexts(name) {
  const hit = fruitCulture.findFruitByName(name);
  const cats = hit ? (hit.fruit.categories || []) : (WORLD[name] || []);
  const sections = cats
    .map(cat => ({ cat: cat.cat, text: categoryText(cat) }))
    .map((section, index) => Object.assign({}, section, { index }))
    .sort((a, b) => a.index - b.index)
    .map(section => section.text);
  return [{ name: name + '·四时素材', text: sections.join('\n').slice(0, 1800) }];
}

async function main() {
  const config = {
    provider: 'openai-compatible',
    model: process.env.MODEL_NAME || 'deepseek-flash',
    providerBase: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
    providerKey: process.env.OPENAI_API_KEY,
    timeoutMs: 30000
  };
  const chat = createChatService(config);

  const tests = [
    { name: '西瓜', question: '如何挑选西瓜' },
    { name: '西瓜', question: '西瓜怎么吃' },
    { name: '西瓜', question: '西瓜有什么习俗' },
    { name: '石榴', question: '石榴有什么寓意' },
    { name: '葡萄', question: '葡萄是怎么传入中国的' },
    { name: '火龙果', question: '火龙果怎么种' },
    // —— 新规则：对比题必须走传统文化四维度，禁营养学指标 ——
    { names: ['柿子', '李子'], question: '柿子和李子有什么区别' },
    { names: ['桃', '葡萄'], question: '桃和葡萄送长辈哪个更合适' },
    // —— 新规则：本土原生果标签 + 全国史料 ——
    { name: '桃子', question: '桃子有什么寓意' },
    // —— 新规则：文化知识缺失时基于农耕文化常识生成 + 标注，不编古籍 ——
    { name: '西瓜', question: '古代的水果是怎么保鲜运输的' },
    { name: '西瓜', question: '火龙果的种植技术' }   // 资料是西瓜，问火龙果：应拒答
  ];

  for (const t of tests) {
    const contexts = (t.names || [t.name]).map(n => buildFruitContexts(n)[0]);
    console.log('--- contexts 预览 [' + (t.names || [t.name]).join('+') + '] ---');
    console.log(contexts[0].text.slice(0, 180) + '...\n');
    console.log('Q: ' + t.question);
    try {
      const result = await chat.answer({ question: t.question, history: [], contexts });
      console.log('A: ' + result.answer);
      console.log('   [mode=' + result.mode + ' guarded=' + (result.guarded || false) + ' evidence=' + JSON.stringify(result.usedEvidence) + ']');
      console.log('   followUps: ' + JSON.stringify(result.followUps));
    } catch (error) {
      console.log('ERROR: ' + (error.message || error));
    }
    console.log('');
  }
}
main();
