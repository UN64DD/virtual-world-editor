import { uid } from '../core/util.js';

export const WORLD_FORMAT = 'vwe-world';
export const WORLD_VERSION = 1;

export const ROAD_CLASSES = {
  motorway: { label: 'Motorway', lanesF: 2, lanesB: 2, laneWidth: 3.7, speed: 110, divider: 'median', shoulders: true, access: 'car', z: 0, casing: '#4a4a4f', fill: '#6e6e74' },
  trunk: { label: 'Trunk road', lanesF: 2, lanesB: 2, laneWidth: 3.5, speed: 90, divider: 'double', access: 'car', z: 0, casing: '#4c4c51', fill: '#717177' },
  primary: { label: 'Primary', lanesF: 2, lanesB: 2, laneWidth: 3.4, speed: 70, divider: 'double', access: 'car', z: 1, casing: '#4f4f54', fill: '#75757b' },
  secondary: { label: 'Secondary', lanesF: 1, lanesB: 1, laneWidth: 3.4, speed: 50, divider: 'dashed', access: 'car', z: 2, casing: '#515156', fill: '#78787e' },
  tertiary: { label: 'Tertiary', lanesF: 1, lanesB: 1, laneWidth: 3.3, speed: 40, divider: 'dashed', access: 'car', z: 3, casing: '#535358', fill: '#7a7a80' },
  residential: { label: 'Residential', lanesF: 1, lanesB: 1, laneWidth: 3.1, speed: 30, divider: 'dashed', access: 'car', z: 4, casing: '#545459', fill: '#7c7c82' },
  living_street: { label: 'Living street', lanesF: 1, lanesB: 1, laneWidth: 3.0, speed: 10, divider: 'dashed', access: 'car', z: 4, casing: '#57575c', fill: '#83838a' },
  service: { label: 'Service road', lanesF: 1, lanesB: 1, laneWidth: 3.0, speed: 15, divider: 'dashed', access: 'car', z: 5, casing: '#58585d', fill: '#84848b' },
  pedestrian: { label: 'Pedestrian', lanesF: 1, lanesB: 0, laneWidth: 3.0, speed: 8, divider: 'none', access: 'foot', z: 6, casing: '#6f6a63', fill: '#a49a8c' },
  footway: { label: 'Footpath', lanesF: 1, lanesB: 0, laneWidth: 2.0, speed: 6, divider: 'none', access: 'foot', z: 6, casing: '#6f6a63', fill: '#9c948a' },
  cycleway: { label: 'Cycleway', lanesF: 1, lanesB: 0, laneWidth: 2.2, speed: 18, divider: 'none', access: 'bike', z: 6, casing: '#6a6a5e', fill: '#8e8f78' },
  track: { label: 'Track', lanesF: 1, lanesB: 1, laneWidth: 2.7, speed: 25, divider: 'dashed', access: 'car', z: 5, casing: '#5d564b', fill: '#8d8375' },
  path: { label: 'Path', lanesF: 1, lanesB: 0, laneWidth: 1.6, speed: 6, divider: 'none', access: 'foot', z: 6, casing: '#6f6a63', fill: '#9c948a' },
  unknown: { label: 'Unknown', lanesF: 1, lanesB: 1, laneWidth: 3.0, speed: 30, divider: 'dashed', access: 'car', z: 5, casing: '#585860', fill: '#808088' },
};

export const ROAD_CLASS_ORDER = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'service',
  'track',
  'unknown',
  'pedestrian',
  'cycleway',
  'footway',
  'path',
];

