'use strict';

// 语音输入封装：双引擎（微信同声传译插件优先 / 原生录音 + 服务端 /api/asr 兜底）。
// 覆盖：引擎选择与降级、录音参数、状态机、权限引导、上传识别、错误归类、回调注册方式。
// 注意：微信开发者工具不支持录音，本文件只覆盖「除真实麦克风以外」的全部逻辑。
//
// 两条链路的**回调注册方式不同**，两个 stub 各自如实模拟：
//   · 插件 manager：onXxx 是可写数据属性、出厂值是空函数，`start()` 读属性当前值再 setCallback
//     → 必须**赋值**。所以 stub 用 `emit()` 触发，若引擎误用调用式，属性上还是空函数，测试立刻红。
//   · 录音器：onXxx 是**注册器方法**，会叠加监听器 → 必须调用式 + 去重。
// 服务端引擎的用例从 `recorder.handlers.onStop` 进入——那是真机上录音器真正回调的入口。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeechInput, ERROR_COPY } = require('../miniprogram/lib/speech-input');

const AUDIO = Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000' + 'x'.repeat(64)).toString('base64');

// 忠实模拟真实插件 manager（依据 2026-09-28 本机实测得到的属性描述符与 start 源码）。
function pluginStub() {
  const manager = { starts: [], stops: 0 };
  const names = ['onStart', 'onRecognize', 'onStop', 'onError'];
  for (const name of names) manager[name] = function () {};      // 出厂空函数
  manager.pristine = Object.fromEntries(names.map(name => [name, manager[name]]));
  // 模拟插件内部真正触发回调的那一刻。
  manager.emit = (name, event) => { if (typeof manager[name] === 'function') manager[name](event); };
  manager.start = options => {
    manager.starts.push(options);
    // 真实 start 内部是 setCallback("onStop", this.onStop)：读的是调用那一刻的属性值。
    manager.registered = Object.fromEntries(names.map(name => [name, manager[name]]));
  };
  manager.stop = () => { manager.stops += 1; };
  const plugin = { getRecordRecognitionManager: () => manager, textToSpeech: () => {} };
  return { plugin, manager };
}
// 忠实模拟 wx.getRecorderManager()：onXxx 是注册器方法，会叠加监听器。
function recorderStub() {
  const recorder = { starts: [], stops: 0, handlers: {}, bindings: 0 };
  ['onStart', 'onStop', 'onError'].forEach(name => {
    recorder[name] = handler => { recorder.bindings += 1; recorder.handlers[name] = handler; };
  });
  recorder.start = options => { recorder.starts.push(options); };
  recorder.stop = () => { recorder.stops += 1; };
  return recorder;
}
function input(options = {}) {
  const seen = { interim: [], final: [], errors: [], states: [] };
  const voice = createSpeechInput({
    ...options,
    onInterim: text => seen.interim.push(text),
    onFinal: text => seen.final.push(text),
    onError: message => seen.errors.push(message),
    onStateChange: state => seen.states.push(state)
  });
  return { voice, seen };
}
// 服务端引擎的固定装置：一个能被测试抓住的录音器 + 一段合法音频。
function serverInputOn(recorder, extra = {}) {
  const built = input({
    engines: ['server'],
    getRecorder: () => recorder,
    readAudio: () => Promise.resolve(AUDIO),
    ...extra
  });
  return { ...built, recorder };
}
function serverInput(extra = {}) { return serverInputOn(recorderStub(), extra); }

// ============================== 引擎一：微信同声传译插件 ==============================
test('the plugin is preferred and records with zh_CN and a 60 s cap', () => {
  const { plugin, manager } = pluginStub();
  const { voice, seen } = input({ getPlugin: () => plugin });
  assert.equal(voice.start(), true);
  assert.equal(voice.engine, 'plugin', 'the native plugin wins when it is authorized');
  assert.deepEqual(manager.starts, [{ lang: 'zh_CN', duration: 60000 }]);
  assert.equal(voice.listening, true);
  assert.deepEqual(seen.states, ['recording']);
  voice.stop();
  assert.equal(manager.stops, 1);
});

