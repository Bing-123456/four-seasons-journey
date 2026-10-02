'use strict';

const { InputError } = require('./validation');

// 语音输入（ASR）：把小程序录音转成文字，替代微信同声传译插件。
//
// 为什么不用插件（WechatSI）：
//   ① 插件必须在小程序后台单独授权，未授权时上传直接报 80082；
//   ② 后台「添加插件」的搜索框按 AppID 和中文名都搜不到（已知毛病），这条路卡死；
//   ③ 插件时长上限 30–60s，且没有方言参数。
// 为什么用 qwen3-asr-flash：与朗读（server/speech.js）共用同一个 DashScope key、
// 同一个端点、同一套错误处理经验；zh 参数原生覆盖普通话/四川话/闽南语/吴语，
// yue 覆盖粤语，en 覆盖英文。零训练、零微调，符合技术主线「用现成模型做架构」。
//
// 端点（2026-09-28 实测，见 tmp/probe-asr.js / tmp/probe-asr-mp3.js）：
//   POST {baseUrl}/api/v1/services/aigc/multimodal-generation/generation
//   请求 { model, input: { messages: [{ role: 'user', content: [{ audio: dataUrl }] }] },
//          parameters: { asr_options: { language, enable_itn } } }
//   响应 output.choices[0].message.content[0].text
//   audio 字段接受 base64 Data URL；mp3（data:audio/mpeg）与 wav 均实测通过。
//   注意 parameters 是外层字段，asr_options 在它里面——写成顶层 asr_options 不报错但不生效。

const MEDIA = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac' });
// 只放与本产品相关的三档：zh 已覆盖普通话与川/闽南/吴方言，yue 粤语，en 英文。
const LANGUAGES = Object.freeze(['zh', 'yue', 'en']);
// 16 kHz / 24 kbps mp3 ≈ 3 KB/s：1.5 MB 约 8 分钟，远超小程序端 60s 的录音上限。
// 上限刻意留宽，是为了让「录音变长」只受客户端约束，服务端不再成为隐藏瓶颈。
const MAX_AUDIO_BYTES = 1.5 * 1024 * 1024;
const MAX_SECONDS = 60;

// 只认「确实是音频」的容器签名，不认「格式与声明一致」——
// 小程序录音在 iOS/Android 上的实际头部有差异，按声明格式严格比对会误杀真录音。
// 宁可放过声明不符的真音频（交给 provider 判断），也不误拒用户。
const SIGNATURES = [
  bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', // wav
  bytes => bytes.toString('ascii', 0, 3) === 'ID3',                                              // mp3 + ID3 标签
  bytes => bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0,                                       // mp3/aac 帧同步
  bytes => bytes.toString('ascii', 4, 8) === 'ftyp',                                              // m4a/mp4
  bytes => bytes.toString('ascii', 0, 4) === 'OggS',                                              // ogg
  bytes => bytes.toString('ascii', 0, 5) === '#!AMR',                                             // amr
  bytes => bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3        // webm
];
function looksLikeAudio(bytes) {
  return bytes.length >= 12 && SIGNATURES.some(test => test(bytes));
}

function createAsrAdapter(config, options = {}) {
  if (!config || !config.apiKey) return null;
  const fetcher = options.fetch || fetch;
  return {
    async transcribe({ audio, format, language }) {
      const signal = AbortSignal.timeout(config.timeoutMs || 30000);
      const response = await fetcher(config.baseUrl + '/api/v1/services/aigc/multimodal-generation/generation', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model || 'qwen3-asr-flash',
          input: { messages: [{ role: 'user', content: [{ audio: 'data:' + MEDIA[format] + ';base64,' + audio }] }] },
          parameters: { asr_options: { language, enable_itn: true } }
        }),
        signal
      });
      if (!response.ok) throw new Error('asr_provider');
      const result = await response.json();
      const content = result && result.output && result.output.choices && result.output.choices[0]
        && result.output.choices[0].message && result.output.choices[0].message.content;
      const text = Array.isArray(content)
        ? content.map(part => (part && typeof part.text === 'string' ? part.text : '')).join('')
        : '';
      return { text: text.trim() };
    }
  };
}

function createAsrService(adapter, { now = Date.now } = {}) {
  let checked = null;
  let availability = adapter ? 'not-checked' : 'disabled';

  function decode(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('语音请求格式无效', 'asr_invalid');
    if (!Object.hasOwn(MEDIA, body.format)) throw new InputError('录音格式不支持', 'asr_invalid');
    const language = body.language === undefined || body.language === null ? 'zh' : body.language;
    if (!LANGUAGES.includes(language)) throw new InputError('识别语言不支持', 'asr_invalid');
    const audio = body.audio;
    if (typeof audio !== 'string' || !audio) throw new InputError('没有收到录音数据', 'asr_invalid');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || audio.length % 4) throw new InputError('录音数据无效', 'asr_invalid');
    const bytes = Buffer.from(audio, 'base64');
    if (!bytes.length) throw new InputError('没有收到录音数据', 'asr_invalid');
    // 超限先于格式判断：超大 payload 不该走到解码后的进一步处理。
    if (bytes.length > MAX_AUDIO_BYTES) throw new InputError('录音过长，请分段提问', 'body_too_large', 413);
    if (!looksLikeAudio(bytes)) throw new InputError('录音数据不是可识别的音频', 'asr_invalid');
    return { audio, format: body.format, language };
  }

  async function transcribe(body) {
    const input = decode(body);
    if (!adapter) throw new InputError('语音识别服务尚未配置，请改用键盘输入', 'asr_disabled', 503);
    let result;
    try {
      result = await adapter.transcribe(input);
    } catch (error) {
      checked = now(); availability = 'last-call-failed';
      throw new InputError('语音识别暂未完成，请稍后重试', 'asr_unavailable', 502);
    }
    checked = now(); availability = 'last-call-succeeded';
    // 服务调用成功但一个字都没听出来，与「服务挂了」是两回事，必须分开报。
    // 这里再 trim 一次：provider 只回空白也算「没听清」，不能当成一句有效提问。
    const text = result && typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) throw new InputError('没有听清，请靠近麦克风重试', 'asr_empty', 422);
    return { text, language: input.language, format: input.format };
  }

  return {
    transcribe,
    inspect: () => ({ configured: !!adapter, availability, lastCheckedAt: checked, languages: [...LANGUAGES], maxSeconds: MAX_SECONDS, maxAudioBytes: MAX_AUDIO_BYTES })
  };
}

module.exports = { createAsrAdapter, createAsrService, LANGUAGES, MEDIA, MAX_AUDIO_BYTES };
