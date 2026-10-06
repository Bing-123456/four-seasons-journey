const { pageFile } = require('./helpers/page-path');
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../miniprogram/lib/store');
const media = require('../miniprogram/lib/media-service');
const originalWx = global.wx, originalPage = global.Page;
let calls, image;
const token = 'a'.repeat(64);
const clone = v => JSON.parse(JSON.stringify(v));
function page(name) {
  let definition; global.Page = v => { definition = v; };
  const file = pageFile(name);
  delete require.cache[file]; require(file);
  return Object.assign({}, definition, { data: clone(definition.data), setData(patch) { Object.assign(this.data, patch); }, getTabBar() { return null; } });
}
test.beforeEach(() => {
  const memory = new Map(); calls = []; image = Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' }, getStorageSync: k => memory.get(k), setStorageSync: (k,v) => memory.set(k,clone(v)), removeStorageSync: k => memory.delete(k),
    showToast() {}, showModal: o => o.success({ confirm: true }), disableAlertBeforeUnload() {},
    chooseMedia: o => o.success({ tempFiles: [{ tempFilePath: 'wxfile://temp/fruit.png' }] }),
    getFileSystemManager: () => ({ readFile: o => o.success({ data: image }), mkdirSync() {}, accessSync() {}, copyFile: o => { calls.push({ copy: o.destPath }); o.success(); }, unlink() {} }),
    downloadFile: o => o.success({ statusCode: 200, tempFilePath: 'wxfile://temp/result.png' }),
    request: o => { calls.push(o); o.success({ statusCode: 200, data: { identified: true, fruit: '苹果' } }); }
  };
  store.exitDemo(); store.clearAll(); store.saveSession({ token, expiresAt: Date.now() + 600000 }, store.getSettings().apiBase);
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });





test('late canvas image load renders a generated companion without disabling its editor', () => {
  const subject = page('companion'); subject.onLoad();
  const lib = require('../miniprogram/lib/companion');
  subject._editor = lib.createEditor({ kind: 'generated-image', sourcePath: 'wxfile://usr/a.png', rotation: 0, flipped: false, strokes: [] });
  let loaded, drawings = 0;
  subject._ctx = new Proxy({ drawImage() { drawings++; } }, { get: (o,k) => o[k] || (() => {}) });
  subject._canvas = { createImage() { loaded = {}; return loaded; } }; subject.data.canvasReady = true;
  subject.loadSourceAndRender(); subject.syncEditor();
  assert.equal(subject.data.canvasReady, true); assert.equal(subject.data.canvasError, ''); assert.equal(drawings, 0);
  loaded.onload(); assert.equal(drawings, 1); assert.equal(subject.data.canvasReady, true);
});

test('narrow photo is padded into supported image-edit dimensions before reading', async () => {
  let dimensions, source, exported;
  wx.getImageInfo = o => o.success({ width: 1200, height: 300 });
  wx.createOffscreenCanvas = options => {
    dimensions = options;
    const img = {}; Object.defineProperty(img, 'src', { set() { img.onload(); } });
    return { width: options.width, height: options.height, createImage: () => img, getContext: () => ({ fillRect() {}, drawImage() {} }) };
  };
  wx.canvasToTempFilePath = o => { exported = o; o.success({ tempFilePath: 'wxfile://temp/normalized.jpg' }); };
  wx.getFileSystemManager = () => ({ readFile: o => { source = o.filePath; o.success({ data: image }); } });
  await media.readImage('wxfile://temp/panorama.jpg', { forEditing: true });
  assert.equal(dimensions.height, 512); assert.equal(dimensions.width, 1200);
  assert.equal(exported.fileType, 'jpg'); assert.equal(source, 'wxfile://temp/normalized.jpg');
});

test('temporary polling failures retain the paid image task and recover without resubmitting', async () => {
  const api = require('../miniprogram/lib/companion-api'); let polls = 0, submits = 0;
  const client = api.createClient({ enabled: true, transport: async (method, url) => {
    if (url.endsWith('/uploads')) return { resourceId: 'r' };
    if (method === 'POST') { submits++; return { taskId: 'paid-job', status: 'queued' }; }
    if (++polls === 1) throw Error('temporary connection error');
    return { status: 'succeeded', imageUrl: 'https://example.com/result.png' };
  } });
  await client.generate({}, true, 'request-id');
  assert.equal((await client.poll()).status, 'queued'); assert.equal((await client.poll()).status, 'succeeded');
  assert.equal(submits, 1);
});
