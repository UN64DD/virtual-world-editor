import { Emitter } from '../core/emitter.js';
import { boundingBox, polyArea, polyPerimeter, unionBox, boxIntersects } from '../core/geom.js';
import { clone, deepEqual, dist, uid } from '../core/util.js';
import { makeOrigin, refreshOrigin } from './geo.js';
import {
  LAYER_DEFAULTS,
  ROAD_CLASSES,
  VEHICLE_PRESETS,
  WORLD_FORMAT,
  WORLD_VERSION,
  makeLayer,
  roadClassInfo,
} from './schema.js';

export const COLLECTIONS = [
  { key: 'nodes', label: 'Junction node', singular: 'node', order: 0 },
  { key: 'roads', label: 'Road', singular: 'road', order: 1 },
  { key: 'markings', label: 'Lane marking', singular: 'marking', order: 2 },
  { key: 'buildings', label: 'Building', singular: 'building', order: 3 },
  { key: 'surfaces', label: 'Surface', singular: 'surface', order: 4 },
  { key: 'props', label: 'Object', singular: 'prop', order: 5 },
  { key: 'vehicles', label: 'Vehicle', singular: 'vehicle', order: 6 },
];

export const COLLECTION_BY_KEY = new Map(COLLECTIONS.map((c) => [c.key, c]));

export const DEFAULT_LAYER_KEY = {
  nodes: 'roads',
  roads: 'roads',
  markings: 'markings',
  buildings: 'buildings',
  surfaces: 'surfaces',
  props: 'props',
  vehicles: 'props',
};

class SpatialIndex {
  constructor(cellSize = 40) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.boxes = new Map();
    this.builtFor = -1;
  }

  key(cx, cy) {
    return `${cx},${cy}`;
  }

  clear() {
    this.cells.clear();
    this.boxes.clear();
  }

  insert(entityKey, id, box) {
    this.boxes.set(id, box);
    const cs = this.cellSize;
    const x0 = Math.floor(box.minX / cs);
    const x1 = Math.floor(box.maxX / cs);
    const y0 = Math.floor(box.minY / cs);
    const y1 = Math.floor(box.maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let set = this.cells.get(k);
        if (!set) {
          set = new Set();
          this.cells.set(k, set);
        }
        set.add(id);
      }
    }
  }

  query(box) {
    const out = new Set();
    const cs = this.cellSize;
    const x0 = Math.floor(box.minX / cs);
    const x1 = Math.floor(box.maxX / cs);
    const y0 = Math.floor(box.minY / cs);
    const y1 = Math.floor(box.maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(this.key(cx, cy));
        if (!set) continue;
        for (const id of set) {
          const b = this.boxes.get(id);
          if (b && boxIntersects(b, box)) out.add(id);
        }
      }
    }
    return out;
  }
}

export class World extends Emitter {
  constructor(data) {
    super();
    this.revision = 0;
    this.data = data || emptyWorldData();
    this.index = new SpatialIndex(40);
    this._maps = new Map();
    this._mapsDirty = true;
    if (data) this.adopt(data);
  }

  adopt(data) {
    this.data = data;
    this.touch(true);
  }

  touch(structural = false) {
    this._mapsDirty = true;
    if (this._batching) {
      this._pendingStructural = this._pendingStructural || structural;
      return;
    }
    this.revision += 1;
    this.index.clear();
    this.emit('change', { structural });
  }

  /**
   * The active history transaction installs a recorder here so that mutations
   * made through this World (rather than through the transaction object) are
   * still captured and can be undone. Undo/redo clears it to avoid re-recording.
   */
  _record(op) {
    if (this._recorder) this._recorder(op);
  }

  setRecorder(fn) {
    this._recorder = fn || null;
  }

  markDirty() {
    this._mapsDirty = true;
  }

  get meta() {
    return this.data.meta;
  }

  get origin() {
    return this.data.meta.origin;
  }

