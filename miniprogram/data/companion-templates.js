'use strict';

// Original vector drawings, authored for 瓜游记. Coordinates use a 512 px square.
// These are creative characters, never photographs or evidence of a real place.
function ellipse(x, y, rx, ry, count) {
  return Array.from({ length: count || 64 }, (_, i) => {
    const angle = Math.PI * 2 * i / (count || 64);
    return [x + rx * Math.cos(angle), y + ry * Math.sin(angle)];
  });
}
function curve(start, segments) {
  const points = [start]; let from = start;
  segments.forEach(s => {
    for (let i = 1; i <= 16; i += 1) {
      const t = i / 16; const u = 1 - t;
      points.push([u*u*u*from[0]+3*u*u*t*s[0]+3*u*t*t*s[2]+t*t*t*s[4],u*u*u*from[1]+3*u*u*t*s[1]+3*u*t*t*s[3]+t*t*t*s[5]]);
    }
    from = [s[4], s[5]];
  });
  return points;
}
const leaf = (x,y) => curve([x,y], [[x-34,y-34,x-48,y-62,x-9,y-48],[x+30,y-44,x+22,y-17,x,y]]);
const region = (id, polygon, color) => ({ id, polygon, color });
const templates = [
  { id: 'watermelon', name: '西瓜', aliases: ['瓜', 'watermelon', '夏日'], glyph: '瓜', tone: '#D5DEA8', regions: [region('body',ellipse(256,272,128,132),'#C7D8A5'),region('stripe-left',curve([183,158],[[150,220,151,334,190,384],[172,300,176,220,204,148],[194,151,189,154,183,158]]),'#7B9E78'),region('stripe-right',curve([308,148],[[336,220,340,300,322,384],[361,334,362,220,329,158],[323,154,318,151,308,148]]),'#7B9E78')], details: [[[252,139],[251,117],[269,109],[283,117]]], faceY:266 },
  { id: 'strawberry', name: '草莓', aliases: ['莓', 'strawberry', '春日'], glyph:'莓', tone:'#E6B3A2', regions:[region('body',curve([256,151],[[145,101,112,206,145,287],[168,340,221,402,256,408],[291,402,344,340,367,287],[400,206,367,101,256,151]]),'#DC8F80'),region('crown',[[178,138],[217,133],[235,101],[256,135],[287,108],[292,140],[337,142],[297,171],[257,155],[218,173]],'#90A374')], seeds:[[185,214],[325,214],[172,266],[341,266],[192,322],[317,322],[224,357],[282,357]], faceY:267 },
  { id:'apple', name:'苹果', aliases:['apple','红富士','果'],glyph:'苹',tone:'#DE9A85',regions:[region('body',curve([256,168],[[199,125,114,157,123,267],[129,345,187,413,244,385],[256,380,257,380,269,385],[326,413,384,345,390,267],[399,157,313,125,256,168]]),'#D8917F'),region('leaf',leaf(272,143),'#9DAF7D')],details:[[[255,166],[254,137],[243,115]]],faceY:269},
  { id:'pear',name:'梨',aliases:['梨子','pear','酥梨'],glyph:'梨',tone:'#E4CF88',regions:[region('body',curve([256,130],[[206,122,215,195,171,238],[102,306,131,401,256,407],[381,401,410,306,341,238],[297,195,306,122,256,130]]),'#E2CF89'),region('leaf',leaf(276,132),'#99AD7E')],details:[[[255,134],[258,113],[273,101]]],faceY:295},
  { id:'grape',name:'葡萄',aliases:['葡','grapes','grape'],glyph:'葡',tone:'#B9B2CB',regions:[region('berry-1',ellipse(208,208,55,56),'#B7ADC8'),region('berry-2',ellipse(302,208,55,56),'#B7ADC8'),region('berry-3',ellipse(169,281,52,54),'#B7ADC8'),region('berry-4',ellipse(256,282,59,62),'#B7ADC8'),region('berry-5',ellipse(343,281,52,54),'#B7ADC8'),region('berry-6',ellipse(216,355,51,53),'#B7ADC8'),region('berry-7',ellipse(297,355,51,53),'#B7ADC8'),region('berry-8',ellipse(256,407,43,44),'#B7ADC8'),region('leaf',[[244,155],[210,116],[237,117],[246,84],[267,113],[298,93],[293,131],[315,143],[276,162]],'#A1B180')],details:[[[255,162],[269,126],[288,120]]],faceY:283},
  { id:'kiwi',name:'猕猴桃',aliases:['奇异果','kiwi','弥猴桃'],glyph:'弥',tone:'#BCCC95',regions:[region('skin',ellipse(256,274,132,138),'#B49A75'),region('flesh',ellipse(256,274,116,122),'#B5CA87'),region('core',ellipse(256,275,43,72),'#F2E6B6')],seeds:[[189,203],[218,180],[284,179],[318,200],[166,252],[174,299],[192,342],[230,364],[283,365],[322,341],[340,299],[344,249]],faceY:267}
];
module.exports = { templates, ellipse };
