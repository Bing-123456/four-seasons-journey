'use strict';

// 插件接线验证（可复跑）。插件升级、后台重新授权、或怀疑语音静默失效时，跑这一条即可。
//
//   node scripts/probe-plugin-wiring.js
//
// 需要微信开发者工具已打开本项目、且自动化端口 9420 在线。
//
// 验证四件事：
//   ① 插件是否已授权（requirePlugin 能否拿到对象）；
//   ② manager 的回调属性是「可写数据属性 + 出厂空函数」还是「注册器方法」；
//   ③ manager.start 到底怎么消费这些属性（决定必须用赋值式还是调用式）；
//   ④ 赋值式实跑一次，看真实运行时会不会把回调打回来。
//
// 2026-09-28 首次结论（详见 tmp/probe-plugin-wiring.log）：
//   ①②③ 指向同一个答案——onStart/onStop/onError/onRecognize 都是 writable 数据属性、
//   出厂值是 `function(e){}`，而 start 的源码是 `setCallback("onStop", this.onStop)`，
//   也就是**读属性当前值**再注册。⇒ **必须用赋值式**，调用式 `manager.onStop(fn)` 是空转。
//   这一点官方文档的方法表（写成「onStop callback」）会误导，以官方示例代码为准。
//   ④ 用赋值式时立刻收到 onError，用调用式时 4 秒零回调——两者对照成立。

const automator = require('miniprogram-automator');
const fs = require('node:fs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = [];
const log = (...args) => { out.push(args.join(' ')); console.log(...args); };

(async () => {
  let mp = null;
  try {
    log('等开发者工具重新编译…');
    await sleep(3500);
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    log('已连接');

    // —— ① 授权 + ② 描述符 + ③ start 源码 ——
    const statics = await mp.evaluate(() => {
      const report = {};
      let plugin;
      try { plugin = requirePlugin('WechatSI'); }
      catch (error) { return { fatal: 'requirePlugin 抛错：' + (error && error.message) }; }
      if (!plugin) return { fatal: 'requirePlugin 返回空（插件未授权？）' };

      report.authorized = {
        getRecordRecognitionManager: typeof plugin.getRecordRecognitionManager,
        textToSpeech: typeof plugin.textToSpeech
      };
      const manager = plugin.getRecordRecognitionManager();
      if (!manager) return { fatal: 'getRecordRecognitionManager 返回空' };
      report.singleton = plugin.getRecordRecognitionManager() === manager;

      report.callbacks = {};
      for (const name of ['onStart', 'onStop', 'onError', 'onRecognize']) {
        const d = Object.getOwnPropertyDescriptor(manager, name);
        report.callbacks[name] = d ? {
          kind: d.value !== undefined ? 'data' : 'accessor',
          writable: d.writable,
          defaultSource: typeof d.value === 'function' ? String(d.value) : String(d.value)
        } : 'missing';
      }
      report.startSource = String(manager.start);
      return report;
    });
    log('=== 授权与 manager 结构 ===');
    log(JSON.stringify(statics, null, 2));

    // —— ④ 赋值式 vs 调用式，各起一次，看回调有没有打回来 ——
    // 开发者工具不支持录音，start 会失败；**失败也是有效信息**——只要有回调就是注册成功。
    const live = async (mode) => {
      await mp.evaluate(({ mode }) => {
        const probe = { mode, fired: [] };
        globalThis.__wiringProbe = probe;
        const manager = requirePlugin('WechatSI').getRecordRecognitionManager();
        const handlers = {
          onStart: event => probe.fired.push('onStart ' + JSON.stringify(event)),
          onStop: event => probe.fired.push('onStop ' + JSON.stringify(event)),
          onError: event => probe.fired.push('onError ' + JSON.stringify(event)),
          onRecognize: event => probe.fired.push('onRecognize ' + JSON.stringify(event))
        };
        for (const name of Object.keys(handlers)) {
          if (mode === 'assign') manager[name] = handlers[name];   // 赋值式（我们采用的）
          else manager[name](handlers[name]);                      // 调用式（空转）
        }
        try { manager.start({ lang: 'zh_CN', duration: 60000 }); probe.started = true; }
        catch (error) { probe.started = 'start threw: ' + (error && error.message); }
        return probe;
      }, { mode });
      await sleep(2500);
      const result = await mp.evaluate(() => {
        try { requirePlugin('WechatSI').getRecordRecognitionManager().stop(); } catch (error) { /* ignore */ }
        return globalThis.__wiringProbe;
      });
      await sleep(800);   // 让上一轮会话彻底结束，避免 -30011 串场
      return result;
    };

    for (const mode of ['assign', 'call']) {
      const result = await live(mode);
      log('=== 实跑 · ' + (mode === 'assign' ? '赋值式' : '调用式') + ' ===');
      log(JSON.stringify(result, null, 2));
    }
    log('判读：赋值式有回调、调用式零回调 ⇒ 引擎必须用赋值式注册（speech-input.js 已如此实现）。');
    log('      两边都零回调 ⇒ 可能只是模拟器不支持录音，本项无结论，须真机验证。');
  } catch (error) {
    log('探测失败：' + (error && error.stack ? error.stack : error));
  } finally {
    try { if (mp) await mp.disconnect(); } catch (error) { /* ignore */ }
    fs.mkdirSync('tmp', { recursive: true });   // 全新克隆时 tmp/ 可能不存在
    fs.writeFileSync('tmp/probe-plugin-wiring.log', out.join('\n') + '\n');
    process.exit(0);   // automator 有时不放开事件循环，硬退
  }
})();
