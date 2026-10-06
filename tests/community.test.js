'use strict';
// 果乡社群服务端回归（10.5 事故防回归）：
// v36 曾把小程序端 SDK 的调用习惯（add/update 包 { data }）带到 @cloudbase/node-sdk，
// 导致帖子内容被包进 data 字段（列表全空壳）、点赞评论写到废字段（永不生效）。
// 这份 mock 刻意模拟真实 node-sdk 签名：doc.get 返回 { data: [数组] }、add/update 直接接收对象——
// 一旦有人再传 { data: ... } 包裹，测试立刻红。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommunityService, unwrapRow, isFileId } = require('../server/community');

const FILE_ID = 'cloud://cloud1-d5gcgaukz8cb3f907.636c-example/game-community/posts/a.jpg';

function createSdkStub() {
  const docs = new Map();
  let seq = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const command = { inc: n => ({ __inc: n }) };
  const collection = {
    // 真实签名：add(data) 直接接收文档对象。
    add: async (data) => {
      if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'data')) {
        throw new Error('签名回归：add 不应收到 { data: ... } 包裹参数');
      }
      const id = 'doc' + String(++seq).padStart(4, '0');
      docs.set(id, clone(data));
      return { id: id };
    },
    doc: (id) => ({
      // 真实签名：doc(id).get() 返回 { data: [文档数组] }，数据库层文档自带 _id。
      get: async () => ({ data: docs.has(id) ? [Object.assign({ _id: id }, clone(docs.get(id)))] : [] }),
      // 真实签名：update(data) 直接接收字段对象。
      update: async (data) => {
        if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'data')) {
          throw new Error('签名回归：update 不应收到 { data: ... } 包裹参数');
        }
        if (!docs.has(id)) return { updated: 0 };
        const doc = docs.get(id);
        for (const [key, value] of Object.entries(data)) doc[key] = clone(value);
        return { updated: 1 };
      },
      set: async (data) => {
        const copy = clone(data);
        delete copy._id;
        docs.set(id, copy);
        return { updated: 1 };
      },
      remove: async () => {
        if (docs.has(id)) { docs.delete(id); return { removed: 1 }; }
        return { removed: 0 };
      }
    }),
    orderBy: () => collection,
    limit: () => collection,
    where: (query) => {
      const matched = () => Array.from(docs.entries()).filter(([id, doc]) => {
        return Object.entries(query).every(([k, v]) => doc[k] === v);
      });
      const filtered = {
        orderBy: () => filtered, limit: () => filtered,
        get: async () => ({ data: matched().map(([id, doc]) => Object.assign({ _id: id }, clone(doc))) }),
        update: async (data) => {
          let n = 0;
          for (const [, doc] of matched()) { for (const [key, value] of Object.entries(data)) doc[key] = clone(value); n++; }
          return { updated: n };
        }
      };
      return filtered;
    },
    get: async () => ({ data: Array.from(docs.entries()).map(([id, doc]) => Object.assign({ _id: id }, clone(doc))) })
  };
  const app = {
    database: () => ({ collection: () => collection, command: command, createCollection: async () => {} }),
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(fileID => ({ fileID: fileID, tempFileURL: 'https://tmp.example.com/' + fileID })) })
  };
  return { sdk: { init: () => app }, docs: docs };
}

function makeService(stub) {
  return createCommunityService({ sdk: stub.sdk, envId: 'env-test', accessKey: 'ak-test' });
}

test('fileID 校验只放行 cloud:// 协议', () => {
  assert.equal(isFileId(FILE_ID), true);
  assert.equal(isFileId('https://example.com/a.jpg'), false);
  assert.equal(isFileId(''), false);
  assert.equal(isFileId('cloud://'), false);
});

