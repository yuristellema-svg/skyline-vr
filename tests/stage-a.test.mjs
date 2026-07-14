import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, DEG, rateFromDeflection } from '../src/config.js';
import { screenTilt } from '../src/input.js';
import { FlightModel } from '../src/flightModel.js';
import { CollisionSystem } from '../src/collision.js';

const ZERO = { pitchRate: 0, rollRate: 0 };

function stepFor(model, seconds, controls = ZERO) {
  const count = Math.round(seconds / CONFIG.physics.fixedStep);
  for (let i = 0; i < count; i += 1) model.step(CONFIG.physics.fixedStep, controls);
}

test('locked rate curve has dead zones, exponent and full rates', () => {
  const c = CONFIG.controls;
  assert.equal(rateFromDeflection(3 * DEG, c.pitchDeadzone, c.pitchFullDeflection, c.pitchMaxRate), 0);
  assert.equal(rateFromDeflection(-3 * DEG, c.rollDeadzone, c.rollFullDeflection, c.rollMaxRate), 0);
  assert.ok(Math.abs(rateFromDeflection(25 * DEG, c.pitchDeadzone, c.pitchFullDeflection, c.pitchMaxRate) - 110 * DEG) < 1e-12);
  assert.ok(Math.abs(rateFromDeflection(-30 * DEG, c.rollDeadzone, c.rollFullDeflection, c.rollMaxRate) + 160 * DEG) < 1e-12);
  const half = c.pitchDeadzone + (c.pitchFullDeflection - c.pitchDeadzone) * 0.5;
  const expected = c.pitchMaxRate * Math.pow(0.5, 1.6);
  assert.ok(Math.abs(rateFromDeflection(half, c.pitchDeadzone, c.pitchFullDeflection, c.pitchMaxRate) - expected) < 1e-12);
});

test('screen-corrected gravity tilt has canonical neutral poses', () => {
  const out = { pitch: 0, roll: 0 };
  screenTilt(90, 0, 0, out);
  assert.ok(Math.abs(out.pitch) < 1e-9 && Math.abs(out.roll) < 1e-9);
  screenTilt(0, -90, 90, out);
  assert.ok(Math.abs(out.pitch) < 1e-9 && Math.abs(out.roll) < 1e-9);
  screenTilt(0, 90, 270, out);
  assert.ok(Math.abs(out.pitch) < 1e-9 && Math.abs(out.roll) < 1e-9);
});

test('quaternion flight crosses vertical and completes repeated pitch rotations without clamps', () => {
  const model = new FlightModel();
  model.reset(0, 5000, 0, 80);
  const controls = { pitchRate: CONFIG.controls.pitchMaxRate, rollRate: 0 };
  let sawVertical = false;
  let sawInverted = false;
  const forward = new THREE.Vector3();
  for (let i = 0; i < 720; i += 1) {
    model.step(CONFIG.physics.fixedStep, controls);
    model.getForward(forward);
    if (forward.y > 0.98 || forward.y < -0.98) sawVertical = true;
    const up = model.getUp(new THREE.Vector3());
    if (up.y < -0.95) sawInverted = true;
    assert.ok(Math.abs(model.attitude.length() - 1) < 1e-9);
  }
  assert.ok(sawVertical, 'must pass through vertical');
  assert.ok(sawInverted, 'must pass through inverted');
  assert.ok(Number.isFinite(model.position.x + model.position.y + model.position.z));
});

test('full roll and inverted neutral hold preserve attitude', () => {
  const model = new FlightModel();
  model.reset(0, 5000, 0, 70);
  stepFor(model, 1.15, { pitchRate: 0, rollRate: CONFIG.controls.rollMaxRate });
  stepFor(model, 1.2, ZERO);
  const held = model.attitude.clone();
  stepFor(model, 5, ZERO);
  assert.ok(1 - Math.abs(held.dot(model.attitude)) < 1e-5);
  assert.ok(Math.abs(model.attitude.length() - 1) < 1e-9);
});

test('vertical dive exceeds 400 km/h and settles near 130 m/s without a hard speed cap', () => {
  const model = new FlightModel();
  model.reset(0, 100000, 0, 62);
  model.attitude.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI * 0.5);
  model.velocity.set(0, -62, 0);
  stepFor(model, 35, ZERO);
  assert.ok(model.speed > 111.111, `expected >400 km/h, got ${model.speed * 3.6}`);
  stepFor(model, 90, ZERO);
  assert.ok(model.speed > 127 && model.speed < 133, `terminal ${model.speed}`);
});

test('speed floor and climb energy refund remain active', () => {
  const model = new FlightModel();
  model.reset(0, 1000, 0, 15);
  model.velocity.set(0, 15, 0);
  model.attitude.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 0.5);
  stepFor(model, 5, ZERO);
  assert.ok(model.speed >= 15);
  const expectedGravityLoss = CONFIG.physics.gravity * (1 - CONFIG.physics.climbEnergyRefund);
  assert.ok(Math.abs(expectedGravityLoss - 8.6328) < 1e-12);
});

test('committed dive charges boost in four seconds and hard pull triggers once', () => {
  const model = new FlightModel();
  model.reset(0, 5000, 0, 90);
  model.attitude.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -45 * DEG);
  model.velocity.set(0, -Math.sin(45 * DEG) * 90, -Math.cos(45 * DEG) * 90);
  stepFor(model, 4.05, ZERO);
  assert.ok(model.boostCharge >= 0.999, `charge ${model.boostCharge}`);
  const pull = { pitchRate: CONFIG.controls.pitchMaxRate, rollRate: 0 };
  let triggers = 0;
  for (let i = 0; i < 240; i += 1) {
    model.step(CONFIG.physics.fixedStep, pull);
    if (model.boostJustTriggered) triggers += 1;
  }
  assert.equal(triggers, 1);
  assert.ok(model.boostRemaining > 1);
});

test('test bridge opening is passable while its stone is solid', () => {
  const collision = new CollisionSystem(() => 0, 1.25);
  collision.addArchBridge({ z: -100, depth: 18, halfSpan: 62, bottom: 0, deckTop: 26, halfOpening: 19, openingHeight: 22 });
  assert.equal(collision.check(new THREE.Vector3(0, 10, -100)), false);
  assert.equal(collision.check(new THREE.Vector3(17.5, 10, -100)), true);
  assert.equal(collision.check(new THREE.Vector3(0, 24.5, -100)), true);
  assert.equal(collision.check(new THREE.Vector3(0, 1.1, 0)), true);
});

test('fixed-step schedules produce identical flight state', () => {
  const simulate = schedule => {
    const model = new FlightModel();
    model.reset(0, 5000, 0, 70);
    let accumulator = 0;
    let steps = 0;
    for (let i = 0; steps < 1200; i += 1) {
      accumulator += schedule[i % schedule.length];
      while (accumulator + 1e-12 >= CONFIG.physics.fixedStep && steps < 1200) {
        model.step(CONFIG.physics.fixedStep, { pitchRate: 42 * DEG, rollRate: 35 * DEG });
        accumulator -= CONFIG.physics.fixedStep;
        steps += 1;
      }
    }
    return model;
  };
  const a = simulate([1 / 60]);
  const b = simulate([1 / 30]);
  const c = simulate([1 / 120, 1 / 48, 1 / 75]);
  assert.ok(a.position.distanceTo(b.position) < 1e-9);
  assert.ok(a.position.distanceTo(c.position) < 1e-9);
  assert.ok(1 - Math.abs(a.attitude.dot(c.attitude)) < 1e-12);
});
