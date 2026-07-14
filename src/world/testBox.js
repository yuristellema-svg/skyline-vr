import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../config.js';

export function testBoxHeight() {
  return 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x4c7894) },
      uHorizon: { value: new THREE.Color(0xd7e2d9) },
      uLow: { value: new THREE.Color(0x7c9294) },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uLow;
      varying vec3 vDirection;
      void main() {
        float h = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = h < 0.5 ? mix(uLow, uHorizon, h * 2.0) : mix(uHorizon, uTop, (h - 0.5) * 2.0);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 14), material);
  sky.name = 'Camera-centred sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);
  return sky;
}

function buildGround(scene) {
  const geometry = new THREE.PlaneGeometry(CONFIG.testBox.planeSize, CONFIG.testBox.planeSize, 1, 1);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshLambertMaterial({ color: 0x626d67, flatShading: true });
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'Stage A test plane';
  scene.add(ground);

  const grid = new THREE.GridHelper(CONFIG.testBox.planeSize, 120, 0x7f9186, 0x6c7871);
  grid.position.y = 0.025;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  scene.add(grid);
}

function buildPylons(scene) {
  const count = 88;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0xc5d4ca, flatShading: true });
  const pylons = new THREE.InstancedMesh(geometry, material, count * 2);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let instance = 0;
  for (let i = 0; i < count; i += 1) {
    const z = 300 - i * 100;
    const major = i % 5 === 0;
    const height = major ? 32 : 13;
    for (const side of [-1, 1]) {
      position.set(side * (major ? 72 : 54), height * 0.5, z);
      scale.set(major ? 2.2 : 1.15, height, major ? 2.2 : 1.15);
      matrix.compose(position, quaternion, scale);
      pylons.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  pylons.instanceMatrix.needsUpdate = true;
  pylons.name = '100 metre speed pylons';
  scene.add(pylons);
}

function makeArchShape(halfSpan, bottom, top, halfOpening, openingHeight) {
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, bottom);
  shape.lineTo(halfSpan, bottom);
  shape.lineTo(halfSpan, top);
  shape.lineTo(-halfSpan, top);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-halfOpening, bottom + 0.05);
  hole.lineTo(-halfOpening, 0.05);
  hole.absellipse(0, 0.05, halfOpening, openingHeight - 0.05, Math.PI, 0, true, 0);
  hole.lineTo(halfOpening, bottom + 0.05);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function buildBridge(scene, collision) {
  const z = CONFIG.testBox.bridgeZ;
  const depth = 18;
  const halfSpan = 62;
  const bottom = 0;
  const deckTop = 26;
  const halfOpening = 19;
  const openingHeight = 22;
  const geometry = new THREE.ExtrudeGeometry(
    makeArchShape(halfSpan, bottom, deckTop, halfOpening, openingHeight),
    { depth, steps: 1, bevelEnabled: false, curveSegments: 28 }
  );
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  const bridge = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: 0x9c8f7d, flatShading: true })
  );
  bridge.position.z = z;
  bridge.name = 'Stage A stone arch';
  scene.add(bridge);
  collision.addArchBridge({
    z,
    depth,
    halfSpan,
    bottom,
    deckTop,
    halfOpening,
    openingHeight,
    label: 'Stone bridge',
  });

  const railGeometry = new THREE.BoxGeometry(1, 1, 1);
  const railMaterial = new THREE.MeshLambertMaterial({ color: 0x70685e, flatShading: true });
  const rails = new THREE.InstancedMesh(railGeometry, railMaterial, 2 + 30);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let instance = 0;
  for (const side of [-1, 1]) {
    const railZ = z + side * (depth * 0.5 - 0.8);
    position.set(0, deckTop + 0.7, railZ);
    scale.set(halfSpan * 2, 1.4, 1.2);
    matrix.compose(position, quaternion, scale);
    rails.setMatrixAt(instance++, matrix);
    collision.addBox(-halfSpan, halfSpan, deckTop, deckTop + 1.4, railZ - 0.6, railZ + 0.6, 'Bridge parapet');
    for (let x = -56; x <= 56; x += 8) {
      position.set(x, deckTop + 2.2, railZ);
      scale.set(1.1, 4.4, 1.1);
      matrix.compose(position, quaternion, scale);
      rails.setMatrixAt(instance++, matrix);
      collision.addBox(x - 0.55, x + 0.55, deckTop, deckTop + 4.4, railZ - 0.55, railZ + 0.55, 'Bridge post');
    }
  }
  rails.instanceMatrix.needsUpdate = true;
  scene.add(rails);
}

function buildNearField(scene) {
  const random = seededRandom(0x5f3759df);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const rockCount = 520;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0x4b5551, flatShading: true }),
    rockCount
  );
  for (let i = 0; i < rockCount; i += 1) {
    const x = (random() - 0.5) * 720;
    const z = 380 - random() * 5200;
    const size = 0.45 + random() * 2.3;
    position.set(x, size * 0.42, z);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    scale.set(size * (0.8 + random() * 0.5), size * (0.5 + random() * 0.4), size);
    matrix.compose(position, quaternion, scale);
    rocks.setMatrixAt(i, matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  scene.add(rocks);

  const scrubCount = 900;
  const scrub = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.7, 2.6, 5),
    new THREE.MeshLambertMaterial({ color: 0x334b3b, flatShading: true }),
    scrubCount
  );
  for (let i = 0; i < scrubCount; i += 1) {
    const x = (random() - 0.5) * 620;
    const z = 400 - random() * 5100;
    const size = 0.35 + random() * 0.85;
    position.set(x, 1.3 * size, z);
    quaternion.identity();
    scale.set(size, size, size);
    matrix.compose(position, quaternion, scale);
    scrub.setMatrixAt(i, matrix);
  }
  scrub.instanceMatrix.needsUpdate = true;
  scene.add(scrub);
}

export function buildTestBox(scene, collision) {
  scene.background = new THREE.Color(0x9bb7bd);
  scene.fog = new THREE.Fog(0x9bb7bd, CONFIG.testBox.fogNear, CONFIG.testBox.fogFar);
  scene.add(new THREE.HemisphereLight(0xe4f1f3, 0x424d45, 1.65));
  const sun = new THREE.DirectionalLight(0xffe6c0, 2.1);
  sun.position.set(-300, 500, 220);
  scene.add(sun);
  buildGround(scene);
  buildPylons(scene);
  buildBridge(scene, collision);
  buildNearField(scene);
  const sky = buildSky(scene);
  return {
    sky,
    update(camera) {
      sky.position.copy(camera.position);
    },
    reset() {
      // Stage A is deterministic. Static props never migrate or regenerate on respawn.
    },
  };
}