test('publish 把文档顶层字段直接写入（不包 data），createdAt 是真实时间戳', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  const result = await service.publish({ imageFileId: FILE_ID, text: '我种的枇杷', nickname: '冰冰' }, 'openid-A');
  assert.equal(result.ok, true);
  const docs = Array.from(stub.docs.values());
  assert.equal(docs.length, 1);
  assert.equal(docs[0].image, FILE_ID);
  assert.equal(docs[0].text, '我种的枇杷');
  assert.equal(docs[0].nickname, '冰冰');
  assert.equal(docs[0].likes, 0);
  assert.ok(docs[0].createdAt > 0, 'createdAt 必须是毫秒时间戳');
  assert.equal(docs[0].openid, 'openid-A');
});

test('publish 拒绝缺失或非法的图片 fileID', async () => {
  const service = makeService(createSdkStub());
  await assert.rejects(() => service.publish({ imageFileId: '', text: 'x' }), /图片缺失/);
  await assert.rejects(() => service.publish({ imageFileId: 'https://x/a.jpg', text: 'x' }), /格式无效/);
});

test('list 返回所有人的帖子，图片已转 https 临时链接', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: 'A 的帖', nickname: 'A' }, 'openid-A');
  await service.publish({ imageFileId: FILE_ID, text: 'B 的帖', nickname: 'B' }, 'openid-B');
  const result = await service.list('openid-A');
  assert.equal(result.posts.length, 2);
  const texts = result.posts.map(p => p.text).sort();
  assert.deepEqual(texts, ['A 的帖', 'B 的帖']);
  for (const post of result.posts) {
    assert.match(post.image, /^https:\/\//, '图片必须是可直接渲染的 https 链接');
  }
});

test('list 对 v36 包裹脏数据自动拆包展示并懒迁移回写', async () => {
  const stub = createSdkStub();
  // 模拟 v36 写坏的文档：真实内容全部被包进 data 字段
  stub.docs.set('dirty001', { data: { image: FILE_ID, text: '老帖内容', nickname: '冰冰', likes: 3, comments: [], createdAt: 0 } });
  const service = makeService(stub);
  const result = await service.list('');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].text, '老帖内容');
  assert.equal(result.posts[0].likes, 3);
  assert.equal(result.posts[0].image, 'https://tmp.example.com/' + FILE_ID);
  // 懒迁移：文档被回写为顶层结构，data 字段清空
  const fixed = stub.docs.get('dirty001');
  assert.equal(fixed.text, '老帖内容');
  assert.equal(fixed.createdAt, 0);
  assert.equal(fixed.data, null);
});

test('unwrapRow 只拆真正的包裹结构，正常文档原样返回', () => {
  const normal = { _id: 'a', image: FILE_ID, text: 'x' };
  assert.equal(unwrapRow(normal), normal);
  const dirty = { _id: 'b', data: { image: FILE_ID, text: 'y' } };
  const unwrapped = unwrapRow(dirty);
  assert.equal(unwrapped.text, 'y');
  assert.equal(unwrapped._id, 'b');
});

test('like 是朋友圈式 toggle：同一用户再点一次是取消赞', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  const first = await service.like({ id: id }, 'openid-B');
  assert.deepEqual(first, { likes: 1, liked: true });
  const second = await service.like({ id: id }, 'openid-B');
  assert.deepEqual(second, { likes: 0, liked: false });
  // 另一个用户点赞互不影响
  const third = await service.like({ id: id }, 'openid-C');
  assert.deepEqual(third, { likes: 1, liked: true });
  // likedBy 打标：「我已赞」状态可在 list/detail 里还原
  const list = await service.list('openid-C');
  assert.equal(list.posts[0].liked, true);
  assert.equal(list.posts[0].likes, 1);
  const detail = await service.detail(id, 'openid-B');
  assert.equal(detail.post.liked, false);
});

test('like 无身份信息时退化为普通 +1（本地开发兜底）', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, '');
  const id = Array.from(stub.docs.keys())[0];
  const result = await service.like({ id: id }, '');
  assert.equal(result.likes, 1);
});