export const MARKING_KINDS = {
  solid: { label: 'Solid line', width: 0.15, color: '#f2f2f0', dash: null, auto: false },
  dashed: { label: 'Dashed line', width: 0.15, color: '#f2f2f0', dash: [3, 4.5], auto: true },
  dotted: { label: 'Dotted line', width: 0.15, color: '#f2f2f0', dash: [0.6, 3.4], auto: true },
  double: { label: 'Double solid', width: 0.15, color: '#f2f2f0', dash: null, auto: false, gap: 0.12 },
  double_dashed: { label: 'Double dashed', width: 0.15, color: '#f2f2f0', dash: [3, 4.5], auto: false, gap: 0.12 },
  edge: { label: 'Edge line', width: 0.2, color: '#e8e8e4', dash: null, auto: false },
  hatch: { label: 'Hatched area', width: 0.12, color: '#dedede', dash: null, auto: false },
  stop: { label: 'Stop bar', width: 0.4, color: '#f4f4f2', dash: null, auto: false },
  yield: { label: 'Yield triangles', width: 0.3, color: '#f4f4f2', dash: null, auto: false },
  arrow: { label: 'Lane arrow', width: 0.35, color: '#f4f4f2', dash: null, auto: false },
  zebra: { label: 'Zebra crossing', width: 0.5, color: '#f6f6f4', dash: null, auto: false },
  yellow_solid: { label: 'Yellow solid', width: 0.15, color: '#f5c542', dash: null, auto: false },
  yellow_dashed: { label: 'Yellow dashed', width: 0.15, color: '#f5c542', dash: [3, 4.5], auto: true },
};

export const MARKING_SIDES = ['left', 'right'];
export const MARKING_ROLES = ['divider', 'stop', 'arrow', 'zebra', 'text', 'hatch'];

export const PROP_KINDS = {
  tree: { label: 'Tree', radius: 2.6, height: 7.5, kind: 'tree', blocking: true, color: '#3f7a46' },
  pine: { label: 'Pine', radius: 1.9, height: 9, kind: 'pine', blocking: true, color: '#2f6340' },
  bush: { label: 'Bush', radius: 0.9, height: 1.2, kind: 'bush', blocking: false, color: '#4a8a4f' },
  hedge: { label: 'Hedge', radius: 0.6, height: 1.6, kind: 'hedge', blocking: true, color: '#3f7a46' },
  lamp: { label: 'Street lamp', radius: 0.3, height: 6.5, kind: 'lamp', blocking: false, color: '#9aa0a6' },
  traffic_light: { label: 'Traffic light', radius: 0.28, height: 3.4, kind: 'traffic_light', blocking: false, color: '#3a3f45' },
  sign: { label: 'Road sign', radius: 0.22, height: 2.3, kind: 'sign', blocking: false, color: '#8d9298' },
  bollard: { label: 'Bollard', radius: 0.14, height: 0.9, kind: 'bollard', blocking: true, color: '#c9ccd0' },
  barrier: { label: 'Guard rail', radius: 0.2, height: 0.85, length: 4, kind: 'barrier', blocking: true, color: '#b6bac0' },
  hydrant: { label: 'Fire hydrant', radius: 0.18, height: 0.8, kind: 'hydrant', blocking: false, color: '#c0392b' },
  bench: { label: 'Bench', radius: 0.4, height: 0.9, length: 1.8, kind: 'bench', blocking: false, color: '#8a6440' },
  bin: { label: 'Bin', radius: 0.35, height: 1.0, kind: 'bin', blocking: false, color: '#4d5b4a' },
  fence: { label: 'Fence', radius: 0.15, height: 1.5, length: 3, kind: 'fence', blocking: true, color: '#6f6a63' },
  power_pole: { label: 'Power pole', radius: 0.25, height: 9, kind: 'power_pole', blocking: true, color: '#7a6a58' },
  mailbox: { label: 'Mailbox', radius: 0.2, height: 1.1, kind: 'mailbox', blocking: false, color: '#4a5a72' },
  person: { label: 'Pedestrian', radius: 0.3, height: 1.75, kind: 'person', blocking: true, color: '#c8556d' },
  car: { label: 'Parked car', radius: 1.0, height: 1.45, length: 4.4, width: 1.85, kind: 'car', blocking: true, color: '#c9433f' },
  van: { label: 'Van', radius: 1.2, height: 2.3, length: 5.4, width: 2.0, kind: 'van', blocking: true, color: '#dfe3e8' },
  truck: { label: 'Truck', radius: 1.6, height: 3.2, length: 9.5, width: 2.5, kind: 'truck', blocking: true, color: '#3f6ea8' },
  bus: { label: 'Bus', radius: 1.6, height: 3.2, length: 11.5, width: 2.55, kind: 'bus', blocking: true, color: '#4a9e7a' },
  cone: { label: 'Traffic cone', radius: 0.2, height: 0.7, kind: 'cone', blocking: false, color: '#e2762f' },
  block: { label: 'Static block', radius: 1.0, height: 1.0, kind: 'block', blocking: true, color: '#c8a23a' },
};

