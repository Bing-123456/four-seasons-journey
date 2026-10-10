'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../miniprogram/data/catalog');
const core = require('../miniprogram/lib/core');
const {buildRoutePresentation, activeMap, buildCatalogMap} = require('../miniprogram/packageMore/lib/route-presentation');
const clone = x => JSON.parse(JSON.stringify(x));
const place = catalog.places.find(p => p.routeEligible);
const profile = {...clone(catalog.defaultProfile),date:'2026-09-23',duration:360,origin:{name:place.name,address:place.address,latitude:place.location.latitude,longitude:place.location.longitude,coordinateSystem:'gcj02',source:'catalog'}};
function routeOne() {return core.generateRoute(profile,{excludedIds:['dahecun-museum']});}

test('presentation preserves true entities, unknown cost and saved profile context',()=>{
  const route=core.generateRoute(profile), before=clone(route);
  const view=buildRoutePresentation(route,{...profile,date:'2026-10-03'});
  assert.equal(view.ok,true); assert.equal(view.dateLabel,'9月23日 · 周三');
  assert.equal(view.costLabel,'总费用待确认'); assert.match(view.summary,/估算含往返/);
  assert.equal(view.partyLabel,'2人同行'); assert.equal(view.stops.length,2);
  view.stops.forEach((s,i)=>{ assert.equal(s.name,route.stops[i].name);assert.equal(s.cost,route.stops[i].cost);assert.equal(s.hasSource,true);assert.ok(s.shortReason.length<=20);});
  view.stops[0].tags.push('test');assert.deepEqual(route,before);
});

test('native map uses catalog GCJ coordinates and adds viewport room around labels',()=>{
  const view=buildRoutePresentation(core.generateRoute(profile),profile),map=view.map;
  for (const m of map.markers) {const p=catalog.places.find(p=>p.id===m.placeId);assert.equal(m.latitude,p.location.latitude);assert.equal(m.longitude,p.location.longitude);assert.equal(m.callout.display,'BYCLICK');}
  assert.equal(map.markers.length,2);assert.equal(map.polyline[0].dottedLine,true);
  assert.deepEqual(map.polyline[0].points[0],{latitude:profile.origin.latitude,longitude:profile.origin.longitude});
  assert.deepEqual(map.polyline[0].points.at(-1),map.polyline[0].points[0]);
  assert.ok(Math.min(...map.includePoints.map(p=>p.latitude))<Math.min(...map.markers.map(p=>p.latitude)));
  assert.ok(Math.max(...map.includePoints.map(p=>p.longitude))>Math.max(...map.markers.map(p=>p.longitude)));
  assert.match(map.note,/不是道路路线/);
});

test('user origin is visible and only the selected destination expands its callout',()=>{
  const p={...profile,origin:{...profile.origin,latitude:profile.origin.latitude+0.002,name:'测试虚拟GPS',source:'user'}};
  const map=buildRoutePresentation(core.generateRoute(p),p).map;
  assert.equal(map.markers.find(m=>m.id===1000).latitude,p.origin.latitude);
  const active=activeMap(map,'dahecun-museum');
  assert.equal(active.markers.filter(m=>m.callout.display==='ALWAYS').length,1);
  assert.equal(active.markers.find(m=>m.callout.display==='ALWAYS').placeId,'dahecun-museum');
  assert.ok(activeMap(active,'').markers.every(m=>m.callout.display==='BYCLICK'));
  assert.equal(activeMap(active,'').markers.find(m=>m.id===1000).iconPath,'/assets/map-marker.png');
  assert.deepEqual(activeMap(active,'dahecun-museum'),active);
});

test('empty route preview shows real venues without creating a route or an origin',()=>{
  const map=buildCatalogMap();assert.equal(map.mode,'preview');assert.deepEqual(map.polyline,[]);assert.equal(map.originName,'');
  assert.equal(map.markers.length,catalog.places.filter(p=>p.routeEligible).length);
  assert.ok(map.markers.every(m=>catalog.places.some(p=>p.id===m.placeId&&p.demo===false)));
  assert.equal(buildRoutePresentation(null,profile).ok,false);
});

test('malformed routes cannot create plausible route markers',()=>{
  const route=core.generateRoute(profile);
  for (const r of [null,{ok:false},{ok:true,stops:[]},{ok:true,stops:[null]},{ok:true,stops:[{placeId:'unknown'}]},{ok:true,stops:[route.stops[0],route.stops[0]]}]) {
    const view=buildRoutePresentation(r,profile);assert.equal(view.ok,false);assert.deepEqual(view.map.markers,[]);
  }
  assert.equal(buildRoutePresentation(null,{date:'2026-02-30'}).dateLabel,'日期待确认');
});

test('single venue and duration edge cases remain legible',()=>{
  const r=routeOne();assert.equal(r.stops.length,1);
  for(const [minutes,label] of [[30,'30分钟'],[60,'1小时'],[125,'2小时5分']]) {r.totalMinutes=minutes;assert.equal(buildRoutePresentation(r,profile).durationLabel,label);}
  r.totalMinutes=NaN;r.startTime='24:99';const v=buildRoutePresentation(r,profile);assert.equal(v.durationLabel,'');assert.equal(v.timeLabel,'');assert.equal(v.costLabel,'总费用待确认');
});