test('comment 真实写入 comments 字段并支持回复某人', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.comment({ id: id, text: '好漂亮', nickname: '冰冰' }, 'openid-B');
  const second = await service.comment({ id: id, text: '谢谢～', nickname: 'A', replyTo: '冰冰' }, 'openid-A');
  assert.equal(second.count, 2);
  const doc = stub.docs.get(id);
  assert.equal(doc.comments.length, 2);
  assert.deepEqual(doc.comments[0], { nickname: '冰冰', text: '好漂亮', replyTo: '', createdAt: doc.comments[0].createdAt, openid: 'openid-B' });
  assert.equal(doc.comments[1].replyTo, '冰冰');
  // 列表里可见（朋友圈式平铺）
  const list = await service.list('');
  assert.equal(list.posts[0].comments.length, 2);
});

test('comment 拒绝空文本与不存在的动态', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await assert.rejects(() => service.comment({ id: 'doc0001', text: '   ' }), /不能为空/);
  await assert.rejects(() => service.comment({ id: 'doc0001', text: 'hi' }), /不存在/);
  await assert.rejects(() => service.like({ id: 'nope!!' }, ''), /不存在/);
});

test('detail 返回单帖（含 liked 打标与图片 https），不存在时 404', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.like({ id: id }, 'openid-B');
  const result = await service.detail(id, 'openid-B');
  assert.equal(result.post._id, id);
  assert.equal(result.post.liked, true);
  assert.equal(result.post.likes, 1);
  assert.match(result.post.image, /^https:\/\//);
  await assert.rejects(() => service.detail('missing-id-999', ''), error => error.status === 404);
});

test('nicknameExists：他人已用的名字返回 exists=true，自己的历史名不算占用', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: 'B 的帖', nickname: '小冰' }, 'openid-B');
  // 自己（openid-A）曾用「小冰」发过帖，但改名查重应排除自己
  await service.publish({ imageFileId: FILE_ID, text: 'A 的旧帖', nickname: '小冰' }, 'openid-A');
  const taken = await service.nicknameExists('小冰', 'openid-A');
  assert.equal(taken.exists, true, '其他用户已用「小冰」，应判占用');
  const free = await service.nicknameExists('没人用过的名字', 'openid-A');
  assert.equal(free.exists, false);
});

test('nicknameExists：默认名「旅人」与空名豁免，不报占用', async () => {
  const service = makeService(createSdkStub());
  assert.deepEqual(await service.nicknameExists('旅人', 'openid-A'), { exists: false });
  assert.deepEqual(await service.nicknameExists('', 'openid-A'), { exists: false });
});

test('rename：把我的所有帖子与历史评论的旧昵称统一改成新名', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  // A 用旧名「冰冰」发了帖并评论
  await service.publish({ imageFileId: FILE_ID, text: 'A 的帖', nickname: '冰冰' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.comment({ id: id, text: 'A 的评论', nickname: '冰冰' }, 'openid-A');
  // B 的帖也带评论，但评论者不是 A（昵称不同），不应被误改
  await service.publish({ imageFileId: FILE_ID, text: 'B 的帖', nickname: 'B' }, 'openid-B');
  const idB = Array.from(stub.docs.keys())[1];
  await service.comment({ id: idB, text: 'B 自己评', nickname: 'B' }, 'openid-B');
  const result = await service.rename('冰冰', '小冰', 'openid-A');
  assert.deepEqual(result, { ok: true });
  // A 的帖子昵称已更新
  assert.equal(stub.docs.get(id).nickname, '小冰');
  // A 的评论昵称已更新
  assert.equal(stub.docs.get(id).comments[0].nickname, '小冰');
  // B 的帖子与评论不受影响
  assert.equal(stub.docs.get(idB).nickname, 'B');
  assert.equal(stub.docs.get(idB).comments[0].nickname, 'B');
});

test('rename：无 openid（本地调试）或新名等同旧名/默认名时安全跳过', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: '冰冰' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  assert.deepEqual(await service.rename('冰冰', '冰冰', 'openid-A'), { skipped: true, reason: 'noop' });
  assert.deepEqual(await service.rename('冰冰', '旅人', 'openid-A'), { skipped: true, reason: 'noop' });
  assert.deepEqual(await service.rename('冰冰', '小冰', ''), { skipped: true, reason: 'no_openid' });
  assert.equal(stub.docs.get(id).nickname, '冰冰', '跳过的改名不应改动帖子');
});

