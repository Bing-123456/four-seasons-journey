'use strict';

// Mini-program WebGL adaptation of the exhibition approach in Heritage Foundry
// src/components/ArtifactStage.js. No browser DOM or Three.js runtime is bundled.
const DEFAULT_VIEW = { yaw: -0.35, pitch: 0.6, zoom: 1, autoRotate: true };

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function parseMesh(buffer) {
  // wx.readFile may return an ArrayBuffer from a different JavaScript realm.
  // `instanceof ArrayBuffer` rejects those legitimate native-bridge values.
  // Copy the exact byte range into this realm before creating aligned views.
  let source;
  try {
    if (ArrayBuffer.isView(buffer)) {
      source = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      const length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
      source = new Uint8Array(buffer, 0, length);
    }
  } catch (error) { throw new Error('展品文件不完整'); }
  if (source.byteLength < 16) throw new Error('展品文件不完整');
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  buffer = copy.buffer;
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x44335947 || header.getUint32(4, true) !== 1) throw new Error('展品格式不受支持');
  const vertexCount = header.getUint32(8, true);
  const indexCount = header.getUint32(12, true);
  if (!vertexCount || vertexCount > 65535 || !indexCount || indexCount % 3 || buffer.byteLength !== 16 + vertexCount * 32 + indexCount * 2) throw new Error('展品数据长度无效');
  const vertices = new Float32Array(buffer, 16, vertexCount * 8);
  const indices = new Uint16Array(buffer, 16 + vertexCount * 32, indexCount);
  for (let i = 0; i < vertices.length; i++) if (!Number.isFinite(vertices[i])) throw new Error('展品顶点无效');
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertexCount) throw new Error('展品索引无效');
  return { vertices: vertices, indices: indices, vertexCount: vertexCount, triangleCount: indexCount / 3 };
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}

function transform(view) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), z = view.zoom;
  return new Float32Array([
    cy * z, sp * sy * z, -cp * sy * z, 0,
    0, cp * z, sp * z, 0,
    sy * z, -sp * cy * z, cp * cy * z, 0,
    0, -0.04, 0, 1
  ]);
}

function perspective(aspect) {
  const f = 1 / Math.tan(38 * Math.PI / 360), near = 0.1, far = 50;
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
}

function updateView(view, action, x, y) {
  const next = Object.assign({}, view);
  if (action === 'rotate' && Number.isFinite(x) && Number.isFinite(y)) { next.yaw += x; next.pitch = clamp(next.pitch + y, 0.15, 1.3); }
  if (action === 'zoom' && Number.isFinite(x) && x > 0) next.zoom = clamp(next.zoom * x, 0.7, 1.65);
  if (action === 'auto') next.autoRotate = Boolean(x);
  if (action === 'reset') return Object.assign({}, DEFAULT_VIEW);
  return next;
}

const VERTEX = 'attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUV; uniform mat4 uMVP; uniform mat4 uModel; varying vec3 vNormal; varying vec2 vUV; void main(){ vNormal=normalize(mat3(uModel)*aNormal); vUV=aUV; gl_Position=uMVP*vec4(aPosition,1.0); }';
const FRAGMENT = 'precision mediump float; varying vec3 vNormal; varying vec2 vUV; uniform sampler2D uTexture; void main(){ vec3 n=normalize(vNormal); float key=max(dot(n,normalize(vec3(-0.5,0.9,1.3))),0.0); float fill=max(dot(n,normalize(vec3(0.8,0.3,-0.5))),0.0); vec4 c=texture2D(uTexture,vUV); vec3 lit=c.rgb*(0.56+0.48*key+0.16*fill); gl_FragColor=vec4(lit,c.a); }';

function makeShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('当前设备无法编译3D材质'); }
  return shader;
}

class HeritageRenderer {
  constructor(canvas, width, height, pixelRatio) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('当前设备暂不支持 WebGL 展示');
    this.view = Object.assign({}, DEFAULT_VIEW);
    this.active = false;
    this.frame = null;
    this.lastTime = 0;
    this.interacting = false;
    const gl = this.gl;
    const vertex = makeShader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = makeShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('当前设备无法连接3D材质'); }
    this.program = program;
    this.uniforms = { mvp: gl.getUniformLocation(program, 'uMVP'), model: gl.getUniformLocation(program, 'uModel'), texture: gl.getUniformLocation(program, 'uTexture') };
    this.attributes = { position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'), uv: gl.getAttribLocation(program, 'aUV') };
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([186, 155, 105, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    this.resize(width, height, pixelRatio);
  }
  resize(width, height, pixelRatio) {
    const ratio = clamp(pixelRatio || 1, 1, 2);
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.projection = perspective(this.canvas.width / this.canvas.height);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.render();
  }
  setMesh(mesh) {
    const gl = this.gl;
    this.vertexBuffer = this.vertexBuffer || gl.createBuffer();
    this.indexBuffer = this.indexBuffer || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.indexCount = mesh.indices.length;
    this.render();
  }
  setTexture(image) {
    if (!this.gl) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.render();
  }
  action(name, x, y) {
    this.view = updateView(this.view, name, x, y);
    if (name === 'auto' || name === 'reset') { if (this.view.autoRotate) this.start(); else this.stop(); }
    this.render();
    return Object.assign({}, this.view);
  }
  render() {
    const gl = this.gl;
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.indexCount) return;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    const at = this.attributes;
    gl.enableVertexAttribArray(at.position); gl.vertexAttribPointer(at.position, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(at.normal); gl.vertexAttribPointer(at.normal, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(at.uv); gl.vertexAttribPointer(at.uv, 2, gl.FLOAT, false, 32, 24);
    const model = transform(this.view);
    const camera = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4.3, 1]);
    gl.uniformMatrix4fv(this.uniforms.model, false, model);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, multiply(this.projection, multiply(camera, model)));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(this.uniforms.texture, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  start() {
    if (!this.gl || this.active || !this.view.autoRotate) return;
    this.active = true; this.lastTime = 0;
    const tick = now => {
      if (!this.active || !this.gl) return;
      const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
      this.lastTime = now;
      if (this.view.autoRotate && !this.interacting) this.view.yaw += delta * 0.28;
      this.render();
      this.frame = this.canvas.requestAnimationFrame(tick);
    };
    this.frame = this.canvas.requestAnimationFrame(tick);
  }
  stop() {
    this.active = false;
    if (this.frame !== null) this.canvas.cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  destroy() {
    this.stop();
    const gl = this.gl;
    if (!gl) return;
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    gl.deleteTexture(this.texture); gl.deleteProgram(this.program);
    this.gl = null;
  }
}

module.exports = { HeritageRenderer: HeritageRenderer, parseMesh: parseMesh, updateView: updateView, multiply: multiply, perspective: perspective, transform: transform, DEFAULT_VIEW: DEFAULT_VIEW };
