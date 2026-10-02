import { shade, hashString } from '../core/util.js';

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function getSprite(kind, variant, color) {
  const key = `${kind}:${variant}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = build(kind, variant, color);
  cache.set(key, canvas);
  return canvas;
}

function build(kind, variant, color) {
  if (kind === 'tree') return buildTree(variant, color);
  if (kind === 'pine') return buildPine(variant, color);
  if (kind === 'bush') return buildBush(variant, color);
  if (kind === 'hedge') return buildHedge(variant, color);
  if (kind === 'person') return buildPerson(variant, color);
  return null;
}

function rngFor(variant) {
  let a = (variant * 2654435761) >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function buildTree(variant, color) {
  const W = 160;
  const H = 200;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = rngFor(variant + 1);
  const trunkW = 9;
  const trunkH = H * 0.42;
  const trunkX = W / 2 - trunkW / 2;
  const g = ctx.createLinearGradient(trunkX, 0, trunkX + trunkW, 0);
  g.addColorStop(0, '#5d4530');
  g.addColorStop(0.5, '#7a5c3f');
  g.addColorStop(1, '#4a3625');
  ctx.fillStyle = g;
  ctx.fillRect(trunkX, H - trunkH, trunkW, trunkH);
  ctx.beginPath();
  ctx.moveTo(trunkX + trunkW, H - trunkH + 6);
  ctx.lineTo(trunkX + trunkW + 14, H - trunkH - 12);
  ctx.lineTo(trunkX + trunkW, H - trunkH - 14);
  ctx.closePath();
  ctx.fillStyle = '#6b5138';
  ctx.fill();

  const cx = W / 2;
  const cy = H * 0.32;
  const rx = W * (0.32 + rnd() * 0.06);
  const ry = H * (0.3 + rnd() * 0.05);
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd();
    const bx = cx + Math.cos(a) * rx * 0.42;
    const by = cy + Math.sin(a) * ry * 0.4;
    const br = rx * (0.5 + rnd() * 0.22);
    const grad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.35, br * 0.1, bx, by, br);
    grad.addColorStop(0, shade(color, 0.3));
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, shade(color, -0.28));
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  const top = ctx.createRadialGradient(cx - rx * 0.25, cy - ry * 0.35, rx * 0.05, cx, cy, rx * 1.05);
  top.addColorStop(0, shade(color, 0.38));
  top.addColorStop(0.55, shade(color, 0.08));
  top.addColorStop(1, shade(color, -0.22));
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = top;
  ctx.fill();
  return c;
}

function buildPine(variant, color) {
  const W = 140;
  const H = 220;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = rngFor(variant + 7);
  ctx.fillStyle = '#5b4330';
  ctx.fillRect(W / 2 - 6, H * 0.8, 12, H * 0.2);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = H * (0.78 - t * 0.66);
    const halfW = W * (0.42 - t * 0.33) * (0.92 + rnd() * 0.12);
    const h = H * 0.2;
    const grad = ctx.createLinearGradient(W / 2 - halfW, y, W / 2 + halfW, y);
    grad.addColorStop(0, shade(color, -0.2));
    grad.addColorStop(0.45, shade(color, 0.14));
    grad.addColorStop(1, shade(color, -0.3));
    ctx.beginPath();
    ctx.moveTo(W / 2, y - h);
    ctx.lineTo(W / 2 + halfW, y);
    ctx.lineTo(W / 2 - halfW, y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  return c;
}

function buildBush(variant, color) {
  const W = 96;
  const H = 72;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = rngFor(variant + 3);
  for (let i = 0; i < 4; i++) {
    const bx = W * (0.25 + rnd() * 0.5);
    const by = H * (0.45 + rnd() * 0.35);
    const br = W * (0.2 + rnd() * 0.14);
    const grad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, br * 0.1, bx, by, br);
    grad.addColorStop(0, shade(color, 0.28));
    grad.addColorStop(1, shade(color, -0.24));
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  return c;
}

function buildHedge(variant, color) {
  const W = 128;
  const H = 64;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, shade(color, -0.3));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, 0.2));
  ctx.fillStyle = grad;
  roundRectPath(ctx, 4, H * 0.18, W - 8, H * 0.78, 10);
  ctx.fill();
  return c;
}

function buildPerson(variant, color) {
  const W = 64;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const skin = ['#c89a76', '#8d5f42', '#e0b894', '#6f4630'][variant % 4];
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(W * 0.34, H * 0.62, W * 0.13, H * 0.38);
  ctx.fillRect(W * 0.53, H * 0.62, W * 0.13, H * 0.38);
  const body = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.66);
  body.addColorStop(0, shade(color, 0.16));
  body.addColorStop(1, shade(color, -0.2));
  ctx.fillStyle = body;
  roundRectPath(ctx, W * 0.24, H * 0.3, W * 0.52, H * 0.36, 8);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.fillRect(W * 0.15, H * 0.34, W * 0.11, H * 0.28);
  ctx.fillRect(W * 0.74, H * 0.34, W * 0.11, H * 0.28);
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.21, W * 0.19, 0, Math.PI * 2);
  const head = ctx.createRadialGradient(W * 0.44, H * 0.17, W * 0.02, W / 2, H * 0.21, W * 0.2);
  head.addColorStop(0, shade(skin, 0.18));
  head.addColorStop(1, shade(skin, -0.2));
  ctx.fillStyle = head;
  ctx.fill();
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function spriteVariant(id) {
  return Math.floor(hashString(String(id)) * 4);
}

export function clearSpriteCache() {
  cache.clear();
}
