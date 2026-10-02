'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const welcome = require('../miniprogram/lib/welcome');
const catalog = require('../miniprogram/data/catalog');
function storage(t, initial) {
  const disk = { ...initial }; global.wx = { getStorageSync: key => disk[key], setStorageSync: (key, value) => { disk[key] = JSON.parse(JSON.stringify(value)); } };
  t.after(() => { delete global.wx; }); return disk;
}
test('additive identity and companion migration preserves v2 route, favorites and settings', t => {
  const previous = { version: 2, profile: catalog.defaultProfile, favorites: ['summer-culture'], route: { marker: 'existing-unmodified' }, settings: { apiBase: 'https://example.com', useAI: true } };
  const disk = storage(t, { 'guayouji.prototype.v1': previous });
  assert.equal(store.getIdentity().nickname, '');
  store.saveIdentity({ nickname: '果旅人' });
  store.saveCompanion(store.getCompanion(), 'personal');
  assert.deepEqual(disk['guayouji.prototype.v1'].route, previous.route);
  assert.deepEqual(store.getFavorites(), previous.favorites);
  assert.equal(store.getSettings().apiBase, 'https://example.com');
});
test('captured account saves never cross from personal into demo', t => {
  const disk = storage(t); const partition = store.capturePartition();
  const config = store.getCompanion(); config.name = '个人水果';
  store.enterDemo(); store.saveCompanion(config, partition);
  assert.notEqual(store.getCompanion().name, '个人水果');
  assert.equal(store.getCompanion('personal').name, '个人水果');
  store.writePartitionField('seller', { batches: ['demo'] }, 'demo');
  assert.equal(store.readPartitionField('seller', 'personal'), null);
  assert.equal(disk['guayouji.demo.v1'].settings.useAI, true);
});
test('failed local persistence does not replace the previous companion', t => {
  storage(t); const config = store.getCompanion(); config.name = '已保存'; store.saveCompanion(config);
  global.wx.setStorageSync = () => { throw Error('disk full'); };
  assert.throws(() => store.saveCompanion({ ...config, name: '失败' }), /保存失败/);
  assert.equal(store.getCompanion().name, '已保存');
});
test('welcome consumes once and excludes share routes and opt-out without replay', () => {
  const gate = welcome.createGate({ path: 'pages/index/index', scene: 1001 });
  assert.equal(gate.consume(true), true); assert.equal(gate.consume(true), false);
  for (const options of [{ path: 'pages/culture/culture' }, { path: 'pages/index/index', scene: 1007 }, { scene: 1008 }, { scene: 1044 }]) assert.equal(welcome.createGate(options).consume(true), false);
  const disabled = welcome.createGate({}); assert.equal(disabled.consume(false), false); assert.equal(disabled.consume(true), false);
});

test('clearing a partition deletes only its owned preview files', t => {
  storage(t); const deleted = []; global.wx.env = { USER_DATA_PATH: '/sandbox' };
  global.wx.getFileSystemManager = () => ({ accessSync() {}, readdirSync: () => ['safe-preview.png', '../other.png'], unlinkSync: name => deleted.push(name) });
  store.clearAll(); assert.deepEqual(deleted, ['/sandbox/companions/personal/safe-preview.png']);
  deleted.length = 0; store.enterDemo(); deleted.length = 0; store.resetDemo();
  assert.deepEqual(deleted, ['/sandbox/companions/demo/safe-preview.png']);
});
