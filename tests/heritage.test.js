'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = require('../miniprogram/components/heritage-viewer/renderer');
const heritage = require('../miniprogram/data/heritage');
const mill = require('../miniprogram/components/heritage-viewer/grain-mill');
const root = path.resolve(__dirname, '../miniprogram');

// Binary parser fixtures come from our Henan teaching geometry, never an
// unrelated tea asset. They exercise the native buffer contract independently.
const fixtureMesh = mill.createMillMesh(0, 0);
function meshBuffer() {
  const buffer = new ArrayBuffer(16 + fixtureMesh.vertices.byteLength + fixtureMesh.indices.byteLength);
  const header = new DataView(buffer);
  header.setUint32(0, 0x44335947, true); header.setUint32(4, 1, true);
  header.setUint32(8, fixtureMesh.vertexCount, true); header.setUint32(12, fixtureMesh.indices.length, true);
  new Float32Array(buffer, 16, fixtureMesh.vertices.length).set(fixtureMesh.vertices);
  new Uint16Array(buffer, 16 + fixtureMesh.vertices.byteLength, fixtureMesh.indices.length).set(fixtureMesh.indices);
  return buffer;
}

test('the documented Henan scene round-trips indexed volumetric geometry without external exhibit assets', () => {
  const mesh = renderer.parseMesh(meshBuffer());
  assert.equal(mesh.vertexCount, fixtureMesh.vertexCount);
  assert.equal(mesh.triangleCount, fixtureMesh.triangleCount);
  assert.deepEqual(mesh.vertices, fixtureMesh.vertices);
  assert.deepEqual(mesh.indices, fixtureMesh.indices);
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) for (let axis = 0; axis < 3; axis++) {
    const value = mesh.vertices[vertex * 8 + axis];
    minimum[axis] = Math.min(minimum[axis], value); maximum[axis] = Math.max(maximum[axis], value);
  }
  assert.ok(maximum.every((value, axis) => value - minimum[axis] > 0.4));
  assert.equal(heritage.artifacts.length, 1);
  assert.match(heritage.artifacts[0].notice, /非馆藏扫描/);
  assert.ok(heritage.artifacts.every(item => !item.meshPath && !item.texturePath));
});

test('corrupted meshes and out-of-range triangle indices fail safely', () => {
  assert.throws(() => renderer.parseMesh(new ArrayBuffer(8)));
  const wrongMagic = meshBuffer();
  new DataView(wrongMagic).setUint32(0, 0, true);
  assert.throws(() => renderer.parseMesh(wrongMagic));
  const wrongIndex = meshBuffer();
  const view = new DataView(wrongIndex);
  const vertexCount = view.getUint32(8, true);
  view.setUint16(16 + vertexCount * 32, 65535, true);
  assert.throws(() => renderer.parseMesh(wrongIndex), /索引/);
  assert.throws(() => renderer.parseMesh(meshBuffer().slice(0, -2)), /长度/);
});

test('native bridge buffers from another realm and offset typed views decode correctly', () => {
  const source = meshBuffer();
  const foreign = vm.runInNewContext('new Uint8Array(bytes).buffer', { bytes: Array.from(new Uint8Array(source)) });
  assert.equal(foreign instanceof ArrayBuffer, false, 'reproduce native bridge realm mismatch');
  assert.equal(renderer.parseMesh(foreign).triangleCount, fixtureMesh.triangleCount);
  const wrapped = new Uint8Array(source.byteLength + 7);
  wrapped.set(new Uint8Array(source), 3);
  assert.equal(renderer.parseMesh(wrapped.subarray(3, 3 + source.byteLength)).vertexCount, fixtureMesh.vertexCount);
  assert.equal(renderer.parseMesh(Buffer.from(source)).triangleCount, fixtureMesh.triangleCount);
  assert.throws(() => renderer.parseMesh({ byteLength: source.byteLength }), /不完整/);
});

