'use strict';

// 果灵搜索 · 语音输入（评审增强：只要输入，不需要输出）。
//
// 双引擎，按顺序挑第一个能用的：
//   ① **微信同声传译插件**（WechatSI，provider wx069ba97219f66d99）——流式，边说边出字，
//      免费（250 条/分钟、3 万条/天），不消耗我们的额度，不需要配对云端服务。**首选。**
//   ② **原生录音 + 服务端识别**——wx.getRecorderManager() → base64 → POST /api/asr
//      → DashScope qwen3-asr-flash。零后台依赖、60s、带方言参数。**兜底。**
//
// 为什么不是"只用插件"：0.7.7 出过一次事故——app.json 声明了插件但后台没授权，
// 上传被 80082 拒，只好临时摘掉声明，结果语音输入**线上静默降级为「暂不可用」**，
// 而 check 与测试全绿。**插件是否授权是后台状态，代码无法保证**，所以必须有一条
// 自己能掌控的兜底路径。反过来，声明了插件就一定要用到它（否则白白承担 80082 风险），
// 这一条由 scripts/check-project.js 双向拦截。
//
// ⚠️ 前置条件（走插件时缺一不可）：
//   ① 小程序后台「设置 → 第三方设置 → 插件管理」已添加「微信同声传译」
//      （未添加时上传报 80082 插件未授权）—— 2026-09-28 已确认本小程序**已授权**；
//   ② app.json 声明 plugins.WechatSI。顺序不能颠倒。
//
// 插件 API 要点（2026-09-28 在本机开发者工具里**实测**得到，不是抄文档）：
//   start   → { lang, duration }；lang ∈ zh_CN / en_US / zh_HK / sichuanhua；duration 上限 60000ms
//   onStop  → { tempFilePath, duration, fileSize, result }
//   onError → { retcode, msg }   ← 是 retcode，不是 code；错误码为负数 -30001 ~ -40001
//   onRecognize **不在官方 API 文档中**，但实测存在，同样走赋值式
//
// ⚠️⚠️ **回调只能用「赋值式」注册，不能用调用式**——这是本文件最容易写错的一处：
//     manager.onStop = fn     ← 对
//     manager.onStop(fn)      ← 错：静默空转，回调永远不来，界面上表现为「点了没反应」
//   依据：`manager.start` 的源码就是 `setCallback("onStop", this.onStop)` 这样把**属性当前的值**
//   注册进去的，而 onStart/onStop/onError/onRecognize 的出厂值都是空函数 `function(e){}`。
//   官方文档的方法表写成「onStop callback」很容易被误读成注册器，**以官方示例代码为准**。
//   （对照：`wx.getRecorderManager().onStop(cb)` 才是真·注册器，而且会叠加监听器——见 bindOnce。）
//
// 状态机：idle → recording（录音中）→ [recognizing（仅服务端引擎）] → idle
// onStateChange 回传这些值；voice.engine 在首次 start() 后为 'plugin' | 'server'。
// 约束：微信开发者工具不支持录音，必须在真机验证。

const PLUGIN_NAME = 'WechatSI';
// 插件只认这几个 lang，且没有粤语档 —— 想要粤语就得用服务端引擎。这是走插件时的已知损失。
const PLUGIN_LANG = { zh: 'zh_CN', yue: 'zh_CN', en: 'en_US' };
const RECORD_MS = 60000;
const SAMPLE_RATE = 16000;
const ENCODE_BIT_RATE = 24000;
// 与服务端 server/asr.js 的 MAX_AUDIO_BYTES 对齐：超限就别浪费一次上传。
const MAX_AUDIO_BYTES = 1.5 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const LANGUAGES = ['zh', 'yue', 'en'];

