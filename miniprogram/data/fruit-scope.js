'use strict';

// 《四时》板块的内容边界（果灵的回答范围）。
//
// 口径：果灵只回答中国本土的果品与农耕常识。所谓"收录"以链图为准——内圈当季水果与外圈
// 世界风物都算《四时》收录，因为它们的文化内容已经在板块里写好了；问到收录之外、且只在境外
// 形成栽培脉络的对象时，用固定话术婉拒，不编造内容。
//
// 判定优先级（从宽到严）：
//   1. 问题里出现《四时》收录的水果，或出现国内地名 → 照常回答（属于"涉及国内外"）；
//   2. 问题里出现境外水果或境外国家/地区，且没有任何本土对象 → 用固定话术婉拒；
//   3. 其余情况交给原有的资料检索判断，本模块不插手。
//
// 边界表是内容口径，不是植物学结论：西瓜、石榴、苹果都是历史上从境外传入、但在中国形成了
// 千百年栽培文化的果品，因此算《四时》收录对象，照常回答（它们的历史源流里也写明了传入过程）。
const fruitCulture = require('./fruit-culture');

// 婉拒话术：问到"只在境外形成栽培脉络的水果"时使用。
const FOREIGN_FRUIT_REPLY = '{{name}}为外来引进我国的果品，不属于《四时》板块收录的中国本土原生水果。';
// 问到"境外农耕文化本身"（产地、品种、农法、节庆）时使用，语义与上一句一致。
const FOREIGN_TOPIC_REPLY = '{{name}}属于境外农耕文化，不属于《四时》板块收录的中国本土农耕文化。';

// 边界总开关：改成 false 即整体关闭。这是一条内容策略，不是技术限制——
// 以后要放开（国际访客、跨境文化对比）或做"开/关边界"的对照实验，改这一行即可。
const ENABLED = true;
// 婉拒时是否补一句"可以试试"。补上以后，边界就从死胡同变成一条路：
// 用户不会只收到一句"不收录"，而是被引到收录范围内最接近的水果。
const REDIRECT_HINT = true;

// 收录之外的果品 → 就近的《四时》收录水果。
const REDIRECTS = {
  榴莲: ['荔枝', '龙眼', '黄皮'], 猫山王: ['荔枝', '龙眼'], 榴莲蜜: ['菠萝', '香蕉'],
  蓝莓: ['桑葚', '杨梅'], 牛油果: ['无花果', '木瓜'], 鳄梨: ['无花果', '木瓜'],
  菠萝蜜: ['菠萝', '香蕉'], 番石榴: ['杨桃', '木瓜'], 芭乐: ['杨桃', '木瓜'],
  莲雾: ['杨桃', '山竹'], 红毛丹: ['荔枝', '龙眼'], 蛇皮果: ['菠萝', '山竹'],
  蔓越莓: ['草莓', '桑葚'], 树莓: ['草莓', '桑葚'], 覆盆子: ['草莓', '桑葚'], 黑莓: ['桑葚', '杨梅'],
  西梅: ['李子'], 人参果: ['木瓜', '无花果'], 蛋黄果: ['木瓜', '无花果'], 人心果: ['木瓜', '无花果'],
  火参果: ['木瓜', '猕猴桃'], 刺角瓜: ['木瓜', '猕猴桃'], 黄金莓: ['草莓', '猕猴桃'], 姑娘果: ['草莓', '猕猴桃'],
  番樱桃: ['樱桃'], 巴西莓: ['桑葚', '杨梅'], 沙棘果: ['山楂'], 指橙: ['金桔'],
  血橙: ['脐橙'], 葡萄柚: ['柚子', '脐橙'], 西柚: ['柚子', '脐橙'], 青柠: ['柠檬'], 佛手柑: ['柚子']
};

// 收录之外的常见境外果品（按名称匹配；不收录在 fruit-culture 里的一律走婉拒）。
const OUT_OF_SCOPE_FRUITS = [
  '榴莲', '猫山王', '蓝莓', '牛油果', '鳄梨', '菠萝蜜', '番石榴', '芭乐',
  '莲雾', '红毛丹', '蛇皮果', '蔓越莓', '树莓', '覆盆子', '黑莓', '西梅', '人参果',
  '蛋黄果', '人心果', '火参果', '刺角瓜', '榴莲蜜', '黄金莓', '姑娘果', '番樱桃',
  '巴西莓', '沙棘果', '指橙', '血橙', '葡萄柚', '西柚', '青柠', '佛手柑', '鳄梨果'
];

