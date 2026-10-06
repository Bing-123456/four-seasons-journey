'use strict';

const path = require('node:path');
const { loadEnv } = require('./env');
const { readConfig } = require('./config');
const { createServer } = require('./app');
const { createDashScopeImageAdapter, createDashScopeText2ImageAdapter, createCloudBaseImageAdapters } = require('./image-provider');
const { createSpeechAdapter } = require('./speech');
const { createAsrAdapter } = require('./asr');

// 进程防崩兜底（评审 10.5 教训：第三方 SDK 偶发在异步链外抛错，Node 默认因此退出，
// 导致整个容器反复崩溃 502）。记录日志但不退出，保证其余功能持续可用。
process.on('unhandledRejection', reason => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', error => { console.error('[uncaughtException]', error); });

function start() {
  loadEnv(path.resolve(__dirname, '..', '.env'));
  const config = readConfig();
  let imageAdapter = null, inkAdapter = null;
  if (config.image && config.image.provider === 'dashscope') {
    imageAdapter = createDashScopeImageAdapter({ apiKey: config.image.apiKey, baseUrl: config.image.baseUrl });
    inkAdapter = createDashScopeText2ImageAdapter({ apiKey: config.image.apiKey, baseUrl: config.image.baseUrl });
  } else if (config.image && config.image.provider === 'cloudbase') {
    const adapters = createCloudBaseImageAdapters(config.image.cloudbase);
    if (adapters) { imageAdapter = adapters.companion; inkAdapter = adapters.text2image; }
  }
  const server = createServer({ config, imageAdapter, inkAdapter, speechAdapter: createSpeechAdapter(config.speech), asrAdapter: createAsrAdapter(config.asr) });
  server.listen(config.port, config.host, () => {
    const address = server.address();
    console.log('瓜游记服务已启动，端口 ' + address.port + '，模式 ' + config.provider);
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '端口已占用，请修改 PORT。' : '服务启动失败，请检查配置。');
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections?.();
  });
  return server;
}

if (require.main === module) {
  try { start(); }
  catch (error) {
    console.error('服务配置无效，请参照 .env.example 检查配置。');
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

module.exports = { start };
