# Acceptance testing

## Automated

From this folder, run `npm test`. The suite checks:

- manifest, 180×180 iPhone icon, service-worker precache, and local imports;
- manual multi-pass rendering protection (world/UI/overlay cannot erase one another);
- locked dead zones, response exponent, and maximum control rates;
- canonical phone tilt mapping;
- unrestricted quaternion loops, rolls, and inverted attitude;
- 400+ km/h vertical dive and ≈130 m/s terminal speed without a hard cap;
- minimum speed, climb refund, four-second boost charge, and pull-up trigger;
- bridge opening/stone collision and fixed-step determinism.

## Desktop browser pass — completed

- World, bridge, near field, reticle, wings, and avatar render.
- First/third-person switching works from C and from gaze dwell.
- Seven-panel menu opens, pauses, highlights, latches, and resumes.
- Camera switching keeps the menu anchored in front of the player.
- Crash menu/countdown resets safely.
- Observed load: roughly 16–23 draw calls and 31k visible triangles, below the locked 300/400k budgets.
- Browser console: no warnings or errors.

## Stage A phone gate — Yuri must complete

1. Launch from the Home Screen icon in landscape and allow motion access.
2. Complete one full loop using head pitch only.
3. Complete one full roll using head roll only.
4. Hold inverted for five seconds; controls must remain correct.
5. Dive past 400 km/h and confirm acceleration is visibly mounting.
6. Fill the blue boost arc, pull up hard while nose-down, and confirm the boost fires.
7. Confirm momentum visibly lags the nose in hard turns and no attitude hits an invisible wall.
8. Try First and Third camera; note comfort and preferred sensitivity.

## Stage B phone gate — Yuri must complete

1. Hold head yaw beyond 45° for one second; the menu must open.
2. Activate all seven items with the one-second dwell ring.
3. Confirm reticle and panels fuse comfortably in both eyes.
4. Confirm Recenter removes drift.
5. Trigger a crash; menu and countdown must appear, then require a steady neutral pose.
6. Confirm the Home Screen launch has no Safari toolbar and the screen stays awake.

Only after these phone gates pass should Stage C begin.

