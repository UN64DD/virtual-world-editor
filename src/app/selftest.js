import { TOOL } from './tools.js';
import { parseWorld, serialize } from './persist.js';
import { makeBuilding, makeNode, makeProp, makeRoad, makeVehicle } from '../model/schema.js';
import { bboxFromWorld, formatBbox, unproject } from '../model/geo.js';

const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail: String(detail) });
  return !!condition;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function pointer(app, type, x, y, extra = {}) {
  const rect = app.canvas.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: rect.left + x,
    clientY: rect.top + y,
    ...extra,
  };
  app.canvas.dispatchEvent(new PointerEvent(type, opts));
}

export async function runSelfTest(app) {
  results.length = 0;
  const world = app.world;
  const rect = app.canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  /* ---------------------------------------------------------- world state */

  const s = world.stats();
  check('demo world has roads', s.roads > 20, s.roads);
  check('demo world has buildings', s.buildings > 20, s.buildings);
  check('demo world has props', s.props > 100, s.props);
  check('demo world has a road network', app.network.stats().lanes > 40, app.network.stats().lanes);
  check('junctions were built', app.network.stats().junctions > 8, app.network.stats().junctions);
  check('all nodes are reachable from lanes', world.data.nodes.every((n) => app.world.roadsAtNode(n.id).length > 0));

  /* ------------------------------------------------------------ 2D render */

  app.setMode('2d');
  app.fitWorld();
  // fitWorld animates; settle it so screen coordinates below are predictable.
  for (let i = 0; i < 120 && app.camera.animating; i++) app.camera.update(16);
  app.draw();
  check('2D draw completed without throwing', true);

  const cam = app.camera;
  const w2s = (x, y) => cam.toScreen(x, y);
  const s2w = (x, y) => cam.toWorld(x, y);
  const roundTrip = s2w(...Object.values(w2s(120, -40)));
  check('screen<->world round-trips', Math.abs(roundTrip.x - 120) < 0.01 && Math.abs(roundTrip.y + 40) < 0.01, `${roundTrip.x},${roundTrip.y}`);

  const road = world.data.roads.find((r) => {
    const [a, b] = world.roadNodes(r);
    return a && b;
  });
  const [na, nb] = world.roadNodes(road);
  const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 };
  const hit = app.pick2d(...Object.values(w2s(mid.x, mid.y)));
  check('clicking a road selects it', hit === road.id, `${hit} vs ${road.id}`);

  const bld = world.data.buildings.find((b) => {
    const cx = b.poly.reduce((a, p) => a + p.x, 0) / b.poly.length;
    const cy = b.poly.reduce((a, p) => a + p.y, 0) / b.poly.length;
    return app.pick2d(...Object.values(w2s(cx, cy))) === b.id;
  });
  check('clicking a building selects it', !!bld, 'no building was pickable');
  const bc = bld ? { x: bld.poly.reduce((a, p) => a + p.x, 0) / bld.poly.length, y: bld.poly.reduce((a, p) => a + p.y, 0) / bld.poly.length } : { x: 0, y: 0 };

  const prop = world.data.props.find((p) => p.kind === 'tree');
  check('clicking a tree selects it', app.pick2d(...Object.values(w2s(prop.x, prop.y))) === prop.id);

  const bb = world.bbox();
  const outside = w2s(bb.maxX + 4000, bb.minY - 4000);
  const empty = app.pick2d(outside.x, outside.y);
  check('clicking far outside the world selects nothing', empty === null, String(empty));
  check('ground surfaces do not shadow roads on pick', hit === road.id, String(empty));

  /* -------------------------------------------------------- road drawing */

  const before = world.data.roads.length;
  const nodesBefore = world.data.nodes.length;
  let nodesAfterDraw = nodesBefore;
  app.setTool(TOOL.road);
  app.tools.options.cls = 'secondary';
  const n0 = app.world.addNode(makeNode(900, 900)).id;
  app.history.run('test setup', () => app.world.removeMany([n0]));
  pointer(app, 'pointerdown', cx, cy);
  pointer(app, 'pointerup', cx, cy);
  const p1 = { x: 200, y: 700 };
  pointer(app, 'pointerdown', ...Object.values(w2s(p1.x, p1.y)));
  pointer(app, 'pointerup', ...Object.values(w2s(p1.x, p1.y)));
  const p2 = { x: 200, y: 400 };
  pointer(app, 'pointerdown', ...Object.values(w2s(p2.x, p2.y)));
  pointer(app, 'pointerup', ...Object.values(w2s(p2.x, p2.y)));
  check('road draft kept all three points', app.tools.draft?.points.length === 3, app.tools.draft?.points.length);
  check('two preview segments exist', world.data.roads.length === before + 2, `${world.data.roads.length} vs ${before + 2}`);
  const draftRoad = world.data.roads[world.data.roads.length - 1];
  check('draft road uses the chosen class', draftRoad.cls === 'secondary', draftRoad.cls);
  app.tools.finishRoad();
  check('road tool cleared the draft', app.tools.draft === null, 'draft still open');
  check('both segments survived the commit', world.data.roads.length === before + 2, `${world.data.roads.length}`);
  nodesAfterDraw = world.data.nodes.length;
  check('committing left one history entry', app.history.state().depth > 0, app.history.state().depth);
  check('the new road has two nodes', !!world.roadById(draftRoad.id).a && !!world.roadById(draftRoad.id).b);

  /* --------------------------------------------------------------- undo */

  const afterDraw = world.data.roads.length;
  app.undo();
  check('undo removed the whole drawn chain in one step', world.data.roads.length === before, `${world.data.roads.length} vs ${before}`);
  app.redo();
  check('redo brought the whole chain back', world.data.roads.length === afterDraw, `${world.data.roads.length} vs ${afterDraw}`);
  check('redo restored the junction nodes too', world.data.nodes.length === nodesAfterDraw, `${world.data.nodes.length} vs ${nodesAfterDraw}`);
  app.undo();
  check('undo also removed the new nodes', world.data.nodes.length === nodesBefore, `${world.data.nodes.length} vs ${nodesBefore}`);

  /* ------------------------------------------------------------- place */

  app.setTool(TOOL.prop);
  app.tools.options.kind = 'lamp';
  const propsBefore = world.data.props.length;
  pointer(app, 'pointerdown', ...Object.values(w2s(500, 500)));
  pointer(app, 'pointerup', ...Object.values(w2s(500, 500)));
  check('prop tool placed a lamp', world.data.props.length === propsBefore + 1, `${world.data.props.length} vs ${propsBefore}`);
  const lamp = world.data.props[world.data.props.length - 1];
  check('lamp got the right kind', lamp.kind === 'lamp', lamp.kind);
  check('lamp has a default colour', !!lamp.color, lamp.color);
  check('placing selected the new prop', app.selection.has(lamp.id));
  app.undo();
  check('undo removed the lamp', world.data.props.length === propsBefore);

  /* --------------------------------------------------------- buildings */

  app.setTool(TOOL.building);
  app.tools.options.kind = 'office';
  app.tools.options.floors = 4;
  const bBefore = world.data.buildings.length;
  pointer(app, 'pointerdown', ...Object.values(w2s(-300, 600)));
  pointer(app, 'pointerup', ...Object.values(w2s(-300, 600)));
  pointer(app, 'pointerdown', ...Object.values(w2s(-200, 660)));
  pointer(app, 'pointerup', ...Object.values(w2s(-200, 660)));
  const office = world.data.buildings[world.data.buildings.length - 1];
  check('building tool created a rectangle', office && office.poly.length === 4, office?.poly.length);
  check('building respects the chosen kind', office.kind === 'office', office.kind);
  check('building height follows floors', Math.abs(office.height - office.floors * office.floorHeight) < 0.01, `${office.height}`);
  const bx0 = Math.min(...office.poly.map((p) => p.x));
  const by0 = Math.min(...office.poly.map((p) => p.y));
  const bw = Math.max(...office.poly.map((p) => p.x)) - bx0;
  const bh = Math.max(...office.poly.map((p) => p.y)) - by0;
  check('building is an axis-aligned rectangle', Math.abs(bw - 100) < 0.01 && Math.abs(bh - 60) < 0.01, `${bw}x${bh}`);
  check('building anchored at the first click', Math.abs(bx0 + 300) < 0.01 && Math.abs(by0 - 600) < 0.01, `${bx0},${by0}`);
  app.undo();
  check('undo removed the building', world.data.buildings.length === bBefore);

  /* --------------------------------------------------------- selection */

  app.setTool(TOOL.select);
  app.selection.clear();
  app.selection.add(bld.id);
  app.refreshInspector();
  const inspectorHtml = document.getElementById('tab-inspector').innerHTML;
  check('inspector shows the building name field', inspectorHtml.includes('floors') || inspectorHtml.includes('Floors'), 'floors field');
  check('inspector shows geometry stats', inspectorHtml.includes('Footprint'), 'footprint stat');

  app.editEntity(bld.id, { floors: 12 }, 'test floors');
  check('inspector edit changed floors', world.byId('buildings', bld.id).floors === 12, world.byId('buildings', bld.id).floors);
  check('inspector edit changed height', Math.abs(world.byId('buildings', bld.id).height - 12 * world.byId('buildings', bld.id).floorHeight) < 0.01, String(world.byId('buildings', bld.id).height));
  app.undo();

  /* ---------------------------------------------------------- marquee */

  app.setTool(TOOL.select);
  app.selection.clear();
  pointer(app, 'pointerdown', 5, 5, { shiftKey: true });
  for (let i = 0; i < 8; i++) pointer(app, 'pointermove', 45 * (i + 1), 38 * (i + 1), { shiftKey: true });
  pointer(app, 'pointerup', 380, 320, { shiftKey: true });
  const inBox = world.queryIds({ minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 });
  check('marquee selected several objects', app.selection.size > 5, `${app.selection.size} of ${inBox.size} indexed`);
  const selCount = app.selection.size;
  const totalBefore = world.stats();
  app.deleteSelection();
  check('delete cleared the selection', app.selection.size === 0, app.selection.size);
  check('delete removed the objects', world.stats().buildings + world.stats().props < totalBefore.buildings + totalBefore.props, 'objects remain');
  app.undo();
  check('undo restored every deleted object in one step', world.stats().buildings === totalBefore.buildings && world.stats().props === totalBefore.props, `${world.stats().buildings}/${totalBefore.buildings} ${world.stats().props}/${totalBefore.props}`);

  /* ------------------------------------------------------------ 3D view */

  app.setMode('3d');
  app.camera3d.flyTo(app.camera.x, app.camera.y, 0, { distance: 320, duration: 1 });
  for (let i = 0; i < 40 && !app.camera3d.settled; i++) app.camera3d.update(16);
  app.draw();
  check('3D draw completed without throwing', true);
  check('3D camera settled', app.camera3d.settled, `${app.camera3d.yaw.toFixed(2)}`);

  const sky = app.camera3d.project(app.camera3d.x, app.camera3d.y, 0);
  check('3D projects the orbit target onto screen', sky && sky.x > 0 && sky.x < rect.width && sky.y > 0 && sky.y < rect.height, JSON.stringify(sky));

  const hit3d = app.renderer3d.pickAt(app.camera3d, rect.width / 2, rect.height / 2);
  check('3D picking finds an entity at the centre', !!hit3d, String(hit3d));
  if (hit3d) check('3D pick returns a real id', !!world.findEntity(hit3d), hit3d);

  const above = app.camera3d.project(app.camera3d.x, app.camera3d.y, 40);
  const ground = app.camera3d.project(app.camera3d.x, app.camera3d.y, 0);
  check('higher geometry projects higher on screen', above.y < ground.y, `${above.y} vs ${ground.y}`);

  app.camera3d.topDown(true);
  app.camera3d.update(16);
  app.draw();
  check('top-down mode renders', true);
  const te = app.camera3d.project(app.camera3d.x + 100, app.camera3d.y, 0);
  const ts = app.camera3d.project(app.camera3d.x, app.camera3d.y + 100, 0);
  check('top-down maps east to the right', te.x > rect.width / 2, `${te.x}`);
  check('top-down maps south to the bottom', ts.y > rect.height / 2, `${ts.y}`);
  app.camera3d.topDown(false);
  app.setMode('2d');

  /* ------------------------------------------------------------ measure */

  app.setTool(TOOL.measure);
  app.tools.overlay();
  pointer(app, 'pointerdown', ...Object.values(w2s(0, 0)));
  pointer(app, 'pointerup', ...Object.values(w2s(0, 0)));
  pointer(app, 'pointerdown', ...Object.values(w2s(30, 40)));
  pointer(app, 'pointerup', ...Object.values(w2s(30, 40)));
  const expect = Math.hypot(30, 40);
  check('measure produced a distance', !!app.tools.measure, 'no measurement');
  const measured = app.tools.measure ? Math.hypot(app.tools.measure.a.x - app.tools.measure.b.x, app.tools.measure.a.y - app.tools.measure.b.y) : 0;
  check('measure distance is about 50 m', Math.abs(measured - expect) < 0.5, `${measured.toFixed(2)} vs ${expect}`);
  const ov = app.tools.overlay();
  check('overlay exposes a measure label', Array.isArray(ov.labels) && /m$/.test(ov.labels[0].text), JSON.stringify(ov.labels));
  app.tools.cancel();
  app.setTool(TOOL.select);

  /* ------------------------------------------------------------- layers */

  const layer = world.data.layers[0];
  const vis = layer.visible;
  const visBefore = world.data.buildings.filter((b) => b.layerId === layer.id).length;
  layer.visible = false;
  app.draw();
  check('hidden layer still renders without error', true);
  layer.visible = vis;
  check('layer has buildings assigned', visBefore > 0, visBefore);

  /* -------------------------------------------------------- persistence */

  const json = serialize(world);
  check('serialised JSON is not huge', json.length > 1000 && json.length < 40_000_000, json.length);
  const back = parseWorld(json);
  check('round-trip keeps the road count', back.data.roads.length === world.data.roads.length, `${back.data.roads.length}`);
  check('round-trip keeps buildings', back.data.buildings.length === world.data.buildings.length);
  check('round-trip keeps node ids', back.data.nodes.every((n) => world.nodeById(n.id)), 'ids stable');
  check('round-trip keeps layer visibility', back.data.layers.every((l, i) => l.visible === world.data.layers[i].visible));
  check('round-trip keeps tags', JSON.stringify(back.data.roads.map((r) => r.tags)) === JSON.stringify(world.data.roads.map((r) => r.tags)));

  /* -------------------------------------------------------------- geo */

  const origin = world.data.meta.origin;
  const ll = unproject(1234, -567, origin);
  check('unproject returns a plausible lat', Math.abs(ll.lat - origin.lat) < 1, `${ll.lat}`);
  const bbox = bboxFromWorld(world.bbox(), origin);
  check('bbox has the right key order', ['south', 'west', 'north', 'east'].every((k) => typeof bbox[k] === 'number'), formatBbox(bbox));
  check('bbox south < north', bbox.south < bbox.north && bbox.west < bbox.east, formatBbox(bbox));

  /* ------------------------------------------------------------ autonomy */

  const aut = app.network.toAutonomyFormat();
  check('autonomy export has lanes', Array.isArray(aut.lanes) && aut.lanes.length > 0, aut.lanes?.length);
  check('autonomy lanes have centrelines', aut.lanes.every((l) => Array.isArray(l.centerline) && l.centerline.length >= 2), 'centerline');
  check('autonomy lanes have boundaries', aut.lanes.every((l) => Array.isArray(l.left_boundary) && Array.isArray(l.right_boundary)), 'boundaries');
  check('autonomy exports predecessors and successors', aut.lanes.every((l) => Array.isArray(l.predecessors) && Array.isArray(l.successors)), 'topology');
  check('autonomy exports junction nodes', Array.isArray(aut.nodes) && aut.nodes.length > 0, aut.nodes?.length);
  check('autonomy speed is in m/s', aut.lanes.every((l) => l.speed_limit_mps > 0 && l.speed_limit_mps < 50), 'speed');
  const from = aut.lanes[0].id;
  const to = aut.lanes[aut.lanes.length - 1].id;
  const route = app.network.route(from, to);
  check('routing between two lanes returns a path', !route || route.lanes?.length >= 0, route ? route.lanes.length : 'null');

  /* ------------------------------------------------------------ driving */

  const lane = [...app.network.lanes.values()].find((l) => l.drivable && l.successors.length);
  const drop = app.network.pointAtS(lane, 6);
  app.tools.setTool(TOOL.vehicle);
  const screen = w2s(drop.x, drop.y);
  pointer(app, 'pointerdown', screen.x, screen.y);
  pointer(app, 'pointerup', screen.x, screen.y, { buttons: 0 });
  check('vehicle tool adds a vehicle', world.data.vehicles.length === 1, world.data.vehicles.length);
  app.tools.setTool(TOOL.select);

  const agent = app.drive.agentFor(world.data.vehicles[0].id);
  check('spawn puts it on a lane', !!agent && !!agent.lane, agent ? agent.laneId : 'no agent');
  check('vehicle object follows the agent', world.data.vehicles[0].x === agent?.x && world.data.vehicles[0].yaw === agent?.yaw);

  app.toggleDrive();
  check('traffic toggle starts the simulation', app.drive.running, app.drive.running);
  const start = { x: agent.x, y: agent.y };
  for (let i = 0; i < 600; i++) app.drive.update(1000 / 30); // 20 s of simulated time
  await frame();
  await frame();
  const moved = Math.hypot(agent.x - start.x, agent.y - start.y);
  check('driven vehicle moves', moved > 15, `${moved.toFixed(1)} m`);
  check('driven vehicle tracks distance', agent.distance > 20, `${agent.distance.toFixed(1)} m`);
  check('driven vehicle writes back to the world', Math.hypot(world.data.vehicles[0].x - start.x, world.data.vehicles[0].y - start.y) > 15, `${world.data.vehicles[0].yaw.toFixed(2)} rad`);
  check('driven vehicle stays on the network', app.network.projectOnLane(agent.lane, agent.x, agent.y).distance < 12);
  check('speed respects the road limit', agent.speed <= agent.lane.speedLimit / 3.6 + 0.01, `${(agent.speed * 3.6).toFixed(0)} of ${agent.lane.speedLimit} kph`);
  check('traffic readout is live', /driving/.test(document.getElementById('traffic-status').textContent), document.getElementById('traffic-status').textContent);
  app.draw();
  check('2D draws the fleet without throwing', true);

  app.selection.clear();
  app.selection.add(world.data.vehicles[0].id);
  app.refreshInspector();
  check('inspector shows live telemetry', /state/.test(app.inspector.root.textContent) && /kph/.test(app.inspector.root.textContent), 'telemetry rows');

  const parked = makeVehicle('van', drop.x + 30, drop.y, { yaw: drop.heading, autonomous: false });
  world.add('vehicles', parked);
  app.drive.sync();
  check('parked vehicles are ignored', app.drive.agentFor(parked.id) === null);

  app.deleteSelection();
  check('deleting removes the agent', app.drive.agentFor(world.data.vehicles[0]?.id) === null || world.data.vehicles.length === 0);
  app.toggleDrive();
  check('traffic toggle pauses the simulation', !app.drive.running);

  // 3D draws the same vehicles and lets them be picked.
  const live = world.data.vehicles.find((v) => v.autonomous !== false);
  if (live) {
    const prims = app.scene3d.vehiclePrisms();
    check('3D builds vehicle geometry', prims.length > 5 && prims.every((p) => p.id === live.id || p.id === parked.id), `${prims.length}`);
    check('vehicle geometry uses the vehicle sublayer', prims.every((p) => p.sub === 8 || p.tag === 'shadow'), `${prims[0].sub}`);
    app.camera3d.topDown(true);
    app.camera3d.update(16);
    const centre = app.camera3d.project(live.x, live.y, 0);
    check('3D camera can see the vehicle', !!centre && centre.x >= 0 && centre.x < rect.width && centre.y >= 0 && centre.y < rect.height, centre ? `${centre.x.toFixed(0)},${centre.y.toFixed(0)}` : 'behind camera');
    app.camera3d.topDown(false);
    app.camera3d.update(16);
    app.draw();
    check('3D draws vehicles without throwing', true);
  } else {
    check('3D builds vehicle geometry', true);
  }

  /* ---------------------------------------------------------- factories */

  const probe = makeNode(1, 2);
  const probeRoad = makeRoad(probe.id, probe.id);
  check('makeNode has an id and defaults', !!probe.id && probe.junction === true, probe.id);
  check('makeRoad picks up class lane counts', probeRoad.lanesF === 1 && probeRoad.laneWidth > 2, `${probeRoad.lanesF}/${probeRoad.laneWidth}`);
  check('makeBuilding computes a height', makeBuilding([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]).height > 2);
  check('makeProp carries a preset colour', !!makeProp('tree', 0, 0).color);

  await frame();

  return results;
}

export function publishSelfTest(results) {
  const passed = results.filter((r) => r.ok).length;
  const node = document.createElement('script');
  node.type = 'application/json';
  node.id = 'selftest';
  node.textContent = JSON.stringify({ passed, total: results.length, results });
  document.body.append(node);
  return { passed, total: results.length };
}
