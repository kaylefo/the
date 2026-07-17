import { Vec3, clamp } from "./math.js";

const GRAVITY = new Vec3(0, -9.81, 0);
const _tmp = new Vec3();
const _tmp2 = new Vec3();
const _force = new Vec3();

export class SoftBody {
  constructor(geometry, options = {}) {
    this.positions = geometry.attributes.position.array;
    this.vertexCount = this.positions.length / 3;
    this.indices = geometry.index ? geometry.index.array : null;

    this.restScale = options.restScale ?? new Vec3(1, 0.88, 1);
    this.mass = options.mass ?? 0.18;
    this.pressure = options.pressure ?? 1.35;
    this.damping = options.damping ?? 0.985;
    this.groundY = options.groundY ?? 0;
    this.friction = options.friction ?? 0.42;

    this.points = [];
    this.springs = [];
    this.triangles = [];

    this.center = new Vec3();
    this.velocity = new Vec3();
    this.maxStrain = 0;
    this.totalRupture = 0;
    this.isResting = false;

    this._initPoints();
    this._initSprings(geometry);
    this._initTriangles();
    this._computeRestVolume();
  }

  _initPoints() {
    for (let i = 0; i < this.vertexCount; i++) {
      const x = this.positions[i * 3];
      const y = this.positions[i * 3 + 1];
      const z = this.positions[i * 3 + 2];

      const rest = new Vec3(
        x * this.restScale.x,
        y * this.restScale.y,
        z * this.restScale.z
      );

      const pinned = y > 0.72;

      this.points.push({
        pos: rest.clone(),
        prev: rest.clone(),
        rest: rest.clone(),
        invMass: pinned ? 0 : 1 / this.mass,
        pinned,
        strain: 0,
        ruptured: false,
      });
    }
  }

