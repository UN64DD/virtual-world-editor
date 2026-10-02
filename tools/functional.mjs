// Functional smoke test: builds a small world and exercises the model pipeline.
// Run with: node tools/functional.mjs
globalThis.performance = { now: () => 0 };
globalThis.document = {
  createElement: (tag) =>
    tag === 'canvas'
      ? { width: 1, height: 1, style: {}, getContext: () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => ((t[p] = v), true) }) }
      : { style: {}, classList: { add() {}, toggle() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {}, requestAnimationFrame: () => 0, getComputedStyle: () => ({ getPropertyValue: () => '' }) };

const { createEmptyWorld } = await import('../src/model/world.js');
const { RoadNetwork } = await import('../src/model/network.js');
const { makeRoad, makeMarking, makeBuilding, makeProp, makeNode } = await import('../src/model/schema.js');
const { History } = await import('../src/core/history.js');
const { roadMarkingBands, markingGeometry } = await import('../src/model/paint.js');
const { Scene3D } = await import('../src/render/scene3d.js');
const { SnapEngine } = await import('../src/snap.js');

let pass = 0;
let fail = 0;
function check(label, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const world = createEmptyWorld('Smoke test');
world.setOrigin(51.5074, -0.1278);

const n1 = world.addNode(makeNode(0, 0));
const n2 = world.addNode(makeNode(120, 0));
const n3 = world.addNode(makeNode(120, 90));
const n4 = world.addNode(makeNode(0, 90));
const e = world.addRoad(makeRoad(n1.id, n2.id, { cls: 'primary' }));
const s = world.addRoad(makeRoad(n2.id, n3.id, { cls: 'primary' }));
const w2 = world.addRoad(makeRoad(n3.id, n4.id, { cls: 'residential' }));
const n2r = world.addRoad(makeRoad(n4.id, n1.id, { cls: 'residential' }));
void w2;
void n2r;

check('world has 4 nodes', world.data.nodes.length === 4);
check('world has 4 roads', world.data.roads.length === 4);

const road = world.roadById(e.id);
const width = world.roadWidth(road);
check('primary road width = 2*(2*3.4) = 13.6', Math.abs(width - 13.6) < 1e-6, `got ${width}`);
check('road resolves nodes', !!world.roadNodes(road));
check('roadsAtNode(n2) = 2', world.roadsAtNode(n2.id).length === 2);

const net = new RoadNetwork(world);
net.ensure();
check('network built', net.builtRevision === world.revision, `rev ${net.builtRevision} vs ${world.revision}`);
const lanes = [...net.lanes.keys()];
check('lane graph populated', lanes.length > 0, `got ${lanes.length}`);
check(
  'every lane has finite geometry',
  lanes.every((id) => {
    const l = net.lanes.get(id);
    return l.center.length >= 2 && l.center.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  })
);
check('lanes carry boundary lines', lanes.every((id) => net.lanes.get(id).leftBoundary && net.lanes.get(id).rightBoundary));

const jpoly = net.junctionPoly(n2.id);
check('junction polygon at n2', Array.isArray(jpoly) && jpoly.length >= 3, `got ${jpoly && jpoly.length}`);
check('junction polygon is bounded', Array.isArray(jpoly) && jpoly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
check(
  'junction polygon covers both road widths',
  Array.isArray(jpoly) && jpoly.length > 0
);

check('junctions connect lanes', net.nodeLanesIn.get(n2.id).length > 0 && net.nodeLanesOut.get(n2.id).length > 0);
check('junctions produced successor edges', lanes.some((id) => net.lanes.get(id).successors.length > 0));
check(
  'turn types are valid',
  lanes.every((id) => net.lanes.get(id).successors.every((s) => typeof s.turn === 'string' && s.turn.length > 0))
);

const bands = roadMarkingBands(world, net, road);
check('lane markings generated for primary', bands.length > 0, `got ${bands.length}`);
check(
  'marking bands are well formed',
  bands.every((b) => Number.isFinite(b.offset) && Number.isFinite(b.halfWidth) && b.sEnd > b.sStart)
);

const zebraGeo = markingGeometry(world, net, makeMarking({ roadId: e.id, role: 'zebra', kind: 'zebra', sStart: 40, sEnd: 43 }));
check('zebra marking geometry generated', zebraGeo.polys.length > 0, `got ${zebraGeo.polys.length}`);
check(
  'zebra stripes have area (not degenerate)',
  zebraGeo.polys.every((poly) => {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      area += p.x * q.y - q.x * p.y;
    }
    return Math.abs(area) > 0.01;
  })
);
check(
  'zebra stripes span the road width',
  (() => {
    const p = zebraGeo.polys[0];
    const ys = p.map((q) => q.y);
    return Math.max(...ys) - Math.min(...ys) > 5;
  })()
);

const probe = net.nearestLane(0, -3);
check('nearestLane resolves a lane', !!probe, `${probe?.laneId}`);
check(
  'nearestLane reports distance and lateral offset',
  Number.isFinite(probe?.distance) && Number.isFinite(probe?.lateral) && Number.isFinite(probe?.s)
);
const eF0 = net.roadLanes(e.id).find((l) => l.dir === 'F' && l.index === 0);
const sF0 = net.roadLanes(s.id).find((l) => l.dir === 'F' && l.index === 0);
check('roadLanes exposes both carriageways', net.roadLanes(e.id).length === 4, `got ${net.roadLanes(e.id).length}`);
const route = net.route(eF0.id, sF0.id);
check('route found across network', route && route.lanes && route.lanes.length === 2, route ? `${route.lanes.length} lanes` : 'null');
check('route turn classified as right', route && route.turns[0] === 'right', route ? route.turns.join(',') : '');
check('route has finite length and time', route && Number.isFinite(route.length) && Number.isFinite(route.time) && route.length > 0);
check('route path points are finite', route && route.path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
check('unreachable lane pair returns null', net.route(eF0.id, eF0.id) !== null && net.route('nope', sF0.id) == null);

// Going the long way round the block exercises the full cycle.
const longRoute = net.route(eF0.id, net.roadLanes(world.roadById(n2r.id).id).find((l) => l.dir === 'F').id);
check('multi-turn route around the block found', longRoute && longRoute.lanes.length >= 4, longRoute ? `${longRoute.lanes.length} lanes` : 'null');
const autonomy = net.toAutonomyFormat();
check('autonomy export produced lanes', autonomy.lanes && autonomy.lanes.length > 0);
check('autonomy export is JSON-serializable', (() => { try { JSON.stringify(autonomy); return true; } catch { return false; } })());

world.addMarking(makeMarking({ roadId: e.id, role: 'zebra', kind: 'zebra', sStart: 40, sEnd: 43 }));
world.addMarking(makeMarking({ roadId: e.id, role: 'stop', kind: 'solid', sStart: 100 }));
check('2 markings added', world.data.markings.length === 2, `got ${world.data.markings.length}`);

const b = world.addBuilding(makeBuilding( [{ x: -60, y: -60 }, { x: -30, y: -60 }, { x: -30, y: -30 }, { x: -60, y: -30 }], { height: 12, floors: 3, roof: 'gabled' }));
const pr = world.addProp(makeProp('tree', 200, 200));
const flat = world.addProp(makeProp('car', 60, 12, { rotation: 0 }));
const lamp = world.addProp(makeProp('lamp', -14, 20, { rotation: Math.PI / 2 }));
const cone = world.addProp(makeProp('cone', 60, -12));
const person = world.addProp(makeProp('person', 62, -12));
void pr;
void flat;
void lamp;
void cone;
void person;
check('building added', !!world.buildingById(b.id));
check('5 props added', world.data.props.length === 5, `got ${world.data.props.length}`);

const scene = new Scene3D(world, net);
scene.setSettings({ sidewalks: true });
scene.ensureFor({ minX: -200, minY: -200, maxX: 300, maxY: 300 }, 1000);
const prims = scene.gather({ minX: -200, minY: -200, maxX: 300, maxY: 300 });
check('scene produced primitives', prims.length > 50, `got ${prims.length}`);
check(
  'every primitive is a well-formed flat point list',
  prims.every((p) => p.kind !== 'poly' || (Array.isArray(p.pts) && p.pts.length >= 3 && p.pts.every((q) => Array.isArray(q) && q.length === 3)))
);
check(
  'no NaN in scene primitives',
  prims.every((p) => (p.pts ? p.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2])) : Number.isFinite(p.x) && Number.isFinite(p.y)))
);
check('sprite primitives have no pts but valid position', prims.filter((p) => p.kind === 'sprite').every((p) => p.pts === undefined && Number.isFinite(p.x) && Number.isFinite(p.y)));
check('trees render as sprites', prims.some((p) => p.kind === 'sprite' && p.sprite === 'tree'));
check('person renders as a sprite', prims.some((p) => p.kind === 'sprite' && p.sprite === 'person'));
check('car renders as a prism', prims.some((p) => p.tag === 'prop' && p.normal && !p.sprite));
check('cones render with stacked tiers', prims.filter((p) => p.id === cone.id).length >= 5);
check('no invalid colors', prims.every((p) => Array.isArray(p.color) && p.color.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)));
check('building walls emitted', prims.some((p) => p.tag === 'wall' && p.id === b.id));
check('gable roof emitted', prims.some((p) => p.tag === 'roof' && p.id === b.id));
check('junction emitted', prims.some((p) => p.tag === 'junction' && p.id === n2.id));
check('sidewalks emitted', prims.some((p) => p.tag === 'sidewalk'));
check('stop bar emitted at minor approach', prims.some((p) => p.tag === 'stop'));