export const PROP_KIND_ORDER = [
  'tree',
  'pine',
  'bush',
  'hedge',
  'lamp',
  'traffic_light',
  'sign',
  'bollard',
  'barrier',
  'hydrant',
  'bench',
  'bin',
  'fence',
  'power_pole',
  'mailbox',
  'person',
  'cone',
  'car',
  'van',
  'truck',
  'bus',
  'block',
];

export const SURFACE_KINDS = {
  grass: { label: 'Grass', color: '#7ea86a', z: -0.05, texture: 'grass' },
  meadow: { label: 'Meadow', color: '#8fb573', z: -0.04, texture: 'grass' },
  water: { label: 'Water', color: '#4f86b4', z: -0.12, texture: 'water' },
  asphalt: { label: 'Asphalt', color: '#6c6c72', z: -0.03, texture: 'noise' },
  parking: { label: 'Parking', color: '#5f5f66', z: -0.02, texture: 'noise' },
  sidewalk: { label: 'Sidewalk', color: '#a8a49c', z: 0.12, texture: 'paving' },
  plaza: { label: 'Plaza', color: '#b0aca4', z: 0.12, texture: 'paving' },
  crosswalk: { label: 'Crosswalk', color: '#8e8e92', z: 0.02, texture: 'noise' },
  dirt: { label: 'Dirt', color: '#9c8a6a', z: -0.03, texture: 'noise' },
  sand: { label: 'Sand', color: '#cdbd90', z: -0.02, texture: 'noise' },
  gravel: { label: 'Gravel', color: '#9d9a94', z: -0.02, texture: 'noise' },
  sports: { label: 'Sports field', color: '#6d9e5c', z: -0.03, texture: 'grass' },
  rail: { label: 'Railway', color: '#7b7267', z: 0.02, texture: 'noise' },
};

export const SURFACE_KIND_ORDER = Object.keys(SURFACE_KINDS);

export const ROOF_TYPES = {
  flat: { label: 'Flat' },
  gabled: { label: 'Gabled' },
  hip: { label: 'Hipped' },
};

export const BUILDING_KINDS = {
  house: { label: 'House', color: '#c9b39a', floors: 2, floorHeight: 3.0, roof: 'gabled', roofPitch: 0.9 },
  apartment: { label: 'Apartment', color: '#b8b2a8', floors: 5, floorHeight: 3.1, roof: 'flat', roofPitch: 0 },
  office: { label: 'Office', color: '#9aa3ad', floors: 9, floorHeight: 3.6, roof: 'flat', roofPitch: 0 },
  shop: { label: 'Shop', color: '#c2a98f', floors: 1, floorHeight: 4.2, roof: 'flat', roofPitch: 0 },
  warehouse: { label: 'Warehouse', color: '#a7a49b', floors: 1, floorHeight: 7.5, roof: 'gabled', roofPitch: 0.5 },
  garage: { label: 'Garage', color: '#b0aca4', floors: 1, floorHeight: 3.0, roof: 'flat', roofPitch: 0 },
  church: { label: 'Church', color: '#d3cec0', floors: 1, floorHeight: 9, roof: 'hip', roofPitch: 1.4 },
  school: { label: 'School', color: '#c4bfae', floors: 2, floorHeight: 3.4, roof: 'gabled', roofPitch: 0.8 },
  hospital: { label: 'Hospital', color: '#c8cdd2', floors: 8, floorHeight: 3.4, roof: 'flat', roofPitch: 0 },
  factory: { label: 'Factory', color: '#a09b91', floors: 2, floorHeight: 5.5, roof: 'gabled', roofPitch: 0.4 },
  tower: { label: 'Tower', color: '#96a0aa', floors: 16, floorHeight: 3.4, roof: 'flat', roofPitch: 0 },
  kiosk: { label: 'Kiosk', color: '#bfae95', floors: 1, floorHeight: 2.8, roof: 'flat', roofPitch: 0 },
};

