/**
 * Pure OOP 3D Math & Raycasting Library
 * Standalone implementation for WebGL2 rendering pipeline
 */

export class Vec3 {
  public x: number;
  public y: number;
  public z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(a: Vec3, b?: Vec3): this {
    if (b) {
      const ax = a.x, ay = a.y, az = a.z;
      const bx = b.x, by = b.y, bz = b.z;
      this.x = ay * bz - az * by;
      this.y = az * bx - ax * bz;
      this.z = ax * by - ay * bx;
      return this;
    }
    const ax = this.x, ay = this.y, az = this.z;
    const bx = a.x, by = a.y, bz = a.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  lenSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  len(): number {
    return Math.sqrt(this.lenSq());
  }

  normalize(): this {
    const l = this.len();
    if (l > 1e-8) {
      this.scale(1.0 / l);
    }
    return this;
  }

  distTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  lerp(v: Vec3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
}

export class Mat4 {
  public elements: Float32Array;

  constructor() {
    this.elements = new Float32Array(16);
    this.identity();
  }

  identity(): this {
    const te = this.elements;
    te[0] = 1; te[4] = 0; te[8]  = 0; te[12] = 0;
    te[1] = 0; te[5] = 1; te[9]  = 0; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = 1; te[14] = 0;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  copy(m: Mat4): this {
    this.elements.set(m.elements);
    return this;
  }

  clone(): Mat4 {
    const res = new Mat4();
    res.copy(this);
    return res;
  }

  multiply(a: Mat4, b?: Mat4): this {
    const m1 = b ? a : this;
    const m2 = b ? b : a;
    const ae = m1.elements;
    const be = m2.elements;

    const a00 = ae[0], a10 = ae[1], a20 = ae[2], a30 = ae[3];
    const a01 = ae[4], a11 = ae[5], a21 = ae[6], a31 = ae[7];
    const a02 = ae[8], a12 = ae[9], a22 = ae[10], a32 = ae[11];
    const a03 = ae[12], a13 = ae[13], a23 = ae[14], a33 = ae[15];

    const b00 = be[0], b10 = be[1], b20 = be[2], b30 = be[3];
    const b01 = be[4], b11 = be[5], b21 = be[6], b31 = be[7];
    const b02 = be[8], b12 = be[9], b22 = be[10], b32 = be[11];
    const b03 = be[12], b13 = be[13], b23 = be[14], b33 = be[15];

    const te = this.elements;

    te[0]  = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
    te[1]  = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
    te[2]  = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
    te[3]  = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;

    te[4]  = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
    te[5]  = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
    te[6]  = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
    te[7]  = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;

    te[8]  = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
    te[9]  = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
    te[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
    te[11] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;

    te[12] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;
    te[13] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;
    te[14] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;
    te[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;

    return this;
  }

  perspective(fovRad: number, aspect: number, near: number, far: number): this {
    const f = 1.0 / Math.tan(fovRad * 0.5);
    const nf = 1.0 / (near - far);
    const te = this.elements;

    te[0] = f / aspect;
    te[1] = 0;
    te[2] = 0;
    te[3] = 0;

    te[4] = 0;
    te[5] = f;
    te[6] = 0;
    te[7] = 0;

    te[8] = 0;
    te[9] = 0;
    te[10] = (far + near) * nf;
    te[11] = -1;

    te[12] = 0;
    te[13] = 0;
    te[14] = 2.0 * far * near * nf;
    te[15] = 0;

    return this;
  }

  lookAt(eye: Vec3, target: Vec3, up: Vec3): this {
    const z = new Vec3(eye.x - target.x, eye.y - target.y, eye.z - target.z).normalize();
    if (z.lenSq() === 0) {
      z.z = 1;
    }

    let x = new Vec3().cross(up, z).normalize();
    if (x.lenSq() === 0) {
      const altUp = Math.abs(up.y) > 0.99 ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
      x = new Vec3().cross(altUp, z).normalize();
    }

    const y = new Vec3().cross(z, x).normalize();

    const te = this.elements;
    te[0] = x.x;
    te[1] = y.x;
    te[2] = z.x;
    te[3] = 0;

    te[4] = x.y;
    te[5] = y.y;
    te[6] = z.y;
    te[7] = 0;

    te[8] = x.z;
    te[9] = y.z;
    te[10] = z.z;
    te[11] = 0;

    te[12] = -x.dot(eye);
    te[13] = -y.dot(eye);
    te[14] = -z.dot(eye);
    te[15] = 1;

    return this;
  }

  composeTRS(tx: number, ty: number, tz: number, rotYRad: number, sx = 1, sy = 1, sz = 1): this {
    const c = Math.cos(rotYRad);
    const s = Math.sin(rotYRad);
    const te = this.elements;

    te[0] = sx * c;
    te[1] = 0;
    te[2] = -sx * s;
    te[3] = 0;

    te[4] = 0;
    te[5] = sy;
    te[6] = 0;
    te[7] = 0;

    te[8] = sz * s;
    te[9] = 0;
    te[10] = sz * c;
    te[11] = 0;

    te[12] = tx;
    te[13] = ty;
    te[14] = tz;
    te[15] = 1;

    return this;
  }

  invert(m: Mat4 = this): this {
    const me = m.elements;
    const te = this.elements;

    const n11 = me[0], n21 = me[1], n31 = me[2], n41 = me[3];
    const n12 = me[4], n22 = me[5], n32 = me[6], n42 = me[7];
    const n13 = me[8], n23 = me[9], n33 = me[10], n43 = me[11];
    const n14 = me[12], n24 = me[13], n34 = me[14], n44 = me[15];

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (Math.abs(det) < 1e-14) {
      return this.identity();
    }
    const detInv = 1.0 / det;

    te[0] = t11 * detInv;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;

    te[4] = t12 * detInv;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;

    te[8] = t13 * detInv;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;

    te[12] = t14 * detInv;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;

    return this;
  }

  transformPoint(v: Vec3): Vec3 {
    const e = this.elements;
    const x = v.x, y = v.y, z = v.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const invW = Math.abs(w) > 1e-8 ? 1.0 / w : 1.0;
    return new Vec3(
      (e[0] * x + e[4] * y + e[8]  * z + e[12]) * invW,
      (e[1] * x + e[5] * y + e[9]  * z + e[13]) * invW,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * invW
    );
  }

  projectToClip(v: Vec3): { x: number; y: number; z: number; w: number } {
    const e = this.elements;
    const x = v.x, y = v.y, z = v.z;
    return {
      x: e[0] * x + e[4] * y + e[8]  * z + e[12],
      y: e[1] * x + e[5] * y + e[9]  * z + e[13],
      z: e[2] * x + e[6] * y + e[10] * z + e[14],
      w: e[3] * x + e[7] * y + e[11] * z + e[15]
    };
  }
}

export class Ray {
  public origin: Vec3;
  public dir: Vec3;

  constructor(origin = new Vec3(), dir = new Vec3(0, 0, -1)) {
    this.origin = origin;
    this.dir = dir;
  }

  static fromCameraNDC(ndcX: number, ndcY: number, invViewProj: Mat4): Ray {
    const near = invViewProj.transformPoint(new Vec3(ndcX, ndcY, -1));
    const far = invViewProj.transformPoint(new Vec3(ndcX, ndcY, 1));
    const dir = far.clone().sub(near).normalize();
    return new Ray(near, dir);
  }

  intersectHorizontalPlane(planeY: number): Vec3 | null {
    if (Math.abs(this.dir.y) < 1e-8) {
      return null;
    }
    const t = (planeY - this.origin.y) / this.dir.y;
    if (t < 0) {
      return null;
    }
    return new Vec3(
      this.origin.x + this.dir.x * t,
      planeY,
      this.origin.z + this.dir.z * t
    );
  }

  intersectOBB(
    cx: number,
    cy: number,
    cz: number,
    hw: number,
    hh: number,
    hd: number,
    rotYRad: number
  ): number | null {
    const dx = this.origin.x - cx;
    const dy = this.origin.y - cy;
    const dz = this.origin.z - cz;

    const c = Math.cos(rotYRad);
    const s = Math.sin(rotYRad);

    const lox = dx * c - dz * s;
    const loy = dy;
    const loz = dx * s + dz * c;

    const ldx = this.dir.x * c - this.dir.z * s;
    const ldy = this.dir.y;
    const ldz = this.dir.x * s + this.dir.z * c;

    let tmin = -Infinity;
    let tmax = Infinity;

    // X slab
    if (Math.abs(ldx) < 1e-8) {
      if (lox < -hw || lox > hw) return null;
    } else {
      const invD = 1.0 / ldx;
      let t1 = (-hw - lox) * invD;
      let t2 = (hw - lox) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    // Y slab
    if (Math.abs(ldy) < 1e-8) {
      if (loy < -hh || loy > hh) return null;
    } else {
      const invD = 1.0 / ldy;
      let t1 = (-hh - loy) * invD;
      let t2 = (hh - loy) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    // Z slab
    if (Math.abs(ldz) < 1e-8) {
      if (loz < -hd || loz > hd) return null;
    } else {
      const invD = 1.0 / ldz;
      let t1 = (-hd - loz) * invD;
      let t2 = (hd - loz) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (tmax < 0) return null;
    return tmin < 0 ? 0 : tmin;
  }
}