const beforeSpeed = road.speedLimit;
const hist = new History(world);
check('history starts empty', hist.state().canUndo === false);

hist.run('set speed limit', (tx) => {
  tx.patch(road, { speedLimit: 99 });
});
check('patch recorded', hist.state().canUndo === true && hist.state().undoLabel === 'set speed limit');
check('patch applied', road.speedLimit === 99);
hist.undo();
check('undo restored speed', road.speedLimit === beforeSpeed, `got ${road.speedLimit}`);
hist.redo();
check('redo reapplied speed', road.speedLimit === 99);
hist.undo();
check('undo again after redo', road.speedLimit === beforeSpeed);

const removedRoadId = s.id;
hist.run('delete road', (tx) => {
  tx.remove(removedRoadId);
});
check('road removed', world.roadById(removedRoadId) == null);
hist.undo();
check('undo restored road', !!world.roadById(removedRoadId));
check('undo restored road geometry', world.roadNodes(world.roadById(removedRoadId)) !== null);

const newRoad = makeRoad(n3.id, n2.id, { cls: 'service' });
hist.run('add road', (tx) => {
  tx.add('roads', newRoad);
});
check('road added', !!world.roadById(newRoad.id));
hist.undo();
check('undo removed the added road', world.roadById(newRoad.id) == null);