test('rotation changes 3D transform and zoom stays within usable bounds', () => {
  const initial = Object.assign({}, renderer.DEFAULT_VIEW);
  const rotated = renderer.updateView(initial, 'rotate', 0.4, 0.2);
  assert.notDeepEqual(Array.from(renderer.transform(initial)), Array.from(renderer.transform(rotated)));
  assert.equal(initial.yaw, -0.35);
  assert.equal(renderer.updateView(rotated, 'zoom', 100).zoom, 1.65);
  assert.equal(renderer.updateView(rotated, 'zoom', 0.0001).zoom, 0.7);
  assert.equal(renderer.updateView(rotated, 'rotate', 0, 100).pitch, 1.3);
  assert.equal(renderer.updateView(rotated, 'rotate', 0, -100).pitch, 0.15);
  assert.deepEqual(renderer.updateView(rotated, 'reset'), renderer.DEFAULT_VIEW);
});

function mockCanvas(expectedCount = fixtureMesh.indices.length) {
  const calls = { draw: 0, buffersDeleted: 0, programsDeleted: 0, texturesDeleted: 0, cancelled: 0 };
  const gl = {};
  const constants = ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'TEXTURE_2D', 'RGBA', 'UNSIGNED_BYTE', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'DEPTH_TEST', 'CULL_FACE', 'ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER', 'STATIC_DRAW', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'FLOAT', 'TEXTURE0', 'TRIANGLES', 'UNSIGNED_SHORT', 'UNPACK_FLIP_Y_WEBGL'];
  constants.forEach((name, index) => { gl[name] = index + 1; });
  ['shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram', 'bindTexture', 'texImage2D', 'texParameteri', 'enable', 'disable', 'clearColor', 'viewport', 'clear', 'bindBuffer', 'bufferData', 'useProgram', 'enableVertexAttribArray', 'vertexAttribPointer', 'uniformMatrix4fv', 'activeTexture', 'uniform1i', 'pixelStorei'].forEach(name => { gl[name] = () => {}; });
  ['createShader', 'createProgram', 'createTexture', 'createBuffer', 'getUniformLocation', 'getAttribLocation'].forEach(name => { gl[name] = () => ({}); });
  gl.getShaderParameter = () => true;
  gl.getProgramParameter = () => true;
  gl.drawElements = (type, count) => { assert.equal(type, gl.TRIANGLES); if (expectedCount) assert.equal(count, expectedCount); else assert.ok(count > 0 && count % 3 === 0); calls.draw++; };
  gl.deleteBuffer = () => { calls.buffersDeleted++; };
  gl.deleteProgram = () => { calls.programsDeleted++; };
  gl.deleteTexture = () => { calls.texturesDeleted++; };
  let sequence = 0;
  const pending = new Map();
  const canvas = {
    getContext: () => gl,
    requestAnimationFrame: callback => { pending.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => { pending.delete(id); calls.cancelled++; }
  };
  return { canvas, calls, pending };
}

test('renderer issues indexed WebGL draws and pauses/releases resources on leave', () => {
  const { canvas, calls, pending } = mockCanvas();
  const stage = new renderer.HeritageRenderer(canvas, 343, 325, 3);
  assert.equal(canvas.width, 686, 'pixel ratio capped to control GPU memory');
  stage.setMesh(renderer.parseMesh(meshBuffer()));
  assert.equal(calls.draw, 1);
  stage.start();
  assert.equal(pending.size, 1);
  stage.action('auto', false);
  assert.equal(pending.size, 0);
  stage.action('reset');
  assert.equal(pending.size, 1);
  stage.destroy();
  assert.equal(pending.size, 0);
  assert.equal(calls.buffersDeleted, 2);
  assert.equal(calls.programsDeleted, 1);
  assert.equal(calls.texturesDeleted, 1);
  stage.destroy();
  assert.equal(calls.buffersDeleted, 2, 'dispose is idempotent');
});

