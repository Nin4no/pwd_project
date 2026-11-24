/**
 * OOP WebGL2 Resource Management & Standard Shaders
 * Handles GPU buffer lifecycles, VAOs, programs and uniform binding
 */

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  isLines?: boolean;
}

export class ShaderProgram {
  public gl: WebGL2RenderingContext;
  public program: WebGLProgram | null = null;
  private uniforms: Map<string, WebGLUniformLocation | null> = new Map();

  constructor(gl: WebGL2RenderingContext, vertSource: string, fragSource: string) {
    this.gl = gl;
    this.program = this.createProgram(vertSource, fragSource);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error(`Failed to create WebGLShader of type ${type}`);
    }
    this.gl.shaderSource(shader, source.trim());
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${info}\nSource:\n${source}`);
    }
    return shader;
  }

  private createProgram(vertSource: string, fragSource: string): WebGLProgram {
    const vert = this.compileShader(this.gl.VERTEX_SHADER, vertSource);
    const frag = this.compileShader(this.gl.FRAGMENT_SHADER, fragSource);

    const program = this.gl.createProgram();
    if (!program) {
      this.gl.deleteShader(vert);
      this.gl.deleteShader(frag);
      throw new Error('Failed to create WebGLProgram');
    }

    this.gl.attachShader(program, vert);
    this.gl.attachShader(program, frag);
    this.gl.linkProgram(program);

    this.gl.deleteShader(vert);
    this.gl.deleteShader(frag);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`Program link failed: ${info}`);
    }

    return program;
  }

  use(): void {
    if (this.program) {
      this.gl.useProgram(this.program);
    }
  }

  getUniform(name: string): WebGLUniformLocation | null {
    if (!this.program) return null;
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return loc;
  }

  setMat4(name: string, m: Float32Array): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniformMatrix4fv(loc, false, m);
    }
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniform3f(loc, x, y, z);
    }
  }

  setFloat(name: string, v: number): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniform1f(loc, v);
    }
  }

  setInt(name: string, v: number): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniform1i(loc, v);
    }
  }

  setVec2(name: string, x: number, y: number): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniform2f(loc, x, y);
    }
  }

  setVec4(name: string, x: number, y: number, z: number, w: number): void {
    const loc = this.getUniform(name);
    if (loc) {
      this.gl.uniform4f(loc, x, y, z, w);
    }
  }

  dispose(): void {
    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    this.uniforms.clear();
  }
}

export class GpuMesh {
  public gl: WebGL2RenderingContext;
  public vao: WebGLVertexArrayObject | null = null;
  public posVbo: WebGLBuffer | null = null;
  public normVbo: WebGLBuffer | null = null;
  public ibo: WebGLBuffer | null = null;
  public indexCount: number = 0;
  public indexType: number = 0;
  public isLines: boolean = false;

  constructor(gl: WebGL2RenderingContext, data: GeometryData) {
    this.gl = gl;
    this.isLines = !!data.isLines;
    this.indexCount = data.indices.length;

    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error('Failed to create WebGLVertexArrayObject');
    }
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // Positions attribute (location = 0, 3 floats)
    this.posVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Normals attribute (location = 1, 3 floats)
    if (data.normals && data.normals.length > 0) {
      this.normVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normVbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }

    // Index buffer (EBO)
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);

    this.indexType = data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw(): void {
    if (!this.vao) return;
    this.gl.bindVertexArray(this.vao);
    const mode = this.isLines ? this.gl.LINES : this.gl.TRIANGLES;
    this.gl.drawElements(mode, this.indexCount, this.indexType, 0);
    this.gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.posVbo) {
      this.gl.deleteBuffer(this.posVbo);
      this.posVbo = null;
    }
    if (this.normVbo) {
      this.gl.deleteBuffer(this.normVbo);
      this.normVbo = null;
    }
    if (this.ibo) {
      this.gl.deleteBuffer(this.ibo);
      this.ibo = null;
    }
    if (this.vao) {
      this.gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
  }
}

export function createLitShader(gl: WebGL2RenderingContext): ShaderProgram {
  const vertSource = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_model;
uniform mat4 u_viewProj;

out vec3 v_worldPos;
out vec3 v_normal;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  vec3 scaleSq = vec3(
    max(dot(u_model[0].xyz, u_model[0].xyz), 1e-8),
    max(dot(u_model[1].xyz, u_model[1].xyz), 1e-8),
    max(dot(u_model[2].xyz, u_model[2].xyz), 1e-8)
  );
  v_normal = mat3(u_model) * (a_normal / scaleSq);
  gl_Position = u_viewProj * worldPos;
}
`;

