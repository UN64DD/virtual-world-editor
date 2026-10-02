import { clamp, dist, TAU, wrapAngle } from './util.js';

export const v2 = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const len2 = (a) => a.x * a.x + a.y * a.y;
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const perp = (a) => ({ x: -a.y, y: a.x });
export const fromAngle = (t, r = 1) => ({ x: Math.cos(t) * r, y: Math.sin(t) * r });
export const angleOf = (a) => Math.atan2(a.y, a.x);
export const rotate = (a, t) => ({
  x: a.x * Math.cos(t) - a.y * Math.sin(t),
  y: a.x * Math.sin(t) + a.y * Math.cos(t),
});

export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { d: Math.hypot(px - ax, py - ay), t: 0, x: ax, y: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { d: Math.hypot(px - x, py - y), t, x, y };
}

export function segIntersect(a1, a2, b1, b2) {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a1.x + rx * t, y: a1.y + ry * t, t, u };
}

export function segsIntersect(a1, a2, b1, b2) {
  return segIntersect(a1, a2, b1, b2) !== null;
}

export function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py) {
      const xint = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < xint) inside = !inside;
    }
  }
  return inside;
}

export function distToPolyEdge(px, py, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const d = distToSeg(px, py, a.x, a.y, b.x, b.y).d;
    if (d < best) best = d;
  }
  return best;
}

export function polyCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function polyPerimeter(poly) {
  let p = 0;
  for (let i = 0, n = poly.length; i < n; i++) p += dist(poly[i].x, poly[i].y, poly[(i + 1) % n].x, poly[(i + 1) % n].y);
  return p;
}

export function ensureCCW(poly) {
  return polyArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

export function ensureCW(poly) {
  return polyArea(poly) > 0 ? poly.slice().reverse() : poly.slice();
}

export function boundingBox(points) {
  if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function expandBox(b, m) {
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

export function boxIntersects(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function boxContainsPoint(b, x, y) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export function unionBox(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function pointSegmentDistance(px, py, a, b) {
  return distToSeg(px, py, a.x, a.y, b.x, b.y).d;
}

export function resample(points, spacing) {
  if (points.length < 2 || spacing <= 0) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: points[0].x, y: points[0].y }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    let segLen = dist(a.x, a.y, b.x, b.y);
    if (segLen < 1e-9) continue;
    let t0 = 0;
    while (carry + segLen - t0 >= spacing) {
      const need = spacing - carry;
      t0 += need;
      const t = t0 / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      carry = 0;
    }
    carry += segLen - t0;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (dist(tail.x, tail.y, last.x, last.y) > spacing * 0.35) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}

export function chaikin(points, iterations = 1, closed = false) {
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = pts.length;
    if (n < 3) return pts;
    if (!closed) out.push({ x: pts[0].x, y: pts[0].y });
    const limit = closed ? n : n - 1;
    for (let i = 0; i < limit; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    pts = out;
  }
  return pts;
}

export function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointSegmentDistance(points[i].x, points[i].y, points[i0], points[i1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > tolerance) {
      keep[idx] = true;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ x: p.x, y: p.y }));
}

export function simplifyPolyline(points, tolerance) {
  return douglasPeucker(points, tolerance);
}

export function polylineLength(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  return l;
}

export function offsetPolyline(points, offset, opts = {}) {
  const closed = !!opts.closed;
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const miters = opts.miter !== false;
  const limit = miters ? opts.miterLimit || 4 : 1;
  const out = [];
  const n = points.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) continue;
    const nx = -dy / l;
    const ny = dx / l;
    out.push({ x: a.x + nx * offset, y: a.y + ny * offset, nx, ny, sx: a.x, sy: a.y, ex: b.x, ey: b.y });
  }
  if (!closed) return out.map((p) => ({ x: p.x, y: p.y }));
  const result = [];
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length];
    const cur = out[i];
    const cross2 = prev.nx * cur.ny - prev.ny * cur.nx;
    let scale = 1;
    if (Math.abs(cross2) > 1e-6) {
      const cosHalf = prev.nx * cur.nx + prev.ny * cur.ny;
      scale = Math.min(limit, 1 / Math.max(0.2, Math.sqrt((1 + cosHalf) / 2)));
    }
    const mx = (prev.nx + cur.nx) * 0.5;
    const my = (prev.ny + cur.ny) * 0.5;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      result.push({ x: cur.sx, y: cur.sy });
    } else {
      result.push({ x: cur.sx + (mx / ml) * offset * scale, y: cur.sy + (my / ml) * offset * scale });
    }
  }
  return result;
}

export function offsetPolylineSides(points, offset) {
  return { left: offsetPolyline(points, -offset), right: offsetPolyline(points, offset) };
}

export function ribbonQuads(points, offsetA, offsetB) {
  const a = offsetPolyline(points, offsetA);
  const b = offsetPolyline(points, offsetB);
  const quads = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n - 1; i++) {
    quads.push([a[i], b[i], b[i + 1], a[i + 1]]);
  }
  return quads;
}

export function polylineTangents(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    out.push({ x: dx, y: dy, angle: Math.atan2(dy, dx), nx: -dy, ny: dx });
  }
  return out;
}

export function circlePoly(cx, cy, r, segments = 16, rotation = 0) {
  const out = [];
  for (let i = 0; i < segments; i++) {
    const a = rotation + (i / segments) * TAU;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

export function rectPoly(cx, cy, w, h, rotation = 0) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
}

export function smoothClosedPolygon(poly, iterations = 2) {
  if (poly.length < 4) return poly.map((p) => ({ x: p.x, y: p.y }));
  return chaikin(poly, iterations, true);
}

export function dedupePoints(points, eps = 0.05) {
  const out = [];
  for (const p of points) {
    if (!out.length || dist(out[out.length - 1].x, out[out.length - 1].y, p.x, p.y) > eps) out.push(p);
  }
  while (out.length > 1 && dist(out[0].x, out[0].y, out[out.length - 1].x, out[out.length - 1].y) <= eps) {
    out.pop();
  }
  return out;
}

export function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function bezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return norm({
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  });
}

export function cubicFromPoints(a, c1, c2, b, samples = 24) {
  const out = [];
  for (let i = 0; i <= samples; i++) out.push(bezierPoint(a, c1, c2, b, i / samples));
  return out;
}

export function angleBetweenPoints(a, b, c) {
  const ab = norm(sub(a, b));
  const cb = norm(sub(c, b));
  return Math.acos(clamp(dot(ab, cb), -1, 1));
}

export function headingTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function relativeBearing(from, to) {
  return wrapAngle(headingTo(from, to));
}

export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross2 = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
