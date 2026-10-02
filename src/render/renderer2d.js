import { boundingBox, boxIntersects, rectPoly } from '../core/geom.js';
import { clamp, rgba, shade } from '../core/util.js';
import { PROP_KINDS, SURFACE_KINDS } from '../model/schema.js';
import { markingGeometry, roadMarkingBands } from '../model/paint.js';
import { buildingTone, roadVisual, surfaceColor } from './theme.js';

const VEHICLE_BODIES = {
  car: { len: 4.5, wid: 1.85, roofFrom: 0.25, roofTo: 0.62, roofInset: 0.12 },
  van: { len: 5.6, wid: 2.0, roofFrom: 0.1, roofTo: 0.95, roofInset: 0.05 },
  truck: { len: 9.2, wid: 2.5, roofFrom: 0.05, roofTo: 0.4, roofInset: 0.06 },
  bus: { len: 11.4, wid: 2.55, roofFrom: 0.04, roofTo: 0.97, roofInset: 0.04 },
  block: { len: 2.0, wid: 2.0, roofFrom: 0.1, roofTo: 0.9, roofInset: 0.1 },
};

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.dpr = 1;
    this.labelRects = [];
  }

  resize(cssWidth, cssHeight, dpr = window.devicePixelRatio || 1) {
    this.cssWidth = Math.max(1, Math.round(cssWidth));
    this.cssHeight = Math.max(1, Math.round(cssHeight));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
  }

  draw(view) {
    const { camera, style } = view;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const grad = ctx.createLinearGradient(0, 0, 0, this.cssHeight);
    grad.addColorStop(0, style.backgroundFar);
    grad.addColorStop(1, style.background);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.labelRects = [];
    const viewBox = camera.visibleWorldBox(80);

    if (view.showGrid !== false) this.drawGrid(view, viewBox);
    if (view.showSurfaces !== false) this.drawSurfaces(view, viewBox);
    if (view.showRoads !== false) this.drawRoads(view, viewBox);
    if (view.showMarkings !== false) this.drawMarkings(view, viewBox);
    if (view.showBuildings !== false) this.drawBuildings(view, viewBox);
    if (view.showProps !== false) this.drawProps(view, viewBox);
    if (view.showLabels !== false) this.drawLabels(view, viewBox);
    if (view.showRoute) this.drawRoute(view);
    if (view.showSensors) this.drawSensors(view);
    this.drawVehicle(view);
    if (view.overlay) this.drawToolOverlay(view);
    if (view.selection && view.selection.size) this.drawSelection(view);
    this.drawHover(view);
  }

  drawGrid(view, viewBox) {
    const { camera, style } = view;
    const ctx = this.ctx;
    const targetPx = 90;
    const raw = targetPx / camera.zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const step = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
    if (step * camera.zoom < 8) return;
    const x0 = Math.floor(viewBox.minX / step) * step;
    const y0 = Math.floor(viewBox.minY / step) * step;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= viewBox.maxX; x += step) {
      if (Math.abs(x) < step * 0.001) continue;
      const sx = Math.round(camera.toScreen(x, 0).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.cssHeight);
    }
    for (let y = y0; y <= viewBox.maxY; y += step) {
      if (Math.abs(y) < step * 0.001) continue;
      const sy = Math.round(camera.toScreen(0, y).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.cssWidth, sy);
    }
    ctx.strokeStyle = style.gridMinor;
    ctx.stroke();
    if (step * camera.zoom > 26) {
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = style.gridLabel;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let x = x0; x <= viewBox.maxX; x += step) {
        if (Math.abs(x) < step * 0.001) continue;
        const p = camera.toScreen(x, 0);
        if (p.x < 12 || p.x > this.cssWidth - 12) continue;
        ctx.fillText(`${x.toFixed(step < 1 ? 1 : 0)}`, p.x + 3, 3);
      }
      for (let y = y0; y <= viewBox.maxY; y += step) {
        if (Math.abs(y) < step * 0.001) continue;
        const p = camera.toScreen(0, y);
        if (p.y < 12 || p.y > this.cssHeight - 12) continue;
        ctx.fillText(`${y.toFixed(step < 1 ? 1 : 0)}`, 3, p.y + 3);
      }
    }
  }

  drawSurfaces(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    ctx.lineJoin = 'round';
    for (const s of world.data.surfaces) {
      if (!this.layerVisible(view, s.layerId)) continue;
      const box = boundingBox(s.poly);
      if (!boxIntersects(box, viewBox)) continue;
      ctx.beginPath();
      this.tracePoly(ctx, s.poly, camera);
      ctx.fillStyle = surfaceColor(s.kind, style);
      ctx.fill();
      ctx.strokeStyle = rgba('#000000', 0.08);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (zoom > 2.2) this.drawSurfaceTexture(view, viewBox);
  }

  drawSurfaceTexture(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    for (const s of world.data.surfaces) {
      if (!this.layerVisible(view, s.layerId)) continue;
      const preset = SURFACE_KINDS[s.kind];
      if (!preset || (preset.texture !== 'paving' && preset.texture !== 'water')) continue;
      const box = boundingBox(s.poly);
      if (!boxIntersects(box, viewBox)) continue;
      ctx.save();
      ctx.beginPath();
      this.tracePoly(ctx, s.poly, camera);
      ctx.clip();
      if (preset.texture === 'paving') {
        const step = 1.2;
        ctx.strokeStyle = rgba('#000000', 0.07);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(box.minX / step) * step; x <= box.maxX; x += step) {
          const p = camera.toScreen(x, 0);
          ctx.moveTo(p.x, 0);
          ctx.lineTo(p.x, this.cssHeight);
        }
        for (let y = Math.floor(box.minY / step) * step; y <= box.maxY; y += step) {
          const p = camera.toScreen(0, y);
          ctx.moveTo(0, p.y);
          ctx.lineTo(this.cssWidth, p.y);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = rgba('#ffffff', 0.18);
        ctx.lineWidth = Math.max(1, 0.9);
        const step = 7 / zoom;
        ctx.beginPath();
        let k = 0;
        for (let y = Math.floor(box.minY / step) * step; y <= box.maxY; y += step) {
          const amp = Math.sin(k * 0.7) * 1.2;
          for (let x = box.minX; x <= box.maxX; x += step) {
            const p = camera.toScreen(x, y + amp * Math.sin(x * 0.2));
            if (x === box.minX) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          k++;
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (zoom < 2.2) return;
  }

  tracePoly(ctx, poly, camera) {
    ctx.moveTo(...this.pt(poly[0], camera));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(...this.pt(poly[i], camera));
    ctx.closePath();
  }

  pt(p, camera) {
    return [camera.toScreen(p.x, p.y).x, camera.toScreen(p.x, p.y).y];
  }

  drawRoads(view, viewBox) {
    const { world, network, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    const groups = new Map();
    for (const road of world.data.roads) {
      const pair = world.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const pad = world.roadWidth(road) / 2 + 6;
      if (!boxIntersects({ minX: Math.min(a.x, b.x) - pad, minY: Math.min(a.y, b.y) - pad, maxX: Math.max(a.x, b.x) + pad, maxY: Math.max(a.y, b.y) + pad }, viewBox)) continue;
      const vis = roadVisual(road.cls, style);
      const z = vis.z ?? 3;
      if (!groups.has(z)) groups.set(z, []);
      groups.get(z).push({ road, vis });
    }
    const zs = Array.from(groups.keys()).sort((x, y) => x - y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const z of zs) {
      const list = groups.get(z);
      this.strokeRoads(view, list, 'casing', style);
      this.strokeRoads(view, list, 'fill', style);
      this.drawJunctions(view, list);
    }
  }

  strokeRoads(view, list, pass, style) {
    const { world, camera } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    ctx.beginPath();
    for (const item of list) {
      const { road, vis } = item;
      const pair = world.roadNodes(road);
      if (!pair) continue;
      const a = camera.toScreen(pair[0].x, pair[0].y);
      const b = camera.toScreen(pair[1].x, pair[1].y);
      const wpx = world.roadWidth(road) * zoom;
      let lw;
      if (pass === 'casing') lw = Math.max(wpx + 2.2, 2.4);
      else lw = Math.max(wpx, 1.1);
      if (vis.access === 'foot' && pass === 'fill') lw = Math.max(wpx, 1.6);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = lw;
      ctx.strokeStyle = pass === 'casing' ? vis.casing : vis.fill;
      ctx.stroke();
    }
  }

  drawJunctions(view, list) {
    const { world, network, camera, style } = view;
    const ctx = this.ctx;
    for (const node of world.data.nodes) {
      const roads = world.roadsAtNode(node.id);
      if (roads.length < 2) continue;
      const poly = network.junctionPoly(node.id);
      if (!poly || poly.length < 3) continue;
      const width = Math.max(...roads.map((r) => world.roadWidth(r)));
      const info = roads.reduce((acc, r) => {
        const v = roadVisual(r.cls, style);
        return world.roadWidth(r) > acc.w ? { w: world.roadWidth(r), v } : acc;
      }, { w: 0, v: roadVisual(roads[0].cls, style) }).v;
      const p = camera.toScreen(node.x, node.y);
      if (p.x < -80 || p.y < -80 || p.x > this.cssWidth + 80 || p.y > this.cssHeight + 80) continue;
      ctx.beginPath();
      this.tracePoly(ctx, poly, camera);
      ctx.fillStyle = info.fill;
      ctx.fill();
    }
  }

  drawMarkings(view, viewBox) {
    const { world, network, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    if (zoom < 0.9) return;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const auto = [];
    for (const road of world.data.roads) {
      if (!this.layerVisible(view, this.markingLayerId(view))) continue;
      const pair = world.roadNodes(road);
      if (!pair) continue;
      const [a, b] = pair;
      const pad = world.roadWidth(road) / 2 + 4;
      if (!boxIntersects({ minX: Math.min(a.x, b.x) - pad, minY: Math.min(a.y, b.y) - pad, maxX: Math.max(a.x, b.x) + pad, maxY: Math.max(a.y, b.y) + pad }, viewBox)) continue;
      const bands = roadMarkingBands(world, network, road);
      for (const band of bands) auto.push({ band, road });
    }
    const minWidth = 0.9;
    for (const { band, road } of auto) {
      const wpx = band.halfWidth * 2 * zoom;
      if (wpx < minWidth * 0.6) continue;
      const color = band.color || (band.role === 'center' ? style.laneLineYellow : band.role === 'edge' ? style.laneEdge : style.laneLine);
      this.strokeBand(ctx, world, camera, road, band, Math.max(wpx, minWidth), color, band.dash ? band.dash.map((d) => d * zoom) : null);
    }
    for (const m of world.data.markings) {
      if (!this.layerVisible(view, m.layerId)) continue;
      const geo = markingGeometry(world, network, m);
      if (!geo) continue;
      const color = m.color || geo.color;
      for (const poly of geo.polys) {
        if (geo.role === 'text') continue;
        ctx.beginPath();
        this.tracePoly(ctx, poly, camera);
        ctx.fillStyle = color;
        ctx.fill();
      }
      if (geo.role === 'text' && zoom > 2) {
        const p = camera.toScreen(geo.polys[0][0].x, geo.polys[0][0].y);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(geo.angle);
        ctx.font = `700 ${Math.max(9, 1.6 * zoom)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.textHalo;
        ctx.strokeText(geo.text, 0, 0);
        ctx.fillStyle = color;
        ctx.fillText(geo.text, 0, 0);
        ctx.restore();
      }
    }
  }

  strokeBand(ctx, world, camera, road, band, widthPx, color, dash) {
    const p0 = bandPoint(world, road, band.sStart, band.offset);
    const p1 = bandPoint(world, road, band.sEnd, band.offset);
    const a = camera.toScreen(p0.x, p0.y);
    const b = camera.toScreen(p1.x, p1.y);
    ctx.save();
    if (dash && dash[0] > 0) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = widthPx;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  markingLayerId(view) {
    return view.markingLayerId || null;
  }

  drawBuildings(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    let i = 0;
    for (const b of world.data.buildings) {
      if (!this.layerVisible(view, b.layerId)) continue;
      const box = boundingBox(b.poly);
      if (!boxIntersects(box, viewBox)) continue;
      const tone = buildingTone(b.color || '#c9b39a', style, i);
      i++;
      const offset = clamp((b.height || 8) * 0.045, 0.4, 4) / 1;
      ctx.beginPath();
      this.tracePoly(ctx, b.poly, camera);
      ctx.save();
      ctx.translate(offset * zoom * 0.35, offset * zoom * 0.35);
      ctx.fillStyle = style.buildingShadow;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      this.tracePoly(ctx, b.poly, camera);
      ctx.fillStyle = tone;
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1.1);
      ctx.strokeStyle = style.buildingStroke;
      ctx.stroke();
      if (zoom > 6 && b.windows) {
        ctx.save();
        ctx.clip();
        const floorStep = 3.2;
        ctx.strokeStyle = rgba('#000000', 0.12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = box.minY; y <= box.maxY; y += floorStep) {
          const p = camera.toScreen(0, y);
          ctx.moveTo(0, p.y);
          ctx.lineTo(this.cssWidth, p.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawProps(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    const sorted = [];
    for (const p of world.data.props) {
      if (!this.layerVisible(view, p.layerId)) continue;
      const preset = PROP_KINDS[p.kind];
      if (!preset) continue;
      const r = Math.max(0.35, (preset.radius || 1) * (p.scale || 1));
      const box = { minX: p.x - r - 1, minY: p.y - r - 1, maxX: p.x + r + 1, maxY: p.y + r + 1 };
      if (!boxIntersects(box, viewBox)) continue;
      sorted.push({ p, preset, r });
    }
    sorted.sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
    for (const item of sorted) this.drawProp(view, item.p, item.preset, item.r);
  }

  drawProp(view, p, preset, r) {
    const { camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    const s = camera.toScreen(p.x, p.y);
    const color = p.color || preset.color;
    const scale = p.scale || 1;
    switch (preset.kind) {
      case 'tree':
      case 'pine':
      case 'bush':
      case 'hedge': {
        const rad = Math.max(1.2, r * zoom);
        const g = ctx.createRadialGradient(s.x - rad * 0.3, s.y - rad * 0.35, rad * 0.15, s.x, s.y, rad);
        g.addColorStop(0, shade(color, 0.22));
        g.addColorStop(1, shade(color, -0.12));
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        if (rad > 4) {
          ctx.lineWidth = Math.max(1, rad * 0.08);
          ctx.strokeStyle = shade(color, -0.4);
          ctx.stroke();
        }
        break;
      }
      case 'lamp': {
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1.4, 0.32 * zoom), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (zoom > 2) {
          ctx.strokeStyle = rgba(color, 0.7);
          ctx.lineWidth = Math.max(1, 1.6 * zoom * 0.5);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + Math.cos(p.rotation - Math.PI / 2) * 0.28 * zoom, s.y + Math.sin(p.rotation - Math.PI / 2) * 0.28 * zoom);
          ctx.stroke();
        }
        break;
      }
      case 'traffic_light': {
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1.8, 0.4 * zoom), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (p.signalState) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, Math.max(2.4, 0.62 * zoom), 0, Math.PI * 2);
          ctx.fillStyle = p.signalState === 'green' ? 'rgba(80,220,120,0.85)' : p.signalState === 'yellow' ? 'rgba(250,200,70,0.85)' : 'rgba(240,80,80,0.85)';
          ctx.fill();
        }
        break;
      }
      case 'sign': {
        const sz = Math.max(2.2, 0.6 * zoom);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - sz);
        ctx.lineTo(s.x + sz * 0.9, s.y + sz * 0.7);
        ctx.lineTo(s.x - sz * 0.9, s.y + sz * 0.7);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = shade(color, -0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      case 'car':
      case 'van':
      case 'truck':
      case 'bus': {
        const body = VEHICLE_BODIES[preset.kind];
        const poly = rectPoly(p.x, p.y, body.len * scale, body.wid * scale, p.rotation);
        ctx.beginPath();
        this.tracePoly(ctx, poly, camera);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.1);
        ctx.strokeStyle = shade(color, -0.45);
        ctx.stroke();
        if (zoom > 2.4) {
          const cabinOff = body.len * 0.06;
          const rp = rectPoly(
            p.x + Math.cos(p.rotation) * cabinOff,
            p.y + Math.sin(p.rotation) * cabinOff,
            body.len * 0.5,
            body.wid * 0.78,
            p.rotation
          );
          ctx.beginPath();
          this.tracePoly(ctx, rp, camera);
          ctx.fillStyle = rgba('#1b2430', 0.55);
          ctx.fill();
        }
        break;
      }
      case 'barrier':
      case 'fence': {
        const len = (preset.length || 3) * scale;
        const dx = Math.cos(p.rotation) * len * 0.5;
        const dy = Math.sin(p.rotation) * len * 0.5;
        ctx.beginPath();
        ctx.moveTo(s.x - dx, s.y - dy);
        ctx.lineTo(s.x + dx, s.y + dy);
        ctx.lineWidth = Math.max(1.5, 0.22 * zoom);
        ctx.strokeStyle = color;
        ctx.stroke();
        break;
      }
      case 'bench': {
        const poly = rectPoly(p.x, p.y, (preset.length || 1.8) * scale, 0.6 * scale, p.rotation);
        ctx.beginPath();
        this.tracePoly(ctx, poly, camera);
        ctx.fillStyle = color;
        ctx.fill();
        break;
      }
      case 'person': {
        const rad = Math.max(1.4, 0.3 * zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        break;
      }
      case 'power_pole': {
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1.2, 0.25 * zoom), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (zoom > 3) {
          ctx.strokeStyle = rgba(color, 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s.x - 0.7 * zoom, s.y - 0.3 * zoom);
          ctx.lineTo(s.x + 0.7 * zoom, s.y - 0.3 * zoom);
          ctx.stroke();
        }
        break;
      }
      default: {
        const rad = Math.max(1.2, r * zoom);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = shade(color, -0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  drawLabels(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    if (zoom > 0.55) this.drawRoadNameLabels(view, viewBox);
    if (zoom > 4.5) this.drawBuildingLabels(view, viewBox);
  }

  drawRoadNameLabels(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    const zoom = camera.zoom;
    const fontSize = clamp(10 + zoom * 0.35, 10, 15);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const road of world.data.roads) {
      if (!road.name) continue;
      const pair = world.roadNodes(road);
      if (!pair) continue;
      const dir = world.roadDirection(road, true);
      const mid = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      if (mid.x < viewBox.minX || mid.x > viewBox.maxX || mid.y < viewBox.minY || mid.y > viewBox.maxY) continue;
      const s = camera.toScreen(mid.x, mid.y);
      const textW = ctx.measureText(road.name).width;
      const angle = Math.atan2(dir.y, dir.x);
      const flip = angle > Math.PI / 2 || angle < -Math.PI / 2;
      const w = textW + 10;
      const h = fontSize + 6;
      const rect = { minX: s.x - w / 2, minY: s.y - h / 2, maxX: s.x + w / 2, maxY: s.y + h / 2 };
      if (this.labelOverlaps(rect)) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(flip ? angle + Math.PI : angle);
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = style.textHalo;
      ctx.strokeText(road.name, 0, 0);
      ctx.fillStyle = style.text;
      ctx.fillText(road.name, 0, 0);
      ctx.restore();
      this.labelRects.push(rect);
    }
  }

  drawBuildingLabels(view, viewBox) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    for (const b of world.data.buildings) {
      if (!b.name) continue;
      const box = boundingBox(b.poly);
      if (!boxIntersects(box, viewBox)) continue;
      let cx = 0;
      let cy = 0;
      for (const p of b.poly) {
        cx += p.x;
        cy += p.y;
      }
      cx /= b.poly.length;
      cy /= b.poly.length;
      const s = camera.toScreen(cx, cy);
      ctx.font = '600 11px system-ui, sans-serif';
      const tw = ctx.measureText(b.name).width;
      const rect = { minX: s.x - tw / 2 - 4, minY: s.y - 9, maxX: s.x + tw / 2 + 4, maxY: s.y + 9 };
      if (this.labelOverlaps(rect)) continue;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = style.textHalo;
      ctx.strokeText(b.name, s.x, s.y);
      ctx.fillStyle = style.buildingLabel;
      ctx.fillText(b.name, s.x, s.y);
      this.labelRects.push(rect);
    }
  }

  labelOverlaps(rect) {
    for (const r of this.labelRects) {
      if (rect.minX < r.maxX && rect.maxX > r.minX && rect.minY < r.maxY && rect.maxY > r.minY) return true;
    }
    return false;
  }

  drawRoute(view) {
    const { camera, style } = view;
    const ctx = this.ctx;
    const path = view.route;
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const p = camera.toScreen(path[i].x, path[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(57,160,255,0.28)';
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = '#39a0ff';
    ctx.lineWidth = 4.5;
    ctx.setLineDash([14, 8]);
    ctx.stroke();
    ctx.restore();
    if (view.routeGoal) {
      const p = camera.toScreen(view.routeGoal.x, view.routeGoal.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#39a0ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#39a0ff';
      ctx.fill();
    }
  }

  drawSensors(view) {
    const { camera } = view;
    const ctx = this.ctx;
    const s = view.sensors;
    if (!s) return;
    for (const hit of s.points || []) {
      const p = camera.toScreen(hit.x, hit.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, hit.rayHit ? 2.4 : 1.6, 0, Math.PI * 2);
      ctx.fillStyle = hit.rayHit ? 'rgba(255,120,90,0.9)' : 'rgba(124,255,155,0.75)';
      ctx.fill();
    }
  }

  drawVehicle(view) {
    const { camera, style } = view;
    const v = view.vehicle;
    if (!v) return;
    const ctx = this.ctx;
    const len = 4.5;
    const wid = 1.85;
    const poly = rectPoly(v.x, v.y, len, wid, v.yaw);
    ctx.save();
    ctx.translate(Math.cos(v.yaw + Math.PI / 2) * 0.5, Math.sin(v.yaw + Math.PI / 2) * 0.5);
    ctx.beginPath();
    this.tracePoly(ctx, poly, camera);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    this.tracePoly(ctx, poly, camera);
    ctx.fillStyle = v.color || '#e8563f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10161d';
    ctx.stroke();
    const nose = camera.toScreen(v.x + Math.cos(v.yaw) * 1.1, v.y + Math.sin(v.yaw) * 1.1);
    const tail = camera.toScreen(v.x - Math.cos(v.yaw) * 1.1, v.y - Math.sin(v.yaw) * 1.1);
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(nose.x, nose.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawToolOverlay(view) {
    const { camera, style } = view;
    const ctx = this.ctx;
    const ov = view.overlay;
    if (!ov) return;
    if (ov.guides) {
      ctx.save();
      ctx.strokeStyle = style.guide;
      ctx.fillStyle = style.guide;
      ctx.lineWidth = 1.5;
      for (const g of ov.guides) {
        if (g.type === 'line' || g.type === 'ray') {
          const a = camera.toScreen(g.from.x, g.from.y);
          const b = camera.toScreen(g.to.x, g.to.y);
          ctx.setLineDash(g.type === 'ray' ? [6, 5] : []);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        } else if (g.type === 'cross') {
          const p = camera.toScreen(g.x, g.y);
          const s = g.size || 8;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y);
          ctx.lineTo(p.x + s, p.y);
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x, p.y + s);
          ctx.stroke();
        } else if (g.type === 'square') {
          const p = camera.toScreen(g.x, g.y);
          const s = g.size || 6;
          ctx.setLineDash([]);
          ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
        }
      }
      ctx.restore();
    }
    if (ov.polyline && ov.polyline.length) {
      ctx.save();
      ctx.setLineDash(ov.dash || [7, 5]);
      ctx.strokeStyle = style.ghost;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < ov.polyline.length; i++) {
        const p = camera.toScreen(ov.polyline[i].x, ov.polyline[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (ov.polygons) {
      ctx.save();
      for (const poly of ov.polygons) {
        if (!poly || poly.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < poly.length; i++) {
          const p = camera.toScreen(poly[i].x, poly[i].y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        if (poly.length > 2) {
          ctx.closePath();
          ctx.fillStyle = ov.fill || 'rgba(57,160,255,0.16)';
          ctx.fill();
        }
        ctx.strokeStyle = ov.stroke || style.ghost;
        ctx.lineWidth = 2;
        ctx.setLineDash(ov.dash || []);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (ov.points) {
      ctx.save();
      for (const pt of ov.points) {
        const p = camera.toScreen(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, pt.r || 4, 0, Math.PI * 2);
        ctx.fillStyle = pt.fill || style.ghost;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (ov.labels) {
      ctx.save();
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const l of ov.labels) {
        const p = camera.toScreen(l.x, l.y);
        const w = ctx.measureText(l.text).width + 12;
        const h = 20;
        const x = p.x + (l.dx || 12);
        const y = p.y + (l.dy || 0) - h / 2;
        roundRect(ctx, x, y, w, h, 5);
        ctx.fillStyle = 'rgba(16,22,28,0.86)';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(l.text, x + 6, y + h / 2 + 0.5);
      }
      ctx.restore();
    }
    if (ov.cursor) {
      const p = camera.toScreen(ov.cursor.x, ov.cursor.y);
      ctx.save();
      ctx.strokeStyle = style.ghost;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.moveTo(p.x - 11, p.y);
      ctx.lineTo(p.x - 3, p.y);
      ctx.moveTo(p.x + 3, p.y);
      ctx.lineTo(p.x + 11, p.y);
      ctx.moveTo(p.x, p.y - 11);
      ctx.lineTo(p.x, p.y - 3);
      ctx.moveTo(p.x, p.y + 3);
      ctx.lineTo(p.x, p.y + 11);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSelection(view) {
    const { world, camera, style } = view;
    const ctx = this.ctx;
    ctx.save();
    for (const id of view.selection) {
      const found = world.findEntity(id);
      if (!found) continue;
      const box = world.entityBox(found.type, found.object);
      if (!box) continue;
      const a = camera.toScreen(box.minX, box.minY);
      const b = camera.toScreen(box.maxX, box.maxY);
      ctx.strokeStyle = style.selection;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      const hs = 4;
      for (const [hx, hy] of [
        [a.x, a.y],
        [b.x, a.y],
        [a.x, b.y],
        [b.x, b.y],
      ]) {
        ctx.beginPath();
        ctx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
        ctx.fillStyle = style.handle;
        ctx.fill();
        ctx.strokeStyle = style.handleStroke;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      if (found.type === 'buildings' || found.type === 'surfaces') {
        ctx.beginPath();
        for (const p of found.object.poly) {
          const s = camera.toScreen(p.x, p.y);
          if (p === found.object.poly[0]) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.strokeStyle = style.selection;
        ctx.lineWidth = 2;
        ctx.stroke();
        for (const p of found.object.poly) {
          const s = camera.toScreen(p.x, p.y);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = style.handle;
          ctx.fill();
          ctx.strokeStyle = style.handleStroke;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawHover(view) {
    if (!view.hoverId || view.selection?.has(view.hoverId)) return;
    const { world, camera, style } = view;
    const found = world.findEntity(view.hoverId);
    if (!found) return;
    const box = world.entityBox(found.type, found.object);
    if (!box) return;
    const a = camera.toScreen(box.minX, box.minY);
    const b = camera.toScreen(box.maxX, box.maxY);
    this.ctx.save();
    this.ctx.strokeStyle = style.hover;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    this.ctx.restore();
  }

  layerVisible(view, layerId) {
    if (!layerId) return true;
    const layer = view.world.layerById(layerId);
    return layer ? layer.visible : true;
  }
}

function bandPoint(world, road, s, offset) {
  const dir = world.roadDirection(road, true);
  const nx = -dir.y;
  const ny = dir.x;
  const t = clamp(s, 0, dir.length);
  return { x: dir.start.x + dir.x * t + nx * offset, y: dir.start.y + dir.y * t + ny * offset };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
