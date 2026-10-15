'use strict';
// 「退出工作台 → 身份切回游客」这条链的常驻回归用例。
//
// 背景：pages/seller/index.js 的 leaveAsTourist() 里 require 的路径原本多写了一层
// （'../../../lib/store'）—— 从 miniprogram/pages/seller/ 往上三层已经出了 miniprogram/，
// 微信端必然 MODULE_NOT_FOUND；又因为外面套了 try/catch（"切不动也不能卡住导航"），
// 异常被吞掉、页面照常导航，于是「身份切回游客」线上静默失效：用户退出了工作台，
// 身份仍是 farmer，再回到起始页又被带回工作台。
//
// 本文件不检查路径字符串，只检查行为：调用退出出口后，store 层必须真的被调用到、
// 身份必须真的落盘成游客。路径写错时这里看到的是「一次都没调用」，而不是「报错」——
// 所以断言必须盯住调用次数与落盘结果，不能只断言"没抛异常"。

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../miniprogram/lib/store');
const { pageFile } = require('./helpers/page-path');

const originalWx = global.wx;
const originalPage = global.Page;
const clone = value => JSON.parse(JSON.stringify(value));

let memory;
let calls;

function mockWx() {
  global.wx = {
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, clone(value)),
    removeStorageSync: key => memory.delete(key),
    reLaunch: options => calls.navigation.push(options.url),
    switchTab: options => calls.navigation.push(options.url),
    hideHomeButton: () => { calls.hidden += 1; },
    showToast: options => calls.toasts.push(options),
    // 本用例不关心列表加载；网络一律失败，页面自己会走 catch 分支。
    request: options => { if (options && options.fail) options.fail({ errMsg: 'network disabled in this test' }); }
  };
}

/** 加载真实的 pages/seller/index.js，返回一个可直接调用其方法的页面实例 */
function makePage() {
  let definition;
  global.Page = value => { definition = value; };
  const file = pageFile('seller', 'index');
  delete require.cache[require.resolve(file)];
  require(file);
  return Object.assign({}, definition, { data: clone(definition.data) });
}

/** 观察 store 层：既记录调用，又照常落到真实实现，避免只测到桩、测不到行为 */
function spyOnSaveIdentity() {
  const real = store.saveIdentity;
  const seen = [];
  store.saveIdentity = function (patch, partition) {
    seen.push(patch);
    return real.call(store, patch, partition);
  };
  seen.restore = () => { store.saveIdentity = real; };
  return seen;
}

test.beforeEach(() => {
  memory = new Map();
  calls = { navigation: [], toasts: [], hidden: 0 };
  mockWx();
  store.clearAll();
});
test.after(() => { global.wx = originalWx; global.Page = originalPage; });

test('backToTourist really reaches the store layer and persists the tourist identity', () => {
  const seen = spyOnSaveIdentity();
  try {
    const subject = makePage();
    subject.backToTourist();
    assert.equal(seen.length, 1, '退出工作台必须真的调用到 store 层（require 路径写错时这里是 0，且不会有任何报错）');
    assert.deepEqual(seen[0], { role: 'tourist', roleChosen: true });
    const identity = store.getIdentity();
    assert.equal(identity.role, 'tourist', '身份必须真的落盘成游客');
    assert.equal(identity.roleChosen, true, '游客身份必须标记为"已选过"，否则回到起始页还会被要求选身份');
    assert.equal(calls.navigation.at(-1), '/pages/index/index', '切完身份要回起始页');
  } finally { seen.restore(); }
});

test('onHide and onUnload (返回 / 切 tabBar / 小房子) also switch identity back to tourist', () => {
  const seen = spyOnSaveIdentity();
  try {
    const subject = makePage();
    subject.onHide();
    assert.equal(seen.length, 1, 'onHide 必须切回游客');
    subject.onUnload();
    assert.equal(seen.length, 2, 'onUnload 必须切回游客');
    assert.equal(store.getIdentity().role, 'tourist');
  } finally { seen.restore(); }
});

test('a failing store never blocks navigation out of the workbench', () => {
  const real = store.saveIdentity;
  store.saveIdentity = () => { throw new Error('模拟切身份失败'); };
  try {
    const subject = makePage();
    assert.doesNotThrow(() => subject.backToTourist());
    assert.equal(calls.navigation.at(-1), '/pages/index/index', '切不动身份也不能把用户卡在工作台里');
  } finally { store.saveIdentity = real; }
});
