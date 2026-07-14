import * as THREE from './vendor/three.module.min.js';

const canvas = document.querySelector('#game');
const startPanel = document.querySelector('#start-panel');
const desktopStart = document.querySelector('#desktop-start');
const vrStart = document.querySelector('#vr-start');
const hud = document.querySelector('#hud');
const controls = document.querySelector('#controls');
const speedEl = document.querySelector('#speed');
const altitudeEl = document.querySelector('#altitude');
const distanceEl = document.querySelector('#distance');
const messageEl = document.querySelector('#message');
const rotateEl = document.querySelector('#rotate');
const cameraButton = document.querySelector('#camera-button');
const recenterButton = document.querySelector('#recenter-button');
const vrButton = document.querySelector('#vr-button');
const restartButton = document.querySelector('#restart-button');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = false;
renderer.setClearColor(0x91b5c8, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91b5c8);
scene.fog = new THREE.Fog(0x91b5c8, 260, 1500);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2200);
const eyeCamera = new THREE.PerspectiveCamera(72, 1, 0.1, 2200);
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x6c624c, 2.2));
const sun = new THREE.DirectionalLight(0xffefd2, 2.1);
sun.position.set(-180, 260, 120);
scene.add(sun);

const WORLD_LENGTH = 6200;
const WORLD_HALF_WIDTH = 450;
const START = new THREE.Vector3(0, 165, 120);
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();

let running = false;
let stereo = false;
let phoneMode = false;
let cameraMode = 'chase';
let crashed = false;
let checkpointZ = 120;
let distanceTravelled = 0;
let lastTime = performance.now();

const flight = {
  position: START.clone(),
  speed: 42,
  pitch: -0.08,
  roll: 0,
  yaw: 0,
  pitchTarget: -0.08,
  rollTarget: 0,
};

const input = {
  mouseX: 0,
  mouseY: 0,
  keyPitch: 0,
  keyRoll: 0,
  deviceReady: false,
  baselinePitch: 0,
  baselineRoll: 0,
  rawPitch: 0,
  rawRoll: 0,
};

const temp = {
  q: new THREE.Quaternion(),
  qPitch: new THREE.Quaternion(),
  qYaw: new THREE.Quaternion(),
  qRoll: new THREE.Quaternion(),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  targetCamera: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  eyeOffset: new THREE.Vector3(),
  cameraPosition: new THREE.Vector3(),
  cameraQuaternion: new THREE.Quaternion(),
};

function floorHeight(x, z) {
  const longitudinal = Math.sin(z * 0.0042) * 5 + Math.sin(z * 0.011 + 1.8) * 2.3;
  const halfWidth = 90 + Math.sin(z * 0.0016) * 28 + Math.sin(z * 0.006) * 10;
  const outside = Math.max(0, Math.abs(x) - halfWidth);
  const mountain = Math.pow(outside, 1.28) * 0.17;
  const detail = Math.sin(x * 0.028 + z * 0.008) * 3 + Math.sin(x * 0.065 - z * 0.012) * 1.4;
  return longitudinal + mountain + detail * Math.min(1, outside / 50);
}

function makeTerrain() {
  const xSeg = 90;
  const zSeg = 180;
  const geometry = new THREE.PlaneGeometry(WORLD_HALF_WIDTH * 2, WORLD_LENGTH, xSeg, zSeg);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -WORLD_LENGTH / 2 + 180);

  const pos = geometry.attributes.position;
  const colors = [];
  const low = new THREE.Color(0x7e8d58);
  const high = new THREE.Color(0x8a7d65);
  const rock = new THREE.Color(0x67665f);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = floorHeight(x, z);
    pos.setY(i, y);

    const slopeHint = THREE.MathUtils.clamp((y - 6) / 90, 0, 1);
    c.copy(low).lerp(high, slopeHint * 0.7).lerp(rock, Math.max(0, slopeHint - 0.5));
    const variation = (Math.sin(x * 0.13 + z * 0.037) + 1) * 0.018;
    c.offsetHSL(0, 0, variation - 0.018);
    colors.push(c.r, c.g, c.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
}

