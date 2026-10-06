'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransport, callModel } = require('../server/provider');
const { readConfig } = require('../server/config');

// mock @cloudbase/node-sdk：记录 generateText 入参，可脚本化返回。
function fakeSdk(script) {
  const calls = [];
  const model = {
    generateText: async payload => { calls.push(payload); return script(payload); }
  };
  return {
    calls,
    init(config) {
      assert.equal(config.env, 'env-1'); assert.equal(config.accessKey, 'akey');
      assert.ok(config.timeout >= 60000, 'sdk timeout must cover the per-task timeout');
      return { ai: () => ({ createModel: group => { assert.equal(group, 'cloudbase'); return model; } }) };
    }
  };
}
const baseConfig = {
  provider: 'cloudbase',
  model: 'hy3',
  timeoutMs: 30000,
  cloudbase: { envId: 'env-1', accessKey: 'akey' }
};
const okText = () => ({ text: '{"answer":"好的"}' });

test('cloudbase transport sends system+user, temperature 0, thinking disabled and bounded max_tokens', async () => {
  const sdk = fakeSdk(() => okText());
  const transport = createTransport({ ...baseConfig, model: 'hy3' }, undefined, sdk);
  const raw = await transport({ prompt: { system: 'sys', user: 'usr', maxTokens: 500 } });
  assert.equal(raw, '{"answer":"好的"}');
  assert.equal(sdk.calls.length, 1);
  assert.equal(sdk.calls[0].model, 'hy3');
  assert.deepEqual(sdk.calls[0].messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
  assert.equal(sdk.calls[0].temperature, 0);
  assert.equal(sdk.calls[0].max_tokens, 500);
  assert.deepEqual(sdk.calls[0].thinking, { type: 'disabled' });
  assert.equal(sdk.calls[0].response_format, undefined, 'response_format 不透传，靠 JSON 提取兜底');
});

test('cloudbase transport maps sdk failures to explicit model failure codes, never fake content', async () => {
  for (const script of [() => { throw new Error('channel'); }, () => ({ text: '  ' }), () => ({ error: { code: 429 } }), () => null]) {
    const transport = createTransport({ ...baseConfig }, undefined, fakeSdk(script));
    await assert.rejects(() => transport({ prompt: { system: 's', user: 'u' } }), error => /^model_(unavailable|empty_response|http_error)$/.test(error.code));
  }
});

test('cloudbase transport refuses vision prompts (vision keeps its own dashscope channel)', async () => {
  const transport = createTransport({ ...baseConfig }, undefined, fakeSdk(() => okText()));
  await assert.rejects(() => transport({ prompt: { system: 's', user: 'u', image: { base64: 'x', mimeType: 'image/jpeg' } } }), error => error.code === 'vision_disabled');
});

test('cloudbase transport output still flows through callModel json extraction', async () => {
  const transport = createTransport({ ...baseConfig }, undefined, fakeSdk(() => ({ text: '```json\n{"ok":true}\n```' })));
  const value = await callModel(transport, 't', { system: 's', user: 'u' }, 5000);
  assert.deepEqual(value, { ok: true });
});

test('MODEL_PROVIDER=cloudbase requires env id + access key and model name in config', () => {
  const good = readConfig({ MODEL_PROVIDER: 'cloudbase', MODEL_NAME: 'hy3', TCB_ENV_ID: 'env-1', TCB_ACCESS_KEY: 'akey', HOST: '127.0.0.1' });
  assert.equal(good.provider, 'cloudbase');
  assert.deepEqual(good.cloudbase, { envId: 'env-1', accessKey: 'akey' });
  for (const partial of [
    { MODEL_PROVIDER: 'cloudbase', MODEL_NAME: 'hy3' },
    { MODEL_PROVIDER: 'cloudbase', MODEL_NAME: 'hy3', TCB_ENV_ID: 'env-1' }
  ]) {
    assert.equal(readConfig(partial).provider, 'disabled', JSON.stringify(partial));
  }
  assert.throws(() => readConfig({ MODEL_PROVIDER: 'nope', HOST: '127.0.0.1' }), /MODEL_PROVIDER/);
});
