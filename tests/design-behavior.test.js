'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setImmediate: turn } = require('node:timers/promises');
const store = require('../miniprogram/lib/store');
const service = require('../miniprogram/lib/service');
const i18n = require('../miniprogram/lib/i18n');
const original = { wx: global.wx, Page: global.Page, parse: service.parseProfile };
function page(name) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages', name, name + '.js');
  delete require.cache[require.resolve(file)]; require(file);
  return Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
}
test.beforeEach(() => {
  const memory = new Map();
  global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key), setNavigationBarTitle() {}, showToast() {} };
});
test.afterEach(() => { service.parseProfile = original.parse; });
test.after(() => { global.wx = original.wx; global.Page = original.Page; });

test('the place questionnaire exposes correct multi-select and single-select states in both languages', () => {
  for (const language of ['zh', 'en']) {
    wx.removeStorageSync('guayouji.place-recommend.v1.personal');
    store.saveSettings({ language });
    i18n.invalidateLang();
    const finder = page('place-finder'); finder.onLoad();
    const choose = (qid, oid) => finder.toggleOption({ currentTarget: { dataset: { qid, oid } } });
    const selected = qid => finder.data.questions.find(q => q.id === qid).options.filter(o => o.selected).map(o => o.id);
    choose('fruits', '青梅'); choose('fruits', '枇杷');
    assert.deepEqual(selected('fruits'), ['青梅', '枇杷']);
    choose('fruits', '青梅'); assert.deepEqual(selected('fruits'), ['枇杷']);
    choose('activity', 'pick'); choose('activity', 'photo');
    assert.deepEqual(selected('activity'), ['photo']);
    assert.equal(finder.data.questions[1].options[0].group, '');
  }
});

test('editing trip hours while AI parses preserves the new duration', async () => {
  let complete;
  service.parseProfile = () => new Promise(resolve => { complete = resolve; });
  const profile = page('profile'); profile.onLoad();
  assert.equal(Number(profile.data.durationHours) * 60, profile.data.profile.duration);
  const before = Object.assign({}, profile.data.profile);
  profile.onTextInput({ detail: { value: '两人周末出游' } }); profile.parse();
  profile.setHours({ detail: { value: '5' } });
  complete({ profile: before, missingFields: [], mode: 'openai-compatible' }); await turn();
  assert.equal(profile.data.profile.duration, 300);
  assert.equal(profile.data.durationHours, '5');
});
