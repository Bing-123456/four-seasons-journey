'use strict';

// 节气英文名（2026-10-11）：English 模式下转盘外圈、知识卡都用这一套。
// 口径依据：项目已有的英文语料（challenge-questions-en.js / fruit-culture-en.js / craft-lessons-en.js，
// 都是用户逐批审过的）**一律用拼音**（Jingzhe / Shuangjiang / Xiaoxue…），官方译名 0 处；
// 「中秋」在语料里写作 Mid-Autumn。所以要改口径，只改这一张表即可（一处生效）。
const TERM_EN = {
  '立春': 'Lichun', '雨水': 'Yushui', '惊蛰': 'Jingzhe', '春分': 'Chunfen', '清明': 'Qingming', '谷雨': 'Guyu',
  '立夏': 'Lixia', '小满': 'Xiaoman', '芒种': 'Mangzhong', '夏至': 'Xiazhi', '小暑': 'Xiaoshu', '大暑': 'Dashu',
  '立秋': 'Liqiu', '处暑': 'Chushu', '白露': 'Bailu', '秋分': 'Qiufen', '寒露': 'Hanlu', '霜降': 'Shuangjiang',
  '立冬': 'Lidong', '小雪': 'Xiaoxue', '大雪': 'Daxue', '冬至': 'Dongzhi', '小寒': 'Xiaohan', '大寒': 'Dahan',
  '中秋': 'Mid-Autumn'
};

// 中文模式原样返回中文；英文模式返回拼音；表外的名字原样返回（不空白、不乱编）
function termEn(name, lang) {
  const key = String(name == null ? '' : name);
  if (!key) return '';
  if (lang !== 'en') return key;
  return TERM_EN[key] || key;
}

module.exports = { termEn, TERM_EN };
