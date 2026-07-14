import * as THREE from './vendor/three.module.min.js';

// Skyline VR — Fable locked Iteration 1
// Units are metres, seconds, radians, and metres per second.

const DEG = Math.PI / 180;
const SETTINGS = Object.freeze({
  version: 'fable-1.0.0',
  routeStartZ: 100,
  routeEndZ: -3900,
  terrainStartZ: 300,
  terrainEndZ: -4100,
  halfWidth: 300,
  riverHalfWidth: 15,
  spawnAltitude: 250,
  bridge1Z: -1400,
  bridge2Z: -2700,
  updraftZ: -3650,
  updraftRadius: 58,
  fogNear: 800,
  fogFar: 1500,
  playerHalfX: 2.2,
  playerHalfY: 0.9,
  playerHalfZ: 1.4,
  minSpeed: 60 / 3.6,
  cruiseSpeed: 100 / 3.6,
  spawnSpeed: 110 / 3.6,
  comfortSpeed: 160 / 3.6,
  maxSpeed: 220 / 3.6,
  trimPitch: -3 * DEG,
  maxPitch: 40 * DEG,
  maxBank: 60 * DEG,
  pitchRate: 45 * DEG,
  bankRate: 60 * DEG,
  pitchDeadzone: 5 * DEG,
  rollDeadzone: 4 * DEG,
  fullHeadPitch: 40 * DEG,
  fullHeadRoll: 40 * DEG,
  eyeSeparation: 0.064,
  physicsStep: 1 / 120,
});

const canvas = document.querySelector('#game');
const startPanel = document.querySelector('#start-panel');
const phoneStart = document.querySelector('#phone-start');
const desktopStart = document.querySelector('#desktop-start');
const startStatus = document.querySelector('#start-status');
const orientationWarning = document.querySelector('#orientation-warning');
const eyeMessage = document.querySelector('#eye-message');
const eyeLeft = eyeMessage.querySelector('.eye-left');
const eyeRight = eyeMessage.querySelector('.eye-right');
const vignette = document.querySelector('#vignette');
const fade = document.querySelector('#fade');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch (error) {
  startStatus.textContent = 'This browser could not start 3D graphics. Try Safari on the iPhone or a current desktop browser.';
  startStatus.classList.add('error');
  throw error;
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = false;
renderer.setPixelRatio(1);
renderer.setClearColor(0x9cc5d3, 1);
renderer.sortObjects = true;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9cc5d3, SETTINGS.fogNear, SETTINGS.fogFar);

const camera = new THREE.PerspectiveCamera(74, 1, 0.08, 1700);
camera.focus = 12;
const stereoCamera = new THREE.StereoCamera();
stereoCamera.aspect = 0.5;
stereoCamera.eyeSep = SETTINGS.eyeSeparation;
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x5b5b49, 1.75));
const sunlight = new THREE.DirectionalLight(0xffe8c5, 2.25);
sunlight.position.set(-260, 420, 180);
scene.add(sunlight);

const state = {
  phase: 'menu', // menu | calibrating | flying | crashing | respawning | looping | loopReturn
  phone: false,
  stereo: false,
  phaseStarted: 0,
  loopResetDone: false,
  updraftActive: false,
  updraftElapsed: 0,
  toast: '',
  toastUntil: 0,
  wakeLock: null,
};

const flight = {
  position: new THREE.Vector3(),
  speed: SETTINGS.spawnSpeed,
  pitch: SETTINGS.trimPitch,
  bank: 0,
  heading: 0,
  quaternion: new THREE.Quaternion(),
};

const input = {
  mouseX: 0,
  mouseY: 0,
  mouseOriginX: null,
  mouseOriginY: null,
  keyPitch: 0,
  keyRoll: 0,
};

const sensor = {
  listening: false,
  valid: false,
  calibrated: false,
  latestPitchDown: 0,
  latestRollRight: 0,
  baselinePitchDown: 0,
  baselineRollRight: 0,
  lastSampleTime: 0,
  samples: [],
  waiter: null,
};

