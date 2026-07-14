import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, DEG, clamp, rateFromDeflection, wrapPi } from './config.js';

const SAMPLE_CAPACITY = 48;

export function screenTilt(betaDegrees, gammaDegrees, screenDegrees, out) {
  const beta = betaDegrees * DEG;
  const gamma = gammaDegrees * DEG;
  const cosBeta = Math.cos(beta);
  const gx = -cosBeta * Math.sin(gamma);
  const gy = Math.sin(beta);
  const gz = cosBeta * Math.cos(gamma);
  const angle = screenDegrees * DEG;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sx = c * gx - s * gy;
  const sy = s * gx + c * gy;
  out.pitch = Math.atan2(gz, Math.hypot(sx, sy));
  out.roll = Math.atan2(-sx, sy);
}

export function requestOrientationPermissionFromGesture() {
  const OrientationEvent = globalThis.DeviceOrientationEvent;
  if (!OrientationEvent) return Promise.resolve('unavailable');
  if (typeof OrientationEvent.requestPermission === 'function') return OrientationEvent.requestPermission();
  return Promise.resolve('granted');
}

export class InputController {
  constructor(config = CONFIG) {
    this.config = config;
    this.mode = 'desktop';
    this.listening = false;
    this.sensorValid = false;
    this.yawValid = false;
    this.calibrated = false;
    this.latestPitch = 0;
    this.latestRoll = 0;
    this.latestHeading = 0;
    this.lastSensorTime = -Infinity;
    this.baselinePitch = 0;
    this.baselineRoll = 0;
    this.baselineHeading = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.desktopMouseArmed = false;
    this.keyPitch = 0;
    this.keyRoll = 0;
    this.sensitivityIndex = config.sensitivity.defaultIndex;

    this.controls = { pitchRate: 0, rollRate: 0 };
    this.menuLook = { yaw: 0, pitch: 0 };
    this._tilt = { pitch: 0, roll: 0 };
    this._samplesPitch = new Float64Array(SAMPLE_CAPACITY);
    this._samplesRoll = new Float64Array(SAMPLE_CAPACITY);
    this._samplesHeading = new Float64Array(SAMPLE_CAPACITY);
    this._samplesTime = new Float64Array(SAMPLE_CAPACITY);
    this._sampleWrite = 0;
    this._sampleCount = 0;
    this._waiter = null;

    this._deviceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._deviceQuaternion = new THREE.Quaternion();
    this._screenQuaternion = new THREE.Quaternion();
    this._fixQuaternion = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this._zee = new THREE.Vector3(0, 0, 1);
    this._headingForward = new THREE.Vector3(0, 0, -1);

    this._yawHold = 0;
    this._menuRequested = false;
    this._gestureArmed = true;
    this._rearmTime = 0;
    this._menuCenterPitch = 0;
    this._menuCenterHeading = 0;
    this._menuCenterMouseX = 0;
    this._menuCenterMouseY = 0;
    this._cameraToggle = false;
    this._respawnRequested = false;
    this._escapeRequested = false;

    this._onOrientation = this._onOrientation.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onOrientationChange = this._onOrientationChange.bind(this);

    window.addEventListener('mousemove', this._onMouseMove, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('orientationchange', this._onOrientationChange);
    if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', this._onOrientationChange);
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.pitchRate = 0;
    this.controls.rollRate = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.desktopMouseArmed = mode !== 'desktop';
    this.keyPitch = 0;
    this.keyRoll = 0;
  }

  listenForOrientation() {
    if (this.listening) return;
    window.addEventListener('deviceorientation', this._onOrientation, true);
    this.listening = true;
  }

  waitForFreshSample(timeoutMs = 5000) {
    if (this.sensorValid && performance.now() / 1000 - this.lastSensorTime < 0.4) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this._waiter === done) this._waiter = null;
        reject(new Error('No motion data arrived. Check Safari motion access and try again.'));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timeout);
        this._waiter = null;
        resolve();
      };
      this._waiter = done;
    });
  }

  recenter(now = performance.now() / 1000) {
    let pitchSin = 0;
    let pitchCos = 0;
    let rollSin = 0;
    let rollCos = 0;
    let headingSin = 0;
    let headingCos = 0;
    let count = 0;
    for (let i = 0; i < this._sampleCount; i += 1) {
      const index = (this._sampleWrite - 1 - i + SAMPLE_CAPACITY) % SAMPLE_CAPACITY;
      if (now - this._samplesTime[index] > 0.25) break;
      pitchSin += Math.sin(this._samplesPitch[index]);
      pitchCos += Math.cos(this._samplesPitch[index]);
      rollSin += Math.sin(this._samplesRoll[index]);
      rollCos += Math.cos(this._samplesRoll[index]);
      headingSin += Math.sin(this._samplesHeading[index]);
      headingCos += Math.cos(this._samplesHeading[index]);
      count += 1;
    }
    if (count > 0) {
      this.baselinePitch = Math.atan2(pitchSin, pitchCos);
      this.baselineRoll = Math.atan2(rollSin, rollCos);
      if (this.yawValid) this.baselineHeading = Math.atan2(headingSin, headingCos);
    } else {
      this.baselinePitch = this.latestPitch;
      this.baselineRoll = this.latestRoll;
      this.baselineHeading = this.latestHeading;
    }
    this.calibrated = this.sensorValid;
    this._yawHold = 0;
    this._gestureArmed = true;
    this._rearmTime = 0;
  }

  sampleFlightControls() {
    const controlsConfig = this.config.controls;
    const sensitivity = this.config.sensitivity.presets[this.sensitivityIndex].multiplier;
    let pitchDeflection;
    let rollDeflection;
    if (this.mode === 'phone') {
      pitchDeflection = wrapPi(this.baselinePitch - this.latestPitch);
      rollDeflection = wrapPi(this.latestRoll - this.baselineRoll);
    } else {
      pitchDeflection = this.desktopMouseArmed ? -this.mouseY * controlsConfig.pitchFullDeflection : 0;
      rollDeflection = this.desktopMouseArmed ? this.mouseX * controlsConfig.rollFullDeflection : 0;
    }

    let pitchRate = rateFromDeflection(
      pitchDeflection,
      controlsConfig.pitchDeadzone,
      controlsConfig.pitchFullDeflection,
      controlsConfig.pitchMaxRate,
      controlsConfig.responseExponent
    );
    let rollRate = rateFromDeflection(
      rollDeflection,
      controlsConfig.rollDeadzone,
      controlsConfig.rollFullDeflection,
      controlsConfig.rollMaxRate,
      controlsConfig.responseExponent
    );
    if (this.keyPitch !== 0) pitchRate = this.keyPitch * controlsConfig.pitchMaxRate;
    if (this.keyRoll !== 0) rollRate = this.keyRoll * controlsConfig.rollMaxRate;
    this.controls.pitchRate = pitchRate * sensitivity;
    this.controls.rollRate = rollRate * sensitivity;
  }

  updateFrame(dt, allowYawGesture) {
    if (!allowYawGesture || this.mode !== 'phone' || !this.yawValid || !this.isTrackingFresh()) {
      this._yawHold = 0;
      return;
    }
    const yaw = wrapPi(this.latestHeading - this.baselineHeading);
    if (!this._gestureArmed) {
      if (Math.abs(yaw) < 20 * DEG) this._rearmTime += dt;
      else this._rearmTime = 0;
      if (this._rearmTime >= 0.5) {
        this._gestureArmed = true;
        this._rearmTime = 0;
      }
      return;
    }
    if (Math.abs(yaw) > this.config.controls.yawMenuThreshold) {
      this._yawHold += dt;
      if (this._yawHold >= this.config.controls.yawMenuHold) {
        this._menuRequested = true;
        this._gestureArmed = false;
        this._yawHold = 0;
      }
    } else if (Math.abs(yaw) < 38 * DEG) {
      this._yawHold = 0;
    }
  }

  beginMenuLook() {
    this._menuCenterPitch = this.latestPitch;
    this._menuCenterHeading = this.latestHeading;
    this._menuCenterMouseX = this.mouseX;
    this._menuCenterMouseY = this.mouseY;
  }

  sampleMenuLook() {
    if (this.mode === 'phone') {
      this.menuLook.yaw = wrapPi(this.latestHeading - this._menuCenterHeading);
      this.menuLook.pitch = wrapPi(this._menuCenterPitch - this.latestPitch);
    } else {
      this.menuLook.yaw = (this.mouseX - this._menuCenterMouseX) * 55 * DEG;
      this.menuLook.pitch = -(this.mouseY - this._menuCenterMouseY) * 34 * DEG;
    }
  }

  isTrackingFresh(now = performance.now() / 1000) {
    return this.sensorValid && now - this.lastSensorTime <= this.config.controls.sensorStaleAfter;
  }

  isNearFlightNeutral(pitchLimit = 10 * DEG, rollLimit = 10 * DEG, yawLimit = 15 * DEG) {
    if (this.mode !== 'phone') return true;
    return (
      Math.abs(wrapPi(this.latestPitch - this.baselinePitch)) <= pitchLimit &&
      Math.abs(wrapPi(this.latestRoll - this.baselineRoll)) <= rollLimit &&
      (!this.yawValid || Math.abs(wrapPi(this.latestHeading - this.baselineHeading)) <= yawLimit)
    );
  }

  cycleSensitivity() {
    this.sensitivityIndex = (this.sensitivityIndex + 1) % this.config.sensitivity.presets.length;
    return this.config.sensitivity.presets[this.sensitivityIndex].name;
  }

  get sensitivityName() {
    return this.config.sensitivity.presets[this.sensitivityIndex].name;
  }

  consumeMenuRequest() {
    const value = this._menuRequested || this._escapeRequested;
    this._menuRequested = false;
    this._escapeRequested = false;
    return value;
  }

  consumeCameraToggle() {
    const value = this._cameraToggle;
    this._cameraToggle = false;
    return value;
  }

  consumeRespawnRequest() {
    const value = this._respawnRequested;
    this._respawnRequested = false;
    return value;
  }

  _onOrientation(event) {
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const screenDegrees = screen.orientation?.angle ?? window.orientation ?? 0;
    screenTilt(event.beta, event.gamma, screenDegrees, this._tilt);
    this.latestPitch = this._tilt.pitch;
    this.latestRoll = this._tilt.roll;
    this.sensorValid = true;
    this.lastSensorTime = performance.now() / 1000;

    if (Number.isFinite(event.alpha)) {
      this._deviceEuler.set(event.beta * DEG, event.alpha * DEG, -event.gamma * DEG, 'YXZ');
      this._deviceQuaternion.setFromEuler(this._deviceEuler).multiply(this._fixQuaternion);
      this._screenQuaternion.setFromAxisAngle(this._zee, -screenDegrees * DEG);
      this._deviceQuaternion.multiply(this._screenQuaternion);
      this._headingForward.set(0, 0, -1).applyQuaternion(this._deviceQuaternion);
      this.latestHeading = Math.atan2(this._headingForward.x, -this._headingForward.z);
      this.yawValid = Number.isFinite(this.latestHeading);
    }

    const index = this._sampleWrite;
    this._samplesPitch[index] = this.latestPitch;
    this._samplesRoll[index] = this.latestRoll;
    this._samplesHeading[index] = this.latestHeading;
    this._samplesTime[index] = this.lastSensorTime;
    this._sampleWrite = (index + 1) % SAMPLE_CAPACITY;
    this._sampleCount = Math.min(this._sampleCount + 1, SAMPLE_CAPACITY);
    if (this._waiter) this._waiter();
  }

  _onMouseMove(event) {
    this.mouseX = clamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    this.mouseY = clamp((event.clientY / window.innerHeight - 0.5) * 2, -1, 1);
    if (this.mode === 'desktop' && Math.abs(this.mouseX) < 0.12 && Math.abs(this.mouseY) < 0.12) {
      this.desktopMouseArmed = true;
    }
  }

  _onKeyDown(event) {
    if (event.code === 'KeyW' || event.code === 'ArrowUp') this.keyPitch = 1;
    if (event.code === 'KeyS' || event.code === 'ArrowDown') this.keyPitch = -1;
    if (event.code === 'KeyA' || event.code === 'ArrowLeft') this.keyRoll = -1;
    if (event.code === 'KeyD' || event.code === 'ArrowRight') this.keyRoll = 1;
    if (!event.repeat && event.code === 'KeyC') this._cameraToggle = true;
    if (!event.repeat && event.code === 'KeyR') this._respawnRequested = true;
    if (!event.repeat && event.code === 'Escape') this._escapeRequested = true;
  }

  _onKeyUp(event) {
    if (event.code === 'KeyW' || event.code === 'KeyS' || event.code === 'ArrowUp' || event.code === 'ArrowDown') this.keyPitch = 0;
    if (event.code === 'KeyA' || event.code === 'KeyD' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') this.keyRoll = 0;
  }

  _onOrientationChange() {
    this.sensorValid = false;
    this.calibrated = false;
    this._yawHold = 0;
    this._sampleCount = 0;
  }
}
