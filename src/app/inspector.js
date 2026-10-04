import { checkbox, el, field, input, replace, select } from './dom.js';
import {
  BUILDING_KINDS,
  LAYER_DEFAULTS,
  MARKING_KINDS,
  MARKING_ROLES,
  MARKING_SIDES,
  PROP_KINDS,
  ROAD_CLASSES,
  ROAD_CLASS_ORDER,
  ROOF_TYPES,
  SURFACE_KINDS,
  VEHICLE_PRESETS,
  VEHICLE_PRESET_ORDER,
  roadClassInfo,
} from '../model/schema.js';
import { bboxFromWorld, formatBbox, latLonString, unproject } from '../model/geo.js';
import { polyArea, polyCentroid, polyPerimeter } from '../core/geom.js';

const TYPE_LABEL = {
  nodes: 'Junction node',
  roads: 'Road',
  markings: 'Lane marking',
  buildings: 'Building',
  surfaces: 'Surface',
  props: 'Object',
  vehicles: 'Vehicle',
};

export class Inspector {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('tab-inspector');
    this.layersRoot = document.getElementById('tab-layers');
    this.worldRoot = document.getElementById('tab-world');
  }

  render() {
    this.renderInspector();
    this.renderLayers();
    this.renderWorld();
  }

  renderInspector() {
    const app = this.app;
    const ids = [...app.selection];
    if (!ids.length) {
      replace(this.root, [
        el('div', { class: 'empty' }, [
          el('div', { text: 'Nothing selected' }),
          el('p', { class: 'note', text: 'Pick a tool from the toolbar, or click an object with the Select tool.' }),
        ]),
      ]);
      return;
    }
    const found = ids.map((id) => app.world.findEntity(id)).filter(Boolean);
    if (found.length === 1) {
      replace(this.root, this.renderOne(found[0]));
      return;
    }
    const groups = new Map();
    for (const f of found) groups.set(f.type, (groups.get(f.type) || 0) + 1);
    const body = [
      el('div', { class: 'group' }, [
        el('h3', { text: `${ids.length} objects selected` }),
        ...[...groups].map(([type, n]) =>
          el('div', { class: 'stat' }, [el('span', { text: TYPE_LABEL[type] || type }), el('b', { text: String(n) })])
        ),
      ]),
    ];
    if (found.length > 1 && found.every((f) => ['buildings', 'surfaces'].includes(f.type))) {
      body.push(this.group('Nudge with arrow keys', [
        el('div', { class: 'row' }, [
          el('button', { class: 'btn', text: '←', onclick: () => this.nudge(-1, 0) }),
          el('button', { class: 'btn', text: '↑', onclick: () => this.nudge(0, -1) }),
          el('button', { class: 'btn', text: '↓', onclick: () => this.nudge(0, 1) }),
          el('button', { class: 'btn', text: '→', onclick: () => this.nudge(1, 0) }),
        ]),
      ]));
    }
    body.push(
      el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => app.duplicateSelection(ids) }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => app.deleteSelection() }),
      ])
    );
    replace(this.root, body);
  }

  /**
   * Live telemetry for a driven vehicle. Re-rendered by the app while the
   * simulation runs, so it reads state rather than settings.
   */
  driveGroup(o) {
    const app = this.app;
    const drive = app.drive;
    const agent = drive?.agentFor(o.id);
    if (!drive) {
      return this.group('Driving', [el('div', { class: 'note', text: 'Traffic is not running in this world.' })]);
    }
    const rows = [];
    if (!agent) {
      rows.push(el('div', { class: 'note', text: agent === null ? 'No simulation agent yet.' : 'Not driving.' }));
    } else {
      const stat = (k, v) => el('div', { class: 'stat' }, [el('span', { text: k }), el('b', { text: v })]);
      rows.push(stat('state', agent.state || '—'));
      if (agent.reason) rows.push(stat('because', agent.reason));
      rows.push(stat('speed', `${Math.round(agent.speed * 3.6)} kph`));
      rows.push(stat('along lane', `${Math.round(agent.s)} / ${Math.round(agent.lane.length)} m`));
      rows.push(stat('distance', `${Math.round(agent.distance)} m`));
      if (agent.signal) rows.push(stat('signal', agent.signal));
      if (agent.laneId) rows.push(stat('lane', agent.laneId));
    }
    rows.push(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn',
          text: drive.running ? 'Pause traffic' : 'Start traffic',
          onclick: () => app.toggleDrive(),
        }),
        el('button', {
          class: 'btn',
          text: 'Re-drop here',
          title: 'Put the vehicle back on the nearest lane from where it now sits',
          onclick: () => {
            const agent = drive.agentFor(o.id);
            if (!agent) {
              app.toast('This vehicle is not being driven', 'warn');
              return;
            }
            if (!app.network?.nearestLane(o.x, o.y)) {
              app.toast('No road nearby', 'warn');
              return;
            }
            drive.place(agent, o.x, o.y, o.yaw);
            app.requestDraw();
            app.refreshInspector();
          },
        }),
      ])
    );
    return this.group('Driving', rows);
  }

  renderOne(found) {
    const app = this.app;
    const out = [];
    out.push(
      el('div', { class: 'group' }, [
        el('h3', { text: TYPE_LABEL[found.type] || found.type }),
        el('div', { class: 'note', text: found.object.id }),
      ])
    );
    out.push(...this.fieldsFor(found));
    out.push(
      el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: 'Focus', onclick: () => app.focusSelection() }),
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => app.duplicateSelection([found.object.id]) }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => app.deleteSelection() }),
      ])
    );
    return out;
  }

  fieldsFor(found) {
    const app = this.app;
    const o = found.object;
    const type = found.type;
    const patch = (changes, label) => app.editEntity(o.id, changes, label);
    const out = [];

    if (type === 'nodes') {
      const deg = app.world.nodeDegree(o.id);
      out.push(
        this.group('Position', [
          field('x (m)', input(round(o.x, 3), (v) => patch({ x: num(v, o.x) }), { type: 'number', step: 0.1 })),
          field('y (m)', input(round(o.y, 3), (v) => patch({ y: num(v, o.y) }), { type: 'number', step: 0.1 })),
          field('elevation', input(round(o.elevation, 2), (v) => patch({ elevation: num(v, o.elevation) }), { type: 'number', step: 0.1 })),
          this.geoRow(o.x, o.y),
        ])
      );
      out.push(
        this.group('Node', [
          field('name', input(o.name || '', (v) => patch({ name: v }), { title: 'Street name shown on the map' })),
          field('junction', checkbox(o.junction, (v) => patch({ junction: v }))),
          field('signals', checkbox(o.signals, (v) => patch({ signals: v }))),
          field('stop line', checkbox(o.stopLine, (v) => patch({ stopLine: v }))),
          el('div', { class: 'note', text: `Connected to ${deg} road${deg === 1 ? '' : 's'}` }),
        ])
      );
    }

    if (type === 'roads') {
      const cls = roadClassInfo(o);
      const len = app.world.roadLength(o);
      const a = app.world.byId('nodes', o.a);
      const b = app.world.byId('nodes', o.b);
      out.push(
        this.group('Road', [
          field('class', select(o.cls, ROAD_CLASS_ORDER.map((k) => [k, ROAD_CLASSES[k].label]), (v) => patch({ cls: v, lanesF: ROAD_CLASSES[v].lanesF, lanesB: ROAD_CLASSES[v].lanesB, laneWidth: ROAD_CLASSES[v].laneWidth, speedLimit: ROAD_CLASSES[v].speed, divider: ROAD_CLASSES[v].divider, sidewalk: ROAD_CLASSES[v].access !== 'foot' }))),
          field('name', input(o.name || '', (v) => patch({ name: v }))),
          field('lanes →', input(o.lanesF, (v) => patch({ lanesF: int(v, o.lanesF) }), { type: 'number', min: 0, max: 8, step: 1 })),
          field('lanes ←', input(o.lanesB, (v) => patch({ lanesB: int(v, o.lanesB) }), { type: 'number', min: 0, max: 8, step: 1 })),
          field('lane width', input(o.laneWidth, (v) => patch({ laneWidth: num(v, o.laneWidth) }), { type: 'number', min: 1.5, max: 6, step: 0.1 })),
          field('speed', input(o.speedLimit, (v) => patch({ speedLimit: num(v, o.speedLimit) }), { type: 'number', min: 5, max: 130, step: 5 })),
        ])
      );
      out.push(
        this.group('Divider & access', [
          field('divider', select(o.divider || 'none', ['none', 'dashed', 'solid', 'double', 'double_dashed', 'median'], (v) => patch({ divider: v }))),
          field('sidewalk', checkbox(o.sidewalk, (v) => patch({ sidewalk: v }))),
          field('one way', checkbox(o.oneway, (v) => patch({ oneway: v }))),
          field('tunnel', checkbox(o.tunnel, (v) => patch({ tunnel: v }))),
          field('bridge', checkbox(o.bridge, (v) => patch({ bridge: v }))),
        ])
      );
      out.push(
        this.group('Geometry', [
          el('div', { class: 'stat' }, [el('span', { text: 'Length' }), el('b', { text: `${len.toFixed(1)} m` })]),
          el('div', { class: 'stat' }, [el('span', { text: 'Carriageway' }), el('b', { text: `${(app.world.roadWidth(o) - (o.sidewalk ? 2 * (cls.sidewalkWidth ?? 2.5) : 0)).toFixed(1)} m` })]),
          el('div', { class: 'stat' }, [el('span', { text: 'From' }), el('b', { text: a ? `${a.x.toFixed(1)}, ${a.y.toFixed(1)}` : '—' })]),
          el('div', { class: 'stat' }, [el('span', { text: 'To' }), el('b', { text: b ? `${b.x.toFixed(1)}, ${b.y.toFixed(1)}` : '—' })]),
          el('div', { class: 'stat' }, [el('span', { text: 'Heading' }), el('b', { text: headingText(app.world.roadDirection(o)) })]),
        ])
      );
    }

    if (type === 'markings') {
      const road = o.roadId ? app.world.roadById(o.roadId) : null;
      out.push(
        this.group('Marking', [
          field('kind', select(o.kind, Object.keys(MARKING_KINDS).map((k) => [k, MARKING_KINDS[k].label]), (v) => patch({ ...MARKING_KINDS[v], kind: v, width: MARKING_KINDS[v].width, color: MARKING_KINDS[v].color, dash: MARKING_KINDS[v].dash ?? null }))),
          field('role', select(o.role, MARKING_ROLES, (v) => patch({ role: v }))),
          field('side', select(o.side, MARKING_SIDES, (v) => patch({ side: v }))),
          field('color', el('input', { type: 'color', value: o.color || '#ffffff', oninput: (e) => patch({ color: e.target.value }) })),
          field('width', input(o.width, (v) => patch({ width: num(v, o.width) }), { type: 'number', min: 0.05, max: 3, step: 0.05 })),
        ])
      );
      const len = road ? app.world.roadLength(road) : 0;
      out.push(
        this.group('Along road', [
          field('start (m)', input(o.sStart, (v) => patch({ sStart: clampNum(v, 0, len) }), { type: 'number', step: 0.5 })),
          field('end (m)', input(o.sEnd ?? len, (v) => patch({ sEnd: clampNum(v, 0, len) }), { type: 'number', step: 0.5 })),
          el('div', { class: 'note', text: `Road length ${len.toFixed(1)} m` }),
          road ? el('div', { class: 'note', text: `On ${road.name || 'unnamed road'}` }) : null,
        ])
      );
    }

    if (type === 'buildings') {
      const area = Math.abs(polyArea(o.poly));
      out.push(
        this.group('Building', [
          field('kind', select(o.kind, Object.keys(BUILDING_KINDS), (v) => patch(BUILDING_KINDS[v]))),
          field('name', input(o.name || '', (v) => patch({ name: v }))),
          field('color', el('input', { type: 'color', value: o.color || '#c9b39a', oninput: (e) => patch({ color: e.target.value }) })),
        ])
      );
      out.push(
        this.group('Massing', [
          field('floors', input(o.floors, (v) => patch(floorPatch(o, v)), { type: 'number', min: 1, max: 40, step: 1 })),
          field('floor h', input(o.floorHeight, (v) => patch({ floorHeight: num(v, o.floorHeight), height: +(int(v, o.floors) * num(v, o.floorHeight)).toFixed(2) }), { type: 'number', min: 2, max: 6, step: 0.1 })),
          field('roof', select(o.roof || 'flat', Object.keys(ROOF_TYPES), (v) => patch({ roof: v }))),
          field('pitch', input(o.roofPitch ?? 0.5, (v) => patch({ roofPitch: num(v, o.roofPitch) }), { type: 'number', min: 0, max: 2, step: 0.05 })),
          el('div', { class: 'stat' }, [el('span', { text: 'Height' }), el('b', { text: `${(o.height ?? 0).toFixed(1)} m` })]),
          el('div', { class: 'stat' }, [el('span', { text: 'Footprint' }), el('b', { text: `${area.toFixed(0)} m²` })]),
          el('div', { class: 'stat' }, [el('span', { text: 'Perimeter' }), el('b', { text: `${polyPerimeter(o.poly).toFixed(0)} m` })]),
        ])
      );
      out.push(
        this.group('Details', [
          field('windows', checkbox(o.windows, (v) => patch({ windows: v }))),
          field('ground floor', checkbox(o.groundFloor, (v) => patch({ groundFloor: v }))),
        ])
      );
    }

    if (type === 'surfaces') {
      out.push(
        this.group('Surface', [
          field('kind', select(o.kind, Object.keys(SURFACE_KINDS), (v) => patch(SURFACE_KINDS[v]))),
          field('name', input(o.name || '', (v) => patch({ name: v }))),
          field('color', el('input', { type: 'color', value: o.color || '#8ea87a', oninput: (e) => patch({ color: e.target.value }) })),
          field('z', input(o.z, (v) => patch({ z: num(v, o.z) }), { type: 'number', step: 0.05 })),
          el('div', { class: 'stat' }, [el('span', { text: 'Area' }), el('b', { text: `${Math.abs(polyArea(o.poly)).toFixed(0)} m²` })]),
        ])
      );
    }

    if (type === 'props') {
      const preset = PROP_KINDS[o.kind] || {};
      out.push(
        this.group('Object', [
          field('kind', select(o.kind, Object.keys(PROP_KINDS), (v) => patch(PROP_KINDS[v]))),
          field('color', el('input', { type: 'color', value: o.color || preset.color || '#3f7a46', oninput: (e) => patch({ color: e.target.value }) })),
          field('height', input(o.height, (v) => patch({ height: num(v, o.height) }), { type: 'number', min: 0.2, max: 120, step: 0.1 })),
          field('scale', input(o.scale, (v) => patch({ scale: num(v, o.scale) }), { type: 'number', min: 0.1, max: 12, step: 0.1 })),
          field('rotation', input(round((o.rotation || 0) * (180 / Math.PI), 1), (v) => patch({ rotation: (num(v, 0) * Math.PI) / 180 }), { type: 'number', step: 5, title: 'degrees' })),
          field('z', input(o.z, (v) => patch({ z: num(v, o.z) }), { type: 'number', step: 0.05 })),
        ])
      );
      out.push(this.group('Position', [field('x (m)', input(round(o.x, 3), (v) => patch({ x: num(v, o.x) }), { type: 'number', step: 0.1 })), field('y (m)', input(round(o.y, 3), (v) => patch({ y: num(v, o.y) }), { type: 'number', step: 0.1 })), this.geoRow(o.x, o.y)]));
    }

    if (type === 'vehicles') {
      const preset = VEHICLE_PRESETS[o.kind] || {};
      out.push(
        this.group('Vehicle', [
          field('kind', select(o.kind, VEHICLE_PRESET_ORDER, (v) => patch({ ...VEHICLE_PRESETS[v], kind: v }))),
          field('autonomous', checkbox(o.autonomous !== false, (v) => patch({ autonomous: v }))),
          field('color', el('input', { type: 'color', value: o.color || preset.color || '#c9433f', oninput: (e) => patch({ color: e.target.value }) })),
          field('max speed', input(o.maxSpeed ?? preset.maxSpeed, (v) => patch({ maxSpeed: num(v, preset.maxSpeed) }), { type: 'number', min: 5, max: 200, step: 1, title: 'kph' })),
        ])
      );
      out.push(this.driveGroup(o));
    }

    out.push(this.layerField(found));
    if (o.tags && Object.keys(o.tags).length) {
      out.push(
        this.group('Tags', [
          el('table', { class: 'attr-table' }, Object.entries(o.tags).flatMap(([k, v]) => [el('td', { text: k }), el('td', { text: String(v) })])),
        ])
      );
    }
    return out.filter(Boolean);
  }

  geoRow(x, y) {
    const app = this.app;
    const origin = app.world.data.meta?.origin;
    if (!origin) return null;
    const ll = unproject(x, y, origin);
    return el('div', { class: 'note', text: latLonString(ll.lat, ll.lon) });
  }

  layerField(found) {
    const app = this.app;
    if (!found.object.layerId) return null;
    const layer = app.world.layerById(found.object.layerId);
    return this.group('Layer', [
      field(
        'layer',
        select(found.object.layerId, app.world.data.layers.map((l) => [l.id, l.name]), (v) => {
          app.editEntity(found.object.id, { layerId: v }, 'Change layer');
        })
      ),
      layer ? el('div', { class: 'note', text: layer.locked ? 'This layer is locked' : '' }) : null,
    ]);
  }

  nudge(dx, dy) {
    this.app.nudgeSelection(dx, dy);
  }

  renderLayers() {
    const app = this.app;
    const layers = app.world.data.layers;
    const counts = layerCounts(app.world);
    const rows = [
      el('div', { class: 'group' }, [
        el('h3', { text: 'Layers' }),
        ...layers.map((l) => {
          const row = el('div', { class: `layer${l.visible ? '' : ' hidden-layer'}` }, [
            el('button', {
              class: 'toggle',
              text: l.visible ? '\u25CF' : '\u25CB',
              title: l.visible ? 'Hide layer' : 'Show layer',
              onclick: () => {
                app.history.run('Toggle layer', () => {
                  l.visible = !l.visible;
                });
                app.afterEdit();
                app.renderSidebars();
                app.requestDraw();
              },
            }),
            el('span', { class: 'name', text: l.name, onclick: () => app.zoomToLayer(l) }),
            el('span', { class: 'count', text: String(counts[l.id] || 0) }),
            el('button', {
              class: 'toggle',
              text: l.locked ? '\u{1F512}' : '\u{1F513}',
              title: l.locked ? 'Unlock layer' : 'Lock layer',
              onclick: () => {
                app.history.run('Toggle layer lock', () => {
                  l.locked = !l.locked;
                });
                app.afterEdit();
                app.renderSidebars();
              },
            }),
          ]);
          return row;
        }),
      ]),
    ];
    for (const def of LAYER_DEFAULTS) {
      if (app.world.layerByKey(def.key)) continue;
      rows.push(
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn',
            text: `+ ${def.name}`,
            onclick: () => {
              app.addLayer(def.key, def.name);
              app.renderSidebars();
            },
          }),
        ])
      );
    }
    replace(this.layersRoot, rows);
  }

  renderWorld() {
    const app = this.app;
    const meta = app.world.data.meta || {};
    const s = app.world.stats();
    const net = app.network?.stats?.() || {};
    const origin = meta.origin;
    replace(this.worldRoot, [
      this.group('World', [
        field('name', input(meta.name || '', (v) => app.renameWorld(v))),
        field('author', input(meta.author || '', (v) => app.patchMeta({ author: v }))),
        field('units', select(meta.settings?.units || 'metric', [['metric', 'Metric (m)'], ['imperial', 'Imperial (ft)']], (v) => app.patchSettings({ units: v }))),
      ]),
      this.group('Origin (for OSM import)', [
        el('div', { class: 'stat' }, [el('span', { text: 'Latitude' }), el('b', { text: origin ? origin.lat.toFixed(6) : '—' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Longitude' }), el('b', { text: origin ? origin.lon.toFixed(6) : '—' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Rotation' }), el('b', { text: `${(origin?.yawDeg ?? 0).toFixed(1)}°` })]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn', text: 'Set from view', onclick: () => app.setOriginFromView() }),
        ]),
        el('p', { class: 'note', text: 'The origin anchors local metres to real Earth coordinates for OpenStreetMap data.' }),
      ]),
      this.group('Statistics', [
        el('div', { class: 'stat' }, [el('span', { text: 'Roads' }), el('b', { text: String(s.roads) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Road length' }), el('b', { text: `${fmt(s.roadLength)} m` })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Lanes' }), el('b', { text: String(s.lanes) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Junction nodes' }), el('b', { text: String(s.nodes) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Lane markings' }), el('b', { text: String(s.markings) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Buildings' }), el('b', { text: String(s.buildings) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Building area' }), el('b', { text: `${fmt(s.buildingArea)} m²` })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Objects' }), el('b', { text: String(s.props) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Surface area' }), el('b', { text: `${fmt(s.surfaceArea)} m²` })]),
      ]),
      this.group('Driving network', [
        el('div', { class: 'stat' }, [el('span', { text: 'Drivable lanes' }), el('b', { text: String(net.drivable ?? 0) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Junctions' }), el('b', { text: String(net.junctions ?? 0) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Lane length' }), el('b', { text: `${fmt(net.length)} m` })]),
        el('div', { class: 'stat' }, [el('span', { text: 'U-turns' }), el('b', { text: String(net.uturns ?? 0) })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Dead ends' }), el('b', { text: String(net.deadEnds ?? 0) })]),
        el('div', { class: 'row' }, [el('button', { class: 'btn', text: 'Rebuild network', onclick: () => app.rebuildNetwork() })]),
        el('div', { class: 'row' }, [el('button', { class: 'btn', text: 'Export autonomy JSON', onclick: () => app.exportAutonomy() })]),
      ]),
      this.group('Snapping', [
        field('snap enabled', checkbox(meta.settings?.snapEnabled !== false, (v) => app.patchSettings({ snapEnabled: v }))),
        field('snap to road', checkbox(meta.settings?.snapRoad !== false, (v) => app.patchSettings({ snapRoad: v }))),
        field('grid (m)', input(meta.settings?.snapGrid ?? 1, (v) => app.patchSettings({ snapGrid: num(v, 1) }), { type: 'number', min: 0, max: 50, step: 0.5 })),
        field('angle (°)', input(meta.settings?.snapAngle ?? 15, (v) => app.patchSettings({ snapAngle: num(v, 15) }), { type: 'number', min: 0, max: 90, step: 1 })),
      ]),
      this.group('Notes', [field(' ', el('textarea', { rows: 4, style: { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '5px', padding: '4px 6px' }, oninput: (e) => app.patchMeta({ notes: e.target.value }) }, [meta.notes || '']))]),
      this.group('Extent', [
        el('div', { class: 'note', text: `${app.world.bbox().minX.toFixed(1)} … ${app.world.bbox().maxX.toFixed(1)} m east, ${app.world.bbox().minY.toFixed(1)} … ${app.world.bbox().maxY.toFixed(1)} m south` }),
        origin ? el('div', { class: 'note', text: formatBbox(bboxFromWorld(app.world.bbox(), origin)) }) : null,
      ]),
    ]);
  }

  group(title, children) {
    return el('div', { class: 'group' }, [el('h3', { text: title }), ...children.filter(Boolean)]);
  }
}

function layerCounts(world) {
  const counts = {};
  for (const obj of world.allOfType('building')) bump(counts, obj.layerId);
  for (const obj of world.allOfType('prop')) bump(counts, obj.layerId);
  for (const obj of world.allOfType('surface')) bump(counts, obj.layerId);
  for (const obj of world.allOfType('road')) bump(counts, obj.layerId);
  for (const obj of world.allOfType('marking')) bump(counts, obj.layerId);
  return counts;
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function floorPatch(o, v) {
  const floors = int(v, o.floors);
  return { floors, height: +(floors * (o.floorHeight || 3)).toFixed(2) };
}

function num(v, fallback) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, num(v, lo)));
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round((v || 0) * f) / f;
}

function headingText(dir) {
  if (!dir || !dir.length) return '—';
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  return `${((deg + 360) % 360).toFixed(0)}\u00b0`;
}

function fmt(n) {
  const v = Math.round(n || 0);
  return v >= 1000 ? v.toLocaleString() : String(v);
}

export { polyCentroid };