function makeRiver() {
  const geometry = new THREE.PlaneGeometry(44, WORLD_LENGTH, 1, 180);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 1.2, -WORLD_LENGTH / 2 + 180);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f9bb2,
    roughness: 0.24,
    metalness: 0.18,
    transparent: true,
    opacity: 0.88,
  });
  const river = new THREE.Mesh(geometry, material);
  scene.add(river);
  return river;
}

const colliders = [];
function addBox(x, y, z, sx, sy, sz, color, collider = false) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  if (collider) colliders.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

function makeBridge(z = -760) {
  const floor = floorHeight(0, z);
  const stone = 0x8f8778;
  addBox(0, floor + 31, z, 150, 7, 15, stone, true);
  addBox(-62, floor + 16, z, 18, 31, 17, stone, true);
  addBox(62, floor + 16, z, 18, 31, 17, stone, true);
  addBox(-31, floor + 27, z, 44, 8, 17, stone, true);
  addBox(31, floor + 27, z, 44, 8, 17, stone, true);

  for (let i = -5; i <= 5; i++) addBox(i * 13, floor + 37, z, 3, 6, 16, 0x6f685d, false);
  return { z, openingTop: floor + 23 };
}

function makeSecondBridge(z = -2050) {
  const floor = floorHeight(0, z);
  const wood = 0x6d4c32;
  addBox(0, floor + 17, z, 120, 4, 10, wood, true);
  addBox(-52, floor + 9, z, 6, 18, 7, wood, true);
  addBox(52, floor + 9, z, 6, 18, 7, wood, true);
  for (let i = -4; i <= 4; i++) addBox(i * 13, floor + 20, z, 2, 7, 10, 0x8a6746, false);
}

function makeRocksAndTrees() {
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x66665f, roughness: 1, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x493b2f, roughness: 1 });
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x324b34, roughness: 1, flatShading: true });
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(.8, 1.2, 7, 5);
  const crownGeo = new THREE.ConeGeometry(4.2, 13, 7);

  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 240);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 420);
  const crowns = new THREE.InstancedMesh(crownGeo, treeMat, 420);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (let i = 0; i < 240; i++) {
    const z = 80 - Math.random() * (WORLD_LENGTH - 240);
    const side = Math.random() < .5 ? -1 : 1;
    const x = side * (75 + Math.random() * 300);
    const scale = 2 + Math.random() * 8;
    p.set(x, floorHeight(x, z) + scale * .35, z);
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random(), Math.random()));
    s.set(scale * (0.7 + Math.random()), scale * (0.5 + Math.random()), scale * (0.7 + Math.random()));
    m.compose(p, q, s);
    rocks.setMatrixAt(i, m);
  }

  for (let i = 0; i < 420; i++) {
    const z = 70 - Math.random() * (WORLD_LENGTH - 220);
    const side = Math.random() < .5 ? -1 : 1;
    const x = side * (105 + Math.random() * 220);
    const base = floorHeight(x, z);
    const scale = .7 + Math.random() * 1.5;
    p.set(x, base + 3.5 * scale, z);
    q.identity();
    s.set(scale, scale, scale);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    p.set(x, base + 11 * scale, z);
    m.compose(p, q, s);
    crowns.setMatrixAt(i, m);
  }

  rocks.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(rocks, trunks, crowns);
}

function makeClouds() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .26, depthWrite: false });
  const geo = new THREE.SphereGeometry(1, 10, 6);
  for (let i = 0; i < 55; i++) {
    const cloud = new THREE.Mesh(geo, mat);
    const z = -Math.random() * WORLD_LENGTH;
    const x = (Math.random() - .5) * 650;
    const y = 125 + Math.random() * 150;
    cloud.position.set(x, y, z);
    cloud.scale.set(25 + Math.random() * 45, 8 + Math.random() * 14, 20 + Math.random() * 50);
    scene.add(cloud);
  }
}

function makeGates() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xf0b55d, transparent: true, opacity: .7, side: THREE.DoubleSide });
  const positions = [-1120, -2550, -4100, -5600];
  for (const z of positions) {
    const y = floorHeight(0, z) + 42;
    const gate = new THREE.Mesh(new THREE.TorusGeometry(18, .65, 8, 40), mat);
    gate.position.set(0, y, z);
    scene.add(gate);
    gate.userData.checkpoint = true;
  }
}

