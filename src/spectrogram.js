/********************************************************
Copyright 2016 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Modified by Howest, 2026:
- ES module without jQuery; draw mode and touch handling removed.
- Rows are written at a fixed rate (TEXTURE_HEIGHT / window seconds) instead
  of once per animation frame, so the window lasts the same number of seconds
  on 60 Hz and 120 Hz screens. Rendering still runs every frame.
- Pause/resume, window length setting, and resizing that follows rotation.
- Frequency labels are projected from the mesh instead of hand-tuned.
*********************************************************/

import AnalyserView from './visualizer.js';

const LABEL_FREQUENCIES = [200, 500, 1000, 2000, 5000, 10000, 20000];
const MAX_PIXEL_RATIO = 2;

const spec3D = {
  isRendering: false,
  paused: false,
  windowSeconds: 15,
  lastRow: 0,
  sampleRate: 48000,

  attached(canvas, legend, binCount) {
    spec3D.canvas = canvas;
    spec3D.legend = legend;
    spec3D.analyserView = new AnalyserView(canvas);
    spec3D.analyserView.initByteBuffer(binCount);
    spec3D.onResize_();
  },

  setAnalyserNode(analyser) {
    spec3D.analyserView.setAnalyserNode(analyser);
    spec3D.analyserView.initByteBuffer(analyser.frequencyBinCount);
    spec3D.sampleRate = analyser.context.sampleRate;
    spec3D.drawLegend_();
  },

  rowsPerSec() {
    return spec3D.analyserView.TEXTURE_HEIGHT / spec3D.windowSeconds;
  },

  // Changes the visible time span and starts with an empty window.
  setWindowSeconds(seconds) {
    spec3D.windowSeconds = seconds;
    spec3D.analyserView.clearTexture();
    spec3D.lastRow = performance.now();
    spec3D.drawLegend_();
    if (!spec3D.isRendering) spec3D.analyserView.drawGL();
  },

  startRender() {
    spec3D.paused = false;
    spec3D.lastRow = performance.now();
    if (spec3D.isRendering) {
      return;
    }
    spec3D.isRendering = true;
    requestAnimationFrame(spec3D.draw_);
  },

  // Freezes the image: no new rows and no more rendering.
  pause() {
    spec3D.paused = true;
    spec3D.isRendering = false;
    spec3D.analyserView.drawGL();
  },

  draw_(now) {
    if (!spec3D.isRendering) {
      return;
    }
    const view = spec3D.analyserView;
    const interval = 1000 / spec3D.rowsPerSec();

    // After a long stall (hidden tab, slow frame) skip ahead instead of
    // writing a burst of identical rows.
    if (now - spec3D.lastRow > 250) {
      spec3D.lastRow = now - interval;
    }
    while (now - spec3D.lastRow >= interval) {
      view.writeRow();
      spec3D.lastRow += interval;
    }
    view.drawGL();
    requestAnimationFrame(spec3D.draw_);
  },

  onResize_() {
    const vv = window.visualViewport;
    const width = Math.round(vv ? vv.width : window.innerWidth);
    const height = Math.round(vv ? vv.height : window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    spec3D.cssWidth = width;
    spec3D.cssHeight = height;
    spec3D.pixelRatio = ratio;

    for (const canvas of [spec3D.canvas, spec3D.legend]) {
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    spec3D.drawLegend_();
    // Keep a paused (or not yet started) image visible after a rotation.
    if (!spec3D.isRendering) spec3D.analyserView.drawGL();
  },

  drawLegend_() {
    // Frequency labels, placed where those frequencies actually lie on the
    // newest edge of the mesh (the original used a hand-tuned guess).
    const canvas = spec3D.legend;
    const ctx = canvas.getContext('2d');
    const ratio = spec3D.pixelRatio;
    const width = spec3D.cssWidth;
    const height = spec3D.cssHeight;
    const view = spec3D.analyserView;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const freq of LABEL_FREQUENCIES) {
      const p = view.frequencyToScreen(freq, spec3D.sampleRate);
      if (!p || p.y < 0.04 || p.y > 0.96) continue;
      ctx.fillText(freq.toLocaleString('en-US') + ' Hz -', width - 10, p.y * height);
    }

    // Seconds hint. The 3D view is in perspective, so this is the span of
    // the whole window rather than a ruler.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(`← ${spec3D.windowSeconds} s · newest sound on the right`, 14, 14);
  },
};

export default spec3D;
