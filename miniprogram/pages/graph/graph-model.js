'use strict';
const catalog = require('../../data/catalog');
const learning = require('../../data/learning');
function build(seasonId, interests) {
  const season = catalog.seasons.find(s => s.id === seasonId) || catalog.seasons.find(s => s.id === 'summer');
  const preferred = new Set(interests || []);
  const places = catalog.places.filter(p => !p.routeEligible && (p.season === season.id || (p.seasons || []).includes(season.id))).map(p => {
    const facts = catalog.facts.filter(f => p.factIds.includes(f.id) && f.displayInAlmanac !== false);
    return { id: p.id, name: p.name, kind: '故事', match: (p.tags || []).filter(t => preferred.has(t)).length,
      factCount: facts.length, facts: facts.map(f => ({ id: f.id, title: f.title, sourceIds: f.sourceIds })), lesson: learning.forPlace(p.id) };
  }).sort((a,b) => b.match - a.match);
  const venues = catalog.places.filter(p => p.routeEligible).map(p => ({ id: p.id, name: p.name, kind: '场馆延伸', match: (p.tags || []).filter(t => preferred.has(t)).length, lesson: learning.forPlace(p.id) })).sort((a,b) => b.match-a.match);
  const edges = places.map(p => ({from: 'crop-' + season.id, to: p.id, label:'农产与地方生活'}));
  places.forEach(p => p.facts.forEach(f => edges.push({from:p.id,to:f.id,label:'公开资料'})));
  places.concat(venues).filter(p=>p.lesson).forEach(p=>edges.push({from:p.id,to:p.lesson.id,label:'互动课堂'}));
  return { season, places, venues, edges };
}
module.exports = { build };
