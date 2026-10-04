// 3D render math verification. Run with: node tools/render3d.mjs
const calls = [];
const grad = { addColorStop() {} };
function makeCtx() {
  const target = {
    canvas: null,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 8 }),
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return (...args) => {
        calls.push({ op: String(p), args });
        return undefined;
      };
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}
const makeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx });
const ctx = makeCtx();
globalThis.performance = { now: () => 0 };
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, classList: { add() {}, toggle() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {}, requestAnimationFrame: () => 0, getComputedStyle: () => ({ getPropertyValue: () => '' }) };

const { Camera3D } = await import('../src/render/camera3d.js');
const { Renderer3D } = await import('../src/render/renderer3d.js');
const { Scene3D, SUBLAYER } = await import('../src/render/scene3d.js');
const { RoadNetwork } = await import('../src/model/network.js');
const { createEmptyWorld } = await import('../src/model/world.js');
const { makeRoad, makeNode, makeProp, makeVehicle } = await import('../src/model/schema.js');

let pass = 0;
let fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const cam = new Camera3D({ targetX: 10, targetY: 20, targetZ: 0, targetYaw: 0.6, targetPitch: 0.7, targetDistance: 120 });
cam.resize(1000, 700);
cam.update(1000);

check('camera eye is above the ground', cam.eye.z > 0, `z=${cam.eye.z}`);
check('camera eye is at the requested distance from the target', close(Math.hypot(cam.eye.x - cam.x, cam.eye.y - cam.y, cam.eye.z - cam.z), 120, 1e-6));

const centre = cam.project(cam.x, cam.y, cam.z);
check('camera target projects to the screen centre', centre && close(centre.x, 500, 0.5) && close(centre.y, 350, 0.5), centre ? `${centre.x.toFixed(2)},${centre.y.toFixed(2)}` : 'null');

check(
  'points behind the camera are rejected',
  cam.project(cam.x + Math.cos(cam.yaw) * 5000, cam.y + Math.sin(cam.yaw) * 5000, 0) === null
);
check('points in front of the camera are accepted', !!cam.project(cam.x - Math.cos(cam.yaw) * 200, cam.y - Math.sin(cam.yaw) * 200, 0));

const roundTrip = [];
for (const [wx, wy] of [[0, 0], [50, 30], [-40, 70], [10, 20], [60, -30], [-20, 60]]) {
  const s = cam.project(wx, wy, 0);
  if (!s || s.x < 0 || s.x > 1000 || s.y < 0 || s.y > 700) continue;
  const back = cam.groundAt(s.x, s.y);
  roundTrip.push(back ? Math.hypot(back.x - wx, back.y - wy) : Infinity);
}
check('round-trip samples all landed on screen', roundTrip.length >= 5, `${roundTrip.length} samples`);
check(
  'project -> groundAt round-trips on the ground plane',
  roundTrip.length > 0 && roundTrip.every((d) => d < 0.5),
  roundTrip.map((d) => (Number.isFinite(d) ? d.toFixed(3) : 'inf')).join(' ')
);
check('groundAt at the exact centre ray hits the target', (() => {
  const g = cam.groundAt(500, 350);
  return g && Math.hypot(g.x - cam.x, g.y - cam.y) < 0.5;
})());

// yaw = PI/2 is the default heading: camera south of the target, looking north, so
// the top-down view matches the 2D map (east right, north up).
const topCam = new Camera3D({ targetX: 5, targetY: 7, targetZ: 0, targetYaw: Math.PI / 2, targetPitch: Math.PI / 2 - 0.001, targetDistance: 200 });
topCam.resize(1000, 700);
topCam.update(1000);
const topCentre = topCam.groundAt(500, 350);
check('top-down centre ray hits the target', topCentre && close(topCentre.x, 5, 0.5) && close(topCentre.y, 7, 0.5), topCentre ? `${topCentre.x.toFixed(2)},${topCentre.y.toFixed(2)}` : 'null');
check('top-down puts east to the right', (() => {
  const p = topCam.project(5 + 50, 7, 0);
  return p && p.x > 500;
})());
check('top-down puts south (+y) at the bottom of the screen', (() => {
  const p = topCam.project(5, 7 + 50, 0);
  return p && p.y > 350;
})());
check('top-down puts north (-y) at the top of the screen', (() => {
  const p = topCam.project(5, 7 - 50, 0);
  return p && p.y < 350;
})());
check('the default camera heading looks north, matching the 2D map', (() => {
  const c = new Camera3D();
  c.resize(1000, 700);
  c.update(1000);
  return c.eye.y > c.y && Math.abs(c.eye.x - c.x) < 1e-6;
})());
check('top-down is not mirrored: east right, north up', (() => {
  const e = topCam.project(5 + 40, 7, 0);
  const s = topCam.project(5, 7 + 40, 0);
  const n = topCam.project(5, 7 - 40, 0);
  return e.x > 500 && s.y > 350 && n.y < 350;
})());

