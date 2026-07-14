export const DEG = Math.PI / 180;

export const CONFIG = Object.freeze({
  version: 'fable-iteration-2-stage-ab-1.0.0',
  physics: Object.freeze({
    fixedStep: 1 / 120,
    maxSubSteps: 8,
    gravity: 9.81,
    spawnSpeed: 62,
    minimumSpeed: 15,
    mushSpeed: 20,
    velocityAlignmentLow: 2.2,
    velocityAlignmentHigh: 3.2,
    alignmentHighSpeed: 130,
    linearDrag: 0.008,
    quadraticDragStart: 90,
    quadraticDrag: 0.00548125,
    climbEnergyRefund: 0.12,
    lowSpeedMushRate: 18 * DEG,
    angularResponse: 14,
    angularRelease: 18,
    boostChargeSpeed: 80,
    boostCommittedDive: 20 * DEG,
    boostChargeSeconds: 4,
    boostTriggerPitchRate: 60 * DEG,
    boostDuration: 3,
    boostDeltaSpeed: 25,
  }),
  controls: Object.freeze({
    pitchDeadzone: 3 * DEG,
    rollDeadzone: 3 * DEG,
    pitchFullDeflection: 25 * DEG,
    rollFullDeflection: 30 * DEG,
    pitchMaxRate: 110 * DEG,
    rollMaxRate: 160 * DEG,
    responseExponent: 1.6,
    yawMenuThreshold: 45 * DEG,
    yawMenuHold: 1,
    sensorStaleAfter: 0.8,
  }),
  sensitivity: Object.freeze({
    presets: Object.freeze([
      Object.freeze({ name: 'CALM', multiplier: 0.78 }),
      Object.freeze({ name: 'STANDARD', multiplier: 1 }),
      Object.freeze({ name: 'AGILE', multiplier: 1.22 }),
    ]),
    defaultIndex: 1,
  }),
  camera: Object.freeze({
    firstPersonHead: Object.freeze([0, 0.62, -0.18]),
    monoBaseFov: 80,
    monoSpeedFov: 12,
    stereoFov: 80,
    fovSpeedStart: 60,
    fovSpeedFull: 130,
    thirdBack: 11,
    thirdUp: 3.5,
    thirdPullback: 2,
    thirdPositionResponse: 12,
    thirdRollLagSeconds: 0.08,
    thirdMaxRollLag: 10 * DEG,
    rollLagResponse: 14,
    near: 0.08,
    far: 1800,
  }),
  effects: Object.freeze({
    streakCount: 180,
    streakStartSpeed: 60,
    streakFullSpeed: 130,
    streakDepth: 52,
    streakRadius: 9,
    boostIntensity: 1.45,
    gVignetteStart: 4,
    gVignetteFull: 7,
    maxViewSqueeze: 0.02,
    maxVrShake: 0.2 * DEG,
    negativeGTintStart: -0.35,
  }),
  menu: Object.freeze({
    depth: 2.5,
    dwellSeconds: 1,
    panelYawStep: 12 * DEG,
    panelHitHalfAngle: 5.5 * DEG,
    panelPitchHalfAngle: 4.8 * DEG,
  }),
  stereo: Object.freeze({
    eyeSeparation: 0.064,
    pixelRatio: 1,
  }),
  collision: Object.freeze({
    playerRadius: 1.25,
  }),
  testBox: Object.freeze({
    spawn: Object.freeze([0, 760, 420]),
    planeSize: 12000,
    bridgeZ: -900,
    fogNear: 900,
    fogFar: 1600,
  }),
  performance: Object.freeze({
    maxDrawCalls: 300,
    maxVisibleTriangles: 400000,
  }),
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function damp(current, target, response, dt) {
  return target + (current - target) * Math.exp(-response * dt);
}

export function wrapPi(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function rateFromDeflection(deflection, deadzone, fullDeflection, maxRate, exponent = 1.6) {
  const magnitude = Math.abs(deflection);
  if (magnitude <= deadzone) return 0;
  const normalized = clamp((magnitude - deadzone) / (fullDeflection - deadzone), 0, 1);
  return Math.sign(deflection) * maxRate * Math.pow(normalized, exponent);
}