  collection(key) {
    return this.data[key];
  }

  layerByKey(key) {
    return this.data.layers.find((l) => l.key === key) || null;
  }

  layerById(id) {
    return this.data.layers.find((l) => l.id === id) || null;
  }

  defaultLayerId(key) {
    const l = this.layerByKey(key);
    return l ? l.id : null;
  }

  maps() {
    if (this._mapsDirty) {
      this._maps.clear();
      for (const c of COLLECTIONS) {
        const m = new Map();
        for (const item of this.data[c.key]) m.set(item.id, item);
        this._maps.set(c.key, m);
      }
      this._mapsDirty = false;
    }
    return this._maps;
  }

  byId(collectionKey, id) {
    const m = this.maps().get(collectionKey);
    return m ? m.get(id) : undefined;
  }

  findEntity(id) {
    for (const c of COLLECTIONS) {
      const obj = this.byId(c.key, id);
      if (obj) return { type: c.key, collection: c, object: obj };
    }
    return null;
  }

  entityType(id) {
    const found = this.findEntity(id);
    return found ? found.type : null;
  }

  allOfType(type) {
    const singular = String(type).replace(/s$/, '');
    if (singular === 'road') return this.data.roads;
    if (singular === 'node') return this.data.nodes;
    if (singular === 'building') return this.data.buildings;
    if (singular === 'surface') return this.data.surfaces;
    if (singular === 'marking') return this.data.markings;
    if (singular === 'prop') return this.data.props;
    if (singular === 'vehicle') return this.data.vehicles;
    return [];
  }

  add(collectionKey, obj, layerKey) {
    if (!obj.id) obj.id = uid(collectionKey.slice(0, 1));
    if (!obj.layerId) {
      const want = layerKey || this._pendingLayer || DEFAULT_LAYER_KEY[collectionKey];
      if (want) {
        const layer = this.layerById(want) || this.layerByKey(want);
        if (layer) obj.layerId = layer.id;
      }
    }
    this.data[collectionKey].push(obj);
    this._record({ op: 'add', collectionKey, id: obj.id, object: obj });
    this.touch(true);
    this.emit('add', { type: collectionKey, object: obj });
    return obj;
  }

  addMany(collectionKey, list, layerKey) {
    const layerId = layerKey ? this.defaultLayerId(layerKey) : null;
    for (const obj of list) {
      if (!obj.id) obj.id = uid(collectionKey.slice(0, 1));
      if (!obj.layerId && layerId) obj.layerId = layerId;
      this.data[collectionKey].push(obj);
      this._record({ op: 'add', collectionKey, id: obj.id, object: obj });
    }
    this.touch(true);
    return list;
  }

  remove(id) {
    const found = this.findEntity(id);
    if (!found) return false;
    const arr = this.data[found.type];
    const idx = arr.indexOf(found.object);
    if (idx >= 0) arr.splice(idx, 1);
    this._record({ op: 'remove', collectionKey: found.type, id, index: idx, snapshot: clone(found.object) });
    if (found.collection.singular === 'node') {
      const doomed = this.data.roads.filter((r) => r.a === id || r.b === id);
      for (const r of doomed) {
        const i2 = this.data.roads.indexOf(r);
        if (i2 < 0) continue;
        this.data.roads.splice(i2, 1);
        this._record({ op: 'remove', collectionKey: 'roads', id: r.id, index: i2, snapshot: clone(r) });
      }
      this._dropMarkingsForRoads(doomed.map((r) => r.id));
    }
    if (found.collection.singular === 'road') {
      this._dropMarkingsForRoads([id]);
    }
    this.touch(true);
    this.emit('remove', { type: found.type, id });
    return true;
  }