// 这条锁死 2026-09-28 踩到的那个坑：官方示例用赋值、官方文档方法表像注册器，
// 写成调用式会静默空转——属性上还是出厂空函数，回调永远不来。
test('plugin callbacks are registered by assignment, never by calling the stub', () => {
  const { plugin, manager } = pluginStub();
  const { voice } = input({ getPlugin: () => plugin });
  voice.start();
  for (const name of ['onStart', 'onStop', 'onError', 'onRecognize']) {
    assert.notEqual(manager[name], manager.pristine[name], name + ' must be replaced, not called');
    assert.equal(manager.registered[name], manager[name], name + ' must be in place before start() reads it');
  }
  // 反证：只调用不赋值的话，start 快照到的仍是出厂空函数 —— 回调永远收不到。
  const untouched = pluginStub();
  untouched.manager.onStop(untouched.manager.onStop);
  untouched.manager.start({ lang: 'zh_CN', duration: 60000 });
  assert.equal(untouched.manager.registered.onStop, untouched.manager.pristine.onStop);
});

test('plugin interim results stream into the box; the final result fires exactly once', () => {
  const { plugin, manager } = pluginStub();
  const { voice, seen } = input({ getPlugin: () => plugin });
  voice.start();
  manager.emit('onRecognize', { result: '怎么挑西' });
  manager.emit('onRecognize', { result: '怎么挑西瓜' });
  manager.emit('onRecognize', { result: '  ' });
  manager.emit('onStop', { result: '怎么挑西瓜 ' });
  manager.emit('onStop', { result: '怎么挑西瓜 ' });
  assert.deepEqual(seen.interim, ['怎么挑西', '怎么挑西瓜']);
  assert.deepEqual(seen.final, ['怎么挑西瓜'], 'duplicate final results are ignored');
  assert.deepEqual(seen.states, ['recording', 'idle']);
  assert.equal(voice.listening, false);
});

test('an English interface asks the plugin for en_US', () => {
  const { plugin, manager } = pluginStub();
  const { voice } = input({ getPlugin: () => plugin });
  voice.start('en');
  assert.deepEqual(manager.starts, [{ lang: 'en_US', duration: 60000 }]);
});

test('official plugin retcode is read (not code) and mapped to its own copy', () => {
  const { plugin, manager } = pluginStub();
  const { voice, seen } = input({ getPlugin: () => plugin });
  voice.start();
  manager.emit('onError', { retcode: -30006, msg: 'timeout' });
  assert.deepEqual(seen.errors, [ERROR_COPY['-30006']]);
  assert.match(seen.errors[0], /超时/);
  assert.equal(voice.state, 'idle');
  const second = input({ getPlugin: () => plugin });
  second.voice.start();
  manager.emit('onError', { retcode: -40001, code: 60003 });
  assert.deepEqual(second.seen.errors, [ERROR_COPY['-40001']], 'retcode wins over code');
});

test('every official WechatSI error code keeps a copy entry', () => {
  const official = ['-30001', '-30002', '-30003', '-30004', '-30005', '-30006', '-30007',
    '-30008', '-30009', '-30010', '-30011', '-30012', '-30013', '-40001'];
  official.forEach(code => assert.ok(ERROR_COPY[code], 'missing copy for official code ' + code));
});

// ============================== 引擎二：服务端兜底 ==============================
test('a missing plugin falls back to native recording plus the server recognizer', async () => {
  const recorder = recorderStub();
  const sent = [];
  const { voice, seen } = input({
    getPlugin: () => { throw new Error('plugin not declared'); },
    getRecorder: () => recorder,
    readAudio: () => Promise.resolve(AUDIO),
    transcribe: payload => { sent.push(payload); return Promise.resolve({ text: ' 怎么挑西瓜 ' }); }
  });
  assert.equal(voice.start(), true);
  assert.equal(voice.engine, 'server', 'the fallback is observable, not silent');
  assert.deepEqual(recorder.starts, [{ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 24000, format: 'mp3' }]);
  await recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 1200 });
  assert.deepEqual(sent, [{ audio: AUDIO, format: 'mp3', language: 'zh' }]);
  assert.deepEqual(seen.final, ['怎么挑西瓜']);
  // 服务端引擎多一个「识别中」等待态；插件引擎没有。
  assert.deepEqual(seen.states, ['recording', 'recognizing', 'idle']);
  await recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 1200 });
  assert.equal(sent.length, 1, 'a late duplicate onStop must not upload twice');
});

