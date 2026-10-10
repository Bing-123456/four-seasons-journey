'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const culture = require('../miniprogram/data/fruit-culture');
const quiz = require('../miniprogram/data/fruit-quiz');
const farm = require('../miniprogram/lib/farm');

test('core seasonal fruit groups follow the requested lists and preserve original deep links', () => {
  const expected = { spring:['青梅','桑葚','樱桃','枇杷'], summer:['桃子','李子','杏','荔枝','龙眼','黄皮','杨梅'], autumn:['秋梨','柿子','枣','猕猴桃','山楂'], winter:['砂糖橘','瓯柑','柚子','金桔'] };
  for (const [season,names] of Object.entries(expected)) assert.deepEqual(culture.fruitsForSeason(season).filter(f=>!f.world).map(f=>f.name).sort(),names.sort());
  for (const id of ['summer-watermelon','autumn-pomegranate','autumn-apple','winter-winter-jujube']) assert.equal(culture.findFruit(id).world,true,id);
  const jujube = culture.findFruit('autumn-jujube');
  assert.ok(jujube.categories.some(c=>/大枣/.test(c.detail)&&/酸枣/.test(c.detail)));
});
test('all 48 seasonal nodes have substantial distinct notes and honest story provenance', () => {
  const fruits = culture.seasons.flatMap(s=>culture.fruitsForSeason(s.id)); assert.equal(fruits.length,48);
  for (const fruit of fruits) {
    assert.equal(fruit.categories.length,6);
    for (const category of fruit.categories) {
      assert.ok(category.detail.length>=80, fruit.name+'/'+category.cat);
      assert.ok(category.sourceNote.length>10);
      if(category.cat==='story') { assert.equal(category.editorialType,'creative-story'); assert.doesNotMatch(category.detail,/【创作故事/); assert.match(category.sourceNote,/创作故事|虚构/); }
      for (const source of category.sources) {assert.match(source.url,/^https:\/\//);assert.ok(source.scope);}
    }
  }
});
test('six unique fruit unlock questions have sources, clear correct answers and English content', () => {
  for(const language of ['zh','en']){
    const round=quiz.buildRound('2026-09-26',language);assert.equal(round.length,6);assert.equal(new Set(round.map(q=>q.fruitId)).size,6);
    for(const question of round){assert.equal(question.options.filter(o=>o.correct).length,1);assert.ok(question.sourceTitle);assert.match(question.sourceUrl,/^https:\/\//); if(language==='en') assert.match(question.text,/[a-z]{3}/);}
  }
});
test('the first question is a watermelon proverb matching its unlock reward, with no grain ambiguity', () => {
  for (const language of ['zh','en']) {
    const round=quiz.buildRound('2026-09-26',language);
    assert.equal(round[0].fruitId,'watermelon');
    assert.equal(round[0].kind,'proverb');
    if (language==='zh') { assert.match(round[0].text,/西瓜|种瓜/); assert.doesNotMatch(round[0].text,/谷雨|点豆/); }
  }
});
test('quiz pool holds two distinct questions per fruit and replay rounds share no question', () => {
  assert.equal(quiz.QUIZ.length,12);
  const perFruit={};for(const q of quiz.QUIZ)perFruit[q.fruitId]=(perFruit[q.fruitId]||0)+1;
  for(const count of Object.values(perFruit))assert.equal(count,2);
  for(const language of ['zh','en']){
    const first=quiz.buildRound(null,language);
    const second=quiz.buildRound({askedIds:first.map(q=>q.id)},language);
    assert.equal(second.length,6);
    assert.equal(new Set(second.map(q=>q.id)).size,6,'复轮 6 道题 id 各不相同');
    assert.equal(first.filter(q=>second.some(s=>s.id===q.id)).length,0,'两轮不得有同一道题');
    // 10.5 游戏③ + 2026-10-08 用户规则：西瓜默认拥有（计数一开始就是 1/6、答对不弹解锁窗），
    // 但它的题要出到"答对一次"为止；答对过才把这一格让给别的水果。
    const allUnlocked=quiz.buildRound({unlocked:['watermelon','strawberry','apple','pear','grape','kiwi'],starterPassed:true,askedIds:[]},language);
    assert.equal(allUnlocked.length,6,'名额由非定制水果题补齐');
    assert.equal(allUnlocked.every(q=>q.fruitId===undefined),true,'起始水果答对且六果全解锁后，整轮都是非定制水果的题');
    // 只解锁西瓜、且西瓜题还没答对：西瓜占一道 + 另外五种各一道
    const partial=quiz.buildRound({unlocked:['watermelon'],askedIds:[]},language);
    assert.equal(partial.length,6);
    assert.equal(partial.filter(q=>q.fruitId).length,6,'六种水果各出一道');
    assert.equal(partial.filter(q=>q.fruitId==='watermelon').length,1,'西瓜题必须出（默认拥有，但还没答对过）');
    // 答对过之后：西瓜不再出题（这一格让位）
    const afterStarter=quiz.buildRound({unlocked:['watermelon'],starterPassed:true,askedIds:[]},language);
    assert.equal(afterStarter.filter(q=>q.fruitId==='watermelon').length,0,'答对过的西瓜不再出题');
  }
});
test('farm day boundaries use local dates, including midnight and daylight-saving transitions', () => {
  const script=`const f=require('./miniprogram/lib/farm');console.log(JSON.stringify([f.today('2026-09-26T00:30:00'),f.yesterday('2026-03-09'),f.daysBetween('2026-03-08','2026-03-09')]));`;
  for (const tz of ['Asia/Shanghai','America/New_York']) assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TZ:tz}}).toString()),['2026-09-26','2026-03-08',1]);
});
test('farm calendar deduplicates old dates and fruit appears only after 30 actual watering days', () => {
  const state=farm._normalize({crop:'watermelon',totalWatered:999,wateredDates:['2026-09-20','2026-09-20','2026-02-31','2026-09-21'],lastWateredDate:'2026-09-21'},'2026-09-21');
  assert.equal(state.totalWatered,2);assert.equal(state.streak,2);
  assert.notEqual(farm.stageOf(29).key,'fruit');assert.equal(farm.stageOf(30).key,'fruit');
  let definition;const previous=global.Component;global.Component=v=>{definition=v;};require('../miniprogram/components/farm-plant/farm-plant');global.Component=previous;
  let data={};const page={setData(p){Object.assign(data,p);}};
  definition.observers['crop,days'].call(page,'apple',0);assert.equal(data.stage,0);assert.equal(data.form,'tree');const initial=data.scale;
  definition.observers['crop,days'].call(page,'apple',1);assert.ok(data.scale>initial);
  definition.observers['crop,days'].call(page,'apple',30);assert.equal(data.stage,5);
});
test('cultural favourites open the exact note while remove uses a separate event', () => {
  let page,opened='';const oldPage=global.Page,oldWx=global.wx;global.Page=v=>{page=v;};global.wx={navigateTo:o=>{opened=o.url;}};
  try { delete require.cache[require.resolve('../miniprogram/pages/favorites/favorites')];require('../miniprogram/pages/favorites/favorites');page.openKnowledge({currentTarget:{dataset:{id:'autumn-jujube:history'}}});assert.equal(opened,'/packageMore/fruit-note/fruit-note?fruit=autumn-jujube&cat=history');page.openKnowledge({currentTarget:{dataset:{id:'missing:bad'}}});assert.equal(opened,'/packageMore/fruit-note/fruit-note?fruit=autumn-jujube&cat=history'); }
  finally {global.Page=oldPage;global.wx=oldWx;}
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/favorites/favorites.wxml'),'utf8');assert.match(markup,/catchtap="removeKnowledge"/);assert.match(markup,/bindtap="openKnowledge"/);
});