const ERROR_COPY = {
  // —— 插件错误码（onError 的 retcode，负数）——
  '-30001': '录音接口出错，请重试',
  '-30002': '录音被中断，请重新点击麦克风',
  '-30003': '录音数据传输失败，请检查网络后重试',
  '-30004': '没能取到识别结果，请重试',
  '-30005': '语音识别服务异常，请稍后再试',
  '-30006': '识别超时，请说得短一些',
  '-30007': '录音参数有误，请重试',
  '-30008': '网络异常，请检查网络后重试',
  '-30009': '语音服务鉴权失败，请稍后再试',
  '-30010': '语音服务连接失败，请检查网络',
  '-30011': '正在识别中，请稍候',
  '-30012': '当前没有正在进行的录音',
  '-30013': '识别失败，请重试',
  '-40001': '语音识别调用过于频繁，请稍后再试',
  // —— 本地 / 服务端 ——
  permission: '录音权限未开启，请在设置中允许麦克风',
  interrupted: '录音被中断，请重新点击麦克风',
  start: '录音启动失败，请重试',
  read: '录音文件读取失败，请重试',
  short: '没有听清，请靠近麦克风重试',
  long: '录音过长，请分段提问',
  offline: '语音输入需要先连接云端服务，请在「我的」完成配对',
  network: '网络异常，请检查网络后重试',
  timeout: '识别超时，请说得短一些',
  unavailable: '语音输入暂不可用，请改用键盘输入',
  generic: '语音识别未成功，请重试'
};

// 录音器回调只给 errMsg 字符串，没有稳定错误码，只能按文本归类。
// 顺序敏感：auth 分支必须排在通用 fail 之前。
const RECORDER_PATTERNS = [
  [/auth\s*deny|authorize:fail|permission|not authorized|未授权/i, 'permission'],
  [/interrupt/i, 'interrupted'],
  [/timeout|time ?out/i, 'timeout'],
  [/is recording|already/i, 'start'],
  [/record:fail|start:fail|operateRecorder:fail|fail/i, 'start']
];

function copyOf(value) {
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string' || !value) return ERROR_COPY.generic;
  if (Object.hasOwn(ERROR_COPY, value)) return ERROR_COPY[value];
  for (const [pattern, reason] of RECORDER_PATTERNS) if (pattern.test(value)) return ERROR_COPY[reason];
  return ERROR_COPY.generic;
}

// `wx.getRecorderManager()` 是**全局单例**，而它的 onStart/onStop/onError 是**真·注册器方法**
// （`recorder.onStop(cb)`），重复调用会叠加监听器，页面来回切换就会「录一次音、回调触发多次」。
// 这里用一张 WeakMap 保证每个 manager 只绑定一次，回调转发给当前持有它的实例。
//
// ⚠️ 只有录音器需要这个。插件的 manager 走**赋值式**，赋值本身就是替换而非叠加，天然幂等，
//    所以插件引擎直接赋 `manager.onStop = fn` 即可，不经过这里。
const managerOwners = new WeakMap();
function bindOnce(manager, names, instance) {
  if (!managerOwners.has(manager)) {
    managerOwners.set(manager, null);
    const forward = name => event => {
      const owner = managerOwners.get(manager);
      if (!owner || typeof owner[name] !== 'function') return undefined;
      const result = owner[name](event);
      // 小程序侧不 await 回调，但服务端引擎的 handleStop 是异步的：挂一个空 catch 防止
      // 它变成 unhandledRejection，同时把原 promise 返回出去，好让调用方（测试）能等到
      // 这次识别真正结束。真机路径不受影响。
      if (result && typeof result.then === 'function') result.then(undefined, () => {});
      return result;
    };
    for (const name of names) if (typeof manager[name] === 'function') manager[name](forward('handle' + name.slice(2)));
  }
  managerOwners.set(manager, instance);
  return manager;
}

function readAudio(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.getFileSystemManager) { reject(new Error('read')); return; }
    wx.getFileSystemManager().readFile({
      filePath, encoding: 'base64',
      success: result => resolve(result && result.data),
      fail: () => reject(new Error('read'))
    });
  });
}

// 服务端引擎的默认通道：走已配对的服务端。服务端返回的 InputError.message 本身就是
// 给用户看的中文，直接用；只有「连不上 / 配对失效」这类传输层文案需要改写——
// media-service 的兜底文案是给图片场景写的，直接透出会提到「图片服务」。
function defaultTranscribe(payload) {
  const media = require('../../lib/media-service');
  let context;
  try { context = media.capture(); }
  catch (error) { throw new Error(ERROR_COPY.offline); }
  return media.request(context, 'POST', '/api/asr', payload).catch(error => {
    const message = String((error && error.message) || '');
    if (/配对|服务连接|账户已变更/.test(message)) throw new Error(ERROR_COPY.offline);
    if (/超时/.test(message)) throw new Error(ERROR_COPY.timeout);
    if (/未连接|检查连接|网络/.test(message)) throw new Error(ERROR_COPY.network);
    throw error;
  });
}

