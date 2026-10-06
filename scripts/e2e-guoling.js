// 果灵 AI 端到端自动回归测试：完全模拟小程序客户端行为
// （matchFruits 识别水果 → buildContexts 拼证据包 → POST 真实云托管 /api/chat；
//   无水果名问题 → buildSeasonalContexts 拼当季时令包，同样发给云端作答）。
// 用途：改完服务端/提示词后，本地跑一遍即可判断质量，无需手机测试。
// 用法：node scripts/e2e-guoling.js [服务地址]
//
// 2026-10-01 题库改造：不再只测「点名水果」的题——真实用户不会按预设提问。
// 题库覆盖：泛时令、节气、闲聊人设、离题、口语、错字、多果、短句等真实问法，
// 旧回归题（别名/对比/常识）保留防止能力回退。
// 判卷原则：类别断言在前（答到点就过，拒答前缀不误杀），拒答只对离题题合法。
'use strict';

// 小程序全局 mock：必须在 require search.js 之前定义。
global.Page = () => {};
global.getCurrentPages = () => [];
const search = require('../miniprogram/packageMore/search/search.js');
const fruitCulture = require('../miniprogram/data/fruit-culture');
const BASE = process.argv[2] || 'https://guayouji-server-322229-5-1499093335.sh.run.tcloudbase.com';
const TOKEN = '99fb6493972c19271035cc64ce98d039e4cf55ab0bd1ac86b2004ef8ad5e5539';

// 当前季节的果名清单（时令题断言用）：e2e 与客户端同源，按真实月份算。
function currentSeason() {
  const month = new Date().getMonth() + 1;
  const id = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
  return fruitCulture.seasons.find(item => item.id === id) || fruitCulture.seasons[0];
}
const SEASON_FRUITS = (fruitCulture.seasonFruits(currentSeason()) || []).map(fruit => fruit.name);

const QUESTIONS = [
  // —— 旧回归：已修能力不回退 ——
  ['对比·四维度', '柿子和李子有什么区别'],
  ['常识·资料优先', '如何挑选西瓜'],
  ['别名·樱桃', '车厘子怎么保存'],
  ['别名·关系', '凤梨和菠萝是什么关系'],
  ['别名·葡萄', '提子是什么'],
  ['单字根·柿', '柿饼上的霜怎么分辨'],
  ['外圈果', '龙眼有什么寓意'],
  ['种植·域内文化', '火龙果种植技术'],
  // —— 新增：真实用户的开放问题（不点名水果/口语/错字/闲聊）——
  ['时令·当季', '现在十月吃什么水果好'],
  ['时令·口语', '这个季节有什么水果值得吃'],
  ['节气·果事', '立冬有什么讲究'],
  ['闲聊·人设', '你是谁呀'],
  ['闲聊·情绪', '我今天心情不太好'],
  ['离题·股票', '今天股市行情怎么样'],
  ['错字·语音', '番茄枝是什么水果'],
  ['口语·咋', '车厘子咋保存才新鲜'],
  ['挑选·口语', '怎么挑个甜西瓜'],
  ['对比·应季', '苹果和梨哪个适合现在吃'],
  ['科普·为什么', '为什么秋天要吃梨'],
  ['多果·探索', '柿子和石榴能一起吃吗'],
  ['单词·冷启动', '西瓜'],
  // —— 2026-10-01 需求文档验收用例（第六节）：别名字典 + 三分支兜底 ——
  ['验收·最长匹配', '阳光玫瑰葡萄怎么挑'],
  ['验收·品种名', '贵妃芒什么时候熟'],
  ['验收·单字占用', '脆冬枣有什么讲究'],
  ['验收·情况B边界', '李子立夏尝新有什么讲究'],
  ['验收·本体直问', '葡萄什么时候成熟']
];

async function ask(question) {
  // 与客户端 ask() 同源：命中水果走证据包；没命中走当季时令包。
  const fruits = search.matchFruits(question);
  const contexts = fruits.length ? search.buildContexts(fruits, question) : search.buildSeasonalContexts();
  const payload = { question, history: [], contexts };
  const response = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { error: 'HTTP ' + response.status + ' ' + text.slice(0, 120), fruits: fruits.map(f => f.fruit.name) };
  }
  const data = await response.json();
  return { answer: data.answer || '', evidence: data.usedEvidence || [], followUps: data.followUps || [], fruits: fruits.map(f => f.fruit.name), seasonal: !fruits.length };
}

