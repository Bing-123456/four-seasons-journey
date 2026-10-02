'use strict';

// 果灵对话 · 本地聊天记录基础设施。
// 约束（团队约定）：聊天历史只存本机（按账户分区 personal/demo 隔离），不上服务器。
// 服务端 /api/chat 不落库、不存会话，多轮上下文由客户端把最近几轮随请求携带。
// 职责：消息净化（防脏数据进渲染与提示词）、容量上限（微信单 key 1MB）、
// 存储异常静默降级——聊天记录丢不了台词本，坏了也不能挡住重新提问。

const store = require('./store');

const FIELD = 'chatMessages';
const MAX_MESSAGES = 100;
const MAX_TEXT = 1500;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// 只保留白名单字段并截断长度：历史要能安全回填 UI，也可能作为上下文进入提示词。
function sanitizeMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (message.role !== 'user' && message.role !== 'elf') return null;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!text) return null;
  const chipOf = chip => {
    if (!chip || typeof chip !== 'object') return null;
    if (typeof chip.fullId !== 'string' || !/^[a-z]+-[a-z]+$/.test(chip.fullId)) return null;
    if (typeof chip.jumpLabel !== 'string' || !chip.jumpLabel.trim()) return null;
    return { fullId: chip.fullId, name: typeof chip.name === 'string' ? chip.name.slice(0, 20) : '', seasonName: typeof chip.seasonName === 'string' ? chip.seasonName.slice(0, 20) : '', jumpLabel: chip.jumpLabel.slice(0, 40) };
  };
  return {
    id: typeof message.id === 'string' && message.id.length <= 40 ? message.id : '',
    role: message.role,
    text: text.slice(0, MAX_TEXT),
    local: message.local === true,
    evidence: (Array.isArray(message.evidence) ? message.evidence : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 60)).slice(0, 4),
    followUps: (Array.isArray(message.followUps) ? message.followUps : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 24)).slice(0, 2),
    chips: (Array.isArray(message.chips) ? message.chips : []).map(chipOf).filter(Boolean).slice(0, 6)
  };
}

function load() {
  let stored = null;
  try { stored = store.readPartitionField(FIELD); } catch (error) { return []; }
  if (!Array.isArray(stored)) return [];
  const cleaned = stored.map(sanitizeMessage).filter(Boolean);
  // id 缺失或重复时重建：scroll-into-view 需要唯一锚点。
  const seen = new Set();
  cleaned.forEach((message, index) => {
    if (!message.id || seen.has(message.id)) message.id = 'm-restored-' + index + '-' + Date.now().toString(36);
    seen.add(message.id);
  });
  return cleaned.slice(-MAX_MESSAGES);
}

function save(messages) {
  if (!Array.isArray(messages)) return false;
  const cleaned = messages.map(sanitizeMessage).filter(Boolean).slice(-MAX_MESSAGES);
  try {
    store.writePartitionField(FIELD, cleaned);
    return true;
  } catch (error) {
    // 配额满或存储异常：聊天继续可用，只是不留痕。
    return false;
  }
}

function clear() {
  try { store.writePartitionField(FIELD, []); return true; } catch (error) { return false; }
}

module.exports = { load, save, clear, sanitizeMessage, MAX_MESSAGES, MAX_TEXT };
