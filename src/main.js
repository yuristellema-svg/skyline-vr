import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, clamp } from './config.js';
import { InputController, requestOrientationPermissionFromGesture } from './input.js';
import { FlightModel } from './flightModel.js';
import { CollisionSystem } from './collision.js';
import { CameraRig } from './camera.js';
import { EffectsSystem } from './effects.js';
import { StereoRenderer } from './stereo.js';
import { GazeMenu } from './menu.js';
import { MonoHud } from './hud.js';
import { buildTestBox, testBoxHeight } from './world/testBox.js';

const canvas = document.querySelector('#game');
const startPanel = document.querySelector('#start-panel');
const phoneStart = document.querySelector('#phone-start');
const desktopStart = document.querySelector('#desktop-start');
const startStatus = document.querySelector('#start-status');
const orientationWarning = document.querySelector('#orientation-warning');
const installHint = document.querySelector('#install-hint');
const installDismiss = document.querySelector('#install-dismiss');
const eyeMessage = document.querySelector('#eye-message');
const eyeLeft = eyeMessage.querySelector('.eye-left');
const eyeRight = eyeMessage.querySelector('.eye-right');
const hudRoot = document.querySelector('#mono-hud');

const scene = new THREE.Scene();
const stereo = new StereoRenderer(canvas);
scene.add(stereo.camera);
const input = new InputController();
const flight = new FlightModel();
const collision = new CollisionSystem(testBoxHeight);
const world = buildTestBox(scene, collision);
const cameraRig = new CameraRig(scene, stereo.camera, testBoxHeight);
const effects = new EffectsSystem(scene);
const hud = new MonoHud(hudRoot);

let phase = 'boot'; // boot | calibrating | flying | paused | crashed
let phoneMode = false;
let phaseStarted = performance.now() / 1000;
let crashElapsed = 0;
let crashCountdownFinished = false;
let neutralHold = 0;
let accumulator = 0;
let lastFrame = performance.now() / 1000;
let droppedSteps = 0;
let fadeWhite = 0;
let wakeLock = null;
let lastEyeText = null;
let transientMessage = '';
let transientUntil = 0;
let menuNeedsReanchor = false;

const menu = new GazeMenu(stereo.uiScene, input, {
  resume: () => {
    if (phase !== 'crashed') resumeFromMenu();
  },
  recenter: () => showTransient('RECENTERED', 1.2),
  camera: () => {
    const mode = cameraRig.toggle();
    cameraRig.reset(flight);
    menuNeedsReanchor = true;
    return mode;
  },
  respawn: () => beginRespawn('Manual respawn'),
  effects: () => effects.cycleIntensity(),
  restart: () => {
    world.reset();
    beginRespawn('World restarted');
  },
});

function setStartStatus(message, error = false) {
  startStatus.textContent = message;
  startStatus.classList.toggle('error', error);
}

function setEyeMessage(message) {
  if (message === lastEyeText) return;
  lastEyeText = message;
  eyeLeft.textContent = message;
  eyeRight.textContent = message;
  eyeMessage.classList.toggle('hidden', !message);
}

function showTransient(message, seconds) {
  transientMessage = message;
  transientUntil = performance.now() / 1000 + seconds;
}

function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function configureInstallHint() {
  const isiPhone = /iPhone|iPod/i.test(navigator.userAgent);
  const dismissed = localStorage.getItem('skyline-vr-install-hint-dismissed') === '1';
  installHint.classList.toggle('hidden', !isiPhone || isStandalone() || dismissed);
  installDismiss.addEventListener('click', () => {
    localStorage.setItem('skyline-vr-install-hint-dismissed', '1');
    installHint.classList.add('hidden');
  });
}

async function acquireWakeLock() {
  if (!phoneMode || document.visibilityState !== 'visible') return;
  if (!('wakeLock' in navigator)) {
    showTransient('WAKE LOCK UNAVAILABLE', 2.5);
    return;
  }
  if (wakeLock && !wakeLock.released) return;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) wakeLock = null;
    });
  } catch (error) {
    showTransient('SCREEN MAY SLEEP', 2.5);
  }
}

function resetFlight() {
  const spawn = CONFIG.testBox.spawn;
  flight.reset(spawn[0], spawn[1], spawn[2], CONFIG.physics.spawnSpeed);
  cameraRig.reset(flight);
  accumulator = 0;
}