function makePilot() {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xd8744f, roughness: .78, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x26333a, roughness: .8, flatShading: true });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 3.2, 3, 7), suit);
  torso.rotation.x = Math.PI / 2;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), dark);
  head.position.z = -3;
  group.add(head);

  const wing = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-6.5, 0, -1), new THREE.Vector3(0, 0, 1.4), new THREE.Vector3(6.5, 0, -1)
  ]), suit);
  wing.geometry.setIndex([0, 1, 2]);
  wing.geometry.computeVertexNormals();
  wing.material.side = THREE.DoubleSide;
  group.add(wing);

  const legGeo = new THREE.CapsuleGeometry(.5, 3, 2, 6);
  for (const x of [-.8, .8]) {
    const leg = new THREE.Mesh(legGeo, suit);
    leg.rotation.x = Math.PI / 2;
    leg.rotation.z = x < 0 ? -.12 : .12;
    leg.position.set(x, -.15, 3.2);
    group.add(leg);
  }
  group.scale.setScalar(.72);
  scene.add(group);
  return group;
}

makeTerrain();
const river = makeRiver();
makeBridge();
makeSecondBridge();
makeRocksAndTrees();
makeClouds();
makeGates();
const pilot = makePilot();

function deviceQuaternion(alpha, beta, gamma, orient) {
  const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);
  const q1 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
  const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient);
  return q.multiply(q1).multiply(q0);
}

function onDeviceOrientation(event) {
  if (event.alpha == null) return;
  const orient = THREE.MathUtils.degToRad(screen.orientation?.angle || window.orientation || 0);
  const q = deviceQuaternion(
    THREE.MathUtils.degToRad(event.alpha || 0),
    THREE.MathUtils.degToRad(event.beta || 0),
    THREE.MathUtils.degToRad(event.gamma || 0),
    orient
  );
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  input.rawPitch = e.x;
  input.rawRoll = e.z;
  input.deviceReady = true;
}

async function enableDeviceOrientation() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') throw new Error('Motion permission was not granted.');
    }
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
    await new Promise(resolve => setTimeout(resolve, 220));
    recenter();
    return true;
  } catch (error) {
    showMessage(error.message || 'Could not start head tracking.', 3200);
    return false;
  }
}

function recenter() {
  input.baselinePitch = input.rawPitch;
  input.baselineRoll = input.rawRoll;
  showMessage('Centered', 650);
}

function setStereo(value) {
  stereo = value;
  document.body.classList.toggle('stereo', stereo);
  vrButton.textContent = `Stereo: ${stereo ? 'on' : 'off'}`;
  resize();
}

async function requestFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (_) {}
}

async function start({ phone = false } = {}) {
  phoneMode = phone;
  if (phoneMode) {
    if (innerHeight > innerWidth) {
      rotateEl.classList.remove('hidden');
      setTimeout(() => rotateEl.classList.add('hidden'), 2400);
    }
    const allowed = await enableDeviceOrientation();
    if (!allowed) phoneMode = false;
    await requestFullscreen();
    setStereo(true);
  }

  document.body.classList.add('running');
  startPanel.classList.add('hidden');
  hud.classList.remove('hidden');
  controls.classList.remove('hidden');
  running = true;
  resetFlight();
  clock.start();
}

function resetFlight() {
  const spawnZ = checkpointZ;
  flight.position.set(0, floorHeight(0, spawnZ) + (spawnZ === 120 ? 165 : 58), spawnZ);
  flight.speed = spawnZ === 120 ? 42 : 48;
  flight.pitch = -.08;
  flight.roll = 0;
  flight.yaw = 0;
  crashed = false;
  distanceTravelled = Math.max(0, 120 - spawnZ);
  messageEl.classList.add('hidden');
}

function crash(reason = 'Impact') {
  if (crashed) return;
  crashed = true;
  showMessage(`${reason} — restarting`, 1200);
  setTimeout(resetFlight, 1150);
}

