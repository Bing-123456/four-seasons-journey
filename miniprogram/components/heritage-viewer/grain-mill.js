'use strict';

const renderer = require('./renderer');
const MILL_VIEW = { yaw: -0.48, pitch: 0.76, zoom: 1.04, autoRotate: false };
const CAMERA_VIEWS = {
  overview: MILL_VIEW,
  top: { yaw: 0, pitch: 1.3, zoom: 1.06, autoRotate: false },
  side: { yaw: -0.9, pitch: 0.2, zoom: 1.04, autoRotate: false }
};
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// Positions and colours illustrate the documented structure and action. They are
// neither a museum scan nor a physical grain-processing simulation.
function createMillMesh(position, progress) {
  const vertices = [], indices = [];
  const offset = (clamp(Number(position) || 0, 0, 100) - 50) / 50 * 0.7;
  progress = clamp(Number(progress) || 0, 0, 1);
  function vertex(x, y, z, nx, ny, nz, colour) {
    vertices.push(x, y, z, nx, ny, nz, (colour + 0.5) / 5, 0.5);
    return vertices.length / 8 - 1;
  }
  function triangle(a, b, c) { indices.push(a, b, c); }
  function ellipsoid(cx, cy, cz, rx, ry, rz, colour, rows, columns) {
    const base = vertices.length / 8;
    for (let row = 0; row <= rows; row++) {
      const angle = row / rows * Math.PI;
      for (let col = 0; col <= columns; col++) {
        const azimuth = col / columns * Math.PI * 2;
        const x = Math.sin(angle) * Math.cos(azimuth), y = Math.cos(angle), z = Math.sin(angle) * Math.sin(azimuth);
        const length = Math.hypot(x / rx, y / ry, z / rz);
        vertex(cx + x * rx, cy + y * ry, cz + z * rz, x / rx / length, y / ry / length, z / rz / length, colour);
      }
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const a = base + row * (columns + 1) + col, b = a + columns + 1;
      triangle(a, b, a + 1); triangle(a + 1, b, b + 1);
    }
  }
  // An elongated, slightly tapered slab with a flat working face and four feet.
  const segments = 56, rings = 7, top = vertices.length / 8;
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings;
    for (let col = 0; col <= segments; col++) {
      const a = col / segments * Math.PI * 2;
      const z = Math.sin(a) * 1.18 * radius;
      const x = Math.cos(a) * 0.54 * radius * (1 + z * 0.10);
      vertex(x, 0.08, z, 0, 1, 0, 0);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = top + r * (segments + 1) + s, b = a + segments + 1;
    triangle(a, b, a + 1); triangle(a + 1, b, b + 1);
  }
  const side = vertices.length / 8;
  for (let ring = 0; ring < 2; ring++) for (let col = 0; col <= segments; col++) {
    const a = col / segments * Math.PI * 2, z = Math.sin(a) * 1.18;
    const x = Math.cos(a) * 0.54 * (1 + z * 0.10);
    const nx = Math.cos(a) / 0.54, nz = Math.sin(a) / 1.18, length = Math.hypot(nx, nz);
    vertex(x, ring ? -0.10 : 0.08, z, nx / length, 0, nz / length, 1);
  }
  for (let s = 0; s < segments; s++) { const a = side + s, b = a + segments + 1; triangle(a, b, a + 1); triangle(a + 1, b, b + 1); }
  for (let i = 0; i < 4; i++) ellipsoid(i % 2 ? 0.30 : -0.30, -0.14, i < 2 ? -0.68 : 0.68, 0.10, 0.17, 0.13, 1, 5, 10);

  // The transverse rod both translates and rolls around its own long axis.
  const rodStart = vertices.length / 8, rodRings = 16, rodSides = 24;
  const roll = offset / 0.115;
  for (let ring = 0; ring <= rodRings; ring++) {
    const t = ring / rodRings, x = (t - 0.5) * 1.80;
    const radius = 0.107 + 0.022 * Math.pow(Math.abs(t - 0.5) * 2, 2);
    for (let s = 0; s <= rodSides; s++) {
      const a = s / rodSides * Math.PI * 2 + roll;
      const variation = 1 + 0.015 * Math.sin(s * 3 + ring);
      vertex(x, 0.215 + Math.cos(a) * radius * variation, offset + Math.sin(a) * radius * variation, 0, Math.cos(a), Math.sin(a), s % 8 === 0 ? 1 : 0);
    }
  }
  for (let r = 0; r < rodRings; r++) for (let s = 0; s < rodSides; s++) {
    const a = rodStart + r * (rodSides + 1) + s, b = a + rodSides + 1;
    triangle(a, b, a + 1); triangle(a + 1, b, b + 1);
  }
  for (let end = 0; end < 2; end++) {
    const centre = vertex(end ? 0.9 : -0.9, 0.215, offset, end ? 1 : -1, 0, 0, 1);
    const edge = rodStart + (end ? rodRings * (rodSides + 1) : 0);
    for (let s = 0; s < rodSides; s++) triangle(centre, edge + s, edge + s + 1);
  }
  // Deterministic grain placement; split colours are a learning cue, not yield.
  for (let i = 0; i < 18; i++) {
    const x = ((i * 7) % 11 - 5) * 0.057, z = ((i * 13) % 19 - 9) * 0.071;
    const processed = i / 18 < progress;
    ellipsoid(x, 0.107, z, processed ? 0.023 : 0.028, 0.019, 0.043, processed ? 3 : 2, 4, 6);
    if (processed) ellipsoid(x + 0.044, 0.098, z + 0.027, 0.018, 0.009, 0.027, 4, 3, 5);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), vertexCount: vertices.length / 8, triangleCount: indices.length / 3, rodOffset: offset, rodRoll: roll };
}

function initialMotion() { return { position: 0, lastEnd: 0, strokes: 0 }; }
function updateMotion(state, position) {
  const next = Object.assign({}, state, { position: clamp(Number(position) || 0, 0, 100) });
  const end = next.position <= 10 ? 0 : next.position >= 90 ? 100 : null;
  if (end !== null && end !== next.lastEnd) { next.strokes = Math.min(4, next.strokes + 1); next.lastEnd = end; }
  return next;
}

class GrainMillRenderer extends renderer.HeritageRenderer {
  constructor(canvas, width, height, ratio) {
    super(canvas, width, height, ratio);
    this.view = Object.assign({}, MILL_VIEW);
    this.position = 0; this.progress = 0;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 5, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([153, 141, 120, 255, 112, 105, 89, 255, 183, 130, 58, 255, 238, 213, 151, 255, 174, 117, 60, 255]));
    this.setPosition(0, 0);
  }
  setPosition(position, progress) {
    this.position = clamp(Number(position) || 0, 0, 100);
    this.progress = clamp(Number(progress) || 0, 0, 1);
    const mesh = createMillMesh(this.position, this.progress);
    this.setMesh(mesh);
    return mesh;
  }
  camera(name) { this.view = Object.assign({}, CAMERA_VIEWS[name] || MILL_VIEW); this.render(); }
  action(name, x, y) {
    if (name === 'reset') { this.camera('overview'); return Object.assign({}, this.view); }
    if (name === 'auto') return Object.assign({}, this.view);
    return super.action(name, x, y);
  }
}
module.exports = { createMillMesh: createMillMesh, initialMotion: initialMotion, updateMotion: updateMotion, GrainMillRenderer: GrainMillRenderer, CAMERA_VIEWS: CAMERA_VIEWS };
