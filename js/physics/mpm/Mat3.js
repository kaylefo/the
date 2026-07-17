/** Column-major 3x3 matrix utilities for deformation gradient F and APIC affine C. */
export class Mat3 {
  constructor(m = null) {
    if (m) {
      this.m = new Float32Array(m);
    } else {
      this.m = new Float32Array(9);
      this.identity();
    }
  }

  identity() {
    const a = this.m;
    a[0] = 1; a[1] = 0; a[2] = 0;
    a[3] = 0; a[4] = 1; a[5] = 0;
    a[6] = 0; a[7] = 0; a[8] = 1;
    return this;
  }

  copy(o) {
    this.m.set(o.m);
    return this;
  }

  clone() {
    return new Mat3(this.m);
  }

  set(a00, a01, a02, a10, a11, a12, a20, a21, a22) {
    const a = this.m;
    a[0] = a00; a[1] = a01; a[2] = a02;
    a[3] = a10; a[4] = a11; a[5] = a12;
    a[6] = a20; a[7] = a21; a[8] = a22;
    return this;
  }

  static fromOuter(a, b, out = new Mat3()) {
    out.set(
      a[0] * b[0], a[0] * b[1], a[0] * b[2],
      a[1] * b[0], a[1] * b[1], a[1] * b[2],
      a[2] * b[0], a[2] * b[1], a[2] * b[2]
    );
    return out;
  }

  static add(A, B, out = new Mat3()) {
    for (let i = 0; i < 9; i++) out.m[i] = A.m[i] + B.m[i];
    return out;
  }

  static scale(A, s, out = new Mat3()) {
    for (let i = 0; i < 9; i++) out.m[i] = A.m[i] * s;
    return out;
  }

  static mul(A, B, out = new Mat3()) {
    const a = A.m, b = B.m, c = out.m;
    c[0] = a[0] * b[0] + a[3] * b[1] + a[6] * b[2];
    c[1] = a[1] * b[0] + a[4] * b[1] + a[7] * b[2];
    c[2] = a[2] * b[0] + a[5] * b[1] + a[8] * b[2];
    c[3] = a[0] * b[3] + a[3] * b[4] + a[6] * b[5];
    c[4] = a[1] * b[3] + a[4] * b[4] + a[7] * b[5];
    c[5] = a[2] * b[3] + a[5] * b[4] + a[8] * b[5];
    c[6] = a[0] * b[6] + a[3] * b[7] + a[6] * b[8];
    c[7] = a[1] * b[6] + a[4] * b[7] + a[7] * b[8];
    c[8] = a[2] * b[6] + a[5] * b[7] + a[8] * b[8];
    return out;
  }

  static mulVec(A, v, out = new Float32Array(3)) {
    const a = A.m;
    out[0] = a[0] * v[0] + a[3] * v[1] + a[6] * v[2];
    out[1] = a[1] * v[0] + a[4] * v[1] + a[7] * v[2];
    out[2] = a[2] * v[0] + a[5] * v[1] + a[8] * v[2];
    return out;
  }

  static transpose(A, out = new Mat3()) {
    const a = A.m, c = out.m;
    c[0] = a[0]; c[1] = a[3]; c[2] = a[6];
    c[3] = a[1]; c[4] = a[4]; c[5] = a[7];
    c[6] = a[2]; c[7] = a[5]; c[8] = a[8];
    return out;
  }

  static det(A) {
    const a = A.m;
    return (
      a[0] * (a[4] * a[8] - a[5] * a[7]) -
      a[3] * (a[1] * a[8] - a[2] * a[7]) +
      a[6] * (a[1] * a[5] - a[2] * a[4])
    );
  }

  static invert(A, out = new Mat3()) {
    const a = A.m, c = out.m;
    const d = Mat3.det(A);
    if (Math.abs(d) < 1e-12) return out.identity();
    const inv = 1 / d;
    c[0] = (a[4] * a[8] - a[5] * a[7]) * inv;
    c[1] = (a[2] * a[7] - a[1] * a[8]) * inv;
    c[2] = (a[1] * a[5] - a[2] * a[4]) * inv;
    c[3] = (a[5] * a[6] - a[3] * a[8]) * inv;
    c[4] = (a[0] * a[8] - a[2] * a[6]) * inv;
    c[5] = (a[2] * a[3] - a[0] * a[5]) * inv;
    c[6] = (a[3] * a[7] - a[4] * a[6]) * inv;
    c[7] = (a[1] * a[6] - a[0] * a[7]) * inv;
    c[8] = (a[0] * a[4] - a[1] * a[3]) * inv;
    return out;
  }

  static addScaledIdentity(A, s, out = new Mat3()) {
    out.copy(A);
    out.m[0] += s; out.m[4] += s; out.m[8] += s;
    return out;
  }
}

export function vec3Add(a, b, o = new Float32Array(3)) {
  o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o;
}

export function vec3Sub(a, b, o = new Float32Array(3)) {
  o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o;
}

export function vec3Scale(a, s, o = new Float32Array(3)) {
  o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o;
}

export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Len(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
