'use strict';

// 头像裁剪纯数学：与 wx / canvas 完全无关，便于单测。
// 【10.5 改版：微信式「框动图不动」】
// 旧模型是白框固定、拖照片（用户看不出能操作）；现在改成微信编辑图片那样：
//   照片完整铺在舞台上不动，用户拖白色正方形裁剪框、拉四角/边中点来选范围。
// 坐标系约定（全部 px，与 pages/account/account.js 的 stage 一致）：
//   - stage：裁剪可用区（整屏减去顶部提示栏与底部按钮栏）。
//   - disp  ：照片以 contain 方式在 stage 内的显示矩形 { offsetX, offsetY, dispW, dispH }。
//   - frame ：裁剪框 { x, y, size }（正方形），坐标同 stage；恒被钳制在照片显示区内。
//   - handle：把手 'nw' | 'ne' | 'sw' | 'se'（四角）与 'n' | 's' | 'w' | 'e'（四边中点）。

const MIN_SIZE = 60; // 裁剪框最小边长（px），避免拉没了

function clamp(value, min, max) {
  if (min > max) return min;
  return Math.max(min, Math.min(max, value));
}

// 照片等比铺满舞台（contain），返回显示矩形与缩放比。
function fitPhoto(info, stageW, stageH) {
  if (!info || !info.width || !info.height || !stageW || !stageH) return null;
  const scale = Math.min(stageW / info.width, stageH / info.height);
  const dispW = info.width * scale;
  const dispH = info.height * scale;
  return { offsetX: (stageW - dispW) / 2, offsetY: (stageH - dispH) / 2, dispW: dispW, dispH: dispH, scale: scale };
}

// 初始裁剪框：照片显示区内最大的正方形，居中。
function initialFrame(disp) {
  if (!disp) return null;
  const size = Math.min(disp.dispW, disp.dispH);
  return { x: disp.offsetX + (disp.dispW - size) / 2, y: disp.offsetY + (disp.dispH - size) / 2, size: size };
}

// 把裁剪框钳制在照片显示区内（保持正方形，先限尺寸再限位置）。
function clampFrame(frame, disp) {
  if (!frame || !disp) return null;
  const maxSize = Math.min(disp.dispW, disp.dispH);
  const size = clamp(frame.size, Math.min(MIN_SIZE, maxSize), Math.max(MIN_SIZE, maxSize));
  const x = clamp(frame.x, disp.offsetX, disp.offsetX + disp.dispW - size);
  const y = clamp(frame.y, disp.offsetY, disp.offsetY + disp.dispH - size);
  return { x: x, y: y, size: size };
}

// 拖动把手改变框大小：以「对侧」为锚点，正方形两边同步，且不越出照片显示区。
function resizeFrame(frame, handle, px, py, disp) {
  if (!frame || !disp || !handle) return frame;
  const left = handle.indexOf('w') >= 0 || handle === 'w';
  const right = handle.indexOf('e') >= 0 || handle === 'e';
  const top = handle.indexOf('n') >= 0 || handle === 'n';
  const bottom = handle.indexOf('s') >= 0 || handle === 's';
  // 四角：锚点在正对角；边中点：锚点在对边（沿中心轴变化）
  const anchorX = left ? frame.x + frame.size : (right ? frame.x : frame.x + frame.size / 2);
  const anchorY = top ? frame.y + frame.size : (bottom ? frame.y : frame.y + frame.size / 2);
  const roomW = left ? anchorX - disp.offsetX : (right ? disp.offsetX + disp.dispW - anchorX : Math.min(anchorX - disp.offsetX, disp.offsetX + disp.dispW - anchorX) * 2);
  const roomH = top ? anchorY - disp.offsetY : (bottom ? disp.offsetY + disp.dispH - anchorY : Math.min(anchorY - disp.offsetY, disp.offsetY + disp.dispH - anchorY) * 2);
  const limit = Math.max(MIN_SIZE, Math.min(roomW, roomH));
  let size = Math.max(Math.abs(px - anchorX), Math.abs(py - anchorY));
  size = clamp(size, Math.min(MIN_SIZE, limit), limit);
  const x = left ? anchorX - size : (right ? anchorX : anchorX - size / 2);
  const y = top ? anchorY - size : (bottom ? anchorY : anchorY - size / 2);
  return clampFrame({ x: x, y: y, size: size }, disp);
}

// 命中测试：触点是否落在某个把手上（stage 坐标，半径内算命中），返回 handle 或 null。
function hitHandle(frame, px, py, radius) {
  if (!frame) return null;
  const r = radius || 24;
  const corners = [
    ['nw', frame.x, frame.y], ['ne', frame.x + frame.size, frame.y],
    ['sw', frame.x, frame.y + frame.size], ['se', frame.x + frame.size, frame.y + frame.size]
  ];
  for (const item of corners) {
    if (Math.abs(px - item[1]) <= r && Math.abs(py - item[2]) <= r) return item[0];
  }
  const mid = [
    ['n', frame.x + frame.size / 2, frame.y], ['s', frame.x + frame.size / 2, frame.y + frame.size],
    ['w', frame.x, frame.y + frame.size / 2], ['e', frame.x + frame.size, frame.y + frame.size / 2]
  ];
  for (const item of mid) {
    if (Math.abs(px - item[1]) <= r && Math.abs(py - item[2]) <= r) return item[0];
  }
  return null;
}

function insideFrame(frame, px, py) {
  if (!frame) return false;
  return px >= frame.x && px <= frame.x + frame.size && py >= frame.y && py <= frame.y + frame.size;
}

// 由裁剪框反算原图裁剪矩形（正方形），返回 null 表示入参非法。
function computeRectFromFrame(info, disp, frame) {
  if (!info || !info.width || !info.height || !disp || !disp.dispW || !disp.dispH || !frame || !frame.size) return null;
  const scaleX = info.width / disp.dispW;
  const scaleY = info.height / disp.dispH; // contain 等比：scaleX 与 scaleY 相等
  const sx = clamp((frame.x - disp.offsetX) * scaleX, 0, Math.max(0, info.width - frame.size * scaleX));
  const sy = clamp((frame.y - disp.offsetY) * scaleY, 0, Math.max(0, info.height - frame.size * scaleY));
  const sw = Math.min(frame.size * scaleX, info.width, info.height);
  return { sx: sx, sy: sy, sw: sw };
}

module.exports = { clamp, fitPhoto, initialFrame, clampFrame, resizeFrame, hitHandle, insideFrame, computeRectFromFrame, MIN_SIZE };
