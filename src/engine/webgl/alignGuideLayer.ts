import type { AlignGuideSegment } from '../layout/alignSnap';
import { ALIGN_GUIDE_STYLE } from './alignGuideStyle';
import { ShaderProgram } from './resources';

const FLOATS_PER_VERTEX = 7; // x, y, z, r, g, b, a
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 6; // 2 triangles
const INITIAL_CAPACITY_FLOATS = 256 * FLOATS_PER_VERTEX;
const MIN_SPAN = 1e-6;
const MIN_DASH_STRIDE = 1e-3;

function createAlignGuideShader(gl: WebGL2RenderingContext): ShaderProgram {
  const vertSource = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;

uniform mat4 u_viewProj;

out vec4 v_color;

void main() {
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}
`;

  const fragSource = `#version 300 es
precision highp float;

in vec4 v_color;

out vec4 fragColor;

void main() {
  fragColor = v_color;
}
`;

  return new ShaderProgram(gl, vertSource, fragSource);
}

/**
 * WebGL2 동적 리본-쿼드 가구 정렬 가이드 레이어 (SRP 캡슐화).
 * Windows/ANGLE의 `gl.lineWidth === 1.0` 제약을 피하기 위해 수평 XZ 삼각형 리본으로 테셀레이션하고
 * 단일 인터리브드 `DYNAMIC_DRAW` VBO + 1회 `drawArrays(TRIANGLES)`로 렌더링한다.
 */
export class AlignGuideLayer {
  private readonly gl: WebGL2RenderingContext;
  private readonly shader: ShaderProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;

  private cpuBuffer = new Float32Array(INITIAL_CAPACITY_FLOATS);
  private gpuCapacityFloats = 0;
  private vertexCount = 0;
  private disposed = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.shader = createAlignGuideShader(gl);

    const vao = gl.createVertexArray();
    if (!vao) {
      this.shader.dispose();
      throw new Error('Failed to create AlignGuideLayer VAO');
    }
    const vbo = gl.createBuffer();
    if (!vbo) {
      gl.deleteVertexArray(vao);
      this.shader.dispose();
      throw new Error('Failed to create AlignGuideLayer VBO');
    }

    this.vao = vao;
    this.vbo = vbo;

    const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private ensureCpuCapacity(requiredFloats: number): void {
    if (requiredFloats <= this.cpuBuffer.length) return;
    let nextLen = Math.max(INITIAL_CAPACITY_FLOATS, this.cpuBuffer.length);
    while (nextLen < requiredFloats) {
      nextLen *= 2;
    }
    const grown = new Float32Array(nextLen);
    grown.set(this.cpuBuffer);
    this.cpuBuffer = grown;
  }

  private writeQuad(
    offset: number,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): number {
    this.ensureCpuCapacity(offset + FLOATS_PER_QUAD);
    const buf = this.cpuBuffer;
    let i = offset;

    // Triangle 1: (x0, z0) -> (x1, z0) -> (x1, z1)
    buf[i++] = x0; buf[i++] = y; buf[i++] = z0; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;
    buf[i++] = x1; buf[i++] = y; buf[i++] = z0; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;
    buf[i++] = x1; buf[i++] = y; buf[i++] = z1; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;

    // Triangle 2: (x0, z0) -> (x1, z1) -> (x0, z1)
    buf[i++] = x0; buf[i++] = y; buf[i++] = z0; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;
    buf[i++] = x1; buf[i++] = y; buf[i++] = z1; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;
    buf[i++] = x0; buf[i++] = y; buf[i++] = z1; buf[i++] = r; buf[i++] = g; buf[i++] = b; buf[i++] = a;

    return i;
  }

  setGuides(guides: ReadonlyArray<AlignGuideSegment>): void {
    if (this.disposed || !this.vbo) return;
    if (guides.length === 0) {
      this.vertexCount = 0;
      return;
    }

    const y = ALIGN_GUIDE_STYLE.elevationY;
    let offset = 0;

    for (const seg of guides) {
      const spanMin = Math.min(seg.spanMin, seg.spanMax);
      const spanMax = Math.max(seg.spanMin, seg.spanMax);
      if (spanMax - spanMin <= MIN_SPAN) continue;

      const style = ALIGN_GUIDE_STYLE.kinds[seg.kind];
      const [r, g, b] = style.rgb;
      const a = style.alpha;
      const halfW = style.ribbonWidth * 0.5;
      const halfTickLen = style.tickLength * 0.5;
      const halfTickW = style.tickWidth * 0.5;

      if (style.dashed && style.dashLength > MIN_SPAN) {
        const stride = Math.max(style.dashLength + Math.max(style.gapLength, 0), MIN_DASH_STRIDE);
        for (let t = spanMin; t < spanMax - MIN_SPAN; t += stride) {
          const tEnd = Math.min(spanMax, t + style.dashLength);
          if (seg.axis === 'x') {
            offset = this.writeQuad(offset, seg.coord - halfW, seg.coord + halfW, t, tEnd, y, r, g, b, a);
          } else {
            offset = this.writeQuad(offset, t, tEnd, seg.coord - halfW, seg.coord + halfW, y, r, g, b, a);
          }
        }
      } else if (seg.axis === 'x') {
        offset = this.writeQuad(offset, seg.coord - halfW, seg.coord + halfW, spanMin, spanMax, y, r, g, b, a);
      } else {
        offset = this.writeQuad(offset, spanMin, spanMax, seg.coord - halfW, seg.coord + halfW, y, r, g, b, a);
      }

      // 양 끝단 수직 틱 마크
      if (halfTickLen > MIN_SPAN && halfTickW > MIN_SPAN) {
        if (seg.axis === 'x') {
          offset = this.writeQuad(
            offset,
            seg.coord - halfTickLen,
            seg.coord + halfTickLen,
            spanMin - halfTickW,
            spanMin + halfTickW,
            y,
            r,
            g,
            b,
            a,
          );
          offset = this.writeQuad(
            offset,
            seg.coord - halfTickLen,
            seg.coord + halfTickLen,
            spanMax - halfTickW,
            spanMax + halfTickW,
            y,
            r,
            g,
            b,
            a,
          );
        } else {
          offset = this.writeQuad(
            offset,
            spanMin - halfTickW,
            spanMin + halfTickW,
            seg.coord - halfTickLen,
            seg.coord + halfTickLen,
            y,
            r,
            g,
            b,
            a,
          );
          offset = this.writeQuad(
            offset,
            spanMax - halfTickW,
            spanMax + halfTickW,
            seg.coord - halfTickLen,
            seg.coord + halfTickLen,
            y,
            r,
            g,
            b,
            a,
          );
        }
      }
    }

    this.vertexCount = offset / FLOATS_PER_VERTEX;
    if (this.vertexCount === 0) return;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (offset > this.gpuCapacityFloats) {
      let nextCap = Math.max(INITIAL_CAPACITY_FLOATS, this.gpuCapacityFloats);
      while (nextCap < offset) {
        nextCap *= 2;
      }
      gl.bufferData(gl.ARRAY_BUFFER, nextCap * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
      this.gpuCapacityFloats = nextCap;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cpuBuffer.subarray(0, offset));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  clear(): void {
    this.vertexCount = 0;
  }

  render(viewProj: Float32Array): void {
    if (this.disposed || this.vertexCount === 0 || !this.vao) return;
    this.shader.use();
    this.shader.setMat4('u_viewProj', viewProj);
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertexCount);
    this.gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vertexCount = 0;
    this.gpuCapacityFloats = 0;
    if (this.vbo) {
      this.gl.deleteBuffer(this.vbo);
      this.vbo = null;
    }
    if (this.vao) {
      this.gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
    this.shader.dispose();
  }
}