export const BUILDING_KIND_ORDER = Object.keys(BUILDING_KINDS);

export const VEHICLE_PRESETS = {
  car: { label: 'Passenger car', wheelbase: 2.7, width: 1.85, length: 4.6, height: 1.48, maxSteer: 0.62, maxSpeed: 55, accel: 3.2, brake: 9, drag: 0.42, color: '#c9433f' },
  van: { label: 'Delivery van', wheelbase: 3.2, width: 2.0, length: 5.6, height: 2.4, maxSteer: 0.55, maxSpeed: 45, accel: 2.4, brake: 8, drag: 0.6, color: '#dfe3e8' },
  truck: { label: 'Box truck', wheelbase: 4.4, width: 2.5, length: 9.0, height: 3.3, maxSteer: 0.45, maxSpeed: 32, accel: 1.6, brake: 6, drag: 1.1, color: '#3f6ea8' },
  bus: { label: 'City bus', wheelbase: 5.8, width: 2.55, length: 11.5, height: 3.2, maxSteer: 0.42, maxSpeed: 28, accel: 1.4, brake: 6, drag: 1.3, color: '#4a9e7a' },
  sports: { label: 'Sports car', wheelbase: 2.6, width: 1.9, length: 4.4, height: 1.24, maxSteer: 0.66, maxSpeed: 72, accel: 6.5, brake: 14, drag: 0.34, color: '#e0a12c' },
};

export const VEHICLE_PRESET_ORDER = Object.keys(VEHICLE_PRESETS);

export function vehiclePreset(kind) {
  return VEHICLE_PRESETS[kind] || VEHICLE_PRESETS.car;
}

/** Body colours handed out in rotation so a fleet is easy to tell apart. */
export const VEHICLE_FLEET_COLORS = ['#c9433f', '#3f6ea8', '#4a9e7a', '#e0a12c', '#8a5cc4', '#2f8f9e', '#dfe3e8', '#b8563f'];

export const LAYER_DEFAULTS = [
  { key: 'buildings', name: 'Buildings', locked: false },
  { key: 'props', name: 'Street furniture & nature', locked: false },
  { key: 'surfaces', name: 'Surfaces & ground', locked: false },
  { key: 'roads', name: 'Roads', locked: false },
  { key: 'markings', name: 'Lane markings', locked: false },
  { key: 'signals', name: 'Traffic control', locked: false },
];

export function makeNode(x, y, extra = {}) {
  return {
    id: uid('n'),
    x,
    y,
    elevation: 0,
    name: '',
    junction: true,
    signals: false,
    signalPhase: 0,
    stopLine: true,
    ...extra,
  };
}

export function makeRoad(a, b, extra = {}) {
  const cls = ROAD_CLASSES[extra.cls || extra.roadClass || 'residential'] || ROAD_CLASSES.residential;
  return {
    id: uid('r'),
    layerId: null,
    a,
    b,
    cls: extra.cls || extra.roadClass || 'residential',
    lanesF: extra.lanesF ?? cls.lanesF,
    lanesB: extra.lanesB ?? cls.lanesB,
    laneWidth: extra.laneWidth ?? cls.laneWidth,
    speedLimit: extra.speedLimit ?? cls.speed,
    divider: extra.divider ?? cls.divider,
    sidewalk: extra.sidewalk ?? cls.access !== 'foot',
    oneway: extra.oneway ?? false,
    name: extra.name ?? '',
    reverse: extra.reverse ?? false,
    tunnel: extra.tunnel ?? false,
    bridge: extra.bridge ?? false,
    ground: extra.ground ?? false,
    tags: extra.tags ?? {},
  };
}

