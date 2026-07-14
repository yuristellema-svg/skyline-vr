import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, clamp, damp, smoothstep } from './config.js';

const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);

export class FlightModel {
  constructor(config = CONFIG) {
    this.config = config;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.attitude = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.speed = config.physics.spawnSpeed;
    this.boostCharge = 0;
    this.boostRemaining = 0;
    this.boostJustTriggered = false;
    this.gLoad = 1;
    this.totalDistance = 0;
    this.elapsed = 0;

    this._previousVelocity = new THREE.Vector3();
    this._velocityDirection = new THREE.Vector3(0, 0, -1);
    this._nose = new THREE.Vector3(0, 0, -1);
    this._craftUp = new THREE.Vector3(0, 1, 0);
    this._craftRight = new THREE.Vector3(1, 0, 0);
    this._targetAngularVelocity = new THREE.Vector3();
    this._rotationAxis = new THREE.Vector3(1, 0, 0);
    this._alignmentAxis = new THREE.Vector3(1, 0, 0);
    this._lastAlignmentAxis = new THREE.Vector3(1, 0, 0);
    this._specificForce = new THREE.Vector3();
    this._worldDown = new THREE.Vector3(0, -1, 0);
    this._mushAxisWorld = new THREE.Vector3();
    this._mushAxisBody = new THREE.Vector3();
    this._deltaQuaternion = new THREE.Quaternion();
    this._alignmentQuaternion = new THREE.Quaternion();
    this._inverseAttitude = new THREE.Quaternion();
  }

  reset(x = 0, y = 760, z = 420, speed = this.config.physics.spawnSpeed) {
    this.position.set(x, y, z);
    this.attitude.identity();
    this.angularVelocity.set(0, 0, 0);
    this.speed = speed;
    this.velocity.set(0, 0, -speed);
    this.boostCharge = 0;
    this.boostRemaining = 0;
    this.boostJustTriggered = false;
    this.gLoad = 1;
    this.totalDistance = 0;
    this.elapsed = 0;
    this._velocityDirection.set(0, 0, -1);
    this._lastAlignmentAxis.set(1, 0, 0);
  }

