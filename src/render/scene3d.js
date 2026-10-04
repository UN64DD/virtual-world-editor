import { boundingBox, boxIntersects, norm } from '../core/geom.js';
import { hexToRgb, shade } from '../core/util.js';
import { PROP_KINDS, ROAD_CLASSES, SURFACE_KINDS, VEHICLE_PRESETS } from '../model/schema.js';
import { nodeClearance } from '../model/paint.js';
import { laneBoundaryLines } from '../model/network.js';
import { spriteVariant } from './sprites.js';

export const SUBLAYER = {
  terrain: 0,
  sidewalk: 1,
  road: 2,
  junction: 3,
  marking: 4,
  object: 6,
  vehicle: 8,
  overlay: 12,
};

export const CELL = 72;

const C = {
  sidewalk: '#a9a49b',
  median: '#b7babd',
  curb: '#8b8781',
  window: '#3b5170',
  windowLit: '#f0e3ae',
  wheel: '#15181c',
  line: '#f3f1ea',
  lineYellow: '#f3c33f',
  stop: '#f6f4ee',
  roofDefault: '#8c5a48',
};

function rgb(hex) {
  const c = hexToRgb(hex);
  return [c.r, c.g, c.b];
}

function centroidCellKey(box) {
  return `${Math.floor((box.minX + box.maxX) / 2 / CELL)},${Math.floor((box.minY + box.maxY) / 2 / CELL)}`;
}

/** Flat quad footprint of a rotated rectangle, for ground shadows. */
function quadPts(cx, cy, len, wid, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const half = len / 2;
  const hw = wid / 2;
  return [
    [-half, -hw],
    [half, -hw],
    [half, hw],
    [-half, hw],
  ].map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
}

function pushAll(dst, src) {
  for (const p of src) dst.push(p);
  return dst;
}

function pointCellKey(x, y) {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
}

export class Scene3D {
  constructor(world, network) {
    this.world = world;
    this.network = network;
    this.cells = new Map();
    this.revision = -1;
    this.settings = null;
    this.shadows = true;
    this.floorBands = true;
    this.junctionDetails = true;
    this.stats = { cells: 0, prims: 0, pending: 0 };
  }

  setSettings(settings) {
    this.settings = settings;
  }

  invalidate() {
    this.cells.clear();
    this.revision = this.world.revision;
  }

