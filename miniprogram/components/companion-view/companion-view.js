const companion = require('../../lib/companion');
const previewCache = new Map();
const MAX_CACHED_PREVIEWS = 16;
function previewExists(filePath) {
  try {
    if (!filePath || typeof wx === 'undefined' || !wx.getFileSystemManager) return false;
    wx.getFileSystemManager().accessSync(filePath);
    return true;
  } catch (error) { return false; }
}
function previewKey(config, wave) {
  const rendered = Object.assign({}, config);
  delete rendered.name; delete rendered.previewPath;
  return JSON.stringify([wave, rendered]);
}
function cachedPreview(key) {
  const filePath = previewCache.get(key);
  previewCache.delete(key);
  if (!previewExists(filePath)) return '';
  previewCache.set(key, filePath);
  return filePath;
}
function rememberPreview(key, filePath) {
  if (!key || !previewExists(filePath)) return;
  previewCache.delete(key); previewCache.set(key, filePath);
  while (previewCache.size > MAX_CACHED_PREVIEWS) previewCache.delete(previewCache.keys().next().value);
}
Component({
  properties:{config:{type:Object,value:null},animated:{type:Boolean,value:false},size:{type:Number,value:240}},
  data:{failed:false,wave:false,motionActive:true,imagePath:''},
  observers:{'config, animated':function(){if(this._canvas)this.paint();}},
  lifetimes:{
    ready:function(){this._alive=true;try{this.createSelectorQuery().select('#companion-display').fields({node:true,size:true}).exec(result=>{if(!this._alive)return;try{const found=result&&result[0];if(!found||!found.node)throw new Error('画布不可用');this._canvas=found.node;this._canvas.width=512;this._canvas.height=512;this.paint();}catch(error){this.fallback(this._canvas);}});}catch(error){this.fallback(this._canvas);}},
    detached:function(){this._alive=false;this._paintVersion=(this._paintVersion||0)+1;this._canvas=null;}
  },
  pageLifetimes:{hide:function(){this.setData({motionActive:false,wave:false});}},
  methods:{
    onPhotoError:function(){this.setData({failed:true});},
    paint:function(){
      if(!this._canvas)return;const canvas=this._canvas;const version=this._paintVersion=(this._paintVersion||0)+1;
      let config;try{config=companion.normalizeConfig(this.data.config);}catch(error){config=companion.defaultConfig();}
      if(config.kind==='photo'){this.setData({failed:false,wave:false,imagePath:''});return;}
      const wave=this.data.animated&&this.data.motionActive&&config.kind==='template';
      const key=previewKey(config,wave),cached=cachedPreview(key);
      if(cached){this.setData({failed:false,wave,imagePath:cached});return;}
      const draw=image=>{if(!this._alive||version!==this._paintVersion)return;try{companion.render(canvas.getContext('2d'),config,512,{image,hideWaveArm:wave});this.setData({failed:false,wave});this.exportImage(version,key);}catch(error){this.fallback(canvas);}};
      if(config.kind==='generated-image'){
        // A welcome screen never waits on a missing or slow local image.
        try{companion.render(canvas.getContext('2d'),companion.defaultConfig(),512);this.setData({failed:false,wave:false});this.exportImage(version);const image=canvas.createImage();image.onload=()=>draw(image);image.onerror=()=>{if(this._alive&&version===this._paintVersion)this.fallback(canvas);};image.src=config.sourcePath;}catch(error){this.fallback(canvas);}
      }else draw();
    },
    // canvas 2d 的原生层在滚动或布局变化后容易出现内容错位、漂移（头像“跑”到页面别处）。
    // 画完立即导出临时 PNG，改用普通 <image> 展示；导出失败或环境不支持时保留 canvas 兜底。
    exportImage:function(version,key){
      const canvas=this._canvas;
      if(!canvas)return;
      const exportVersion=this._exportVersion=(this._exportVersion||0)+1;
      const options={x:0,y:0,width:512,height:512,destWidth:512,destHeight:512,fileType:'png',success:res=>{
        if(this._alive&&version===(this._paintVersion||0)&&exportVersion===this._exportVersion&&res&&res.tempFilePath){rememberPreview(key,res.tempFilePath);this.setData({imagePath:res.tempFilePath});}
      },fail:()=>{}};
      try{
        if(typeof wx!=='undefined'&&typeof wx.canvasToTempFilePath==='function')wx.canvasToTempFilePath(Object.assign({canvas},options),this);
        else if(typeof canvas.toTempFilePath==='function')canvas.toTempFilePath(options);
      }catch(error){}
    },
    fallback:function(canvas){try{companion.render(canvas.getContext('2d'),companion.defaultConfig(),512);this.setData({failed:false,wave:false});this.exportImage(this._paintVersion||0);}catch(error){this.setData({failed:true,wave:false});}this.triggerEvent('rendererror');}
  }
});
