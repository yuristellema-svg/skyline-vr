# Skyline VR — Iteration 2

This is the Fable-locked Stage A + Stage B replacement build. It removes the old corridor flight model and ships unrestricted quaternion flight, dive acceleration, dive-charged boost, first/third-person cameras, a stereo reticle, the seven-action gaze menu, crash recovery, and the iPhone Home Screen install flow.

Stage C (the streamed 12 km world, biomes, city, water, and multiple bridges) is intentionally not included yet. Fable locked that work behind Yuri approving Stage A flight feel on an actual iPhone.

## Play

- Desktop: choose **Desktop flight test**. Move the pointer to the centre once, then steer with the mouse or W/S/A/D. Press C for camera, Esc for menu, and R to respawn.
- iPhone: open the HTTPS GitHub Pages link in Safari, add it to the Home Screen for genuine fullscreen, launch the icon in landscape, choose **Start phone VR**, allow motion access, and look straight ahead for calibration.
- Flight: dive to accelerate. A committed dive above 80 m/s fills the reticle's blue boost arc. With it full, pull up hard while still nose-down to fire the boost.

## GitHub Pages upload

Upload the **contents of this folder**, preserving `src/`, `vendor/`, `tests/`, and `tools/`. Do not upload only the ZIP: GitHub Pages cannot run a game from inside a ZIP.

For the first Iteration 2 deployment, replace the old root game files with this full folder. In GitHub: **Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save**.

After that, updates are modular. Upload only the changed paths Codex names (for example `src/config.js` for feel tuning), plus `sw.js` whenever its cache version changes.

## Verification

Run `npm test` for the deterministic physics, collision, PWA, import, and render-pass checks. Run `npm run serve` for a local desktop test.

The detailed acceptance checklist is in [TESTING.md](./TESTING.md). Current feel values and owner decisions are in [FEEL.md](./FEEL.md).

