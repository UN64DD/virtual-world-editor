// Tuning harness: one car, long tour, no traffic. Reports how well the
// controller holds the route so steering changes can be judged on their own.
globalThis.performance = { now: () => 0 };
const base = new URL('../src/model/', import.meta.url).href;
const { createDemoWorld } = await import(base + 'demo.js');
const { RoadNetwork } = await import(base + 'network.js');
const { DriveSim } = await import(base + 'driver.js');
const { makeVehicle } = await import(base + 'schema.js');

function offset(pts, x, y) {
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

const kinds = process.argv[2] ? [process.argv[2]] : ['car', 'van', 'truck', 'bus', 'sports'];
for (const kind of kinds) {
  const world = createDemoWorld();
  const net = new RoadNetwork(world);
  net.ensure();
  const lanes = [...net.lanes.values()].filter((l) => l.drivable && l.successors.length);
  const lane = lanes[Math.floor(lanes.length / 3)];
  const p = net.pointAtS(lane, 4);
  world.addVehicle(makeVehicle(kind, p.x, p.y, { yaw: p.heading }));
  const sim = new DriveSim(world, net);
  sim.sync();
  sim.start();
  const DT = 1000 / 30;
  let worst = 0;
  let sum = 0;
  let frames = 0;
  let over2 = 0;
  let lost = 0;
  let worstStep = 0;
  for (let step = 0; step < 30 * 600; step++) {
    sim.update(DT);
    const a = sim.list()[0];
    if (!a.plan) {
      lost++;
      continue;
    }
    const off = offset(a.plan.pts, a.x, a.y);
    sum += off;
    frames++;
    if (off > 2) over2++;
    if (off > worst) {
      worst = off;
      worstStep = step;
    }
  }
  const a = sim.list()[0];
  console.log(
    kind.padEnd(7),
    'dist', a.distance.toFixed(0).padStart(5) + 'm',
    'mean', (sum / frames).toFixed(2) + 'm',
    'worst', worst.toFixed(2) + 'm',
    'p95', (sum / frames > 0 ? '' : '') + '',
    'frames>2m', ((100 * over2) / frames).toFixed(1) + '%',
    'lost', lost,
    'state', a.state,
  );
}