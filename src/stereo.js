import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';

export class StereoRenderer {
  constructor(canvas, config = CONFIG) {
    this.config = config;
    this.stereoEnabled = false;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    // The world, stereo-space UI and comfort overlay are composited manually.
    // Leaving Three's automatic clear enabled erases the preceding pass.
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(config.stereo.pixelRatio);
    this.renderer.setClearColor(0x9bb7bd, 1);
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(
      config.camera.stereoFov,
      1,
      config.camera.near,
      config.camera.far
    );
    this.camera.focus = config.menu.depth;
    this.stereoCamera = new THREE.StereoCamera();
    this.stereoCamera.eyeSep = config.stereo.eyeSeparation;
    this.stereoCamera.aspect = 0.5;

    this.uiScene = new THREE.Scene();
    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._reticleOffset = new THREE.Vector3(0, 0, -config.menu.depth);
    this._reticleWorldOffset = new THREE.Vector3();
    this.reticle = this._buildReticle();
    this.uiScene.add(this.reticle);
    this.overlay = this._buildOverlay();
    this.overlayScene.add(this.overlay);
    this.metrics = { calls: 0, triangles: 0, points: 0, lines: 0 };
    this.resize();
  }

  _buildReticle() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uDwell: { value: 0 },
        uBoost: { value: 0 },
        uVisible: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uDwell;
        uniform float uBoost;
        uniform float uVisible;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p);
          float angle = mod(atan(p.y, p.x) + 1.5707963 + 6.2831853, 6.2831853) / 6.2831853;
          float dotAlpha = 1.0 - smoothstep(0.045, 0.075, r);
          float dwellRing = (1.0 - smoothstep(0.012, 0.022, abs(r - 0.245))) * step(angle, uDwell);
          float boostArc = (1.0 - smoothstep(0.010, 0.021, abs(r - 0.39))) * step(angle, uBoost);
          vec3 color = vec3(0.97, 0.98, 0.92) * dotAlpha;
          color += vec3(0.96, 0.66, 0.26) * dwellRing;
          color += vec3(0.35, 0.85, 1.0) * boostArc;
          float alpha = max(dotAlpha, max(dwellRing, boostArc)) * uVisible;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), material);
    reticle.frustumCulled = false;
    reticle.renderOrder = 10000;
    reticle.name = 'Stereo convergence reticle at 2.5 metres';
    return reticle;
  }

  _buildOverlay() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uVignette: { value: 0 },
        uRed: { value: 0 },
        uFadeWhite: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uVignette;
        uniform float uRed;
        uniform float uFadeWhite;
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - 0.5) * 2.0;
          float edge = smoothstep(0.70 - uVignette * 0.04, 1.04, length(d));
          vec3 tint = mix(vec3(0.0), vec3(0.34, 0.0, 0.0), clamp(uRed * 4.0, 0.0, 1.0));
          float tintAlpha = max(edge * uVignette, uRed);
          vec3 color = mix(tint, vec3(1.0), uFadeWhite);
          float alpha = max(tintAlpha, uFadeWhite);
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    quad.renderOrder = 20000;
    return quad;
  }

  setStereo(enabled) {
    this.stereoEnabled = Boolean(enabled);
    document.body.classList.toggle('stereo', this.stereoEnabled);
    this.resize();
  }

  setReticle(boostCharge, dwellProgress, visible = true) {
    this.reticle.material.uniforms.uBoost.value = boostCharge;
    this.reticle.material.uniforms.uDwell.value = dwellProgress;
    this.reticle.material.uniforms.uVisible.value = visible ? 1 : 0;
  }

  setOverlay(vignette, redTint, fadeWhite) {
    this.overlay.material.uniforms.uVignette.value = vignette;
    this.overlay.material.uniforms.uRed.value = redTint;
    this.overlay.material.uniforms.uFadeWhite.value = fadeWhite;
  }

  resize() {
    const width = Math.max(2, Math.floor(window.innerWidth / 2) * 2);
    const height = Math.max(2, Math.floor(window.innerHeight));
    this.renderer.setPixelRatio(this.config.stereo.pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(worldScene) {
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._reticleWorldOffset.copy(this._reticleOffset).applyQuaternion(this.camera.quaternion);
    this.reticle.position.copy(this.camera.position).add(this._reticleWorldOffset);
    this.reticle.quaternion.copy(this.camera.quaternion);
    this.reticle.updateMatrixWorld(true);

    this.renderer.info.reset();
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.clear();
    if (!this.stereoEnabled) {
      this._renderEye(worldScene, this.camera, 0, 0, width, height);
    } else {
      const half = Math.floor(width / 2);
      this.stereoCamera.eyeSep = this.config.stereo.eyeSeparation;
      this.stereoCamera.aspect = 0.5;
      this.stereoCamera.update(this.camera);
      this.renderer.setScissorTest(true);
      this._renderEye(worldScene, this.stereoCamera.cameraL, 0, 0, half, height);
      this._renderEye(worldScene, this.stereoCamera.cameraR, half, 0, width - half, height);
      this.renderer.setScissorTest(false);
    }
    const info = this.renderer.info.render;
    this.metrics.calls = info.calls;
    this.metrics.triangles = info.triangles;
    this.metrics.points = info.points;
    this.metrics.lines = info.lines;
  }

  _renderEye(worldScene, eyeCamera, x, y, width, height) {
    this.renderer.setViewport(x, y, width, height);
    this.renderer.setScissor(x, y, width, height);
    this.renderer.render(worldScene, eyeCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.uiScene, eyeCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.overlayCamera);
  }
}
