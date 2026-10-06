'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: turn } = require('node:timers/promises');
const { createCloudBaseImageAdapters } = require('../server/image-provider');

// mock @cloudbase/node-sdk：记录 generateImage 入参，可脚本化返回。
function fakeSdk(script) {
  const calls = [];
  const imageModel = {
    generateImage: async payload => { calls.push(payload); return script(payload); }
  };
  const sdk = {
    init(config) {
      assert.equal(config.env, 'env-1'); assert.equal(config.accessKey, 'akey');
      assert.ok(config.timeout >= 120000, 'image generation is slow, sdk timeout must be generous');
      return { ai: () => ({ createImageModel: name => { assert.equal(name, 'hunyuan-image'); return imageModel; } }) };
    }
  };
  sdk.calls = calls; return sdk;
}
const ok = () => ({ data: [{ url: 'https://result.example/fruit.png' }] });

async function finished(adapter, id) {
  for (let i = 0; i < 20; i += 1) { const state = await adapter.status(id); if (['succeeded', 'failed'].includes(state.status)) return state; await turn(); }
  throw new Error('task did not settle');
}

test('cloudbase adapters are disabled without env id or access key', () => {
  assert.equal(createCloudBaseImageAdapters({}), null);
  assert.equal(createCloudBaseImageAdapters({ accessKey: 'akey' }), null);
  assert.equal(createCloudBaseImageAdapters({ envId: 'env-1', accessKey: '' }), null);
});

test('companion adapter feeds the photo as base64 base image to the hunyuan i2i model', async () => {
  const sdk = fakeSdk(() => ok());
  const { companion } = createCloudBaseImageAdapters({ envId: 'env-1', accessKey: 'akey', sdk });
  const resource = await companion.upload({ bytes: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' });
  const id = await companion.create({ resource, requestId: 'req-1' });
  assert.equal((await finished(companion, id)).status, 'succeeded');
  assert.equal(sdk.calls.length, 1);
  assert.equal(sdk.calls[0].model, 'HY-Image-v3.0-I2I-ToB-v1.0.1');
  assert.deepEqual(sdk.calls[0].images, [Buffer.from('jpeg-bytes').toString('base64')]);
  assert.match(sdk.calls[0].prompt, /一个水果/); assert.match(sdk.calls[0].prompt, /纯白/);
  assert.equal(sdk.calls[0].size, '1024x1024');
});

test('companion create is idempotent per requestId and rejects unknown resources', async () => {
  const sdk = fakeSdk(() => new Promise(() => {}));
  const { companion } = createCloudBaseImageAdapters({ envId: 'env-1', accessKey: 'akey', sdk });
  const resource = await companion.upload({ bytes: Buffer.from('png-bytes'), mimeType: 'image/png' });
  const id = await companion.create({ resource, requestId: 'same' });
  assert.equal(await companion.create({ resource, requestId: 'same' }), id);
  assert.equal(sdk.calls.length, 1);
  await assert.rejects(() => companion.create({ resource: 'missing', requestId: 'other' }), /tcb_invalid_resource/);
});

test('text2image adapter sends the ink prompt to the hunyuan t2i model and reports the resulting url', async () => {
  const sdk = fakeSdk(() => ok());
  const { text2image } = createCloudBaseImageAdapters({ envId: 'env-1', accessKey: 'akey', sdk });
  const id = await text2image.create({ prompt: '中国传统水墨国风插画：枇杷', requestId: 'ink-1' });
  const state = await finished(text2image, id);
  assert.equal(state.status, 'succeeded'); assert.equal(state.imageUrl, 'https://result.example/fruit.png');
  assert.equal(sdk.calls[0].model, 'HY-Image-3.0-Plus-4090-Tob-v1.0');
  assert.equal(sdk.calls[0].prompt, '中国传统水墨国风插画：枇杷');
});

test('sdk failures and invalid image urls become failed tasks, never fake images', async () => {
  for (const script of [() => { throw new Error('quota'); }, () => ({}), () => ({ data: [{ url: 'http://insecure.example/x.png' }] })]) {
    const { text2image } = createCloudBaseImageAdapters({ envId: 'env-1', accessKey: 'akey', sdk: fakeSdk(script) });
    const id = await text2image.create({ prompt: '枇杷' });
    assert.deepEqual(await finished(text2image, id), { status: 'failed' });
  }
});

test('text2image rejects empty prompts', async () => {
  const sdk = fakeSdk(() => ok());
  const { text2image } = createCloudBaseImageAdapters({ envId: 'env-1', accessKey: 'akey', sdk });
  await assert.rejects(() => text2image.create({ prompt: '  ' }), /tcb_missing_prompt/);
  assert.equal(sdk.calls.length, 0);
});