  const fragSource = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;

uniform vec3 u_cameraPos;
uniform vec3 u_color;
uniform float u_alpha;
uniform float u_roughness;
uniform float u_metalness;
uniform vec3 u_emissive;
uniform float u_unlit;
uniform float u_isFloor;
uniform float u_isWall;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform vec3 u_keyDir;
uniform vec3 u_keyColor;
uniform vec3 u_fillColor;

out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  if (u_unlit > 0.5) {
    fragColor = vec4(u_color, u_alpha);
    return;
  }

  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) {
    n = -n;
  }

  // Convert sRGB input color to linear space
  vec3 baseSrgb = u_color;

  // Procedural warm oak wood floor planks & seams
  if (u_isFloor > 0.5) {
    float plankW = 0.18;
    float plankL = 1.20;
    float row = floor(v_worldPos.z / plankW);
    float rowShift = hash12(vec2(row, 7.13)) * plankL;
    float col = floor((v_worldPos.x + rowShift) / plankL);

    // Subtle per-plank tone variation (±4.5%)
    float plankRand = (hash12(vec2(col, row)) - 0.5) * 0.09;
    // Fine wood grain along X
    float grain = sin(v_worldPos.x * 28.0 + sin(v_worldPos.z * 90.0) * 1.4 + row * 3.1) * 0.015;
    baseSrgb = clamp(baseSrgb + vec3(plankRand + grain), 0.0, 1.0);

    // Crisp plank seam lines
    float fz = abs(fract(v_worldPos.z / plankW - 0.5) - 0.5) / max(fwidth(v_worldPos.z / plankW), 1e-4);
    float fx = abs(fract((v_worldPos.x + rowShift) / plankL - 0.5) - 0.5) / max(fwidth(v_worldPos.x / plankL), 1e-4);
    float seam = 1.0 - clamp(min(fz, fx), 0.0, 1.0);
    baseSrgb *= mix(1.0, 0.84, seam * 0.75);
  }

  vec3 albedo = pow(clamp(baseSrgb, 0.0, 1.0), vec3(2.2));

  // Balanced PBR lighting (Lambertian 1/PI + directional contrast between X/Y/Z faces)
  float hemiFactor = n.y * 0.5 + 0.5;
  vec3 ambientIrradiance = mix(u_groundColor, u_skyColor, hemiFactor);

  // Sun key light (angled so +X, -X, +Z, -Z, +Y faces all get distinct shading)
  vec3 light1Dir = normalize(u_keyDir);
  float ndotl1 = max(dot(n, light1Dir), 0.0);

  // Cool fill light from opposite side
  vec3 light2Dir = normalize(vec3(-0.82, 0.45, -0.55));
  float ndotl2 = max(dot(n, light2Dir), 0.0);

  vec3 directIrradiance = u_keyColor * ndotl1 + u_fillColor * ndotl2;

  // Wall-to-floor ambient occlusion crease
  float ao = 1.0;
  if (u_isWall > 0.5) {
    ao = mix(0.84, 1.0, smoothstep(0.0, 0.32, v_worldPos.y));
  }

  vec3 diffuseColor = albedo * (1.0 - u_metalness);
  vec3 diffuse = diffuseColor * (ambientIrradiance + directIrradiance) * ao;

  // Subtle Blinn-Phong specular
  vec3 viewDir = normalize(u_cameraPos - v_worldPos);
  vec3 h = normalize(light1Dir + viewDir);
  float shininess = mix(12.0, 96.0, 1.0 - u_roughness);
  float specTerm = pow(max(dot(n, h), 0.0), shininess) * (1.0 - u_roughness) * 0.22 * ndotl1;
  vec3 specColor = mix(vec3(0.04), albedo, u_metalness);

  vec3 linearOut = diffuse + specColor * specTerm + pow(max(u_emissive, vec3(0.0)), vec3(2.2));
  vec3 mapped = acesFilm(linearOut * 1.08);
  vec3 srgbOut = pow(mapped, vec3(1.0 / 2.2));

  fragColor = vec4(srgbOut, u_alpha);
}
`;

  return new ShaderProgram(gl, vertSource, fragSource);
}

export function createGridShader(gl: WebGL2RenderingContext): ShaderProgram {
  const vertSource = `#version 300 es
layout(location = 0) in vec3 a_position;

uniform mat4 u_viewProj;

out vec3 v_worldPos;

void main() {
  vec4 worldPos = vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_viewProj * worldPos;
}
`;

  const fragSource = `#version 300 es
precision highp float;

in vec3 v_worldPos;

uniform vec3 u_cameraPos;

out vec4 fragColor;

float computeGrid(vec2 p, float spacing) {
  vec2 c = p / spacing;
  vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(d.x, d.y), 1.0);
}

void main() {
  float dist = length(u_cameraPos.xz - v_worldPos.xz);
  float fade = clamp(1.0 - dist / 30.0, 0.0, 1.0);
  if (fade <= 0.0) {
    discard;
  }

  vec2 coord = v_worldPos.xz;
  float line05 = computeGrid(coord, 0.5);
  float line10 = computeGrid(coord, 1.0);

  // 0.5m cells: #c9d8f2 -> vec3(0.788235, 0.847059, 0.949020)
  // 1.0m sections: #9db8e8 -> vec3(0.615686, 0.721569, 0.909804)
  vec3 col05 = vec3(0.788235, 0.847059, 0.949020);
  vec3 col10 = vec3(0.615686, 0.721569, 0.909804);

  float alpha05 = line05 * 0.45;
  float alpha10 = line10 * 0.85;
  float alpha = max(alpha05, alpha10);

  if (alpha <= 0.001) {
    discard;
  }

  vec3 col = mix(col05, col10, line10);
  fragColor = vec4(col, alpha * fade);
}
`;

  return new ShaderProgram(gl, vertSource, fragSource);
}
