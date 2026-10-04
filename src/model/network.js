import { bezierPoint, distToSeg, norm, polylineLength } from '../core/geom.js';
import { clamp, wrapAngle } from '../core/util.js';
import { ROAD_CLASSES } from './schema.js';

export const TURN_TYPES = ['through', 'slight_right', 'right', 'sharp_right', 'sharp_left', 'left', 'slight_left', 'uturn'];

const SAMPLE_STEP = 2;
const MAX_SAMPLES = 400;
const DEG = Math.PI / 180;

export function laneIdFor(roadId, dir, index) {
  return `${roadId}:${dir}${index}`;
}

export function laneCounts(road) {
  const nF = road.oneway ? Math.max(1, road.lanesF) : Math.max(0, road.lanesF);
  const nB = road.oneway ? 0 : Math.max(0, road.lanesB);
  return { nF, nB, total: nF + nB };
}

export function laneOffsetFor(road, dir, index) {
  const { nF, nB } = laneCounts(road);
  const W = road.laneWidth;
  if (nB > 0) {
    return dir === 'F' ? W * (index + 0.5) : -W * (index + 0.5);
  }
  return W * (index + 0.5 - nF / 2);
}

export function laneBoundaryLines(road) {
  const info = roadClassInfoLocal(road);
  if (info.access === 'foot') return [];
  const { nF, nB } = laneCounts(road);
  const W = road.laneWidth;
  const lines = [];
  if (nB > 0) {
    const div = road.divider || 'dashed';
    if (div === 'median') {
      lines.push({ offset: -0.6, kind: 'solid', role: 'median', color: 'concrete' });
      lines.push({ offset: 0.6, kind: 'solid', role: 'median', color: 'concrete' });
    } else if (div === 'double') {
      lines.push({ offset: -0.16, kind: 'solid', role: 'center' });
      lines.push({ offset: 0.16, kind: 'solid', role: 'center' });
    } else if (div === 'solid') {
      lines.push({ offset: 0, kind: 'solid', role: 'center' });
    } else if (div !== 'none') {
      lines.push({ offset: 0, kind: 'dashed', role: 'center' });
    }
    for (let i = 1; i < nF; i++) lines.push({ offset: W * i, kind: 'dashed', role: 'divider' });
    for (let j = 1; j < nB; j++) lines.push({ offset: -W * j, kind: 'dashed', role: 'divider' });
    lines.push({ offset: W * nF, kind: 'edge', role: 'edge' });
    lines.push({ offset: -W * nB, kind: 'edge', role: 'edge' });
  } else {
    for (let i = 1; i < nF; i++) lines.push({ offset: W * (i - nF / 2), kind: 'dashed', role: 'divider' });
    lines.push({ offset: (W * nF) / 2, kind: 'edge', role: 'edge' });
    lines.push({ offset: (-W * nF) / 2, kind: 'edge', role: 'edge' });
  }
  return lines;
}

function roadClassInfoLocal(road) {
  const cls = road.cls || 'residential';
  return ROAD_CLASSES[cls] || ROAD_CLASSES.residential;
}

export function parseLaneId(id) {
  if (typeof id !== 'string') return null;
  const idx = id.lastIndexOf(':');
  if (idx < 0) return null;
  const roadId = id.slice(0, idx);
  const suffix = id.slice(idx + 1);
  const m = suffix.match(/^([FB])(\d+)$/);
  if (!m) return null;
  return { roadId, dir: m[1], index: parseInt(m[2], 10) };
}

export function classifyTurn(deltaRad) {
  const d = deltaRad / DEG;
  const ad = Math.abs(d);
  if (ad > 150) return 'uturn';
  if (ad <= 25) return 'through';
  if (d > 0) {
    if (d >= 100) return 'sharp_right';
    if (d >= 40) return 'right';
    return 'slight_right';
  }
  if (d <= -100) return 'sharp_left';
  if (d <= -40) return 'left';
  return 'slight_left';
}

