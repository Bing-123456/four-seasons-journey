'use strict';
// 守卫逻辑单元测试：验证水果名排除 + 单字兜底
const { focusTermsOf, answerAddresses, isHonestRefusal } = require('./chat');

const cases = [
  { q: '如何挑选西瓜', expectTerms: ['挑选'] },
  { q: '西瓜怎么挑', expectTerms: ['挑'] },
  { q: '李子和杏子有什么区别', expectTerms: ['区别'] },
  { q: '凤梨和菠萝是什么关系', expectTerms: ['关系'] }
];

let pass = 0, fail = 0;
for (const c of cases) {
  const terms = focusTermsOf(c.q);
  const mustHave = c.expectTerms.filter(t => terms.includes(t));
  const ok = mustHave.length === c.expectTerms.length;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + c.q + ' -> terms: [' + terms.join(', ') + ']');
  ok ? pass++ : fail++;
}

// 答非所问检测：农谚食养历史回答不含「挑选」应被拦
const badAnswer = '【农谚与时令】西瓜是夏季水果…【乡土食养与习俗】民间有食养传统…【拓展科普】历史上…';
const q1 = '如何挑选西瓜';
const blocked = !answerAddresses(q1, badAnswer) && !isHonestRefusal(badAnswer);
console.log((blocked ? 'PASS' : 'FAIL') + ' | 农谚食养回答被守卫拦截');
blocked ? pass++ : fail++;

// 好回答（含挑选要点）应通过
const goodAnswer = '挑西瓜看三点：\n一、纹路清晰\n二、瓜蒂卷曲\n三、拍声清脆\n以上是通用生活小常识，非文献资料';
const passed = answerAddresses(q1, goodAnswer);
console.log((passed ? 'PASS' : 'FAIL') + ' | 常识回答通过守卫');
passed ? pass++ : fail++;

// 诚实拒答应通过
const refuse = '素材库里没有挑选西瓜的相关内容。';
const refuseOk = isHonestRefusal(refuse);
console.log((refuseOk ? 'PASS' : 'FAIL') + ' | 拒答识别');
refuseOk ? pass++ : fail++;

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