test('grain lesson is the only exhibit and preserves its real Henan attribution', () => {
  const artifact = heritage.artifacts[0];
  assert.equal(artifact.id, 'grain-mill');
  assert.match(artifact.description, /新郑裴李岗/);
  assert.match(artifact.notice, /非馆藏扫描/);
  assert.match(artifact.sourceUrl, /^https:\/\/www\.chnmus\.net\//);
  assert.deepEqual(heritage.artifacts.map(item => item.id), ['grain-mill']);
  assert.equal(artifact.choices.filter(item => item.correct).length, 1);
  assert.match(artifact.choices.find(item => item.correct).text, /来回滚碾/);
});

test('procedural mill has valid volumetric geometry, with rod translation and rolling coupled', () => {
  const front = mill.createMillMesh(0, 0), back = mill.createMillMesh(100, 0);
  assert.equal(front.vertexCount, back.vertexCount);
  assert.ok(front.vertexCount < 6000, 'keep the teaching scene lightweight');
  assert.ok(front.triangleCount > 1000);
  assert.equal(front.rodOffset, -0.7);
  assert.equal(back.rodOffset, 0.7);
  assert.equal(front.rodRoll, -back.rodRoll);
  let changed = 0;
  const bounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  for (let vertex = 0; vertex < front.vertexCount; vertex++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = front.vertices[vertex * 8 + axis];
      assert.ok(Number.isFinite(value));
      bounds[axis][0] = Math.min(bounds[axis][0], value);
      bounds[axis][1] = Math.max(bounds[axis][1], value);
      if (value !== back.vertices[vertex * 8 + axis]) changed++;
    }
    const normalLength = Math.hypot(...front.vertices.slice(vertex * 8 + 3, vertex * 8 + 6));
    assert.ok(normalLength > 0.98 && normalLength < 1.02);
  }
  assert.ok(bounds.every(([min, max]) => max - min > 0.4), 'volumetric, including four feet and raised rod');
  assert.ok(changed > 400, 'operating the rod changes the actual mesh');
  assert.ok(changed < front.vertices.length / 2, 'the stone slab is not spinning as a whole');
  for (const index of front.indices) assert.ok(index < front.vertexCount);
  assert.ok(mill.createMillMesh(50, 1).vertexCount > front.vertexCount, 'separated husks are a visible learning cue');
  assert.equal(mill.createMillMesh(-100, -1).rodOffset, -0.7);
  assert.equal(mill.createMillMesh(1000, 2).rodOffset, 0.7);
});

test('motion progress requires reaching alternate ends, ignores jitter and caps at two returns', () => {
  let state = mill.initialMotion();
  [4, 9, 5, 30, 60, 84].forEach(value => { state = mill.updateMotion(state, value); });
  assert.equal(state.strokes, 0);
  state = mill.updateMotion(state, 100);
  assert.equal(state.strokes, 1);
  state = mill.updateMotion(state, 94);
  assert.equal(state.strokes, 1);
  state = mill.updateMotion(state, 40);
  assert.equal(state.strokes, 1);
  state = mill.updateMotion(state, 0);
  assert.equal(state.strokes, 2);
  for (let i = 0; i < 10; i++) state = mill.updateMotion(state, i % 2 ? 0 : 100);
  assert.equal(state.strokes, 4);
});

test('mill redraws on interaction without an idle animation loop or leaking mesh buffers', () => {
  const { canvas, calls, pending } = mockCanvas(0);
  const scene = new mill.GrainMillRenderer(canvas, 343, 230, 3);
  const vertexBuffer = scene.vertexBuffer, indexBuffer = scene.indexBuffer;
  assert.equal(scene.view.autoRotate, false);
  scene.start();
  assert.equal(pending.size, 0, 'stationary scene consumes no animation frames');
  scene.setPosition(100, 0.25);
  scene.setPosition(0, 0.5);
  assert.equal(scene.vertexBuffer, vertexBuffer);
  assert.equal(scene.indexBuffer, indexBuffer);
  const original = Array.from(renderer.transform(scene.view));
  scene.camera('top');
  assert.notDeepEqual(Array.from(renderer.transform(scene.view)), original);
  scene.camera('side');
  assert.equal(scene.view.pitch, 0.2);
  scene.action('reset');
  assert.deepEqual(scene.view, mill.CAMERA_VIEWS.overview);
  assert.equal(pending.size, 0);
  scene.destroy();
  assert.equal(calls.buffersDeleted, 2);
  assert.equal(calls.texturesDeleted, 1);
  assert.equal(calls.programsDeleted, 1);
});

