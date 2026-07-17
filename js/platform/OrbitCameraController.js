import * as THREE from "three";

/**
 * Damped spherical orbit camera around a target point.
 * Supports programmatic sway override when idle.
 */
export class OrbitCameraController {
  constructor(camera, options = {}) {
    this.camera = camera;
    this.target = options.target?.clone() ?? new THREE.Vector3(0, 0.35, 0);
    this.minDistance = options.minDistance ?? 0.85;
    this.maxDistance = options.maxDistance ?? 3.8;
    this.minPolarAngle = options.minPolarAngle ?? 0.25;
    this.maxPolarAngle = options.maxPolarAngle ?? 1.35;
    this.rotateSpeed = options.rotateSpeed ?? 0.005;
    this.zoomSpeed = options.zoomSpeed ?? 0.0012;
    this.damping = options.damping ?? 0.1;

    this.spherical = new THREE.Spherical();
    this.sphericalDelta = { theta: 0, phi: 0 };
    this.zoomDelta = 0;
    this.userActive = false;
    this._idleTimer = 0;

    this._syncFromCamera();
  }

  _syncFromCamera() {
    const offset = this.camera.position.clone().sub(this.target);
    this.spherical.setFromVector3(offset);
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, this.minPolarAngle, this.maxPolarAngle);
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius, this.minDistance, this.maxDistance);
  }

  reset(defaultOffset = { x: 0.69, y: 0.5, z: 1.25 }) {
    this.sphericalDelta.theta = 0;
    this.sphericalDelta.phi = 0;
    this.zoomDelta = 0;
    this.userActive = false;
    this._idleTimer = 0;
    this.camera.position.set(defaultOffset.x, defaultOffset.y, defaultOffset.z);
    this._syncFromCamera();
    this.apply(true);
  }

  /** @param {number} dx - pixels */
  rotate(dx, dy) {
    this.userActive = true;
    this._idleTimer = 0;
    this.sphericalDelta.theta -= dx * this.rotateSpeed;
    this.sphericalDelta.phi -= dy * this.rotateSpeed;
  }

  /** @param {number} delta - wheel delta Y */
  zoom(delta) {
    this.userActive = true;
    this._idleTimer = 0;
    this.zoomDelta += delta * this.zoomSpeed;
  }

  /** Optional idle cinematic sway when user hasn't orbited recently. */
  applySway(time, amplitude = 0.02) {
    if (this.userActive) return;
    this.spherical.theta = this.spherical.theta + Math.sin(time * 0.15) * amplitude * 0.002;
  }

  apply(force = false) {
    if (!force && this.sphericalDelta.theta === 0 && this.sphericalDelta.phi === 0 && this.zoomDelta === 0) {
      return;
    }

    const d = force ? 1 : this.damping;
    this.spherical.theta += this.sphericalDelta.theta * d;
    this.spherical.phi += this.sphericalDelta.phi * d;
    this.spherical.radius *= 1 + this.zoomDelta * d;

    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, this.minPolarAngle, this.maxPolarAngle);
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius, this.minDistance, this.maxDistance);

    this.sphericalDelta.theta *= 1 - d;
    this.sphericalDelta.phi *= 1 - d;
    this.zoomDelta *= 1 - d;

    if (Math.abs(this.sphericalDelta.theta) < 1e-6) this.sphericalDelta.theta = 0;
    if (Math.abs(this.sphericalDelta.phi) < 1e-6) this.sphericalDelta.phi = 0;
    if (Math.abs(this.zoomDelta) < 1e-6) this.zoomDelta = 0;

    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  update(dt, time = 0) {
    if (this.userActive) {
      this._idleTimer += dt;
      if (this._idleTimer > 8) this.userActive = false;
    }
    this.applySway(time);
    this.apply();
  }

  setTarget(y) {
    this.target.y = y;
  }
}