function sampleSegment(ax, ay, bx, by, step) {
  const length = Math.hypot(bx - ax, by - ay);
  const count = clamp(Math.ceil(length / step), 1, MAX_SAMPLES - 1);
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
  }
  return pts;
}

export class RoadNetwork {
  constructor(world) {
    this.world = world;
    this.lanes = new Map();
    this.lanesByRoad = new Map();
    this.nodeLanesIn = new Map();
    this.nodeLanesOut = new Map();
    this.junctionPolys = new Map();
    this.builtRevision = -1;
    this.builtAt = 0;
    this.dirty = true;
  }

  ensure(force = false) {
    if (!force && !this.dirty && this.builtRevision === this.world.revision) return this;
    this.build();
    return this;
  }

  invalidate() {
    this.dirty = true;
  }

  build() {
    const w = this.world;
    this.lanes.clear();
    this.lanesByRoad.clear();
    this.nodeLanesIn.clear();
    this.nodeLanesOut.clear();
    this.junctionPolys.clear();
    for (const node of w.data.nodes) {
      this.nodeLanesIn.set(node.id, []);
      this.nodeLanesOut.set(node.id, []);
    }
    for (const road of w.data.roads) {
      const pair = w.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const forward = w.roadDirection(road, true);
      if (forward.length < 0.5) continue;
      const roadLanes = [];
      const nx = -forward.y;
      const ny = forward.x;
      const nF = road.oneway ? Math.max(1, road.lanesF) : road.lanesF;
      const nB = road.oneway ? 0 : road.lanesB;
      const mk = (dir, index, offset, fromNode, toNode, dirVec) => {
        const pts = [];
        const base = dir === 'F' ? [a, b] : [b, a];
        const samples = sampleSegment(base[0].x, base[0].y, base[1].x, base[1].y, SAMPLE_STEP);
        for (const s of samples) {
          pts.push({ x: s.x + nx * offset, y: s.y + ny * offset });
        }
        const tangent = { x: dirVec.x, y: dirVec.y };
        const lane = {
          id: laneIdFor(road.id, dir, index),
          roadId: road.id,
          roadName: road.name || '',
          roadClass: road.cls,
          dir,
          index,
          from: fromNode,
          to: toNode,
          width: road.laneWidth,
          speedLimit: road.speedLimit,
          vehicleAccess: this.accessFor(road),
          length: polylineLength(pts),
          offset,
          center: pts,
          tangent,
          leftBoundary: null,
          rightBoundary: null,
          successors: [],
          predecessors: [],
          deadEnd: false,
          drivable: this.accessFor(road) !== 'foot',
        };
        this.lanes.set(lane.id, lane);
        roadLanes.push(lane);
        this.nodeLanesOut.get(fromNode)?.push(lane);
        this.nodeLanesIn.get(toNode)?.push(lane);
        return lane;
      };
      for (let i = 0; i < nF; i++) {
        mk('F', i, laneOffsetFor(road, 'F', i), road.a, road.b, forward);
      }
      for (let i = 0; i < nB; i++) {
        const rev = { x: -forward.x, y: -forward.y };
        mk('B', i, laneOffsetFor(road, 'B', i), road.b, road.a, rev);
      }
      for (const lane of roadLanes) {
        lane.leftBoundary = this.boundary(lane, true);
        lane.rightBoundary = this.boundary(lane, false);
      }
      this.lanesByRoad.set(road.id, roadLanes);
    }
    this.connectJunctions();
    for (const road of w.data.roads) {
      for (const lane of this.lanesByRoad.get(road.id) || []) {
        lane.deadEnd = lane.successors.length === 0;
      }
    }
    this.buildJunctionPolys();
    this.builtRevision = w.revision;
    this.dirty = false;
    this.builtAt = Date.now();
    return this;
  }

  accessFor(road) {
    const info = this.world.roadInfo(road);
    return road.vehicleAccess || info.access || 'car';
  }