function lessonPage(storageFails) {
  const filename = path.join(root, 'packageMore/heritage/index.js');
  const localRequire = require('node:module').createRequire(filename);
  const calls = { logs: [], positions: [], cameras: [], navigation: [], sources: [] };
  const viewer = {
    setPosition: (position, progress) => calls.positions.push([position, progress]),
    setCamera: name => calls.cameras.push(name), reset: () => calls.cameras.push('reset'),
    zoom: () => {}, rotate: () => {}, setAutoRotate: () => {}
  };
  let definition;
  const context = {
    require: name => name === '../../lib/store' ? { logEvent: (type, details) => { if (storageFails) throw new Error('storage full'); calls.logs.push({ type, details }); } } : localRequire(name),
    Page: value => { definition = value; },
    wx: { setNavigationBarTitle: () => {}, navigateTo: options => calls.navigation.push(options.url), setClipboardData: options => calls.sources.push(options.data) },
    setInterval, clearInterval, Date
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData: function (patch) { Object.assign(this.data, patch); },
    selectComponent: () => viewer
  });
  return { page, calls };
}
const lessonEvent = value => ({ currentTarget: { dataset: value } });

test('lesson requires observation before answers, preserves completion and records one event', () => {
  const { page, calls } = lessonPage(false);
  page.onLoad({});
  assert.equal(page.data.started, false);
  assert.equal(page.data.isMill, true);
  page.answerQuestion(lessonEvent({ answer: 'rolling' }));
  assert.equal(page.data.completed, false);
  page.startLesson();
  page.answerQuestion(lessonEvent({ answer: 'rolling' }));
  assert.equal(page.data.completed, false, 'starting alone does not unlock the question');
  page.moveGrind({ detail: { value: 100 } });
  page.moveGrind({ detail: { value: 0 } });
  assert.equal(page.data.strokes, 2);
  page.answerQuestion(lessonEvent({ answer: 'unknown' }));
  assert.equal(page.data.answer, '');
  page.answerQuestion(lessonEvent({ answer: 'spinning' }));
  assert.equal(page.data.answerCorrect, false);
  page.answerQuestion(lessonEvent({ answer: 'rolling' }));
  assert.equal(page.data.completed, true);
  page.answerQuestion(lessonEvent({ answer: 'rolling' }));
  page.answerQuestion(lessonEvent({ answer: 'spinning' }));
  assert.equal(page.data.answer, 'rolling');
  const events = calls.logs.filter(item => item.type === 'heritage_lesson_complete');
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].details)), { mode: '3d', count: 2, ok: true });
  page.resetView();
  assert.equal(page.data.completed, false);
  assert.equal(page.data.answer, '');
  assert.equal(page.data.answerCorrect, false);
  assert.equal(page.data.strokes, 0);
  assert.equal(page.data.progressPercent, 0);
});

test('text fallback is a complete learning path even when device storage fails', () => {
  const { page, calls } = lessonPage(true);
  assert.doesNotThrow(() => page.onLoad({}));
  page.startLesson();
  page.onViewerError({ detail: { message: 'WebGL unavailable' } });
  assert.equal(page.data.textMode, true);
  assert.equal(page.data.ready, false);
  page.nextTextStep();
  page.answerQuestion(lessonEvent({ answer: 'rolling' }));
  assert.equal(page.data.completed, false);
  page.nextTextStep();
  assert.doesNotThrow(() => page.answerQuestion(lessonEvent({ answer: 'rolling' })));
  assert.equal(page.data.completed, true);
  page.copySource();
  assert.equal(calls.sources[0], heritage.artifacts[0].sourceUrl);
  page.exploreExperience();
  assert.equal(calls.navigation[0], '/packageMore/workshop/index?id=guadoujiang');
});

test('camera selection rejects unknown names and retired exhibit URLs return to the documented mill', () => {
  const { page, calls } = lessonPage(false);
  page.onLoad({});
  page.setCamera(lessonEvent({ view: 'unexpected' }));
  assert.equal(page.data.cameraView, 'overview');
  assert.equal(calls.cameras.length, 0);
  page.setCamera(lessonEvent({ view: 'top' }));
  assert.equal(page.data.cameraView, 'top');
  assert.equal(calls.cameras[0], 'top');
  const tea = lessonPage(false).page;
  tea.onLoad({ id: 'tea-set' });
  assert.equal(tea.data.isMill, true);
  assert.equal(tea.data.started, false);
  assert.equal(tea.data.autoRotate, false);
  assert.equal(tea.data.artifact.id, 'grain-mill');
  assert.equal(tea.data.artifact.meshPath, undefined);
});
