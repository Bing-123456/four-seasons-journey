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
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.js');
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

test('paired fruit identification sends the complete image and the actual string token', async () => {
  image += 'A'.repeat(20000);
  const subject = page('playground'); subject.identifyFruit(); await subject._identifyPromise;
  assert.equal(calls.length, 1); assert.equal(calls[0].header.Authorization, 'Bearer ' + token);
  assert.equal(calls[0].data.base64, image); assert.equal(calls[0].data.mimeType, 'image/png');
  assert.equal(subject.data.identifyResult.fruit, '苹果'); assert.equal(subject.data.identifyBusy, false);
});

test('oversized and unsupported photos never get truncated or uploaded', async () => {
  image = '/9j/' + 'A'.repeat(3000000);
  const subject = page('playground'); subject.identifyFruit(); await subject._identifyPromise;
  assert.equal(calls.length, 0); assert.match(subject.data.identifyResult.message, /2 MB|照片压缩后仍过大/);
  image = 'invalid-file'; await assert.rejects(media.readImage('x'), /JPG/);
});

test('expired authentication produces an actionable message and removes only the matching session', async () => {
  wx.request = o => { calls.push(o); o.success({ statusCode: 401, data: { code: 'unauthorized' } }); };
  const subject = page('playground'); subject.identifyFruit(); await subject._identifyPromise;
  assert.match(subject.data.identifyResult.message, /重新配对/);
  // 用户会话已清除，但团队后端的内置直连凭证仍然有效。
  assert.equal(store.getSessionToken(), store.getCloudConnection().token);
});

test('switching backend during photo reading prevents any upload', async () => {
  let finish; wx.getFileSystemManager = () => ({ readFile: o => { finish = o.success; } });
  const subject = page('playground'); subject.identifyFruit(); await Promise.resolve(); store.saveSettings({ apiBase: 'https://other.example' });
  finish({ data: image }); await subject._identifyPromise;
  assert.equal(calls.length, 0); assert.equal(subject.data.identifyResult.fruit, null);
});

test('ink painting accepts a paired string token and polls the returned task', async () => {
  wx.request = o => { calls.push(o); o.success({ statusCode: 202, data: { taskId: 'job', status: 'queued' } }); };
  const subject = page('playground'); subject.data.paintKeyword = '霜降摘柿';
  subject.pollPaint = (context,id) => { assert.equal(context.token, token); assert.equal(id, 'job'); };
  await subject.generatePaint(); assert.equal(calls[0].header.Authorization, 'Bearer ' + token);
  assert.equal(calls[0].data.keyword, '霜降摘柿');
  subject.onUnload(); assert.equal(subject.data.paintBusy, false);
});

test('generated companion is saved at a real persistent path and becomes the active editor', async () => {
  wx.request = o => {
    calls.push(o);
    const data = o.url.endsWith('/uploads') ? { resourceId: 'r' } : o.method === 'POST' ? { taskId: 't', status: 'queued' } : { status: 'succeeded', imageUrl: 'https://example.com/result.png' };
    o.success({ statusCode: 200, data });
  };
  const subject = page('companion'); subject.onLoad(); subject._photoPath = 'wxfile://temp/fruit.png';
  await subject.generateCartoon();
  assert.equal(subject.data.genMessage, ''); assert.equal(subject.data.genBusy, false);
  assert.equal(store.getCompanion().kind, 'generated-image');
  assert.match(store.getCompanion().sourcePath, /^wxfile:\/\/usr\/companions\/personal\/gen-\d+\.png$/);
  assert.equal(subject._editor.config.sourcePath, store.getCompanion().sourcePath);
  assert.deepEqual(subject._editor.config.strokes, []);
  assert.equal(calls.filter(c => c.header).every(c => c.header.Authorization === 'Bearer ' + token), true);
});

test('failed companion upload stops immediately with the server error', async () => {
  wx.request = o => { calls.push(o); o.success({ statusCode: 503, data: { error: '图像服务尚未配置' } }); };
  const subject = page('companion'); subject.onLoad(); subject._photoPath = 'wxfile://temp/fruit.png';
  await subject.generateCartoon(); assert.equal(calls.length, 1); assert.match(subject.data.genMessage, /尚未配置/);
  assert.equal(store.getCompanion().kind, 'template');
});

test('selected photos stay local until cartoon generation and cannot bypass it', () => {
  const subject = page('companion'); subject.onLoad();
  const saved = store.getCompanion();
  subject.ensureMinWidth('wxfile://temp/fruit.png');
  assert.equal(subject.data.photoPath, 'wxfile://temp/fruit.png');
  assert.equal(typeof subject.usePhotoAsCompanion, 'undefined');
  assert.deepEqual(store.getCompanion(), saved, 'choosing a photo never saves the raw picture as the companion');
  assert.equal(calls.length, 0, 'local preview neither uploads nor copies to a companion record');
});

test('demo account reuses the device pairing: unpaired stays offline, paired generates', async () => {
  // 自定义服务地址且未配对：演示账户同样不发请求，并引导去配对。
  store.exitDemo(); store.clearAll(); store.saveSettings({ apiBase: 'http://127.0.0.1:8787' }); store.enterDemo();
  const offline = page('playground'); offline.identifyFruit(); offline.data.paintKeyword = '春耕'; await offline.generatePaint();
  assert.equal(calls.length, 0); assert.match(offline.data.paintNote, /配对/);
  // 团队后端：内置直连凭证生效，演示账户直接生成（数据仍落在演示分区）。
  store.exitDemo(); store.clearAll(); store.enterDemo();
  const builtIn = store.getCloudConnection().token;
  const learn = page('playground'); learn.identifyFruit(); await learn._identifyPromise;
  assert.equal(calls.length, 1); assert.equal(calls[0].header.Authorization, 'Bearer ' + builtIn);
  learn.data.paintKeyword = '春耕'; await learn.generatePaint();
  assert.equal(calls.length, 2); assert.match(calls[1].url, /ink-painting/);
  const companion = page('companion'); companion.onLoad(); companion._photoPath = 'wxfile://temp/a.png'; await companion.generateCartoon();
  assert.ok(calls.length >= 3, 'photo cartoon generation also rides the built-in credential');
});

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