// ============================ 引擎一：微信同声传译插件 ============================
function probePlugin(handlers) {
  try {
    const get = typeof handlers.getPlugin === 'function' ? handlers.getPlugin
      : (typeof requirePlugin === 'function' ? () => requirePlugin(PLUGIN_NAME) : null);
    const plugin = get ? get() : null;
    return plugin && typeof plugin.getRecordRecognitionManager === 'function' ? plugin : null;
  } catch (error) { return null; }
}

function createPluginEngine(handlers, hooks, plugin) {
  let recording = false;
  const self = {
    handleStart() { /* 状态在 start() 里同步置位 */ },
    handleRecognize(event) {
      const text = event && typeof event.result === 'string' ? event.result.trim() : '';
      if (recording && text) hooks.interim(text);
    },
    handleStop(event) {
      if (!recording) return;   // 迟到的 onStop 不该打断当前状态机
      recording = false;
      hooks.final(event && typeof event.result === 'string' ? event.result : '');
    },
    handleError(event) {
      recording = false;
      // 官方 onError 回调字段是 retcode；个别封装回传 code，两个都读。
      const code = event && (event.retcode !== undefined ? event.retcode : event.code);
      hooks.error(code !== undefined ? copyOf(code) : copyOf(event && event.msg));
    },
    start(nextLanguage) {
      try {
        const manager = plugin.getRecordRecognitionManager();
        if (!manager || typeof manager.start !== 'function') return false;
        // ⚠️ 赋值式注册，顺序不能反：manager.start 内部会 setCallback("onStop", this.onStop)，
        // 所以必须**先把 handler 挂到属性上、再调 start**。写成 manager.onStop(fn) 是静默空转。
        manager.onStart = self.handleStart;
        manager.onStop = self.handleStop;
        manager.onError = self.handleError;
        // onRecognize 不在官方文档里，个别版本可能挂不上；挂不上不该拖垮整条插件路径。
        try { manager.onRecognize = self.handleRecognize; } catch (error) { /* 该版本没有，忽略 */ }
        manager.start({ lang: PLUGIN_LANG[nextLanguage] || 'zh_CN', duration: RECORD_MS });
        recording = true;
        return true;
      } catch (error) { recording = false; return false; }
    },
    stop() { try { plugin.getRecordRecognitionManager().stop(); } catch (error) { recording = false; } }
  };
  return self;
}

// ============================ 引擎二：原生录音 + 服务端 ASR ============================
function createServerEngine(handlers, hooks) {
  const read = typeof handlers.readAudio === 'function' ? handlers.readAudio : readAudio;
  const send = typeof handlers.transcribe === 'function' ? handlers.transcribe : defaultTranscribe;
  let recording = false;
  let language = 'zh';

  function recorder() {
    const get = typeof handlers.getRecorder === 'function' ? handlers.getRecorder
      : (typeof wx !== 'undefined' && wx.getRecorderManager ? () => wx.getRecorderManager() : null);
    const manager = get ? get() : null;
    return manager && typeof manager.start === 'function' ? manager : null;
  }

  const self = {
    handleStart() { /* 状态在 start() 里同步置位 */ },
    async handleStop(event) {
      if (!recording) return;
      const filePath = event && typeof event.tempFilePath === 'string' ? event.tempFilePath : '';
      const duration = event && typeof event.duration === 'number' ? event.duration : null;
      if (!filePath || (duration !== null && duration < 200)) { recording = false; hooks.error(ERROR_COPY.short); return; }
      hooks.recognizing();
      try {
        const base64 = await read(filePath);
        if (typeof base64 !== 'string' || !base64) throw new Error('read');
        if (base64.length > MAX_BASE64) throw new Error('long');
        const result = await send({ audio: base64, format: 'mp3', language });
        recording = false;
        hooks.final(result && result.text);
      } catch (error) {
        recording = false;
        // ERROR_COPY 的 key（read / long / offline …）走本地文案；
        // 服务端返回的中文文案直接透出——它本来就是写给用户看的。
        const key = error && error.message;
        hooks.error(Object.hasOwn(ERROR_COPY, key) ? ERROR_COPY[key] : (key || ERROR_COPY.generic));
      }
    },
    handleError(event) {
      recording = false;
      hooks.error(copyOf(event && (event.errMsg || event.errmsg || event.code)));
    },
    start(nextLanguage) {
      if (LANGUAGES.includes(nextLanguage)) language = nextLanguage;
      try {
        const manager = recorder();
        if (!manager) return false;
        bindOnce(manager, ['onStart', 'onStop', 'onError'], self);
        manager.start({ duration: RECORD_MS, sampleRate: SAMPLE_RATE, numberOfChannels: 1, encodeBitRate: ENCODE_BIT_RATE, format: 'mp3' });
        recording = true;
        return true;
      } catch (error) { recording = false; return false; }
    },
    stop() {
      try {
        const manager = recorder();
        if (manager) manager.stop();
      } catch (error) { recording = false; hooks.error(ERROR_COPY.interrupted); }
    }
  };
  return self;
}

