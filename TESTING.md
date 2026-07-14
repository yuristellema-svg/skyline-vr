# Iteration 1 test card

## Desktop smoke test

1. Open the published GitHub Pages URL.
2. Choose **Desktop preview**.
3. Confirm there is no HUD or chase-camera option.
4. Move the mouse up/down and left/right; the rigid first-person camera and wingtips must follow the aircraft without camera lag.
5. Press **R**; confirm white fade (0.3 s), white hold (1 s), mirrored countdown (3 s), and restart at the ledge.
6. Fly into terrain, river, and bridge stone; each must trigger the same restart.

## iPhone 14 headset acceptance test

1. Disable Low Power Mode. Open Safari in landscape.
2. Open `https://yuristellema-svg.github.io/skyline-vr/?v=fable-1.0.0`.
3. Tap **Start phone VR** and allow motion access.
4. Hold your head level for the three-second calibration.
5. Confirm two equal stereo eyes and fixed wingtips.
6. Look down to dive, look up to climb, and tilt to bank. Turning must not respond to head yaw.
7. Fly from spawn under bridge one, pull up, fly under bridge two, and enter the updraft without touching the screen.
8. Confirm the updraft returns the run to the ledge.
9. Crash and confirm flying resumes in under five seconds with automatic recenter.
10. Tap during flight and confirm the current pose becomes neutral.
11. Run for ten minutes only if comfortable; stop immediately for nausea, dizziness, headache, or eye strain.

## Performance target

The target is sustained 60 fps in stereo. This must be judged on the iPhone; desktop inspection cannot certify it.
