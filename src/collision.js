import { CONFIG } from './config.js';

export class CollisionSystem {
  constructor(heightSampler = () => 0, radius = CONFIG.collision.playerRadius) {
    this.heightSampler = heightSampler;
    this.radius = radius;
    this.boxes = [];
    this.arches = [];
    this.lastReason = '';
  }

  addBox(minX, maxX, minY, maxY, minZ, maxZ, label = 'Obstacle') {
    this.boxes.push({ minX, maxX, minY, maxY, minZ, maxZ, label });
  }

  addArchBridge({ z, depth, halfSpan, bottom, deckTop, halfOpening, openingHeight, label = 'Bridge' }) {
    this.arches.push({
      z,
      minZ: z - depth * 0.5,
      maxZ: z + depth * 0.5,
      halfSpan,
      bottom,
      deckTop,
      halfOpening,
      openingHeight,
      label,
    });
  }

  clear() {
    this.boxes.length = 0;
    this.arches.length = 0;
  }

  check(position) {
    const r = this.radius;
    if (position.y - r <= this.heightSampler(position.x, position.z)) {
      this.lastReason = 'Terrain';
      return true;
    }

    for (let i = 0; i < this.boxes.length; i += 1) {
      const box = this.boxes[i];
      if (
        position.x + r >= box.minX && position.x - r <= box.maxX &&
        position.y + r >= box.minY && position.y - r <= box.maxY &&
        position.z + r >= box.minZ && position.z - r <= box.maxZ
      ) {
        this.lastReason = box.label;
        return true;
      }
    }

    for (let i = 0; i < this.arches.length; i += 1) {
      const arch = this.arches[i];
      if (
        position.z + r < arch.minZ || position.z - r > arch.maxZ ||
        position.x + r < -arch.halfSpan || position.x - r > arch.halfSpan ||
        position.y + r < arch.bottom || position.y - r > arch.deckTop
      ) continue;

      const minX = position.x - r;
      const maxX = position.x + r;
      const widestX = Math.max(Math.abs(minX), Math.abs(maxX));
      const insideWidth = minX > -arch.halfOpening && maxX < arch.halfOpening;
      const roof = insideWidth
        ? arch.openingHeight * Math.sqrt(Math.max(0, 1 - (widestX / arch.halfOpening) ** 2))
        : -Infinity;
      const insideOpening = insideWidth && position.y - r > arch.bottom && position.y + r < roof;
      if (!insideOpening) {
        this.lastReason = arch.label;
        return true;
      }
    }

    this.lastReason = '';
    return false;
  }
}
