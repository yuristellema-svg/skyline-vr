import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, DEG, wrapPi } from './config.js';

const PANEL_LAYOUT = [
  ['RESUME', 'resume', -20, 10],
  ['RECENTER', 'recenter', 0, 10],
  ['CAMERA', 'camera', 20, 10],
  ['RESPAWN', 'respawn', -27, -9],
  ['SENSITIVITY', 'sensitivity', -9, -9],
  ['EFFECTS', 'effects', 9, -9],
  ['RESTART WORLD', 'restart', 27, -9],
];

export class GazeMenu {
  constructor(uiScene, input, callbacks, config = CONFIG) {
    this.config = config;
    this.input = input;
    this.callbacks = callbacks;
    this.root = new THREE.Group();
    this.root.name = 'Stereo gaze menu at 2.5 metres';
    this.root.visible = false;
    uiScene.add(this.root);
    this.panels = [];
    this.isOpen = false;
    this.crashMode = false;
    this.targetIndex = -1;
    this.latchedIndex = -1;
    this.dwellTime = 0;
    this.exitTime = 0;
    this.entryGrace = 0;
    this.dwellProgress = 0;
    this.cameraName = 'FIRST';
    this.effectsName = 'FULL';
    this._buildPanels();
  }

  _buildPanels() {
    const depth = this.config.menu.depth;
    for (let i = 0; i < PANEL_LAYOUT.length; i += 1) {
      const spec = PANEL_LAYOUT[i];
      const yaw = spec[2] * DEG;
      const pitch = spec[3] * DEG;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.34), material);
      const cosPitch = Math.cos(pitch);
      mesh.position.set(
        Math.sin(yaw) * cosPitch * depth,
        Math.sin(pitch) * depth,
        -Math.cos(yaw) * cosPitch * depth
      );
      mesh.lookAt(0, 0, 0);
      mesh.renderOrder = 9000;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.panels.push({
        label: spec[0],
        action: spec[1],
        yaw,
        pitch,
        canvas,
        texture,
        material,
        mesh,
      });
      this._drawPanel(i, false);
    }
  }

  open(position, quaternion, crashMode = false) {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    this.root.visible = true;
    this.isOpen = true;
    this.crashMode = crashMode;
    this.targetIndex = -1;
    this.latchedIndex = -1;
    this.dwellTime = 0;
    this.exitTime = 0;
    this.entryGrace = 0.4;
    this.dwellProgress = 0;
    this.input.beginMenuLook();
    for (let i = 0; i < this.panels.length; i += 1) this._drawPanel(i, false);
  }

  close() {
    this.root.visible = false;
    this.isOpen = false;
    this.crashMode = false;
    this.targetIndex = -1;
    this.latchedIndex = -1;
    this.dwellTime = 0;
    this.dwellProgress = 0;
  }

  reanchor(position, quaternion) {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
  }

  update(dt) {
    if (!this.isOpen) {
      this.dwellProgress = 0;
      return;
    }
    this.input.sampleMenuLook();
    if (this.entryGrace > 0) {
      this.entryGrace = Math.max(0, this.entryGrace - dt);
      this._setTarget(-1);
      return;
    }

    let target = -1;
    for (let i = 0; i < this.panels.length; i += 1) {
      if (this.crashMode && this.panels[i].action === 'resume') continue;
      const yawDelta = Math.abs(wrapPi(this.input.menuLook.yaw - this.panels[i].yaw));
      const pitchDelta = Math.abs(this.input.menuLook.pitch - this.panels[i].pitch);
      if (
        yawDelta <= this.config.menu.panelHitHalfAngle &&
        pitchDelta <= this.config.menu.panelPitchHalfAngle
      ) {
        target = i;
        break;
      }
    }

    if (this.latchedIndex >= 0) {
      if (target === this.latchedIndex) this.exitTime = 0;
      else {
        this.exitTime += dt;
        if (this.exitTime >= 0.3) {
          this.latchedIndex = -1;
          this.exitTime = 0;
        }
      }
      this._setTarget(target);
      this.dwellProgress = 0;
      return;
    }

    if (target !== this.targetIndex) {
      this.dwellTime = 0;
      this._setTarget(target);
    } else if (target >= 0) {
      this.dwellTime += dt;
    }
    this.dwellProgress = target >= 0 ? Math.min(1, this.dwellTime / this.config.menu.dwellSeconds) : 0;
    if (target >= 0 && this.dwellTime >= this.config.menu.dwellSeconds) {
      this.latchedIndex = target;
      this.dwellTime = 0;
      this.dwellProgress = 0;
      this._activate(target);
    }
  }

  _setTarget(index) {
    if (index === this.targetIndex) return;
    const previous = this.targetIndex;
    this.targetIndex = index;
    if (previous >= 0) this._drawPanel(previous, false);
    if (index >= 0) this._drawPanel(index, true);
  }

  _activate(index) {
    const action = this.panels[index].action;
    if (action === 'resume') this.callbacks.resume();
    else if (action === 'recenter') {
      this.input.recenter();
      this.input.beginMenuLook();
      this.callbacks.recenter();
    } else if (action === 'camera') {
      this.cameraName = this.callbacks.camera().toUpperCase();
      this._drawPanel(index, true);
    } else if (action === 'respawn') this.callbacks.respawn();
    else if (action === 'sensitivity') {
      this.input.cycleSensitivity();
      this._drawPanel(index, true);
    } else if (action === 'effects') {
      this.effectsName = this.callbacks.effects();
      this._drawPanel(index, true);
    } else if (action === 'restart') this.callbacks.restart();
  }

  _drawPanel(index, active) {
    const panel = this.panels[index];
    const context = panel.canvas.getContext('2d');
    context.clearRect(0, 0, panel.canvas.width, panel.canvas.height);
    const disabled = this.crashMode && panel.action === 'resume';
    context.fillStyle = disabled ? 'rgba(24,32,35,0.72)' : active ? 'rgba(237,164,78,0.96)' : 'rgba(13,31,39,0.92)';
    context.strokeStyle = active ? '#fff4dc' : 'rgba(195,225,231,0.62)';
    context.lineWidth = active ? 10 : 5;
    context.beginPath();
    context.roundRect(8, 8, 496, 240, 38);
    context.fill();
    context.stroke();
    context.fillStyle = disabled ? 'rgba(255,255,255,0.28)' : active ? '#15272d' : '#fff7e8';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '800 38px system-ui, sans-serif';
    let title = panel.label;
    let value = '';
    if (panel.action === 'resume' && disabled) title = 'RESPAWNING';
    if (panel.action === 'camera') value = this.cameraName;
    if (panel.action === 'sensitivity') value = this.input.sensitivityName;
    if (panel.action === 'effects') value = this.effectsName;
    context.fillText(title, 256, value ? 100 : 128);
    if (value) {
      context.font = '700 30px system-ui, sans-serif';
      context.fillText(value, 256, 158);
    }
    panel.texture.needsUpdate = true;
    panel.mesh.scale.setScalar(active ? 1.06 : 1);
  }
}