test('a plugin that refuses to start hands over to the server engine', () => {
  const { plugin } = pluginStub();
  plugin.getRecordRecognitionManager = () => ({ start() { throw new Error('record:fail'); }, stop() {} });
  const recorder = recorderStub();
  const { voice } = input({ getPlugin: () => plugin, getRecorder: () => recorder });
  assert.equal(voice.start(), true);
  assert.equal(voice.engine, 'server');
  assert.equal(recorder.starts.length, 1);
});

test('the server engine can be forced on its own and carries the language through', async () => {
  const sent = [];
  const { voice, recorder } = serverInput({
    transcribe: payload => { sent.push(payload.language); return Promise.resolve({ text: 'x' }); }
  });
  voice.start('yue');
  await recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 900 });
  assert.deepEqual(sent, ['yue'], 'Cantonese only exists on the server engine');
});

test('unusable recordings report the right copy and never reach the provider', async () => {
  let calls = 0;
  const transcribe = () => { calls++; return Promise.resolve({ text: 'x' }); };

  const short = serverInput({ transcribe });
  short.voice.start();
  await short.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 80 });
  assert.deepEqual(short.seen.errors, [ERROR_COPY.short]);

  const silent = serverInput({ transcribe: () => Promise.resolve({ text: '   ' }) });
  silent.voice.start();
  await silent.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 1500 });
  assert.deepEqual(silent.seen.errors, [ERROR_COPY.short]);

  const unreadable = serverInput({ transcribe, readAudio: () => Promise.reject(new Error('read')) });
  unreadable.voice.start();
  await unreadable.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 1500 });
  assert.deepEqual(unreadable.seen.errors, [ERROR_COPY.read]);

  const huge = 'A'.repeat(Math.ceil(1.5 * 1024 * 1024 / 3) * 4 + 8);
  const oversized = serverInput({ transcribe, readAudio: () => Promise.resolve(huge) });
  oversized.voice.start();
  await oversized.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 3000 });
  assert.deepEqual(oversized.seen.errors, [ERROR_COPY.long]);

  assert.equal(calls, 0, 'no provider call for unusable audio');
});

test('server copy passes through, transport failures are rewritten for the voice feature', async () => {
  const server = serverInput({ transcribe: () => Promise.reject(new Error('录音过长，请分段提问')) });
  server.voice.start();
  await server.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 3000 });
  assert.deepEqual(server.seen.errors, ['录音过长，请分段提问'], 'server InputError copy is already user-facing');

  const offline = serverInput({ transcribe: () => { throw new Error(ERROR_COPY.offline); } });
  offline.voice.start();
  await offline.recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 3000 });
  assert.deepEqual(offline.seen.errors, [ERROR_COPY.offline]);
});

test('recorder errors are classified from errMsg text, with auth checked first', () => {
  const { voice, seen, recorder } = serverInput();
  assert.equal(voice.copyFor('permission'), ERROR_COPY.permission);
  assert.equal(voice.copyFor('record:fail auth deny'), ERROR_COPY.permission, 'auth wins over the generic fail branch');
  assert.equal(voice.copyFor('operateRecorder:fail timeout'), ERROR_COPY.timeout);
  assert.equal(voice.copyFor('some unknown failure'), ERROR_COPY.start);
  assert.equal(voice.copyFor(''), ERROR_COPY.generic);
  assert.equal(voice.copyFor(undefined), ERROR_COPY.generic);
  assert.equal(voice.copyFor(-30006), ERROR_COPY['-30006'], 'numeric retcodes are accepted too');
  voice.start();
  recorder.handlers.onError({ errMsg: 'record:fail auth deny' });
  assert.deepEqual(seen.errors, [ERROR_COPY.permission]);
  assert.equal(voice.state, 'idle', 'state resets after a recorder error');
});

// ============================== 共享行为 ==============================
test('no engine at all degrades honestly for keyboard input', () => {
  const { voice, seen } = input({ getPlugin: () => null, getRecorder: () => null });
  assert.equal(voice.start(), false);
  assert.deepEqual(seen.errors, [ERROR_COPY.unavailable]);
  assert.equal(voice.engine, null);
});