export function makeBuilding(poly, extra = {}) {
  const kind = extra.kind || 'house';
  const preset = BUILDING_KINDS[kind] || BUILDING_KINDS.house;
  const floors = extra.floors ?? preset.floors;
  const floorHeight = extra.floorHeight ?? preset.floorHeight;
  return {
    id: uid('b'),
    layerId: null,
    poly: poly.map((p) => ({ x: p.x, y: p.y })),
    kind,
    floors,
    floorHeight,
    height: extra.height ?? +(floors * floorHeight).toFixed(2),
    roof: extra.roof ?? preset.roof,
    roofPitch: extra.roofPitch ?? preset.roofPitch,
    color: extra.color ?? preset.color,
    name: extra.name ?? '',
    levels: extra.levels ?? 1,
    windows: extra.windows !== false,
    groundFloor: extra.groundFloor ?? true,
    tags: extra.tags ?? {},
  };
}

export function makeProp(kind, x, y, extra = {}) {
  const preset = PROP_KINDS[kind] || PROP_KINDS.tree;
  return {
    id: uid('p'),
    layerId: null,
    kind,
    x,
    y,
    z: extra.z ?? 0,
    rotation: extra.rotation ?? 0,
    scale: extra.scale ?? 1,
    color: extra.color ?? preset.color,
    height: extra.height ?? preset.height,
    linkedNode: extra.linkedNode ?? null,
    tags: extra.tags ?? {},
  };
}

/**
 * A drivable vehicle. Unlike a parked prop it carries its own handling model,
 * so the self-driving simulator can steer it without looking the kind up again.
 */
export function makeVehicle(kind, x, y, extra = {}) {
  const preset = vehiclePreset(kind);
  return {
    id: uid('v'),
    layerId: null,
    kind: VEHICLE_PRESETS[kind] ? kind : 'car',
    x,
    y,
    z: extra.z ?? 0,
    yaw: extra.yaw ?? 0,
    color: extra.color ?? preset.color,
    autonomous: extra.autonomous !== false,
    wheelbase: extra.wheelbase ?? preset.wheelbase,
    width: extra.width ?? preset.width,
    length: extra.length ?? preset.length,
    height: extra.height ?? preset.height,
    maxSteer: extra.maxSteer ?? preset.maxSteer,
    maxSpeed: extra.maxSpeed ?? preset.maxSpeed,
    accel: extra.accel ?? preset.accel,
    brake: extra.brake ?? preset.brake,
    drag: extra.drag ?? preset.drag,
    tags: extra.tags ?? {},
  };
}

export function makeSurface(poly, kind = 'grass', extra = {}) {
  const preset = SURFACE_KINDS[kind] || SURFACE_KINDS.grass;
  return {
    id: uid('s'),
    layerId: null,
    poly: poly.map((p) => ({ x: p.x, y: p.y })),
    kind,
    z: extra.z ?? preset.z,
    color: extra.color ?? preset.color,
    name: extra.name ?? '',
    tags: extra.tags ?? {},
  };
}

export function makeMarking(extra = {}) {
  const preset = MARKING_KINDS[extra.kind] || MARKING_KINDS.solid;
  return {
    id: uid('m'),
    layerId: null,
    roadId: extra.roadId ?? null,
    laneId: extra.laneId ?? null,
    side: extra.side ?? 'left',
    role: extra.role ?? 'divider',
    kind: extra.kind ?? 'solid',
    sStart: extra.sStart ?? 0,
    sEnd: extra.sEnd ?? null,
    offset: extra.offset ?? null,
    width: extra.width ?? preset.width,
    color: extra.color ?? preset.color,
    dash: extra.dash ?? preset.dash,
    tags: extra.tags ?? {},
  };
}

export function makeLayer(key, name, index) {
  return { id: `layer_${key}`, key, name, visible: true, locked: false, order: index };
}

export function roadClassInfo(road) {
  return ROAD_CLASSES[road?.cls] || ROAD_CLASSES.residential;
}
