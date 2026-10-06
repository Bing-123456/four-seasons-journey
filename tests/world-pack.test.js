'use strict';

// 世界风物分包：数据、署名、照片与页面注册的完整性。世界层是阅读扩展，
// 不得进入主包页面或行程规划。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sites } = require('../miniprogram/packageWorld/data/sites');
const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));

test('subpackage is registered with its single world page', () => {
  // packageWorld 之外新增了 packageFruit（果乡/水果详情分包）、packageTrip（分步向导定制行程，评审 P24③）
  // 与 packageMore（2026-10-06 为压主包体积迁入的 13 个非 tab 页面）；世界分包仍排首位。
  assert.equal(app.subPackages.length, 4);
  assert.equal(app.subPackages[0].root, 'packageWorld');
  assert.deepEqual(app.subPackages[0].pages, ['pages/index/index']);
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/packageWorld/pages/index/index.' + ext)), ext + ' missing');
  }
  // 分包照片不能被主包页面引用（主包无权读取分包资源）
  for (const page of ['index/index', 'calendar/calendar']) {
    const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/' + page + '.wxml'), 'utf8');
    assert.doesNotMatch(wxml, /packageWorld\/assets/, page + ' must not reference subpackage assets directly');
  }
});

test('every world site cites open sources and an openly licensed packaged photo', () => {
  assert.ok(sites.length >= 5, 'at least five continents-spanning sites');
  const continents = new Set(sites.map(site => site.continent));
  assert.ok(continents.size >= 4, 'world coverage must span several continents: ' + [...continents].join(','));
  for (const site of sites) {
    assert.ok(site.name && site.nameEn && site.country && site.theme && site.designation, site.id + ' identity fields');
    assert.ok(site.description.length >= 20, site.id + ' description');
    assert.ok(site.facts.length >= 2, site.id + ' needs at least two sourced facts');
    const sourceIds = new Set(site.sources.map(source => source.id));
    for (const fact of site.facts) {
      assert.ok(fact.sourceIds.every(id => sourceIds.has(id)), site.id + ' fact cites unknown source');
    }
    for (const source of site.sources) {
      assert.match(source.url, /^https:\/\/(www\.fao\.org|en\.wikipedia\.org)\//, site.id + ' source must be FAO or Wikipedia');
    }
    const photo = site.photo;
    assert.match(photo.credit, /CC BY(-SA)? \d/, site.id + ' photo must carry a Creative Commons credit');
    assert.ok(photo.licenseUrl && photo.sourceUrl, site.id + ' photo license/source links');
    const file = path.resolve(__dirname, '../miniprogram' + photo.src);
    assert.ok(fs.existsSync(file), photo.src + ' missing');
    const bytes = fs.readFileSync(file);
    assert.equal(bytes[0], 0xFF); assert.equal(bytes[1], 0xD8);
    assert.ok(bytes.length > 20000, photo.src + ' suspiciously small');
    assert.ok(bytes.length < 1024 * 1024, photo.src + ' must stay compressed for the subpackage budget');
  }
});

test('world layer stays a reading layer: no route, booking or henan entanglement', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageWorld/pages/index/index.wxml'), 'utf8');
  const i18n = require('../miniprogram/lib/i18n');
  // 界面文案走共享词典：范围边界声明在词典中文文案里，页面绑定该词条。
  assert.match(page, /{{L\.wd_scope_note}}/, 'scope boundary note is bound on the page');
  assert.match(i18n.dict.wd_scope_note[0], /不提供行程规划或预约/, 'zh scope note keeps the no-planning boundary');
  assert.doesNotMatch(page, /预约成功|立即购买|generateRoute/, 'no booking or routing on the world layer');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageWorld/pages/index/index.js'), 'utf8');
  // 共享 i18n 词典是 UI 基础设施，允许引用；其余主包模块仍禁止进入分包。
  assert.doesNotMatch(js, /require\('\.\.\/\.\.\/\.\.\/\.(?!\/lib\/i18n)/, 'subpackage must not reach into main-package modules beyond the shared i18n dictionary');
});
