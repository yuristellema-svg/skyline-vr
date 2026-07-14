# Skyline VR — Fable Iteration 1

A first-person, browser-based wingsuit flying sandbox built for an iPhone 14 in a phone VR holder.

## This build

- First-person only, with fixed wingtips as a stable visual reference
- Head pitch controls dive/climb; head roll controls bank; head yaw is ignored
- Alpha-free iPhone tracking using only beta/gamma tilt data
- 5° pitch and 4° roll dead zones, tap-anywhere recenter, and automatic respawn recenter
- Assisted energy model: 110 km/h spawn, roughly 100 km/h cruise, 60 km/h floor, 220 km/h ceiling
- One 4 km × 600 m valley with a 30 m river, two stone bridges, and a looping updraft
- Water, terrain, valley-wall, and bridge collision
- 0.3 s white impact fade, 1 s hold, and 3 s mirrored-eye respawn countdown
- Manual off-axis side-by-side stereo with 64 mm eye separation
- Dynamic per-eye comfort vignette above 160 km/h
- Fixed 1× pixel ratio, no shadows, instanced scenery, and 120 Hz fixed-step physics
- Network-first service worker so future GitHub uploads replace the old build

## Upload to GitHub

Upload **everything inside this folder** to the root of `yuristellema-svg/skyline-vr`, including the `vendor` folder. Existing files with the same names should be replaced.

GitHub Pages remains configured as:

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/(root)`

The permanent game address is:

`https://yuristellema-svg.github.io/skyline-vr/?v=fable-1.0.0`

The version query ensures the first load bypasses the previous prototype's old cache. Later builds use a network-first update strategy.

## Controls

Phone VR:

- Look down: dive and gain speed
- Look up: climb and lose speed
- Tilt head right/left: bank and turn
- Tap anywhere during flight: recenter

Desktop preview:

- Mouse up/down: climb/dive
- Mouse left/right: bank
- W/S: climb/dive
- A/D: bank
- R: test the crash/respawn sequence

## Honest test boundary

The build can be structurally and visually checked on desktop. Sustained stereo 60 fps, sensor direction, headset access to tap, and ten-minute comfort must be verified on the actual iPhone 14 and headset. Test with Low Power Mode disabled and begin with a short session.
