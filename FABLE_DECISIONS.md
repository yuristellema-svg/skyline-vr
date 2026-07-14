# Fable decisions — Iteration 2

The attached **Skyline VR — Iteration 2 Build Brief (Fable, locked)** is the authority. This file is a compact implementation record, not a replacement for that brief.

## Implemented now: Stage A + Stage B

- Head pitch and roll command local-body rotation rates around a persistent attitude quaternion. Head yaw is menu-only.
- No pitch/roll angle limits, no Euler recomposition, no speed spring, no fake bank-to-yaw rule, and no corridor walls.
- Velocity direction chases the nose; gravity along the path drives acceleration; quadratic drag settles a vertical dive near 130 m/s.
- Dive-charged automatic boost, low-speed floor/mush, climb refund, G effects, wind streaks, rigid first person, and stiff third person are active.
- The test box is a 12 km plane with 100 m distance pylons, dense near-field references, and one collision-tested stone bridge.
- The reticle and seven gaze panels exist in 3D at 2.5 m and are rendered in every eye pass. Menu gesture is >45° yaw for one second; selection dwell is one second.
- Crash countdown, menu-only recenter, respawn auto-recenter, iPhone Home Screen guidance, standalone manifest, offline service worker, and wake-lock reacquisition are wired.
- Rendering remains manually scissored stereo at pixel ratio 1 with no shadow maps. Runtime objects are preallocated in hot flight/render paths.

## Explicitly blocked: Stage C

No chunk streaming, biome terrain, city, lake/river water, bridge family, floating origin, or soft mountain boundary is implemented. Fable requires Yuri to pass Stage A on the target iPhone first.

## Ownership still open

Yuri owns the default sensitivity, final boost strength, G-effect intensity, and later avatar choice. Everything else above remains locked unless Fable updates the brief.

