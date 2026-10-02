'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const c=require('../miniprogram/lib/companion');
function view(config,options){
  options=options||{};let definition=options.definition;
  if(!definition){const before=global.Component;global.Component=value=>definition=value;const file=path.resolve(__dirname,'../miniprogram/components/companion-view/companion-view.js');delete require.cache[file];require(file);global.Component=before;}
  const calls={clears:0,events:[],image:null,exports:0};const ctx=new Proxy({clearRect(){calls.clears++;}},{get(target,key){return target[key]||(()=>{});},set(target,key,value){target[key]=value;return true;}});
  const canvas={getContext(){if(options.brokenContext)throw Error('canvas unavailable');return ctx;},createImage(){calls.image={};return calls.image;}};
  if(options.tempFile)canvas.toTempFilePath=opts=>{calls.exports++;if(options.tempFileFails)opts.fail({errMsg:'toTempFilePath:fail'});else opts.success({tempFilePath:'wxfile://tmp/companion.png'});};
  const subject=Object.assign({},definition.methods,{data:{...definition.data,config,animated:true,size:420},setData(value){Object.assign(this.data,value);},triggerEvent(name){calls.events.push(name);},createSelectorQuery(){return {select(){return this;},fields(){return this;},exec(callback){callback([{node:canvas}]);}};}});
  return{definition,subject,calls,ready:()=>definition.lifetimes.ready.call(subject),hide:()=>definition.pageLifetimes.hide.call(subject),detach:()=>definition.lifetimes.detached.call(subject)};
}
function usingWx(api,callback){const before=global.wx;global.wx=api;try{return callback();}finally{global.wx=before;}}
test('greeting waves for upright, rotated and mirrored template and stops on page hide',()=>{
  for(const rotation of [0,90,180,270])for(const flipped of [false,true]){const testView=view({...c.defaultConfig(),rotation,flipped});testView.ready();assert.equal(testView.subject.data.wave,true);testView.hide();assert.equal(testView.subject.data.wave,false);assert.equal(testView.subject.data.motionActive,false);}
});
test('generated image displays immediate default while loading and safely handles disappearance',()=>{
  const testView=view({...c.defaultConfig(),kind:'generated-image',sourcePath:'wxfile://usr/companions/personal/source.png'});testView.ready();assert.equal(testView.calls.clears,1);assert.equal(testView.subject.data.failed,false);assert.ok(testView.calls.image);testView.calls.image.onerror();assert.equal(testView.subject.data.failed,false);assert.equal(testView.calls.clears,2);
  testView.detach();testView.calls.image.onload();assert.equal(testView.calls.clears,2);
});
test('canvas context failure degrades to CSS default fruit without throwing or blocking welcome',()=>{const testView=view(c.defaultConfig(),{brokenContext:true});assert.doesNotThrow(testView.ready);assert.equal(testView.subject.data.failed,true);assert.deepEqual(testView.calls.events,['rendererror']);});
test('painted companion exports a temp image so display does not rely on the canvas layer',()=>{
  const testView=view(c.defaultConfig(),{tempFile:true});testView.ready();
  assert.equal(testView.subject.data.imagePath,'wxfile://tmp/companion.png');assert.equal(testView.calls.exports,1);
  testView.subject.paint();assert.equal(testView.calls.exports,2,'config 或重绘后应再次导出');
});
test('native Canvas 2D exports through wx.canvasToTempFilePath without an instance export method',()=>{
  const requests=[];
  usingWx({canvasToTempFilePath(options,scope){requests.push({options,scope});options.success({tempFilePath:'wxfile://tmp/native-companion.png'});}},()=>{
    const testView=view(c.defaultConfig());testView.ready();
    assert.equal(typeof testView.subject._canvas.toTempFilePath,'undefined');
    assert.equal(testView.subject.data.imagePath,'wxfile://tmp/native-companion.png');
    assert.equal(requests.length,1);assert.equal(requests[0].options.canvas,testView.subject._canvas);assert.equal(requests[0].scope,testView.subject);
    assert.equal(requests[0].options.fileType,'png');
    testView.subject.paint();assert.equal(requests.length,2);
  });
});
test('native export is preferred when both platform and instance methods exist',()=>{
  usingWx({canvasToTempFilePath(options){options.success({tempFilePath:'wxfile://tmp/platform.png'});}},()=>{
    const testView=view(c.defaultConfig(),{tempFile:true});testView.ready();
    assert.equal(testView.subject.data.imagePath,'wxfile://tmp/platform.png');assert.equal(testView.calls.exports,0);
  });
});
test('slower placeholder export cannot overwrite a loaded generated fruit image',()=>{
  const pending=[];
  usingWx({canvasToTempFilePath(options){pending.push(options);}},()=>{
    const testView=view({...c.defaultConfig(),kind:'generated-image',sourcePath:'wxfile://usr/companions/personal/source.png'});testView.ready();
    testView.calls.image.onload();assert.equal(pending.length,2);
    pending[1].success({tempFilePath:'wxfile://tmp/generated.png'});
    pending[0].success({tempFilePath:'wxfile://tmp/placeholder.png'});
    assert.equal(testView.subject.data.imagePath,'wxfile://tmp/generated.png');
  });
});
test('late exports from previous paints or detached components are ignored',()=>{
  const pending=[];
  usingWx({canvasToTempFilePath(options){pending.push(options);}},()=>{
    const testView=view(c.defaultConfig());testView.ready();testView.subject.paint();
    pending[0].success({tempFilePath:'wxfile://tmp/old.png'});assert.equal(testView.subject.data.imagePath,'');
    testView.detach();pending[1].success({tempFilePath:'wxfile://tmp/detached.png'});assert.equal(testView.subject.data.imagePath,'');
  });
});
test('native export failure preserves the last successfully displayed image',()=>{
  const pending=[];
  usingWx({canvasToTempFilePath(options){pending.push(options);}},()=>{
    const testView=view(c.defaultConfig());testView.ready();pending[0].success({tempFilePath:'wxfile://tmp/previous.png'});
    testView.subject.paint();pending[1].fail({errMsg:'canvasToTempFilePath:fail'});
    assert.equal(testView.subject.data.imagePath,'wxfile://tmp/previous.png');assert.equal(testView.subject.data.failed,false);
  });
});
test('without export support the view keeps the canvas fallback and never throws',()=>{
  const testView=view(c.defaultConfig(),{});assert.doesNotThrow(testView.ready);
  assert.equal(testView.subject.data.imagePath,'');assert.equal(testView.subject.data.failed,false);
});
test('failed export keeps the previous display instead of blanking',()=>{
  const testView=view(c.defaultConfig(),{tempFile:true,tempFileFails:true});testView.ready();
  assert.equal(testView.subject.data.imagePath,'');assert.equal(testView.subject.data.failed,false);
});
test('preview deletion cannot escape captured partition directory',()=>{
  const before=global.wx;const deleted=[];global.wx={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({unlink:({filePath})=>deleted.push(filePath)})};
  try{c.removePreview('wxfile://usr/companions/personal/../../private.png','personal');c.removePreview('wxfile://usr/companions/demo/abc-123.png','personal');c.removePreview('wxfile://usr/companions/personal/abc-123.png','personal');assert.deepEqual(deleted,['wxfile://usr/companions/personal/abc-123.png']);}finally{global.wx=before;}
});

