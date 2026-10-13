import * as THREE from 'three';
import { worldCameraFraming } from '../../shared/worldCamera';

export interface LivingWorldScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
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

function limb(parent: THREE.Group, x: number, y: number, side: number, sleeve: THREE.Material, skin: THREE.Material): THREE.Group {
  const shoulder = new THREE.Group();
  shoulder.position.set(x, y, 0);
  parent.add(shoulder);
  box(shoulder, [0.25, 0.65, 0.29], [0, -0.32, 0], sleeve);
  sphere(shoulder, 0.13, [0, -0.69, 0], sleeve);
  const forearm = new THREE.Group();
  forearm.position.set(0, -0.69, 0);
  forearm.rotation.z = side * 0.08;
  shoulder.add(forearm);
  box(forearm, [0.21, 0.51, 0.24], [0, -0.25, 0], sleeve);
  sphere(forearm, 0.13, [0, -0.58, 0], skin);
  return shoulder;
}

export function createLivingWorldScene(): LivingWorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#21172f');
  const initialFraming = worldCameraFraming(343, 261);
  const camera = new THREE.PerspectiveCamera(initialFraming.fovDegrees, initialFraming.aspect, 0.1, 30);
  camera.position.set(...initialFraming.position);
  camera.lookAt(...initialFraming.target);

  const wall = new THREE.MeshStandardMaterial({ color: '#473258', roughness: 1 });
  const sideWall = new THREE.MeshStandardMaterial({ color: '#382b4e', roughness: 1 });
  const floor = new THREE.MeshStandardMaterial({ color: '#624b70', roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#ad82be', roughness: 1 });
  const rug = new THREE.MeshStandardMaterial({ color: '#7e5aaa', roughness: 1 });
  const hoodie = new THREE.MeshStandardMaterial({ color: '#7449ad', roughness: 1 });
  const hoodieLight = new THREE.MeshStandardMaterial({ color: '#976aca', roughness: 1 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#282741', roughness: 1 });
  const shoes = new THREE.MeshStandardMaterial({ color: '#ccaeeb', roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#edb8ad', roughness: 1 });
  const hair = new THREE.MeshStandardMaterial({ color: '#8d4bc4', roughness: 1 });
  const eye = new THREE.MeshStandardMaterial({ color: '#25172f', roughness: 1 });
  const star = new THREE.MeshStandardMaterial({ color: '#ffdc8f', roughness: 1, side: THREE.DoubleSide });

  box(scene, [6.5, 0.12, 4.8], [0, -0.08, 0], floor);
  box(scene, [6.5, 3.9, 0.12], [0, 1.86, -2.35], wall);
  box(scene, [0.12, 3.9, 4.8], [-3.19, 1.86, 0], sideWall);
  box(scene, [6.3, 0.08, 0.12], [0, 0.07, -2.26], trim);
  box(scene, [2.4, 0.015, 1.2], [0.05, 0.01, 0.15], rug);
  box(scene, [1.25, 0.7, 0.6], [2.15, 0.35, -1.75], sideWall);
  box(scene, [1.45, 0.09, 0.77], [2.15, 0.76, -1.75], trim);
  box(scene, [0.95, 1.05, 0.04], [-1.86, 2.28, -2.26], trim);
  box(scene, [0.79, 0.88, 0.04], [-1.86, 2.28, -2.22], rug);

  const figure = new THREE.Group();
  figure.position.set(0.05, 0, 0.25);
  scene.add(figure);
  const hips = new THREE.Group();
  hips.position.y = 1.19;
  figure.add(hips);
  box(hips, [0.72, 0.31, 0.38], [0, 0.03, 0], trousers);
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  for (const [leg, side] of [[leftLeg, -1], [rightLeg, 1]] as const) {
    leg.position.set(side * 0.23, -0.1, 0);
    hips.add(leg);
    box(leg, [0.26, 0.77, 0.28], [0, -0.39, 0], trousers);
    sphere(leg, 0.14, [0, -0.79, 0], trousers);
    box(leg, [0.23, 0.34, 0.25], [0, -0.94, 0], trousers);
    box(leg, [0.3, 0.17, 0.5], [0, -1.14, 0.11], shoes);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.21;
  hips.add(torso);
  box(torso, [0.97, 0.88, 0.47], [0, 0.42, 0], hoodie);
  box(torso, [0.77, 0.15, 0.49], [0, 0.83, -0.03], hoodieLight);
  const leftArm = limb(torso, -0.6, 0.78, -1, hoodie, skin);
  const rightArm = limb(torso, 0.6, 0.78, 1, hoodie, skin);
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 0.17 : 0.072;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius + 0.43;
    if (i === 0) starShape.moveTo(x, y);
    else starShape.lineTo(x, y);
  }
  starShape.closePath();
  const emblem = new THREE.Mesh(new THREE.ShapeGeometry(starShape), star);
  emblem.position.z = 0.247;
  torso.add(emblem);
  const head = new THREE.Group();
  head.position.y = 1.12;
  torso.add(head);
  sphere(head, 0.34, [0, 0.13, -0.03], skin);
  sphere(head, 0.36, [0, 0.37, -0.12], hair);
  sphere(head, 0.22, [0.1, 0.66, -0.11], hair);
  sphere(head, 0.1, [-0.15, 0.36, 0.16], hair);
  sphere(head, 0.1, [0.17, 0.37, 0.15], hair);
  sphere(head, 0.046, [-0.115, 0.19, 0.278], eye);
  sphere(head, 0.046, [0.115, 0.19, 0.278], eye);
  box(head, [0.15, 0.022, 0.025], [0.025, 0.01, 0.305], eye);

  scene.add(new THREE.AmbientLight('#faf0ff', 1.6));
  const key = new THREE.DirectionalLight('#fff0df', 2.3);
  key.position.set(3, 6, 5);
  scene.add(key);

  return {
    scene,
    camera,
    updateIdle(elapsedSeconds) {
      const sway = Math.sin(elapsedSeconds * 1.2);
      torso.rotation.z = sway * 0.025;
      head.rotation.y = Math.sin(elapsedSeconds * 0.7) * 0.07;
      leftArm.rotation.z = -0.08 + sway * 0.055;
      rightArm.rotation.z = 0.08 - sway * 0.055;
      leftLeg.rotation.x = sway * 0.018;
      rightLeg.rotation.x = -sway * 0.018;
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [wall, sideWall, floor, trim, rug, hoodie, hoodieLight, trousers, shoes, skin, hair, eye, star]) material.dispose();
    },
  };
}