cam.zoomBy(0.5);
cam.update(1000);
check('zoom pulls the camera closer', cam.distance < 120, `d=${cam.distance.toFixed(2)}`);
check('zoom is clamped at the minimum', (() => {
  for (let i = 0; i < 60; i++) cam.zoomBy(0.5);
  return cam.distance >= cam.minDistance;
})());
cam.targetDistance = 120;
cam.update(1000);

cam.pitch = 0.4;
cam.panByPixels(0, 0);
check('pitch is clamped to the horizon limit', (() => {
  const c2 = new Camera3D({ targetPitch: 99 });
  return c2.clampPitch(99) <= c2.maxPitch;
})());

const world = createEmptyWorld('3d');
const a = world.addNode(makeNode(0, 0));
const b = world.addNode(makeNode(200, 0));
world.addRoad(makeRoad(a.id, b.id, { cls: 'primary' }));
for (let i = 0; i < 12; i++) world.addProp(makeProp('tree', i * 25 - 50, 40 + (i % 3) * 12));
const net = new RoadNetwork(world);
net.ensure();
const scene = new Scene3D(world, net);
scene.setSettings({ sidewalks: true });
const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
const r3 = new Renderer3D(canvas, world, scene);
r3.resize(1000, 700, 1);

cam.targetX = 100;
cam.targetY = 20;
cam.targetPitch = 0.6;
cam.targetDistance = 220;
cam.update(2000);
scene.ensureFor(cam.visibleBox(), 500);
const list = r3.buildDrawList(scene.gather(cam.visibleBox()), cam);
check('draw list is non-empty', list.length > 0, `got ${list.length}`);

let sorted = true;
for (let i = 1; i < list.length; i++) if (list[i].depth > list[i - 1].depth + 1e-9) sorted = false;
check('draw list is sorted far-to-near (painter\'s algorithm)', sorted);

check(
  'every drawn polygon has a finite screen path',
  list.every((it) => it.kind !== 'poly' || it.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) && q[2] > 0))
);
check(
  'every drawn polygon is at least a triangle on screen',
  list.every((it) => it.kind !== 'poly' || it.pts.length >= 3)
);
check('polygon screen paths have non-zero area', list.every((it) => {
  if (it.kind !== 'poly') return true;
  let area = 0;
  for (let i = 0; i < it.pts.length; i++) {
    const p = it.pts[i];
    const q = it.pts[(i + 1) % it.pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) > 0.01;
}));

const top = r3.shadeFor({ color: [180, 180, 180], normal: [0, 0, 1], lit: true }, cam);
const wall = r3.shadeFor({ color: [180, 180, 180], normal: [-1, 0, 0], lit: true }, cam);
const brightness = (s) => Number(s.match(/rgba?\((\d+)/)[1]);
check('an up-facing surface is brighter than a wall facing away from the light', brightness(top) > brightness(wall), `${brightness(top)} vs ${brightness(wall)}`);
const unlit = r3.shadeFor({ color: [120, 130, 140], lit: false }, cam);
check('unlit surfaces keep their exact colour', brightness(unlit) === 120, `${brightness(unlit)}`);

// A wall whose outward normal points away from the eye must be culled; the opposite wall kept.
const wallCam = new Camera3D({ targetX: 0, targetY: 0, targetZ: 2.5, targetYaw: 0, targetPitch: Math.PI / 2 - 0.001, targetDistance: 60 });
wallCam.resize(1000, 700);
wallCam.update(1000);
const backfacing = { kind: 'poly', sub: 6, pts: [[0, 0, 0], [10, 0, 0], [10, 0, 5], [0, 0, 5]], color: [200, 200, 200], normal: [1, 0, 0] };
const frontfacing = { ...backfacing, normal: [-1, 0, 0] };
check('the test wall is actually in view', !!wallCam.project(5, 0, 2.5));
const bl = r3.buildDrawList([backfacing, frontfacing], wallCam);
check('backface culling removes only the away-facing wall', bl.length === 1, `kept ${bl.length}`);
check('the kept wall is the one facing the eye', bl.length === 1 && bl[0].prim === frontfacing);
const twoSided = r3.buildDrawList([{ ...backfacing, doubleSided: true }, frontfacing], wallCam);
check('double-sided surfaces are never backface culled', twoSided.length === 2, `kept ${twoSided.length}`);

calls.length = 0;
r3.render(cam);
check('render() runs without throwing', true);
check('render() issued fill operations', calls.some((c) => c.op === 'fill'), `${calls.length} canvas ops`);

// Near-plane clipping: a polygon straddling the camera plane must still draw.
const straddle = [
  [cam.eye.x + 400, cam.y - 200, 0],
  [cam.eye.x + 400, cam.y + 200, 0],
  [cam.eye.x - 400, cam.y + 200, 0],
  [cam.eye.x - 400, cam.y - 200, 0],
];
const clipped = r3.buildDrawList(
  [{ kind: 'poly', sub: 2, pts: straddle, color: [200, 100, 100], lit: false }],
  cam
);
check('a polygon straddling the camera plane is clipped, not dropped', clipped.length === 1, `got ${clipped.length}`);
check(
  'clipped polygon has finite screen coords and positive depth',
  clipped.length === 1 && clipped[0].pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]) && q[2] > 0),
  clipped.length === 1 ? clipped[0].pts.map((q) => `${q[0].toFixed(0)},${q[1].toFixed(0)},${q[2].toFixed(2)}`).join(' | ') : 'none'
);
check('clipping actually engaged', clipped.length === 1 && r3.stats.clipped === 1, `clipped=${r3.stats.clipped}`);

