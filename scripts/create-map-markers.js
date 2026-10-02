'use strict';
// Generates the native-map marker icons: a cream-ringed green dot and a darker
// active variant. 3x resolution for retina; the map component scales to the
// marker width/height set in route-presentation.js.
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const SIZE = 72;
const OUT_DIR = path.resolve(__dirname, '../miniprogram/assets');

function hex(color) {
  return { r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) };
}

function draw(fill, ring, centerDot) {
  const png = new PNG({ width: SIZE, height: SIZE });
  const cx = SIZE / 2, cy = SIZE / 2;
  const outer = SIZE / 2 - 2;       // ring radius
  const inner = outer - 7;          // fill radius
  const dot = centerDot ? 9 : 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const edge = Math.max(0, Math.min(1, outer - distance + 0.5)); // 1px anti-alias
      const idx = (SIZE * y + x) << 2;
      let color = ring;
      if (distance <= inner) color = fill;
      if (centerDot && distance <= dot) color = { r: 250, g: 248, b: 235 };
      png.data[idx] = color.r; png.data[idx + 1] = color.g; png.data[idx + 2] = color.b;
      png.data[idx + 3] = Math.round(edge * 255);
    }
  }
  return PNG.sync.write(png);
}

fs.writeFileSync(path.join(OUT_DIR, 'map-marker.png'), draw(hex('#799368'), hex('#FAF9EE'), false));
fs.writeFileSync(path.join(OUT_DIR, 'map-marker-active.png'), draw(hex('#234B3C'), hex('#FAF9EE'), true));
console.log('markers written to', OUT_DIR);
