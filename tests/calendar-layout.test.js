'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fruitCulture = require('../miniprogram/data/fruit-culture');

function loadCalendar() {
  const previousPage = global.Page;
  let calendar;
  global.Page = value => { calendar = value; };
  try {
    const filename = require.resolve('../miniprogram/pages/calendar/calendar');
    delete require.cache[filename];
    require(filename);
    calendar.data = JSON.parse(JSON.stringify(calendar.data));
    calendar.setData = patch => Object.assign(calendar.data, patch);
    return calendar;
  } finally { global.Page = previousPage; }
}

test('the one seasonal graph holds every fruit exactly once with native and introduced marks', () => {
  const calendar = loadCalendar();
  calendar._graphSize = { width: 343, height: 420 };
  for (const season of fruitCulture.seasons) {
    const fruits = fruitCulture.fruitsForSeason(season.id);
    const graph = calendar.buildGraph(season);
    assert.equal(new Set(graph.nodes.map(node => node.id)).size, fruits.length, 'no missing or repeated fruit nodes');
    assert.deepEqual(graph.nodes.map(node => node.id), fruits.map(fruit => fruit.fullId), 'flat compatibility data preserves the original ordering');
    assert.equal(graph.lines.length, graph.nodes.length, 'every fruit keeps its radial connection');
    assert.ok(graph.nodes.some(node => node.originClass === 'native'), season + ' marks its native fruits');
    assert.ok(graph.nodes.some(node => node.originClass === 'introduced'), season + ' marks its introduced fruits');
    graph.nodes.forEach((node, index) => {
      const fruit = fruits[index];
      // fruit-culture 的 world 名单（NATIVE_NAMES 团队定稿）就是本土/外来口径。
      assert.equal(node.originClass, fruit.world ? 'introduced' : 'native', node.id + ' carries the origin mark of the culture data');
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), node.id + ' has drawable coordinates');
      assert.ok(node.x > 0 && node.x < 100 && node.y > 0 && node.y < 100, node.id + ' stays inside the surface');
      assert.equal(node.locked, !fruit.categories.length);
      const edge = graph.lines.find(line => line.id === node.id);
      assert.ok(edge, node.id + ' connects to the season badge');
      assert.doesNotMatch(edge.lineStyle, /NaN|Infinity|undefined/);
      assert.ok(Number(edge.lineStyle.match(/width:([\d.]+)px/)[1]) > 0);
    });
  }
});

test('every merged graph connects the raised season badge to the measured fruit positions', () => {
  const calendar = loadCalendar();
  for (const size of [{ width: 311, height: 220 }, { width: 343, height: 420 }]) {
    calendar._graphSize = size;
    for (const season of fruitCulture.seasons) {
      const graph = calendar.buildGraph(season);
      for (const edge of graph.lines) {
        const node = graph.nodes.find(item => item.id === edge.id);
        const length = Number(edge.lineStyle.match(/width:([\d.]+)px/)[1]);
        const radians = Number(edge.lineStyle.match(/rotate\((-?[\d.]+)deg\)/)[1]) * Math.PI / 180;
        assert.match(edge.lineStyle, /^left:50%;top:47%;/);
        assert.ok(Math.abs(length * Math.cos(radians) - (node.x - 50) * size.width / 100) < 0.3, node.id + ' connects at its measured x coordinate');
        assert.ok(Math.abs(length * Math.sin(radians) - (node.y - 47) * size.height / 100) < 0.3, node.id + ' connects at its measured y coordinate');
      }
    }
  }
});

test('measuring and resizing rebuilds the seasonal connections without erasing valid geometry', () => {
  const calendar = loadCalendar();
  calendar.data.seasonMeta = fruitCulture.seasons[1];
  const initial = calendar.buildGraph(calendar.data.seasonMeta);
  assert.equal(initial.lines.length, 0, 'an unmeasured canvas never guesses an aspect ratio');
  let rect = { width: 343, height: 420 };
  calendar.createSelectorQuery = () => ({
    select(selector) { assert.equal(selector, '.graph-canvas'); return this; },
    boundingClientRect(callback) { callback(rect); return this; },
    exec() {}
  });
  calendar.measureGraph();
  const firstLines = calendar.data.graphLines.map(line => line.lineStyle);
  assert.ok(firstLines.length > 0);
  rect = { width: 311, height: 220 };
  calendar.onResize();
  assert.notDeepEqual(calendar.data.graphLines.map(line => line.lineStyle), firstLines, 'lines are rebuilt when the canvas is resized');
  const validLines = calendar.data.graphLines;
  rect = { width: 0, height: 0 };
  calendar.measureGraph();
  assert.strictEqual(calendar.data.graphLines, validLines, 'hidden or collapsed measurements do not erase valid geometry');
});

test('season switching rebuilds one merged graph per season without group tabs or page numbers', () => {
  const calendar = loadCalendar();
  calendar.getTabBar = () => null;
  calendar.onShow();
  assert.equal(calendar.data.graphGroups, undefined, 'the core/outer group state is gone');
  assert.equal(calendar.data.graphGroupIndex, undefined, 'the 01/02 pager state is gone');
  assert.equal(calendar.data.season, require('../miniprogram/lib/store').getProfile().season, 'the page opens on the saved season');
  calendar.choose({ currentTarget: { dataset: { id: 'winter' } } });
  const winterFruits = fruitCulture.fruitsForSeason('winter');
  assert.equal(calendar.data.graphNodes.length, winterFruits.length, 'winter shows all of its fruits on one graph');
  assert.deepEqual(calendar.data.graphNodes.map(node => node.originClass), winterFruits.map(fruit => fruit.world ? 'introduced' : 'native'));
  assert.equal(calendar.data.seasonMeta.centerName, '寒岁藏珍', 'the zh centre shows the seasonal theme word');
});
