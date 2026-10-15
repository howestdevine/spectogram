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
- ES module, 3D sonogram only (frequency, waveform and 2D sonogram removed).
- doFrequencyAnalysis() split into writeRow() and drawGL(), so rows can be
  written at a fixed rate while rendering runs every animation frame.
- clearTexture() to start a fresh window.
- Shaders come in as strings; preserveDrawingBuffer for "Save image".
- The projected mesh is zoomed and panned (in 2D, after projection) to fill
  the free screen area, newest edge on the right.
*********************************************************/

import Matrix4x4 from './matrix4x4.js';
import Shader from './shader.js';
import sonogramVertexSrc from './shaders/sonogram-vertex.glsl?raw';
import sonogramFragmentSrc from './shaders/sonogram-fragment.glsl?raw';

// The "model" matrix is the "world" matrix in Standard Annotations and Semantics
const model = new Matrix4x4();
const view = new Matrix4x4();
const projection = new Matrix4x4();

// How much the framing may stretch one axis more than the other.
const MAX_STRETCH = 3;

// Projects a model-space point with a row-vector matrix (Matrix4x4 layout)
// and returns normalized device coordinates, or null behind the camera.
function projectNDC(e, x, y, z) {
  const clip = [0, 1, 2, 3].map((j) => x * e[j] + y * e[4 + j] + z * e[8 + j] + e[12 + j]);
  if (clip[3] <= 0) return null;
  return { x: clip[0] / clip[3], y: clip[1] / clip[3] };
}

export default class AnalyserView {
  constructor(canvas) {
    this.sonogram3DWidth = 256;
    this.sonogram3DHeight = 256;
    this.sonogram3DGeometrySize = 9.5;

    this.freqByteData = null;
    this.texture = null;
    this.TEXTURE_HEIGHT = 256;
    this.yoffset = 0;

    // Background color
    this.backgroundColor = [.08, .08, .08, 1];
    this.foregroundColor = [0, .7, 0, 1];

    // Camera (the original CameraController without its disabled mouse code).
    this.camera = { xRot: -180, yRot: 270, zRot: 90, xT: 0, yT: -2, zT: -2 };

    // Free screen area for the mesh, as fractions of the canvas.
    this.frame = { left: 0, right: 0, top: 0, bottom: 0 };

    this.canvas = canvas;
    this.initGL();
  }