r3.setSelection(['nope']);
const picked = r3.pickAt(cam, 500, 350);
check('pickAt returns an id or null without throwing', picked === null || typeof picked === 'string', `${picked}`);

/* ------------------------------------------------------------- vehicles */

{
  const vw = createEmptyWorld('Vehicles');
  vw.addNode(makeNode(0, 0));
  vw.addNode(makeNode(120, 0));
  vw.addRoad(makeRoad(vw.data.nodes[0].id, vw.data.nodes[1].id));
  const car = vw.addVehicle(makeVehicle('car', 40, 1.8, { yaw: 0.1 }));
  const bus = vw.addVehicle(makeVehicle('bus', 80, 1.6, { yaw: -0.2 }));
  vw.addVehicle(makeVehicle('car', 60, 40, { yaw: 1.2, color: '#ffffff' }));
  const vs = new Scene3D(vw, new RoadNetwork(vw));
  vs.setSettings({});
  const prims = vs.vehiclePrims();
  const bodies = prims.filter((p) => p.tag === 'vehicle');
  const carPrims = prims.filter((p) => p.tag === 'vehicle' && p.id === car.id);
  const busPrims = prims.filter((p) => p.tag === 'vehicle' && p.id === bus.id);
  check('every vehicle produces primitives', bodies.length > 0 && carPrims.length > 5 && busPrims.length > 5, `${bodies.length} prims`);
  check('primitives carry the vehicle id for picking', carPrims.every((p) => p.id === car.id));
  check('primitives use the vehicle sublayer', carPrims.every((p) => p.sub === SUBLAYER.vehicle), `${carPrims[0].sub}`);
  check('a bus is built from more geometry than a car', busPrims.length >= carPrims.length, `${busPrims.length} vs ${carPrims.length}`);

  const allPts = bodies.flatMap((p) => p.pts);
  check('vehicle geometry sits on the ground', allPts.every((q) => q[2] > 0 && q[2] < 6), `${Math.min(...allPts.map((q) => q[2])).toFixed(2)}..${Math.max(...allPts.map((q) => q[2])).toFixed(2)}`);
  check('vehicle geometry is around the cars', bodies.every((p) => p.pts.every((q) => Math.abs(q[0]) < 200 && Math.abs(q[1]) < 200)));

  const moved = makeVehicle('car', 40, 1.8, { yaw: 1.6 });
  const fingerprint = (v) => vs.vehiclePrims([v]).flatMap((p) => p.pts).map((q) => q.map((n) => n.toFixed(2)).join()).sort().join('|');
  check('turning a vehicle changes its geometry', fingerprint(car) !== fingerprint(moved));
  check('the same vehicle always builds the same geometry', fingerprint(car) === fingerprint(makeVehicle('car', 40, 1.8, { yaw: 0.1, id: car.id })));
  check('moved vehicles build fresh geometry', vs.vehiclePrims([{ ...car, x: 41, y: 1.9 }]).flatMap((p) => p.pts).some((q) => q[0] > 40.5));
  check('garbage positions are skipped', vs.vehiclePrims([{ id: 'x', kind: 'car', x: NaN, y: 0, yaw: 0 }]).length === 0);

  vs.shadows = false;
  check('shadows can be turned off', !vs.vehiclePrims().some((p) => p.shadow), 'shadow prims');

  const hidden = vw.data.vehicles[2];
  const layer = vw.data.layers[0];
  hidden.layerId = layer.id;
  layer.visible = false;
  check('hidden layers hide their vehicles', !vs.vehiclePrims().some((p) => p.id === hidden.id), hidden.id);
  layer.visible = true;

  const vcam = new Camera3D({ targetX: 60, targetY: 0, targetZ: 0, targetYaw: 0, targetPitch: 0.9, targetDistance: 60 });
  vcam.resize(1000, 700);
  vcam.update(1000);
  const vList = r3.buildDrawList(prims, vcam);
  check('vehicle primitives reach the draw list', vList.length > 6, `${vList.length}/${prims.length}`);
  check('vehicle polygons are on screen', vList.filter((i) => i.kind === 'poly').length > 3);

  let hit = null;
  for (let sy = 120; sy < 600 && !hit; sy += 8) {
    for (let sx = 200; sx < 900 && !hit; sx += 8) {
      const id = r3.pickAt(vcam, sx, sy, prims);
      if (id === car.id || id === bus.id) hit = id;
    }
  }
  check('vehicles can be picked in 3D', !!hit, `${hit}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
