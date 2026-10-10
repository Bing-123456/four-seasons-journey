'use strict';
// 头像裁剪（10.5 改版）：微信式「框动图不动」——照片铺在舞台上不动，
// 用户拖动白色正方形裁剪框、拉四角/四边中点来选范围，确认后按框裁出头像。
// 这份测试锁死几何换算，避免拖动/拉伸时出现框跑出照片、裁出空白等回归。
const test = require('node:test');
const assert = require('node:assert/strict');
const cropMath = require('../miniprogram/packageMore/lib/crop-math');

const INFO = { width: 1200, height: 800 }; // 横图
const STAGE = { width: 375, height: 500 };

test('照片按 contain 等比铺满舞台，且始终居中', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  // 375/1200 与 500/800 中取小者：scale = 0.3125 → 375×250
  assert.ok(Math.abs(disp.dispW - 375) < 0.001);
  assert.ok(Math.abs(disp.dispH - 250) < 0.001);
  assert.ok(Math.abs(disp.offsetX) < 0.001);
  assert.ok(Math.abs(disp.offsetY - 125) < 0.001, '竖向居中：上下各留 125');
  // 竖图：以高为准
  const tall = cropMath.fitPhoto({ width: 800, height: 1200 }, STAGE.width, STAGE.height);
  assert.ok(Math.abs(tall.dispH - 500) < 0.001);
  assert.ok(Math.abs(tall.offsetX - (375 - tall.dispW) / 2) < 0.001);
  // 非法入参不炸
  assert.equal(cropMath.fitPhoto(null, 375, 500), null);
  assert.equal(cropMath.fitPhoto({ width: 0, height: 0 }, 375, 500), null);
});

test('初始裁剪框是照片内最大正方形并居中', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const frame = cropMath.initialFrame(disp);
  assert.equal(frame.size, 250, '取照片短边');
  assert.equal(frame.x, disp.offsetX + (disp.dispW - 250) / 2);
  assert.equal(frame.y, disp.offsetY + (disp.dispH - 250) / 2);
});

test('裁剪框恒被钳制在照片范围内（拖不出界）', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const inner = { x: disp.offsetX, y: disp.offsetY, size: Math.min(disp.dispW, disp.dispH) };
  assert.deepEqual(cropMath.clampFrame({ x: -999, y: -999, size: 200 }, disp), { x: disp.offsetX, y: disp.offsetY, size: 200 });
  assert.deepEqual(cropMath.clampFrame({ x: 9999, y: 9999, size: 200 }, disp), { x: disp.dispW - 200, y: disp.offsetY + disp.dispH - 200, size: 200 });
  // 框不会被拉得比照片还大，也不会小于最小值
  assert.equal(cropMath.clampFrame({ x: 0, y: 0, size: 9999 }, disp).size, 250);
  assert.ok(cropMath.clampFrame({ x: 0, y: 0, size: 1 }, disp).size >= cropMath.MIN_SIZE);
  assert.ok(inner.size > 0);
});

test('拉四角：以对角为锚点，正方形同步缩放且不越出照片', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const frame = { x: disp.offsetX, y: disp.offsetY, size: 200 };
  // 拖右下角往内收：锚点在左上，size 变小
  const smaller = cropMath.resizeFrame(frame, 'se', disp.offsetX + 120, disp.offsetY + 120, disp);
  assert.equal(smaller.x, frame.x, '锚点不动');
  assert.equal(smaller.y, frame.y);
  assert.equal(smaller.size, 120);
  // 拖右下角往外拉：最多只能到照片边界
  const bigger = cropMath.resizeFrame(frame, 'se', disp.offsetX + 400, disp.offsetY + 400, disp);
  assert.equal(bigger.x, frame.x);
  assert.ok(bigger.size <= disp.dispH - 0 + 0.001, '不超过照片短边');
  // 拖左上角往右下收：锚点在右下（200, 325），位移取两轴较大者（纵向 140）
  const fromNw = cropMath.resizeFrame(frame, 'nw', disp.offsetX + 100, disp.offsetY + 60, disp);
  assert.equal(fromNw.x + fromNw.size, frame.x + frame.size, '右下角保持不动');
  assert.equal(fromNw.size, 140, '横纵位移取较大者，保持正方形');
});

