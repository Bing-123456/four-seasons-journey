'use strict';
const { templates } = require('../data/companion-templates');
const SIZE = 512;
const MAX_STROKES = 100;
const MAX_POINTS = 256;
const PALETTE = ['#234B3C','#1F2B25','#FFFFFF','#F6EAC8','#D6DBA6','#8FAB7D','#D8917F','#E1B258','#B5A7CA','#86AFB7'];
const clone = value => JSON.parse(JSON.stringify(value));
const templateById = id => templates.find(item => item.id === id);
const colorValid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
function defaultConfig(id) {
  const template = templateById(id || 'watermelon');
  if (!template) throw new Error('这个水果模板还没有收录');
  return { kind:'template', templateId:template.id, templateVersion:1, colors:Object.fromEntries(template.regions.map(r => [r.id,r.color])), strokes:[], rotation:0, flipped:false, name:'小' + template.name, previewPath:'' };
}
function normalizeConfig(value) {
  if (!value) return defaultConfig();
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('伙伴资料格式不正确');
  const kind = value.kind;
  if (!['template','generated-image','photo'].includes(kind)) throw new Error('伙伴类型不正确');
  const template = kind === 'template' ? templateById(value.templateId) : null;
  if (kind === 'photo') value = Object.assign({ rotation: 0, flipped: false, strokes: [], name: '我的拍照伙伴' }, value);
  if (kind === 'template' && (!template || value.templateVersion !== 1)) throw new Error('暂不支持这个水果模板版本');
  if (![0,90,180,270].includes(value.rotation) || typeof value.flipped !== 'boolean') throw new Error('伙伴方向不正确');
  if (!Array.isArray(value.strokes) || value.strokes.length > MAX_STROKES) throw new Error('最多保留 100 笔描画');
  const strokes = value.strokes.map(stroke => {
    if (!stroke || !colorValid(stroke.color) || ![3,7,13].includes(stroke.width) || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > MAX_POINTS || stroke.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > SIZE))) throw new Error('描画数据不正确');
    return { color:stroke.color.toUpperCase(),width:stroke.width,points:clone(stroke.points) };
  });
  const name = value.name === undefined ? '' : value.name;
  if (typeof name !== 'string' || Array.from(name.trim()).length > 16) throw new Error('伙伴名字最多 16 个字');
  const result = { kind,templateId:template ? template.id : '',templateVersion:1,colors:{},strokes,rotation:value.rotation,flipped:value.flipped,name:name.trim() || '我的水果伙伴',previewPath:'' };
  if (template) {
    if (!value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors)) throw new Error('伙伴配色格式不正确');
    template.regions.forEach(region => { const color = value.colors[region.id] || region.color; if (!colorValid(color)) throw new Error('颜色格式不正确'); result.colors[region.id] = color.toUpperCase(); });
  } else if (kind === 'photo') {
    if (typeof value.photoPath !== 'string' || !value.photoPath || value.photoPath.length > 1200 || /^https?:/i.test(value.photoPath)) throw new Error('拍照头像需要本机图片');
    result.photoPath = value.photoPath;
  } else {
    if (typeof value.sourcePath !== 'string' || !value.sourcePath || value.sourcePath.length > 1200 || /^https?:/i.test(value.sourcePath)) throw new Error('生成作品需要已保存的本机图片');
    result.sourcePath = value.sourcePath;
  }
  if (typeof value.previewPath === 'string' && value.previewPath.length <= 1200 && !/^https?:/i.test(value.previewPath)) result.previewPath = value.previewPath;
  return result;
}
function searchTemplates(query) {
  const needle = String(query || '').trim().toLowerCase();
  return templates.filter(t => !needle || [t.name,t.id].concat(t.aliases).some(term => term.toLowerCase().includes(needle))).map(t => ({id:t.id,name:t.name,tone:t.tone,glyph:t.glyph,config:defaultConfig(t.id)}));
}
function signature(config) { const value = normalizeConfig(config); delete value.previewPath; return JSON.stringify(value); }
function createEditor(config) { const value = normalizeConfig(config); return { config:value,history:[],baseline:signature(value) }; }
function isDirty(editor) { return signature(editor.config) !== editor.baseline; }
function changed(editor, config) {
  const normalized = normalizeConfig(config);
  if (signature(normalized) === signature(editor.config)) return editor;
  return {config:normalized,history:editor.history.concat([clone(editor.config)]).slice(-30),baseline:editor.baseline};
}
function simplifyPoints(points) {
  if (points.length <= MAX_POINTS) return clone(points);
  return Array.from({length:MAX_POINTS},(_,i) => points[Math.round(i*(points.length-1)/(MAX_POINTS-1))].slice());
}
function applyAction(editor, action) {
  const next = clone(editor.config);
  if (action.type === 'fill') {
    const template = templateById(next.templateId);
    if (next.kind !== 'template' || !template.regions.some(r => r.id === action.regionId)) return editor;
    if (!colorValid(action.color)) throw new Error('颜色格式不正确');
    next.colors[action.regionId] = action.color;
  } else if (action.type === 'stroke') {
    if (next.strokes.length >= MAX_STROKES) throw new Error('已保留 100 笔，可以撤销后继续');
    next.strokes.push({color:action.color,width:action.width,points:simplifyPoints(action.points)});
  } else if (action.type === 'rotate') next.rotation = (next.rotation + 90) % 360;
  else if (action.type === 'flip') next.flipped = !next.flipped;
  else if (action.type === 'name') next.name = action.value;
  else if (action.type === 'step-back') {
    // 一步一步返回上一笔：只撤销最后一笔描画，填色与方向等其他操作保留。
    if (!next.strokes.length) return editor;
    next.strokes.pop();
  } else if (action.type === 'clear-strokes') {
    // 撤销（清空画笔）：一次撤销全部描画笔迹。
    if (!next.strokes.length) return editor;
    next.strokes = [];
  } else if (action.type === 'reset') {
    const restored = next.kind === 'template' ? defaultConfig(next.templateId) : Object.assign({},next,{strokes:[],rotation:0,flipped:false});
    restored.name = next.name; return changed(editor,restored);
  } else throw new Error('不支持的编辑操作');
  return changed(editor,next);
}
function undo(editor) { if (!editor.history.length) return editor; return {config:clone(editor.history[editor.history.length-1]),history:editor.history.slice(0,-1),baseline:editor.baseline}; }
function reset(editor) { return applyAction(editor,{type:'reset'}); }
function toLocalPoint(point, rotation, flipped) {
  const angle = -rotation*Math.PI/180; const x=point[0]-256, y=point[1]-256;
  const rx = x*Math.cos(angle)-y*Math.sin(angle); const ry = x*Math.sin(angle)+y*Math.cos(angle);
  return [(flipped ? -rx : rx)+256,ry+256];
}
function toViewPoint(point, rotation, flipped) {
  const angle=rotation*Math.PI/180;const x=(point[0]-256)*(flipped?-1:1), y=point[1]-256;
  return [x*Math.cos(angle)-y*Math.sin(angle)+256,x*Math.sin(angle)+y*Math.cos(angle)+256];
}
function contains(p, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) { const a=polygon[i],b=polygon[j]; if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside; }
  return inside;
}
function regionAt(config, point) { const t=templateById(config.templateId); if (!t || config.kind !== 'template') return null; const p=toLocalPoint(point,config.rotation,config.flipped); for(let i=t.regions.length-1;i>=0;i-=1) if(contains(p,t.regions[i].polygon)) return t.regions[i].id; return null; }
function path(ctx,points,closed) { ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);points.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));if(closed)ctx.closePath(); }
function drawStroke(ctx,stroke) { ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';if(stroke.points.length===1){ctx.beginPath();ctx.arc(stroke.points[0][0],stroke.points[0][1],stroke.width/2,0,Math.PI*2);ctx.fill();}else{path(ctx,stroke.points,false);ctx.stroke();} }
function render(ctx, input, size, options) {
  const config=normalizeConfig(input);const opts=options||{};const t=templateById(config.templateId);
  ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(size/SIZE,size/SIZE);ctx.translate(256,256);ctx.rotate(config.rotation*Math.PI/180);ctx.scale(config.flipped?-1:1,1);ctx.translate(-256,-256);
  ctx.lineJoin='round';ctx.lineCap='round';
  if(config.kind==='generated-image'||config.kind==='photo') { if(!opts.image){ctx.restore();throw new Error('生成图片尚未载入');}ctx.drawImage(opts.image,0,0,SIZE,SIZE);config.strokes.forEach(s=>drawStroke(ctx,s));ctx.restore();return; }
  t.regions.forEach(r=>{path(ctx,r.polygon,true);ctx.fillStyle=config.colors[r.id];ctx.fill();});
  config.strokes.forEach(s=>drawStroke(ctx,s));
  ctx.strokeStyle='#234B3C';ctx.lineWidth=4.5;t.regions.forEach(r=>{path(ctx,r.polygon,true);ctx.stroke();});
  (t.details||[]).forEach(points=>{path(ctx,points,false);ctx.stroke();});
  (t.seeds||[]).forEach(p=>{ctx.beginPath();ctx.ellipse(p[0],p[1],2.5,5,0.4,0,Math.PI*2);ctx.fillStyle='#34503A';ctx.fill();});
  ctx.fillStyle='#234B3C';[230,281].forEach(x=>{ctx.beginPath();ctx.ellipse(x,t.faceY,3.5,6,0,0,Math.PI*2);ctx.fill();});
  ctx.beginPath();ctx.moveTo(244,t.faceY+21);ctx.quadraticCurveTo(255,t.faceY+34,268,t.faceY+21);ctx.stroke();
  // Separate arm rendering lets the welcome view wave without a video model.
  ctx.lineWidth=5;path(ctx,[[134,291],[105,312],[91,299]],false);ctx.stroke();
  if(!opts.hideWaveArm){path(ctx,[[380,279],[408,262],[410,234]],false);ctx.stroke();path(ctx,[[410,244],[423,235]],false);ctx.stroke();}
  if(t.id!=='grape'){path(ctx,[[218,405],[211,424],[198,424]],false);ctx.stroke();path(ctx,[[294,405],[301,424],[314,424]],false);ctx.stroke();}
  ctx.restore();
}
function savePreview(canvas, partition) {
  if(!['personal','demo'].includes(partition)) return Promise.reject(new Error('保存分区无效'));
  return new Promise((resolve,reject)=>{
    if(typeof wx==='undefined'||!wx.canvasToTempFilePath||!wx.getFileSystemManager||!wx.env) return reject(new Error('当前设备不能保存画布，请重试'));
    wx.canvasToTempFilePath({canvas,width:512,height:512,destWidth:512,destHeight:512,fileType:'png',success(result){
      const fs=wx.getFileSystemManager();const directory=wx.env.USER_DATA_PATH+'/companions/'+partition;
      const target=directory+'/'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9)+'.png';
      try { try{fs.accessSync(directory);}catch(error){fs.mkdirSync(directory,true);} }
      catch(error){reject(new Error('预览文件保存失败，请检查存储空间'));return;}
      fs.copyFile({srcPath:result.tempFilePath,destPath:target,success(){resolve(target);},fail(){reject(new Error('预览文件保存失败，请检查存储空间'));}});
    },fail(){reject(new Error('画布导出失败，请重试'));}});
  });
}
function removePreview(filePath,partition) {
  if(typeof wx==='undefined'||!wx.env||!wx.getFileSystemManager||!['personal','demo'].includes(partition)||typeof filePath!=='string'||filePath.indexOf(wx.env.USER_DATA_PATH+'/companions/'+partition+'/')!==0) return;
  const filename=filePath.slice((wx.env.USER_DATA_PATH+'/companions/'+partition+'/').length);
  if(!/^[a-z0-9]+-[a-z0-9]*\.(png|jpg)$/.test(filename))return;
  try{wx.getFileSystemManager().unlink({filePath,fail(){}});}catch(error){}
}
module.exports={SIZE,MAX_STROKES,MAX_POINTS,PALETTE,defaultConfig,normalizeConfig,searchTemplates,createEditor,applyAction,undo,reset,isDirty,toLocalPoint,toViewPoint,regionAt,simplifyPoints,render,savePreview,removePreview};
