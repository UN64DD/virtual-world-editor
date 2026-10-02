import { createEmptyWorld } from './world.js';
import { makeBuilding, makeNode, makeProp, makeRoad, makeSurface } from './schema.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const BUILDING_COLORS = ['#c9b39a', '#bfae9c', '#c6b7a6', '#b3a898', '#cdbfa8', '#a89a8c'];
const HOUSE_COLORS = ['#d6c3a5', '#c9b79c', '#bfae94', '#cdbda6', '#c2b49b'];

export function createDemoWorld(seed = 20240517) {
  const world = createEmptyWorld('Demo town');
  const rnd = rng(seed);
  world.setOrigin(51.5074, -0.1278, 0);
  world.meta.notes = 'Generated sample town. Draw roads, drop buildings and trees, then save.';

  const cols = 4;
  const rows = 3;
  const blockW = 150;
  const blockH = 130;
  const roadHalf = 11;

  world.addSurface(makeSurface(rect(-60, -60, cols * blockW + 60, rows * blockH + 60), 'grass', { name: 'Ground' }));
  world.addSurface(makeSurface(rect(-70, blockH * 0.5 - 34, cols * blockW + 70, 26), 'water', { name: 'Canal' }));

  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const line = [];
    for (let c = 0; c <= cols; c++) {
      line.push(world.addNode(makeNode(c * blockW, r * blockH, { signals: c > 0 && c < cols && r > 0 && r < rows })).id);
    }
    grid.push(line);
  }

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const arterial = r === 1;
      world.addRoad(
        makeRoad(grid[r][c], grid[r][c + 1], {
          cls: arterial ? 'primary' : 'residential',
          name: arterial ? 'High Street' : `${ordinal(c + 1)} Street`,
        })
      );
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const arterial = c === 2;
      world.addRoad(
        makeRoad(grid[r][c], grid[r + 1][c], {
          cls: arterial ? 'secondary' : 'residential',
          name: arterial ? 'Park Avenue' : `${ordinal(r + 1)} Avenue`,
        })
      );
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      fillBlock(world, rnd, c, r, blockW, blockH, roadHalf, r === 1 || c === 2);
    }
  }

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = c * blockW;
      const y = r * blockH;
      if (r < rows) {
        world.addProp(makeProp('lamp', x - roadHalf - 2, y + 16, { rotation: -Math.PI / 2 }));
        world.addProp(makeProp('lamp', x + roadHalf + 2, y + 22, { rotation: Math.PI / 2 }));
      }
      if (c < cols) {
        world.addProp(makeProp('lamp', x + 18, y - roadHalf - 2, { rotation: Math.PI }));
        world.addProp(makeProp('lamp', x + 24, y + roadHalf + 2, { rotation: 0 }));
      }
      if (c < cols && r < rows && rnd() > 0.45) {
        world.addProp(makeProp('traffic_light', x + roadHalf + 3, y + 4, { rotation: Math.PI }));
      }
      if (r < rows) {
        world.addProp(makeProp('sign', x - roadHalf - 2.5, y + 34, { rotation: Math.PI / 2, height: 2.4 }));
      }
    }
  }

  for (let i = 0; i < 90; i++) {
    const x = -50 + rnd() * (cols * blockW + 60);
    const y = -50 + rnd() * (rows * blockH + 60);
    if (nearRoad(x, y, blockW, blockH, rows, cols, roadHalf)) continue;
    world.addProp(makeProp(rnd() > 0.72 ? 'pine' : 'tree', x, y, { scale: 0.8 + rnd() * 0.6 }));
  }

  world.touch(true);
  return world;
}

function fillBlock(world, rnd, c, r, blockW, blockH, roadHalf, arterial) {
  const x0 = c * blockW + roadHalf + 3;
  const y0 = r * blockH + roadHalf + 3;
  const w = blockW - (roadHalf + 3) * 2;
  const h = blockH - (roadHalf + 3) * 2;
  if (w <= 20 || h <= 20) return;

  if (rnd() > 0.72) {
    world.addSurface(makeSurface(rect(x0 + 6, y0 + 6, x0 + w - 6, y0 + h - 6), 'park', { name: 'Green' }));
    const trees = 4 + Math.floor(rnd() * 6);
    for (let i = 0; i < trees; i++) {
      world.addProp(
        makeProp(rnd() > 0.6 ? 'pine' : 'tree', x0 + 12 + rnd() * (w - 24), y0 + 12 + rnd() * (h - 24), {
          scale: 0.9 + rnd() * 0.7,
        })
      );
    }
    for (let i = 0; i < 2; i++) {
      world.addProp(makeProp('bench', x0 + 16 + i * 22, y0 + h * 0.5, { rotation: 0 }));
    }
    return;
  }

  const yards = arterial ? 0.55 : 0.25;
  if (rnd() < yards) {
    const bw = 18 + rnd() * 12;
    const bh = 16 + rnd() * 10;
    const bx = x0 + 8 + rnd() * (w - bw - 16);
    const by = y0 + 8 + rnd() * (h - bh - 16);
    const floors = 1 + Math.floor(rnd() * 2);
    world.addBuilding(makeBuilding(rect(bx, by, bx + bw, by + bh), {
      kind: 'house',
      floors,
      roof: rnd() > 0.5 ? 'gabled' : 'hipped',
      color: HOUSE_COLORS[Math.floor(rnd() * HOUSE_COLORS.length)],
    }));
    world.addSurface(makeSurface(rect(bx + 1.5, by + bh + 1.5, bx + bw - 1.5, by + bh + 9), 'sidewalk', { name: 'Driveway' }));
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
      world.addProp(makeProp(rnd() > 0.5 ? 'tree' : 'bush', bx - 4 + rnd() * (bw + 8), by + bh + 6 + rnd() * 6));
    }
    return;
  }

  const count = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const bw = 16 + rnd() * 16;
    const bh = 14 + rnd() * 14;
    const slots = Math.max(1, Math.floor((w - 12) / (bw + 7)));
    const bx = x0 + 6 + (i % slots) * (bw + 7) + rnd() * 3;
    const by = y0 + 6 + Math.floor(i / slots) * (bh + 9) + rnd() * 3;
    if (bx + bw > x0 + w - 4 || by + bh > y0 + h - 4) continue;
    const floors = 2 + Math.floor(rnd() * (arterial ? 5 : 3));
    world.addBuilding(makeBuilding(rect(bx, by, bx + bw, by + bh), {
      kind: floors > 6 ? 'tower' : arterial ? 'office' : 'apartments',
      floors,
      roof: rnd() > 0.55 ? 'flat' : rnd() > 0.5 ? 'hipped' : 'gabled',
      color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)],
      name: `${ordinal(i + 1)} ${['Chapel', 'Exchange', 'Mews', 'Yard', 'Works', 'Hall', 'Court'][i % 7]}`,
    }));
  }
}

function nearRoad(x, y, blockW, blockH, rows, cols, roadHalf) {
  for (let c = 0; c <= cols; c++) if (Math.abs(x - c * blockW) < roadHalf + 3) return true;
  for (let r = 0; r <= rows; r++) if (Math.abs(y - r * blockH) < roadHalf + 3) return true;
  return false;
}

function rect(x0, y0, x1, y1) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const ORDINALS = ['Zero', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
function ordinal(n) {
  return ORDINALS[n] || `${n}th`;
}
