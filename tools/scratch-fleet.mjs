// Scratch harness: fleet behaviour, signals, obstacles, dead ends, off-road.
// Each scenario builds its own world so sims never share vehicles.
globalThis.performance = { now: () => 0 };
const { createDemoWorld } = await import('../src/model/demo.js');
const { RoadNetwork } = await import('../src/model/network.js');
const { DriveSim } = await import('../src/model/driver.js');
const { makeVehicle, makeProp } = await import('../src/model/schema.js');

const DT = 1000 / 30;

/**
 * How far two bodies have interpenetrated, by separating-axis test on their
 * rectangles. A plain centre distance is no guide: opposing traffic on a 3.5m
 * lane passes within a metre sideways without touching.
 */
function penetration(a, b) {
  const axes = [];
  for (const v of [a, b]) {
    axes.push([-Math.sin(v.yaw), Math.cos(v.yaw)]);
    axes.push([Math.cos(v.yaw), Math.sin(v.yaw)]);
  }
  let worst = Infinity;
  for (const [ax, ay] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const v of [a, b]) {
      const hx = (v.length / 2) * Math.abs(Math.cos(v.yaw) * ax + Math.sin(v.yaw) * ay);
      const hy = (v.width / 2) * Math.abs(-Math.sin(v.yaw) * ax + Math.cos(v.yaw) * ay);
      const c = v.x * ax + v.y * ay;
      amin = Math.min(amin, c - hx - hy);
      amax = Math.max(amax, c + hx + hy);
      bmin = Math.min(bmin, c - hx - hy);
      bmax = Math.max(bmax, c + hx + hy);
    }
    worst = Math.min(worst, Math.max(bmin - amax, amin - bmax));
  }
  return worst > 0 ? worst : 0;
}

function distanceToPath(pts, x, y) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

// Clear of a junction before lane-keeping is scored.
const JUNCTION_CLEAR = 14;

function fresh() {
  const world = createDemoWorld();
  const net = new RoadNetwork(world);
  net.ensure();
  return { world, net, sim: new DriveSim(world, net) };
}

/* ---------------------------------------------------------------- fleet */
{
  const { world, net, sim } = fresh();
  const lanes = [...net.lanes.values()].filter((l) => l.drivable && l.successors.length);
  const kinds = ['car', 'van', 'truck', 'bus', 'sports'];
  for (let i = 0; i < 8; i++) {
    const lane = lanes[(i * 7) % lanes.length];
    const p = net.pointAtS(lane, Math.min(6, lane.length / 2));
    world.addVehicle(makeVehicle(kinds[i % kinds.length], p.x, p.y, { yaw: p.heading }));
  }
  sim.sync();
  sim.start();
  let worstGap = Infinity;
  let worstGapPair = '';
  let worstPen = 0;
  let worstPenPair = '';
  let worstPath = 0;
  let worstPathAgent = '';
  let worstLateral = 0;
  let worstLateralAgent = '';
  let worstLateralDetail = null;
  let nan = 0;
  let stoppedFrames = 0;
  const total = 30 * 300;
  for (let step = 0; step < total; step++) {
    sim.update(DT);
    const list = sim.list();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.speed)) nan++;
      if (a.speed < 0.2) stoppedFrames++;
      // Distance to the route the car is actually following, again only where
      // the plan is still straight ahead of it.
      if (!a.plan || !a.lane || a.s > a.lane.length - JUNCTION_CLEAR) continue;
      const off = distanceToPath(a.plan.pts, a.x, a.y);
      if (off > worstPath) {
        worstPath = off;
        worstPathAgent = `${a.kind} lane ${a.laneId} s ${a.s.toFixed(0)}/${a.lane.length.toFixed(0)} v ${(a.speed * 3.6).toFixed(0)}kph`;
      }
      // Lateral error only counts mid-lane: a car on a junction curve is
      // measured against the lane it is leaving, which says nothing useful.
      // Only score the straight part of a lane: near a node the plan is
      // already bending for the turn, so distance from the centreline there is
      // the corner doing its job, not a lane-keeping failure.
      if (a.lane && a.s > 6 && a.s < a.lane.length - JUNCTION_CLEAR) {
        const proj = net.projectOnLane(a.lane, a.x, a.y);
        if (proj && Math.abs(proj.lateral) > worstLateral) {
          worstLateral = Math.abs(proj.lateral);
          worstLateralAgent = `${a.kind} lane ${a.laneId} s ${a.s.toFixed(0)}/${a.lane.length.toFixed(0)} v ${(a.speed * 3.6).toFixed(0)}kph`;
          worstLateralDetail = {
            lateral: proj.lateral,
            planOffset: a.offset,
            arc: a.arc,
            planTotal: a.plan ? a.plan.total : -1,
            planStart: a.plan ? `${a.plan.pts[0].x.toFixed(1)},${a.plan.pts[0].y.toFixed(1)}` : '-',
            vehicle: `${a.x.toFixed(1)},${a.y.toFixed(1)}`,
            state: a.state,
            reason: a.reason || '-',
            laneWidth: a.lane.width,
            nextLane: a.plan ? a.plan.nextLaneId : '-',
          };
        }
      }
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const pen = penetration(a, b);
        if (pen > worstPen) {
          worstPen = pen;
          worstPenPair = `${a.kind} ${a.laneId} (s ${a.s.toFixed(0)}/${a.lane.length.toFixed(0)}, ${(a.speed * 3.6).toFixed(0)}kph) vs ${b.kind} ${b.laneId} (s ${b.s.toFixed(0)}/${b.lane.length.toFixed(0)}, ${(b.speed * 3.6).toFixed(0)}kph)`;
        }
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.length + b.length) / 2;
        if (gap < worstGap) {
          worstGap = gap;
          worstGapPair = `${a.kind} ${a.laneId} (s ${a.s.toFixed(0)}/${a.lane.length.toFixed(0)}, ${(a.speed * 3.6).toFixed(0)}kph) vs ${b.kind} ${b.laneId} (s ${b.s.toFixed(0)}, ${(b.speed * 3.6).toFixed(0)}kph)`;
        }
      }
    }
  }
  console.log('fleet', JSON.stringify(sim.stats()));
  console.log('worst body overlap', worstPen.toFixed(2), 'm | worst path offset', worstPath.toFixed(2), 'm | worst mid-lane offset', worstLateral.toFixed(2), 'm');
  console.log('  overlapping pair:', worstPenPair);
  console.log('  worst path agent:', worstPathAgent);
  console.log('  worst lateral agent:', worstLateralAgent);
  console.log('  detail:', JSON.stringify(worstLateralDetail));
  console.log('  tightest pair:', worstGapPair);
  console.log('non-finite', nan, '| stopped frames', stoppedFrames, 'of', total * 8, `(${(100 * stoppedFrames / (total * 8)).toFixed(1)}%)`);
  console.log(sim.report().map((r) => `  ${r.kind.padEnd(6)} ${String(r.speed_kph).padStart(5)}kph ${r.state.padEnd(8)} d=${r.distance_m}m ${r.reason}`).join('\n'));

  world.remove(sim.list()[0].id);
  sim.update(DT);
  console.log('after deleting a vehicle: agents', sim.agents.size, 'vehicles', world.data.vehicles.length);
}

