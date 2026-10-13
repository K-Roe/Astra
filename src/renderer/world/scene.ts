import * as THREE from 'three';
import { worldCameraFraming } from '../../shared/worldCamera';

export interface LivingWorldScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Where a character (real or fallback) is parented. */
  readonly characterAnchor: THREE.Group;
  /** Install the procedural stand-in when the real asset is unavailable. */
  useFallback(): THREE.Group;
  updateIdle(elapsedSeconds: number): void;
  dispose(): void;
}

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function sphere(parent: THREE.Object3D, radius: number, position: [number, number, number], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

/**
 * The temporary procedural stand-in used only when the character asset cannot
 * be loaded. Deliberately small and clearly a placeholder.
 */
function createFallbackMannequin(): THREE.Group {
  const hoodie = new THREE.MeshStandardMaterial({ color: '#7449ad', roughness: 1 });
  const hoodieLight = new THREE.MeshStandardMaterial({ color: '#976aca', roughness: 1 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#282741', roughness: 1 });
  const shoes = new THREE.MeshStandardMaterial({ color: '#ccaeeb', roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#edb8ad', roughness: 1 });
  const hair = new THREE.MeshStandardMaterial({ color: '#8d4bc4', roughness: 1 });

  const figure = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.84;
  figure.add(hips);
  box(hips, [0.34, 0.28, 0.22], [0, 0.02, 0], trousers);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.1, -0.12, 0);
    hips.add(leg);
    box(leg, [0.15, 0.52, 0.16], [0, -0.26, 0], trousers);
    box(leg, [0.14, 0.16, 0.25], [0, -0.6, 0.04], shoes);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.16;
  hips.add(torso);
  box(torso, [0.44, 0.6, 0.26], [0, 0.3, 0], hoodie);
  box(torso, [0.34, 0.1, 0.27], [0, 0.58, -0.01], hoodieLight);
  for (const side of [-1, 1]) {
    box(torso, [0.12, 0.44, 0.14], [side * 0.26, 0.24, 0], hoodie);
    sphere(torso, 0.07, [side * 0.26, 0.0, 0], skin);
  }
  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  sphere(head, 0.19, [0, 0.08, -0.02], skin);
  sphere(head, 0.2, [0, 0.2, -0.07], hair);
  sphere(head, 0.12, [0.06, 0.37, -0.06], hair);
  figure.userData.fallbackMaterials = [hoodie, hoodieLight, trousers, shoes, skin, hair];
  return figure;
}

export function createLivingWorldScene(): LivingWorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#21172f');
  const initialFraming = worldCameraFraming(343, 261);
  const camera = new THREE.PerspectiveCamera(initialFraming.fovDegrees, initialFraming.aspect, 0.05, 30);
  camera.position.set(...initialFraming.position);
  camera.lookAt(...initialFraming.target);

  const wall = new THREE.MeshStandardMaterial({ color: '#473258', roughness: 1 });
  const sideWall = new THREE.MeshStandardMaterial({ color: '#382b4e', roughness: 1 });
  const floor = new THREE.MeshStandardMaterial({ color: '#624b70', roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#ad82be', roughness: 1 });
  const rug = new THREE.MeshStandardMaterial({ color: '#7e5aaa', roughness: 1 });
  const furniture = new THREE.MeshStandardMaterial({ color: '#3a2b52', roughness: 1 });
  const cushion = new THREE.MeshStandardMaterial({ color: '#8f6fd4', roughness: 1 });

  // Room shell, sized for a 1.75 m character.
  box(scene, [6.5, 0.12, 4.8], [0, -0.08, 0], floor);
  box(scene, [6.5, 3.2, 0.12], [0, 1.52, -2.35], wall);
  box(scene, [0.12, 3.2, 4.8], [-3.19, 1.52, 0], sideWall);
  box(scene, [6.3, 0.08, 0.12], [0, 0.07, -2.26], trim);
  box(scene, [2.6, 0.02, 1.8], [0.1, 0.01, 0.5], rug);

  // Desk against the back wall: obstacle footprint x 0.5..1.9, z -2.05..-1.6.
  box(scene, [1.4, 0.06, 0.45], [1.2, 0.74, -1.83], trim);
  for (const dx of [-0.62, 0.62]) {
    box(scene, [0.06, 0.74, 0.06], [1.2 + dx, 0.37, -1.96], furniture);
    box(scene, [0.06, 0.74, 0.06], [1.2 + dx, 0.37, -1.7], furniture);
  }
  box(scene, [1.1, 0.3, 0.04], [1.2, 0.5, -2.02], furniture);
  // Chair she sits on at desk_seat (1.2, -1.25).
  box(scene, [0.46, 0.05, 0.44], [1.2, 0.45, -1.25], cushion);
  box(scene, [0.46, 0.5, 0.05], [1.2, 0.7, -1.46], cushion);
  for (const dx of [-0.19, 0.19]) {
    for (const dz of [-0.18, 0.18]) {
      box(scene, [0.04, 0.45, 0.04], [1.2 + dx, 0.22, -1.25 + dz], furniture);
    }
  }

  // Sofa along the right wall: obstacle x 1.95..2.55, z -0.55..0.95.
  box(scene, [0.6, 0.34, 1.5], [2.25, 0.22, 0.2], furniture);
  box(scene, [0.14, 0.6, 1.5], [2.5, 0.6, 0.2], cushion);
  for (const dz of [-0.72, 0.72]) {
    box(scene, [0.6, 0.42, 0.1], [2.25, 0.45, 0.2 + dz], cushion);
  }

  // Shelf along the left wall: obstacle x -2.55..-1.75, z -1.9..-1.15.
  box(scene, [0.8, 0.06, 0.75], [-2.15, 1.1, -1.52], trim);
  box(scene, [0.8, 0.06, 0.75], [-2.15, 0.5, -1.52], trim);
  for (const dz of [-0.33, 0.33]) {
    box(scene, [0.05, 1.2, 0.05], [-2.52, 0.6, -1.52 + dz], furniture);
  }
  box(scene, [0.24, 0.3, 0.03], [-2.15, 1.9, -2.26], trim);
  box(scene, [0.18, 0.24, 0.01], [-2.15, 1.9, -2.24], rug);

  // Stays at the origin: CharacterController sets the character in absolute
  // room coordinates, so an offset anchor would double-count her position.
  const characterAnchor = new THREE.Group();
  scene.add(characterAnchor);

  scene.add(new THREE.AmbientLight('#faf0ff', 1.7));
  const key = new THREE.DirectionalLight('#fff0df', 2.2);
  key.position.set(3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#c9a8ff', 1.1);
  rim.position.set(-3, 3, -4);
  scene.add(rim);

  let fallback: THREE.Group | null = null;

  return {
    scene,
    camera,
    characterAnchor,
/** Install the procedural stand-in when the real asset is unavailable. */
    useFallback() {
      if (!fallback) {
        fallback = createFallbackMannequin();
        characterAnchor.add(fallback);
      }
      return fallback;
    },
    updateIdle(elapsedSeconds: number) {
      if (!fallback) return;
      // A gentle breath so the placeholder is not completely static.
      const sway = Math.sin(elapsedSeconds * 1.2);
      fallback.position.y = sway * 0.01;
      fallback.rotation.z = sway * 0.012;
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [wall, sideWall, floor, trim, rug, furniture, cushion]) material.dispose();
      const placeholderMaterials = (fallback?.userData.fallbackMaterials as THREE.Material[] | undefined) ?? [];
      for (const material of placeholderMaterials) material.dispose();
    },
  };
}