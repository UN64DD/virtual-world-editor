import { perp } from '../core/geom.js';
import { clamp, dist } from '../core/util.js';
import { MARKING_KINDS, ROAD_CLASSES } from './schema.js';
import { laneBoundaryLines, laneCounts } from './network.js';

export function nodeClearance(world, nodeId) {
  const roads = world.roadsAtNode(nodeId);
  if (roads.length < 2) return 0;
  let max = 0;
  for (const r of roads) max = Math.max(max, world.roadWidth(r) / 2);
  return max + 1.2;
}

export function roadTrim(world, road) {
  const dir = world.roadDirection(road, true);
  const len = dir.length;
  const startTrim = nodeClearance(world, road.a);
  const endTrim = nodeClearance(world, road.b);
  const s0 = Math.min(startTrim, len * 0.45);
  const s1 = Math.max(len - endTrim, len * 0.55);
  return { dir, len, s0, s1, hasRoom: s1 - s0 > 0.4 };
}

export function pointOnRoad(world, road, s, offset = 0) {
  const dir = world.roadDirection(road, true);
  const n = perp(dir);
  const t = clamp(s, 0, dir.length);
  return {
    x: dir.start.x + dir.x * t + n.x * offset,
    y: dir.start.y + dir.y * t + n.y * offset,
  };
}

export function markingBandPoints(world, road, sStart, sEnd, offset, halfWidth) {
  const p0 = pointOnRoad(world, road, sStart, offset - halfWidth);
  const p1 = pointOnRoad(world, road, sStart, offset + halfWidth);
  const p2 = pointOnRoad(world, road, sEnd, offset + halfWidth);
  const p3 = pointOnRoad(world, road, sEnd, offset - halfWidth);
  return [p0, p1, p2, p3];
}

export function roadMarkingBands(world, network, road) {
  const info = ROAD_CLASSES[road.cls] || ROAD_CLASSES.residential;
  if (info.access === 'foot') return [];
  const trim = roadTrim(world, road);
  if (!trim.hasRoom) return [];
  const preset = MARKING_KINDS;
  const bands = [];
  for (const line of laneBoundaryLines(road)) {
    const kindPreset = preset[line.kind] || preset.solid;
    const half = (line.kind === 'edge' ? kindPreset.width : kindPreset.width) / 2;
    bands.push({
      offset: line.offset,
      halfWidth: half,
      kind: line.kind,
      role: line.role,
      dash: kindPreset.dash,
      color: line.color === 'concrete' ? '#b9bcc0' : line.role === 'center' ? null : null,
      sStart: trim.s0,
      sEnd: trim.s1,
      roadId: road.id,
      generated: true,
    });
  }
  return bands;
}

export function arrowPolygon(width = 0.35, length = 3.2) {
  const hw = width / 2;
  const headLen = Math.min(1.5, length * 0.42);
  const headW = hw * 2.6;
  const shaftLen = length - headLen;
  return [
    { x: 0, y: -hw },
    { x: shaftLen, y: -hw },
    { x: shaftLen, y: -headW },
    { x: length, y: 0 },
    { x: shaftLen, y: headW },
    { x: shaftLen, y: hw },
    { x: 0, y: hw },
  ];
}

export function straightArrowPolygon(width = 0.35, length = 3.2) {
  const hw = width / 2;
  const headLen = Math.min(1.4, length * 0.4);
  const headW = hw * 2.4;
  return [
    { x: 0, y: -hw },
    { x: length - headLen, y: -hw },
    { x: length - headLen, y: -headW },
    { x: length, y: 0 },
    { x: length - headLen, y: headW },
    { x: length - headLen, y: hw },
    { x: 0, y: hw },
  ];
}

export function leftTurnArrowPolygon(width = 0.35, size = 3.0) {
  const hw = width / 2;
  const r = size * 0.42;
  const pts = [{ x: 0, y: -hw }, { x: size * 0.42, y: -hw }];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    pts.push({ x: size * 0.42 + Math.cos(a) * r * 0.62, y: -size * 0.42 + Math.sin(a) * r });
  }
  pts.push({ x: size * 0.42 + r * 0.62, y: -size * 0.42 - r * 0.75 });
  pts.push({ x: size * 0.42 + r * 0.62 + r * 0.9, y: -size * 0.42 - r * 0.2 });
  pts.push({ x: size * 0.42 + r * 0.62 - r * 0.05, y: -size * 0.42 - r * 0.05 });
  for (let i = 10; i >= 0; i--) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    pts.push({ x: size * 0.42 + Math.cos(a) * r * 0.62 - hw * 1.6, y: -size * 0.42 + Math.sin(a) * r - hw * 0.9 });
  }
  pts.push({ x: 0, y: hw });
  return pts;
}

