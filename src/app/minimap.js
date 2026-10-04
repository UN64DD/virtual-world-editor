export class Minimap {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.size = 168;
    this.padding = 10;
    this.world = null;
    this.getViewBox = opts.getViewBox || (() => null);
    this.getAgents = opts.getAgents || (() => null);
    this.onJump = opts.onJump || (() => {});
    this._box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    this._bound = false;
  }

  setWorld(world) {
    this.world = world;
    this._bound = false;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(rect.width || this.size));
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width === Math.round(size * dpr) && this.dpr === dpr && this._cssSize === size) return;
    this._cssSize = size;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
  }

  scaleFor(box) {
    const inner = this.size - this.padding * 2;
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    return Math.min(inner / w, inner / h);
  }

  project(x, y) {
    const b = this._box;
    const s = this.scaleFor(b);
    return {
      x: this.padding + (x - b.minX) * s + (this.size - this.padding * 2 - (b.maxX - b.minX) * s) / 2,
      y: this.padding + (y - b.minY) * s + (this.size - this.padding * 2 - (b.maxY - b.minY) * s) / 2,
    };
  }

  unproject(sx, sy) {
    const b = this._box;
    const s = this.scaleFor(b);
    const offX = (this.size - this.padding * 2 - (b.maxX - b.minX) * s) / 2;
    const offY = (this.size - this.padding * 2 - (b.maxY - b.minY) * s) / 2;
    return {
      x: (sx - this.padding - offX) / s + b.minX,
      y: (sy - this.padding - offY) / s + b.minY,
    };
  }

  draw() {
    if (!this.world) return;
    const world = this.world;
    this.resize();
    const ctx = this.ctx;
    const size = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const extent = this.world.bbox();
    const view = this.getViewBox();
    const box = view
      ? {
          minX: Math.min(extent.minX, view.minX),
          minY: Math.min(extent.minY, view.minY),
          maxX: Math.max(extent.maxX, view.maxX),
          maxY: Math.max(extent.maxY, view.maxY),
        }
      : extent;
    this._box = box;
    const s = this.scaleFor(box);

    ctx.fillStyle = '#1b3a2b';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#20402f';
    for (const surf of world.data.surfaces) {
      if (surf.kind === 'water') {
        ctx.fillStyle = '#1d3a52';
        this.poly(surf.poly);
        ctx.fill();
      }
    }

    ctx.lineCap = 'round';
    for (const road of world.data.roads) {
      const a = world.byId('nodes', road.a);
      const b = world.byId('nodes', road.b);
      if (!a || !b) continue;
      const p0 = this.project(a.x, a.y);
      const p1 = this.project(b.x, b.y);
      const wide = road.cls === 'primary' || road.cls === 'secondary' || road.cls === 'tertiary';
      ctx.strokeStyle = wide ? '#5a6068' : '#4a5058';
      ctx.lineWidth = Math.max(0.8, (wide ? 11 : 7) * (s / 12) * 1.4);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    ctx.fillStyle = '#8e9aa8';
    for (const b of world.data.buildings) {
      const c = centroidOf(b.poly);
      const p = this.project(c.x, c.y);
      const r = Math.max(0.6, footprintRadius(b.poly) * s);
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }

    ctx.fillStyle = '#4f9c63';
    for (const p of world.data.props) {
      if (p.kind !== 'tree' && p.kind !== 'pine') continue;
      const p2 = this.project(p.x, p.y);
      ctx.fillRect(p2.x - 0.7, p2.y - 0.7, 1.4, 1.4);
    }

    // Driven vehicles, so the whole map shows where the traffic has got to.
    const agents = this.getAgents();
    if (agents && agents.length) {
      for (const a of agents) {
        const p = this.project(a.x, a.y);
        ctx.fillStyle = a.speed < 0.2 ? '#ffd166' : a.color || '#e8563f';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (view) {
      const a = this.project(view.minX, view.minY);
      const b = this.project(view.maxX, view.maxY);
      ctx.strokeStyle = '#4c9aff';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(
        Math.round(a.x) + 0.5,
        Math.round(a.y) + 0.5,
        Math.max(2, Math.round(b.x - a.x)),
        Math.max(2, Math.round(b.y - a.y))
      );
      ctx.strokeStyle = '#4c9aff33';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        Math.round(a.x) + 0.5,
        Math.round(a.y) + 0.5,
        Math.max(2, Math.round(b.x - a.x)),
        Math.max(2, Math.round(b.y - a.y))
      );
    }
  }

  poly(points) {
    const ctx = this.ctx;
    if (!points.length) return;
    const p0 = this.project(points[0].x, points[0].y);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = this.project(points[i].x, points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  attach() {
    if (this._bound || !this.world) return;
    this._bound = true;
    const jump = (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      const p = this.unproject(ev.clientX - rect.left, ev.clientY - rect.top);
      this.onJump(p.x, p.y);
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      this._drag = true;
      this.canvas.setPointerCapture(ev.pointerId);
      jump(ev);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (this._drag) jump(ev);
    });
    this.canvas.addEventListener('pointerup', (ev) => {
      this._drag = false;
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
    });
  }
}

function centroidOf(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) };
}

function footprintRadius(poly) {
  const c = centroidOf(poly);
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
  return r;
}
