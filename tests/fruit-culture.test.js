'use strict';
// 改版方案（再修改方案）验收：改名、农事活动预告、外圈水果内容、四时页交互。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fruitCulture = require('../miniprogram/data/fruit-culture');
const worldFruit = require('../miniprogram/data/world-fruit-culture');
const activities = require('../miniprogram/data/farm-activities');
const i18n = require('../miniprogram/lib/i18n');

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8');

test('the mini program is renamed to 果物四时记 everywhere it is shown', () => {
  const files = ['miniprogram/app.json', 'miniprogram/lib/i18n.js', 'miniprogram/pages/index/index.json', 'miniprogram/pages/learn/learn.json'];
  for (const file of files) assert.doesNotMatch(read(file), /四时果叙/, file + ' keeps no old product name');
  assert.equal(JSON.parse(read('miniprogram/app.json')).window.navigationBarTitleText, '果物四时记');
  assert.equal(i18n.t('home_tagline1'), '果物四时记');
  assert.equal(i18n.t('footer_note').startsWith('果物四时记'), true);
  assert.match(i18n.t('welcome_title'), /果物四时记/);
  assert.equal(JSON.parse(read('miniprogram/pages/learn/learn.json')).navigationBarTitleText, '游戏', '26.9.25 plan: single clean title, no brand prefix');
});

test('every fruit on the link graph carries six complete categories', () => {
  let total = 0;
  for (const season of fruitCulture.seasons) {
    const all = fruitCulture.seasonFruits(season);
    assert.equal(all.length, season.fruits.length + season.moreFruits.length);
    for (const fruit of all) {
      total += 1;
      assert.equal(fruit.categories.length, 6, season.id + '/' + fruit.name + ' has six categories');
      assert.deepEqual(fruit.categories.map(item => item.cat), ['folk', 'history', 'craft', 'story', 'tools', 'health']);
      for (const item of fruit.categories) {
        assert.ok(item.text && item.text.length >= 8, season.id + '/' + fruit.name + '/' + item.cat + ' has a summary');
        assert.ok(item.detail && item.detail.length >= 30, season.id + '/' + fruit.name + '/' + item.cat + ' has an expandable note');
      }
      // 链图用 fullId 定位，必须能反查回同一条水果。
      assert.equal(fruitCulture.findFruit(season.id + '-' + fruit.id).name, fruit.name);
    }
  }
  assert.equal(total, 48, 'the original seasonal nodes plus autumn jujube');
  assert.ok(Object.keys(worldFruit).length >= 29, 'the world library de-duplicates repeated fruits');
});

test('every world fruit name used by a season has content, so no node falls back to 内容整理中', () => {
  for (const season of fruitCulture.seasons) {
    for (const fruit of season.moreFruits) {
      assert.equal(fruit.world, true, fruit.name + ' is flagged as a world fruit');
      assert.ok(worldFruit[fruit.name], fruit.name + ' is written up in the world library');
      assert.equal(fruit.categories, worldFruit[fruit.name], fruit.name + ' shares the world library entry');
    }
  }
  // 搜索索引覆盖四季全部 47 个节点；同一季内不出现重名水果（跨季重复的水果按季分别收录）。
  for (const season of fruitCulture.seasons) {
    const names = fruitCulture.seasonFruits(season).map(fruit => fruit.name);
    assert.equal(new Set(names).size, names.length, season.id + ' lists each fruit once');
  }
  assert.equal(fruitCulture.knownFruitNames().length, 48);
});

test('the harvest-event carousel is driven by the four seasons of picking activities', () => {
  const list = activities.ACTIVITIES;
  assert.equal(list.length, 12, 'three activities per season');
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    assert.equal(activities.forSeason(season).length, 3, season + ' has three activities');
  }
  assert.equal(new Set(list.map(item => item.id)).size, 12, 'activity ids are unique');
  for (const item of list) {
    assert.ok(item.title && item.note, item.id + ' carries a title and a note');
    assert.match(item.open, /^\d+ 月 \d+ 日起$/, item.id + ' states when booking opens');
    assert.match(item.seasonLabel, /^[春夏秋冬]$/);
  }
  assert.deepEqual(list.slice(0, 3).map(item => item.title), ['青梅采摘・青梅酒封坛', '枇杷采摘・枇杷膏熬制', '桑葚采摘・果酱手作']);
  assert.deepEqual(list.slice(-3).map(item => item.title), ['冬枣采摘・脆甜尝鲜', '瓯柑采摘・瓯柑酿制', '砂糖橘采摘・暖冬甜橘']);
  const indexJs = read('miniprogram/pages/index/index.js');
  // 三个活动继续轮播；文案与插画分离，保持可读性和双语能力。
  assert.match(indexJs, /forecastPosters/, 'the carousel shows the three campaign posters');
  assert.doesNotMatch(indexJs, /farmActivities\.ACTIVITIES\.map/, 'activity slides are replaced by posters');
  assert.doesNotMatch(indexJs, /solarTermNotes\.forecasts/, 'the solar-term slides are gone from the carousel');
  for (const illustration of ['cover-plum.jpg', 'cover-loquat.jpg', 'cover-peach.jpg']) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/assets/illustrations', illustration)), illustration + ' packaged');
  }
});