  step(dt, controls) {
    const physics = this.config.physics;
    this.elapsed += dt;
    this.boostJustTriggered = false;
    this._previousVelocity.copy(this.velocity);

    this._nose.copy(LOCAL_FORWARD).applyQuaternion(this.attitude).normalize();
    this._targetAngularVelocity.set(controls.pitchRate, 0, -controls.rollRate);
    const mush = smoothstep(physics.mushSpeed, physics.minimumSpeed, this.speed);
    if (mush > 0) {
      this._mushAxisWorld.crossVectors(this._nose, this._worldDown);
      if (this._mushAxisWorld.lengthSq() > 1e-10) {
        this._mushAxisWorld.normalize();
        this._inverseAttitude.copy(this.attitude).conjugate();
        this._mushAxisBody.copy(this._mushAxisWorld).applyQuaternion(this._inverseAttitude).normalize();
        this._targetAngularVelocity.addScaledVector(this._mushAxisBody, physics.lowSpeedMushRate * mush);
      }
    }
    const responseX = this._targetAngularVelocity.x === 0 ? physics.angularRelease : physics.angularResponse;
    const responseY = this._targetAngularVelocity.y === 0 ? physics.angularRelease : physics.angularResponse;
    const responseZ = this._targetAngularVelocity.z === 0 ? physics.angularRelease : physics.angularResponse;
    this.angularVelocity.x = damp(this.angularVelocity.x, this._targetAngularVelocity.x, responseX, dt);
    this.angularVelocity.y = damp(this.angularVelocity.y, this._targetAngularVelocity.y, responseY, dt);
    this.angularVelocity.z = damp(this.angularVelocity.z, this._targetAngularVelocity.z, responseZ, dt);

    const rotationMagnitude = this.angularVelocity.length();
    if (rotationMagnitude > 1e-8) {
      this._rotationAxis.copy(this.angularVelocity).multiplyScalar(1 / rotationMagnitude);
      this._deltaQuaternion.setFromAxisAngle(this._rotationAxis, rotationMagnitude * dt);
      this.attitude.multiply(this._deltaQuaternion).normalize();
    }

    this._nose.copy(LOCAL_FORWARD).applyQuaternion(this.attitude).normalize();
    this._craftUp.copy(LOCAL_UP).applyQuaternion(this.attitude).normalize();
    this._craftRight.copy(LOCAL_RIGHT).applyQuaternion(this.attitude).normalize();
    this._velocityDirection.copy(this.velocity);
    if (this._velocityDirection.lengthSq() < 1e-8) this._velocityDirection.copy(this._nose);
    else this._velocityDirection.normalize();

    const dot = clamp(this._velocityDirection.dot(this._nose), -1, 1);
    if (dot < 0.999999) {
      this._alignmentAxis.crossVectors(this._velocityDirection, this._nose);
      if (this._alignmentAxis.lengthSq() < 1e-10) {
        this._alignmentAxis.copy(this._craftRight);
        this._alignmentAxis.addScaledVector(this._velocityDirection, -this._alignmentAxis.dot(this._velocityDirection));
        if (this._alignmentAxis.lengthSq() < 1e-10) this._alignmentAxis.copy(this._lastAlignmentAxis);
      }
      this._alignmentAxis.normalize();
      if (this._alignmentAxis.dot(this._lastAlignmentAxis) < 0) this._alignmentAxis.negate();
      this._lastAlignmentAxis.copy(this._alignmentAxis);
      const speedFactor = smoothstep(physics.mushSpeed, physics.alignmentHighSpeed, this.speed);
      const alignmentRate = THREE.MathUtils.lerp(
        physics.velocityAlignmentLow,
        physics.velocityAlignmentHigh,
        speedFactor
      );
      const fraction = 1 - Math.exp(-alignmentRate * dt);
      this._alignmentQuaternion.setFromAxisAngle(this._alignmentAxis, Math.acos(dot) * fraction);
      this._velocityDirection.applyQuaternion(this._alignmentQuaternion).normalize();
    }

    const climbGravityScale = this._velocityDirection.y > 0 ? 1 - physics.climbEnergyRefund : 1;
    const gravityAlongPath = -physics.gravity * this._velocityDirection.y * climbGravityScale;
    const excess = Math.max(0, this.speed - physics.quadraticDragStart);
    const drag = physics.linearDrag * this.speed + physics.quadraticDrag * excess * excess;

    const committedDive = -this._velocityDirection.y > Math.sin(physics.boostCommittedDive);
    if (this.speed > physics.boostChargeSpeed && committedDive) {
      this.boostCharge = clamp(this.boostCharge + dt / physics.boostChargeSeconds, 0, 1);
    }

    if (
      this.boostCharge >= 0.999 &&
      this.boostRemaining <= 0 &&
      controls.pitchRate > physics.boostTriggerPitchRate &&
      this._nose.y < 0
    ) {
      this.boostCharge = 0;
      this.boostRemaining = physics.boostDuration;
      this.boostJustTriggered = true;
    }

    let boostAcceleration = 0;
    if (this.boostRemaining > 0) {
      boostAcceleration = physics.boostDeltaSpeed / physics.boostDuration;
      this.boostRemaining = Math.max(0, this.boostRemaining - dt);
    }

    this.speed = Math.max(
      physics.minimumSpeed,
      this.speed + (gravityAlongPath - drag + boostAcceleration) * dt
    );
    this.velocity.copy(this._velocityDirection).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    this.totalDistance += this.speed * dt;

    this._specificForce.copy(this.velocity).sub(this._previousVelocity).multiplyScalar(1 / dt);
    this._specificForce.y += physics.gravity;
    const rawG = this._specificForce.dot(this._craftUp) / physics.gravity;
    this.gLoad = damp(this.gLoad, rawG, 6.7, dt);
  }

  getForward(target) {
    return target.copy(LOCAL_FORWARD).applyQuaternion(this.attitude).normalize();
  }

  getUp(target) {
    return target.copy(LOCAL_UP).applyQuaternion(this.attitude).normalize();
  }

  getRight(target) {
    return target.copy(LOCAL_RIGHT).applyQuaternion(this.attitude).normalize();
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get boosting() {
    return this.boostRemaining > 0;
  }
}