test('拉四边中点：沿中心轴缩放，中心不偏移', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const frame = cropMath.initialFrame(disp);
  const centerX = frame.x + frame.size / 2;
  const fromTop = cropMath.resizeFrame(frame, 'n', centerX, disp.offsetY + 50, disp);
  assert.ok(Math.abs((fromTop.x + fromTop.size / 2) - centerX) < 0.001, '横向中心不变');
  assert.equal(fromTop.y + fromTop.size, frame.y + frame.size, '底边不动');
  const fromLeft = cropMath.resizeFrame(frame, 'w', disp.offsetX + 100, frame.y + 10, disp);
  assert.equal(fromLeft.x + fromLeft.size, frame.x + frame.size, '右边不动');
});

test('命中测试：角与边中点可命中，框外不响应', () => {
  const frame = { x: 100, y: 100, size: 200 };
  assert.equal(cropMath.hitHandle(frame, 100, 100, 26), 'nw');
  assert.equal(cropMath.hitHandle(frame, 300, 300, 26), 'se');
  assert.equal(cropMath.hitHandle(frame, 200, 104, 26), 'n');
  assert.equal(cropMath.hitHandle(frame, 104, 200, 26), 'w');
  assert.equal(cropMath.hitHandle(frame, 200, 200, 26), null, '框中心不命中把手');
  assert.equal(cropMath.hitHandle(frame, 500, 500, 26), null);
  assert.equal(cropMath.insideFrame(frame, 200, 200), true);
  assert.equal(cropMath.insideFrame(frame, 500, 500), false);
});

test('按框换算原图裁剪矩形，裁出来始终落在图内', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const frame = cropMath.initialFrame(disp);
  const rect = cropMath.computeRectFromFrame(INFO, disp, frame);
  assert.ok(rect.sw > 0);
  assert.ok(rect.sx >= 0 && rect.sy >= 0);
  assert.ok(rect.sx + rect.sw <= INFO.width + 0.001);
  assert.ok(rect.sy + rect.sw <= INFO.height + 0.001, '正方形裁剪，纵向也不越界');
  // 整幅短边全裁：原图 800 高 → 边长应为 800
  assert.ok(Math.abs(rect.sw - 800) < 0.001);
  // 框缩小一半 → 原图边长也减半
  const half = cropMath.computeRectFromFrame(INFO, disp, { x: frame.x, y: frame.y, size: frame.size / 2 });
  assert.ok(Math.abs(half.sw - 400) < 0.001);
  // 非法入参
  assert.equal(cropMath.computeRectFromFrame(null, disp, frame), null);
  assert.equal(cropMath.computeRectFromFrame(INFO, null, frame), null);
  assert.equal(cropMath.computeRectFromFrame(INFO, disp, null), null);
  assert.equal(cropMath.computeRectFromFrame(INFO, disp, { x: 0, y: 0, size: 0 }), null);
});

test('拖动框内任一点，框整体平移且不出照片', () => {
  const disp = cropMath.fitPhoto(INFO, STAGE.width, STAGE.height);
  const frame = cropMath.initialFrame(disp);
  const moved = cropMath.clampFrame({ x: frame.x - 500, y: frame.y - 500, size: frame.size }, disp);
  assert.equal(moved.x, disp.offsetX);
  assert.equal(moved.y, disp.offsetY);
  assert.equal(moved.size, frame.size, '平移不改变大小');
});

test('account 页面改用框动模型：拖框/拉把手，不再有推图与滑杆', () => {
  const fs = require('fs');
  const path = require('path');
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageMore/account/account.wxml'), 'utf8');
  const logic = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageMore/account/account.js'), 'utf8');
  const style = fs.readFileSync(path.resolve(__dirname, '../miniprogram/packageMore/account/account.wxss'), 'utf8');
  assert.match(markup, /class="crop-frame"/, '有可拖动的裁剪框');
  assert.match(markup, /class="crop-handle ch-nw"/, '四角把手');
  assert.match(markup, /class="crop-dot dot-n"/, '边中点把手');
  assert.match(markup, /\{\{L\.crop_hint\}\}/, '有操作提示');
  assert.doesNotMatch(markup, /slider/, '取消缩放滑杆');
  assert.doesNotMatch(logic, /cropZoom/, '不再用双指缩放推图');
  assert.match(logic, /cropMath\.resizeFrame/);
  assert.match(logic, /cropMath\.computeRectFromFrame/);
  assert.match(style, /\.crop-frame \{[^}]*border: 3rpx solid #FFFFFF/, '白框明显可见');
});
