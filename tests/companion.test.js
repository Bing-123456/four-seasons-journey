'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../miniprogram/lib/companion');
const {templates}=require('../miniprogram/data/companion-templates');
const stroke=(points)=>({type:'stroke',color:'#1F2B25',width:7,points:points||[[100,100],[110,150]]});
test('six original fruit templates have independent default state and searchable aliases',()=>{
  assert.equal(templates.length,6);assert.equal(new Set(templates.map(t=>t.id)).size,6);
  templates.forEach(t=>{const config=c.defaultConfig(t.id);assert.equal(c.normalizeConfig(config).templateId,t.id);assert.ok(t.regions.length);t.regions.forEach(r=>assert.ok(r.polygon.length>=3));});
  assert.equal(c.searchTemplates('奇异果')[0].id,'kiwi');assert.equal(c.searchTemplates('西瓜')[0].id,'watermelon');assert.equal(c.searchTemplates(' WateRmelon ')[0].id,'watermelon');assert.deepEqual(c.searchTemplates('榴莲'),[]);
  const first=c.defaultConfig();first.colors.body='#FFFFFF';assert.notEqual(c.defaultConfig().colors.body,'#FFFFFF');
});
test('transform inverse preserves touch position for every rotation and mirror combination',()=>{
  for(const angle of [0,90,180,270])for(const flipped of [false,true])for(const point of [[0,0],[512,512],[174,236],[256,256]]){
    const restored=c.toLocalPoint(c.toViewPoint(point,angle,flipped),angle,flipped);
    point.forEach((n,i)=>assert.ok(Math.abs(n-restored[i])<1e-9));
  }
  const config=c.defaultConfig();config.rotation=90;config.flipped=true;
  assert.equal(c.regionAt(config,c.toViewPoint([256,270],90,true)),'body');
  assert.equal(c.regionAt(config,[0,0]),null);
});
test('undo covers fill, a whole stroke and transforms; reset affects current template and preserves name',()=>{
  let editor=c.createEditor(c.defaultConfig('pear'));assert.equal(c.isDirty(editor),false);
  editor=c.applyAction(editor,{type:'fill',regionId:'body',color:'#FFFFFF'});editor=c.applyAction(editor,stroke());editor=c.applyAction(editor,{type:'rotate'});editor=c.applyAction(editor,{type:'flip'});
  assert.equal(editor.config.flipped,true);editor=c.undo(editor);assert.equal(editor.config.flipped,false);editor=c.undo(editor);assert.equal(editor.config.rotation,0);editor=c.undo(editor);assert.equal(editor.config.strokes.length,0);editor=c.undo(editor);assert.equal(c.isDirty(editor),false);
  editor=c.applyAction(editor,{type:'name',value:'梨小满'});editor=c.applyAction(editor,stroke());editor=c.reset(editor);assert.equal(editor.config.name,'梨小满');assert.equal(editor.config.templateId,'pear');assert.equal(editor.config.strokes.length,0);assert.equal(c.undo(editor).config.strokes.length,1);
});
test('history and drawing limits preserve already authored work',()=>{
  let editor=c.createEditor(c.defaultConfig());for(let i=0;i<40;i++)editor=c.applyAction(editor,{type:'fill',regionId:'body',color:i%2?'#234B3C':'#FFFFFF'});assert.equal(editor.history.length,30);
  const points=Array.from({length:1000},(_,i)=>[i/999*512,256]);editor=c.applyAction(editor,stroke(points));assert.equal(editor.config.strokes[0].points.length,256);assert.deepEqual(editor.config.strokes[0].points[0],points[0]);assert.deepEqual(editor.config.strokes[0].points[255],points[999]);
  for(let i=1;i<100;i++)editor=c.applyAction(editor,stroke());const before=JSON.stringify(editor.config);assert.throws(()=>c.applyAction(editor,stroke()),/100/);assert.equal(JSON.stringify(editor.config),before);
});
test('persistent config rejects corrupt and unbounded drawings and remote generated images',()=>{
  assert.throws(()=>c.normalizeConfig({}),/类型/);assert.throws(()=>c.defaultConfig('unknown'),/没有收录/);
  assert.throws(()=>c.normalizeConfig({...c.defaultConfig(),rotation:45}),/方向/);
  assert.throws(()=>c.normalizeConfig({...c.defaultConfig(),colors:{body:'red'}}),/颜色/);
  assert.throws(()=>c.normalizeConfig({...c.defaultConfig(),name:'a'.repeat(17)}),/16/);
  assert.throws(()=>c.normalizeConfig({...c.defaultConfig(),strokes:[{color:'#123456',width:7,points:[[Infinity,1]]}]}),/描画/);
  assert.throws(()=>c.normalizeConfig({...c.defaultConfig(),kind:'generated-image',sourcePath:'https://invalid.test/a.png'}),/本机/);
});
test('render rebuilds template with no preview cache or network dependency',()=>{
  let fills=0;const ctx=new Proxy({fill(){fills++;}},{get(target,key){if(key in target)return target[key];return ()=>{};}});
  templates.forEach(t=>c.render(ctx,{...c.defaultConfig(t.id),previewPath:'/missing.png'},512));assert.ok(fills>30);
});
