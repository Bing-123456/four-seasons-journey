const companion = require('../../lib/companion');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const clone = value => JSON.parse(JSON.stringify(value));

// 定制水果解锁状态：未解锁的模板置灰，答对对应水果的农谚题后解锁。
function templatesWithLocks(query, unlocks) {
  return companion.searchTemplates(query).map(item => {
    const locked = unlocks.indexOf(item.id) === -1;
    const zh = i18n.getLang() !== 'en';
    return Object.assign({}, item, { locked, lockHint: zh ? i18n.t('companion_locked_hint') : 'Locked · answer its quiz' });
  });
}

Page({
  data:{templates:[],query:'',config:companion.defaultConfig(),palette:companion.PALETTE,color:'#234B3C',tool:'fill',penWidth:7,historyCount:0,strokeCount:0,dirty:false,previewing:false,saving:false,canvasReady:false,canvasError:'',partitionLabel:'',selectionHint:'',unlocks:['watermelon'],fruitName:'',L:{}},
  onLoad:function(options){ i18n.applyNav('companion_page_title');
    this._alive=true;this._partition=store.capturePartition();this._editor=companion.createEditor(store.getCompanion(this._partition));
    this._gate=options&&options.gate==='1';this.setData({selectionHint:i18n.t('companion_selection_hint')});
    this.refreshTemplates('');
    this.setData({config:this._editor.config,fruitName:this.fruitLabel(this._editor.config),partitionLabel:this._partition==='demo'?i18n.t('companion_demo'):i18n.t('companion_local'),L:i18n.labels(['companion_page_title','companion_pick','companion_paint','companion_preview','companion_search_ph','companion_rotate','companion_flip','companion_stepback','companion_undo_all','companion_default','companion_hint_fill','companion_gen_title','companion_gen_sub','companion_gen_pick','companion_gen_pick_again','companion_gen_run','companion_remove_photo','companion_gen_local_note','companion_save','companion_back','companion_locked_label','companion_lock_toast','companion_intro','companion_unlocked_suffix','companion_no_result','companion_paint_mode_fill','companion_paint_mode_brush','companion_paint_mode_preview','companion_reopen_canvas','companion_unsaved','companion_saved_state','companion_tool_fill','companion_tool_brush','companion_brush','companion_brush_thin','companion_brush_mid','companion_brush_thick','companion_hint_generated','companion_photo_chosen','companion_photo_tip','companion_craft_note','companion_preview_btn','companion_keep_editing','companion_saving','loading','comp_palette_aria','comp_search_aria','comp_canvas_aria','comp_color_aria'])});
    this.setData({ paintModeLabel: this.paintModeLabel() });
    this._apiClient = null;
  },
  paintModeLabel:function(){
    const zh = i18n.getLang() !== 'en';
    if (this.data.previewing) return i18n.t('companion_paint_mode_preview');
    if (this.data.tool === 'fill') return i18n.t('companion_paint_mode_fill');
    const strokes = this.data.strokeCount;
    return i18n.getLang() === 'en' ? 'Draw · ' + strokes + '/100' : '描画 · ' + strokes + '/100 笔';
  },
  fruitLabel:function(config){
    const templates = require('../../data/companion-templates').templates;
    if(config.kind==='generated-image'||config.kind==='photo') return i18n.getLang()==='en'?'My fruit buddy':'我的水果伙伴';
    const template = templates.find(item=>item.id===config.templateId);
    const nameKey='fruit_'+config.templateId;
    return template?(i18n.dict[nameKey]?i18n.t(nameKey):template.name):(i18n.getLang()==='en'?'Fruit':'水果');
  },
  refreshTemplates:function(query){
    const unlocks=store.getFruitUnlocks(this._partition);
    this.setData({templates:templatesWithLocks(query,unlocks),unlocks});
  },
  onReady:function(){this.initializeCanvas();},
  onPageScroll:function(){this.updateBounds();},
  onShow:function(){this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });if(this._canvas){this.updateBounds();this.draw();}},
  onHide:function(){this._stroke=null;this.stopDrawingFrame();},
  onUnload:function(){if(this._apiClient)this._apiClient.clear();this.stopDrawingFrame();this._alive=false;this._imageVersion=(this._imageVersion||0)+1;this._stroke=null;this._photoPath='';this._canvas=null;if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload({fail(){}});},
  initializeCanvas:function(){
    this.setData({canvasError:''});
    this.createSelectorQuery().select('#editor-canvas').fields({node:true,size:true,rect:true}).exec(results=>{
      if(!this._alive)return;
      try{const found=results&&results[0];if(!found||!found.node||!found.width)throw new Error(i18n.t('companion_canvas_fail'));this._canvas=found.node;this._canvas.width=512;this._canvas.height=512;this._ctx=this._canvas.getContext('2d');if(!this._ctx)throw new Error(i18n.t('companion_canvas_fail'));this._bounds=found;this.setData({canvasReady:true,canvasError:''});this.loadSourceAndRender();}
      catch(error){this.canvasFailed(error);}
    });
  },
  updateBounds:function(){this.createSelectorQuery().select('#editor-canvas').boundingClientRect(rect=>{if(this._alive&&rect)this._bounds=rect;}).exec();},
  canvasFailed:function(error){if(this._alive)this.setData({canvasReady:false,canvasError:(error&&error.message)||i18n.t('companion_canvas_retry')});},
  loadSourceAndRender:function(){
    const config=this._editor.config;this._sourceImage=null;
    if(config.kind!=='generated-image'&&config.kind!=='photo'){this.draw();return;}
    const version=this._imageVersion=(this._imageVersion||0)+1;const image=this._canvas.createImage();
    image.onload=()=>{if(this._alive&&version===this._imageVersion){this._sourceImage=image;this.setData({canvasReady:true,canvasError:''});this.draw();}};
    image.onerror=()=>{if(this._alive&&version===this._imageVersion)this.canvasFailed(new Error(i18n.t('companion_photo_stale')));};image.src=config.sourcePath||config.photoPath;
  },
  draw:function(){
    if(!this._ctx||!this._editor||!this.data.canvasReady)return;
    if(this._editor.config.kind!=='template'&&!this._sourceImage)return;
    try{const config=clone(this._editor.config);if(this._stroke&&this._stroke.points.length)config.strokes.push({color:this._stroke.color,width:this._stroke.width,points:companion.simplifyPoints(this._stroke.points)});companion.render(this._ctx,config,512,{image:this._sourceImage});}
    catch(error){this.canvasFailed(error);}
  },
  requestDraw:function(){if(this._frame)return;if(this._canvas&&this._canvas.requestAnimationFrame){this._frame=this._canvas.requestAnimationFrame(()=>{this._frame=null;if(this._alive)this.draw();});}else this.draw();},
  stopDrawingFrame:function(){if(this._frame&&this._canvas&&this._canvas.cancelAnimationFrame)this._canvas.cancelAnimationFrame(this._frame);this._frame=null;},
  syncEditor:function(){
    const dirty=companion.isDirty(this._editor);
    this.setData({config:clone(this._editor.config),dirty,strokeCount:this._editor.config.strokes.length,historyCount:this._editor.history.length,fruitName:this.fruitLabel(this._editor.config)});
    if(dirty!==this._alertEnabled){this._alertEnabled=dirty;if(dirty&&wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:i18n.t('companion_unsaved_body'),fail(){}});else if(!dirty&&wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload({fail(){}});}
    this.draw();
  },
  change:function(action){if(this.data.saving)return;try{this._editor=companion.applyAction(this._editor,action);this.syncEditor();}catch(error){wx.showToast({title:error.message,icon:'none'});}},
  queryChange:function(event){const query=event.detail.value;this.setData({query});this.refreshTemplates(query);},
  chooseTemplate:function(event){
    if(this.data.saving)return;
    const id=event.currentTarget.dataset.id;
    const locked=event.currentTarget.dataset.locked==='1';
    if(locked){const name=event.currentTarget.dataset.name||'';wx.showToast({title:i18n.t('companion_lock_toast',{name}),icon:'none'});return;}
    if(id===this._editor.config.templateId)return;
    const use=()=>{if(!this._alive)return;this._editor=companion.createEditor(companion.defaultConfig(id));this._editor.baseline=companion.createEditor(store.getCompanion(this._partition)).baseline;this._stroke=null;this._sourceImage=null;this._imageVersion=(this._imageVersion||0)+1;this.setData({previewing:false,tool:'fill',canvasReady:!!this._ctx,canvasError:''});this.syncEditor();};
    if(companion.isDirty(this._editor))wx.showModal({title:'更换水果模板？',content:i18n.t('companion_replace_body'),confirmText:i18n.t('companion_replace_ok'),success:result=>{if(result.confirm)use();}});else use();
  },
  chooseColor:function(event){if(!this.data.saving)this.setData({color:event.currentTarget.dataset.color});},
  chooseTool:function(event){if(this.data.saving)return;const tool=event.currentTarget.dataset.tool;if(tool==='fill'&&this._editor.config.kind!=='template'){wx.showToast({title:i18n.t('companion_gen_note'),icon:'none'});return;}this.setData({tool},()=>this.setData({paintModeLabel:this.paintModeLabel()}));},
  chooseWidth:function(event){this.setData({penWidth:Number(event.currentTarget.dataset.width)});},
  point:function(event){
    const touch=(event.touches&&event.touches[0])||(event.changedTouches&&event.changedTouches[0]);if(!touch||!this._bounds)return null;
    const bounds=this._bounds;const x=Number.isFinite(touch.x)?touch.x:touch.clientX-bounds.left;const y=Number.isFinite(touch.y)?touch.y:touch.clientY-bounds.top;
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    return [Math.max(0,Math.min(512,x/bounds.width*512)),Math.max(0,Math.min(512,y/bounds.height*512))];
  },
  touchStart:function(event){
    if(!this.data.canvasReady||this.data.saving||this.data.previewing)return;
    const p=this.point(event);if(!p)return;
    if(this.data.tool==='fill'){const id=companion.regionAt(this._editor.config,p);if(id)this.change({type:'fill',regionId:id,color:this.data.color});return;}
    if(this._editor.config.strokes.length>=companion.MAX_STROKES){wx.showToast({title:i18n.t('companion_stroke_cap'),icon:'none'});return;}
    const local=companion.toLocalPoint(p,this._editor.config.rotation,this._editor.config.flipped);
    this._stroke={color:this.data.color,width:this.data.penWidth,points:[local.map(n=>Math.max(0,Math.min(512,n)))]};this.draw();
  },
  touchMove:function(event){
    if(!this._stroke)return;const p=this.point(event);if(!p)return;
    const local=companion.toLocalPoint(p,this._editor.config.rotation,this._editor.config.flipped).map(n=>Math.max(0,Math.min(512,n)));const previous=this._stroke.points[this._stroke.points.length-1];
    if(Math.hypot(previous[0]-local[0],previous[1]-local[1])<1.2)return;
    this._stroke.points.push(local);if(this._stroke.points.length>512)this._stroke.points=companion.simplifyPoints(this._stroke.points);this.requestDraw();
  },
  touchEnd:function(event){if(!this._stroke)return;if(event)this.touchMove(event);const stroke=this._stroke;this._stroke=null;this.change(Object.assign({type:'stroke'},stroke));},
  touchCancel:function(){this._stroke=null;this.draw();},
  rotate:function(){this.change({type:'rotate'});},
  flip:function(){this.change({type:'flip'});},
  // 10.2 / P23④：填色模式同样可用。回退走通用撤销（撤销最后一次填色或描画）；
  // 清空在填色模式下恢复模板默认配色，在描画模式下清空全部笔迹。
  stepBack:function(){
    if(this.data.saving)return;
    this._stroke=null;
    if(this.data.tool==='fill'){if(!this._editor.history.length)return;this._editor=companion.undo(this._editor);this.syncEditor();return;}
    this.change({type:'step-back'});
  },
  undoAll:function(){if(this.data.saving)return;this._stroke=null;this.change({type:this.data.tool==='fill'?'clear-fills':'clear-strokes'});},
  reset:function(){if(this.data.saving)return;wx.showModal({title:i18n.t('companion_reset_title'),content:i18n.t('companion_reset_body'),confirmText:i18n.t('companion_reset_ok'),success:result=>{if(result.confirm&&this._alive)this.change({type:'reset'});}});},
  preview:function(){this.touchCancel();this.setData({previewing:!this.data.previewing},()=>this.setData({paintModeLabel:this.paintModeLabel()}));this.updateBounds();},
  save:function(){
    if(this.data.saving||!this.data.canvasReady)return Promise.resolve(false);
    this.touchEnd();const partition=this._partition;const config=clone(this._editor.config);const old=store.getCompanion(partition);let newPath='';
    this.setData({saving:true});this.draw();if(!this.data.canvasReady){this.setData({saving:false});return Promise.resolve(false);}
    return companion.savePreview(this._canvas,partition).then(path=>{newPath=path;if(!this._alive)throw new Error(i18n.t('companion_closed_unsaved'));config.previewPath=path;store.saveCompanion(config,partition);if(old.previewPath&&old.previewPath!==path)companion.removePreview(old.previewPath,partition);this._editor=companion.createEditor(config);this.syncEditor();this.refreshTemplates(this.data.query);wx.showToast({title:partition==='demo'?i18n.t('companion_saved_demo'):i18n.t('companion_saved'),icon:'success'});if(this._gate){setTimeout(()=>{wx.navigateBack({delta:1,fail(){}});},700);}return true;}).catch(error=>{if(newPath)companion.removePreview(newPath,partition);if(this._alive)wx.showToast({title:error.message||i18n.t('companion_save_fail'),icon:'none'});return false;}).finally(()=>{if(this._alive)this.setData({saving:false});});
  },
  leave:function(){
    const exit=()=>{if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload({fail(){}});wx.navigateBack({delta:1,fail(){wx.navigateTo({url:'/pages/mine/mine'});}});};
    if(companion.isDirty(this._editor))wx.showModal({title:i18n.t('companion_leave_title'),content:i18n.t('companion_leave_body'),confirmText:i18n.t('companion_leave_ok'),cancelText:i18n.t('companion_leave_stay'),success:result=>{if(result.confirm)exit();}});else exit();
  }
});
