import * as THREE from 'three';
import { homeCameraFraming } from '../../shared/homeCamera';

export interface LivingWorldScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Where a character (real or fallback) is parented. */
  readonly characterAnchor: THREE.Group;
  /** Install the procedural stand-in when the real asset is unavailable. */
  useFallback(): THREE.Group;
  setMonitorActivity(activity: 'idle' | 'learning' | 'coding'): void;
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
  scene.background = new THREE.Color('#241f2c');
  const initialFraming = homeCameraFraming(343, 261, 'companion');
  const camera = new THREE.PerspectiveCamera(initialFraming.fovDegrees, initialFraming.aspect, 0.05, 45);
  camera.position.set(...initialFraming.position);
  camera.lookAt(...initialFraming.target);

  const material = (color: string, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
  const wall = material('#574953');
  const sideWall = material('#514459');
  const wood = material('#9b704c');
  const lightWood = material('#bc9068');
  const darkWood = material('#544338');
  const trim = material('#d0af91');
  const rug = material('#765e83');
  const fabric = material('#726280');
  const cushion = material('#ae93bf');
  const bedCover = material('#a88da8');
  const pillow = material('#e4d5cc');
  const metal = material('#252632', 0.55);
  const leaves = material('#47694c');
  const pot = material('#a97864');
  const warmLight = new THREE.MeshStandardMaterial({ color: '#ffdab0', emissive: '#ffb772', emissiveIntensity: 0.65 });
  const monitor = new THREE.MeshStandardMaterial({ color: '#302b3d', emissive: '#463256', emissiveIntensity: 0.22, roughness: 0.45 });
  const materials = [wall, sideWall, wood, lightWood, darkWood, trim, rug, fabric, cushion, bedCover, pillow, metal, leaves, pot, warmLight, monitor];

  // One open-plan floor and back/left walls; furniture and rugs give four
  // distinct but connected zones without opaque room dividers.
  box(scene, [9.8, 0.12, 7.0], [0, -0.08, 0], wood);
  box(scene, [9.8, 3.3, 0.12], [0, 1.55, -3.4], wall);
  box(scene, [0.12, 3.3, 7.0], [-4.88, 1.55, 0], sideWall);
  box(scene, [9.7, 0.1, 0.13], [0, 0.07, -3.32], trim);
  box(scene, [3.6, 0.025, 2.5], [-0.7, 0.005, -0.65], rug);
  box(scene, [1.8, 0.025, 1.65], [-3.45, 0.006, 1.1], pillow);

  // Living room: sofa back exactly matches the navigation obstacle. The seat
  // waypoint lies at its front cushion edge, clear of the blocked footprint.
  box(scene, [1.8, 0.48, 0.5], [-0.9, 0.37, -2.42], fabric);
  box(scene, [1.8, 0.10, 0.78], [-0.9, 0.39, -1.94], cushion);
  for (const dx of [-0.84, 0.84]) box(scene, [0.14, 0.56, 0.85], [-0.9 + dx, 0.35, -2.1], fabric);
  box(scene, [0.95, 0.06, 0.48], [-0.85, 0.39, -0.25], lightWood);
  for (const dx of [-0.4, 0.4]) for (const dz of [-0.18, 0.18]) box(scene, [0.05, 0.37, 0.05], [-0.85 + dx, 0.19, -0.25 + dz], darkWood);
  box(scene, [0.07, 1.25, 0.07], [0.55, 0.63, -2.5], metal);
  sphere(scene, 0.18, [0.55, 1.33, -2.5], warmLight);

  // Work area, including a real screen surface and visible keyboard. The
  // screen glow changes only when the typed application state says work runs.
  box(scene, [1.7, 0.07, 0.57], [2.35, 0.76, -2.83], lightWood);
  for (const dx of [-0.74, 0.74]) box(scene, [0.07, 0.76, 0.07], [2.35 + dx, 0.38, -2.84], darkWood);
  box(scene, [0.9, 0.56, 0.06], [2.35, 1.13, -3.14], metal);
  box(scene, [0.78, 0.44, 0.008], [2.35, 1.13, -3.1], monitor);
  box(scene, [0.07, 0.19, 0.06], [2.35, 0.86, -3.1], metal);
  box(scene, [0.62, 0.025, 0.15], [2.35, 0.8, -2.67], metal);
  box(scene, [0.48, 0.06, 0.45], [2.25, 0.41, -2.25], fabric);
  // The back faces the walking area; the seated rig faces the monitor.
  // The left side stays open for the approach route.
  box(scene, [0.48, 0.5, 0.07], [2.25, 0.69, -1.99], fabric);
  for (const dx of [-0.19, 0.19]) for (const dz of [-0.18, 0.18]) box(scene, [0.04, 0.45, 0.04], [2.25 + dx, 0.22, -2.25 + dz], metal);
  box(scene, [0.65, 0.04, 0.26], [3.28, 1.4, -3.31], darkWood);
  sphere(scene, 0.13, [3.4, 1.58, -3.23], warmLight);

  // Kitchen cabinets, counter, hob, small appliance and breakfast table.
  box(scene, [0.55, 0.89, 2.2], [4.32, 0.45, 0.35], darkWood);
  box(scene, [0.66, 0.07, 2.28], [4.31, 0.92, 0.35], lightWood);
  for (const z of [-0.45, 0.28, 1.03]) {
    box(scene, [0.035, 0.36, 0.55], [4.02, 0.5, z], wood);
    box(scene, [0.03, 0.04, 0.16], [3.99, 0.54, z], metal);
  }
  box(scene, [0.28, 0.06, 0.33], [4.24, 0.98, -0.35], metal);
  box(scene, [0.28, 0.06, 0.33], [4.24, 0.98, 0.08], metal);
  box(scene, [0.28, 0.27, 0.3], [4.23, 1.08, 1.03], trim);
  box(scene, [1.05, 0.07, 0.75], [2.58, 0.75, 1.93], lightWood);
  for (const dx of [-0.42, 0.42]) for (const dz of [-0.28, 0.28]) box(scene, [0.05, 0.72, 0.05], [2.58 + dx, 0.36, 1.93 + dz], darkWood);

  // Sleeping area. The bed and bedside cabinet occupy the left zone without
  // cutting the route from the lounge to the desk or kitchen.
  box(scene, [1.65, 0.38, 1.05], [-3.53, 0.28, -2.53], darkWood);
  box(scene, [1.52, 0.16, 0.91], [-3.53, 0.53, -2.52], bedCover);
  box(scene, [1.52, 0.2, 0.16], [-3.53, 0.68, -3.0], pillow);
  box(scene, [0.4, 0.5, 0.38], [-4.25, 0.25, -1.48], lightWood);
  sphere(scene, 0.13, [-4.25, 0.65, -1.48], warmLight);
  // Bookcase against the left wall, with books and a pot plant.
  for (const y of [0.35, 0.85, 1.35]) box(scene, [0.5, 0.05, 1.2], [-4.26, y, 1.05], darkWood);
  for (const z of [0.66, 0.85, 1.05, 1.25]) box(scene, [0.24, 0.3, 0.12], [-4.25, 0.53, z], z > 1 ? fabric : trim);
  const plant = (x: number, z: number) => {
    box(scene, [0.27, 0.28, 0.27], [x, 0.16, z], pot);
    for (const dx of [-0.12, 0, 0.12]) sphere(scene, 0.16, [x + dx, 0.43 + Math.abs(dx), z], leaves);
  };
  plant(-3.95, 2.45);
  plant(3.55, 2.55);

  // Stays at the origin: CharacterController sets the character in absolute
  // room coordinates, so an offset anchor would double-count her position.
  const characterAnchor = new THREE.Group();
  scene.add(characterAnchor);

  scene.add(new THREE.AmbientLight('#fff2dc', 1.45));
  const key = new THREE.DirectionalLight('#ffe6bf', 1.65);
  key.position.set(1, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#bca1ef', 0.7);
  rim.position.set(-4, 4, -3);
  scene.add(rim);

  let fallback: THREE.Group | null = null;

  return {
    scene,
    camera,
    characterAnchor,
    setMonitorActivity(activity) {
      monitor.emissive.set(activity === 'learning' ? '#528ac0' : activity === 'coding' ? '#8563ce' : '#463256');
      monitor.emissiveIntensity = activity === 'idle' ? 0.22 : 0.9;
    },
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
      for (const entry of materials) entry.dispose();
      const placeholderMaterials = (fallback?.userData.fallbackMaterials as THREE.Material[] | undefined) ?? [];
      for (const material of placeholderMaterials) material.dispose();
    },
  };
}