  _dropMarkingsForRoads(roadIds) {
    if (!roadIds || roadIds.length === 0) return [];
    const doomed = new Set(roadIds);
    const kept = [];
    const dropped = [];
    for (const m of this.data.markings) {
      if (m.roadId && doomed.has(m.roadId)) dropped.push(m);
      else kept.push(m);
    }
    if (dropped.length) {
      this.data.markings = kept;
      for (const m of dropped) this._record({ op: 'remove', collectionKey: 'markings', id: m.id, snapshot: clone(m), index: -1 });
      this.markDirty();
    }
    return dropped;
  }

  removeMany(ids) {
    for (const id of ids) this.remove(id);
  }

  addNode(node) {
    return this.add('nodes', node, this._pendingLayer);
  }

  addRoad(road) {
    return this.add('roads', road, this._pendingLayer);
  }

  addMarking(marking) {
    return this.add('markings', marking, this._pendingLayer);
  }

  addBuilding(building) {
    return this.add('buildings', building, this._pendingLayer);
  }

  addSurface(surface) {
    return this.add('surfaces', surface, this._pendingLayer);
  }

  addProp(prop) {
    return this.add('props', prop, this._pendingLayer);
  }

  addVehicle(vehicle) {
    return this.add('vehicles', vehicle, this._pendingLayer);
  }

  /** Assign the next added entities to this layer key (or entity layer id). */
  useLayer(layerKeyOrId) {
    this._pendingLayer = layerKeyOrId || null;
    return this;
  }

  nodeById(id) {
    return this.byId('nodes', id);
  }

  roadById(id) {
    return this.byId('roads', id);
  }

  markingById(id) {
    return this.byId('markings', id);
  }

  buildingById(id) {
    return this.byId('buildings', id);
  }

  surfaceById(id) {
    return this.byId('surfaces', id);
  }

  propById(id) {
    return this.byId('props', id);
  }

  vehicleById(id) {
    return this.byId('vehicles', id);
  }

  update(id, patch) {
    const found = this.findEntity(id);
    if (!found) return null;
    const changes = this._deriveUpdate(found, patch);
    const before = {};
    let dirty = false;
    for (const key in changes) {
      if (deepEqual(found.object[key], changes[key])) continue;
      before[key] = clone(found.object[key]);
      dirty = true;
    }
    Object.assign(found.object, changes);
    if (dirty) {
      this._record({ op: 'patch', collectionKey: found.type, id, before, after: clone(changes) });
      this.markDirty();
    }
    this.touch(found.collection.singular === 'road' || found.collection.singular === 'node');
    this.emit('update', { type: found.type, id, object: found.object });
    return found.object;
  }

  /** Keep dependent fields consistent so callers can patch one value safely. */
  _deriveUpdate(found, patch) {
    const o = { ...patch };
    const isBuilding = found.type === 'buildings';
    if (isBuilding) {
      const floors = o.floors !== undefined ? o.floors : o.floorHeight !== undefined ? undefined : o.floors;
      if (o.floors !== undefined) {
        const fh = o.floorHeight ?? found.object.floorHeight ?? 3;
        o.height = +(Number(o.floors) * fh).toFixed(2);
      } else if (o.floorHeight !== undefined && floors === undefined) {
        const fl = found.object.floors ?? 1;
        o.height = +(fl * Number(o.floorHeight)).toFixed(2);
      }
    }
    if (found.type === 'roads' && o.cls !== undefined && patch.lanesF === undefined) {
      const info = ROAD_CLASSES[o.cls];
      if (info) {
        o.lanesF = info.lanesF;
        o.lanesB = info.lanesB;
        o.laneWidth = info.laneWidth;
        o.speedLimit = info.speed;
        o.divider = info.divider;
        o.sidewalk = info.access !== 'foot';
      }
    }
    if (found.type === 'vehicles' && o.kind !== undefined && patch.wheelbase === undefined) {
      const preset = VEHICLE_PRESETS[o.kind];
      if (preset) {
        o.wheelbase = preset.wheelbase;
        o.width = preset.width;
        o.length = preset.length;
        o.height = preset.height;
        o.maxSteer = preset.maxSteer;
        o.maxSpeed = preset.maxSpeed;
        o.accel = preset.accel;
        o.brake = preset.brake;
        o.drag = preset.drag;
      }
    }
    return o;
  }