function startSession(phone) {
  phoneMode = phone;
  document.body.classList.add('running');
  document.body.classList.toggle('phone', phone);
  startPanel.classList.add('hidden');
  installHint.classList.add('hidden');
  input.setMode(phone ? 'phone' : 'desktop');
  stereo.setStereo(phone);
  hud.setVisible(!phone);
  resetFlight();
  phaseStarted = performance.now() / 1000;
  phase = phone ? 'calibrating' : 'flying';
  if (phone) void acquireWakeLock();
  else showTransient('CENTER MOUSE · W/S/A/D ALSO WORK', 3);
}

async function waitForLandscape() {
  if (isLandscape()) return;
  orientationWarning.classList.remove('hidden');
  await new Promise(resolve => {
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

async function beginPhone(permissionPromise) {
  phoneStart.disabled = true;
  desktopStart.disabled = true;
  try {
    setStartStatus('Waiting for motion permission…');
    if (!window.isSecureContext) throw new Error('Phone VR requires the secure GitHub Pages link.');
    const permission = await permissionPromise;
    if (permission !== 'granted') throw new Error('Motion access was not granted. Tap Start and choose Allow.');
    input.listenForOrientation();
    setStartStatus('Rotate the phone to landscape.');
    await waitForLandscape();
    setStartStatus('Reading head movement…');
    await input.waitForFreshSample();
    if (!input.yawValid) throw new Error('Head yaw is unavailable, so the gaze menu cannot work. Reload Safari and allow motion access.');
    startSession(true);
  } catch (error) {
    setStartStatus(error.message || 'Phone VR could not start.', true);
    phoneStart.disabled = false;
    desktopStart.disabled = false;
    orientationWarning.classList.add('hidden');
  }
}

phoneStart.addEventListener('click', () => {
  let permissionPromise;
  try {
    // iOS requires this permission call to be the direct consequence of the Start tap.
    permissionPromise = requestOrientationPermissionFromGesture();
  } catch (error) {
    permissionPromise = Promise.reject(error);
  }
  void beginPhone(permissionPromise);
});

desktopStart.addEventListener('click', () => startSession(false));

function openMenu(crashMode = false) {
  if (menu.isOpen) return;
  accumulator = 0;
  if (!crashMode) phase = 'paused';
  menu.cameraName = cameraRig.mode.toUpperCase();
  menu.effectsName = effects.intensityName;
  menu.open(cameraRig.basePosition, cameraRig.baseQuaternion, crashMode);
}

function resumeFromMenu() {
  if (phase === 'crashed') return;
  menu.close();
  phase = 'flying';
  accumulator = 0;
  lastFrame = performance.now() / 1000;
  setEyeMessage('');
}

function beginRespawn(reason) {
  // The crash-menu Respawn action deliberately skips the remaining countdown,
  // but still requires the neutral/steady safety gate before returning control.
  if (phase === 'crashed') {
    crashElapsed = 3;
    neutralHold = 0;
    return;
  }
  phase = 'crashed';
  crashElapsed = 0;
  crashCountdownFinished = false;
  neutralHold = 0;
  accumulator = 0;
  if (menu.isOpen) menu.close();
  openMenu(true);
  showTransient(reason, 1.2);
}

function finishRespawn() {
  resetFlight();
  input.recenter();
  menu.close();
  phase = 'flying';
  phaseStarted = performance.now() / 1000;
  crashElapsed = 0;
  fadeWhite = 0;
  neutralHold = 0;
  setEyeMessage('');
  lastFrame = performance.now() / 1000;
}

function updateCalibration(now) {
  fadeWhite = 0;
  if (!isLandscape()) {
    phaseStarted = now;
    orientationWarning.classList.remove('hidden');
    setEyeMessage('ROTATE');
    return;
  }
  orientationWarning.classList.add('hidden');
  if (!input.isTrackingFresh(now)) {
    phaseStarted = now;
    setEyeMessage('TRACKING…');
    return;
  }
  const elapsed = now - phaseStarted;
  const count = Math.max(1, 3 - Math.floor(elapsed));
  setEyeMessage(`LOOK STRAIGHT\n${count}`);
  if (elapsed >= 3) {
    input.recenter(now);
    phase = 'flying';
    phaseStarted = now;
    setEyeMessage('');
  }
}

function updateCrash(dt) {
  crashElapsed += dt;
  if (crashElapsed < 0.25) fadeWhite = crashElapsed / 0.25;
  else if (crashElapsed < 0.75) fadeWhite = 1 - (crashElapsed - 0.25) / 0.5;
  else fadeWhite = 0;

  if (crashElapsed < 3) {
    const count = Math.max(1, 3 - Math.floor(crashElapsed));
    setEyeMessage(`CRASH\n${count}`);
    return;
  }
  crashCountdownFinished = true;
  if (phoneMode && (!input.isTrackingFresh() || !input.isNearFlightNeutral())) {
    neutralHold = 0;
    setEyeMessage('LOOK STRAIGHT');
    return;
  }
  neutralHold += dt;
  setEyeMessage('HOLD STEADY');
  if (neutralHold >= 0.5) finishRespawn();
}

function updateInputAndState(frameDt, now) {
  input.updateFrame(frameDt, phase === 'flying');
  if (input.consumeCameraToggle() && phase !== 'boot' && phase !== 'calibrating') {
    cameraRig.toggle();
    cameraRig.reset(flight);
  }
  if (input.consumeRespawnRequest() && phase !== 'boot' && phase !== 'calibrating') beginRespawn('Manual respawn');
  if (input.consumeMenuRequest()) {
    if (phase === 'flying') openMenu(false);
    else if (phase === 'paused') resumeFromMenu();
  }

  if (phoneMode && phase === 'flying' && (!isLandscape() || !input.calibrated || !input.isTrackingFresh(now))) {
    phase = 'calibrating';
    phaseStarted = now;
    accumulator = 0;
  }
}

function updateMessages(now) {
  if (phase === 'flying' && transientMessage && now < transientUntil) setEyeMessage(transientMessage);
  else if (phase === 'flying' && transientMessage) {
    transientMessage = '';
    setEyeMessage('');
  }
}

function frame(milliseconds) {
  requestAnimationFrame(frame);
  const now = milliseconds / 1000;
  const frameDt = clamp(now - lastFrame, 0, 0.1);
  lastFrame = now;
  updateInputAndState(frameDt, now);

  if (phase === 'calibrating') updateCalibration(now);
  else if (phase === 'crashed') updateCrash(frameDt);
  else if (phase === 'flying') {
    input.sampleFlightControls();
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= CONFIG.physics.fixedStep && steps < CONFIG.physics.maxSubSteps) {
      flight.step(CONFIG.physics.fixedStep, input.controls);
      accumulator -= CONFIG.physics.fixedStep;
      steps += 1;
      if (collision.check(flight.position)) {
        beginRespawn(collision.lastReason);
        break;
      }
    }
    if (steps === CONFIG.physics.maxSubSteps && accumulator >= CONFIG.physics.fixedStep) {
      accumulator = 0;
      droppedSteps += 1;
    }
  }

  if (menu.isOpen) menu.update(frameDt);
  effects.update(phase === 'flying' ? frameDt : 0, flight, stereo.camera);
  cameraRig.update(
    frameDt,
    flight,
    stereo.stereoEnabled,
    menu.isOpen ? input.menuLook : null,
    menu.isOpen ? 0 : effects.shakePitch,
    menu.isOpen ? 0 : effects.shakeYaw,
    menu.isOpen ? 0 : effects.shakeRoll,
    effects.viewSqueeze
  );
  if (menuNeedsReanchor && menu.isOpen) {
    menu.reanchor(cameraRig.basePosition, cameraRig.baseQuaternion);
    menuNeedsReanchor = false;
  }
  world.update(stereo.camera);
  stereo.setReticle(flight.boostCharge, menu.dwellProgress, phase !== 'boot');
  stereo.setOverlay(effects.vignette, effects.redTint, fadeWhite);
  updateMessages(now);
  hud.update(frameDt, flight, cameraRig.mode, stereo.metrics, droppedSteps);
  stereo.render(scene);
}

window.addEventListener('resize', () => stereo.resize());
document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now() / 1000;
  accumulator = 0;
  if (document.visibilityState === 'visible') void acquireWakeLock();
});
window.addEventListener('pageshow', () => {
  lastFrame = performance.now() / 1000;
  accumulator = 0;
  void acquireWakeLock();
});

configureInstallHint();
resetFlight();
cameraRig.update(0, flight, false, null, 0, 0, 0, 0);
hud.setVisible(false);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(error => setStartStatus(`Offline install unavailable: ${error.message}`, true));
}