test('denied microphone permission routes the user to settings instead of recording', async () => {
  const { plugin, manager } = pluginStub();
  const { voice, seen } = input({ getPlugin: () => plugin });
  const previousWx = global.wx;
  global.wx = {
    getSetting: options => options.success({ authSetting: { 'scope.record': false } }),
    openSetting: options => options.success({ authSetting: {} })
  };
  try {
    assert.equal(await voice.toggle(), false);
    assert.equal(manager.starts.length, 0, 'recording never starts without permission');
    assert.deepEqual(seen.errors, [ERROR_COPY.permission]);
  } finally { global.wx = previousWx; }
});

test('toggle is a two-tap gesture and ignores taps while the server engine is recognizing', async () => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const { voice, seen, recorder } = serverInput({ transcribe: () => deferred });
  const previousWx = global.wx;
  global.wx = { getSetting: options => options.success({ authSetting: { 'scope.record': true } }) };
  try {
    await voice.toggle();
    assert.equal(voice.state, 'recording');
    await voice.toggle();
    assert.equal(recorder.stops, 1, 'second tap stops the recorder');
    const pending = recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 1000 });
    assert.equal(voice.state, 'recognizing');
    assert.equal(await voice.toggle(), false, 'a tap while recognizing must not start a new recording');
    assert.equal(recorder.starts.length, 1);
    release({ text: '怎么挑西瓜' });
    await pending;
    assert.deepEqual(seen.final, ['怎么挑西瓜']);
    assert.equal(voice.state, 'idle');
  } finally { global.wx = previousWx; }
});

// 插件 manager 与录音器的单例性质不同，两条都要守住：
//   · 插件走赋值式 → 后一次赋值**替换**前一次，天然不叠加；
//   · 录音器走注册器 → 必须靠 bindOnce 去重，否则页面来回切换就「录一次、回调多次」。
test('re-binding the plugin manager replaces the previous owner instead of stacking', () => {
  const { plugin, manager } = pluginStub();
  const first = input({ getPlugin: () => plugin });
  first.voice.start();
  const second = input({ getPlugin: () => plugin });
  second.voice.start();
  manager.emit('onStop', { result: '怎么挑西瓜' });
  assert.deepEqual(first.seen.final, [], 'the replaced instance must stop receiving events');
  assert.deepEqual(second.seen.final, ['怎么挑西瓜']);
});

test('the recorder is a registrar-style singleton, so it is bound exactly once', () => {
  const recorder = recorderStub();
  const first = serverInputOn(recorder);
  first.voice.start();
  const second = serverInputOn(recorder);
  second.voice.start();
  assert.equal(recorder.bindings, 3, 'a registrar-style singleton must not accumulate listeners');
  recorder.handlers.onStop({ tempFilePath: 'wxfile://tmp/a.mp3', duration: 80 });
  assert.deepEqual(first.seen.errors, [], 'the replaced instance must stop receiving events');
  assert.deepEqual(second.seen.errors, [ERROR_COPY.short], 'only the newest owner handles the event');
});

test('every user-facing copy string is present and non-empty', () => {
  Object.entries(ERROR_COPY).forEach(([key, value]) => {
    assert.equal(typeof value, 'string', key + ' must be a string');
    assert.ok(value.length >= 6, key + ' must be a readable sentence');
  });
  assert.ok(ERROR_COPY.permission.includes('权限'));
  assert.ok(ERROR_COPY.offline.includes('配对'));
  assert.ok(ERROR_COPY.short.includes('听清'));
});

// 这条守着「声明了插件就必须用」：app.json 声明 plugins.WechatSI 要付出 80082 的风险成本，
// 只有代码真的调它才划算。反过来若哪天彻底放弃插件，这条会失败，提醒同步删声明。
test('the module really calls requirePlugin, which justifies the app.json declaration', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/lib/speech-input.js'), 'utf8');
  assert.match(source, /requirePlugin\(\s*PLUGIN_NAME\s*\)/, 'the plugin path must stay wired up');
  assert.ok(source.includes('/api/asr'), 'and the server fallback must stay wired up too');
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.equal(app.plugins && app.plugins.WechatSI && app.plugins.WechatSI.provider, 'wx069ba97219f66d99');
});
