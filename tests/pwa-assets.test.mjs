import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest and iPhone standalone assets are valid', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'landscape');
  assert.equal(manifest.id, './');
  const touch = manifest.icons.find(icon => icon.sizes === '180x180' && icon.type === 'image/png');
  assert.ok(touch);
  assert.ok(fs.existsSync(path.join(root, touch.src.replace('./', ''))));
});

test('service worker precaches every runtime module and asset', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const required = [
    'index.html', 'styles.css', 'bundle.js', 'manifest.webmanifest', 'apple-touch-icon.png',
    'vendor/three.module.min.js', 'src/main.js', 'src/config.js', 'src/input.js',
    'src/flightModel.js', 'src/collision.js', 'src/camera.js', 'src/effects.js',
    'src/stereo.js', 'src/menu.js', 'src/hud.js', 'src/world/testBox.js',
  ];
  for (const asset of required) assert.match(sw, new RegExp(asset.replaceAll('.', '\\.')));
});

test('all local module imports resolve', () => {
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  files.push(path.join(root, 'bundle.js'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1] || match[2];
      if (!specifier.startsWith('.')) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), specifier)), `${file}: ${specifier}`);
    }
  }
});

test('manual world, UI and overlay rendering does not clear between passes', () => {
  const stereo = fs.readFileSync(path.join(root, 'src', 'stereo.js'), 'utf8');
  assert.match(stereo, /renderer\.autoClear\s*=\s*false/);
  assert.match(stereo, /renderer\.clearDepth\(\)[\s\S]*renderer\.render\(this\.uiScene/);
  assert.match(stereo, /renderer\.clearDepth\(\)[\s\S]*renderer\.render\(this\.overlayScene/);
});
