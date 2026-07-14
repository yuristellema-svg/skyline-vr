# Skyline VR

A no-build, browser-based wingsuit flying prototype for desktop and iPhone cardboard-style VR headsets.

## Current prototype

- Procedural low-poly valley and river
- Two fly-under bridges
- Speed gained by diving and lost while climbing
- Roll-to-turn flight controls
- Terrain and bridge collision with checkpoint restarts
- Desktop mouse/keyboard controls
- iPhone DeviceOrientation head controls
- Manual side-by-side stereo rendering
- PWA metadata and offline caching

## Test on a computer immediately

Unzip the project and double-click `index.html`. The bundled build runs without installing anything.

For development, a local static server is still useful:

```bash
python -m http.server 8000
```

## Phone access after GitHub Pages is enabled

Open the GitHub Pages URL in Safari. Tap **Start phone VR**, grant motion access, rotate to landscape, and place the phone in the headset. For the cleanest full-screen launch, use Safari's Share menu and choose **Add to Home Screen**.

## Controls

Desktop:
- Mouse position: pitch and roll
- W/S: pitch
- A/D: roll
- C: switch camera
- R: restart

Phone:
- Head pitch: dive/climb
- Head tilt: bank/turn
- Recenter button: set the current head position as neutral

## Project authority

Major creative or technical decisions should be escalated to Fable. Small implementation choices, fixes, and testing can proceed without escalation.
