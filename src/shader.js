/*
 * Copyright 2009, Google Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Modified by Howest, 2026: reduced o3djs.shader to the Shader class as an
 * ES module. Shader sources are passed in as strings (Vite ?raw imports)
 * instead of being fetched with a synchronous XHR.
 */

// Converts GLSL names to JavaScript names (some_name -> someName).
function glslNameToJs(name) {
  return name.replace(/_(.)/g, (_, p1) => p1.toUpperCase());
}

/**
 * Compiles and links the given vertex and fragment shaders into a program.
 * Every uniform and attribute gets a `<name>Loc` property with its location.
 */
export default class Shader {
  constructor(gl, vertex, fragment) {
    this.gl = gl;
    this.program = gl.createProgram();

    const vs = this.loadShader(gl.VERTEX_SHADER, vertex);
    gl.attachShader(this.program, vs);
    gl.deleteShader(vs);

    const fs = this.loadShader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(this.program, fs);
    gl.deleteShader(fs);

    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const infoLog = gl.getProgramInfoLog(this.program);
      gl.deleteProgram(this.program);
      throw new Error('Error linking program:\n' + infoLog);
    }

    // Find uniforms and attributes.
    const re = /(uniform|attribute)\s+\S+\s+(\S+)\s*;/g;
    let match;
    while ((match = re.exec(vertex + '\n' + fragment)) != null) {
      const glslName = match[2];
      const jsName = glslNameToJs(glslName);
      if (match[1] == 'uniform') {
        this[jsName + 'Loc'] = gl.getUniformLocation(this.program, glslName);
      } else {
        this[jsName + 'Loc'] = gl.getAttribLocation(this.program, glslName);
      }
    }
  }

  bind() {
    this.gl.useProgram(this.program);
  }

  loadShader(type, shaderSrc) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, shaderSrc);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const infoLog = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Error compiling shader:\n' + infoLog);
    }
    return shader;
  }
}
