import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHARACTER_MORPHS } from '../../shared/characterClips';
import type { CharacterAssetId } from '../../shared/contracts';

/** A rigged, animated character loaded from a local GLB. */
export interface CharacterAsset {
  readonly object: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  /** Meshes that carry facial morph targets, in morph-name order. */
  readonly morphMeshes: readonly { readonly mesh: THREE.Mesh; readonly indices: ReadonlyMap<string, number> }[];
  dispose(): void;
}

export type CharacterLoadResult =
  | { readonly status: 'ready'; readonly asset: CharacterAsset }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Load Astra from a locally bundled GLB.
 *
 * The renderer is sandboxed with no filesystem access, and `fetch` is blocked
 * for `file://` URLs, so the bytes are read by the main process over the
 * trusted IPC bridge and parsed in memory. Nothing is fetched from the network.
 *
 * Deliberately returns a discriminated result rather than throwing: the caller
 * must be able to fall back to the procedural mannequin without a try/catch
 * around every animation frame.
 */
export async function loadCharacterAsset(id: CharacterAssetId = 'astra-character-v1'): Promise<CharacterLoadResult> {
  let bytes: Uint8Array;
  try {
    bytes = await window.astra.readCharacterAsset(id);
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  if (bytes.byteLength === 0) return { status: 'failed', reason: 'character asset was empty' };

  return new Promise((resolve) => {
    new GLTFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      '',
      (gltf) => {
        try {
          resolve({ status: 'ready', asset: buildAsset(gltf) });
        } catch (error) {
          disposeGltf(gltf.scene);
          resolve({ status: 'failed', reason: error instanceof Error ? error.message : String(error) });
        }
      },
      (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        resolve({ status: 'failed', reason: reason || 'asset parse failed' });
      },
    );
  });
}

function buildAsset(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): CharacterAsset {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(clip.name, clip);

  const morphMeshes: { mesh: THREE.Mesh; indices: Map<string, number> }[] = [];
  gltf.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry & { morphAttributes?: Record<string, unknown[]> };
    const names = (mesh.userData?.targetNames ?? geometry.userData?.targetNames) as string[] | undefined;
    const influences = mesh.morphTargetInfluences;
    if (!influences || influences.length === 0) return;
    const indices = new Map<string, number>();
    for (const name of names ?? CHARACTER_MORPHS) {
      const index = CHARACTER_MORPHS.indexOf(name as (typeof CHARACTER_MORPHS)[number]);
      if (index >= 0 && index < influences.length) indices.set(name, index);
    }
    if (indices.size > 0) morphMeshes.push({ mesh, indices });
  });

  return {
    object: gltf.scene,
    mixer,
    clips,
    morphMeshes,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      disposeGltf(gltf.scene);
    },
  };
}

function disposeGltf(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
  root.removeFromParent();
}