export function arrowKindPolygon(kind, width = 0.35, size = 3.2) {
  switch (kind) {
    case 'arrow_left':
      return leftTurnArrowPolygon(width, size);
    case 'arrow_straight':
      return straightArrowPolygon(width, size);
    case 'arrow_right': {
      const p = leftTurnArrowPolygon(width, size);
      return p.map((q) => ({ x: size - q.x, y: q.y }));
    }
    default:
      return arrowPolygon(width, size);
  }
}

export function markingGeometry(world, network, marking) {
  const road = marking.roadId ? world.byId('roads', marking.roadId) : null;
  if (!road) return null;
  const dir = world.roadDirection(road, true);
  const len = dir.length;
  const n = perp(dir);
  const preset = MARKING_KINDS[marking.kind] || MARKING_KINDS.solid;
  const result = { kind: marking.kind, role: marking.role, polys: [], color: marking.color || preset.color, dash: marking.dash || preset.dash };

  if (marking.role === 'stop') {
    const s = clamp(marking.sStart ?? len - 2, 0, len);
    const lane = marking.laneId ? network?.lane(marking.laneId) : null;
    const half = lane ? lane.width / 2 : world.roadWidth(road) / 2;
    const off = lane ? lane.offset : 0;
    result.polys.push(markingBandPoints(world, road, s, s + (marking.width ?? 0.4), off, half));
    return result;
  }

  if (marking.role === 'zebra') {
    const s0 = clamp(marking.sStart ?? 0, 0, len);
    const s1 = clamp(marking.sEnd ?? s0 + 3, 0, len);
    const half = world.roadWidth(road) / 2;
    const count = Math.max(2, Math.round((s1 - s0) / 1.1));
    const pitch = (s1 - s0) / count;
    const stripeW = pitch * 0.55;
    for (let i = 0; i < count; i++) {
      const a = s0 + pitch * i + pitch * 0.22;
      const b = a + stripeW;
      result.polys.push(markingBandPoints(world, road, a, b, 0, half));
    }
    return result;
  }

  if (marking.role === 'arrow') {
    const s = clamp(marking.sStart ?? 0, 0, len);
    const lane = marking.laneId ? network?.lane(marking.laneId) : null;
    const off = lane ? lane.offset : marking.offset ?? 0;
    const poly = arrowKindPolygon(marking.kind.startsWith('arrow') ? marking.kind : 'arrow', marking.width ?? 0.4);
    const mapped = poly.map((p) => {
      const along = s + p.x;
      const lateral = off + p.y;
      return {
        x: dir.start.x + dir.x * along + n.x * lateral,
        y: dir.start.y + dir.y * along + n.y * lateral,
      };
    });
    result.polys.push(mapped);
    return result;
  }

  if (marking.role === 'text') {
    const s = clamp(marking.sStart ?? 0, 0, len);
    const p = pointOnRoad(world, road, s, marking.offset ?? 0);
    result.polys.push([p]);
    result.text = marking.text || 'SLOW';
    result.angle = Math.atan2(dir.y, dir.x);
    return result;
  }

  let offset = marking.offset;
  if (offset === null || offset === undefined) {
    const lane = marking.laneId ? network?.lane(marking.laneId) : null;
    if (lane) {
      offset = marking.side === 'left' ? lane.offset - lane.width / 2 : lane.offset + lane.width / 2;
    } else {
      offset = marking.side === 'left' ? -world.roadWidth(road) / 4 : world.roadWidth(road) / 4;
    }
  }
  const half = (marking.width ?? preset.width) / 2;
  const s0 = clamp(marking.sStart ?? 0, 0, len);
  const s1 = clamp(marking.sEnd ?? len, 0, len);
  if (s1 - s0 < 0.05) return null;
  result.polys.push(markingBandPoints(world, road, s0, s1, offset, half));
  result.offset = offset;
  return result;
}

export function laneWidthAtRoad(road) {
  const { total } = laneCounts(road);
  return total * road.laneWidth;
}

export function stopLineForLane(world, network, lane) {
  const road = world.byId('roads', lane.roadId);
  if (!road) return null;
  const isForward = lane.dir === 'F';
  const endS = isForward ? world.roadLength(road) : 0;
  const s = endS - (isForward ? 2.5 : -2.5);
  return { road, s: clamp(s, 0, world.roadLength(road)), lane };
}

export function nearestRoadAt(world, x, y, maxDist = 6) {
  let best = null;
  for (const road of world.data.roads) {
    const pair = world.roadNodes(road);
    if (!pair) continue;
    const [a, b] = pair;
    const d = pointSegmentDistanceLocal(x, y, a, b);
    if (d <= maxDist && (!best || d < best.d)) best = { road, d, point: projectOnSegmentLocal(x, y, a, b) };
  }
  return best;
}

function pointSegmentDistanceLocal(x, y, a, b) {
  return dist(a.x, a.y, projectOnSegmentLocal(x, y, a, b).x, projectOnSegmentLocal(x, y, a, b).y);
}

function projectOnSegmentLocal(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { x: a.x, y: a.y };
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}
