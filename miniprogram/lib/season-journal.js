'use strict';
// 我的节气手账：Canvas 足迹图绘制逻辑（P13 行程 / 果农工作台重构）。
// 简化中国地图轮廓 + 已收藏省份点亮 + 果乡列表 + 小程序码占位。
// 坐标用归一化 0..1，绘制时乘以地图区域宽高，便于在不同尺寸画布上复用。

// 主要省份在小程序海报地图上的相对位置（示意，非精确经纬度）。
const PROVINCE_POS = {
  '新疆': { x: 0.20, y: 0.26 }, '北京': { x: 0.62, y: 0.28 }, '辽宁': { x: 0.68, y: 0.20 },
  '河北': { x: 0.60, y: 0.32 }, '山西': { x: 0.55, y: 0.37 }, '甘肃': { x: 0.40, y: 0.35 },
  '陕西': { x: 0.49, y: 0.42 }, '山东': { x: 0.64, y: 0.40 }, '河南': { x: 0.57, y: 0.47 },
  '江苏': { x: 0.69, y: 0.48 }, '湖北': { x: 0.56, y: 0.54 }, '四川': { x: 0.43, y: 0.54 },
  '安徽': { x: 0.63, y: 0.52 }, '湖南': { x: 0.57, y: 0.63 }, '浙江': { x: 0.72, y: 0.57 },
  '云南': { x: 0.37, y: 0.66 }, '福建': { x: 0.71, y: 0.65 }, '广东': { x: 0.62, y: 0.73 },
  '广西': { x: 0.55, y: 0.74 }, '贵州': { x: 0.50, y: 0.62 }, '江西': { x: 0.65, y: 0.60 }
};

function posterSize() { return { width: 600, height: 900 }; }
function font() {
  const base = typeof wx !== 'undefined' && wx.getWindowInfo && wx.getWindowInfo().fontSizeSetting;
  return base || 16;
}
function dpr() {
  if (typeof wx !== 'undefined' && wx.getWindowInfo && wx.getWindowInfo().pixelRatio) return wx.getWindowInfo().pixelRatio;
  if (typeof wx !== 'undefined' && wx.getSystemInfoSync) return wx.getSystemInfoSync().pixelRatio || 2;
  return 2;
}

// 简化中国轮廓（抽象绿色陆地 + 边界），纯展示用。
function drawLandmass(ctx, area) {
  const x = area.x, y = area.y, w = area.w, h = area.h;
  ctx.save();
  ctx.fillStyle = '#EAF1E2';
  ctx.strokeStyle = '#C7D8BE';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.30, y + h * 0.06);
  ctx.bezierCurveTo(x + w * 0.55, y - h * 0.02, x + w * 0.80, y + h * 0.10, x + w * 0.86, y + h * 0.30);
  ctx.bezierCurveTo(x + w * 0.92, y + h * 0.50, x + w * 0.78, y + h * 0.66, x + w * 0.66, y + h * 0.82);
  ctx.bezierCurveTo(x + w * 0.56, y + h * 0.94, x + w * 0.40, y + h * 0.92, x + w * 0.32, y + h * 0.78);
  ctx.bezierCurveTo(x + w * 0.18, y + h * 0.60, x + w * 0.10, y + h * 0.40, x + w * 0.18, y + h * 0.22);
  ctx.bezierCurveTo(x + w * 0.22, y + h * 0.12, x + w * 0.24, y + h * 0.08, x + w * 0.30, y + h * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMap(ctx, area, litProvinces) {
  drawLandmass(ctx, area);
  const lit = new Set(litProvinces || []);
  Object.keys(PROVINCE_POS).forEach(function (name) {
    const pos = PROVINCE_POS[name];
    const cx = area.x + pos.x * area.w;
    const cy = area.y + pos.y * area.h;
    const on = lit.has(name);
    ctx.beginPath();
    ctx.arc(cx, cy, on ? 9 : 5, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#3C9D6E' : '#B9C7B0';
    ctx.fill();
    if (on) {
      ctx.fillStyle = '#234B3C';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, cx, cy - 14);
    }
  });
}

// 绘制完整分享海报到 2D ctx（逻辑尺寸 600x900）。
function drawPoster(ctx, opts) {
  const size = posterSize();
  const W = size.width, H = size.height;
  ctx.fillStyle = '#FFFDF8';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#234B3C';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('我的节气果乡足迹', 36, 60);
  ctx.fillStyle = '#3C9D6E';
  ctx.font = '20px sans-serif';
  ctx.fillText('果物四时记 · 四时果乡漫游', 36, 92);
  const mapArea = { x: 60, y: 120, w: 480, h: 460 };
  drawMap(ctx, mapArea, opts.litProvinces || []);
  ctx.fillStyle = '#234B3C';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('我去过的果乡', 36, 640);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#3a4a40';
  const list = (opts.towns || []).slice(0, 5);
  if (!list.length) {
    ctx.fillText('还没有收藏的果乡，去「行程」逛逛吧', 36, 680);
  } else {
    list.forEach(function (t, i) {
      ctx.fillText('· ' + t.name + '（' + (t.term || '当季') + '）', 36, 680 + i * 38);
    });
  }
  const codeX = W - 156, codeY = H - 176;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#C7D8BE';
  ctx.lineWidth = 2;
  ctx.fillRect(codeX, codeY, 120, 120);
  ctx.strokeRect(codeX, codeY, 120, 120);
  ctx.fillStyle = '#3C9D6E';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('小程序码', codeX + 60, codeY + 64);
  return size;
}

module.exports = { PROVINCE_POS, posterSize, dpr, drawLandmass, drawMap, drawPoster };