  ensureFor(box, budgetMs = 6) {
    if (this.revision !== this.world.revision) this.invalidate();
    const x0 = Math.floor(box.minX / CELL);
    const x1 = Math.floor(box.maxX / CELL);
    const y0 = Math.floor(box.minY / CELL);
    const y1 = Math.floor(box.maxY / CELL);
    let pending = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        if (!this.cells.has(`${cx},${cy}`)) pending += 1;
      }
    }
    const start = performance.now();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        if (this.cells.has(key)) continue;
        this.cells.set(key, this.buildCell(cx, cy));
        pending -= 1;
        if (performance.now() - start > budgetMs) break;
      }
      if (performance.now() - start > budgetMs) break;
    }
    this.stats = { cells: this.cells.size, pending, built: this.world.revision };
  }

  /**
   * Vehicles move every frame, so they are not baked into the static cells.
   * This builds their prisms on demand from live world positions.
   */
  vehiclePrims(vehicles = this.world.data.vehicles) {
    const prims = [];
    for (const v of vehicles) {
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.yaw)) continue;
      if (!this.layerVisible(v.layerId)) continue;
      const preset = VEHICLE_PRESETS[v.kind] || VEHICLE_PRESETS.car;
      const color = v.color || preset.color;
      const len = v.length || preset.length;
      const wid = v.width || preset.width;
      const h = v.height || preset.height;
      pushAll(prims, this.vehiclePrism(v, color, len, wid, h));
    }
    return prims;
  }

  /** One vehicle: ground shadow, lower body, cabin, and a windscreen face. */
  vehiclePrism(v, color, len, wid, h) {
    const out = [];
    const wheel = h * 0.26;
    if (this.shadows) {
      out.push({
        kind: 'poly',
        sub: SUBLAYER.terrain,
        pts: quadPts(v.x + h * 0.12, v.y + h * 0.1, len * 1.02, wid * 1.05, v.yaw).map(([x, y]) => [x, y, 0.014]),
        color: [0, 0, 0],
        alpha: 0.22,
        lit: false,
        shadow: true,
        tag: 'shadow',
        id: v.id,
      });
    }
    pushAll(out, this.boxPrism(v.x, v.y, wheel * 0.55, len, wid, wheel, color, v.yaw, false, SUBLAYER.vehicle, 'vehicle', v.id));
    // Cabin: shorter and set back, tapering to the roof like a greenhouse.
    const boxy = v.kind === 'bus' || v.kind === 'truck';
    const cabinLen = Math.max(1.2, len * (boxy ? 0.72 : 0.46));
    const cabinWid = wid * (boxy ? 0.94 : 0.86);
    const offset = boxy ? -len * 0.1 : len * 0.04;
    const cabinX = v.x + Math.cos(v.yaw) * offset;
    const cabinY = v.y + Math.sin(v.yaw) * offset;
    const cabinH = Math.max(0.3, h - wheel * 1.1);
    pushAll(
      out,
      this.boxPrism(cabinX, cabinY, wheel * 0.55 + wheel, cabinLen, cabinWid, cabinH, shade(color, 0.06), v.yaw, !boxy, SUBLAYER.vehicle, 'vehicle', v.id)
    );
    // Glass band so the cabin reads as windows from a distance.
    const glass = '#2b3a44';
    pushAll(
      out,
      this.boxPrism(cabinX, cabinY, wheel * 0.55 + wheel + cabinH * 0.35, cabinLen * 0.94, cabinWid + 0.02, cabinH * 0.34, glass, v.yaw, false, SUBLAYER.vehicle, 'vehicle', v.id)
    );
    return out;
  }

  gather(box) {
    const x0 = Math.floor((box.minX - CELL) / CELL);
    const x1 = Math.floor((box.maxX + CELL) / CELL);
    const y0 = Math.floor((box.minY - CELL) / CELL);
    const y1 = Math.floor((box.maxY + CELL) / CELL);
    const out = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const prims = this.cells.get(`${cx},${cy}`);
        if (prims) for (const p of prims) out.push(p);
      }
    }
    return out;
  }

  buildCell(cx, cy) {
    const box = { minX: cx * CELL, minY: cy * CELL, maxX: (cx + 1) * CELL, maxY: (cy + 1) * CELL };
    const prims = [];
    this.buildTerrain(box, prims);
    this.buildRoadChunk(cx, cy, box, prims);
    this.buildBuildings(cx, cy, box, prims);
    this.buildProps(cx, cy, box, prims);
    return prims;
  }

  buildTerrain(box, prims) {
    const w = this.world;
    for (const s of w.data.surfaces) {
      if (!this.layerVisible(s.layerId)) continue;
      const sb = boundingBox(s.poly);
      if (!boxIntersects(sb, box)) continue;
      const preset = SURFACE_KINDS[s.kind] || SURFACE_KINDS.grass;
      const z = s.z ?? preset.z;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.terrain,
        pts: s.poly.map((p) => [p.x, p.y, z]),
        color: rgb(s.color || preset.color),
        alpha: s.kind === 'water' ? 0.9 : 1,
        lit: false,
        tag: 'surface',
        id: s.id,
      });
    }
  }

  buildRoadChunk(cx, cy, box, prims) {
    const w = this.world;
    for (const road of w.data.roads) {
      const pair = w.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pointCellKey(mid.x, mid.y) !== `${cx},${cy}`) continue;
      const pad = w.roadWidth(road) / 2 + 14;
      if (!boxIntersects({ minX: mid.x - pad, minY: mid.y - pad, maxX: mid.x + pad, maxY: mid.y + pad }, box)) continue;
      this.emitRoad(prims, road);
    }
    for (const node of w.data.nodes) {
      if (pointCellKey(node.x, node.y) !== `${cx},${cy}`) continue;
      const roads = w.roadsAtNode(node.id);
      if (roads.length < 2) continue;
      const poly = this.network.junctionPoly(node.id);
      if (!poly || poly.length < 3) continue;
      let widest = roads[0];
      for (const r of roads) if (w.roadWidth(r) > w.roadWidth(widest)) widest = r;
      const info = ROAD_CLASSES[widest.cls] || ROAD_CLASSES.residential;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.junction,
        pts: poly.map((p) => [p.x, p.y, 0.015]),
        color: rgb(info.fill),
        lit: false,
        alpha: 1,
        tag: 'junction',
        id: node.id,
      });
      if (this.junctionDetails) this.emitJunctionDetails(prims, node);
    }
  }

  emitRoad(prims, road) {
    const w = this.world;
    const info = ROAD_CLASSES[road.cls] || ROAD_CLASSES.residential;
    const dir = w.roadDirection(road, true);
    const len = dir.length;
    if (len < 0.2) return;
    const half = w.roadWidth(road) / 2;
    const n = norm({ x: -dir.y, y: dir.x });
    const p0 = dir.start;
    const p1 = dir.end;
    prims.push({
      kind: 'poly',
      sub: SUBLAYER.road,
      pts: [
        [p0.x + n.x * half, p0.y + n.y * half, 0.03],
        [p1.x + n.x * half, p1.y + n.y * half, 0.03],
        [p1.x - n.x * half, p1.y - n.y * half, 0.03],
        [p0.x - n.x * half, p0.y - n.y * half, 0.03],
      ],
      color: rgb(info.fill),
      lit: false,
      alpha: 1,
      tag: 'road',
      id: road.id,
    });
    const hasSidewalk = info.access !== 'foot' && road.sidewalk !== false && this.settings?.sidewalks !== false;
    if (hasSidewalk) this.emitSidewalk(prims, road, p0, p1, n, half);
    if (road.divider === 'median' && info.access !== 'foot') {
      prims.push(this.flatBand(dir, n, 0, len, 0.55, 0.02, C.median, SUBLAYER.road, road.id, 'median'));
    }
    if (info.access !== 'foot') this.emitLaneMarkings(prims, road, dir, n);
  }

  emitSidewalk(prims, road, p0, p1, n, half) {
    const sw = 1.9;
    for (const sign of [1, -1]) {
      const inner = half;
      const outer = half + sw;
      const a = { x: p0.x + n.x * sign * inner, y: p0.y + n.y * sign * inner };
      const b = { x: p1.x + n.x * sign * inner, y: p1.y + n.y * sign * inner };
      const c2 = { x: p1.x + n.x * sign * outer, y: p1.y + n.y * sign * outer };
      const d = { x: p0.x + n.x * sign * outer, y: p0.y + n.y * sign * outer };
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.sidewalk,
        pts: [
          [a.x, a.y, 0.15],
          [b.x, b.y, 0.15],
          [c2.x, c2.y, 0.15],
          [d.x, d.y, 0.15],
        ],
        color: rgb(C.sidewalk),
        lit: false,
        alpha: 1,
        tag: 'sidewalk',
        id: road.id,
      });
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.sidewalk,
        pts: [
          [a.x, a.y, 0.0],
          [b.x, b.y, 0.0],
          [b.x, b.y, 0.15],
          [a.x, a.y, 0.15],
        ],
        color: rgb(C.curb),
        lit: true,
        alpha: 1,
        tag: 'curb',
        id: road.id,
      });
    }
  }

  emitLaneMarkings(prims, road, dir, n) {
    const w = this.world;
    const len = dir.length;
    const clearA = nodeClearance(w, road.a);
    const clearB = nodeClearance(w, road.b);
    const s0 = Math.min(clearA, len * 0.45);
    const s1 = Math.max(len - clearB, len * 0.55);
    const total = s1 - s0;
    if (total < 0.4) return;
    const count = Math.max(1, Math.ceil(total / 4.5));
    const segLen = total / count;
    for (const line of laneBoundaryLines(road)) {
      const color = line.color === 'concrete' ? C.median : line.role === 'center' ? C.lineYellow : C.line;
      const half = line.kind === 'edge' ? 0.1 : 0.075;
      if (line.kind === 'dashed') {
        for (let i = 0; i < count; i++) {
          const a = s0 + i * segLen;
          this.emitDashRun(prims, dir, n, a, a + segLen, line.offset, half, color, road.id);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const a = s0 + i * segLen;
          prims.push(this.flatBand(dir, n, a, a + segLen, line.offset, half, color, SUBLAYER.marking, road.id, 'marking'));
        }
      }
    }
  }

  emitDashRun(prims, dir, n, s0, s1, offset, half, color, id) {
    const dash = 3;
    const gap = 4.5;
    const cycle = dash + gap;
    let phase = s0 % cycle;
    if (phase < 0) phase += cycle;
    let t = phase < dash ? s0 + (dash - phase) : s0 + (cycle - phase);
    while (t < s1) {
      const b = Math.min(s1, t + dash);
      if (b - t > 0.2) prims.push(this.flatBand(dir, n, t, b, offset, half, color, SUBLAYER.marking, id, 'marking'));
      t += cycle;
    }
  }

  emitJunctionDetails(prims, node) {
    const w = this.world;
    const roads = w.roadsAtNode(node.id);
    let maxWidth = 0;
    for (const r of roads) maxWidth = Math.max(maxWidth, w.roadWidth(r));
    for (const road of roads) {
      const info = ROAD_CLASSES[road.cls] || ROAD_CLASSES.residential;
      if (info.access === 'foot') continue;
      const dir = w.roadDirection(road, true);
      if (dir.length < 2) continue;
      const n = norm({ x: -dir.y, y: dir.x });
      const atA = road.a === node.id;
      const W = road.laneWidth;
      const nF = Math.max(0, road.lanesF);
      const nB = road.oneway ? 0 : Math.max(0, road.lanesB);
      const span = 3;
      const sNear = atA ? 0.4 : dir.length - 0.4;
      const sFar = atA ? 0.4 + span : dir.length - 0.4 - span;
      for (const line of laneBoundaryLines(road)) {
        if (line.role === 'edge' || line.role === 'median') continue;
        const color = line.role === 'center' ? C.lineYellow : C.line;
        prims.push(
          this.flatBand(dir, n, Math.min(sNear, sFar), Math.max(sNear, sFar), line.offset, 0.075, color, SUBLAYER.marking, road.id, 'junction-marking')
        );
      }
      const lowerPriority = w.roadWidth(road) < maxWidth - 0.01;
      if (!node.signals && !lowerPriority) continue;
      const incomingA = atA ? -nB * W : 0;
      const incomingB = atA ? 0 : nF * W;
      if (Math.abs(incomingB - incomingA) < 0.4) continue;
      const barS0 = atA ? 0.9 : dir.length - 1.35;
      const barS1 = atA ? 1.35 : dir.length - 0.9;
      prims.push(
        this.flatBand(dir, n, barS0, barS1, (incomingA + incomingB) / 2, Math.abs(incomingB - incomingA) / 2, C.stop, SUBLAYER.marking, road.id, 'stop')
      );
    }
  }

  flatBand(dir, n, s0, s1, offset, half, color, sub, id, tag) {
    const ax = dir.start.x + dir.x * s0 + n.x * (offset - half);
    const ay = dir.start.y + dir.y * s0 + n.y * (offset - half);
    const bx = dir.start.x + dir.x * s1 + n.x * (offset - half);
    const by = dir.start.y + dir.y * s1 + n.y * (offset - half);
    const cx = dir.start.x + dir.x * s1 + n.x * (offset + half);
    const cy = dir.start.y + dir.y * s1 + n.y * (offset + half);
    const dx = dir.start.x + dir.x * s0 + n.x * (offset + half);
    const dy = dir.start.y + dir.y * s0 + n.y * (offset + half);
    return {
      kind: 'poly',
      sub,
      pts: [
        [ax, ay, 0.05],
        [bx, by, 0.05],
        [cx, cy, 0.05],
        [dx, dy, 0.05],
      ],
      color: rgb(color),
      lit: false,
      alpha: 1,
      tag,
      id,
    };
  }

  buildBuildings(cx, cy, box, prims) {
    const key = `${cx},${cy}`;
    for (const b of this.world.data.buildings) {
      if (!this.layerVisible(b.layerId)) continue;
      const bb = boundingBox(b.poly);
      if (centroidCellKey(bb) !== key) continue;
      if (!boxIntersects(bb, box)) continue;
      this.emitBuilding(prims, b);
    }
  }

  emitBuilding(prims, b) {
    const poly = b.poly;
    if (!poly || poly.length < 3) return;
    const h = Math.max(2.5, b.height || 8);
    const wallColor = b.color || '#c9b39a';
    if (this.shadows) {
      const sx = h * 0.2;
      const sy = h * 0.15;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.terrain,
        pts: poly.map((p) => [p.x + sx, p.y + sy, 0.014]),
        color: [0, 0, 0],
        alpha: 0.2,
        lit: false,
        shadow: true,
        tag: 'shadow',
        id: b.id,
      });
    }
    const ccw = ensureCCWLocal(poly);
    const n = ccw.length;
    for (let i = 0; i < n; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % n];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const nl = Math.hypot(nx, ny) || 1;
      const outX = nx / nl;
      const outY = ny / nl;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [p.x, p.y, 0],
          [q.x, q.y, 0],
          [q.x, q.y, h],
          [p.x, p.y, h],
        ],
        color: rgb(wallColor),
        normal: [outX, outY, 0],
        alpha: 1,
        tag: 'wall',
        id: b.id,
      });
      if (this.floorBands && b.floors >= 3) {
        const fh = h / b.floors;
        for (let f = 0; f < b.floors; f++) {
          const z = fh * (f + 0.24);
          const off = 0.07;
          const lit = hashish(b.id + f) > 0.82;
          prims.push({
            kind: 'poly',
            sub: SUBLAYER.object,
            pts: [
              [p.x + outX * off, p.y + outY * off, z],
              [q.x + outX * off, q.y + outY * off, z],
              [q.x + outX * off, q.y + outY * off, z + fh * 0.46],
              [p.x + outX * off, p.y + outY * off, z + fh * 0.46],
            ],
            color: rgb(lit ? C.windowLit : C.window),
            normal: [outX, outY, 0],
            alpha: 0.9,
            tag: 'window',
            id: b.id,
          });
        }
      }
    }
    this.emitRoof(prims, b, ccw, h);
  }

  emitRoof(prims, b, poly, h) {
    const type = b.roof || 'flat';
    const n = poly.length;
    const inset = 0.14;
    let cx = 0;
    let cy = 0;
    for (const q of poly) {
      cx += q.x;
      cy += q.y;
    }
    cx /= n;
    cy /= n;
    const top = poly.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const l = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dx / l) * inset, y: p.y - (dy / l) * inset };
    });
    const base = h + 0.12;
    const roofColor = b.roofColor || C.roofDefault;
    if (type === 'flat') {
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: top.map((p) => [p.x, p.y, base]),
        color: rgb(shade(wallTone(b), -0.32)),
        normal: [0, 0, 1],
        alpha: 1,
        tag: 'roof',
        id: b.id,
      });
      const parapet = 0.55;
      for (let i = 0; i < n; i++) {
        const p = top[i];
        const q = top[(i + 1) % n];
        const nx = -(q.y - p.y);
        const ny = q.x - p.x;
        const nl = Math.hypot(nx, ny) || 1;
        prims.push({
          kind: 'poly',
          sub: SUBLAYER.object,
          pts: [
            [p.x, p.y, base],
            [q.x, q.y, base],
            [q.x, q.y, base + parapet],
            [p.x, p.y, base + parapet],
          ],
          color: rgb(shade(wallTone(b), -0.12)),
          normal: [nx / nl, ny / nl, 0],
          alpha: 1,
          tag: 'parapet',
          id: b.id,
        });
      }
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of top) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const ridgeH = Math.max(0.6, Math.min(spanX, spanY) * 0.5 * (b.roofPitch || 0.9));
    const apex = base + ridgeH;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const alongX = spanX >= spanY;
    const face = (pts, tone) =>
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts,
        color: rgb(tone),
        normal: [0, 0, 1],
        alpha: 1,
        tag: 'roof',
        id: b.id,
      });
    if (type === 'gabled') {
      if (alongX) {
        face(
          [
            [minX, minY, base],
            [maxX, minY, base],
            [maxX, midY, apex],
            [minX, midY, apex],
          ],
          roofColor
        );
        face(
          [
            [minX, maxY, base],
            [maxX, maxY, base],
            [maxX, midY, apex],
            [minX, midY, apex],
          ],
          shade(roofColor, -0.16)
        );
        face(
          [
            [minX, midY, apex],
            [maxX, midY, apex],
            [top[0].x, top[0].y, base],
          ],
          shade(roofColor, -0.3)
        );
      } else {
        face(
          [
            [minX, minY, base],
            [minX, maxY, base],
            [midX, maxY, apex],
            [midX, minY, apex],
          ],
          roofColor
        );
        face(
          [
            [maxX, minY, base],
            [maxX, maxY, base],
            [midX, maxY, apex],
            [midX, minY, apex],
          ],
          shade(roofColor, -0.16)
        );
      }
      return;
    }
    const insetX = spanX * 0.26;
    const insetY = spanY * 0.26;
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const r1 = { x: minX + insetX, y: midY };
    const r2 = { x: maxX - insetX, y: midY };
    const r3 = { x: midX, y: minY + insetY };
    const r4 = { x: midX, y: maxY - insetY };
    const apexTop = base + ridgeH * 1.1;
    face([corners[0], corners[1], r3, [r3.x, r3.y, apexTop]], roofColor);
    face([corners[1], corners[2], r4, [r4.x, r4.y, apexTop]], shade(roofColor, -0.12));
    face([corners[2], corners[3], r3, [r3.x, r3.y, apexTop]], shade(roofColor, -0.2));
    face([corners[3], corners[0], r4, [r4.x, r4.y, apexTop]], shade(roofColor, -0.28));
    void r1;
    void r2;
  }

  buildProps(cx, cy, box, prims) {
    const key = `${cx},${cy}`;
    for (const p of this.world.data.props) {
      if (!this.layerVisible(p.layerId)) continue;
      const preset = PROP_KINDS[p.kind];
      if (!preset) continue;
      if (pointCellKey(p.x, p.y) !== key) continue;
      const r = Math.max(0.5, (preset.radius || 1) * (p.scale || 1));
      if (!boxIntersects({ minX: p.x - r - 0.6, minY: p.y - r - 0.6, maxX: p.x + r + 0.6, maxY: p.y + r + 0.6 }, box)) continue;
      this.emitProp(prims, p, preset);
    }
  }

  emitProp(prims, p, preset) {
    const start = prims.length;
    this.buildProp(prims, p, preset);
    for (let i = start; i < prims.length; i++) {
      if (prims[i].id === undefined) prims[i].id = p.id;
    }
  }

  buildProp(prims, p, preset) {
    const s = p.scale || 1;
    const h = (p.height || preset.height || 1) * s;
    const kind = preset.kind;
    const color = p.color || preset.color;
    const push = (list) => {
      for (const item of list) prims.push({ ...item, id: item.id ?? p.id });
    };
    if (kind === 'tree' || kind === 'pine' || kind === 'bush' || kind === 'hedge') {
      prims.push({
        kind: 'sprite',
        sub: SUBLAYER.object,
        sprite: kind,
        variant: spriteVariant(p.id),
        color: rgb(color),
        tint: color,
        x: p.x,
        y: p.y,
        z: p.z || 0,
        height: kind === 'bush' ? h * 1.6 : h,
        width: Math.max(1.2, (preset.radius || 1) * 2 * s),
        tag: 'prop',
        id: p.id,
      });
      return;
    }
    if (kind === 'lamp') {
      push(this.boxPrism(p.x, p.y, 0, 0.16, 0.16, h, '#6f7378', p.rotation, true));
      const ax = p.x + Math.cos(p.rotation - Math.PI / 2) * 1.5;
      const ay = p.y + Math.sin(p.rotation - Math.PI / 2) * 1.5;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [p.x, p.y, h],
          [ax, ay, h],
          [ax, ay, h - 0.2],
          [p.x, p.y, h - 0.2],
        ],
        color: rgb('#6f7378'),
        normal: [0, 0, 1],
        alpha: 1,
        tag: 'prop',
      });
      push(this.boxPrism(ax, ay, h - 0.38, 0.44, 0.24, 0.16, '#e8dfc0', 0, true));
      return;
    }
    if (kind === 'traffic_light') {
      push(this.boxPrism(p.x, p.y, 0, 0.12, 0.12, h, '#33383d', p.rotation, true));
      push(this.boxPrism(p.x, p.y, h - 0.15, 0.32, 0.3, 1.0, '#2b3036', p.rotation, true));
      return;
    }
    if (kind === 'sign') {
      push(this.boxPrism(p.x, p.y, 0, 0.07, 0.07, h, '#7c8288', p.rotation, true));
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [p.x - 0.32, p.y, h - 0.25],
          [p.x + 0.32, p.y, h - 0.25],
          [p.x + 0.32, p.y, h + 0.25],
          [p.x - 0.32, p.y, h + 0.25],
        ],
        color: rgb('#dde1e5'),
        normal: [0, 1, 0],
        doubleSided: true,
        alpha: 1,
        tag: 'prop',
      });
      return;
    }
    if (kind === 'bollard' || kind === 'hydrant' || kind === 'mailbox' || kind === 'bin') {
      push(this.boxPrism(p.x, p.y, 0, 0.24 * s, 0.24 * s, h, color, p.rotation, false));
      return;
    }
    if (kind === 'cone') {
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [p.x - 0.24, p.y - 0.24, 0],
          [p.x + 0.24, p.y - 0.24, 0],
          [p.x + 0.24, p.y + 0.24, 0],
          [p.x - 0.24, p.y + 0.24, 0],
        ],
        color: rgb('#3a3f45'),
        lit: false,
        alpha: 1,
        tag: 'prop',
      });
      for (let i = 0; i < 4; i++) {
        const t0 = i / 4;
        const t1 = (i + 1) / 4;
        const r0 = 0.22 * (1 - t0 * 0.86);
        const r1 = 0.22 * (1 - t1 * 0.86);
        const z0 = h * t0;
        const z1 = h * t1;
        const c = i % 2 === 0 ? '#e2762f' : '#f2f2f0';
        prims.push({
          kind: 'poly',
          sub: SUBLAYER.object,
          pts: [
            [p.x - r0, p.y - r0, z0],
            [p.x + r0, p.y - r0, z0],
            [p.x + r1, p.y - r1, z1],
            [p.x - r1, p.y - r1, z1],
          ],
          color: rgb(c),
          normal: [0, 0, 1],
          alpha: 1,
          tag: 'prop',
        });
        prims.push({
          kind: 'poly',
          sub: SUBLAYER.object,
          pts: [
            [p.x - r1, p.y - r1, z1],
            [p.x + r1, p.y - r1, z1],
            [p.x + r0, p.y + r0, z0],
            [p.x - r0, p.y + r0, z0],
          ],
          color: rgb(c),
          normal: [0, 0, 1],
          alpha: 1,
          tag: 'prop',
        });
      }
      return;
    }
    if (kind === 'barrier' || kind === 'fence') {
      const len = (preset.length || 3) * s;
      const c = Math.cos(p.rotation);
      const sn = Math.sin(p.rotation);
      const x1 = p.x - (c * len) / 2;
      const y1 = p.y - (sn * len) / 2;
      const x2 = p.x + (c * len) / 2;
      const y2 = p.y + (sn * len) / 2;
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [x1, y1, 0.05],
          [x2, y2, 0.05],
          [x2, y2, h],
          [x1, y1, h],
        ],
        color: rgb(color),
        normal: [0, 0, 1],
        doubleSided: true,
        alpha: 1,
        tag: 'prop',
      });
      return;
    }
    if (kind === 'bench') {
      const len = (preset.length || 1.8) * s;
      push(this.boxPrism(p.x, p.y, 0.38, len, 0.55, 0.1, color, p.rotation, false));
      push(this.boxPrism(p.x, p.y, 0.38, len, 0.12, 0.5, color, p.rotation + Math.PI / 2, false));
      return;
    }
    if (kind === 'power_pole') {
      push(this.boxPrism(p.x, p.y, 0, 0.22, 0.22, h, color, p.rotation, true));
      prims.push({
        kind: 'poly',
        sub: SUBLAYER.object,
        pts: [
          [p.x - 0.9, p.y, h - 0.75],
          [p.x + 0.9, p.y, h - 0.75],
          [p.x + 0.9, p.y, h - 0.6],
          [p.x - 0.9, p.y, h - 0.6],
        ],
        color: rgb(color),
        normal: [0, 1, 0],
        doubleSided: true,
        alpha: 1,
        tag: 'prop',
      });
      return;
    }
    if (kind === 'person') {
      prims.push({
        kind: 'sprite',
        sub: SUBLAYER.object,
        sprite: 'person',
        variant: 0,
        color: rgb(color),
        tint: color,
        x: p.x,
        y: p.y,
        z: 0,
        height: h,
        width: 0.72,
        tag: 'prop',
        id: p.id,
      });
      return;
    }
    const dims = {
      car: [4.5, 1.85, 0.78, 2.4],
      van: [5.6, 2.0, 1.35, 2.9],
      truck: [9.2, 2.5, 2.6, 3.4],
      bus: [11.4, 2.55, 1.85, 3.2],
      block: [2, 2, 1, 1],
    };
    const d = dims[kind] || dims.car;
    push(this.boxPrism(p.x, p.y, 0.3, d[0] * s, d[1] * s, d[2], color, p.rotation, false));
    const cx2 = p.x + Math.cos(p.rotation) * d[3] * s * -0.08;
    const cy2 = p.y + Math.sin(p.rotation) * d[3] * s * -0.08;
    push(this.boxPrism(cx2, cy2, 0.3 + d[2], d[0] * s * 0.5, d[1] * s * 0.88, d[2] * 0.85, shade(color, -0.14), p.rotation, false));
    for (const ox of [-d[0] * 0.31, d[0] * 0.31]) {
      for (const oy of [-d[1] * 0.5, d[1] * 0.5]) {
        const wx = p.x + Math.cos(p.rotation) * ox - Math.sin(p.rotation) * oy;
        const wy = p.y + Math.sin(p.rotation) * ox + Math.cos(p.rotation) * oy;
        prims.push({
          kind: 'poly',
          sub: SUBLAYER.object,
          pts: [
            [wx - 0.11, wy - 0.11, 0],
            [wx + 0.11, wy - 0.11, 0],
            [wx + 0.11, wy + 0.11, 0],
            [wx - 0.11, wy + 0.11, 0],
            [wx - 0.11, wy - 0.11, 0.62],
            [wx + 0.11, wy - 0.11, 0.62],
            [wx + 0.11, wy + 0.11, 0.62],
            [wx - 0.11, wy + 0.11, 0.62],
          ],
          color: rgb(C.wheel),
          lit: true,
          alpha: 1,
          tag: 'wheel',
        });
      }
    }
  }

  boxPrism(cx, cy, z0, len, wid, h, color, rotation, taper = false, sub = SUBLAYER.object, tag = 'prop', id = null) {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const half = len / 2;
    const hw = wid / 2;
    const corners = [
      [-half, -hw],
      [half, -hw],
      [half, hw],
      [-half, hw],
    ].map(([lx, ly]) => ({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }));
    const topScale = taper ? 0.5 : 1;
    const topCorners = corners.map((p) => ({ x: cx + (p.x - cx) * topScale, y: cy + (p.y - cy) * topScale }));
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % 4];
      const tp = topCorners[i];
      const tq = topCorners[(i + 1) % 4];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const nl = Math.hypot(nx, ny) || 1;
      out.push({
        kind: 'poly',
        sub,
        pts: [
          [p.x, p.y, z0],
          [q.x, q.y, z0],
          [tq.x, tq.y, z0 + h],
          [tp.x, tp.y, z0 + h],
        ],
        color: rgb(color),
        normal: [nx / nl, ny / nl, 0],
        alpha: 1,
        tag,
        id,
      });
    }
    out.push({
      kind: 'poly',
      sub,
      pts: [
        [topCorners[0].x, topCorners[0].y, z0 + h],
        [topCorners[1].x, topCorners[1].y, z0 + h],
        [topCorners[2].x, topCorners[2].y, z0 + h],
        [topCorners[3].x, topCorners[3].y, z0 + h],
      ],
      color: rgb(shade(color, 0.1)),
      normal: [0, 0, 1],
      alpha: 1,
      tag,
      id,
    });
    return out;
  }

  layerVisible(layerId) {
    if (!layerId) return true;
    const layer = this.world.layerById(layerId);
    return layer ? layer.visible : true;
  }
}

function wallTone(b) {
  return b.color || '#c9b39a';
}

function ensureCCWLocal(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area > 0 ? poly.slice().reverse() : poly.slice();
}

function hashish(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
