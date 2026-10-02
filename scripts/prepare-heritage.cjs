'use strict';

// Build-time only. Install dependencies outside the mini-program:
// npm install --prefix /tmp/guayouji-3d-tools @gltf-transform/core@4.4.1 @gltf-transform/extensions@4.4.1 draco3dgltf@1.5.7 sharp
// node scripts/prepare-heritage.cjs /tmp/guayouji-3d-tools/teapot.glb
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED_HASH = '53f3f6d6c2fdf72bf216a7f1c8a47c7506b44973a44c506602913c1459c4336d';
const SOURCE = 'https://github.com/tbszz/Heritage-Foundry/blob/master/public/models/teapot.glb';

async function prepare(input, destination) {
  const dependencyRoot = process.env.HERITAGE_TOOLS_DIR || '/tmp/guayouji-3d-tools';
  const load = name => require(require.resolve(name, { paths: [dependencyRoot] }));
  const { NodeIO } = load('@gltf-transform/core');
  const { ALL_EXTENSIONS } = load('@gltf-transform/extensions');
  const draco = load('draco3dgltf');
  const sharp = load('sharp');
  const sourceBytes = fs.readFileSync(input);
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  if (sourceHash !== EXPECTED_HASH) throw new Error('Source GLB hash does not match the reviewed Heritage Foundry teapot asset');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule() });
  const document = await io.read(input);
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  if (primitives.length !== 1) throw new Error('This converter expects the reviewed single-primitive asset');
  const primitive = primitives[0];
  const positions = primitive.getAttribute('POSITION').getArray();
  const normals = primitive.getAttribute('NORMAL').getArray();
  const uv = primitive.getAttribute('TEXCOORD_0').getArray();
  const indices = primitive.getIndices().getArray();
  const vertices = positions.length / 3;
  if (vertices > 65535 || indices.length % 3) throw new Error('Mesh exceeds portable WebGL1 limits');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]); }
  const center = min.map((v, i) => (v + max[i]) / 2);
  const scale = 2.35 / Math.max(...min.map((v, i) => max[i] - v));
  const interleaved = new Float32Array(vertices * 8);
  for (let i = 0; i < vertices; i++) {
    for (let axis = 0; axis < 3; axis++) {
      interleaved[i * 8 + axis] = (positions[i * 3 + axis] - center[axis]) * scale;
      interleaved[i * 8 + 3 + axis] = normals[i * 3 + axis];
    }
    interleaved[i * 8 + 6] = uv[i * 2];
    interleaved[i * 8 + 7] = uv[i * 2 + 1];
  }
  const output = Buffer.alloc(16 + interleaved.byteLength + indices.length * 2);
  output.write('GY3D', 0, 'ascii');
  output.writeUInt32LE(1, 4);
  output.writeUInt32LE(vertices, 8);
  output.writeUInt32LE(indices.length, 12);
  Buffer.from(interleaved.buffer).copy(output, 16);
  for (let i = 0; i < indices.length; i++) output.writeUInt16LE(indices[i], 16 + interleaved.byteLength + i * 2);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'tea-set.bin'), output);
  const texture = primitive.getMaterial().getBaseColorTexture().getImage();
  await sharp(Buffer.from(texture)).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(destination, 'tea-set.jpg'));
  const metadata = {
    format: 'GY3D-v1', source: SOURCE, sourceSha256: sourceHash,
    originalBytes: sourceBytes.length, meshBytes: output.length,
    vertexCount: vertices, triangleCount: indices.length / 3,
    texture: 'tea-set.jpg', normalizationTarget: 2.35,
    assetUse: 'Non-commercial competition demonstration; see Heritage-Foundry-LICENSE.txt and SOURCES.md',
    changes: ['Draco decoded offline', 'Centered and uniformly scaled', 'Texture converted from WebP to JPEG', 'Geometry and UV topology preserved']
  };
  fs.writeFileSync(path.join(destination, 'tea-set.metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ vertexCount: vertices, triangleCount: metadata.triangleCount, meshBytes: output.length }));
  return metadata;
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) throw new Error('Pass the local path of the reviewed teapot.glb asset');
  prepare(input, path.resolve(__dirname, '../miniprogram/assets/heritage')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepare, EXPECTED_HASH };