/* ------------------------------------------------------------- signals */
{
  // Which approach a car takes decides whether it ever meets a light, so try
  // the signalised approaches in turn and keep the busiest run. Seeded demo, so
  // this settles on the same one every time.
  // Lane ids are numbered per world, so choose by position in the list and let
  // each run pick the same slot out of its own network.
  const base = fresh();
  const sig = new Set(base.world.data.nodes.filter((n) => n.signals).map((n) => n.id));
  const slots = [...base.net.lanes.values()]
    .map((l, i) => [i, l])
    .filter(([, l]) => l.drivable && sig.has(l.to))
    .map(([i]) => i);
  const run = (slot) => {
    const { world, net, sim } = fresh();
    const lane = [...net.lanes.values()][slot];
    const p = net.pointAtS(lane, 5);
    world.addVehicle(makeVehicle('car', p.x, p.y, { yaw: p.heading }));
    sim.sync();
    sim.start();
    let lightFrames = 0;
    let stops = 0;
    let was = false;
    let overshoot = 0;
    let topSpeed = 0;
    for (let step = 0; step < 30 * 180; step++) {
      sim.update(DT);
      const a = sim.list()[0];
      topSpeed = Math.max(topSpeed, a.speed);
      const atLight = a.reason.includes('light');
      if (atLight) {
        lightFrames++;
        if (a.lane) overshoot = Math.max(overshoot, a.s - (a.lane.length - sim.stopS(a)));
      }
      if (atLight && !was) stops++;
      was = atLight;
    }
    const a = sim.list()[0];
    return { lightFrames, stops, overshoot, topSpeed, distance: a.distance, state: a.state };
  };
  let best = null;
  for (const slot of slots.slice(0, 12)) {
    const r = run(slot);
    if (!best || r.lightFrames > best.lightFrames) best = r;
    if (best.lightFrames > 120) break;
  }
  console.log(
    'signal run: frames at a light', best.lightFrames,
    '| stops', best.stops,
    '| distance', best.distance.toFixed(0), 'm',
    '| top speed', (best.topSpeed * 3.6).toFixed(0), 'kph',
    '| worst overshoot past stop line', best.overshoot.toFixed(2), 'm',
  );
}

/* ----------------------------------------------------------- obstacles */
{
  const { world, net, sim } = fresh();
  const lane = [...net.lanes.values()].find((l) => l.drivable && l.length > 60 && l.successors.length);
  const start = net.pointAtS(lane, 4);
  world.addVehicle(makeVehicle('car', start.x, start.y, { yaw: start.heading }));
  const ahead = net.pointAtS(lane, 45);
  world.addProp(makeProp('tree', ahead.x + 3.2, ahead.y, { scale: 1.4 }));
  sim.sync();
  sim.start();
  let blocked = 0;
  for (let step = 0; step < 30 * 45; step++) {
    sim.update(DT);
    if (sim.list()[0].reason === 'blocked ahead') blocked++;
  }
  const a = sim.list()[0];
  console.log('obstacle run: blocked frames', blocked, '| distance', a.distance.toFixed(1), 'm | speed', (a.speed * 3.6).toFixed(1), 'kph |', a.reason);
}

/* ------------------------------------------------------------- off-road */
{
  const { world, net, sim } = fresh();
  world.addVehicle(makeVehicle('car', 5000, 5000));
  sim.sync();
  sim.start();
  for (let step = 0; step < 30 * 5; step++) sim.update(DT);
  const a = sim.list()[0];
  console.log('offroad: state', a.state, '| reason', JSON.stringify(a.reason), '| speed', a.speed);
}

/* -------------------------------------------------------- parked vehicle */
{
  const { world, net, sim } = fresh();
  const lane = [...net.lanes.values()].find((l) => l.drivable && l.length > 60);
  const p = net.pointAtS(lane, 5);
  world.addVehicle(makeVehicle('car', p.x, p.y, { yaw: p.heading, autonomous: false }));
  sim.sync();
  sim.start();
  for (let step = 0; step < 30 * 5; step++) sim.update(DT);
  console.log('parked vehicle: agents', sim.agents.size, '(expect 0)');
}