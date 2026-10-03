import { clamp, lerp } from './util.js';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 80;
const ZOOM_LIMITS = [0.02, 0.05, 0.1, 0.2, 0.35, 0.6, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 40, 64, 80];

export class Camera2D {
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 2;
    this.width = opts.width ?? 800;
    this.height = opts.height ?? 600;
    this.minZoom = opts.minZoom ?? MIN_ZOOM;
    this.maxZoom = opts.maxZoom ?? MAX_ZOOM;
    this.minWorld = opts.minWorld ?? null;
    this.goal = null;
    this.vx = 0;
    this.vy = 0;
    this.friction = 0.0016;
    this.bounds = null;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  clampZoom(z) {
    return clamp(z, this.minZoom, this.maxZoom);
  }

  applyBounds() {
    const b = this.bounds;
    if (!b) return;
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    const spanX = b.maxX - b.minX;
    const spanY = b.maxY - b.minY;
    if (spanX <= halfW * 2) this.x = (b.minX + b.maxX) / 2;
    else this.x = clamp(this.x, b.minX + halfW, b.maxX - halfW);
    if (spanY <= halfH * 2) this.y = (b.minY + b.maxY) / 2;
    else this.y = clamp(this.y, b.minY + halfH, b.maxY - halfH);
  }

  toScreen(wx, wy, out = {}) {
    out.x = (wx - this.x) * this.zoom + this.width / 2;
    out.y = (wy - this.y) * this.zoom + this.height / 2;
    return out;
  }

  toWorld(sx, sy, out = {}) {
    out.x = (sx - this.width / 2) / this.zoom + this.x;
    out.y = (sy - this.height / 2) / this.zoom + this.y;
    return out;
  }

  screenVectorToWorld(dx, dy) {
    return { x: dx / this.zoom, y: dy / this.zoom };
  }

  worldToScreenLength(l) {
    return l * this.zoom;
  }

  screenToWorldLength(l) {
    return l / this.zoom;
  }

  panByPixels(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.goal = null;
    this.vx = 0;
    this.vy = 0;
    this.applyBounds();
  }

  flick(vxPixels, vyPixels) {
    this.vx = clamp(vxPixels, -6000, 6000);
    this.vy = clamp(vyPixels, -6000, 6000);
  }

  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    const next = this.clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    this.zoom = next;
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.goal = null;
    this.applyBounds();
  }

  setZoom(z, anchor) {
    const sx = anchor ? anchor.x : this.width / 2;
    const sy = anchor ? anchor.y : this.height / 2;
    this.zoomAt(sx, sy, clamp(z, this.minZoom, this.maxZoom) / this.zoom);
  }

  stepZoom(direction, anchor, anchorY) {
    let sx, sy;
    if (anchor && typeof anchor === 'object' && ('x' in anchor || 'y' in anchor)) {
      sx = anchor.x ?? this.width / 2;
      sy = anchor.y ?? this.height / 2;
    } else if (Number.isFinite(anchor) && Number.isFinite(anchorY)) {
      sx = anchor;
      sy = anchorY;
    } else {
      sx = this.width / 2;
      sy = this.height / 2;
    }
    const z = this.zoom;
    let target = z;
    if (direction > 0) {
      target = ZOOM_LIMITS.find((v) => v > z * 1.001) ?? this.maxZoom;
    } else {
      const lower = ZOOM_LIMITS.filter((v) => v < z * 0.999);
      target = lower.length ? lower[lower.length - 1] : this.minZoom;
    }
    this.animateZoom(target, { x: sx, y: sy }, 180);
  }

  animateTo(x, y, zoom, duration = 320) {
    this.goal = {
      x,
      y,
      zoom: this.clampZoom(zoom ?? this.zoom),
      t: 0,
      duration: Math.max(1, duration),
      from: { x: this.x, y: this.y, zoom: this.zoom },
    };
    this.vx = 0;
    this.vy = 0;
  }

  animateZoom(zoom, anchor, duration = 200) {
    const sx = anchor ? anchor.x : this.width / 2;
    const sy = anchor ? anchor.y : this.height / 2;
    const target = this.clampZoom(zoom);
    if (Math.abs(target - this.zoom) < 1e-6) return;
    const anchorWorld = this.toWorld(sx, sy);
    const endCenter = {
      x: anchorWorld.x - (sx - this.width / 2) / target,
      y: anchorWorld.y - (sy - this.height / 2) / target,
    };
    this.animateTo(endCenter.x, endCenter.y, target, duration);
  }

  fitBounds(box, padding = 60, duration = 320) {
    const w = Math.max(1e-3, box.maxX - box.minX);
    const h = Math.max(1e-3, box.maxY - box.minY);
    const availW = Math.max(32, this.width - padding * 2);
    const availH = Math.max(32, this.height - padding * 2);
    const zoom = this.clampZoom(Math.min(availW / w, availH / h));
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    if (duration > 0) this.animateTo(cx, cy, zoom, duration);
    else {
      this.x = cx;
      this.y = cy;
      this.zoom = zoom;
      this.goal = null;
    }
  }

  update(dtMs) {
    let active = false;
    if (this.goal) {
      const g = this.goal;
      g.t = Math.min(1, g.t + dtMs / g.duration);
      const e = g.t < 0.5 ? 4 * g.t * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 3) / 2;
      this.x = lerp(g.from.x, g.x, e);
      this.y = lerp(g.from.y, g.y, e);
      this.zoom = lerp(g.from.zoom, g.zoom, e);
      if (g.t >= 1) this.goal = null;
      active = true;
    }
    if (!this.goal && (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1)) {
      this.x -= this.vx * dtMs;
      this.y -= this.vy * dtMs;
      const decay = Math.exp(-this.friction * dtMs * 6);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.abs(this.vx) < 1) this.vx = 0;
      if (Math.abs(this.vy) < 1) this.vy = 0;
      this.applyBounds();
      active = true;
    }
    return active;
  }

  get animating() {
    return !!this.goal;
  }

  serialize() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  restore(state) {
    if (!state) return;
    this.x = state.x ?? this.x;
    this.y = state.y ?? this.y;
    this.zoom = this.clampZoom(state.zoom ?? this.zoom);
    this.goal = null;
  }

  niceScaleBar(targetPx = 110) {
    const raw = targetPx / this.zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const mult = n >= 5 ? 5 : n >= 2 ? 2 : 1;
    const worldLen = mult * pow;
    return { worldLen, px: worldLen * this.zoom };
  }

  visibleWorldBox(padding = 0) {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    return {
      minX: this.x - halfW - padding,
      minY: this.y - halfH - padding,
      maxX: this.x + halfW + padding,
      maxY: this.y + halfH + padding,
    };
  }
}
