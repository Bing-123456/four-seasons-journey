'use strict';
// Generates the "学习" tab icon: an open-book line glyph, matching the
// existing stroke style (gray inactive / deep-green active).
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const SIZE = 96;
function hex(c) { return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) }; }

function drawBook(color) {
  const png = new PNG({ width: SIZE, height: SIZE });
  const set = (x, y, a) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (SIZE * y + x) << 2;
    png.data[i] = color.r; png.data[i + 1] = color.g; png.data[i + 2] = color.b; png.data[i + 3] = Math.max(png.data[i + 3], Math.round(a * 255));
  };
  const line = (x0, y0, x1, y1, w) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
      for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
        if (dx * dx + dy * dy <= w * w) set(Math.round(x + dx), Math.round(y + dy), 1);
      }
    }
  };
  const cx = SIZE / 2, top = 24, mid = 34, bottom = 74;
  line(cx, mid, 12, top, 2); line(cx, mid, 12, bottom, 2); line(12, top, 12, bottom, 2);
  line(cx, mid, SIZE - 12, top, 2); line(cx, mid, SIZE - 12, bottom, 2); line(SIZE - 12, top, SIZE - 12, bottom, 2);
  line(12, bottom, cx, mid - 8, 2); line(SIZE - 12, bottom, cx, mid - 8, 2);
  line(cx, mid, cx, bottom - 4, 2);
  line(22, top + 16, cx - 10, top + 22, 1);
  line(22, top + 30, cx - 10, top + 36, 1);
  line(cx + 10, top + 22, SIZE - 22, top + 16, 1);
  line(cx + 10, top + 36, SIZE - 22, top + 30, 1);
  return PNG.sync.write(png);
}

const out = path.resolve(__dirname, '../miniprogram/assets');
fs.writeFileSync(out + '/learn.png', drawBook(hex('#798479')));
fs.writeFileSync(out + '/learn-active.png', drawBook(hex('#234B3C')));
console.log('learn icons written');
