'use strict';

const path = require('node:path');
const { loadEnv } = require('./env');
const { readConfig } = require('./config');
const { createServer } = require('./app');
const { createDashScopeImageAdapter, createDashScopeText2ImageAdapter } = require('./image-provider');
const { createSpeechAdapter } = require('./speech');
const { createAsrAdapter } = require('./asr');

function start() {
  loadEnv(path.resolve(__dirname, '..', '.env'));
  const config = readConfig();
  const imageAdapter = config.image && config.image.provider === 'dashscope' ? createDashScopeImageAdapter({ apiKey: config.image.apiKey, baseUrl: config.image.baseUrl }) : null;
  const inkAdapter = config.image && config.image.provider === 'dashscope' ? createDashScopeText2ImageAdapter({ apiKey: config.image.apiKey, baseUrl: config.image.baseUrl }) : null;
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