  removeRoad(roadOrId, opts = {}) {
    const road = typeof roadOrId === 'string' ? this.roadById(roadOrId) : roadOrId;
    if (!road) return false;
    const endNodes = [road.a, road.b].filter((id) => this.nodeById(id));
    for (const m of this.data.markings.filter((m) => m.roadId === road.id)) {
      const i = this.data.markings.indexOf(m);
      if (i >= 0) this.data.markings.splice(i, 1);
    }
    const i = this.data.roads.indexOf(road);
    if (i >= 0) this.data.roads.splice(i, 1);
    if (opts.pruneOrphans) {
      for (const nid of endNodes) {
        if (this.roadsAtNode(nid).length === 0) {
          const j = this.data.nodes.indexOf(this.nodeById(nid));
          if (j >= 0) this.data.nodes.splice(j, 1);
        }
      }
    }
    this.touch(true);
    this.emit('remove', { type: 'roads', id: road.id });
    return true;
  }

  nodeDegree(nodeId) {
    return this.roadsAtNode(nodeId).length;
  }

  roadEnds(road) {
    return [this.byId('nodes', road.a), this.byId('nodes', road.b)];
  }

  roadNodes(road) {
    const a = this.byId('nodes', road.a);
    const b = this.byId('nodes', road.b);
    return a && b ? [a, b] : null;
  }

  roadDirection(road, forward = true) {
    const [a, b] = this.roadNodes(road);
    if (!a || !b) return { x: 1, y: 0, length: 0, start: a, end: b };
    const from = forward ? a : b;
    const to = forward ? b : a;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return {
      x: length > 0 ? dx / length : 1,
      y: length > 0 ? dy / length : 0,
      length,
      start: from,
      end: to,
    };
  }

  roadLength(road) {
    return this.roadDirection(road, true).length;
  }

  laneCount(road) {
    return Math.max(0, road.oneway ? road.lanesF : road.lanesF + road.lanesB);
  }

  roadWidth(road) {
    return this.laneCount(road) * road.laneWidth;
  }

  roadInfo(road) {
    return roadClassInfo(road);
  }

  roadsAtNode(nodeId) {
    return this.data.roads.filter((r) => r.a === nodeId || r.b === nodeId);
  }

  entityBox(type, obj) {
    switch (type) {
      case 'nodes':
        return { minX: obj.x, minY: obj.y, maxX: obj.x, maxY: obj.y };
      case 'roads': {
        const [a, b] = this.roadNodes(obj);
        if (!a || !b) return null;
        const half = this.roadWidth(obj) / 2 + 2;
        return {
          minX: Math.min(a.x, b.x) - half,
          minY: Math.min(a.y, b.y) - half,
          maxX: Math.max(a.x, b.x) + half,
          maxY: Math.max(a.y, b.y) + half,
        };
      }
      case 'props': {
        const r = Math.max(0.6, (obj.height || 1) * 0.35);
        return { minX: obj.x - r, minY: obj.y - r, maxX: obj.x + r, maxY: obj.y + r };
      }
      case 'vehicles': {
        const half = Math.max(obj.length || 4.6, obj.width || 1.85) / 2 + 0.4;
        return { minX: obj.x - half, minY: obj.y - half, maxX: obj.x + half, maxY: obj.y + half };
      }
      case 'buildings':
      case 'surfaces':
        return boundingBox(obj.poly);
      case 'markings': {
        const road = obj.roadId ? this.byId('roads', obj.roadId) : null;
        if (!road) return null;
        const [a, b] = this.roadNodes(road);
        if (!a || !b) return null;
        const half = this.roadWidth(road) / 2 + 2;
        return {
          minX: Math.min(a.x, b.x) - half,
          minY: Math.min(a.y, b.y) - half,
          maxX: Math.max(a.x, b.x) + half,
          maxY: Math.max(a.y, b.y) + half,
        };
      }
      default:
        return null;
    }
  }