// 境外国家 / 地区 / 大洲。国内地名（含新疆、西藏、内蒙古、广西、云南等）单独判定，不在此列。
const FOREIGN_REGION = /(?:法国|意大利|西班牙|葡萄牙|希腊|德国|荷兰|比利时|瑞士|奥地利|瑞典|挪威|丹麦|芬兰|冰岛|爱尔兰|英国|英格兰|苏格兰|威尔士|俄罗斯|乌克兰|波兰|捷克|匈牙利|罗马尼亚|保加利亚|塞尔维亚|克罗地亚|美国|加拿大|墨西哥|古巴|牙买加|巴西|阿根廷|智利|秘鲁|哥伦比亚|厄瓜多尔|玻利维亚|乌拉圭|巴拉圭|委内瑞拉|澳大利亚|新西兰|斐济|日本|韩国|朝鲜|越南|老挝|柬埔寨|缅甸|印度|巴基斯坦|孟加拉|斯里兰卡|尼泊尔|不丹|马尔代夫|泰国|马来西亚|新加坡|印度尼西亚|印尼|菲律宾|文莱|土耳其|伊朗|伊拉克|叙利亚|黎巴嫩|以色列|约旦|沙特|阿联酋|卡塔尔|科威特|阿曼|也门|格鲁吉亚|亚美尼亚|阿塞拜疆|哈萨克|乌兹别克|土库曼|吉尔吉斯|塔吉克|埃及|摩洛哥|突尼斯|阿尔及利亚|利比亚|苏丹|埃塞俄比亚|肯尼亚|坦桑尼亚|乌干达|尼日利亚|加纳|塞内加尔|南非|津巴布韦|赞比亚|安哥拉|莫桑比克|马达加斯加|毛里求斯|欧洲|非洲|北美洲|南美洲|中美洲|拉丁美洲|大洋洲|中东|地中海|加勒比|东南亚|南亚|中亚|西亚|北欧|西欧|东欧|南欧|波斯|两河|尼罗河|亚马逊|阿尔卑斯|安第斯)/;

// 国内地名与本土标记：出现即认为问题涉及本土，不做婉拒。
const DOMESTIC_MARKER = /(?:河南|郑州|中牟|新郑|灵宝|寺河|姚家|刁家|狼城岗|青谷堆|大河村|开封|洛阳|安阳|南阳|信阳|周口|驻马店|许昌|漯河|三门峡|商丘|平顶山|焦作|濮阳|鹤壁|济源|新疆|西藏|内蒙古|广西|云南|贵州|四川|重庆|陕西|甘肃|青海|宁夏|北京|上海|天津|广东|福建|浙江|江苏|山东|山西|安徽|江西|湖南|湖北|河北|辽宁|吉林|黑龙江|海南|台湾|香港|澳门|中国|我国|国内|国产|本土|本地|当地|这里|这儿|中原|华夏)/;

let collectedCache = null;
function collectedNames() {
  if (!collectedCache) collectedCache = fruitCulture.knownFruitNames();
  return collectedCache;
}

function fill(template, name) { return template.replace('{{name}}', name); }

// 判断问题是否落在《四时》板块之外。
// 返回 { scope: 'in' | 'mixed' | 'out', subject, message }：
//   in    —— 与境外无关，交给原有检索流程；
//   mixed —— 国内外都提到，照常回答；
//   out   —— 只涉及境外对象，message 为固定话术。
function classify(question) {
  const text = String(question == null ? '' : question);
  if (!ENABLED || !text.trim()) return { scope: 'in', subject: '', message: '', suggestions: [] };
  const fruits = OUT_OF_SCOPE_FRUITS.filter(name => text.indexOf(name) !== -1);
  const region = (text.match(FOREIGN_REGION) || [])[0] || '';
  if (!fruits.length && !region) return { scope: 'in', subject: '', message: '', suggestions: [] };
  // 问题里出现国内地名 → 国内外都提到，照常回答。
  if (DOMESTIC_MARKER.test(text)) return { scope: 'mixed', subject: '', message: '', suggestions: [] };
  // 出现境外地名却没有国内标记 → 问的就是境外对象，即使句子里带了一个水果名（如"法国的葡萄园"）。
  if (region) return { scope: 'out', subject: region, message: fill(FOREIGN_TOPIC_REPLY, region), suggestions: [] };
  // 只剩境外水果名：先摘掉它，避免"番石榴/葡萄柚"里的"石榴/葡萄"被误判成《四时》收录对象。
  let remainder = text;
  fruits.forEach(name => { remainder = remainder.split(name).join(''); });
  if (collectedNames().some(name => remainder.indexOf(name) !== -1)) return { scope: 'mixed', subject: '', message: '', suggestions: [] };
  return {
    scope: 'out', subject: fruits[0], message: fill(FOREIGN_FRUIT_REPLY, fruits[0]),
    suggestions: REDIRECT_HINT ? (REDIRECTS[fruits[0]] || []).slice() : []
  };
}

// 实际展示给用户的文案：固定话术 + 一句"可以试试"的引导。
function refusalText(result) {
  if (!result || !result.message) return '';
  const hints = result.suggestions || [];
  return hints.length ? result.message + '可以试试《四时》收录的' + hints.join('、') + '。' : result.message;
}

// 供文案与测试引用的原文，避免话术散落多处。
const TEMPLATES = { fruit: FOREIGN_FRUIT_REPLY, topic: FOREIGN_TOPIC_REPLY };

module.exports = { classify, refusalText, collectedNames, OUT_OF_SCOPE_FRUITS, FOREIGN_REGION, DOMESTIC_MARKER, TEMPLATES, ENABLED, REDIRECT_HINT, REDIRECTS };
