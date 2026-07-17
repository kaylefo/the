export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  length() {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize() {
    const len = this.length();
    if (len > 1e-8) this.scale(1 / len);
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  static sub(a, b, out = new Vec3()) {
    return out.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  static add(a, b, out = new Vec3()) {
    return out.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  static scale(v, s, out = new Vec3()) {
    return out.set(v.x * s, v.y * s, v.z * s);
  }

  static lerp(a, b, t, out = new Vec3()) {
    return out.set(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t
    );
  }
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