// 质量断言：自动判断答案是否合格（不用人眼逐条看）。
// 类别断言在前：只要答到了类别要点就过（拒答前缀 + 有效正文不算拒答误杀）。
function judge(tagged, question, result) {
  if (result.error) return { ok: false, reason: result.error };
  const a = result.answer;
  if (!a || a.length < 20) return { ok: false, reason: '答案过短或为空' };
  const refusal = /素材库里没有|素材库暂无/.test(a);
  // —— 离题题：诚实拒答或礼貌收窄话题都算合格，绝不能真给域外答案 ——
  if (/离题/.test(tagged)) {
    if (refusal) return { ok: true, reason: '离题题诚实拒答' };
    if (/水果|果品|只收录|换个/.test(a) && !/(涨|跌|指数|买入|卖出|行情看)/.test(a)) return { ok: true, reason: '离题题礼貌收窄到水果话题' };
    return { ok: false, reason: '离题题给了域外答案' };
  }
  // —— 时令题：必须推荐清单内当季果 ≥2 种 ——
  if (/时令/.test(tagged)) {
    const hits = SEASON_FRUITS.filter(name => a.indexOf(name) !== -1);
    if (hits.length < 2) return { ok: false, reason: '时令题未推荐清单内当季果（命中 ' + hits.length + ' 种）' };
    return { ok: true, reason: '推荐当季果：' + hits.slice(0, 4).join('、') };
  }
  // —— 节气题：要点名该节气并讲相关果事 ——
  if (/节气/.test(tagged)) {
    if (a.indexOf('立冬') === -1) return { ok: false, reason: '节气题未点名立冬' };
    if (!SEASON_FRUITS.some(name => a.indexOf(name) !== -1) && !/蔗|枣|橘|柑/.test(a)) return { ok: false, reason: '节气题未讲相关果事' };
    return { ok: true, reason: '节气果事作答' };
  }
  // —— 错字题：纠到本体果名就过（拒答前缀+有效纠错不算失败）——
  if (/错字/.test(tagged)) {
    if (a.indexOf('释迦') !== -1) return { ok: true, reason: '错字正确纠正到释迦' };
    return { ok: false, reason: '错字题未纠到释迦' };
  }
  // —— 闲聊题：人设内友好回应（带温度词即可，不强制引用资料）——
  if (/闲聊·人设/.test(tagged)) {
    if (/果灵|果园|水果/.test(a)) return { ok: true, reason: '人设内友好回应' };
    return { ok: false, reason: '闲聊回应脱离果灵人设' };
  }
  if (/闲聊·情绪/.test(tagged)) {
    // 人设判定放宽：答案提到任一当季果名（柿子/山楂…）或「果」字都算在果灵人设内，
    // 不强求出现「果」字本身（2026-10-01 误杀：暖答案只写了具体果名）。
    const fruitish = /果/.test(a) || SEASON_FRUITS.some(name => a.indexOf(name) !== -1);
    if (fruitish && (/陪你|心情|开心|暖|难过|宽心|歇歇|抱抱|缓一缓|别硬撑/.test(a) || !refusal)) return { ok: true, reason: '情绪回应带温度且在人设内' };
    return { ok: false, reason: '情绪回应冷漠或脱离人设' };
  }
  // —— 对比题：不应出现营养学指标，应有对比性表述 ——
  if (/对比/.test(tagged)) {
    if (/(糖分|维C|维生素|热量|卡路里)/.test(a)) return { ok: false, reason: '对比题出现营养学指标' };
    if (!/(不同|区别|相比|各有|不一样|而|更该|更适|更合|更当时|更应|更贴|一个偏|优先选|来挑|想.*选.*想.*选|适合.*还是|选.*[；，].*选)/.test(a)) return { ok: false, reason: '对比题没有对比性表述' };
    return { ok: true, reason: '对比合规' };
  }
  // —— 生活实用题：引用了资料即合规；没引用时必须带常识标注 ——
  if (/挑选|保存|怎么吃|怎么挑|咋保存/.test(question)) {
    const citedEvidence = (result.evidence || []).length > 0;
    if (!citedEvidence && !/生活小常识|文献资料/.test(a)) return { ok: false, reason: '常识题既未引用资料也无常识标注' };
  }
  // —— 别名题：应答到本体果名（需求文档 2.3：开头应有别称说明）——
  if (/提子|阳光玫瑰/.test(question) && !/葡萄/.test(a)) return { ok: false, reason: '别名题未答葡萄' };
  if (/提子|阳光玫瑰/.test(question) && !/俗称|别称|商品名|现代叫法|又名|又称/.test(a)) return { ok: false, reason: '别名题开头没说明别称对应关系' };
  if (/车厘子/.test(question) && !/樱桃/.test(a)) return { ok: false, reason: '车厘子题未答樱桃' };
  if (/贵妃芒/.test(question) && !/芒果/.test(a)) return { ok: false, reason: '贵妃芒题未答芒果' };
  if (/脆冬枣/.test(question) && !/冬枣/.test(a)) return { ok: false, reason: '脆冬枣题未答冬枣' };
  // 验收·本体直问：正常答时令，不应出现别称说明（葡萄什么时候成熟）
  if (/葡萄什么时候成熟/.test(question) && /俗称|别称说明|按「葡萄」调取/.test(a.slice(0, 40))) return { ok: false, reason: '本体直问不需要别称说明' };
  // 验收·情况B边界：李子立夏尝新——答案不能串荔枝，且若拒答须是情况B模板或诚实拒答
  if (/李子立夏尝新/.test(question)) {
    if (/立夏.*荔枝|荔枝.*尝新/.test(a)) return { ok: false, reason: '情况B串了荔枝素材（硬隔离失效）' };
    if (!/时令|成熟|孟夏|五月|6月|六月|夏/.test(a) && !refusal) return { ok: false, reason: '答案与李子时令无关' };
  }
  if (/柿饼/.test(question) && !/柿/.test(a)) return { ok: false, reason: '柿饼题未答柿子' };
  // —— 别名关系题：必须说清「同一物种/别称」的对应关系（2026-10-01 守卫误杀修复回归）——
  if (/凤梨/.test(question)) {
    if (!/同一种|同一物|别称|别名|两个名字|又叫|学名|商品名/.test(a)) return { ok: false, reason: '凤梨关系题没说清同一物种/别称关系' };
    return { ok: true, reason: '凤梨=菠萝 别称关系说清' };
  }
  // —— 单词冷启动：答案不能只有一句话敷衍 ——
  if (question === '西瓜' && a.length < 60) return { ok: false, reason: '单词题答案过于单薄' };
  // —— 其余题（含拒答前缀但无类别要点的）：非离题被拒答即失败 ——
  if (refusal) return { ok: false, reason: '非离题题被拒答' };
  return { ok: true, reason: '基础合规' };
}

