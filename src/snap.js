import { distToSeg } from './core/geom.js';
import { DEG, clamp, wrapAngle } from './core/util.js';

export const SNAP_KIND = {
  none: 'none',
  node: 'node',
  road: 'road',
  vertex: 'vertex',
  prop: 'prop',
  grid: 'grid',
  angle: 'angle',
};

export class SnapEngine {
  constructor(world) {
    this.world = world;
    this.last = null;
  }

  reset() {
    this.last = null;
  }

  worldPoint(x, y, opts = {}) {
    const w = this.world;
    const settings = w.meta.settings || {};
    const gridEnabled = opts.grid ?? settings.snapGrid ?? 1;
    const doGrid = gridEnabled > 0;
    const tolerance = opts.tolerance ?? 12 / (opts.zoom || 2);
    const result = {
      x,
      y,
      snapped: false,
      kind: SNAP_KIND.none,
      target: null,
      guides: [],
      label: '',
    };

    if (opts.snapNode !== false) {
      const near = w.nearestNode(x, y, tolerance * 1.4);
      if (near) {
        result.x = near.node.x;
        result.y = near.node.y;
        result.snapped = true;
        result.kind = SNAP_KIND.node;
        result.target = near.node;
        result.label = 'junction';
        result.guides.push({ type: 'cross', x: near.node.x, y: near.node.y, size: tolerance * 0.9 });
        return result;
      }
    }

    if (opts.snapRoad !== false && (settings.snapRoad ?? true)) {
      const best = this.snapToRoad(x, y, tolerance);
      if (best) {
        result.x = best.x;
        result.y = best.y;
        result.snapped = true;
        result.kind = SNAP_KIND.road;
        result.target = best.road;
        result.label = best.road.name ? best.road.name : 'road';
        result.guides.push({ type: 'line', from: { x: best.x, y: best.y }, to: { x: best.anchorX, y: best.anchorY } });
        result.guides.push({ type: 'cross', x: best.x, y: best.y, size: tolerance * 0.7 });
        result.roadHit = best;
        return result;
      }
    }

    if (opts.snapVertex) {
      const near = this.snapToVertices(x, y, tolerance, opts.snapVertex);
      if (near) {
        result.x = near.x;
        result.y = near.y;
        result.snapped = true;
        result.kind = SNAP_KIND.vertex;
        result.target = near.object;
        result.guides.push({ type: 'square', x: near.x, y: near.y, size: tolerance * 0.8 });
        return result;
      }
    }

    if (doGrid) {
      const gx = Math.round(x / gridEnabled) * gridEnabled;
      const gy = Math.round(y / gridEnabled) * gridEnabled;
      if (Math.hypot(gx - x, gy - y) <= tolerance * 0.75) {
        result.x = gx;
        result.y = gy;
        result.snapped = true;
        result.kind = SNAP_KIND.grid;
        result.guides.push({ type: 'cross', x: gx, y: gy, size: tolerance * 0.5 });
      }
    }
    return result;
  }

  snapToRoad(x, y, tolerance) {
    const w = this.world;
    let best = null;
    for (const road of w.data.roads) {
      const pair = w.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const r = distToSeg(x, y, a.x, a.y, b.x, b.y);
      if (r.d > tolerance) continue;
      if (!best || r.d < best.d) {
        const dir = w.roadDirection(road, true);
        best = {
          x: r.x,
          y: r.y,
          d: r.d,
          road,
          anchorX: r.x,
          anchorY: r.y,
          heading: Math.atan2(dir.y, dir.x),
          t: r.t,
        };
      }
    }
    return best;
  }

  snapToVertices(x, y, tolerance, collections) {
    const w = this.world;
    let best = null;
    for (const key of collections) {
      const list = w.data[key] || [];
      for (const obj of list) {
        const pts = obj.poly || [{ x: obj.x, y: obj.y }];
        for (const p of pts) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d <= tolerance && (!best || d < best.d)) best = { x: p.x, y: p.y, d, object: obj };
        }
      }
    }
    return best;
  }

  constrains(rawPoint, reference, opts = {}) {
    const w = this.world;
    const step = (opts.angleStep ?? w.meta.settings.snapAngle ?? 15) * DEG;
    const mode = opts.constrain || 'none';
    const point = { x: rawPoint.x, y: rawPoint.y };
    const guides = [];
    if (!reference) return { x: point.x, y: point.y, guides, angle: null, mode: 'free' };
    let dx = point.x - reference.x;
    let dy = point.y - reference.y;
    let baseAngle = Math.atan2(dy, dx);
    let applied = 'free';
    if (mode === 'perp') {
      const refAngle = reference.angle ?? 0;
      const target = refAngle + Math.PI / 2;
      const delta = wrapAngle(target - baseAngle);
      if (Math.abs(delta) < 40 * DEG) {
        baseAngle = target;
        applied = 'perpendicular';
      }
    } else if (mode === 'parallel') {
      const refAngle = reference.angle ?? 0;
      const delta = wrapAngle(refAngle - baseAngle);
      if (Math.abs(delta) < 40 * DEG) {
        baseAngle = refAngle;
        applied = 'parallel';
      }
    } else if (mode === 'straight') {
      if (reference.angle !== undefined && reference.angle !== null) {
        const delta = wrapAngle(reference.angle - baseAngle);
        if (Math.abs(delta) < 40 * DEG) {
          baseAngle = reference.angle;
          applied = 'straight';
        }
      }
    }
    if (opts.angleSnap !== false && step > 0) {
      const snapped = Math.round(baseAngle / step) * step;
      if (Math.abs(wrapAngle(snapped - baseAngle)) < 22.5 * DEG) {
        baseAngle = snapped;
        applied = applied === 'free' ? 'angle' : `${applied}+angle`;
      }
    }
    const len = Math.hypot(dx, dy);
    point.x = reference.x + Math.cos(baseAngle) * len;
    point.y = reference.y + Math.sin(baseAngle) * len;
    guides.push({ type: 'ray', from: { x: reference.x, y: reference.y }, to: { x: point.x, y: point.y }, angle: baseAngle });
    return { x: point.x, y: point.y, guides, angle: baseAngle, mode: applied };
  }

  angleFromTwoPoints(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  candidateRoads(x, y, maxDist) {
    const w = this.world;
    const out = [];
    for (const road of w.data.roads) {
      const pair = w.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const r = distToSeg(x, y, a.x, a.y, b.x, b.y);
      if (r.d <= maxDist) out.push({ road, distance: r.d, point: { x: r.x, y: r.y } });
    }
    out.sort((p, q) => p.distance - q.distance);
    return out;
  }
}

export function snapToleranceFor(zoom, base = 12) {
  return clamp(base / Math.max(0.05, zoom), 0.15, 60);
}
