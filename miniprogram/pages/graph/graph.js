const catalog = require('../../data/catalog');
const store = require('../../lib/store');
const model = require('./graph-model');
const i18n = require('../../lib/i18n');
Page({
  data: { season: 'summer', seasons: catalog.seasons, interests: [], graph: null, focusedId: '', L: {}, fontClass: 'fs-normal' },
  onLoad(options) { i18n.applyNav('nav_graph'); const id = options && options.season || store.getProfile().season; this.setData({ season: catalog.seasons.some(s=>s.id===id) ? id : 'summer' }); this.render(); },
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  render() { const profile=store.getProfile(); this.setData({ interests: catalog.interests.map(i=>Object.assign({},i,{selected:profile.interests.includes(i.id)})), graph:model.build(this.data.season,profile.interests), L: i18n.labels(['gr_title','gr_intro','gr_crop_season','gr_farm_life','gr_story_node','gr_notes_suffix','gr_interest_link','gr_interest_suffix','gr_read_story','gr_interactive_class','gr_extend_real','gr_3d_class','gr_note','gr_plan_trip']) }); },
  toggleInterest(e) { const id=e.currentTarget.dataset.id; if(!catalog.interests.some(i=>i.id===id))return; const p=store.getProfile(), selected=p.interests.includes(id); p.interests=selected?p.interests.filter(i=>i!==id):p.interests.concat(id); store.saveProfile(p); this.render(); },
  choose(e) { const id=e.currentTarget.dataset.id;if(!catalog.seasons.some(s=>s.id===id))return;this.setData({season:id});this.render(); },
  focus(e) { this.setData({focusedId:this.data.focusedId===e.currentTarget.dataset.id?'':e.currentTarget.dataset.id}); },
  open(e) { const id=e.currentTarget.dataset.id; if(catalog.places.some(p=>p.id===id))wx.navigateTo({url:'/pages/culture/culture?id='+encodeURIComponent(id)}); },
  lesson(e) { const p=this.data.graph.places.concat(this.data.graph.venues).find(p=>p.id===e.currentTarget.dataset.id);if(p&&p.lesson)wx.navigateTo({url:p.lesson.url}); },
  plan() { const p=store.getProfile();p.season=this.data.season;store.saveProfile(p);wx.navigateTo({url:'/pages/profile/profile'}); }
});