  _initSprings(geometry) {
    const edgeSet = new Set();
    const index = geometry.index.array;

    for (let i = 0; i < index.length; i += 3) {
      const a = index[i];
      const b = index[i + 1];
      const c = index[i + 2];
      this._addSpring(a, b, edgeSet, 1);
      this._addSpring(b, c, edgeSet, 1);
      this._addSpring(c, a, edgeSet, 1);
    }

    // Shear springs across faces for volumetric resistance
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i];
      const b = index[i + 1];
      const c = index[i + 2];
      this._addSpring(a, b, edgeSet, 1, 0.55);
      this._addSpring(b, c, edgeSet, 1, 0.55);
      this._addSpring(c, a, edgeSet, 1, 0.55);
    }

    // Long-range structural springs stabilize the bulk
    for (let i = 0; i < this.vertexCount; i++) {
      for (let j = i + 1; j < this.vertexCount; j++) {
        const pi = this.points[i].rest;
        const pj = this.points[j].rest;
        const dist = Vec3.sub(pi, pj, _tmp).length();
        if (dist > 0.25 && dist < 0.55) {
          this._addSpring(i, j, edgeSet, 0.35, 0.25);
        }
      }
    }
  }

  _addSpring(a, b, edgeSet, stiffness, maxStrain = 0.38) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    const pa = this.points[a].rest;
    const pb = this.points[b].rest;
    const restLength = Vec3.sub(pa, pb, _tmp).length();

    this.springs.push({
      a,
      b,
      restLength,
      stiffness,
      maxStrain,
      strain: 0,
      broken: false,
    });
  }

  _initTriangles() {
    if (!this.indices) return;
    for (let i = 0; i < this.indices.length; i += 3) {
      this.triangles.push([this.indices[i], this.indices[i + 1], this.indices[i + 2]]);
    }
  }

  _computeRestVolume() {
    let volume = 0;
    for (const [a, b, c] of this.triangles) {
      const pa = this.points[a].rest;
      const pb = this.points[b].rest;
      const pc = this.points[c].rest;
      volume += this._triple(pa, pb, pc);
    }
    this.restVolume = Math.abs(volume) / 6;
  }

  _triple(a, b, c) {
    return (
      a.x * (b.y * c.z - b.z * c.y) -
      a.y * (b.x * c.z - b.z * c.x) +
      a.z * (b.x * c.y - b.y * c.x)
    );
  }

  reset() {
    for (const p of this.points) {
      p.pos.copy(p.rest);
      p.prev.copy(p.rest);
      p.strain = 0;
      p.ruptured = false;
    }
    for (const s of this.springs) {
      s.strain = 0;
      s.broken = false;
    }
    this.velocity.set(0, 0, 0);
    this.maxStrain = 0;
    this.totalRupture = 0;
    this.isResting = false;
    this._syncGeometry();
  }

  translate(x, y, z) {
    for (const p of this.points) {
      p.rest.x += x;
      p.rest.y += y;
      p.rest.z += z;
      p.pos.x += x;
      p.pos.y += y;
      p.pos.z += z;
      p.prev.x += x;
      p.prev.y += y;
      p.prev.z += z;
    }
    for (const spring of this.springs) {
      const pa = this.points[spring.a].rest;
      const pb = this.points[spring.b].rest;
      spring.restLength = Vec3.sub(pa, pb, _tmp).length();
    }
    this._syncGeometry();
  }

  drop(height = 2.2) {
    for (const p of this.points) {
      p.pos.y += height;
      p.prev.y += height;
    }
    this.velocity.set(0, 0, 0);
    this.isResting = false;
  }

  applyImpulseAt(worldPoint, direction, strength) {
    _force.copy(direction).normalize().scale(strength);

    let nearest = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.pinned) continue;
      const d = Vec3.sub(p.pos, worldPoint, _tmp).length();
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }

    const falloff = clamp(1 - nearestDist / 0.55, 0, 1);
    if (falloff <= 0) return { strain: 0, rupture: false, point: null };

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.pinned) continue;
      const d = Vec3.sub(p.pos, worldPoint, _tmp).length();
      const w = Math.exp(-d * d * 8) * falloff;
      if (w < 0.01) continue;

      p.prev.x -= _force.x * w * 0.016;
      p.prev.y -= _force.y * w * 0.016;
      p.prev.z -= _force.z * w * 0.016;
    }

    const contact = this.points[nearest];
    return {
      strain: this.maxStrain,
      rupture: contact.strain > 0.72,
      point: contact.pos.clone(),
    };
  }

  step(dt, substeps = 6) {
    const subDt = dt / substeps;
    this.maxStrain = 0;
    let ruptureEvents = [];

    for (let s = 0; s < substeps; s++) {
      // Verlet integration + gravity
      for (const p of this.points) {
        if (p.invMass === 0) continue;

        const vx = (p.pos.x - p.prev.x) * this.damping;
        const vy = (p.pos.y - p.prev.y) * this.damping;
        const vz = (p.pos.z - p.prev.z) * this.damping;

        p.prev.copy(p.pos);
        p.pos.x += vx + GRAVITY.x * subDt * subDt;
        p.pos.y += vy + GRAVITY.y * subDt * subDt;
        p.pos.z += vz + GRAVITY.z * subDt * subDt;
      }

      // Spring constraints (multiple iterations for stiffness)
      for (let iter = 0; iter < 5; iter++) {
        for (const spring of this.springs) {
          if (spring.broken) continue;

          const pa = this.points[spring.a];
          const pb = this.points[spring.b];

          Vec3.sub(pb.pos, pa.pos, _tmp);
          const dist = _tmp.length();
          if (dist < 1e-6) continue;

          const strain = Math.abs(dist - spring.restLength) / spring.restLength;
          spring.strain = strain;
          this.maxStrain = Math.max(this.maxStrain, strain);

          if (strain > spring.maxStrain) {
            spring.broken = true;
            pa.ruptured = true;
            pb.ruptured = true;
            ruptureEvents.push({
              point: pa.pos.clone(),
              intensity: clamp((strain - spring.maxStrain) * 4, 0.2, 1),
            });
            continue;
          }

          const diff = (dist - spring.restLength) / dist;
          const stiffness = spring.stiffness * (1 - strain * 0.6);
          const correction = diff * 0.5 * stiffness;

          _tmp.scale(correction);

          if (pa.invMass > 0) {
            pa.pos.x += _tmp.x * pa.invMass;
            pa.pos.y += _tmp.y * pa.invMass;
            pa.pos.z += _tmp.z * pa.invMass;
          }
          if (pb.invMass > 0) {
            pb.pos.x -= _tmp.x * pb.invMass;
            pb.pos.y -= _tmp.y * pb.invMass;
            pb.pos.z -= _tmp.z * pb.invMass;
          }
        }

        this._applyPressure(subDt);
      }

      // Ground collision
      for (const p of this.points) {
        if (p.pos.y < this.groundY) {
          const penetration = this.groundY - p.pos.y;
          p.pos.y = this.groundY;

          const vy = p.pos.y - p.prev.y;
          p.prev.y = p.pos.y + vy * -this.friction;

          const vx = p.pos.x - p.prev.x;
          const vz = p.pos.z - p.prev.z;
          p.prev.x = p.pos.x - vx * this.friction;
          p.prev.z = p.pos.z - vz * this.friction;

          if (penetration > 0.02 && !p.ruptured) {
            p.strain = Math.max(p.strain, penetration * 8);
          }
        }
      }
    }

    this._updateCenter();
    this._syncGeometry();
    this.totalRupture = this.points.filter((p) => p.ruptured).length / this.points.length;

    return ruptureEvents;
  }

  _applyPressure(dt) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of this.points) {
      cx += p.pos.x;
      cy += p.pos.y;
      cz += p.pos.z;
    }
    const n = this.points.length;
    cx /= n;
    cy /= n;
    cz /= n;

    let currentVolume = 0;
    for (const [a, b, c] of this.triangles) {
      const pa = this.points[a].pos;
      const pb = this.points[b].pos;
      const pc = this.points[c].pos;
      currentVolume += this._triple(
        Vec3.sub(pa, new Vec3(cx, cy, cz), _tmp2),
        Vec3.sub(pb, new Vec3(cx, cy, cz), _tmp),
        Vec3.sub(pc, new Vec3(cx, cy, cz), _force)
      );
    }
    currentVolume = Math.abs(currentVolume) / 6;

    const volumeRatio = this.restVolume / Math.max(currentVolume, 1e-6);
    const pressureForce = clamp((volumeRatio - 1) * this.pressure, -2, 6);

    for (const p of this.points) {
      if (p.invMass === 0) continue;
      Vec3.sub(p.pos, new Vec3(cx, cy, cz), _tmp).normalize();
      const localPressure = p.ruptured ? pressureForce * 0.25 : pressureForce;
      p.pos.x += _tmp.x * localPressure * dt * 0.35;
      p.pos.y += _tmp.y * localPressure * dt * 0.35;
      p.pos.z += _tmp.z * localPressure * dt * 0.35;
    }
  }

  _updateCenter() {
    this.center.set(0, 0, 0);
    for (const p of this.points) this.center.add(p.pos);
    this.center.scale(1 / this.points.length);

    this.velocity.set(0, 0, 0);
    for (const p of this.points) {
      this.velocity.x += p.pos.x - p.prev.x;
      this.velocity.y += p.pos.y - p.prev.y;
      this.velocity.z += p.pos.z - p.prev.z;
    }
    this.velocity.scale(1 / this.points.length / 0.016);

    this.isResting =
      Math.abs(this.velocity.y) < 0.08 &&
      this.center.y < this.groundY + 0.95 &&
      this.maxStrain < 0.08;
  }

  _syncGeometry() {
    for (let i = 0; i < this.vertexCount; i++) {
      const p = this.points[i];
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
    }
  }

  getStrainPercent() {
    return clamp(this.maxStrain * 100, 0, 160);
  }
}