// ==================================== 对外接口 ====================================
function createSpeechInput(options) {
  const handlers = options || {};
  let candidates = null;
  let active = null;
  let state = 'idle';
  let lastFinal = '';

  function emit(next) {
    if (typeof handlers.onStateChange === 'function') handlers.onStateChange(next);
  }
  function fail(message) {
    state = 'idle'; emit('idle');
    if (typeof handlers.onError === 'function') handlers.onError(message);
  }
  const hooks = {
    interim: text => { if (state === 'recording' && typeof handlers.onInterim === 'function') handlers.onInterim(text); },
    recognizing: () => { if (state !== 'recording') return; state = 'recognizing'; emit('recognizing'); },
    final: text => {
      const value = String(text || '').trim();
      state = 'idle'; emit('idle');
      if (!value) { if (typeof handlers.onError === 'function') handlers.onError(ERROR_COPY.short); return; }
      if (value !== lastFinal) { lastFinal = value; if (typeof handlers.onFinal === 'function') handlers.onFinal(value); }
    },
    error: message => fail(message)
  };

  // 按 handlers.engines 的顺序挑引擎；插件探测失败就自然跳到服务端。
  function enginesInOrder() {
    const names = Array.isArray(handlers.engines) && handlers.engines.length ? handlers.engines : ['plugin', 'server'];
    const list = [];
    for (const name of names) {
      if (name === 'plugin') {
        const plugin = probePlugin(handlers);
        if (plugin) list.push({ name: 'plugin', engine: createPluginEngine(handlers, hooks, plugin) });
      } else if (name === 'server') {
        list.push({ name: 'server', engine: createServerEngine(handlers, hooks) });
      }
    }
    return list;
  }
  function requestRecordScope() {
    return new Promise(resolve => {
      if (typeof wx === 'undefined' || !wx.getSetting) { resolve(true); return; }
      wx.getSetting({
        success: setting => {
          const auth = setting.authSetting && setting.authSetting['scope.record'];
          if (auth === false) {
            if (typeof wx.openSetting === 'function') {
              wx.openSetting({
                success: opened => resolve(!!(opened.authSetting && opened.authSetting['scope.record'])),
                fail: () => resolve(false)
              });
            } else resolve(false);
            return;
          }
          resolve(true);
        },
        fail: () => resolve(true)
      });
    });
  }

  return {
    get listening() { return state === 'recording'; },
    get state() { return state; },
    // 首次 start() 后才知道用的哪个引擎；null = 还没试过。用于让降级**可观测**。
    get engine() { return active ? active.name : null; },

    async toggle(nextLanguage) {
      // 识别中再点不做任何事：不能让新一轮录音盖掉正在上传的那一段。
      if (state === 'recognizing') return false;
      if (state === 'recording') { this.stop(); return true; }
      let allowed;
      try { allowed = await requestRecordScope(); } catch (error) { allowed = false; }
      if (!allowed) { fail(ERROR_COPY.permission); return false; }
      return this.start(nextLanguage);
    },
    start(nextLanguage) {
      if (state !== 'idle') return false;
      if (!candidates) candidates = enginesInOrder();
      lastFinal = '';
      for (const candidate of candidates) {
        if (!candidate.engine.start(nextLanguage)) continue;
        active = candidate;
        state = 'recording'; emit('recording');
        return true;
      }
      fail(ERROR_COPY.unavailable);
      return false;
    },
    stop() {
      // 两个引擎都是异步回调，真正的状态切换在那里做。
      if (state !== 'recording') return;
      if (active) active.engine.stop();
    },
    // 错误码/错误文本 → 提示文案。测试与降级路径共用。
    copyFor: value => copyOf(value)
  };
}

module.exports = { createSpeechInput, ERROR_COPY };
