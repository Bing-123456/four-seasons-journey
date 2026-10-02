'use strict';
const media = require('./media-service');
const service = require('./service');
const store = require('./store');
const i18n = require('./i18n');

function dialects() {
  const names = [['mandarin','普通话','Mandarin'],['henan','河南话','Henan'],['dongbei','东北话','Dongbei'],['shanghai','上海话','Shanghai'],['sichuan','四川话','Sichuan'],['cantonese','粤语','Cantonese'],['english','英语','English']];
  return names.map(item => ({ code: item[0], label: item[i18n.getLang() === 'en' ? 2 : 1] }));
}
function chunks(text, max = 160) {
  const parts = []; let remaining = String(text || '').trim();
  while (remaining.length > max) {
    const prefix = remaining.slice(0, max), boundary = Math.max(prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('. '), prefix.lastIndexOf('\n'));
    const cut = boundary > max / 2 ? boundary + 1 : max;
    parts.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining); return parts;
}
function stop(page) {
  page._readEpoch = (page._readEpoch || 0) + 1;
  if (page._finishPlayback) { page._finishPlayback(); page._finishPlayback = null; }
  if (page._audio) { try { page._audio.stop(); page._audio.destroy(); } catch (_) {} page._audio = null; }
  if (!page._disposed) page.setData({ reading: false, readBusy: false });
}
function getSystemInfo() {
  try { if (typeof wx !== 'undefined' && wx.getSystemInfoSync) return wx.getSystemInfoSync(); } catch (e) {}
  return {};
}
function isIOS() { return /iOS/i.test(getSystemInfo().system || ''); }
function makePlaybackError(prefix, errCode) {
  return new Error((prefix || '朗读播放失败') + (errCode ? '（' + errCode + '）' : '') + '，请重试');
}

// 下载音频到本地（Android 真机必需；iOS 作为 fallback）。
function downloadAudioFile(url) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url,
    success: result => result.statusCode === 200 && result.tempFilePath ? resolve(result.tempFilePath) : reject(makePlaybackError('朗读音频下载失败', result.statusCode)),
    fail: error => reject(makePlaybackError('朗读音频下载失败', error && error.errMsg))
  }));
}

function bindAudioEvents(audio, page, resolve, reject) {
  let settled = false, played = false;
  const finish = () => { if (!settled) { settled = true; resolve(); } };
  const fail = error => { if (!settled) { settled = true; reject(error); } };
  page._finishPlayback = finish;
  audio.onEnded(finish);
  if (audio.onStop) audio.onStop(finish);
  audio.onError((error) => {
    try { audio.stop(); audio.destroy(); } catch (_) {}
    if (page._audio === audio) page._audio = null;
    const errCode = error && (error.errCode || error.code);
    console.error('InnerAudioContext error', errCode, error);
    fail(makePlaybackError('朗读播放失败', errCode));
  });
  const doPlay = () => {
    if (played || settled) return;
    played = true;
    try { audio.play(); } catch (error) { fail(makePlaybackError()); }
  };
  if (typeof audio.onCanplay === 'function') {
    audio.onCanplay(doPlay);
    // 真机本地文件加载慢，部分机型不触发 canplay，延长兜底到 3s。
    setTimeout(doPlay, 3000);
  } else {
    doPlay();
  }
}

// iOS 真机直接播放网络 URL 更稳；Android 下载到本地播放。
function playNetworkAudio(page, url, resolve, reject) {
  const audio = wx.createInnerAudioContext();
  page._audio = audio;
  audio.obeyMuteSwitch = false;
  audio.src = url;
  bindAudioEvents(audio, page, resolve, reject);
}
function playLocalFile(page, filePath, resolve, reject) {
  const audio = wx.createInnerAudioContext();
  page._audio = audio;
  audio.obeyMuteSwitch = false;
  audio.src = filePath;
  bindAudioEvents(audio, page, resolve, reject);
}

// 统一播放入口：按平台选最优路径，任一失败则尝试另一路径。
async function playAudio(page, audioUrl) {
  const ios = isIOS();
  if (ios) {
    try { return await new Promise((resolve, reject) => playNetworkAudio(page, audioUrl, resolve, reject)); }
    catch (e) { console.log('iOS direct network play failed, fallback download', e && e.message); }
  }
  try {
    const filePath = await downloadAudioFile(audioUrl);
    return await new Promise((resolve, reject) => playLocalFile(page, filePath, resolve, reject));
  } catch (e) {
    console.log('download/local play failed, fallback network', e && e.message);
    if (!ios) return await new Promise((resolve, reject) => playNetworkAudio(page, audioUrl, resolve, reject));
    throw e;
  }
}

async function start(page, script) {
  stop(page);
  const epoch = page._readEpoch, dialect = page.data.dialect || 'mandarin';
  let context;
  const current = () => !page._disposed && epoch === page._readEpoch && context && media.isCurrent(context) && context.partition === store.capturePartition();
  const update = data => { if (current()) page.setData(data); };
  try {
    context = media.capture();
    update({ readBusy: true });
    let text = String(script || '').trim();
    if (!text) throw new Error('没有可朗读的正文');
    if (dialect === 'english' && /[\u3400-\u9fff]/.test(text)) {
      if (!page._spokenTranslations) page._spokenTranslations = {};
      if (!page._spokenTranslations[text]) {
        const source = chunks(text, 600), translated = [];
        for (let i = 0; i < source.length; i += 4) {
          if (!current()) return;
          translated.push(...await service.translate(source.slice(i, i + 4), 'en'));
        }
        page._spokenTranslations[text] = translated.join('\n');
      }
      text = page._spokenTranslations[text];
    }
    for (const part of chunks(text)) {
      if (!current()) return;
      update({ readBusy: true });
      // 朗读生成可能超过 callContainer 15s 上限，改为异步任务：先提交，再轮询。
      const submit = await media.request(context, 'POST', '/api/speech', { text: part, dialect });
      if (!current()) return;
      const taskId = submit && submit.taskId;
      if (!taskId) throw new Error('朗读任务无效');
      let result = submit;
      if (result.status !== 'succeeded') {
        const MAX_POLL = 90;
        for (let i = 0; i < MAX_POLL && current(); i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (!current()) return;
          const data = await media.request(context, 'GET', '/api/speech/' + encodeURIComponent(taskId));
          if (data.status === 'succeeded') { result = data; break; }
          if (data.status === 'failed') throw new Error(data.message || '朗读生成失败，请稍后重试');
        }
      }
      if (result.status !== 'succeeded') throw new Error('朗读生成超时，请稍后重试');
      if (!current()) return;
      const hasUrl = /^\/speech\/[a-f0-9]{64}\.(wav|mp3)$/.test(result.audioUrl || '');
      if (!hasUrl) throw new Error('朗读音频无效');
      const audioUrl = context.apiBase.replace(/\/$/, '') + result.audioUrl;
      // 按平台选最优播放路径：iOS 直接播网络 URL，Android 下载到本地，均带 fallback。
      await playAudio(page, audioUrl);
      update({ reading: true, readBusy: false });
      page._finishPlayback = null;
      if (page._audio) { try { page._audio.destroy(); } catch (_) {} page._audio = null; }
    }
    update({ reading: false, readBusy: false });
  } catch (error) {
    if (!page._disposed && epoch === page._readEpoch) { stop(page); wx.showToast({ title: error.message || i18n.t('read_unavailable'), icon: 'none' }); }
  }
}
module.exports = { dialects, chunks, start, stop };
