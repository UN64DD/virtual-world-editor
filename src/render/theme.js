import { ROAD_CLASSES } from '../model/schema.js';
import { mixColor, rgba, shade } from '../core/util.js';

export const STYLES = {
  day: {
    label: 'Day',
    background: '#eceff2',
    backgroundFar: '#e2e7eb',
    ground: '#dfe7da',
    gridMinor: 'rgba(64,86,108,0.06)',
    gridMajor: 'rgba(64,86,108,0.14)',
    gridAxis: 'rgba(190,70,60,0.30)',
    gridLabel: 'rgba(60,78,96,0.55)',
    surfaceDefault: '#dfe7da',
    roadCasing: '#c4cad3',
    roadShoulder: '#e0e4e9',
    junction: '#ffffff',
    laneLine: '#f6f7f4',
    laneLineYellow: '#f2b632',
    laneEdge: '#ffffff',
    buildingFill: '#d5cfc6',
    buildingFillAlt: '#cac3b8',
    buildingStroke: '#a89e90',
    buildingShadow: 'rgba(80,90,100,0.20)',
    buildingLabel: '#6b6156',
    propStroke: '#4f6b52',
    treeFill: '#5f8f5c',
    water: '#6ba3cd',
    grass: '#a9c79a',
    text: '#2f3a44',
    textHalo: 'rgba(255,255,255,0.9)',
    selection: '#0b84ff',
    selectionFill: 'rgba(11,132,255,0.16)',
    hover: 'rgba(11,132,255,0.42)',
    handle: '#ffffff',
    handleStroke: '#0b84ff',
    guide: '#ff9500',
    ghost: 'rgba(11,132,255,0.55)',
    dim: 'rgba(120,132,146,0.55)',
    shadowStrength: 0.35,
    nightFactor: 0,
  },
  dusk: {
    label: 'Dusk',
    background: '#2b3242',
    backgroundFar: '#232938',
    ground: '#333a41',
    gridMinor: 'rgba(255,255,255,0.05)',
    gridMajor: 'rgba(255,255,255,0.11)',
    gridAxis: 'rgba(255,120,110,0.30)',
    gridLabel: 'rgba(220,230,245,0.45)',
    surfaceDefault: '#343b42',
    roadCasing: '#22272f',
    roadShoulder: '#3b424a',
    junction: '#5a616a',
    laneLine: '#f0ead2',
    laneLineYellow: '#f5c14a',
    laneEdge: '#f5f1e0',
    buildingFill: '#4a4640',
    buildingFillAlt: '#413d38',
    buildingStroke: '#6a635a',
    buildingShadow: 'rgba(0,0,0,0.42)',
    buildingLabel: '#cfc6b8',
    propStroke: '#7f9c86',
    treeFill: '#456b46',
    water: '#2f5b7d',
    grass: '#3f4f3c',
    text: '#e6ecf5',
    textHalo: 'rgba(0,0,0,0.65)',
    selection: '#4aa3ff',
    selectionFill: 'rgba(74,163,255,0.22)',
    hover: 'rgba(74,163,255,0.5)',
    handle: '#0d1117',
    handleStroke: '#4aa3ff',
    guide: '#ffa62b',
    ghost: 'rgba(74,163,255,0.6)',
    dim: 'rgba(160,170,185,0.6)',
    shadowStrength: 0.55,
    nightFactor: 0.45,
  },
  night: {
    label: 'Night',
    background: '#12161c',
    backgroundFar: '#0c1015',
    ground: '#171c23',
    gridMinor: 'rgba(255,255,255,0.04)',
    gridMajor: 'rgba(255,255,255,0.09)',
    gridAxis: 'rgba(255,110,100,0.28)',
    gridLabel: 'rgba(200,215,235,0.4)',
    surfaceDefault: '#181d24',
    roadCasing: '#0d1013',
    roadShoulder: '#22272f',
    junction: '#39414b',
    laneLine: '#e8e2c8',
    laneLineYellow: '#ffd166',
    laneEdge: '#efe9d2',
    buildingFill: '#262b33',
    buildingFillAlt: '#212630',
    buildingStroke: '#3c434e',
    buildingShadow: 'rgba(0,0,0,0.6)',
    buildingLabel: '#9aa6b6',
    propStroke: '#5f7a68',
    treeFill: '#2f4a36',
    water: '#12304a',
    grass: '#1d2820',
    text: '#dfe7f2',
    textHalo: 'rgba(0,0,0,0.7)',
    selection: '#39a0ff',
    selectionFill: 'rgba(57,160,255,0.22)',
    hover: 'rgba(57,160,255,0.5)',
    handle: '#05080b',
    handleStroke: '#39a0ff',
    guide: '#ffb03a',
    ghost: 'rgba(57,160,255,0.6)',
    dim: 'rgba(140,152,170,0.55)',
    shadowStrength: 0.7,
    nightFactor: 0.78,
  },
};