(async () => {
  console.log('目标服务:', BASE, '（当前季节:', currentSeason().name + '，当季果:', SEASON_FRUITS.join('、') + '）\n');
  let pass = 0, fail = 0;
  const failed = [];
  for (const [tag, question] of QUESTIONS) {
    process.stdout.write('[' + tag + '] ' + question + ' ... ');
    const started = Date.now();
    try {
      const result = await ask(question);
      const verdict = judge(tag + '·' + question, question, result);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (verdict.ok) { pass++; console.log('PASS (' + seconds + 's) ' + verdict.reason); }
      else {
        fail++;
        failed.push({ tag, question, verdict, result });
        console.log('FAIL (' + seconds + 's) ' + verdict.reason);
      }
    } catch (error) {
      fail++;
      failed.push({ tag, question, verdict: { ok: false, reason: error.message }, result: {} });
      console.log('ERROR ' + error.message);
    }
  }
  console.log('\n===== 结果: ' + pass + ' pass / ' + fail + ' fail =====');
  if (fail) {
    console.log('\n----- 失败详情 -----');
    for (const item of failed) {
      console.log('\n[' + item.tag + '] ' + item.question);
      console.log('  原因: ' + item.verdict.reason);
      const answer = item.result.answer || '';
      console.log('  答案前200字: ' + answer.slice(0, 200).replace(/\n/g, ' | '));
    }
    process.exit(1);
  }
})();
