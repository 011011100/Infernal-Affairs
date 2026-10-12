#!/usr/bin/env node
/**
 * Convert TastyTony's untextured Low-Poly Desert Eagle to a static web asset.
 * Usage: node scripts/prepare-gun-model.mjs /path/to/low-poly_desert_eagle.glb
 * Optional second argument overrides the output path. The input is never edited.
 * Requires the project's installed Three.js dependency; no browser or server.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Box3,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Mesh,
  Scene,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const [inputArg, outputArg, ...extraArgs] = process.argv.slice(2);
if (!inputArg || extraArgs.length) {
  console.error(
    "Usage: node scripts/prepare-gun-model.mjs <source.glb> [output.glb]",
  );
  process.exit(1);
}
const inputPath = resolve(inputArg);
const outputPath = outputArg
  ? resolve(outputArg)
  : fileURLToPath(
      new URL("../public/models/desert-eagle.glb", import.meta.url),
    );
assert.notEqual(inputPath, outputPath, "Output must not overwrite the source");

const legacyExtension = "KHR_materials_pbrSpecularGlossiness";
const attribution = {
  title: "Low-Poly Desert Eagle",
  author: "TastyTony",
  source:
    "https://sketchfab.com/3d-models/low-poly-desert-eagle-b81da261345f4462b2c4412352162287",
  license: "https://creativecommons.org/licenses/by/4.0/",
  modifications:
    "Converted legacy specular-glossiness materials to metallic-roughness; " +
    "baked static rest-pose skinning and world transforms; removed rig and " +
    "non-mesh scene objects; centered and uniformly normalized X length to 1. " +
    "Muzzle +X, top +Y, side +Z. Original colors and triangle topology retained.",
};

function unpackGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, "Input must be a GLB");
  assert.equal(buffer.readUInt32LE(4), 2, "Only glTF 2.0 is supported");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "Invalid GLB length");
  let json;
  let binary;
  for (let offset = 12; offset < buffer.length; ) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    assert.equal(chunk.length, length, "Truncated GLB chunk");
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) binary = chunk;
    else throw new Error("Unexpected GLB chunk");
    offset += 8 + length;
  }
  assert.ok(json && binary, "GLB must contain JSON and binary data");
  return { json, binary };
}

function packGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(jsonBytes);
  const binaryBytes = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(binaryBytes);
  const result = Buffer.alloc(
    12 + 8 + jsonBytes.length + 8 + binaryBytes.length,
  );
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonBytes.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(result, 20);
  const binaryOffset = 20 + jsonBytes.length;
  result.writeUInt32LE(binaryBytes.length, binaryOffset);
  result.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binaryBytes.copy(result, binaryOffset + 8);
  return result;
}

const asArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// GLTFExporter only needs asynchronous Blob -> ArrayBuffer in binary, untextured
// mode. Node provides Blob; this small adapter avoids a DOM/polyfill dependency.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.({ target: this });
    });
  }
};

const sourceBytes = await readFile(inputPath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const { json: source, binary } = unpackGlb(sourceBytes);
assert.equal(source.buffers?.length, 1, "Expected one embedded buffer");
assert.ok(!source.buffers[0].uri, "External resources are not supported");
assert.ok(
  !source.textures?.length && !source.images?.length,
  "Expected no textures",
);
assert.ok(!source.animations?.length, "Expected a static rest-pose source");
assert.ok(
  (source.extensionsRequired ?? []).every((name) => name === legacyExtension),
  "Unexpected required glTF extension",
);

// These factors are already linear glTF colors: copy them without an extra
// sRGB conversion. The source's black, gray and red colors remain unchanged.
for (const material of source.materials ?? []) {
  const legacy = material.extensions?.[legacyExtension];
  if (!legacy) continue;
  assert.ok(!legacy.diffuseTexture && !legacy.specularGlossinessTexture);
  material.pbrMetallicRoughness = {
    baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1],
    metallicFactor: 0,
    roughnessFactor: Math.max(
      0,
      Math.min(1, 1 - (legacy.glossinessFactor ?? 1)),
    ),
  };
  delete material.extensions[legacyExtension];
  if (!Object.keys(material.extensions).length) delete material.extensions;
}
for (const field of ["extensionsUsed", "extensionsRequired"]) {
  source[field] = source[field]?.filter((name) => name !== legacyExtension);
  if (!source[field]?.length) delete source[field];
}

const loader = new GLTFLoader();
const loaded = await loader.parseAsync(
  asArrayBuffer(packGlb(source, binary)),
  "",
);
loaded.scene.updateMatrixWorld(true);
loaded.scene.traverse((object) => {
  if (object.isSkinnedMesh) object.skeleton.update();
});

// Apply the inverse-transpose of the complete blended skin/world matrix to each
// original normal. Applying just matrixWorld would leave skinned normals wrong.
function vertexWorldMatrix(mesh, index) {
  if (!mesh.isSkinnedMesh) return mesh.matrixWorld.clone();
  const blended = new Matrix4();
  blended.elements.fill(0);
  const boneMatrix = new Matrix4();
  const joints = mesh.geometry.getAttribute("skinIndex");
  const weights = mesh.geometry.getAttribute("skinWeight");
  let sum = 0;
  for (let component = 0; component < 4; component += 1) {
    const weight = weights.getComponent(index, component);
    if (!weight) continue;
    const joint = joints.getComponent(index, component);
    assert.ok(mesh.skeleton.bones[joint], "Invalid skin joint");
    boneMatrix.multiplyMatrices(
      mesh.skeleton.bones[joint].matrixWorld,
      mesh.skeleton.boneInverses[joint],
    );
    for (let element = 0; element < 16; element += 1)
      blended.elements[element] += boneMatrix.elements[element] * weight;
    sum += weight;
  }
  assert.ok(Math.abs(sum - 1) < 1e-5, "Skin weights must sum to one");
  return mesh.matrixWorld
    .clone()
    .multiply(mesh.bindMatrixInverse)
    .multiply(blended)
    .multiply(mesh.bindMatrix);
}

const bakedScene = new Scene();
bakedScene.name = "Desert Eagle — muzzle +X, top +Y, side +Z";
const bounds = new Box3();
const point = new Vector3();
const normal = new Vector3();
const normalMatrix = new Matrix3();
let sourceTriangles = 0;
let sourceMeshes = 0;
loaded.scene.traverse((mesh) => {
  if (!mesh.isMesh) return;
  assert.ok(
    !Object.keys(mesh.geometry.morphAttributes).length,
    "Unexpected morph target",
  );
  const geometry = mesh.geometry.clone();
  const positions = mesh.geometry.getAttribute("position");
  const normals = mesh.geometry.getAttribute("normal");
  assert.ok(normals, "Source normals are required to preserve hard edges");
  const bakedPositions = new Float32BufferAttribute(positions.count * 3, 3);
  const bakedNormals = new Float32BufferAttribute(positions.count * 3, 3);
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(index, point);
    point.applyMatrix4(mesh.matrixWorld);
    const world = vertexWorldMatrix(mesh, index);
    // This asset has no reflected or singular skin transforms. Reject those
    // instead of exporting incorrect winding if a different source is supplied.
    assert.ok(
      world.determinant() > 1e-12,
      "Unsupported reflected/singular skin transform",
    );
    normalMatrix.getNormalMatrix(world);
    normal.fromBufferAttribute(normals, index).applyNormalMatrix(normalMatrix);
    assert.ok(
      [...point, ...normal].every(Number.isFinite),
      "Non-finite vertex data",
    );
    bakedPositions.setXYZ(index, point.x, point.y, point.z);
    bakedNormals.setXYZ(index, normal.x, normal.y, normal.z);
    bounds.expandByPoint(point);
  }
  geometry.setAttribute("position", bakedPositions);
  geometry.setAttribute("normal", bakedNormals);
  for (const name of Object.keys(geometry.attributes)) {
    // The source uses no textures or vertex colors; UVs, tangents and joint
    // attributes add bytes without changing this static model's appearance.
    assert.ok(
      ["position", "normal", "uv", "skinIndex", "skinWeight"].includes(name),
    );
    if (name !== "position" && name !== "normal")
      geometry.deleteAttribute(name);
  }
  if (geometry.index && positions.count <= 65535)
    geometry.setIndex(Array.from(geometry.index.array));
  const indexCount = geometry.index?.count ?? positions.count;
  assert.equal(indexCount % 3, 0, "Mesh must contain complete triangles");
  sourceTriangles += indexCount / 3;
  sourceMeshes += 1;
  // clone() preserves material groups; each source material remains associated
  // with the same faces. Do not recompute normals or merge away hard edges.
  const baked = new Mesh(geometry, mesh.material);
  baked.name = mesh.name;
  bakedScene.add(baked);
});
assert.ok(sourceMeshes > 0, "No meshes found");

// The baked rest pose of this specific source already has muzzle +X, top +Y and
// the broad side toward +Z. Keep that right-handed orientation, center its AABB,
// and normalize only by overall X length (uniform scale, no distortion).
const originalSize = bounds.getSize(new Vector3());
assert.ok(originalSize.x > originalSize.y && originalSize.y > originalSize.z);
const center = bounds.getCenter(new Vector3());
const scale = 1 / originalSize.x;
for (const mesh of bakedScene.children) {
  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.geometry.scale(scale, scale, scale);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

const exported = await new GLTFExporter().parseAsync(bakedScene, {
  binary: true,
  onlyVisible: false,
  copyright:
    "Low-Poly Desert Eagle by TastyTony, CC BY 4.0; modified for this project",
});
const exportedGlb = unpackGlb(Buffer.from(exported));
exportedGlb.json.asset.extras = { ...attribution, sourceSha256 };
const output = packGlb(exportedGlb.json, exportedGlb.binary);

// Validate the actual serialized artifact, not just the pre-export objects.
const checked = await loader.parseAsync(asArrayBuffer(output), "");
checked.scene.updateMatrixWorld(true);
let triangles = 0;
let meshes = 0;
let vertices = 0;
let maxNormalLengthError = 0;
checked.scene.traverse((mesh) => {
  assert.ok(
    !mesh.isBone && !mesh.isSkinnedMesh && !mesh.isCamera && !mesh.isLight,
  );
  if (!mesh.isMesh) return;
  meshes += 1;
  const positions = mesh.geometry.getAttribute("position");
  vertices += positions.count;
  triangles += (mesh.geometry.index?.count ?? positions.count) / 3;
  const normals = mesh.geometry.getAttribute("normal");
  for (let index = 0; index < normals.count; index += 1) {
    const error = Math.abs(
      normal.fromBufferAttribute(normals, index).length() - 1,
    );
    assert.ok(error < 1e-5, "Invalid exported normal");
    maxNormalLengthError = Math.max(maxNormalLengthError, error);
  }
});
assert.equal(triangles, sourceTriangles, "Export changed the triangle count");
assert.equal(meshes, sourceMeshes, "Export changed the material mesh count");
assert.equal(checked.animations.length, 0);
assert.ok(
  !exportedGlb.json.skins?.length && !exportedGlb.json.textures?.length,
);
assert.ok(!exportedGlb.json.extensionsUsed?.includes(legacyExtension));
assert.equal(exportedGlb.json.materials.length, source.materials.length);
for (const expected of source.materials) {
  const actual = exportedGlb.json.materials.find(
    (item) => item.name === expected.name,
  );
  assert.ok(actual, "Material missing after export");
  const expectedPbr = expected.pbrMetallicRoughness;
  const actualPbr = actual.pbrMetallicRoughness;
  for (let channel = 0; channel < 4; channel += 1)
    assert.ok(
      Math.abs(
        actualPbr.baseColorFactor[channel] -
          expectedPbr.baseColorFactor[channel],
      ) < 1e-7,
    );
  assert.equal(actualPbr.metallicFactor, 0);
  assert.ok(
    Math.abs((actualPbr.roughnessFactor ?? 1) - expectedPbr.roughnessFactor) <
      1e-7,
  );
}
const finalBounds = new Box3().setFromObject(checked.scene);
const finalSize = finalBounds.getSize(new Vector3());
assert.ok(Math.abs(finalSize.x - 1) < 1e-6, "Model length must be one");
assert.ok(
  finalBounds.getCenter(new Vector3()).length() < 1e-6,
  "Model must be centered",
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);
assert.equal(
  createHash("sha256")
    .update(await readFile(inputPath))
    .digest("hex"),
  sourceSha256,
  "Source file changed",
);
console.log(
  JSON.stringify(
    {
      input: inputPath,
      output: outputPath,
      inputBytes: sourceBytes.length,
      outputBytes: output.length,
      sourceSha256,
      triangles,
      vertices,
      meshes,
      materials: exportedGlb.json.materials.length,
      size: finalSize.toArray(),
      bounds: {
        min: finalBounds.min.toArray(),
        max: finalBounds.max.toArray(),
      },
      orientation: { muzzle: "+X", top: "+Y", side: "+Z" },
      maxNormalLengthError,
    },
    null,
    2,
  ),
);
