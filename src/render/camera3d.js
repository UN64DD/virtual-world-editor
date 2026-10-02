import { clamp, lerp } from '../core/util.js';
import { cross3, mat4Multiply, mat4Perspective, mat4ViewFromAxes } from '../core/mat4.js';

const MIN_PITCH = 0.02;
const MAX_PITCH = Math.PI / 2 - 0.015;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 4000;

export const VIEW_MODE = {
  perspective: 'perspective',
  topDown: 'topDown',
  follow: 'follow',
};

export class Camera3D {
  constructor(opts = {}) {
    this.targetX = opts.targetX ?? 0;
    this.targetY = opts.targetY ?? 0;
    this.targetZ = opts.targetZ ?? 0;
    this.targetYaw = opts.targetYaw ?? Math.PI / 2;
    this.targetPitch = opts.targetPitch ?? 0.62;
    this.targetDistance = opts.targetDistance ?? 160;

    this.x = this.targetX;
    this.y = this.targetY;
    this.z = this.targetZ;
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.distance = this.targetDistance;

    this.width = opts.width ?? 800;
    this.height = opts.height ?? 600;
    this.fov = opts.fov ?? 0.9;
    this.near = opts.near ?? 0.5;
    this.far = opts.far ?? 6000;

    this.minPitch = MIN_PITCH;
    this.maxPitch = MAX_PITCH;
    this.minDistance = opts.minDistance ?? MIN_DISTANCE;
    this.maxDistance = opts.maxDistance ?? MAX_DISTANCE;

    this.mode = opts.mode ?? VIEW_MODE.perspective;
    this.goal = null;
    this.vx = 0;
    this.vy = 0;
    this.flight = null;

    this.view = new Float64Array(16);
    this.proj = new Float64Array(16);
    this.viewProj = new Float64Array(16);
    this.eye = { x: 0, y: 0, z: 0 };
    this.settled = true;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  clampPitch(p) {
    return clamp(p, this.minPitch, this.maxPitch);
  }

  clampDistance(d) {
    return clamp(d, this.minDistance, this.maxDistance);
  }

  get aspect() {
    return this.width / this.height;
  }

  isTopDown() {
    return this.pitch > this.maxPitch - 0.02;
  }

  update(dtMs) {
    let active = false;
    if (this.goal) {
      const g = this.goal;
      g.t = Math.min(1, g.t + dtMs / g.duration);
      const e = easeInOutCubic(g.t);
      this.targetX = lerp(g.from.x, g.x, e);
      this.targetY = lerp(g.from.y, g.y, e);
      this.targetZ = lerp(g.from.z, g.z, e);
      this.targetYaw = lerpAngle(g.from.yaw, g.yaw, e);
      this.targetPitch = lerp(g.from.pitch, g.pitch, e);
      this.targetDistance = lerp(g.from.distance, g.distance, e);
      if (g.t >= 1) this.goal = null;
      active = true;
    }

    if (!this.goal && (Math.abs(this.vx) > 0.4 || Math.abs(this.vy) > 0.4)) {
      const scale = this.distance * 0.0016;
      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      this.targetX += (this.vx * cos - this.vy * sin) * scale;
      this.targetY += (this.vx * sin + this.vy * cos) * scale;
      const decay = Math.exp(-0.012 * dtMs);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.abs(this.vx) < 0.4) this.vx = 0;
      if (Math.abs(this.vy) < 0.4) this.vy = 0;
      active = true;
    }

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dtMs / f.duration);
      const e = easeInOutCubic(f.t);
      for (const car of f.cars) {
        if (car.removed) continue;
        car.x = lerp(car.fromX, car.toX, e);
        car.y = lerp(car.fromY, car.toY, e);
        if (!f.keepHeading) car.heading = lerpAngle(car.fromHeading, car.toHeading, e);
      }
      if (f.t >= 1) this.flight = null;
      active = true;
    }

    const k = this.goal ? 1 : 0.22;
    const before = this.x + this.y + this.z + this.yaw + this.pitch + this.distance;
    this.x = lerp(this.x, this.targetX, k);
    this.y = lerp(this.y, this.targetY, k);
    this.z = lerp(this.z, this.targetZ, k);
    this.yaw = lerpAngle(this.yaw, this.targetYaw, k);
    this.pitch = lerp(this.pitch, this.clampPitch(this.targetPitch), k);
    this.distance = lerp(this.distance, this.clampDistance(this.targetDistance), k);
    const after = this.x + this.y + this.z + this.yaw + this.pitch + this.distance;
    if (Math.abs(after - before) > 1e-4) active = true;
    this.settled = !active;

    this.recompute();
    return active;
  }

  recompute() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.eye.x = this.x + cy * cp * this.distance;
    this.eye.y = this.y + sy * cp * this.distance;
    this.eye.z = this.z + sp * this.distance;
    if (this.isTopDown()) this.eye.z = Math.max(this.eye.z, this.z + 4);
    this.fwd = { x: -cy * cp, y: -sy * cp, z: -sp };
    this.right = { x: sy, y: -cy, z: 0 };
    this.back = { x: -this.fwd.x, y: -this.fwd.y, z: -this.fwd.z };
    this.up = cross3(this.fwd, this.right);
    const ul = Math.hypot(this.up.x, this.up.y, this.up.z) || 1;
    this.up.x /= ul;
    this.up.y /= ul;
    this.up.z /= ul;
    mat4ViewFromAxes(this.eye, this.right, this.up, this.back, this.view);
    mat4Perspective(this.fov, this.aspect, this.near, this.far, this.proj);
    mat4Multiply(this.proj, this.view, this.viewProj);
  }

  project(wx, wy, wz) {
    const m = this.viewProj;
    const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
    const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    if (cw <= 1e-4) return null;
    return {
      x: (cx / cw * 0.5 + 0.5) * this.width,
      y: (0.5 - (cy / cw) * 0.5) * this.height,
      w: cw,
    };
  }

  unproject(sx, sy, wz = 0) {
    const ndcX = (sx / this.width) * 2 - 1;
    const ndcY = 1 - (sy / this.height) * 2;
    const tanF = Math.tan(this.fov / 2);
    const dirX = ndcX * tanF * this.aspect;
    const dirY = ndcY * tanF;
    const dx = this.fwd.x + this.right.x * dirX + this.up.x * dirY;
    const dy = this.fwd.y + this.right.y * dirX + this.up.y * dirY;
    const dz = this.fwd.z + this.right.z * dirX + this.up.z * dirY;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const denom = (dx * (this.eye.x - this.x) + dy * (this.eye.y - this.y) + dz * (this.eye.z - this.z)) / dl;
    if (Math.abs(denom) < 1e-9) return null;
    const t = (wz - this.eye.z) / (dz / dl);
    if (!Number.isFinite(t)) return null;
    return { x: this.eye.x + (dx / dl) * t, y: this.eye.y + (dy / dl) * t };
  }

  groundAt(sx, sy) {
    return this.unproject(sx, sy, 0);
  }

  orbitBy(dx, dy) {
    this.targetYaw -= dx * 0.0055;
    this.targetPitch = this.clampPitch(this.targetPitch + dy * 0.0045);
    this.goal = null;
  }

  zoomBy(factor) {
    this.targetDistance = this.clampDistance(this.targetDistance * factor);
    this.goal = null;
  }

  panByPixels(dx, dy) {
    const scale = this.distance * 0.0016;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.targetX += (-dx * cos - dy * sin) * scale;
    this.targetY += (-dx * sin + dy * cos) * scale;
    this.goal = null;
  }

  flick(vxPixels, vyPixels) {
    this.vx = clamp(vxPixels, -4000, 4000);
    this.vy = clamp(vyPixels, -4000, 4000);
  }

  flyTo(x, y, z, opts = {}) {
    const duration = opts.duration ?? 420;
    this.goal = {
      x,
      y,
      z: z ?? this.targetZ,
      yaw: opts.yaw ?? this.targetYaw,
      pitch: this.clampPitch(opts.pitch ?? this.targetPitch),
      distance: this.clampDistance(opts.distance ?? this.targetDistance),
      t: 0,
      duration: Math.max(1, duration),
      from: {
        x: this.targetX,
        y: this.targetY,
        z: this.targetZ,
        yaw: this.targetYaw,
        pitch: this.targetPitch,
        distance: this.targetDistance,
      },
    };
    this.vx = 0;
    this.vy = 0;
  }

  topDown(on = true) {
    this.flyTo(this.targetX, this.targetY, this.targetZ, {
      pitch: on ? MAX_PITCH - 0.001 : 0.62,
      distance: on ? this.targetDistance * 1.4 : this.targetDistance,
      duration: 420,
    });
  }

  setMode(mode) {
    this.mode = mode;
  }

  serialize() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      mode: this.mode,
    };
  }

  restore(state) {
    if (!state) return;
    if (Number.isFinite(state.x)) this.x = this.targetX = state.x;
    if (Number.isFinite(state.y)) this.y = this.targetY = state.y;
    if (Number.isFinite(state.z)) this.z = this.targetZ = state.z;
    if (Number.isFinite(state.yaw)) this.yaw = this.targetYaw = state.yaw;
    if (Number.isFinite(state.pitch)) this.pitch = this.targetPitch = this.clampPitch(state.pitch);
    if (Number.isFinite(state.distance)) this.distance = this.targetDistance = this.clampDistance(state.distance);
    if (state.mode) this.mode = state.mode;
    this.goal = null;
    this.recompute();
  }

  visibleBox() {
    const r = Math.max(this.x, this.y) - Math.min(this.x, this.y) + this.distance * 2;
    const half = Math.max(60, r * 0.6);
    return {
      minX: this.x - half,
      minY: this.y - half,
      maxX: this.x + half,
      maxY: this.y + half,
    };
  }

  get animating() {
    return !!this.goal || !!this.flight || Math.abs(this.vx) > 0.4 || Math.abs(this.vy) > 0.4;
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
