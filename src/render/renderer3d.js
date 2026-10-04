import { SUBLAYER } from './scene3d.js';
import { getSprite } from './sprites.js';
import { clamp } from '../core/util.js';

const LIGHT = normalize(-0.42, 0.36, 0.83);
const AMBIENT = 0.56;
const DIFFUSE = 0.52;
const SPECULAR_FLOOR = 0.06;
const MIN_W = 1e-3;

export const SKY_STOPS = {
  day: [[0, '#8fc4ea'], [0.55, '#c9e2f2'], [1, '#e6eef2']],
  dusk: [[0, '#2a3358'], [0.5, '#6b5a76'], [1, '#c98a63']],
  night: [[0, '#070a14'], [0.6, '#0e1526'], [1, '#182338']],
};

export class Renderer3D {
  constructor(canvas, world, scene, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.scene = scene;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.sky = 'day';
    this.fog = 0.0016;
    this.fogNear = 140;
    this.gridSpacing = 10;
    this.showGrid = true;
    this.showShadows = true;
    this.showFps = opts.showFps !== false;
    this.ambientBoost = 0;
    this.stats = { drawn: 0, culled: 0, sprites: 0, clipped: 0, cells: 0, ms: 0, fps: 0 };
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._selected = new Set();
    this._hovered = null;
  }