function showMessage(text, duration = 1000) {
  messageEl.textContent = text;
  messageEl.classList.remove('hidden');
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => messageEl.classList.add('hidden'), duration);
}

function updateInput(dt) {
  let pitchInput = 0;
  let rollInput = 0;

  if (phoneMode && input.deviceReady) {
    pitchInput = THREE.MathUtils.clamp((input.rawPitch - input.baselinePitch) * 1.25, -.75, .75);
    rollInput = THREE.MathUtils.clamp((input.rawRoll - input.baselineRoll) * -1.6, -1, 1);
  } else {
    pitchInput = -input.mouseY * .48 + input.keyPitch * .45;
    rollInput = input.mouseX * .72 + input.keyRoll * .72;
  }

  flight.pitchTarget = THREE.MathUtils.clamp(pitchInput - .055, -.68, .48);
  flight.rollTarget = THREE.MathUtils.clamp(rollInput, -.9, .9);
  flight.pitch = THREE.MathUtils.damp(flight.pitch, flight.pitchTarget, 3.8, dt);
  flight.roll = THREE.MathUtils.damp(flight.roll, flight.rollTarget, 4.6, dt);

  const turnRate = Math.sin(flight.roll) * (0.52 + flight.speed * .004);
  flight.yaw += turnRate * dt;
}

function updateFlight(dt) {
  if (crashed) return;
  updateInput(dt);

  const diveAcceleration = -Math.sin(flight.pitch) * 24;
  const speedDrag = (flight.speed - 43) * .075;
  flight.speed = THREE.MathUtils.clamp(flight.speed + (diveAcceleration - speedDrag) * dt, 22, 118);

  temp.qYaw.setFromAxisAngle(UP, flight.yaw);
  temp.qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), flight.pitch - .045);
  temp.qRoll.setFromAxisAngle(new THREE.Vector3(0, 0, -1), flight.roll);
  temp.q.copy(temp.qYaw).multiply(temp.qPitch).multiply(temp.qRoll);

  temp.forward.copy(FORWARD).applyQuaternion(temp.q).normalize();
  const move = temp.forward.multiplyScalar(flight.speed * dt);
  flight.position.add(move);
  distanceTravelled = Math.max(distanceTravelled, 120 - flight.position.z);

  if (Math.abs(flight.position.x) > WORLD_HALF_WIDTH - 8) crash('Left the valley');
  if (flight.position.z < -WORLD_LENGTH + 80) {
    checkpointZ = 120;
    showMessage('Valley complete', 1700);
    setTimeout(resetFlight, 1600);
  }

  const ground = floorHeight(flight.position.x, flight.position.z);
  if (flight.position.y < ground + 1.6) crash('Terrain impact');

  const pilotBox = new THREE.Box3(
    flight.position.clone().add(new THREE.Vector3(-1.7, -1.2, -2.5)),
    flight.position.clone().add(new THREE.Vector3(1.7, 1.2, 2.5))
  );
  for (const box of colliders) {
    if (pilotBox.intersectsBox(box)) {
      crash('Bridge impact');
      break;
    }
  }

  const checkpointPositions = [-1120, -2550, -4100, -5600];
  for (const z of checkpointPositions) {
    if (flight.position.z < z && checkpointZ > z) {
      checkpointZ = z + 70;
      showMessage('Checkpoint', 700);
    }
  }
}

function updatePilot() {
  pilot.position.copy(flight.position);
  pilot.quaternion.copy(temp.q);
  pilot.visible = cameraMode === 'chase';
}

