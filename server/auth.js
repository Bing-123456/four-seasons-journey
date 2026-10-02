'use strict';

const { randomBytes, randomInt, createHash, timingSafeEqual } = require('node:crypto');
const { InputError } = require('./validation');
const digest = value => createHash('sha256').update(value).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

// Development pairing only: possession of a one-time console code grants a
// short session. It is not a replacement for WeChat login in a public service.
function createAuth(config, options = {}) {
  const now = options.now || Date.now;
  const notify = options.onPairingCode || (info => console.log('开发配对码：' + info.code + '（5 分钟有效，仅使用一次；在小程序「我的」输入）'));
  const required = !!config.token;
  const codeTtl = config.pairingCodeTtlMs || 300000;
  const sessionTtl = config.sessionTtlMs || 1800000;
  const sessions = new Map();
  const attempts = new Map();
  let pairing = null;
  let globalWindow = { start: now(), count: 0 };

  function rotate() {
    if (!required) return;
    const code = String(randomInt(10000000, 100000000));
    pairing = { hash: digest(code), expiresAt: now() + codeTtl };
    notify({ code, expiresAt: pairing.expiresAt });
  }
  function purge() { for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key); }
  function inspect(request) {
    if (!required) return { required: false, authenticated: true, mode: 'local-development', expiresAt: null };
    const header = String(request.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token && same(token, config.token)) return { required: true, authenticated: true, mode: 'administrative', expiresAt: null };
    purge();
    const session = token && sessions.get(digest(token).toString('hex'));
    return { required: true, authenticated: !!session, mode: session ? 'paired-session' : 'pairing-required', expiresAt: session ? session.expiresAt : null };
  }
  function rateAllowed(address) {
    const time = now();
    for (const [key, value] of attempts) if (time - value.start >= codeTtl) attempts.delete(key);
    if (time - globalWindow.start >= codeTtl) globalWindow = { start: time, count: 0 };
    globalWindow.count += 1;
    const item = attempts.get(address) || { start: time, count: 0 };
    item.count += 1;
    attempts.set(address, item);
    if (attempts.size > 1024) attempts.delete(attempts.keys().next().value);
    return item.count <= 5 && globalWindow.count <= 20;
  }
  function pair(code, address) {
    if (!required) throw new InputError('本机开发服务无需配对', 'pairing_not_required', 400);
    if (!rateAllowed(address)) throw new InputError('配对尝试过多，请 5 分钟后重试', 'pairing_rate_limited', 429);
    if (!pairing || now() >= pairing.expiresAt) { rotate(); throw new InputError('配对码已过期，请查看服务终端的新码', 'pairing_expired', 401); }
    if (typeof code !== 'string' || !/^\d{8}$/.test(code) || !timingSafeEqual(digest(code), pairing.hash)) throw new InputError('配对码无效或已使用', 'pairing_invalid', 401);
    purge();
    if (sessions.size >= 100) throw new InputError('开发会话已满，请稍后重试', 'pairing_busy', 503);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now() + sessionTtl;
    sessions.set(digest(token).toString('hex'), { expiresAt });
    rotate();
    return { token, expiresAt, purpose: 'development-session' };
  }
  return { required, rotate, inspect, pair };
}

module.exports = { createAuth };
