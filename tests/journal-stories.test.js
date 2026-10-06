'use strict';
// P21 验收：果农故事专栏按评审附件 D 重写为真实人物故事（field-story）；
// journal 页删除「EN英文译文」切换，改为「内容整理自公开报道」来源说明。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stories = require('../miniprogram/data/farmer-stories');

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8');

test('every season serves three real field stories with names, places and sources', () => {
  let count = 0;
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    const list = stories.storiesForSeason(season);
    assert.equal(list.length, 3, season + ' serves three stories');
    for (const story of list) {
      count += 1;
      assert.equal(story.editorialType, 'field-story', story.id + ' is a field story');
      assert.ok(story.name, story.id + ' carries the farmer name');
      assert.match(story.place, /来源/, story.id + ' states the place and the source');
      assert.ok(story.text.length >= 80, story.id + ' keeps the long narrative');
      assert.ok(story.fruit, story.id + ' keeps the season fruit name');
    }
  }
  assert.equal(count, 12, 'all twelve seasonal fruits have stories');
});

test('story rotation stays deterministic and empty seasons fall back safely', () => {
  const a = stories.storyForSeason('winter', '2026-12-21');
  const b = stories.storyForSeason('winter', '2026-12-21');
  assert.equal(a.name, b.name);
  const next = stories.storyForSeason('winter', '2026-12-22');
  assert.notEqual(a.name, next.name, 'consecutive days rotate the story');
  assert.equal(stories.storiesForSeason('unknown').length, 0);
  assert.equal(stories.storyForSeason('unknown'), null);
});

test('rotating stories only show the persimmon harvest for the persimmon story', () => {
  const cloudImages = require('../miniprogram/lib/cloud-images');
  const cloudUrls = Object.keys(cloudImages.CLOUD).map(k => cloudImages.CLOUD[k]).filter(Boolean);
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    for (const story of stories.storiesForSeason(season)) {
      const expected = story.id === 'autumn-persimmon' ? 'farmer-story-scene.jpg' : 'farmer-story-care.jpg';
      // 2026-10-06 起插画走云存储（miniprogram/lib/cloud-images.js），地址为 cloud:// 形态。
      const url = String(story.illustration);
      assert.ok(url.indexOf(expected) >= 0, story.id + ' 应引用 ' + expected + '，实际 ' + url);
      const onCloud = cloudUrls.some(u => u.split('/').pop() === expected);
      const onDisk = fs.existsSync(path.join(__dirname, '../miniprogram', story.illustration));
      assert.ok(onCloud || onDisk, story.id + ' 必须已打包或已登记为云存储地址');
    }
  }
  assert.match(read('miniprogram/pages/journal/journal.wxml'), /src="\{\{seasonStory\.illustration\}\}"/);
});

test('the journal page drops the EN toggle and the source-note line, and the story follows the current term', () => {
  const markup = read('miniprogram/pages/journal/journal.wxml');
  const controller = read('miniprogram/pages/journal/journal.js');
  assert.doesNotMatch(markup, /fn_show_en|fn_show_zh|toggleStoryEn/, 'the EN toggle is gone from the journal');
  assert.doesNotMatch(controller, /toggleStoryEn|storyEn|storyTranslating|service\.translate/, 'translation state and calls are removed');
  assert.match(markup, /seasonStory\.text/, 'the story renders the field-story text');
  assert.doesNotMatch(markup, /storyNote/, '9.28 评审：整行删除「内容整理自公开报道，来源见文末。」');
  assert.doesNotMatch(controller, /getProfile\(\)\.season/, 'story no longer follows the profile season');
  assert.match(controller, /storyForSeason\(term\.season\)/, '9.28 评审：故事季节跟随当前节气');
});
