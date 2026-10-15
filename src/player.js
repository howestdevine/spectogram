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

Modified by Howest, 2026: microphone only. Sample sounds, file playback,
the bandpass filter and the tone generator are removed, the iOS block on the
microphone is gone, and the AudioContext is only created from a user tap.
*********************************************************/

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  // iPadOS reports itself as a Mac.
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

export const FFT_SIZE = isMobile ? 1024 : 2048;

// Whistling should reach the analyser untouched.
const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

export default class Player {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.input = null;
    this.stream = null;
  }

  // Must be called from a tap/click handler: iOS only allows audio and
  // microphone access that starts from a user gesture.
  live() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(Object.assign(new Error('insecure'), { name: 'InsecureContext' }));
    }

    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();

      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;

      // Keep the analyser pulled by the graph without making any sound.
      const silence = context.createGain();
      silence.gain.value = 0;
      analyser.connect(silence);
      silence.connect(context.destination);

      this.context = context;
      this.analyser = analyser;
    }
    const resumed = this.context.resume();

    return Promise.all([navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS), resumed])
      .then(([stream]) => this.onStream_(stream));
  }

  onStream_(stream) {
    this.disconnect_();
    const input = this.context.createMediaStreamSource(stream);
    input.connect(this.analyser);
    this.input = input;
    this.stream = stream;
  }

  // True when the mic is connected and the audio clock is running.
  isLive() {
    return !!this.stream
      && this.stream.getAudioTracks().some((t) => t.readyState === 'live')
      && this.context.state === 'running';
  }

  disconnect_() {
    if (this.input) {
      this.input.disconnect();
      this.input = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  getAnalyserNode() {
    return this.analyser;
  }
}
