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
      }
    }),
    orderBy: () => collection,
    limit: () => collection,
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
  assert.deepEqual(doc.comments[0], { nickname: '冰冰', text: '好漂亮', replyTo: '', createdAt: doc.comments[0].createdAt });
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
