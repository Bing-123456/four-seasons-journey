'use strict';
// 果乡社群服务：帖子发布 / 列表 / 详情 / 点赞 / 评论。
// 数据库走 CloudBase（cloud1 环境）+ accessKey 鉴权。
//
// 【10.5 关键修复——@cloudbase/node-sdk 与小程序端 SDK 签名不同】
//   * collection.add(data) —— 直接接收文档对象，不包 { data: ... }（包了会把整份内容塞进 data 字段）；
//   * doc(id).update(data) —— 直接接收字段对象，不包 { data: ... }（包了点赞/评论全写到废字段）；
//   * doc(id).get() —— 返回 { data: [文档数组] }，单文档取 data[0]（不是对象）。
//   v36 三处全错：帖子内容被包进 data 字段（列表全空壳）、点赞评论写到废字段（永不生效）。
//   读取端 unwrap() 做懒迁移：发现旧包裹结构自动拆包并回写，用户无需任何手动操作，旧帖自动恢复。
//
// 图片/头像：小程序端 wx.cloud.uploadFile 直传 cloud1 云存储，库里只存 fileID；
// 列表返回前统一 getTempFileURL 转 https 临时链接；转换失败时透传原 fileID
// （小程序端默认云环境已指向 cloud1，image 组件可直接渲染 cloud:// 兜底）。
// 所有数据库操作均包 try/catch 转 InputError，绝不让异常穿透杀死进程（10.5 教训）。
const { InputError } = require('./validation');

const COLLECTION = 'community_posts';
const MAX_TEXT = 200;
const MAX_NICKNAME = 30;
const MAX_COMMENTS = 200;
const MAX_LIKEDBY = 500;
const TEMP_URL_MAX_AGE = 2 * 60 * 60; // 秒（getTempFileURL 的 maxAge 单位是秒）
const ID_PATTERN = /^[\w-]{4,64}$/;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

// 仅接受 cloud:// 协议的云存储 fileID（环境段含点号与数字），长度封顶。
function isFileId(value) {
  return typeof value === 'string' && value.length <= 300 && /^cloud:\/\/[A-Za-z0-9_.-]+\/[\w\-./%]+$/.test(value);
}

function toInputError(error, fallbackMessage) {
  if (error instanceof InputError) return error;
  const detail = error && (error.message || error.code) ? String(error.message || error.code) : '';
  return new InputError(detail ? fallbackMessage + '（' + detail + '）' : fallbackMessage, 'community_unavailable', 500);
}

// 懒迁移：v36 曾把整份内容包进 data 字段；发现包裹结构时拆包使用并回写修复。
function unwrapRow(row) {
  if (row && row.data && typeof row.data === 'object' && !Array.isArray(row.data)
    && (row.data.image !== undefined || row.data.createdAt !== undefined || row.data.text !== undefined)) {
    const inner = Object.assign({}, row.data);
    delete inner.data;
    inner._id = row._id;
    return inner;
  }
  return row;
}