test('the almanac keeps one screen while its fruit directory explains the favourite heart', () => {
  const markup = read('miniprogram/pages/calendar/calendar.wxml');
  const page = read('miniprogram/pages/calendar/calendar.js');
  const detail = read('miniprogram/pages/fruit-detail/fruit-detail.wxml');
  assert.match(detail, /openCategory/, 'directory rows navigate to the dedicated note page');
  assert.equal(JSON.parse(read('miniprogram/pages/calendar/calendar.json')).disableScroll, true);
  assert.doesNotMatch(markup, /selectedFruit|fruit-cat/, 'details stay in their own page');
  assert.match(read('miniprogram/pages/fruit-note/fruit-note.wxml'), /read-card/, 'the note page carries the Guoling reader');
  assert.match(detail, /'♥' : '♡'/, 'the heart fills in once a note is favourited');
  assert.match(read('miniprogram/pages/fruit-detail/fruit-detail.wxss'), /\.fruit-fav\.is-fav\{color:#D0342C\}/, 'the filled heart is red');
  assert.match(i18n.t('fruit_note_short'), /右上角爱心/, 'the footer note points at the row heart');
  assert.match(markup, /id="guoling-search"/, 'the search entry closes the almanac');
  assert.match(markup, /L\.guoling_search_title/, 'the entry is titled 果灵搜索');
  assert.equal(i18n.t('guoling_search_title'), '果灵搜索');
  assert.doesNotMatch(markup, /L\.search_local_web/, 'the old subtitle is removed');
  assert.match(page, /openSearch: function \(\) \{ wx\.navigateTo\(\{ url: '\/pages\/search\/search' \}\)/, 'the entry keeps the original search behaviour');
});

test('fruit directory rows use precomputed favourites and open the dedicated note page', () => {
  const markup = read('miniprogram/pages/fruit-detail/fruit-detail.wxml');
  assert.doesNotMatch(markup, /indexOf\(/, 'views do not execute unsupported array methods');
  assert.match(markup, /class="fruit-fav \{\{item\.fav \? 'is-fav' : ''\}\}"/, 'the filled heart uses a precomputed flag');
  assert.match(markup, /fruit-toggle">›</);
  assert.match(markup, /\{\{item\.label\}\}/);
  const controller = read('miniprogram/pages/fruit-detail/fruit-detail.js');
  assert.match(controller, /fav: favorites\.includes\(favId\)/);
  assert.match(controller, /toggleFavorite:[\s\S]*?this\.render\(\)/);
});

test('the almanac keeps the console clean', () => {
  // 开发者工具实测告警：对象数组用 wx:key="*this" 会得到同一个 "[object Object]" 键。
  const markup = read('miniprogram/pages/calendar/calendar.wxml');
  assert.match(markup, /wx:for="\{\{graphNodes\}\}" wx:key="id"/, 'fruit nodes use stable IDs');
  assert.match(markup, /wx:for="\{\{seasons\}\}" wx:key="id"/, 'season tabs use stable IDs');
  // companion-view 的 config 是对象：未就绪时先不挂载，避免 "expected <Object> but got non-Object value" 告警。
  assert.match(markup, /<companion-view wx:if="\{\{companionMini\}\}" config="\{\{companionMini\}\}"/, 'the companion only mounts once its config exists');
  assert.equal(JSON.parse(read('miniprogram/pages/calendar/calendar.json')).usingComponents['companion-view'], '/components/companion-view/companion-view', 'the almanac registers the companion component it renders');
});

test('the rewritten six-dimension notes match their titles and run longer than the old copy', () => {
  let total = 0, chars = 0;
  for (const season of fruitCulture.seasons) {
    for (const fruit of fruitCulture.seasonFruits(season)) {
      const seen = new Set();
      for (const item of fruit.categories) {
        total += 1; chars += item.detail.length;
        assert.ok(item.detail.length >= 70, season.id + '/' + fruit.name + '/' + item.cat + ' keeps the expanded length');
        assert.doesNotMatch(item.detail, /【创作故事/, 'details drop the inline disclaimer prefix');
        assert.doesNotMatch(item.text, /^一则关于/, 'summaries are real topic openings, not placeholders');
        seen.add(item.text);
      }
      assert.equal(seen.size, 6, season.id + '/' + fruit.name + ' gives every section its own summary');
    }
  }
  assert.ok(chars / total >= 110, 'the rewritten library averages longer paragraphs than the 2026-09 baseline');
});

test('9.27 feedback: craft lessons keep unique step titles and real ingredients, seasons match content', () => {
  // P17：食材不含「清洁器具」（安全提示并入食材卡说明）；任意水果步骤小标题不重复
  for (const [name, categories] of Object.entries(worldFruit)) {
    const craft = (categories || []).find(category => category.cat === 'craft');
    if (!craft || !craft.learn) continue;
    assert.equal(craft.learn.ingredients.some(item => item.name === '清洁器具'), false, name + ' 食材不含清洁器具');
    const titles = craft.learn.steps.map(step => step.title);
    assert.equal(new Set(titles).size, titles.length, name + ' 步骤小标题唯一');
    for (const step of craft.learn.steps) assert.ok(step.title && step.text.endsWith('。'), name + ' 步骤完整');
  }
  // P19：季节与内容一致——杨梅（夏至杨梅）、山竹（热带夏季果）归入夏季，且节点图随季节改名
  for (const name of ['杨梅', '山竹']) {
    const hit = fruitCulture.findFruitByName(name);
    assert.equal(hit.seasonId, 'summer', name + ' 归入夏季');
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/assets/fruit-art', hit.fullId + '.jpg')), hit.fullId + ' 节点图已就位');
  }
  // P19：山竹「传统农具与种植」讲种植农艺，不再写开果刀
  const mangosteen = fruitCulture.findFruitByName('山竹').fruit;
  const tools = mangosteen.categories.find(category => category.cat === 'tools');
  assert.match(tools.text, /荫棚|嫁接|高枝剪/);
  assert.doesNotMatch(tools.text, /开山竹|开果的刀/);
});
