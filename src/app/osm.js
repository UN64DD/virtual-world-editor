import { bboxFromWorld, formatBbox, parseLatLon } from '../model/geo.js';
import { makeNode, makeRoad, ROAD_CLASSES } from '../model/schema.js';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const HIGHWAY_CLASS = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'residential',
  unclassified: 'residential',
  living_street: 'living_street',
  service: 'service',
  pedestrian: 'pedestrian',
  footway: 'footway',
  path: 'path',
  cycleway: 'cycleway',
  track: 'track',
};

const SKIP = new Set(['proposed', 'construction', 'abandoned', 'razed', 'platform', 'bus_stop', 'escape', 'rest_area']);

export class OsmImporter {
  constructor(app) {
    this.app = app;
    this.aborted = false;
  }

  log(lines) {
    this.lines = this.lines || [];
    this.lines.push(...[].concat(lines));
  }

  buildQuery(bbox) {
    const b = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(6)).join(',');
    return `[out:json][timeout:90];(way["highway"](${b});(._;>;););out geom;`;
  }

  async fetchRoads(bbox, onStatus) {
    const query = this.buildQuery(bbox);
    let lastErr = null;
    for (const endpoint of MIRRORS) {
      if (this.aborted) throw new Error('Cancelled');
      onStatus?.(`Querying ${new URL(endpoint).host}…`);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: this.controller?.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        onStatus?.(`Got ${json.elements?.length || 0} elements`);
        return json.elements || [];
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Cancelled');
        lastErr = err;
        onStatus?.(`${new URL(endpoint).host} failed: ${err.message}`);
      }
    }
    throw lastErr || new Error('All Overpass mirrors failed');
  }

  importElements(elements, { replace = false, origin } = {}) {
    const world = this.app.world;
    const report = { nodes: 0, roads: 0, skipped: 0, names: [] };

    const ways = elements.filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2);
    report.ways = ways.length;

    if (replace) {
      world.removeMany([...world.data.roads.map((r) => r.id), ...world.data.nodes.map((n) => n.id)]);
    }

    const keyToNodeId = new Map();
    for (const way of ways) {
      const tags = way.tags || {};
      const hw = tags.highway;
      if (SKIP.has(hw)) {
        report.skipped += 1;
        continue;
      }
      const cls = HIGHWAY_CLASS[hw];
      if (!cls) {
        report.skipped += 1;
        continue;
      }
      const name = tags.name || tags['name:en'] || '';
      if (name && !report.names.includes(name)) report.names.push(name);
      const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout';
      const foot = ROAD_CLASSES[cls].access === 'foot';
      const segs = [];
      for (const pt of way.geometry) {
        if (pt.lat === undefined || pt.lon === undefined) continue;
        const p = origin ? projectInto(pt.lat, pt.lon, origin) : { x: pt.lon * 1e5, y: -pt.lat * 1e5 };
        const k = `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
        let id = keyToNodeId.get(k);
        if (!id) {
          id = world.addNode(makeNode(+p.x.toFixed(2), +p.y.toFixed(2), { junction: false, signals: false, stopLine: false })).id;
          keyToNodeId.set(k, id);
          report.nodes += 1;
        }
        segs.push(id);
      }
      for (let i = 0; i + 1 < segs.length; i++) {
        if (segs[i] === segs[i + 1]) continue;
        world.addRoad(
          makeRoad(segs[i], segs[i + 1], {
            cls,
            name,
            oneway,
            sidewalk: !foot,
            speedLimit: ROAD_CLASSES[cls].speed,
            tags: { highway: hw, ...(way.id ? { osmWay: String(way.id) } : {}) },
          })
        );
        report.roads += 1;
      }
    }

    promoteJunctions(world);
    world.touch(true);
    return report;
  }

  async run({ bbox, onStatus, onProgress, replace = false }) {
    this.controller = new AbortController();
    this.aborted = false;
    this.replaceMode = replace;
    let report;
    const elements = await this.fetchRoads(bbox, onStatus);
    onStatus?.('Building roads…');
    const origin = this.app.world.data.meta?.origin;
    this.app.history.run('Import OpenStreetMap roads', () => {
      report = this.importElements(elements, { origin, replace: this.replaceMode });
    });
    onProgress?.(1);
    return { report, elements };
  }

  abort() {
    this.aborted = true;
    this.controller?.abort();
  }
}

function projectInto(lat, lon, origin) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const dx = (lon - origin.lon) * mLon;
  const dy = -(lat - origin.lat) * mLat;
  const yaw = ((origin.yawDeg || 0) * Math.PI) / 180;
  if (!yaw) return { x: dx, y: dy };
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function promoteJunctions(world) {
  for (const node of world.data.nodes) {
    if (world.nodeDegree(node.id) >= 3) {
      node.junction = true;
      node.stopLine = true;
    }
  }
}

export { bboxFromWorld, formatBbox, parseLatLon };