  initGL() {
    const sonogram3DWidth = this.sonogram3DWidth;
    const sonogram3DHeight = this.sonogram3DHeight;
    const sonogram3DGeometrySize = this.sonogram3DGeometrySize;
    const backgroundColor = this.backgroundColor;

    const gl = this.canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })
      || this.canvas.getContext('experimental-webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) {
      throw new Error('WebGL is not available in this browser.');
    }
    this.gl = gl;

    // The 3D view reads the frequency texture in the vertex shader.
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) <= 0) {
      throw new Error('This device cannot draw the 3D spectrogram (no vertex textures).');
    }

    gl.clearColor(backgroundColor[0], backgroundColor[1], backgroundColor[2], backgroundColor[3]);
    gl.enable(gl.DEPTH_TEST);

    const numVertices = sonogram3DWidth * sonogram3DHeight;
    if (numVertices > 65536) {
      throw new Error('Sonogram 3D resolution is too high: can only handle 65536 vertices max');
    }
    const vertices = new Float32Array(numVertices * 3);
    const texCoords = new Float32Array(numVertices * 2);

    for (let z = 0; z < sonogram3DHeight; z++) {
      for (let x = 0; x < sonogram3DWidth; x++) {
        // Generate a reasonably fine mesh in the X-Z plane
        vertices[3 * (sonogram3DWidth * z + x) + 0] =
          sonogram3DGeometrySize * (x - sonogram3DWidth / 2) / sonogram3DWidth;
        vertices[3 * (sonogram3DWidth * z + x) + 1] = 0;
        vertices[3 * (sonogram3DWidth * z + x) + 2] =
          sonogram3DGeometrySize * (z - sonogram3DHeight / 2) / sonogram3DHeight;

        texCoords[2 * (sonogram3DWidth * z + x) + 0] = x / (sonogram3DWidth - 1);
        texCoords[2 * (sonogram3DWidth * z + x) + 1] = z / (sonogram3DHeight - 1);
      }
    }

    this.vbo3DTexCoordOffset = vertices.byteLength;

    // Create the vertices and texture coordinates
    this.sonogram3DVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sonogram3DVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.vbo3DTexCoordOffset + texCoords.byteLength, gl.STATIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.vbo3DTexCoordOffset, texCoords);

    // Now generate indices
    const sonogram3DNumIndices = (sonogram3DWidth - 1) * (sonogram3DHeight - 1) * 6;
    this.sonogram3DNumIndices = sonogram3DNumIndices - (6 * 600);

    const indices = new Uint16Array(sonogram3DNumIndices);
    // We need to use TRIANGLES instead of for example TRIANGLE_STRIP
    // because we want to make one draw call instead of hundreds per
    // frame, and unless we produce degenerate triangles (which are very
    // ugly) we won't be able to split the rows.
    let idx = 0;
    for (let z = 0; z < sonogram3DHeight - 1; z++) {
      for (let x = 0; x < sonogram3DWidth - 1; x++) {
        indices[idx++] = z * sonogram3DWidth + x;
        indices[idx++] = z * sonogram3DWidth + x + 1;
        indices[idx++] = (z + 1) * sonogram3DWidth + x + 1;
        indices[idx++] = z * sonogram3DWidth + x;
        indices[idx++] = (z + 1) * sonogram3DWidth + x + 1;
        indices[idx++] = (z + 1) * sonogram3DWidth + x;
      }
    }

    this.sonogram3DIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sonogram3DIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    // Note we do not unbind this buffer -- not necessary

    this.sonogram3DShader = new Shader(gl, sonogramVertexSrc, sonogramFragmentSrc);
  }

  setAnalyserNode(analyser) {
    this.analyser = analyser;
  }

  // (Re-)allocates the frequency texture when the analyser's bin count changes.
  initByteBuffer(binCount) {
    if (!this.freqByteData || this.freqByteData.length != binCount) {
      this.freqByteData = new Uint8Array(binCount);
      this.allocateTexture();
    }
  }

  allocateTexture() {
    const gl = this.gl;
    if (this.texture) {
      gl.deleteTexture(this.texture);
    }
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const width = this.freqByteData.length;
    const empty = new Uint8Array(width * this.TEXTURE_HEIGHT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, width, this.TEXTURE_HEIGHT, 0, gl.ALPHA, gl.UNSIGNED_BYTE, empty);
    this.yoffset = 0;
  }

  // Empties the whole window (e.g. after changing the window length).
  clearTexture() {
    if (this.freqByteData) {
      this.allocateTexture();
    }
  }

  // Takes one snapshot of the spectrum and writes it as the newest row.
  writeRow() {
    const gl = this.gl;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.getByteFrequencyData(this.freqByteData);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.yoffset, this.freqByteData.length, 1,
      gl.ALPHA, gl.UNSIGNED_BYTE, this.freqByteData);
    this.yoffset = (this.yoffset + 1) % this.TEXTURE_HEIGHT;
  }

  setFrame(frame) {
    this.frame = frame;
  }

  // Model-space z of the oldest and newest edge of the drawn mesh.
  edgeZ() {
    const size = this.sonogram3DGeometrySize;
    const h = this.sonogram3DHeight;
    // The last rows of the mesh are not drawn (see sonogram3DNumIndices).
    return { oldest: -size / 2, newest: size * ((h - 4) - h / 2) / h };
  }

  worldViewProjection() {
    const camera = this.camera;

    // Set up the model, view and projection matrices
    projection.loadIdentity();
    projection.perspective(55, this.canvas.width / this.canvas.height, 1, 100);
    view.loadIdentity();
    view.translate(0, 0, -9.0);

    // Add in camera rotation
    model.loadIdentity();
    model.rotate(camera.xRot, 1, 0, 0);
    model.rotate(camera.yRot, 0, 1, 0);
    model.rotate(camera.zRot, 0, 0, 1);
    model.translate(camera.xT, camera.yT, camera.zT);

    // Compute necessary matrices
    const mvp = new Matrix4x4();
    mvp.multiply(model);
    mvp.multiply(view);
    mvp.multiply(projection);
    return mvp.multiply(this.framing(mvp.elements));
  }

  /**
   * A 2D zoom and pan applied after projection, like cropping a photo: the
   * 3D view itself is unchanged, but the mesh is fitted to the free area
   * with its newest edge against the right side.
   */
  framing(e) {
    const size = this.sonogram3DGeometrySize;
    const edges = this.edgeZ();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [-size / 2, size / 2]) {
      for (const y of [0, size / 3.5]) {
        for (const z of [edges.oldest, edges.newest]) {
          const p = projectNDC(e, x, y, z);
          if (!p) continue;
          // Peaks lean outwards in this view. On the right they must clear
          // the labels; on the left only the base counts, so reserving room
          // for peaks doesn't leave the left side empty. Very loud old peaks
          // may run off the left edge.
          maxX = Math.max(maxX, p.x);
          if (y == 0) minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      }
    }

    const f = this.frame;
    const left = -1 + 2 * f.left, right = 1 - 2 * f.right;
    const top = 1 - 2 * f.top, bottom = -1 + 2 * f.bottom;
    let sx = (right - left) / (maxX - minX);
    let sy = (top - bottom) / (maxY - minY);
    sx = Math.min(sx, sy * MAX_STRETCH);
    sy = Math.min(sy, sx * MAX_STRETCH);

    const m = new Matrix4x4();
    m.elements[0] = sx;
    m.elements[5] = sy;
    m.elements[12] = right - sx * maxX;
    m.elements[13] = (top + bottom) / 2 - sy * (maxY + minY) / 2;
    return m;
  }

  /**
   * Where a frequency lies on the newest edge of the mesh, as a fraction of
   * the canvas ({x, y} from the top left), or null when it is off the mesh.
   * Mirrors the vertex shader: the texture is sampled at 256^(u - 1), where
   * u is the mesh's x texture coordinate and 1.0 is the Nyquist frequency.
   */
  frequencyToScreen(freq, sampleRate) {
    const u = 1 + Math.log(freq / (sampleRate / 2)) / Math.log(256);
    if (u < 0 || u > 1) return null;

    const size = this.sonogram3DGeometrySize;
    const w = this.sonogram3DWidth;
    const x = size * (u * (w - 1) - w / 2) / w;
    const p = projectNDC(this.worldViewProjection().elements, x, 0, this.edgeZ().newest);
    if (!p) return null;
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  drawGL() {
    const canvas = this.canvas;
    const gl = this.gl;
    const sonogram3DShader = this.sonogram3DShader;
    const sonogram3DHeight = this.sonogram3DHeight;
    const TEXTURE_HEIGHT = this.TEXTURE_HEIGHT;

    gl.viewport(0, 0, canvas.width, canvas.height);

    // Point the frequency data texture at texture unit 0 (the default),
    // which is what we're using since we haven't called activeTexture
    // in our program
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sonogram3DVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sonogram3DIBO);
    sonogram3DShader.bind();

    const vertexLoc = sonogram3DShader.gPositionLoc;
    const texCoordLoc = sonogram3DShader.gTexCoord0Loc;

    gl.uniform1i(sonogram3DShader.vertexFrequencyDataLoc, 0);

    const normalizedYOffset = this.yoffset / (TEXTURE_HEIGHT - 1);
    gl.uniform1f(sonogram3DShader.yoffsetLoc, normalizedYOffset);

    const discretizedYOffset = Math.floor(normalizedYOffset * (sonogram3DHeight - 1)) / (sonogram3DHeight - 1);
    gl.uniform1f(sonogram3DShader.vertexYOffsetLoc, discretizedYOffset);
    gl.uniform1f(sonogram3DShader.verticalScaleLoc, this.sonogram3DGeometrySize / 3.5);

    const mvp = this.worldViewProjection();
    gl.uniformMatrix4fv(sonogram3DShader.worldViewProjectionLoc, false, mvp.elements);

    gl.uniform1i(sonogram3DShader.frequencyDataLoc, 0);
    gl.uniform4fv(sonogram3DShader.foregroundColorLoc, this.foregroundColor);
    gl.uniform4fv(sonogram3DShader.backgroundColorLoc, this.backgroundColor);

    // Set up the vertex attribute arrays
    gl.enableVertexAttribArray(vertexLoc);
    gl.vertexAttribPointer(vertexLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, this.vbo3DTexCoordOffset);

    // Clear the render area
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Actually draw
    gl.drawElements(gl.TRIANGLES, this.sonogram3DNumIndices, gl.UNSIGNED_SHORT, 0);

    // Disable the attribute arrays for cleanliness
    gl.disableVertexAttribArray(vertexLoc);
    gl.disableVertexAttribArray(texCoordLoc);
  }
}