function previewPlatform(){
  const files=new Set(),exports=[];let deletes=0;
  return{files,exports,get deletes(){return deletes;},api:{
    getFileSystemManager:()=>({accessSync(file){if(!files.has(file))throw Error('missing preview');},unlink(){deletes++;}}),
    canvasToTempFilePath(options){const file='wxfile://tmp/cache-'+exports.length+'.png';exports.push(file);files.add(file);options.success({tempFilePath:file});}
  }};
}
test('identical previews survive refresh and reattachment without extra PNG exports',()=>{
  const platform=previewPlatform();usingWx(platform.api,()=>{
    const first=view(c.defaultConfig());first.ready();
    first.subject.data.config.name='新名字';first.subject.paint();
    assert.equal(platform.exports.length,1,'nonvisual names do not invalidate a preview');
    const file=first.subject.data.imagePath;first.detach();
    const next=view(c.defaultConfig(),{definition:first.definition});next.ready();
    assert.equal(next.subject.data.imagePath,file);assert.equal(next.calls.clears,0);assert.equal(platform.exports.length,1);
    next.subject.data.config.rotation=90;next.subject.paint();assert.equal(platform.exports.length,2);
    next.subject.data.animated=false;next.subject.paint();assert.equal(platform.exports.length,3,'static and waving arms need different previews');
    assert.equal(platform.deletes,0,'the cache never deletes a displayed or user-owned file');
  });
});
test('a reclaimed temporary preview is exported again instead of showing a stale file',()=>{
  const platform=previewPlatform();usingWx(platform.api,()=>{
    const first=view(c.defaultConfig());first.ready();const old=first.subject.data.imagePath;
    platform.files.delete(old);first.subject.paint();
    assert.equal(platform.exports.length,2);assert.notEqual(first.subject.data.imagePath,old);
  });
});
test('preview cache is bounded and evicts old variants without deleting files',()=>{
  const platform=previewPlatform();usingWx(platform.api,()=>{
    const configFor=index=>{const config=c.defaultConfig();config.colors[Object.keys(config.colors)[0]]='#'+index.toString(16).padStart(6,'0');return config;};
    const first=view(configFor(0));first.ready();
    for(let i=1;i<40;i++)view(configFor(i),{definition:first.definition}).ready();
    view(configFor(0),{definition:first.definition}).ready();
    assert.equal(platform.exports.length,41,'oldest variant must have left the bounded cache');
    assert.equal(platform.deletes,0);
  });
});
test('generated image cache reuses the finished artwork, never its loading placeholder',()=>{
  const platform=previewPlatform();usingWx(platform.api,()=>{
    const config={...c.defaultConfig(),kind:'generated-image',sourcePath:'wxfile://usr/companions/personal/source.png'};
    const first=view(config);first.ready();const placeholder=first.subject.data.imagePath;
    first.calls.image.onload();const finished=first.subject.data.imagePath;assert.notEqual(finished,placeholder);
    const next=view(config,{definition:first.definition});next.ready();
    assert.equal(next.subject.data.imagePath,finished);assert.equal(next.calls.image,null);assert.equal(platform.exports.length,2);
  });
});