const temp = {
  qYaw: new THREE.Quaternion(),
  qPitch: new THREE.Quaternion(),
  qRoll: new THREE.Quaternion(),
  forward: new THREE.Vector3(),
  up: new THREE.Vector3(),
  right: new THREE.Vector3(),
  playerBox: new THREE.Box3(),
  playerMin: new THREE.Vector3(),
  playerMax: new THREE.Vector3(),
  look: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const bridgeColliders = [];
const bridgeSpecs = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapPi(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function signedDeadzone(value, deadzone, fullScale) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * clamp((magnitude - deadzone) / (fullScale - deadzone), 0, 1);
}

function seededRandom(seed = 481516) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centreFloorHeight(z) {
  const progress = (SETTINGS.routeStartZ - z) / 4000;
  return 5 - progress * 18 + Math.sin(z * 0.0051) * 3.4 + Math.sin(z * 0.0137 + 1.3) * 1.8;
}

function valleyWidth(z) {
  return 82 + Math.sin(z * 0.0027) * 12 + Math.sin(z * 0.0091 + 2.1) * 6;
}

function terrainHeight(x, z) {
  const floor = centreFloorHeight(z);
  const flatHalfWidth = valleyWidth(z);
  const wallT = clamp((Math.abs(x) - flatHalfWidth) / (SETTINGS.halfWidth - flatHalfWidth), 0, 1);
  const wall = 300 * Math.pow(wallT, 1.62);
  const ridge = wallT * (
    Math.sin(x * 0.032 + z * 0.0067) * 13 +
    Math.sin(x * 0.071 - z * 0.011) * 6 +
    Math.sin(x * 0.015 + z * 0.021) * 4
  );
  return floor + wall + ridge;
}

function riverHeight(z) {
  return centreFloorHeight(z) + 0.72;
}

function buildTerrain() {
  const xSegments = 88;
  const zSegments = 248;
  const length = SETTINGS.terrainStartZ - SETTINGS.terrainEndZ;
  const centreZ = (SETTINGS.terrainStartZ + SETTINGS.terrainEndZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(SETTINGS.halfWidth * 2, length, xSegments, zSegments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centreZ);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const meadow = new THREE.Color(0x73845d);
  const moss = new THREE.Color(0x526b4f);
  const rock = new THREE.Color(0x756f66);
  const highRock = new THREE.Color(0x9a9184);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = terrainHeight(x, z);
    position.setY(i, y);

    const width = valleyWidth(z);
    const wallT = clamp((Math.abs(x) - width) / (SETTINGS.halfWidth - width), 0, 1);
    color.copy(meadow).lerp(moss, smoothstep(0, 0.35, wallT));
    color.lerp(rock, smoothstep(0.25, 0.72, wallT));
    color.lerp(highRock, smoothstep(0.76, 1, wallT));
    const variation = (Math.sin(x * 0.15 + z * 0.043) + Math.sin(z * 0.097)) * 0.012;
    color.offsetHSL(0, 0, variation);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'Four-kilometre valley';
  scene.add(terrain);
}

function buildRiver() {
  const segments = 240;
  const startZ = SETTINGS.terrainStartZ;
  const endZ = SETTINGS.terrainEndZ;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const z = THREE.MathUtils.lerp(startZ, endZ, t);
    const y = riverHeight(z);
    for (let side = 0; side < 2; side += 1) {
      const vertex = i * 2 + side;
      positions[vertex * 3] = side === 0 ? -SETTINGS.riverHalfWidth : SETTINGS.riverHalfWidth;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      uvs[vertex * 2] = side;
      uvs[vertex * 2 + 1] = t * 48;
    }
    if (i < segments) {
      const a = i * 2;
      // Counter-clockwise from above so the river remains visible with FrontSide culling.
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(0x9cc5d3) },
      uFogNear: { value: SETTINGS.fogNear },
      uFogFar: { value: SETTINGS.fogFar },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float a = sin(vUv.y * 2.8 - uTime * 2.4 + vUv.x * 7.0);
        float b = sin(vUv.y * 7.3 - uTime * 4.1 - vUv.x * 11.0);
        float glint = smoothstep(0.72, 1.0, a * 0.55 + b * 0.45);
        vec3 deep = vec3(0.035, 0.13, 0.17);
        vec3 pale = vec3(0.20, 0.48, 0.55);
        vec3 water = mix(deep, pale, glint * 0.52 + 0.08);
        float fogAmount = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(water, uFogColor, fogAmount), 1.0);
      }
    `,
  });

  const river = new THREE.Mesh(geometry, material);
  river.name = 'Thirty-metre river';
  scene.add(river);
  return river;
}

function addCollider(minX, maxX, minY, maxY, minZ, maxZ) {
  bridgeColliders.push(new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ)
  ));
}

function makeArchShape(outerHalfWidth, bottom, top, openingWidth, openingHeight) {
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalfWidth, bottom);
  shape.lineTo(outerHalfWidth, bottom);
  shape.lineTo(outerHalfWidth, top);
  shape.lineTo(-outerHalfWidth, top);
  shape.closePath();

  const hole = new THREE.Path();
  const halfOpening = openingWidth * 0.5;
  // Keep the hole microscopically inside the silhouette; triangulators cannot subtract a hole that touches the outer edge.
  hole.moveTo(-halfOpening, bottom + 0.05);
  hole.lineTo(-halfOpening, 0);
  hole.absellipse(0, 0, halfOpening, openingHeight, Math.PI, 0, true, 0);
  hole.lineTo(halfOpening, bottom + 0.05);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

const railMatrices = [];
function buildBridge({ z, openingWidth, openingHeight, deckTop, span, depth }) {
  const water = riverHeight(z);
  const bottom = -5;
  const shape = makeArchShape(span * 0.5, bottom, deckTop, openingWidth, openingHeight);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 28,
  });
  geometry.translate(0, water, -depth * 0.5);
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ color: 0x92897b, flatShading: true });
  const bridge = new THREE.Mesh(geometry, material);
  bridge.position.z = z;
  bridge.name = `Stone bridge at ${Math.round(SETTINGS.routeStartZ - z)} metres`;
  scene.add(bridge);

  const halfSpan = span * 0.5;
  const halfOpening = openingWidth * 0.5;
  const minZ = z - depth * 0.5;
  const maxZ = z + depth * 0.5;
  bridgeSpecs.push({ water, bottom, deckTop, halfSpan, halfOpening, openingHeight, minZ, maxZ });

  // Low stone parapets and regularly spaced posts give speed/scale cues without shadows.
  for (const side of [-1, 1]) {
    const railZ = z + side * (depth * 0.5 - 0.7);
    const base = new THREE.Matrix4();
    base.compose(
      new THREE.Vector3(0, water + deckTop + 0.7, railZ),
      new THREE.Quaternion(),
      new THREE.Vector3(span, 1.4, 1.2)
    );
    railMatrices.push(base);
    addCollider(-halfSpan, halfSpan, water + deckTop, water + deckTop + 1.4, railZ - 0.6, railZ + 0.6);
    for (let x = -halfSpan + 4; x <= halfSpan - 4; x += 8) {
      const post = new THREE.Matrix4();
      post.compose(
        new THREE.Vector3(x, water + deckTop + 2.1, z + side * (depth * 0.5 - 0.7)),
        new THREE.Quaternion(),
        new THREE.Vector3(1.15, 4.2, 1.15)
      );
      railMatrices.push(post);
      addCollider(x - 0.575, x + 0.575, water + deckTop, water + deckTop + 4.2, railZ - 0.575, railZ + 0.575);
    }
  }
}

function finishBridgeDetails() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0x746c61, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, railMatrices.length);
  railMatrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

function buildStartLedge() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  geometry.scale(48, 9, 30);
  const material = new THREE.MeshLambertMaterial({ color: 0x6f6b63, flatShading: true });
  const ledge = new THREE.Mesh(geometry, material);
  ledge.position.set(0, terrainHeight(0, SETTINGS.routeStartZ) + 236, SETTINGS.routeStartZ + 22);
  ledge.name = 'Starting ledge';
  scene.add(ledge);
}

function buildScenery() {
  const random = seededRandom();
  const treeCount = 150;
  const rockCount = 120;
  const trunkGeometry = new THREE.CylinderGeometry(0.55, 0.8, 6, 5);
  const crownGeometry = new THREE.ConeGeometry(3.4, 11, 6);
  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshLambertMaterial({ color: 0x4b3c30 }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshLambertMaterial({ color: 0x334f3b, flatShading: true }), treeCount);
  const rocks = new THREE.InstancedMesh(rockGeometry, new THREE.MeshLambertMaterial({ color: 0x696863, flatShading: true }), rockCount);

  for (let i = 0; i < treeCount; i += 1) {
    const z = SETTINGS.routeStartZ - 100 - random() * 3800;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (105 + random() * 145);
    const ground = terrainHeight(x, z);
    const scale = 0.75 + random() * 1.2;
    temp.position.set(x, ground + 3 * scale, z);
    temp.quaternion.identity();
    temp.scale.set(scale, scale, scale);
    temp.matrix.compose(temp.position, temp.quaternion, temp.scale);
    trunks.setMatrixAt(i, temp.matrix);
    temp.position.y = ground + 10 * scale;
    temp.matrix.compose(temp.position, temp.quaternion, temp.scale);
    crowns.setMatrixAt(i, temp.matrix);
  }

  for (let i = 0; i < rockCount; i += 1) {
    const z = SETTINGS.routeStartZ - 50 - random() * 3900;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (90 + random() * 195);
    const scale = 1.8 + random() * 6.5;
    temp.position.set(x, terrainHeight(x, z) + scale * 0.32, z);
    temp.quaternion.setFromEuler(new THREE.Euler(random() * 1.2, random() * Math.PI, random() * 1.2));
    temp.scale.set(scale * (0.75 + random() * 0.5), scale * (0.55 + random() * 0.5), scale * (0.75 + random() * 0.5));
    temp.matrix.compose(temp.position, temp.quaternion, temp.scale);
    rocks.setMatrixAt(i, temp.matrix);
  }

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  rocks.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns, rocks);
}

function buildSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x5f94ae) },
      uHorizon: { value: new THREE.Color(0xdde8df) },
      uLow: { value: new THREE.Color(0x8ba3a2) },
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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 24, 14), material);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function buildWingtips() {
  const positions = new Float32Array([
    -0.58, -0.32, -1.65,  -1.82, -0.61, -2.72,  -0.90, -0.08, -2.38,
     0.58, -0.32, -1.65,   0.90, -0.08, -2.38,   1.82, -0.61, -2.72,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ color: 0xd98552, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;
  camera.add(mesh);
  return mesh;
}

function buildUpdraft() {
  const baseY = riverHeight(SETTINGS.updraftZ);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(SETTINGS.updraftRadius, SETTINGS.updraftRadius * 0.72, 285, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xd9f6d2, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
  );
  column.position.set(0, baseY + 142, SETTINGS.updraftZ);
  column.name = 'Updraft loop';
  scene.add(column);

  const random = seededRandom(90210);
  const count = 160;
  const positions = new Float32Array(count * 3);
  const bases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * SETTINGS.updraftRadius * 0.88;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = random() * 280;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    bases[i] = positions[i * 3 + 1];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xf2ffd8, size: 1.5, transparent: true, opacity: 0.68, depthWrite: false, sizeAttenuation: true })
  );
  points.position.set(0, baseY, SETTINGS.updraftZ);
  scene.add(points);
  return { column, points, bases };
}

buildTerrain();
const river = buildRiver();
buildBridge({ z: SETTINGS.bridge1Z, openingWidth: 25, openingHeight: 14, deckTop: 18, span: 94, depth: 14 });
buildBridge({ z: SETTINGS.bridge2Z, openingWidth: 18, openingHeight: 10, deckTop: 12, span: 78, depth: 12 });
finishBridgeDetails();
buildStartLedge();
buildScenery();
const sky = buildSky();
const wingtips = buildWingtips();
const updraft = buildUpdraft();

function setEyeMessage(text = '') {
  eyeLeft.textContent = text;
  eyeRight.textContent = text;
  eyeMessage.classList.toggle('hidden', !text);
}

function showToast(text, duration = 0.65) {
  state.toast = text;
  state.toastUntil = performance.now() / 1000 + duration;
}

function setStartStatus(text, error = false) {
  startStatus.textContent = text;
  startStatus.classList.toggle('error', error);
}

function setStereo(enabled) {
  state.stereo = enabled;
  document.body.classList.toggle('stereo', enabled);
  resize();
}

function setFlightQuaternion() {
  temp.qYaw.setFromAxisAngle(UP, flight.heading);
  temp.qPitch.setFromAxisAngle(RIGHT, flight.pitch);
  temp.qRoll.setFromAxisAngle(FORWARD, flight.bank);
  flight.quaternion.copy(temp.qYaw).multiply(temp.qPitch).multiply(temp.qRoll).normalize();
}

function resetFlight() {
  const ground = terrainHeight(0, SETTINGS.routeStartZ);
  flight.position.set(0, ground + SETTINGS.spawnAltitude, SETTINGS.routeStartZ);
  flight.speed = SETTINGS.spawnSpeed;
  flight.pitch = SETTINGS.trimPitch;
  flight.bank = 0;
  flight.heading = 0;
  state.updraftActive = false;
  state.updraftElapsed = 0;
  setFlightQuaternion();
  camera.position.copy(flight.position);
  camera.quaternion.copy(flight.quaternion);
}

function screenTilt(betaDegrees, gammaDegrees) {
  const beta = betaDegrees * DEG;
  const gamma = gammaDegrees * DEG;
  const cosBeta = Math.cos(beta);

  // World-up in the device's natural coordinates. Alpha mathematically cancels and is never read.
  const gravityX = -cosBeta * Math.sin(gamma);
  const gravityY = Math.sin(beta);
  const gravityZ = cosBeta * Math.cos(gamma);

  const screenDegrees = screen.orientation?.angle ?? window.orientation ?? 0;
  const angle = ((screenDegrees % 360) + 360) % 360 * DEG;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const screenX = cosine * gravityX - sine * gravityY;
  const screenY = sine * gravityX + cosine * gravityY;

  return {
    pitchDown: Math.atan2(gravityZ, Math.hypot(screenX, screenY)),
    rollRight: Math.atan2(-screenX, screenY),
  };
}

function onDeviceOrientation(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  const tilt = screenTilt(event.beta, event.gamma);
  if (!Number.isFinite(tilt.pitchDown) || !Number.isFinite(tilt.rollRight)) return;

  const now = performance.now() / 1000;
  sensor.latestPitchDown = tilt.pitchDown;
  sensor.latestRollRight = tilt.rollRight;
  sensor.lastSampleTime = now;
  sensor.valid = true;
  sensor.samples.push({ pitch: tilt.pitchDown, roll: tilt.rollRight, time: now });
  while (sensor.samples.length > 32 || (sensor.samples[0] && now - sensor.samples[0].time > 0.5)) sensor.samples.shift();
  if (sensor.waiter) {
    sensor.waiter();
    sensor.waiter = null;
  }
}

function listenForOrientation() {
  if (sensor.listening) return;
  window.addEventListener('deviceorientation', onDeviceOrientation, true);
  sensor.listening = true;
}

function waitForFreshSensorSample(timeout = 1800) {
  sensor.valid = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (sensor.waiter) sensor.waiter = null;
      reject(new Error('No head-tracking signal arrived. Check Safari motion access and try again.'));
    }, timeout);
    sensor.waiter = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function circularAverage(values) {
  if (!values.length) return 0;
  let x = 0;
  let y = 0;
  for (const value of values) {
    x += Math.cos(value);
    y += Math.sin(value);
  }
  return Math.atan2(y, x);
}

function recenter(showConfirmation = true) {
  const now = performance.now() / 1000;
  const recent = sensor.samples.filter(sample => now - sample.time <= 0.25);
  sensor.baselinePitchDown = circularAverage(recent.map(sample => sample.pitch));
  sensor.baselineRollRight = circularAverage(recent.map(sample => sample.roll));
  if (!recent.length) {
    sensor.baselinePitchDown = sensor.latestPitchDown;
    sensor.baselineRollRight = sensor.latestRollRight;
  }
  sensor.calibrated = sensor.valid;
  if (showConfirmation && sensor.calibrated) showToast('CENTERED');
}

function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}

function waitForLandscape() {
  if (isLandscape()) return Promise.resolve();
  orientationWarning.classList.remove('hidden');
  return new Promise(resolve => {
    const check = () => {
      if (!isLandscape()) return;
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      orientationWarning.classList.add('hidden');
      resolve();
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
  });
}

async function acquireWakeLock() {
  if (!state.phone || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch (_) {
    state.wakeLock = null;
  }
}

function beginSession({ phone, mouseOrigin = null }) {
  state.phone = phone;
  // Treat the desktop Start click as neutral, then measure deliberate movement away from it.
  if (!phone) {
    input.mouseX = 0;
    input.mouseY = 0;
    input.mouseOriginX = mouseOrigin?.x ?? window.innerWidth * 0.5;
    input.mouseOriginY = mouseOrigin?.y ?? window.innerHeight * 0.5;
    input.keyPitch = 0;
    input.keyRoll = 0;
  }
  state.phase = phone ? 'calibrating' : 'flying';
  state.phaseStarted = performance.now() / 1000;
  document.body.classList.add('running');
  document.body.classList.toggle('phone', phone);
  startPanel.classList.add('hidden');
  wingtips.visible = true;
  setStereo(phone);
  resetFlight();
  if (phone) void acquireWakeLock();
}

async function beginPhone(permissionPromise) {
  phoneStart.disabled = true;
  desktopStart.disabled = true;
  setStartStatus('Waiting for motion permission…');
  try {
    if (!window.isSecureContext) throw new Error('Phone VR needs the secure GitHub Pages link (https://).');
    const permission = await permissionPromise;
    if (permission !== 'granted') throw new Error('Motion access was not granted. Tap Start and choose Allow.');

    listenForOrientation();
    setStartStatus('Rotate the phone to landscape.');
    await waitForLandscape();
    setStartStatus('Reading head movement…');
    await waitForFreshSensorSample();
    sensor.samples.length = 0;
    beginSession({ phone: true });
  } catch (error) {
    setStartStatus(error.message || 'Head tracking could not start.', true);
    phoneStart.disabled = false;
    desktopStart.disabled = false;
    orientationWarning.classList.add('hidden');
  }
}

phoneStart.addEventListener('click', () => {
  // iOS only permits this request when it is invoked directly by the user's tap.
  const OrientationEvent = globalThis.DeviceOrientationEvent;
  let permissionPromise;
  try {
    permissionPromise = OrientationEvent && typeof OrientationEvent.requestPermission === 'function'
      ? OrientationEvent.requestPermission()
      : Promise.resolve(OrientationEvent ? 'granted' : 'unavailable');
  } catch (error) {
    permissionPromise = Promise.reject(error);
  }
  void beginPhone(permissionPromise);
});

desktopStart.addEventListener('click', event => beginSession({
  phone: false,
  mouseOrigin: { x: event.clientX, y: event.clientY },
}));

function controlTargets() {
  let pitchInput;
  let rollInput;
  if (state.phone) {
    const pitchDelta = wrapPi(sensor.latestPitchDown - sensor.baselinePitchDown);
    const rollDelta = wrapPi(sensor.latestRollRight - sensor.baselineRollRight);
    pitchInput = -signedDeadzone(pitchDelta, SETTINGS.pitchDeadzone, SETTINGS.fullHeadPitch);
    rollInput = signedDeadzone(rollDelta, SETTINGS.rollDeadzone, SETTINGS.fullHeadRoll);
  } else {
    pitchInput = clamp(-input.mouseY + input.keyPitch, -1, 1);
    rollInput = clamp(input.mouseX + input.keyRoll, -1, 1);
  }

  let pitchTarget = pitchInput >= 0
    ? THREE.MathUtils.lerp(SETTINGS.trimPitch, SETTINGS.maxPitch, pitchInput)
    : THREE.MathUtils.lerp(SETTINGS.trimPitch, -SETTINGS.maxPitch, -pitchInput);
  if (pitchTarget > SETTINGS.trimPitch) {
    const climbAuthority = smoothstep(SETTINGS.minSpeed, SETTINGS.cruiseSpeed * 0.93, flight.speed);
    pitchTarget = SETTINGS.trimPitch + (pitchTarget - SETTINGS.trimPitch) * climbAuthority;
  }
  return {
    pitch: pitchTarget,
    bank: rollInput * SETTINGS.maxBank,
  };
}

function beginCrash() {
  if (state.phase !== 'flying') return;
  state.phase = 'crashing';
  state.phaseStarted = performance.now() / 1000;
  state.updraftActive = false;
  state.toast = '';
}

function beginLoop() {
  if (state.phase !== 'flying') return;
  state.phase = 'looping';
  state.phaseStarted = performance.now() / 1000;
  state.loopResetDone = false;
  state.updraftActive = false;
}

function updatePlayerBox() {
  temp.playerMin.set(
    flight.position.x - SETTINGS.playerHalfX,
    flight.position.y - SETTINGS.playerHalfY,
    flight.position.z - SETTINGS.playerHalfZ
  );
  temp.playerMax.set(
    flight.position.x + SETTINGS.playerHalfX,
    flight.position.y + SETTINGS.playerHalfY,
    flight.position.z + SETTINGS.playerHalfZ
  );
  temp.playerBox.min.copy(temp.playerMin);
  temp.playerBox.max.copy(temp.playerMax);
}

function detectCollision() {
  const ground = terrainHeight(flight.position.x, flight.position.z);
  if (flight.position.y - SETTINGS.playerHalfY <= ground) return true;

  if (
    Math.abs(flight.position.x) <= SETTINGS.riverHalfWidth &&
    flight.position.y - SETTINGS.playerHalfY <= riverHeight(flight.position.z)
  ) return true;

  if (Math.abs(flight.position.x) >= SETTINGS.halfWidth - 2) return true;
  if (flight.position.z <= SETTINGS.routeEndZ - 30 || flight.position.z >= SETTINGS.routeStartZ + 260) return true;

  updatePlayerBox();
  for (const bridge of bridgeSpecs) {
    const box = temp.playerBox;
    if (
      box.max.z < bridge.minZ || box.min.z > bridge.maxZ ||
      box.max.x < -bridge.halfSpan || box.min.x > bridge.halfSpan ||
      box.max.y < bridge.water + bridge.bottom || box.min.y > bridge.water + bridge.deckTop
    ) continue;

    // The player is safe only while its whole collision box fits inside the rendered arch opening.
    const widestX = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const insideWidth = box.min.x > -bridge.halfOpening && box.max.x < bridge.halfOpening;
    const archRoof = insideWidth
      ? bridge.openingHeight * Math.sqrt(Math.max(0, 1 - (widestX / bridge.halfOpening) ** 2))
      : -Infinity;
    const insideOpening =
      insideWidth &&
      box.min.y > bridge.water + bridge.bottom + 0.05 &&
      box.max.y < bridge.water + archRoof;
    if (!insideOpening) return true;
  }
  for (const collider of bridgeColliders) {
    if (temp.playerBox.intersectsBox(collider)) return true;
  }
  return false;
}

function updatePhysics(dt) {
  if (state.phase !== 'flying') return;

  if (state.phone && (
    !isLandscape() ||
    !sensor.calibrated ||
    performance.now() / 1000 - sensor.lastSampleTime > 0.8
  )) {
    sensor.calibrated = false;
    state.phase = 'calibrating';
    state.phaseStarted = performance.now() / 1000;
    return;
  }

  const targets = controlTargets();
  if (state.updraftActive) {
    flight.pitch = moveToward(flight.pitch, 24 * DEG, 28 * DEG * dt);
    flight.bank = moveToward(flight.bank, 0, SETTINGS.bankRate * dt);
  } else {
    flight.pitch = moveToward(flight.pitch, targets.pitch, SETTINGS.pitchRate * dt);
    flight.bank = moveToward(flight.bank, targets.bank, SETTINGS.bankRate * dt);
  }

  const speedRatio = clamp(flight.speed / SETTINGS.cruiseSpeed, 0.6, 1.65);
  const yawRate = 32 * DEG * (flight.bank / SETTINGS.maxBank) * speedRatio;
  flight.heading -= yawRate * dt;

  const overspeed = Math.max(0, flight.speed - 55.556);
  const acceleration =
    -9.81 * Math.sin(flight.pitch) +
    0.8541 -
    0.00177224 * flight.speed * flight.speed -
    0.03 * overspeed * overspeed;
  flight.speed = clamp(flight.speed + acceleration * dt, SETTINGS.minSpeed, SETTINGS.maxSpeed);

  setFlightQuaternion();
  temp.forward.copy(FORWARD).applyQuaternion(flight.quaternion).normalize();
  flight.position.addScaledVector(temp.forward, flight.speed * dt);

  // Water, terrain and stone remain fatal even on the exact frame the updraft is entered.
  if (detectCollision()) {
    beginCrash();
    return;
  }

  const dx = flight.position.x;
  const dz = flight.position.z - SETTINGS.updraftZ;
  const distanceToUpdraft = Math.hypot(dx, dz);
  const updraftBase = riverHeight(SETTINGS.updraftZ);
  const loopTargetHeight = terrainHeight(0, SETTINGS.routeStartZ) + SETTINGS.spawnAltitude - 8;
  const insideUpdraftHeight =
    flight.position.y - SETTINGS.playerHalfY >= updraftBase &&
    flight.position.y <= loopTargetHeight;
  if (
    !state.updraftActive &&
    distanceToUpdraft < SETTINGS.updraftRadius &&
    flight.position.z < SETTINGS.updraftZ + 40 &&
    insideUpdraftHeight
  ) {
    state.updraftActive = true;
    state.updraftElapsed = 0;
  }

  if (state.updraftActive) {
    state.updraftElapsed += dt;
    const capture = 1 - clamp(distanceToUpdraft / SETTINGS.updraftRadius, 0, 1);
    flight.position.x += -flight.position.x * (0.48 + capture * 0.5) * dt;
    flight.position.z += (SETTINGS.updraftZ - flight.position.z) * 0.32 * dt;
    flight.position.y += (58 + capture * 18) * dt;
    flight.speed = THREE.MathUtils.damp(flight.speed, SETTINGS.spawnSpeed, 0.8, dt);
    if (flight.position.y >= loopTargetHeight || state.updraftElapsed > 4.4) beginLoop();
  }
}

function updatePhase(now) {
  const elapsed = now - state.phaseStarted;
  if (state.phase === 'calibrating') {
    fade.style.opacity = '0';
    if (!isLandscape()) {
      state.phaseStarted = now;
      orientationWarning.classList.remove('hidden');
      setEyeMessage('ROTATE');
      return;
    }
    if (!sensor.valid || now - sensor.lastSampleTime > 0.4) {
      state.phaseStarted = now;
      setEyeMessage('TRACKING…');
      return;
    }
    orientationWarning.classList.add('hidden');
    const count = Math.max(1, 3 - Math.floor(elapsed));
    setEyeMessage(`LOOK STRAIGHT\n${count}`);
    if (elapsed >= 3) {
      recenter(false);
      state.phase = 'flying';
      state.phaseStarted = now;
      setEyeMessage('');
    }
    return;
  }

  if (state.phase === 'crashing') {
    setEyeMessage('');
    if (elapsed < 0.3) fade.style.opacity = String(elapsed / 0.3);
    else fade.style.opacity = '1';
    if (elapsed >= 1.3) {
      resetFlight();
      state.phase = 'respawning';
      state.phaseStarted = now;
    }
    return;
  }

  if (state.phase === 'respawning') {
    fade.style.opacity = String(1 - clamp(elapsed / 0.45, 0, 1));
    const count = Math.max(1, 3 - Math.floor(elapsed));
    setEyeMessage(String(count));
    if (elapsed >= 3) {
      recenter(false);
      state.phase = 'flying';
      state.phaseStarted = now;
      setEyeMessage('');
      fade.style.opacity = '0';
    }
    return;
  }

  if (state.phase === 'looping') {
    setEyeMessage('UPDRAFT');
    fade.style.background = '#f3ffe9';
    fade.style.opacity = String(clamp(elapsed / 0.5, 0, 1));
    if (elapsed >= 0.55 && !state.loopResetDone) {
      resetFlight();
      state.loopResetDone = true;
      state.phase = 'loopReturn';
      state.phaseStarted = now;
    }
    return;
  }

  if (state.phase === 'loopReturn') {
    fade.style.background = '#f3ffe9';
    fade.style.opacity = String(1 - clamp(elapsed / 0.55, 0, 1));
    if (elapsed >= 0.6) {
      fade.style.background = '#fff';
      fade.style.opacity = '0';
      setEyeMessage('');
      state.phase = 'flying';
      state.phaseStarted = now;
    }
    return;
  }

  fade.style.opacity = '0';
  if (state.toast && now < state.toastUntil) setEyeMessage(state.toast);
  else {
    state.toast = '';
    setEyeMessage('');
  }
}

function updateCamera() {
  camera.position.copy(flight.position);
  camera.quaternion.copy(flight.quaternion);
  camera.updateMatrixWorld(true);
}

function updateAtmosphere(now, frameDt) {
  river.material.uniforms.uTime.value = now;
  updraft.column.material.opacity = 0.09 + Math.sin(now * 2.1) * 0.025;
  const positions = updraft.points.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, (updraft.bases[i] + now * (18 + (i % 7) * 1.3)) % 280);
  }
  positions.needsUpdate = true;
  updraft.points.rotation.y = now * 0.035;

  const vignetteTarget = smoothstep(SETTINGS.comfortSpeed, SETTINGS.maxSpeed, flight.speed) * 0.72;
  const current = Number.parseFloat(vignette.style.opacity || '0') || 0;
  vignette.style.opacity = String(THREE.MathUtils.damp(current, state.phase === 'menu' ? 0 : vignetteTarget, 8, frameDt));

  sky.position.copy(camera.position);
}

function renderMenu(now) {
  const drift = Math.sin(now * 0.12);
  camera.position.set(88 + drift * 16, 112 + Math.sin(now * 0.17) * 5, 185);
  temp.look.set(0, 44, -500);
  camera.lookAt(temp.look);
  camera.updateMatrixWorld(true);
}

function renderScene() {
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.clear();

  if (!state.stereo) {
    renderer.render(scene, camera);
    return;
  }

  const half = Math.floor(width / 2);
  stereoCamera.eyeSep = SETTINGS.eyeSeparation;
  stereoCamera.aspect = 0.5;
  stereoCamera.update(camera);
  renderer.setScissorTest(true);

  renderer.setViewport(0, 0, half, height);
  renderer.setScissor(0, 0, half, height);
  renderer.render(scene, stereoCamera.cameraL);

  renderer.setViewport(half, 0, width - half, height);
  renderer.setScissor(half, 0, width - half, height);
  renderer.render(scene, stereoCamera.cameraR);
  renderer.setScissorTest(false);
}

let lastFrame = performance.now() / 1000;
let accumulator = 0;
function frame(milliseconds) {
  requestAnimationFrame(frame);
  const now = milliseconds / 1000;
  const frameDt = clamp(now - lastFrame, 0, 0.1);
  lastFrame = now;

  if (state.phase === 'menu') {
    renderMenu(now);
  } else {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= SETTINGS.physicsStep && steps < 8) {
      updatePhysics(SETTINGS.physicsStep);
      accumulator -= SETTINGS.physicsStep;
      steps += 1;
    }
    if (steps === 8) accumulator = 0;
    updatePhase(now);
    updateCamera();
  }

  updateAtmosphere(now, frameDt);
  renderScene();
}

function resize() {
  const width = Math.max(2, Math.floor(window.innerWidth / 2) * 2);
  const height = Math.max(2, Math.floor(window.innerHeight));
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
}

function handleOrientationChange() {
  setTimeout(resize, 120);
  if (!state.phone || state.phase === 'menu') return;
  sensor.valid = false;
  sensor.calibrated = false;
  sensor.lastSampleTime = 0;
  sensor.samples.length = 0;
  if (state.phase === 'flying' || state.phase === 'calibrating') {
    state.phase = 'calibrating';
    state.phaseStarted = performance.now() / 1000;
  }
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', handleOrientationChange);
if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', handleOrientationChange);

window.addEventListener('mousemove', event => {
  if (state.phase === 'menu' || state.phone || input.mouseOriginX === null) return;
  input.mouseX = clamp((event.clientX - input.mouseOriginX) / (window.innerWidth * 0.25), -1, 1);
  input.mouseY = clamp((event.clientY - input.mouseOriginY) / (window.innerHeight * 0.25), -1, 1);
});

window.addEventListener('keydown', event => {
  if (event.code === 'KeyW' || event.code === 'ArrowUp') input.keyPitch = 1;
  if (event.code === 'KeyS' || event.code === 'ArrowDown') input.keyPitch = -1;
  if (event.code === 'KeyA' || event.code === 'ArrowLeft') input.keyRoll = -1;
  if (event.code === 'KeyD' || event.code === 'ArrowRight') input.keyRoll = 1;
  if (event.code === 'KeyR' && state.phase !== 'menu') beginCrash();
});

window.addEventListener('keyup', event => {
  if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(event.code)) input.keyPitch = 0;
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) input.keyRoll = 0;
});

canvas.addEventListener('pointerup', event => {
  event.preventDefault();
  if (state.phone && state.phase === 'flying') recenter(true);
});

document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now() / 1000;
  accumulator = 0;
  if (document.visibilityState === 'visible') void acquireWakeLock();
});

resize();
resetFlight();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(() => {});
}