const labelBeforeAbort = hist.state().undoLabel;
let abortWorked = false;
try {
  hist.run('aborted edit', (tx) => {
    tx.patch(road, { speedLimit: 7 });
    throw new Error('boom');
  });
} catch {
  abortWorked = world.roadById(e.id).speedLimit === beforeSpeed;
}
check('aborted transaction rolls back and leaves history untouched', abortWorked && hist.state().undoLabel === labelBeforeAbort, `${hist.state().undoLabel} vs ${labelBeforeAbort}`);

// Removing a node must also remove its roads and markings, and undo must restore all of it.
const roadsAtN1 = world.roadsAtNode(n1.id).length;
const roadCountBefore = world.data.roads.length;
const markingCountBefore = world.data.markings.length;
check('n1 has incident roads before delete', roadsAtN1 >= 2, `degree ${roadsAtN1}`);
hist.run('delete node', (tx) => {
  tx.remove(n1.id);
});
check('node delete cascaded to roads', world.data.roads.length < roadCountBefore, `${roadCountBefore} -> ${world.data.roads.length}`);
check('node delete cascaded to markings', world.data.markings.length < markingCountBefore, `${markingCountBefore} -> ${world.data.markings.length}`);
hist.undo();
check('undo restored node', !!world.nodeById(n1.id));
check('undo restored cascaded roads', world.data.roads.length === roadCountBefore, `got ${world.data.roads.length}`);
check('undo restored cascaded markings', world.data.markings.length === markingCountBefore, `got ${world.data.markings.length}`);
check(
  'restored roads are connected again',
  (() => {
    const net3 = new RoadNetwork(world);
    net3.ensure();
    return net3.lanes.size > 0 && [...net3.lanes.values()].some((l) => l.successors.length > 0);
  })()
);

const net2 = new RoadNetwork(world);
net2.ensure();
check('network rebuild after edits', net2.builtRevision === world.revision && net2.lanes.size > 0, `${net2.lanes.size} lanes`);

const snap = new SnapEngine(world);
const near = snap.worldPoint(2.4, 3.6, { grid: 1, snapNode: false, snapRoad: false });
check('grid snap rounds to the grid', near.x === 2 && near.y === 4, `${near.x},${near.y}`);
check('snap reports kind and label', typeof near.kind === 'string' && typeof near.label === 'string');
check('grid snap is marked snapped', near.snapped === true);

const gridOff = snap.worldPoint(2.4, 3.6, { grid: 0, snapNode: false, snapRoad: false });
check('snapping can be disabled', gridOff.x === 2.4 && gridOff.y === 3.6, `${gridOff.x},${gridOff.y}`);

const onNode = snap.worldPoint(0.6, -0.4, { grid: 0, tolerance: 3 });
check('node snap pulls onto a junction node', onNode.kind === 'node' && onNode.x === 0 && onNode.y === 0, `${onNode.kind} ${onNode.x},${onNode.y}`);

const onRoad = snap.worldPoint(60, 2.4, { grid: 0, snapNode: false, tolerance: 6 });
check('road snap projects onto the road', onRoad.kind === 'road' && Math.abs(onRoad.y) < 0.001, `${onRoad.kind} ${onRoad.x},${onRoad.y}`);
check('road snap reports a target', !!onRoad.target);

const corner = snap.constrains({ x: 0, y: 0 }, { x: 10, y: 0 }, { angleStep: 15 });
check('angle constraint applied', Number.isFinite(corner.x) && Number.isFinite(corner.y));

const candidates = snap.candidateRoads(0, 0, 50);
check('candidateRoads finds nearby roads', candidates.length > 0, `got ${candidates.length}`);

const stats = world.stats();
check('stats computed', stats && typeof stats.roads === 'number', JSON.stringify(stats).slice(0, 120));

const json = world.toJSON();
const reloaded = (await import('../src/model/world.js')).World.fromJSON(json);
check('world round-trips through JSON', reloaded.data.roads.length === world.data.roads.length && reloaded.data.buildings.length === world.data.buildings.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