function updateCamera(dt) {
  temp.right.set(1, 0, 0).applyQuaternion(temp.q).normalize();
  temp.up.set(0, 1, 0).applyQuaternion(temp.q).normalize();
  const flightForward = FORWARD.clone().applyQuaternion(temp.q).normalize();

  if (cameraMode === 'first') {
    temp.targetCamera.copy(flight.position).addScaledVector(temp.up, .35).addScaledVector(flightForward, -1.1);
  } else {
    temp.targetCamera.copy(flight.position)
      .addScaledVector(flightForward, -12)
      .addScaledVector(temp.up, 4.4);
  }

  cameraRig.position.lerp(temp.targetCamera, 1 - Math.exp(-dt * 7));
  temp.lookTarget.copy(flight.position).addScaledVector(flightForward, cameraMode === 'first' ? 75 : 18);
  const targetMatrix = new THREE.Matrix4().lookAt(cameraRig.position, temp.lookTarget, UP);
  const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetMatrix);
  cameraRig.quaternion.slerp(targetQuat, 1 - Math.exp(-dt * 9));
}

function animateWater(t) {
  river.material.opacity = .83 + Math.sin(t * 1.7) * .04;
}

function renderMono(width, height) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, 0);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
}

function renderStereo(width, height) {
  const half = Math.floor(width / 2);
  renderer.setScissorTest(true);
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(temp.cameraPosition);
  camera.getWorldQuaternion(temp.cameraQuaternion);

  for (let eye = 0; eye < 2; eye++) {
    const sign = eye === 0 ? -1 : 1;
    eyeCamera.fov = camera.fov;
    eyeCamera.near = camera.near;
    eyeCamera.far = camera.far;
    eyeCamera.aspect = half / height;
    eyeCamera.updateProjectionMatrix();
    temp.eyeOffset.set(sign * .032, 0, 0).applyQuaternion(temp.cameraQuaternion);
    eyeCamera.position.copy(temp.cameraPosition).add(temp.eyeOffset);
    eyeCamera.quaternion.copy(temp.cameraQuaternion);
    eyeCamera.updateMatrixWorld(true);

    renderer.setViewport(eye * half, 0, half, height);
    renderer.setScissor(eye * half, 0, half, height);
    renderer.render(scene, eyeCamera);
  }
  renderer.setScissorTest(false);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.033, Math.max(.001, (now - lastTime) / 1000));
  lastTime = now;

  if (running) {
    updateFlight(dt);
    updatePilot();
    updateCamera(dt);
    animateWater(now / 1000);

    const ground = floorHeight(flight.position.x, flight.position.z);
    speedEl.textContent = `${Math.round(flight.speed * 3.6)}`;
    altitudeEl.textContent = `${Math.max(0, Math.round(flight.position.y - ground))}`;
    distanceEl.textContent = `${(distanceTravelled / 1000).toFixed(1)}`;
  } else {
    cameraRig.position.set(0, 110, 215);
    cameraRig.lookAt(0, 40, -360);
  }

  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  if (stereo) renderStereo(width, height);
  else renderMono(width, height);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, stereo ? 1 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 180));
window.addEventListener('mousemove', event => {
  input.mouseX = THREE.MathUtils.clamp((event.clientX / innerWidth - .5) * 2, -1, 1);
  input.mouseY = THREE.MathUtils.clamp((event.clientY / innerHeight - .5) * 2, -1, 1);
});
window.addEventListener('keydown', event => {
  if (event.code === 'KeyW' || event.code === 'ArrowUp') input.keyPitch = -1;
  if (event.code === 'KeyS' || event.code === 'ArrowDown') input.keyPitch = 1;
  if (event.code === 'KeyA' || event.code === 'ArrowLeft') input.keyRoll = -1;
  if (event.code === 'KeyD' || event.code === 'ArrowRight') input.keyRoll = 1;
  if (event.code === 'KeyR') resetFlight();
  if (event.code === 'KeyC') toggleCamera();
});
window.addEventListener('keyup', event => {
  if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(event.code)) input.keyPitch = 0;
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) input.keyRoll = 0;
});

desktopStart.addEventListener('click', () => start({ phone: false }));
vrStart.addEventListener('click', () => start({ phone: true }));
recenterButton.addEventListener('click', recenter);
restartButton.addEventListener('click', resetFlight);
vrButton.addEventListener('click', () => setStereo(!stereo));

function toggleCamera() {
  cameraMode = cameraMode === 'chase' ? 'first' : 'chase';
  cameraButton.textContent = `Camera: ${cameraMode}`;
}
cameraButton.addEventListener('click', toggleCamera);

resize();
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