test('comment 把 openid 一并写入评论（用于后续认主删除）', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.comment({ id: id, text: '我的评论', nickname: '冰冰' }, 'openid-B');
  assert.equal(stub.docs.get(id).comments[0].openid, 'openid-B', '评论必须带 openid');
});

test('deleteComment：评论主人(openid 命中)可删，他人 403', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.comment({ id: id, text: 'B 的评论', nickname: 'B' }, 'openid-B'); // index 0
  await service.comment({ id: id, text: 'A 的评论', nickname: 'A' }, 'openid-A'); // index 1
  // 他人(A)不能删 B 的评论 → 403
  await assert.rejects(() => service.deleteComment({ id: id, index: 0, nickname: 'A' }, 'openid-A'), error => error.status === 403);
  // 主人(B)可删自己的评论
  const ok = await service.deleteComment({ id: id, index: 0, nickname: 'B' }, 'openid-B');
  assert.equal(ok.ok, true);
  assert.equal(stub.docs.get(id).comments.length, 1);
  assert.equal(stub.docs.get(id).comments[0].nickname, 'A');
});

test('deleteComment：无 openid 的旧评论按当前昵称认主（排除默认名「旅人」）', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: '帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  // 旧评论：没有 openid，只有昵称
  stub.docs.get(id).comments.push({ nickname: '老用户', text: '老评论', replyTo: '', createdAt: Date.now() });
  const ok = await service.deleteComment({ id: id, index: 0, nickname: '老用户' }, '');
  assert.equal(ok.ok, true);
  assert.equal(stub.docs.get(id).comments.length, 0);
  // 默认名「旅人」的旧评论不允许按昵称删除（避免匿名串删）
  stub.docs.get(id).comments.push({ nickname: '旅人', text: '匿名评论', replyTo: '', createdAt: Date.now() });
  await assert.rejects(() => service.deleteComment({ id: id, index: 0, nickname: '旅人' }, ''), error => error.status === 403);
});

test('deletePost：作者(openid)可删，他人 403，删除后查不到', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: 'A 的帖', nickname: 'A' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  const ok = await service.deletePost({ id: id }, 'openid-A');
  assert.equal(ok.ok, true);
  await assert.rejects(() => service.detail(id, 'openid-A'), error => error.status === 404);
  // 他人不能删
  await service.publish({ imageFileId: FILE_ID, text: 'B 的帖', nickname: 'B' }, 'openid-B');
  const idB = Array.from(stub.docs.keys())[0]; // A 已删除，只剩 B
  await assert.rejects(() => service.deletePost({ id: idB }, 'openid-A'), error => error.status === 403);
});

test('serializePost 给当前查看者标记 mine（按 openid）', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: 'A 的帖', nickname: 'A' }, 'openid-A');
  const mine = await service.list('openid-A');
  assert.equal(mine.posts[0].mine, true);
  const notMine = await service.list('openid-B');
  assert.equal(notMine.posts[0].mine, false);
});

test('rename 同时把旧评论补上 openid（便于后续按账号认主）', async () => {
  const stub = createSdkStub();
  const service = makeService(stub);
  await service.publish({ imageFileId: FILE_ID, text: 'A 的帖', nickname: '冰冰' }, 'openid-A');
  const id = Array.from(stub.docs.keys())[0];
  await service.comment({ id: id, text: 'A 的旧评论', nickname: '冰冰' }, 'openid-A');
  await service.rename('冰冰', '小冰', 'openid-A');
  const c = stub.docs.get(id).comments[0];
  assert.equal(c.nickname, '小冰');
  assert.equal(c.openid, 'openid-A');
});

