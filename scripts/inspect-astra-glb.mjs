#!/usr/bin/env node
/**
 * Dependency-free glTF-Binary inspector for Astra's character asset.
 *
 * Parses the GLB container directly so the exported rig can be validated
 * without a browser, a DOM or a GPU. Used by the automated test suite and by
 * `npm run verify:asset`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/**
 * Read a GLB file and return its parsed JSON chunk plus raw stats.
 * @param {string} file absolute or relative path to the .glb
 */
export function readGlb(file) {
  const buffer = readFileSync(file);
  if (buffer.length < 12) throw new Error('file is too short to be a GLB');
  if (buffer.readUInt32LE(0) !== MAGIC) throw new Error('missing glTF magic; not a GLB file');
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);
  if (declaredLength !== buffer.length) {
    throw new Error(`declared length ${declaredLength} does not match file size ${buffer.length}`);
  }

  let offset = 12;
  let json = null;
  let binaryBytes = 0;
  const chunkTypes = [];
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    chunkTypes.push(chunkType);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) json = JSON.parse(buffer.toString('utf8', start, start + chunkLength));
    if (chunkType === CHUNK_BIN) binaryBytes = chunkLength;
    offset = start + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, version, binaryBytes, byteLength: buffer.length, chunkTypes };
}

/**
 * Summarise an Astra character GLB: skeleton, skinning, clips, morphs,
 * materials, scale and geometry complexity.
 * @param {string} file path to the .glb
 */
export function inspectCharacterGlb(file) {
  const { json, version, binaryBytes, byteLength } = readGlb(file);
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const skins = json.skins ?? [];
  const animations = json.animations ?? [];

  let triangles = 0;
  let morphedPrimitives = 0;
  const materialNames = [];
  const seenMaterials = new Set();

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.indices !== undefined) {
        triangles += accessors[primitive.indices].count / 3;
      } else if (primitive.attributes?.POSITION !== undefined) {
        triangles += accessors[primitive.attributes.POSITION].count / 3;
      }
      if (primitive.targets?.length) morphedPrimitives += 1;
      if (primitive.material !== undefined && !seenMaterials.has(primitive.material)) {
        seenMaterials.add(primitive.material);
        materialNames.push(json.materials?.[primitive.material]?.name ?? `material_${primitive.material}`);
      }
    }
  }

  // Bounds across all POSITION accessors referenced by mesh primitives.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = accessors[primitive.attributes.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], accessor.min[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], accessor.max[axis]);
      }
    }
  }

  const boneNames = skins.flatMap((skin) => (skin.joints ?? []).map((joint) => nodes[joint]?.name ?? `node_${joint}`));
  const morphNames = [...new Set(meshes.flatMap((mesh) => (mesh.extras?.targetNames ?? [])))];
  const clipNames = animations.map((animation) => animation.name).filter(Boolean);
  const channelsPerClip = animations.map((animation) => ({
    name: animation.name,
    channels: animation.channels?.length ?? 0,
    samplers: animation.samplers?.length ?? 0,
  }));

  return {
    version,
    byteLength,
    binaryBytes,
    asset: json.asset ?? {},
    meshCount: meshes.length,
    triangles: Math.round(triangles),
    morphedPrimitives,
    morphNames,
    skinCount: skins.length,
    boneCount: boneNames.length,
    boneNames,
    animationCount: animations.length,
    clipNames,
    channelsPerClip,
    materialCount: (json.materials ?? []).length,
    materialNames,
    textureCount: (json.textures ?? []).length,
    imageCount: (json.images ?? []).length,
    bounds,
    size: bounds.max.map((value, axis) => value - bounds.min[axis]),
  };
}

/** Required clips shared by the V1 rollback rig and V2 preview. */
export const REQUIRED_CLIPS = [
  'idle_breathing', 'idle_weight_shift', 'idle_look_around', 'blink', 'walk',
  'turn_left', 'turn_right', 'wave', 'sit_down', 'seated_idle', 'stand_up',
  'thinking', 'listening', 'talking_gesture', 'happy_reaction', 'desk_work',
];

/** Required morph targets for facial animation and future lip-sync. */
export const REQUIRED_MORPHS = [
  'happy', 'smile', 'curious', 'thinking', 'surprised', 'listening',
  'vis_aa', 'vis_ee', 'vis_oo', 'vis_ff', 'blink',
];

/** Bones the character controller animates or reads at runtime. */
export const REQUIRED_BONES = [
  'root', 'hips', 'spine_lower', 'spine_mid', 'chest', 'neck', 'head', 'head_top',
  'upperarm.L', 'lowerarm.L', 'hand.L', 'upperarm.R', 'lowerarm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
  'eye.L', 'eye.R',
];

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const target = process.argv[2] ?? path.resolve(process.cwd(), 'src/assets/astra-character-v1.glb');
  const report = inspectCharacterGlb(target);
  console.log(JSON.stringify(report, null, 2));
  const missingClips = REQUIRED_CLIPS.filter((clip) => !report.clipNames.includes(clip));
  const missingMorphs = REQUIRED_MORPHS.filter((morph) => !report.morphNames.includes(morph));
  const missingBones = REQUIRED_BONES.filter((bone) => !report.boneNames.includes(bone));
  console.log(JSON.stringify({ missingClips, missingMorphs, missingBones }));
  if (missingClips.length || missingMorphs.length || missingBones.length) process.exitCode = 1;
}