export const STYLE_ORDER = ['day', 'dusk', 'night'];

export function roadVisual(cls, style) {
  const base = ROAD_CLASSES[cls] || ROAD_CLASSES.unknown;
  let fill = base.fill;
  let casing = base.casing;
  if (style.nightFactor > 0.02) {
    const targetFill = style.nightFactor > 0.6 ? '#3a414a' : '#565d66';
    const targetCasing = style.nightFactor > 0.6 ? '#12161b' : '#22272f';
    fill = mixColor(fill, targetFill, style.nightFactor);
    casing = mixColor(casing, targetCasing, style.nightFactor);
  }
  const widthPerLane = base.laneWidth;
  return {
    fill,
    casing,
    shoulders: base.shoulders,
    divider: base.divider,
    widthPerLane,
    z: base.z,
    access: base.access,
    speed: base.speed,
  };
}

export function surfaceColor(kind, style) {
  const map = {
    grass: style.grass,
    meadow: mixColor(style.grass, '#d8e0c0', 0.4),
    water: style.water,
    asphalt: style.roadFill || '#6c6c72',
    parking: mixColor(style.roadCasing, '#ffffff', 0.25),
    sidewalk: mixColor(style.ground, '#ffffff', 0.35),
    plaza: mixColor(style.ground, '#ffffff', 0.45),
    crosswalk: style.junction,
    dirt: mixColor(style.ground, '#c0a878', 0.6),
    sand: mixColor(style.ground, '#e6d6a8', 0.7),
    gravel: mixColor(style.ground, '#b9b6ae', 0.6),
    sports: mixColor(style.grass, '#9ec27f', 0.5),
    rail: mixColor(style.ground, '#8a8177', 0.7),
  };
  return map[kind] || style.surfaceDefault;
}

export function buildingTone(color, style, index = 0) {
  let base = color;
  if (index % 2 === 1) base = shade(base, -0.05);
  if (style.nightFactor > 0.02) {
    const target = style.nightFactor > 0.6 ? '#2b313a' : '#4c453e';
    base = mixColor(base, target, style.nightFactor);
  }
  return base;
}

export function markerPalette(style) {
  return {
    default: style.laneLine,
    yellow: style.laneLineYellow,
    edge: style.laneEdge,
    conflict: '#ff5c5c',
    route: '#39a0ff',
    sensor: '#7cff9b',
  };
}

export function buildingFill(color, style) {
  return mixColor(color, style.nightFactor > 0.02 ? style.buildingFill : style.buildingFill, style.nightFactor * 0.85);
}

export function shadowColor(style, alpha = 1) {
  return rgba('#000000', clampAlpha(style.shadowStrength * alpha));
}

function clampAlpha(v) {
  return Math.max(0, Math.min(1, v));
}

export function propStyle(kind, style) {
  const treeKinds = { tree: 1, pine: 1, bush: 0.6, hedge: 0.7 };
  if (treeKinds[kind]) {
    const base = kind === 'pine' ? '#2f6340' : kind === 'bush' ? '#4a8a4f' : kind === 'hedge' ? '#3f7a46' : style.treeFill;
    return { fill: base, stroke: shade(base, -0.35), scale: treeKinds[kind] };
  }
  return { fill: null, stroke: style.propStroke, scale: 1 };
}

export const ROAD_LABEL_MIN_ZOOM = 1.6;