  resize(cssWidth, cssHeight, dpr = 1) {
    this.dpr = dpr;
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  setSelection(ids) {
    this._selected = new Set(Array.isArray(ids) ? ids.filter(Boolean) : ids ? [ids] : []);
  }

  setHovered(id) {
    this._hovered = id ?? null;
  }

  render(camera, opts = {}) {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(camera);
    if (this.showGrid) this.drawGrid(camera);
    camera.recompute();
    const box = camera.visibleBox();
    this.scene.ensureFor(box, opts.budgetMs ?? 6);
    const prims = opts.dynamic?.length ? this.scene.gather(box).concat(opts.dynamic) : this.scene.gather(box);
    const drawList = this.buildDrawList(prims, camera);
    this.paint(drawList, camera);
    if (this._selected.size || this._hovered) this.paintOutlines(drawList, camera);
    if (opts.overlay) opts.overlay(ctx, camera, this);
    ctx.restore();
    this._fpsAccum += performance.now() - t0;
    this._fpsFrames += 1;
    if (this._fpsAccum > 500) {
      this.stats.fps = Math.round((this._fpsFrames * 1000) / this._fpsAccum);
      this.stats.ms = +(this._fpsAccum / this._fpsFrames).toFixed(2);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    this.stats.cells = this.scene.cells.size;
    this.stats.pending = this.scene.stats.pending;
  }

  buildDrawList(prims, camera) {
    const m = camera.viewProj;
    const eye = camera.eye;
    this.nearPlane = Math.max(0.1, (camera.near ?? 0.5) * 1.2);
    const out = [];
    let culled = 0;
    let clipped = 0;
    let sprites = 0;
    for (const p of prims) {
      if (p.shadow && !this.showShadows) {
        culled += 1;
        continue;
      }
      if (p.kind === 'sprite') {
        const pr = this.projectPoint(m, eye, p.x, p.y, p.z || 0);
        if (!pr) {
          culled += 1;
          continue;
        }
        if (offScreen(pr.x, pr.y, this.width, this.height, 40)) {
          culled += 1;
          continue;
        }
        sprites += 1;
        out.push({ prim: p, kind: 'sprite', depth: pr.w, sx: pr.x, sy: pr.y, scale: spriteScale(camera, pr.w), shade: 1 });
        continue;
      }
      if (!p.pts || p.pts.length < 3) {
        culled += 1;
        continue;
      }
      const screen = this.projectPoly(m, eye, p.pts);
      if (!screen) {
        culled += 1;
        continue;
      }
      if (screen.clipped) clipped += 1;
      if (offScreenBox(screen.box, this.width, this.height)) {
        culled += 1;
        continue;
      }
      if (p.normal && !p.doubleSided && !p.shadow) {
        const facing = p.normal[0] * (eye.x - screen.centroid[0]) + p.normal[1] * (eye.y - screen.centroid[1]) + p.normal[2] * (eye.z - screen.centroid[2]);
        if (facing <= 0) {
          culled += 1;
          continue;
        }
      }
      let depth = 0;
      for (const q of screen.pts) depth += q[2];
      depth /= screen.pts.length;
      out.push({
        prim: p,
        kind: 'poly',
        depth,
        sub: p.sub ?? SUBLAYER.object,
        pts: screen.pts,
        fill: p.shadow ? 'rgba(12,14,18,0.26)' : this.shadeFor(p, camera),
      });
    }
    out.sort((a, b) => b.depth - a.depth || a.sub - b.sub);
    this.stats.drawn = out.length;
    this.stats.sprites = sprites;
    this.stats.clipped = clipped;
    this.stats.culled = culled;
    return out;
  }

  projectPoint(m, eye, x, y, z) {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) return null;
    return { x: (cx / cw * 0.5 + 0.5) * this.width, y: (0.5 - (cy / cw) * 0.5) * this.height, w: cw };
  }

  projectPoly(m, eye, pts) {
    const raw = [];
    let clipped = false;
    const push = (p) => {
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (!(cw > MIN_W)) return false;
      const sx = (cx / cw * 0.5 + 0.5) * this.width;
      const sy = (0.5 - (cy / cw) * 0.5) * this.height;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return false;
      raw.push([sx, sy, cw, p[0], p[1], p[2]]);
      return true;
    };
    for (const p of pts) {
      if (push(p)) continue;
      clipped = true;
      break;
    }
    if (clipped) {
      raw.length = 0;
      const rebuilt = clipNear(m, pts, this.nearPlane);
      if (!rebuilt || rebuilt.length < 3) return null;
      for (const p of rebuilt) {
        if (!push(p)) return null;
      }
    }
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (const q of raw) {
      if (q[0] < box.minX) box.minX = q[0];
      if (q[0] > box.maxX) box.maxX = q[0];
      if (q[1] < box.minY) box.minY = q[1];
      if (q[1] > box.maxY) box.maxY = q[1];
      gx += q[3];
      gy += q[4];
      gz += q[5];
    }
    const n = raw.length;
    return { pts: raw, box, clipped, centroid: [gx / n, gy / n, gz / n] };
  }

  paint(list, camera) {
    const ctx = this.ctx;
    for (const item of list) {
      if (item.kind === 'sprite') {
        this.drawSprite(item, camera);
        continue;
      }
      const p = item.prim;
      ctx.globalAlpha = p.alpha ?? 1;
      ctx.fillStyle = item.fill;
      ctx.beginPath();
      ctx.moveTo(item.pts[0][0], item.pts[0][1]);
      for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i][0], item.pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawSprite(item, camera) {
    const p = item.prim;
    const img = getSprite(p.sprite, p.variant ?? 0, p.tint || '#4f8f45');
    if (!img) return;
    const ctx = this.ctx;
    const w = Math.max(1, (p.width || 1) * item.scale);
    const h = Math.max(1, (p.height || 1) * item.scale);
    const fog = this.fogFactor(camera, item.depth);
    ctx.globalAlpha = (p.alpha ?? 1) * (1 - fog * 0.85);
    if (fog > 0.02) ctx.filter = `saturate(${(1 - fog).toFixed(3)})`;
    ctx.drawImage(img, item.sx - w / 2, item.sy - h, w, h);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  paintOutlines(list, camera) {
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    for (const item of list) {
      if (item.kind !== 'poly') continue;
      const id = item.prim.id;
      const selected = id && this._selected.has(id);
      const hovered = id && id === this._hovered;
      if (!selected && !hovered) continue;
      ctx.strokeStyle = selected ? '#ffd54a' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = selected ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(item.pts[0][0], item.pts[0][1]);
      for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i][0], item.pts[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  shadeFor(p, camera) {
    if (p.shadow) return 'rgba(12,14,18,0.26)';
    const alpha = p.alpha ?? 1;
    if (p.lit === false) return withAlpha(p.color, alpha);
    const n = p.normal;
    let k = AMBIENT + this.ambientBoost;
    if (n) {
      const d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      k += DIFFUSE * Math.max(0, d);
      if (d > 0.55) k += SPECULAR_FLOOR;
    } else {
      k += DIFFUSE * LIGHT[2];
    }
    return withAlpha(p.color, alpha, clamp(k, 0.12, 1.9));
  }

  fogFactor(camera, depth) {
    if (depth <= this.fogNear) return 0;
    return clamp((depth - this.fogNear) * this.fog, 0, 0.88);
  }

  drawSky(camera) {
    const ctx = this.ctx;
    const stops = SKY_STOPS[this.sky] || SKY_STOPS.day;
    const horizonY = this.horizonY(camera);
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, Math.max(1, horizonY));
    const base = stops[stops.length - 1][1];
    ctx.fillStyle = base;
    if (horizonY < this.height) ctx.fillRect(0, horizonY, this.width, this.height - horizonY);
  }

  horizonY(camera) {
    const horizon = camera.project(camera.x + Math.cos(camera.yaw) * 4000, camera.y + Math.sin(camera.yaw) * 4000, camera.z);
    if (!horizon) return this.height * 0.45;
    return clamp(horizon.y, -this.height, this.height * 2);
  }

  drawGrid(camera) {
    const ctx = this.ctx;
    const step = this.gridSpacing;
    if (!step) return;
    const box = camera.visibleBox();
    const maxLines = 260;
    const spanX = box.maxX - box.minX;
    const spanY = box.maxY - box.minY;
    const nx = Math.min(maxLines, Math.ceil(spanX / step));
    const ny = Math.min(maxLines, Math.ceil(spanY / step));
    const x0 = Math.round(box.minX / step) * step;
    const y0 = Math.round(box.minY / step) * step;
    ctx.lineWidth = 1;
    for (let i = 0; i <= nx; i++) {
      const wx = x0 + i * step;
      const a = camera.project(wx, box.minY, 0);
      const b = camera.project(wx, box.maxY, 0);
      if (!a || !b) continue;
      ctx.strokeStyle = this.gridColor(camera, wx, (box.minY + box.maxY) / 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 0; i <= ny; i++) {
      const wy = y0 + i * step;
      const a = camera.project(box.minX, wy, 0);
      const b = camera.project(box.maxX, wy, 0);
      if (!a || !b) continue;
      ctx.strokeStyle = this.gridColor(camera, (box.minX + box.maxX) / 2, wy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  gridColor(camera, wx, wy) {
    const major = Math.abs(wx % (this.gridSpacing * 10)) < 1e-6 || Math.abs(wy % (this.gridSpacing * 10)) < 1e-6;
    const d = Math.hypot(wx - camera.x, wy - camera.y);
    const fade = clamp(1 - d / (this.gridSpacing * 45), 0.06, 1);
    const alpha = (major ? 0.26 : 0.13) * fade;
    return `rgba(126,140,148,${alpha.toFixed(3)})`;
  }

  groundPolygon(points, fill, camera) {
    const ctx = this.ctx;
    const screen = this.projectPoly(camera.viewProj, camera.eye, points);
    if (!screen) return false;
    ctx.beginPath();
    ctx.moveTo(screen.pts[0][0], screen.pts[0][1]);
    for (let i = 1; i < screen.pts.length; i++) ctx.lineTo(screen.pts[i][0], screen.pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    return true;
  }

  groundBox(box, fill, camera) {
    return this.groundPolygon(
      [
        [box.minX, box.minY, 0],
        [box.maxX, box.minY, 0],
        [box.maxX, box.maxY, 0],
        [box.minX, box.maxY, 0],
      ],
      fill,
      camera
    );
  }

  pickAt(camera, sx, sy, dynamic = null) {
    const prims = this.scene.gather(camera.visibleBox());
    const list = this.buildDrawList(dynamic?.length ? prims.concat(dynamic) : prims, camera);
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item.kind !== 'poly') continue;
      if (pointInScreenPoly(sx, sy, item.pts)) return item.prim.id ?? null;
    }
    return null;
  }
}

function spriteScale(camera, w) {
  const focal = camera.height / (2 * Math.tan(camera.fov / 2));
  return focal / Math.max(0.001, w);
}

function withAlpha(color, alpha, scale = 1) {
  const r = clamp(Math.round(color[0] * scale), 0, 255);
  const g = clamp(Math.round(color[1] * scale), 0, 255);
  const b = clamp(Math.round(color[2] * scale), 0, 255);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function offScreen(x, y, w, h, margin) {
  return x < -margin || y < -margin || x > w + margin || y > h + margin;
}

function offScreenBox(box, w, h) {
  return box.maxX < 0 || box.minX > w || box.maxY < 0 || box.minY > h;
}

function normalize(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function clipNear(m, pts, near = 0.5) {
  const n = pts.length;
  const limit = Math.max(0.05, near);
  const w = new Array(n);
  const inside = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    w[i] = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    inside[i] = w[i] > limit;
  }
  if (inside.every(Boolean)) return pts;
  if (!inside.some(Boolean)) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (inside[i]) out.push(pts[i]);
    if (inside[i] !== inside[j]) {
      const t = (limit - w[i]) / (w[j] - w[i]);
      out.push([
        pts[i][0] + (pts[j][0] - pts[i][0]) * t,
        pts[i][1] + (pts[j][1] - pts[i][1]) * t,
        pts[i][2] + (pts[j][2] - pts[i][2]) * t,
      ]);
    }
  }
  return out.length >= 3 ? out : null;
}

function pointInScreenPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