  boundary(lane, leftSide) {
    const pts = lane.center;
    const out = [];
    const sign = leftSide ? -1 : 1;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const half = lane.width / 2;
      out.push({ x: pts[i].x - dy * half * sign, y: pts[i].y + dx * half * sign });
    }
    return out;
  }

  headingAt(lane, index) {
    const c = lane.center;
    const i = clamp(index, 0, c.length - 1);
    const a = c[Math.max(0, i - 1)];
    const b = c[Math.min(c.length - 1, i + 1)];
    return norm({ x: b.x - a.x, y: b.y - a.y });
  }

  connectJunctions() {
    const w = this.world;
    for (const node of w.data.nodes) {
      const outs = this.nodeLanesOut.get(node.id) || [];
      const ins = this.nodeLanesIn.get(node.id) || [];
      const roads = w.roadsAtNode(node.id);
      const deadEnd = roads.length <= 1;
      for (const inLane of ins) {
        if (outs.length === 0) continue;
        const inHeading = this.headingAt(inLane, inLane.center.length - 1);
        const candidates = [];
        for (const outLane of outs) {
          if (outLane.roadId === inLane.roadId && outLane.dir === inLane.dir) continue;
          const outHeading = this.headingAt(outLane, 0);
          const delta = wrapAngle(Math.atan2(outHeading.y, outHeading.x) - Math.atan2(inHeading.y, inHeading.x));
          const turn = classifyTurn(delta);
          if (turn === 'uturn' && !deadEnd) continue;
          const sameRoad = outLane.roadId === inLane.roadId;
          if (sameRoad && turn !== 'uturn') {
            const bend = Math.abs(delta) / DEG;
            if (bend > 35) continue;
          }
          candidates.push({ lane: outLane, turn, delta });
        }
        candidates.sort((p, q) => Math.abs(p.delta) - Math.abs(q.delta));
        for (const cand of candidates) {
          const conn = this.buildConnection(inLane, cand.lane, cand.turn);
          inLane.successors.push({
            laneId: cand.lane.id,
            lane: cand.lane,
            turn: cand.turn,
            viaNode: node.id,
            delta: cand.delta,
            points: conn,
          });
          cand.lane.predecessors.push({ laneId: inLane.id, turn: cand.turn, viaNode: node.id });
        }
        if (candidates.length === 0 && deadEnd) {
          inLane.deadEnd = true;
        }
      }
      for (const outLane of outs) {
        if (outLane.successors.length === 0) outLane.deadEnd = true;
      }
    }
  }

  buildConnection(inLane, outLane, turn) {
    const e = inLane.center[inLane.center.length - 1];
    const s = outLane.center[0];
    const inH = this.headingAt(inLane, inLane.center.length - 1);
    const outH = this.headingAt(outLane, 0);
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    // Round the corner off at the point where the two lane centre lines cross.
    // Driving the curve through that point keeps it inside the triangle the lane
    // ends and the corner make up, which a pair of tangent handles does not:
    // when a lane hands over close to where the previous one ended, equal
    // handles reach past the join and the curve doubles back on itself.
    const den = inH.x * outH.y - inH.y * outH.x;
    let ctrl = { x: (e.x + s.x) / 2, y: (e.y + s.y) / 2 };
    if (Math.abs(den) > 1e-6) {
      const t = ((s.x - e.x) * outH.y - (s.y - e.y) * outH.x) / den;
      ctrl = { x: e.x + inH.x * t, y: e.y + inH.y * t };
      // A shallow join puts that crossing a long way off. Keep the bulge in
      // proportion to the gap so the curve stays near the two lanes.
      const off = Math.hypot(ctrl.x - (e.x + s.x) / 2, ctrl.y - (e.y + s.y) / 2);
      if (off > d * 0.5) ctrl = { x: e.x + (ctrl.x - e.x) * ((d * 0.5) / off), y: e.y + (ctrl.y - e.y) * ((d * 0.5) / off) };
    }
    const samples = clamp(Math.ceil(d / 1.5), 2, 20);
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const u = 1 - t;
      pts.push({
        x: u * u * e.x + 2 * u * t * ctrl.x + t * t * s.x,
        y: u * u * e.y + 2 * u * t * ctrl.y + t * t * s.y,
      });
    }
    return pts;
  }

  buildJunctionPolys() {
    const w = this.world;
    for (const node of w.data.nodes) {
      const roads = w.roadsAtNode(node.id);
      if (roads.length < 2) continue;
      const pts = [{ x: node.x, y: node.y }];
      for (const road of roads) {
        const dir = w.roadDirection(road, road.a === node.id);
        const half = w.roadWidth(road) / 2 + 0.35;
        const nx = -dir.y;
        const ny = dir.x;
        pts.push({ x: node.x + dir.x * half + nx * half, y: node.y + dir.y * half + ny * half });
        pts.push({ x: node.x + dir.x * half - nx * half, y: node.y + dir.y * half - ny * half });
      }
      this.junctionPolys.set(node.id, convexHullLocal(pts));
    }
  }

  junctionPoly(nodeId) {
    return this.junctionPolys.get(nodeId) || null;
  }

  laneList(filter = null) {
    const out = [];
    for (const lane of this.lanes.values()) if (!filter || filter(lane)) out.push(lane);
    return out;
  }

  drivableLanes() {
    return this.laneList((l) => l.drivable);
  }

  lane(id) {
    return this.lanes.get(id) || null;
  }

  roadLanes(roadId) {
    return this.lanesByRoad.get(roadId) || [];
  }

  projectOnLane(lane, x, y) {
    const pts = lane.center;
    let best = null;
    let bestD = Infinity;
    let bestIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      const r = distToSeg(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (r.d < bestD) {
        bestD = r.d;
        best = r;
        bestIdx = i - 1;
      }
    }
    if (!best) return null;
    const seg = pts[bestIdx + 1];
    const prev = pts[bestIdx];
    const segLen = Math.hypot(seg.x - prev.x, seg.y - prev.y) || 1;
    const s = this.sAt(lane, bestIdx) + best.t * segLen;
    const dir = norm({ x: seg.x - prev.x, y: seg.y - prev.y });
    const rx = x - best.x;
    const ry = y - best.y;
    const lateral = rx * -dir.y + ry * dir.x;
    return {
      laneId: lane.id,
      lane,
      s,
      lateral,
      distance: bestD,
      x: best.x,
      y: best.y,
      heading: Math.atan2(dir.y, dir.x),
    };
  }

  sAt(lane, index) {
    if (!lane._sTable) {
      const table = new Float64Array(lane.center.length);
      let acc = 0;
      for (let i = 1; i < lane.center.length; i++) {
        acc += Math.hypot(lane.center[i].x - lane.center[i - 1].x, lane.center[i].y - lane.center[i - 1].y);
        table[i] = acc;
      }
      lane._sTable = table;
    }
    return lane._sTable[index];
  }

  pointAtS(lane, s) {
    const pts = lane.center;
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, heading: Math.atan2(lane.tangent.y, lane.tangent.x), index: 0 };
    let i = 0;
    while (i < pts.length - 2 && this.sAt(lane, i + 1) < s) i++;
    const s0 = this.sAt(lane, i);
    const s1 = this.sAt(lane, i + 1);
    const t = s1 > s0 ? clamp((s - s0) / (s1 - s0), 0, 1) : 0;
    const a = pts[i];
    const b = pts[i + 1];
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const h = this.headingAt(lane, i);
    return { x, y, heading: Math.atan2(h.y, h.x), index: i };
  }

  nearestLane(x, y, opts = {}) {
    this.ensure();
    const drivableOnly = opts.drivableOnly !== false;
    let best = null;
    for (const lane of this.lanes.values()) {
      if (drivableOnly && !lane.drivable) continue;
      const p = this.projectOnLane(lane, x, y);
      if (!p) continue;
      const penalty = Math.abs(p.lateral) > lane.width ? (Math.abs(p.lateral) - lane.width) * 0.35 : 0;
      const score = p.distance + penalty;
      if (!best || score < best.score) best = { ...p, score };
    }
    return best;
  }

  laneByPoint(x, y, heading = null, opts = {}) {
    this.ensure();
    let best = null;
    const maxAngleErr = opts.maxAngleErr ?? Math.PI / 2;
    for (const lane of this.lanes.values()) {
      if (!lane.drivable) continue;
      const p = this.projectOnLane(lane, x, y);
      if (!p) continue;
      if (heading !== null) {
        const err = Math.abs(wrapAngle(p.heading - heading));
        if (err > maxAngleErr) continue;
      }
      if (p.distance > lane.width * 1.5) continue;
      if (!best || p.distance < best.distance) best = p;
    }
    return best;
  }

  successors(laneId) {
    const lane = this.lane(laneId);
    return lane ? lane.successors : [];
  }

  route(startLaneId, goalLaneId, opts = {}) {
    this.ensure();
    const avoidTurns = opts.avoidTurns || [];
    const maxSpeed = opts.maxSpeed ?? Infinity;
    const turnPenalty = opts.turnPenalty ?? 4;
    const start = this.lane(startLaneId);
    const goal = this.lane(goalLaneId);
    if (!start || !goal) return null;
    const gx = goal.center[Math.floor(goal.center.length / 2)];
    const heuristic = (lane) => {
      const p = lane.center[Math.floor(lane.center.length / 2)];
      const d = Math.hypot(p.x - gx.x, p.y - gx.y);
      return d / Math.max(5, Math.min(maxSpeed, lane.speedLimit) / 3.6);
    };
    const open = [{ id: start.id, f: 0 }];
    const came = new Map();
    const g = new Map([[start.id, 0]]);
    const closed = new Set();
    let found = null;
    let guard = 0;
    while (open.length && guard++ < 60000) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      const curLane = this.lane(cur.id);
      if (!curLane) continue;
      if (cur.id === goal.id) {
        found = cur.id;
        break;
      }
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);
      const baseG = g.get(cur.id) ?? Infinity;
      for (const succ of curLane.successors) {
        if (closed.has(succ.laneId)) continue;
        if (avoidTurns.includes(succ.turn)) continue;
        const sLane = succ.lane;
        const speed = Math.max(2, Math.min(maxSpeed, sLane.speedLimit));
        let cost = sLane.length / speed + turnPenalty;
        if (succ.turn !== 'through') cost += 1.2;
        if (succ.turn === 'uturn') cost += 18;
        const tentative = baseG + cost;
        if (tentative < (g.get(succ.laneId) ?? Infinity)) {
          g.set(succ.laneId, tentative);
          came.set(succ.laneId, { from: cur.id, turn: succ.turn });
          open.push({ id: succ.laneId, f: tentative + heuristic(sLane) });
        }
      }
    }
    if (!found) return null;
    const lanes = [found];
    const turns = [];
    let cursor = found;
    let guard2 = 0;
    while (came.has(cursor) && guard2++ < 10000) {
      const step = came.get(cursor);
      turns.unshift(step.turn);
      lanes.unshift(step.from);
      cursor = step.from;
    }
    if (lanes.length === 1 && start.id !== goal.id) return null;
    const path = this.lanePath(lanes, turns);
    let time = 0;
    let length = 0;
    for (let i = 0; i < lanes.length; i++) {
      const lane = this.lane(lanes[i]);
      length += lane.length;
      time += lane.length / Math.max(2, Math.min(maxSpeed, lane.speedLimit) / 3.6);
    }
    time += turns.length * 1.5;
    return { lanes, turns, path, length, time, goal: found };
  }

  lanePath(laneIds, turns = []) {
    const out = [];
    for (let i = 0; i < laneIds.length; i++) {
      const lane = this.lane(laneIds[i]);
      if (!lane) continue;
      if (i > 0) {
        const prevLane = this.lane(laneIds[i - 1]);
        const succ = prevLane?.successors.find((s) => s.laneId === lane.id);
        if (succ && succ.points && succ.points.length) {
          for (let k = 0; k < succ.points.length - 1; k++) out.push(succ.points[k]);
        }
      }
      for (let k = 0; k < lane.center.length; k++) {
        if (i > 0 && k === 0) continue;
        out.push(lane.center[k]);
      }
    }
    return out;
  }

  pathLength(path) {
    return polylineLength(path);
  }

  stats() {
    let lanes = 0;
    let drivable = 0;
    let length = 0;
    let uturns = 0;
    let deadEnds = 0;
    for (const lane of this.lanes.values()) {
      lanes += 1;
      if (lane.drivable) drivable += 1;
      length += lane.length;
      for (const s of lane.successors) if (s.turn === 'uturn') uturns += 1;
      if (lane.deadEnd) deadEnds += 1;
    }
    return { lanes, drivable, length, uturns, deadEnds, junctions: this.junctionPolys.size };
  }

  toAutonomyFormat(opts = {}) {
    this.ensure();
    const w = this.world;
    const includeGeometry = opts.geometry !== false;
    const step = opts.sampleStep || 1;
    const laneOut = [];
    for (const lane of this.lanes.values()) {
      const pts = [];
      if (includeGeometry) {
        let acc = 0;
        for (let i = 0; i < lane.center.length; i++) {
          if (i > 0) {
            acc += Math.hypot(lane.center[i].x - lane.center[i - 1].x, lane.center[i].y - lane.center[i - 1].y);
          }
          if (i === lane.center.length - 1 || acc >= step) {
            pts.push({ x: +lane.center[i].x.toFixed(3), y: +lane.center[i].y.toFixed(3), s: +acc.toFixed(3) });
            acc = 0;
          }
        }
      }
      laneOut.push({
        id: lane.id,
        road_id: lane.roadId,
        road_name: lane.roadName,
        road_class: lane.roadClass,
        direction: lane.dir === 'F' ? 'forward' : 'backward',
        index: lane.index,
        from_node: lane.from,
        to_node: lane.to,
        width: lane.width,
        length: +lane.length.toFixed(3),
        speed_limit_mps: +(lane.speedLimit / 3.6).toFixed(3),
        speed_limit_kph: lane.speedLimit,
        vehicle_access: lane.vehicleAccess,
        drivable: lane.drivable,
        dead_end: lane.deadEnd,
        left_boundary: includeGeometry ? lane.leftBoundary.map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) })) : undefined,
        right_boundary: includeGeometry ? lane.rightBoundary.map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) })) : undefined,
        centerline: pts,
        predecessors: lane.predecessors.map((p) => p.laneId),
        successors: lane.successors.map((s) => ({ lane_id: s.laneId, turn: s.turn, via_node: s.viaNode })),
      });
    }
    const nodes = w.data.nodes.map((n) => ({
      id: n.id,
      x: +n.x.toFixed(3),
      y: +n.y.toFixed(3),
      name: n.name || '',
      signals: !!n.signals,
      stop_line: n.stopLine !== false,
      degree: w.roadsAtNode(n.id).length,
      connected_lanes: [...(this.nodeLanesIn.get(n.id) || []), ...(this.nodeLanesOut.get(n.id) || [])].map((l) => l.id),
    }));
    return {
      format: 'vwe-lane-graph',
      version: 1,
      generated: new Date().toISOString(),
      frame: 'local-enu-meters',
      axis_convention: 'x=east, y=south, heading_ccw_positive_from_+x',
      origin: {
        lat: w.origin.lat,
        lon: w.origin.lon,
        yaw_deg: w.origin.yawDeg || 0,
        meters_per_degree_lat: +w.origin.mPerLat.toFixed(6),
        meters_per_degree_lon: +w.origin.mPerLon.toFixed(6),
      },
      world_name: w.meta.name,
      stats: this.stats(),
      nodes,
      lanes: laneOut,
    };
  }
}

function convexHullLocal(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export const NETWORK_DEFAULTS = { sampleStep: SAMPLE_STEP };
