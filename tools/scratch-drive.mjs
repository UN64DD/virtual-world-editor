// Scratch harness: run the self-driving simulator on the demo world and print
// telemetry so behaviour can be inspected without a browser.
globalThis.performance = { now: () => 0 };
const { createDemoWorld } = await import('../src/model/demo.js');
const { RoadNetwork } = await import('../src/model/network.js');
const { DriveSim } = await import('../src/model/driver.js');
const { makeVehicle } = await import('../src/model/schema.js');

const world = createDemoWorld();
const net = new RoadNetwork(world);
net.ensure();
console.log('lanes', net.lanes.size, 'junctions', net.junctionPolys.size);

const lane = [...net.lanes.values()].find((l) => l.length > 40 && l.successors.length > 0);
const p = net.pointAtS(lane, 4);
console.log('spawn lane', lane.id, 'at', p.x.toFixed(1), p.y.toFixed(1), 'len', lane.length.toFixed(1));

const v = world.addVehicle(makeVehicle('car', p.x, p.y, { yaw: p.heading }));
const sim = new DriveSim(world, net);
sim.sync();
sim.start();
console.log('agents', sim.agents.size, JSON.stringify(sim.report(), null, 0));

const dt = 1000 / 30;
let steps = 0;
const marks = [];
while (steps < 30 * 180) {
  sim.update(dt);
  steps += 1;
  if (steps % (30 * 20) === 0) {
    const a = sim.list()[0];
    marks.push(
      `t=${(steps / 30).toFixed(0)}s lane=${a.laneId} s=${a.s.toFixed(1)} v=${(a.speed * 3.6).toFixed(0)}kph d=${a.distance.toFixed(0)}m state=${a.state} ${a.reason}`
    );
  }
}
console.log(marks.join('\n'));
console.log('stats', JSON.stringify(sim.stats()));

// Lane adherence: every position must stay inside its lane corridor.
const a = sim.list()[0];
const proj = net.projectOnLane(a.lane, a.x, a.y);
console.log('lateral error', proj.lateral.toFixed(2), 'lane width', a.lane.width);
console.log('final report', JSON.stringify(sim.report(), null, 1));