  ensureIndex() {
    if (this.index.builtFor === this.revision) return;
    this.index.clear();
    for (const c of COLLECTIONS) {
      for (const obj of this.data[c.key]) {
        const box = this.entityBox(c.key, obj);
        if (box) this.index.insert(c.key, obj.id, box);
      }
    }
    this.index.builtFor = this.revision;
  }

  queryIds(box) {
    this.ensureIndex();
    return this.index.query(box);
  }

  bbox() {
    let box = null;
    for (const c of COLLECTIONS) {
      for (const obj of this.data[c.key]) {
        const b = this.entityBox(c.key, obj);
        if (b) box = unionBox(box, b);
      }
    }
    return box || { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  }

  stats() {
    let roadLength = 0;
    let lanes = 0;
    let buildingArea = 0;
    for (const r of this.data.roads) {
      roadLength += this.roadLength(r);
      lanes += this.laneCount(r);
    }
    for (const b of this.data.buildings) buildingArea += Math.abs(polyArea(b.poly));
    return {
      nodes: this.data.nodes.length,
      roads: this.data.roads.length,
      lanes,
      roadLength,
      markings: this.data.markings.length,
      buildings: this.data.buildings.length,
      buildingArea,
      buildingFootprint: this.data.buildings.reduce((s, b) => s + polyPerimeter(b.poly), 0),
      surfaces: this.data.surfaces.length,
      surfaceArea: this.data.surfaces.reduce((s, x) => s + Math.abs(polyArea(x.poly)), 0),
      props: this.data.props.length,
    };
  }

  nearestNode(x, y, maxDist = Infinity, filter = null) {
    let best = null;
    let bestD = maxDist;
    for (const n of this.data.nodes) {
      if (filter && !filter(n)) continue;
      const d = dist(x, y, n.x, n.y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best ? { node: best, distance: bestD } : null;
  }

  clone() {
    return new World(clone(this.data));
  }

  repair() {
    const removed = { roads: 0, markings: 0, nodes: 0 };
    const validNodes = new Set(this.data.nodes.map((n) => n.id));
    const keepRoads = [];
    for (const r of this.data.roads) {
      if (!validNodes.has(r.a) || !validNodes.has(r.b)) {
        removed.roads += 1;
        continue;
      }
      if (r.a === r.b) {
        removed.roads += 1;
        continue;
      }
      r.lanesF = Math.max(0, Math.round(r.lanesF) || 0);
      r.lanesB = Math.max(0, Math.round(r.lanesB) || 0);
      if (r.oneway) r.lanesB = 0;
      r.laneWidth = Math.max(1.5, +r.laneWidth || 3.2);
      r.speedLimit = Math.max(5, +r.speedLimit || 30);
      if (!ROAD_CLASSES[r.cls]) r.cls = 'unknown';
      keepRoads.push(r);
    }
    this.data.roads = keepRoads;
    const validRoads = new Set(keepRoads.map((r) => r.id));
    const keepMarkings = [];
    for (const m of this.data.markings) {
      if (m.roadId && !validRoads.has(m.roadId)) {
        removed.markings += 1;
        continue;
      }
      keepMarkings.push(m);
    }
    this.data.markings = keepMarkings;
    const usedNodes = new Set();
    for (const r of this.data.roads) {
      usedNodes.add(r.a);
      usedNodes.add(r.b);
    }
    const before = this.data.nodes.length;
    this.data.nodes = this.data.nodes.filter((n) => usedNodes.has(n.id));
    removed.nodes = before - this.data.nodes.length;
    for (const b of this.data.buildings) {
      if (!Array.isArray(b.poly) || b.poly.length < 3) b.__invalid = true;
    }
    this.data.buildings = this.data.buildings.filter((b) => !b.__invalid);
    for (const s of this.data.surfaces) {
      if (!Array.isArray(s.poly) || s.poly.length < 3) s.__invalid = true;
    }
    this.data.surfaces = this.data.surfaces.filter((s) => !s.__invalid);
    const layerIds = new Set(this.data.layers.map((l) => l.id));
    for (const c of COLLECTIONS) {
      for (const obj of this.data[c.key]) {
        if (obj.layerId && !layerIds.has(obj.layerId)) obj.layerId = null;
        if (!obj.layerId) {
          const key = (LAYER_DEFAULTS.find((d) => d.key === c.key) || { key: DEFAULT_LAYER_KEY[c.key] }).key;
          const def = LAYER_DEFAULTS.find((d) => d.key === key);
          if (def) obj.layerId = this.defaultLayerId(def.key);
        }
      }
    }
    return removed;
  }

  setOrigin(lat, lon, yawDeg = 0) {
    const box = this.bbox();
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const o = makeOrigin(lat, lon, yawDeg);
    refreshOrigin(o);
    this.data.meta.origin = o;
    this.translate(-cx, -cy);
    this.touch(true);
  }

  translate(dx, dy) {
    for (const n of this.data.nodes) {
      n.x += dx;
      n.y += dy;
    }
    for (const r of this.data.roads) {
      const a = this.byId('nodes', r.a);
      const b = this.byId('nodes', r.b);
      if (a && b) {
        a.x += dx;
        a.y += dy;
        b.x += dx;
        b.y += dy;
      }
    }
    for (const c of ['buildings', 'surfaces']) {
      for (const o of this.data[c]) {
        for (const p of o.poly) {
          p.x += dx;
          p.y += dy;
        }
      }
    }
    for (const p of this.data.props) {
      p.x += dx;
      p.y += dy;
    }
    for (const v of this.data.vehicles) {
      v.x += dx;
      v.y += dy;
    }
    this.touch(true);
  }

  toJSON() {
    return clone(this.data);
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') throw new Error('World.fromJSON: expected an object');
    if (json.format && json.format !== WORLD_FORMAT) {
      throw new Error(`World.fromJSON: unsupported format "${json.format}" (expected "${WORLD_FORMAT}")`);
    }
    const data = clone(json);
    data.format = data.format || WORLD_FORMAT;
    data.version = data.version || WORLD_VERSION;
    const base = emptyWorldData(data.meta?.name || 'Untitled world');
    for (const k of Object.keys(base)) {
      if (data[k] === undefined || data[k] === null) data[k] = base[k];
    }
    if (!Array.isArray(data.layers) || data.layers.length === 0) data.layers = base.layers;
    if (!data.meta) data.meta = base.meta;
    if (!data.meta.settings) data.meta.settings = base.meta.settings;
    if (!data.meta.origin) data.meta.origin = base.meta.origin;
    const world = new World(data);
    world.repair();
    return world;
  }
}

export function emptyWorldData(name = 'Untitled world') {
  return {
    format: WORLD_FORMAT,
    version: WORLD_VERSION,
    meta: {
      name,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      author: '',
      notes: '',
      origin: makeOrigin(0, 0, 0),
      settings: {
        defaultRoadClass: 'residential',
        snapEnabled: true,
        snapGrid: 1,
        snapRoad: true,
        snapAngle: 15,
        units: 'metric',
        groundColor: '#8ea87a',
      },
    },
    layers: LAYER_DEFAULTS.map((d, i) => makeLayer(d.key, d.name, i)),
    nodes: [],
    roads: [],
    markings: [],
    buildings: [],
    surfaces: [],
    props: [],
    vehicles: [],
    signals: [],
    zones: [],
  };
}

export function createEmptyWorld(name = 'Untitled world') {
  return new World(emptyWorldData(name));
}
