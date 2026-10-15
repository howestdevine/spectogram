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

Modified by Howest, 2026: rewritten UI wiring for a microphone-only page
with pause/resume, a window length setting and "Save image". No sample
sounds, file drop, localization, iframe messaging or orientation lock.
*********************************************************/

import spec3D from './spectrogram.js';
import Player, { FFT_SIZE } from './player.js';

const $ = (selector) => document.querySelector(selector);

const intro = $('#intro');
const startButton = $('#start');
const errorText = $('#error');
const controls = $('#controls');
const pauseButton = $('#pause');
const saveButton = $('#save');

const player = new Player();
let started = false;

function showError(message) {
  errorText.textContent = message;
  errorText.hidden = !message;
}

function micErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was refused. Allow the microphone for this site in your browser settings, then reload the page.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Connect one and try again.';
    case 'NotReadableError':
      return 'The microphone is in use by another app. Close that app and try again.';
    case 'InsecureContext':
      return 'The microphone only works over HTTPS. Open the https:// address of this page.';
    default:
      return 'Could not start the microphone' + (err && err.message ? ': ' + err.message : '.');
  }
}

function setPaused(paused) {
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
}

// Starts (or restarts) the mic. Always called from a tap or click.
function startMic() {
  showError('');
  startButton.disabled = true;
  return player.live()
    .then(() => {
      spec3D.setAnalyserNode(player.getAnalyserNode());
      started = true;
      intro.hidden = true;
      controls.hidden = false;
      setPaused(false);
      spec3D.startRender();
    })
    .catch((err) => {
      console.warn(err);
      started = false;
      intro.hidden = false;
      controls.hidden = true;
      showError(micErrorMessage(err));
    })
    .finally(() => {
      startButton.disabled = false;
    });
}

function pause() {
  spec3D.pause();
  setPaused(true);
}

function resume() {
  // After the page was in the background (iOS), the mic or the audio
  // clock may have been stopped; this tap is allowed to restart them.
  if (!player.isLive()) {
    startMic();
    return;
  }
  setPaused(false);
  spec3D.startRender();
}

function togglePause() {
  if (spec3D.paused) resume();
  else pause();
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Combines the 3D view and the labels into one PNG.
function saveImage() {
  const gl = spec3D.canvas;
  const out = document.createElement('canvas');
  out.width = gl.width;
  out.height = gl.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(gl, 0, 0);
  ctx.drawImage(spec3D.legend, 0, 0);

  out.toBlob((blob) => {
    if (!blob) return;
    const name = `spectrogram-${timestamp()}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const touch = window.matchMedia('(pointer: coarse)').matches;

    // On phones the share sheet offers "Save Image" to the photo library.
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function init() {
  try {
    spec3D.attached($('#spectrogram'), $('#legend'), FFT_SIZE / 2);
  } catch (err) {
    console.error(err);
    startButton.hidden = true;
    showError(err.message);
    return;
  }

  startButton.addEventListener('click', startMic);
  pauseButton.addEventListener('click', togglePause);
  saveButton.addEventListener('click', saveImage);

  for (const input of document.querySelectorAll('input[name="window"]')) {
    input.addEventListener('change', () => spec3D.setWindowSeconds(Number(input.value)));
  }

  // Space pauses and resumes on a keyboard (buttons handle their own Space).
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !started) return;
    if (e.target.closest('button, input, a')) return;
    e.preventDefault();
    togglePause();
  });

  // Freeze when the page goes to the background instead of losing the image.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started && !spec3D.paused) pause();
  });

  // Rotation: iOS reports the new size late, so resize again shortly after.
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      spec3D.onResize_();
      setTimeout(() => spec3D.onResize_(), 300);
    }, 150);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}

init();
