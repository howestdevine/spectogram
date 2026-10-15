# Spectrogram

A microphone-only 3D spectrogram for the course **Playful Technology** (Howest). Students whistle a film or game theme into their phone, pause the image, screenshot it and circle the "landmarks" that make the tune recognisable.

**Live:** https://howestdevine.github.io/spectogram/

Based on [Chrome Music Lab Spectrogram](https://github.com/googlecreativelab/chrome-music-lab/tree/master/spectrogram) by Google Creative Lab, licensed under the [Apache License 2.0](LICENSE).

## What changed compared to the original

- **Window in seconds, not frames.** The original writes one row per animation frame, so its 256-row window lasts about 4 s on a 60 Hz screen and about 2 s on a 120 Hz screen. Rows are now written on a clock (`256 / seconds` rows per second) while rendering still runs every frame. The window is the same on every screen: 5, 10, **15 (default)** or 20 s. At 20 s it is 12.8 rows per second, which is a bit coarse for very short notes.
- **Microphone only.** The sample sounds, draw mode, file drop and localization are gone. One *Start microphone* button starts audio from the tap, which iOS requires. Browser echo cancellation, noise suppression and auto gain are switched off, so whistling isn't "cleaned up". The original refused the microphone on iOS entirely. That block is gone.
- **Portrait and landscape.** There is no orientation lock. The canvas follows rotation (including iOS's late `visualViewport` updates).
- **Full width, no fade.** The window runs across the whole screen: newest sound at the right next to the labels, oldest at the left edge. The original faded the oldest part out; that fade is removed so the whole window is visible. The 3D view is zoomed and panned in 2D after projection to fit the free area, so the camera angles and perspective are the original ones.
- **Pause / Resume** freezes the image for a screenshot (Space on a keyboard). The page also pauses itself when it goes to the background.
- **Save image** downloads a PNG of the view with its labels. On phones it opens the share sheet instead.
- **Rebuilt with Vite.** The gulp/browserify/jade/sass toolchain, jQuery and the o3djs bundle were removed. Shaders are imported with `?raw`. The colours, mesh and camera angles are unchanged.
- **Correct frequency labels.** The original placed its Hz labels with a hand-tuned guess ("For now, we fudge this..."), so a 1,000 Hz whistle showed up below the "200 Hz" label, and the "20 Hz" label pointed at nothing (the 3D axis starts around 180 Hz). Labels are now placed by projecting each frequency through the same camera matrix as the mesh, on its newest (right) edge, so they stay correct in every orientation.
- No analytics, no external requests, nothing stored. The page says so: *Only analyses live sound. Nothing is recorded or saved.*

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173/spectogram/
npm run build      # static files in dist/
npm run preview    # serve dist/ at http://localhost:4173/spectogram/
```

`localhost` counts as a secure context, so the microphone works there. To test on a phone on the same network, run `npm run dev:lan`. It serves over HTTPS with a self-signed certificate (accept the warning on the phone), because `getUserMedia` needs HTTPS.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which builds with Vite and publishes `dist/` to GitHub Pages. In the repository settings, Pages → Source must be set to **GitHub Actions**.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | UI: start, pause, window length, save, rotation handling |
| `src/spectrogram.js` | Row clock, resizing, frequency labels and seconds hint |
| `src/visualizer.js` | WebGL 3D sonogram (`writeRow()` and `drawGL()`) |
| `src/player.js` | AudioContext, microphone and analyser |
| `src/shader.js`, `src/matrix4x4.js` | Small WebGL helpers from the original |
| `src/shaders/` | Original sonogram shaders |

## License

Apache License 2.0, see [LICENSE](LICENSE). Files ported from the original keep their copyright headers and carry a "Modified by Howest, 2026" note. `src/shader.js` (o3djs, Google) and `src/matrix4x4.js` (Mozilla) keep their original BSD headers.
