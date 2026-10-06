'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const c=require('../miniprogram/lib/companion');
const store=require('../miniprogram/lib/store');
const clone=value=>JSON.parse(JSON.stringify(value));
const originalWx=global.wx,originalPage=global.Page;
let calls,memory,copyFailure,storageFailure,pendingCopy,asyncCopy;
const event=(dataset,value)=>({currentTarget:{dataset:dataset||{}},detail:{value}});
function context(){return new Proxy({}, {get(target,key){return target[key]||(()=>{});},set(target,key,value){target[key]=value;return true;}});}
function page(){let definition;global.Page=value=>definition=value;const file=path.resolve(__dirname,'../miniprogram/pages/companion/companion.js');delete require.cache[file];require(file);const subject=Object.assign({},definition,{data:clone(definition.data),setData(value){Object.assign(this.data,value);}});subject.onLoad();subject._canvas={getContext:()=>context()};subject._ctx=context();subject._bounds={left:0,top:0,width:512,height:512};subject.data.canvasReady=true;return subject;}
test.beforeEach(()=>{
  calls={network:0,uploads:0,modals:[],toasts:[],deleted:[],exports:[],enabled:0};memory=new Map();copyFailure=false;storageFailure=false;pendingCopy=null;asyncCopy=false;
  global.wx={env:{USER_DATA_PATH:'wxfile://usr'},getStorageSync:key=>memory.get(key),setStorageSync(key,value){if(storageFailure)throw Error('disk full');memory.set(key,clone(value));},removeStorageSync:key=>memory.delete(key),showToast:value=>calls.toasts.push(value),showModal:value=>{calls.modals.push(value);value.success({confirm:true});},enableAlertBeforeUnload(){calls.enabled++;},disableAlertBeforeUnload(){},request(){calls.network++;throw Error('must not access network');},uploadFile(){calls.uploads++;throw Error('must not upload');},canvasToTempFilePath(options){calls.exports.push(options);options.success({tempFilePath:'wxfile://temp/preview.png'});},getFileSystemManager(){return{accessSync(){},mkdirSync(){},copyFile(options){if(asyncCopy){pendingCopy=options;return;}if(copyFailure)options.fail();else options.success();},unlink(options){calls.deleted.push(options.filePath);}};},navigateBack(){calls.back=true;}};
  store.exitDemo();store.clearAll();
});
test.after(()=>{global.wx=originalWx;global.Page=originalPage;});
test('rotated mirrored canvas maps freehand points back into artwork coordinates',()=>{
  const subject=page();subject.rotate();subject.flip();subject.data.tool='brush';const p=c.toViewPoint([120,200],90,true);subject.touchStart({touches:[{x:p[0],y:p[1]}]});subject.touchEnd();assert.equal(subject.data.strokeCount,1);assert.ok(Math.abs(subject._editor.config.strokes[0].points[0][0]-120)<1e-9);assert.ok(Math.abs(subject._editor.config.strokes[0].points[0][1]-200)<1e-9);assert.ok(subject.data.dirty);assert.ok(calls.enabled);
  subject.stepBack();assert.equal(subject.data.strokeCount,0);
});
test('dirty template switching and leaving are confirmed; fresh editor can leave directly',()=>{
  const subject=page();subject.chooseTemplate(event({id:'apple'}));assert.equal(calls.modals.length,0);assert.equal(subject.data.config.templateId,'apple');subject.chooseTemplate(event({id:'pear'}));assert.equal(calls.modals.length,1);subject.leave();assert.equal(calls.modals.length,2);assert.equal(calls.back,true);
});
test('preview and storage failure preserve edits and old saved companion',async()=>{
  const subject=page();subject.rotate();copyFailure=true;assert.equal(await subject.save(),false);assert.equal(subject.data.dirty,true);assert.equal(store.getCompanion().rotation,0);
  copyFailure=false;storageFailure=true;assert.equal(await subject.save(),false);assert.equal(subject.data.dirty,true);assert.equal(calls.deleted.length,1);storageFailure=false;
  assert.equal(await subject.save(),true);assert.equal(subject.data.dirty,false);assert.equal(store.getCompanion().rotation,90);assert.match(store.getCompanion().previewPath,/companions\/personal\//);assert.equal(calls.exports[0].destWidth,512);
});
test('an asynchronous personal save remains personal when active account changes',async()=>{
  const subject=page();subject.chooseTemplate(event({id:'kiwi'}));asyncCopy=true;const saved=subject.save();store.enterDemo();pendingCopy.success();assert.equal(await saved,true);assert.equal(store.getCompanion('personal').templateId,'kiwi');assert.notEqual(store.getCompanion('demo').templateId,'kiwi');assert.match(store.getCompanion('personal').previewPath,/personal/);
});
test('unload during export discards only new preview and does not overwrite persisted artwork',async()=>{
  const subject=page();subject.rotate();asyncCopy=true;const saved=subject.save();subject.onUnload();pendingCopy.success();assert.equal(await saved,false);assert.equal(store.getCompanion().rotation,0);assert.equal(calls.deleted.length,1);
});
test('missing canvas reports recovery without destroying unsaved config',()=>{
  const subject=page();subject.rotate();subject.createSelectorQuery=()=>({select(){return this;},fields(){return this;},exec(callback){callback([null]);}});subject.initializeCanvas();assert.equal(subject.data.canvasReady,false);assert.match(subject.data.canvasError,/画布/);assert.equal(subject._editor.config.rotation,90);
  subject.createSelectorQuery=()=>({select(){return this;},fields(){return this;},exec(callback){callback([{node:{getContext:()=>context()},width:512,height:512}]);}});subject.initializeCanvas();assert.equal(subject.data.canvasReady,true);assert.equal(subject._editor.config.rotation,90);
});