function createCommunityService(options = {}) {
  const envId = options.envId || process.env.TCB_ENV_ID || '';
  const accessKey = options.accessKey || process.env.TCB_ACCESS_KEY || '';
  const sdk = options.sdk || require('@cloudbase/node-sdk');
  let appPromise = null;

  function getApp() {
    if (!appPromise) {
      appPromise = Promise.resolve().then(() => {
        if (!envId || !accessKey) {
          throw new InputError('社群数据库未配置：缺少 TCB_ENV_ID / TCB_ACCESS_KEY 环境变量', 'community_unconfigured', 500);
        }
        return sdk.init({ env: envId, accessKey: accessKey });
      }).catch(error => {
        appPromise = null; // 初始化失败允许下次重试
        throw toInputError(error, '社群数据库初始化失败');
      });
    }
    return appPromise;
  }

  // 集合不存在时尝试自动创建；已存在或无权限时静默忽略（后续读写会给出明确报错）。
  async function ensureCollection(app) {
    try { await app.database().createCollection(COLLECTION); } catch (error) { /* ignore */ }
  }

  // 读取单文档：doc(id).get() 返回 { data: [数组] }，这里统一成「文档或 null」。
  async function getDoc(db, id) {
    const res = await db.collection(COLLECTION).doc(id).get();
    if (!res || res.code) return null;
    const data = res.data;
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  // 懒迁移回写：文档被替换为拆包后的顶层结构（data 字段清空），失败不影响本次展示。
  async function migrateRow(db, row, clean) {
    if (row === clean || !row || !clean) return;
    try {
      const fixed = Object.assign({}, clean);
      delete fixed._id;
      fixed.data = null; // 清掉包裹字段，避免下次再次触发迁移
      await db.collection(COLLECTION).doc(row._id).set(fixed);
    } catch (error) { /* 迁移尽力而为，失败不影响本次展示 */ }
  }

  // 把 fileID 批量转 https 临时链接；失败/缺权限时保留原 fileID（小程序端 cloud:// 可直接渲染兜底）。
  async function resolveFileUrls(app, fileIds) {
    const ids = Array.from(new Set(fileIds.filter(isFileId)));
    const map = {};
    if (!ids.length) return map;
    try {
      const res = await app.getTempFileURL({ fileList: ids, maxAge: TEMP_URL_MAX_AGE });
      for (const item of (res.fileList || [])) {
        if (item && item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
      }
    } catch (error) { /* 转换失败不致命：保留 fileID，由小程序端渲染 */ }
    return map;
  }

  function serializePost(post, urlMap, openid) {
    const image = urlMap[post.image] || (isFileId(post.image) ? post.image : '');
    const avatar = urlMap[post.avatar] || (isFileId(post.avatar) ? post.avatar : '');
    const likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
    return {
      _id: post._id,
      image: image,
      text: post.text || '',
      nickname: post.nickname || '旅人',
      avatar: avatar,
      likes: Math.max(0, Number(post.likes) || 0),
      liked: !!(openid && likedBy.indexOf(openid) >= 0),
      comments: (Array.isArray(post.comments) ? post.comments : []).map(c => ({
        nickname: (c && c.nickname) || '旅人',
        text: (c && c.text) || '',
        replyTo: (c && c.replyTo) || '',
        createdAt: (c && c.createdAt) || 0
      })),
      createdAt: Number(post.createdAt) || 0
    };
  }

  async function list(openid) {
    try {
      const app = await getApp();
      await ensureCollection(app);
      const db = app.database();
      const res = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(50).get();
      const rows = (res.data || []).map(row => unwrapRow(row));
      const urlMap = await resolveFileUrls(app, rows.map(p => [p.image, p.avatar]).flat());
      const posts = [];
      for (let i = 0; i < rows.length; i++) {
        await migrateRow(db, (res.data || [])[i], rows[i]); // 旧包裹结构自动回写修复
        posts.push(serializePost(rows[i], urlMap, typeof openid === 'string' ? openid.slice(0, 64) : ''));
      }
      return { posts: posts };
    } catch (error) { throw toInputError(error, '社群动态加载失败'); }
  }

  async function detail(id, openid) {
    if (!ID_PATTERN.test(id)) throw new InputError('动态不存在', 'not_found', 404);
    try {
      const app = await getApp();
      await ensureCollection(app);
      const db = app.database();
      const raw = await getDoc(db, id);
      if (!raw) throw new InputError('动态不存在或已被删除', 'not_found', 404);
      const row = unwrapRow(raw);
      await migrateRow(db, raw, row);
      const urlMap = await resolveFileUrls(app, [row.image, row.avatar]);
      return { post: serializePost(row, urlMap, typeof openid === 'string' ? openid.slice(0, 64) : '') };
    } catch (error) { throw toInputError(error, '动态详情加载失败'); }
  }

  async function publish(body, openid) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('动态内容格式无效');
    const image = body.imageFileId || '';
    if (!isFileId(image)) throw new InputError('帖子图片缺失或格式无效');
    const avatar = body.avatarFileId || '';
    if (avatar && !isFileId(avatar)) throw new InputError('头像文件无效');
    const text = cleanText(body.text, MAX_TEXT);
    const nickname = cleanText(body.nickname, MAX_NICKNAME) || '旅人';
    try {
      const app = await getApp();
      await ensureCollection(app);
      // node-sdk：add 直接接收文档对象（不包 { data: ... }，10.5 修复）
      await app.database().collection(COLLECTION).add({
        image: image, avatar: avatar, text: text, nickname: nickname,
        likes: 0, likedBy: [], comments: [],
        openid: typeof openid === 'string' ? openid.slice(0, 64) : '',
        createdAt: Date.now()
      });
      return { ok: true };
    } catch (error) { throw toInputError(error, '发布失败，请稍后再试'); }
  }

  // 点赞（朋友圈式 toggle）：同一用户重复点击是「取消赞」，数字真实增减；
  // 用户身份来自云托管注入的 x-wx-openid，无身份信息时退化为普通 +1（本地开发兜底）。
  async function like(body, openid) {
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!ID_PATTERN.test(id)) throw new InputError('动态不存在', 'not_found', 404);
    const key = typeof openid === 'string' ? openid.trim().slice(0, 64) : '';
    try {
      const app = await getApp();
      const db = app.database();
      const raw = await getDoc(db, id);
      if (!raw) throw new InputError('动态不存在或已被删除', 'not_found', 404);
      const row = unwrapRow(raw);
      const likedBy = (Array.isArray(row.likedBy) ? row.likedBy : []).filter(k => typeof k === 'string' && k);
      let likes = Math.max(0, Number(row.likes) || 0);
      let liked;
      if (key) {
        const index = likedBy.indexOf(key);
        if (index >= 0) { likedBy.splice(index, 1); likes = Math.max(0, likes - 1); liked = false; }
        else { if (likedBy.length < MAX_LIKEDBY) likedBy.push(key); likes += 1; liked = true; }
      } else { likes += 1; liked = true; }
      // node-sdk：update 直接接收字段对象（不包 { data: ... }，10.5 修复）
      await db.collection(COLLECTION).doc(id).update({ likes: likes, likedBy: likedBy });
      return { likes: likes, liked: liked };
    } catch (error) { throw toInputError(error, '点赞失败，请稍后再试'); }
  }

  async function comment(body) {
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!ID_PATTERN.test(id)) throw new InputError('动态不存在', 'not_found', 404);
    const text = cleanText(body.text, MAX_TEXT);
    if (!text) throw new InputError('评论内容不能为空');
    const nickname = cleanText(body.nickname, MAX_NICKNAME) || '旅人';
    const replyTo = cleanText(body.replyTo, MAX_NICKNAME);
    try {
      const app = await getApp();
      const db = app.database();
      const raw = await getDoc(db, id);
      if (!raw) throw new InputError('动态不存在或已被删除', 'not_found', 404);
      const row = unwrapRow(raw);
      const comments = (Array.isArray(row.comments) ? row.comments : []).slice(-(MAX_COMMENTS - 1));
      comments.push({ nickname: nickname, text: text, replyTo: replyTo, createdAt: Date.now() });
      // node-sdk：update 直接接收字段对象（不包 { data: ... }，10.5 修复）
      await db.collection(COLLECTION).doc(id).update({ comments: comments });
      return { ok: true, count: comments.length };
    } catch (error) { throw toInputError(error, '评论失败，请稍后再试'); }
  }

  // 查重：这个名字是否已被「其他」用户占用（自己的历史名不算占用）。
  // 帖子带 openid，可据此排除自己；默认名「旅人」与空名豁免，避免人人默认名互相冲突。
  async function nicknameExists(candidate, openid) {
    const name = cleanText(candidate, MAX_NICKNAME);
    const key = typeof openid === 'string' ? openid.trim().slice(0, 64) : '';
    if (!name || name === '旅人' || !key) return { exists: false };
    try {
      const app = await getApp();
      await ensureCollection(app);
      const db = app.database();
      const res = await db.collection(COLLECTION).where({ nickname: name }).limit(50).get();
      const rows = (res.data || []).map(r => unwrapRow(r));
      const taken = rows.some(r => (r.openid || '') !== '' && (r.openid || '') !== key);
      return { exists: taken };
    } catch (error) { throw toInputError(error, '昵称校验失败'); }
  }

  // 批量改名：把「我」发过的所有帖子、以及历史评论里的旧昵称统一换成新昵称。
  // 帖子靠 openid 认主，全量改昵称（覆盖所有历史名，无需逐一代换）；
  // 评论当初没存 openid，只能按「即时旧昵称」匹配改写（不同用户恰好同名会有极小概率误改，已确认接受）。
  async function rename(oldNickname, newNickname, openid) {
    const key = typeof openid === 'string' ? openid.trim().slice(0, 64) : '';
    const next = cleanText(newNickname, MAX_NICKNAME);
    const prev = cleanText(oldNickname, MAX_NICKNAME);
    if (!key) return { skipped: true, reason: 'no_openid' };           // 本地调试无身份，安全跳过
    if (!next || next === '旅人' || next === prev) return { skipped: true, reason: 'noop' };
    try {
      const app = await getApp();
      await ensureCollection(app);
      const db = app.database();
      // 帖子：靠 openid 认主，全量改昵称（无论历史叫过什么，一律统一为新名）。
      await db.collection(COLLECTION).where({ openid: key }).update({ nickname: next });
      // 评论：无 openid，按即时旧昵称逐帖改写（局限：仅覆盖上一次改名前的昵称）。
      if (prev) {
        const res = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(300).get();
        const rows = (res.data || []).map(r => unwrapRow(r));
        for (const row of rows) {
          const comments = Array.isArray(row.comments) ? row.comments : [];
          let changed = false;
          for (const c of comments) {
            if (c && typeof c.nickname === 'string' && c.nickname === prev) { c.nickname = next; changed = true; }
          }
          if (changed) {
            const fixed = Object.assign({}, row); delete fixed._id; fixed.data = null; // 顺带清旧包裹字段
            await db.collection(COLLECTION).doc(row._id).update({ comments: comments });
          }
        }
      }
      return { ok: true };
    } catch (error) { throw toInputError(error, '昵称同步失败'); }
  }

  return { list, detail, publish, like, comment, nicknameExists, rename, COLLECTION };
}

module.exports = { createCommunityService, cleanText, isFileId, unwrapRow, COLLECTION, MAX_TEXT, MAX_NICKNAME };
