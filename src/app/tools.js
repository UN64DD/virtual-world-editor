import { snapToleranceFor } from '../snap.js';
import {
  MARKING_KINDS,
  MARKING_ROLES,
  MARKING_SIDES,
  PROP_KIND_ORDER,
  ROAD_CLASS_ORDER,
  ROAD_CLASSES,
  SURFACE_KIND_ORDER,
  makeBuilding,
  makeMarking,
  makeNode,
  makeProp,
  makeRoad,
  makeSurface,
  roadClassInfo,
} from '../model/schema.js';
import { dist } from '../core/util.js';

export const TOOL = {
  select: 'select',
  road: 'road',
  junction: 'junction',
  building: 'building',
  surface: 'surface',
  prop: 'prop',
  marking: 'marking',
  measure: 'measure',
};

export const TOOL_ORDER = Object.values(TOOL);

export function defaultToolOptions(tool) {
  switch (tool) {
    case TOOL.road:
      return { cls: 'residential', snapAngle: true, autoJunction: true, curve: false };
    case TOOL.building:
      return { kind: 'house', floors: 1, roof: 'gabled' };
    case TOOL.surface:
      return { kind: 'grass' };
    case TOOL.prop:
      return { kind: 'tree' };
    case TOOL.marking:
      return { kind: 'solid', role: 'divider', side: 'left', span: 40 };
    default:
      return {};
  }
}

const HINTS = {
  select: 'Drag to marquee-select. <span class="kbd">Shift</span> adds, <span class="kbd">Alt</span> duplicates.',
  road: 'Click to place points, chain roads, <span class="kbd">Enter</span> or double-click to finish, <span class="kbd">Esc</span> to cancel.',
  junction: 'Click to drop a junction node. <span class="kbd">Esc</span> to cancel.',
  building: 'Click two corners to place a rectangular building. Hold <span class="kbd">Shift</span> for a square.',
  surface: 'Click corners to outline a ground patch, double-click to close.',
  prop: 'Click to place an object. <span class="kbd">R</span> while held rotates.',
  marking: 'Click a lane to add a marking to it.',
  measure: 'Click two points to measure. <span class="kbd">Esc</span> to clear.',
};

export class ToolController {
  constructor(app) {
    this.app = app;
    this.tool = TOOL.select;
    this.options = defaultToolOptions(this.tool);
    this.draft = null;
    this.hoverId = null;
    this.measure = null;
    this.rotating = false;
  }

  setTool(tool) {
    if (!TOOL_ORDER.includes(tool)) return;
    this.cancel();
    this.tool = tool;
    this.options = defaultToolOptions(tool);
    this.app.refreshToolOptions();
    this.app.refreshHint();
    this.app.requestDraw();
  }

  hint() {
    return HINTS[this.tool] || '';
  }

  cancel() {
    if (this.draft?.tx) this.draft.tx.abort();
    this.draft = null;
    this.measure = null;
    this.app.requestDraw();
  }

  snapOpts() {
    const app = this.app;
    return {
      zoom: app.camera.zoom,
      tolerance: snapToleranceFor(app.camera.zoom),
      grid: app.world.meta.settings?.snapGrid ?? 0,
      snapRoad: this.tool !== TOOL.select || true,
      snapAngle: this.tool === TOOL.road ? (this.options.snapAngle ? app.world.meta.settings?.snapAngle ?? 15 : 0) : 0,
    };
  }

  point(ev) {
    const app = this.app;
    const rect = app.canvas.getBoundingClientRect();
    const raw = app.mode === '3d' ? app.groundPoint(ev.clientX - rect.left, ev.clientY - rect.top) : app.camera.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!raw) return null;
    return app.snap.worldPoint(raw.x, raw.y, this.snapOpts());
  }

  onHover(ev) {
    const p = this.point(ev);
    if (!p) return;
    this.cursor = p;
    if (this.tool === TOOL.select) {
      const id = this.app.pickAt(ev);
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.app.requestDraw();
      }
    } else {
      this.app.requestDraw();
    }
    this.app.updateCursorReadout(p);
  }

  onLeave() {
    if (this.hoverId) {
      this.hoverId = null;
      this.app.requestDraw();
    }
  }

  onClick(ev) {
    const p = this.point(ev);
    if (!p) return;
    switch (this.tool) {
      case TOOL.select:
        this.clickSelect(ev, p);
        break;
      case TOOL.road:
        this.clickRoad(p, ev);
        break;
      case TOOL.junction:
        this.addJunction(p);
        break;
      case TOOL.building:
        this.clickPolygon(p, TOOL.building);
        break;
      case TOOL.surface:
        this.clickPolygon(p, TOOL.surface);
        break;
      case TOOL.prop:
        this.addProp(p);
        break;
      case TOOL.marking:
        this.addMarking(p);
        break;
      case TOOL.measure:
        this.clickMeasure(p);
        break;
      default:
        break;
    }
  }

  onDragStart(ev, p) {
    if (this.tool === TOOL.select) {
      this.drag = {
        kind: 'maybe-move',
        startScreen: { x: ev.clientX, y: ev.clientY },
        start: p,
        moved: false,
        additive: ev.shiftKey,
        originals: [],
      };
      return true;
    }
    return false;
  }

  onDragMove(ev) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'maybe-move') {
      const moved = Math.hypot(ev.clientX - d.startScreen.x, ev.clientY - d.startScreen.y) > 3;
      if (!moved) return;
      d.kind = 'move';
      d.moved = true;
      const ids = this.app.selection.size ? [...this.app.selection] : this.app.hoverId ? [this.app.hoverId] : [];
      if (ev.altKey) ids.push(...this.app.duplicateSelection(ids));
      d.ids = ids.filter((id) => id);
      if (!d.ids.length) {
        d.kind = 'marquee';
        this.app.requestDraw();
        return;
      }
      d.originals = d.ids.map((id) => {
        const found = this.app.world.findEntity(id);
        return found ? snapshotOf(found) : null;
      }).filter(Boolean);
      this.drag.tx = this.app.history.begin('Move');
      return;
    }
    if (d.kind === 'move') {
      const p = this.point(ev);
      if (!p) return;
      for (const orig of d.originals) {
        const patch = {};
        if (orig.x !== undefined) {
          patch.x = orig.x + (p.x - d.start.x);
          patch.y = orig.y + (p.y - d.start.y);
        } else if (orig.ox !== undefined) {
          patch.poly = orig.ox.map((pt) => ({ x: pt.x + (p.x - d.start.x), y: pt.y + (p.y - d.start.y) }));
        }
        if (Object.keys(patch).length) this.app.world.update(orig.id, patch);
      }
      this.app.world.touch(true);
      this.app.requestDraw();
    }
  }

  onDragEnd(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'move') {
      d.tx?.commit();
      this.app.world.touch(true);
      this.app.afterEdit();
    } else if (d.kind === 'marquee' || (d.kind === 'maybe-move' && !d.moved)) {
      this.clickSelect(ev, this.cursor, d.kind === 'maybe-move');
    }
    this.app.requestDraw();
  }

  clickSelect(ev, p, plain = false) {
    const id = this.app.pickAt(ev);
    if (ev.shiftKey) {
      if (id) {
        if (this.app.selection.has(id)) this.app.selection.delete(id);
        else this.app.selection.add(id);
      }
    } else if (id) {
      this.app.selection.clear();
      this.app.selection.add(id);
    } else if (!plain || !this.app.selection.size) {
      this.app.selection.clear();
    }
    this.app.refreshInspector();
    this.app.refreshStatus();
    this.app.requestDraw();
  }

  addJunction(p) {
    const app = this.app;
    const near = app.world.nearestNode(p.x, p.y, app.snapTolerance() * 0.6);
    if (near) {
      app.toast('A junction is already here', 'warn');
      return;
    }
    let id = null;
    app.history.run('Add junction', () => {
      id = app.world.addNode(makeNode(p.x, p.y)).id;
    });
    app.selection.clear();
    app.selection.add(id);
    app.afterEdit();
    app.refreshInspector();
  }

  clickRoad(p, ev) {
    const app = this.app;
    if (!this.draft) {
      this.draft = { points: [p], ids: [], tx: app.history.begin('Add road') };
      app.requestDraw();
      if (ev.detail >= 2) this.finishRoad();
      return;
    }
    const last = this.draft.points[this.draft.points.length - 1];
    if (dist(last, p) < app.snapTolerance() * 0.5) {
      if (ev.detail >= 2) this.finishRoad();
      return;
    }
    this.draft.points.push(p);
    this.extendDraftRoad();
    app.requestDraw();
    if (ev.detail >= 2) this.finishRoad();
  }

  finishRoad() {
    const app = this.app;
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;
    if (draft.ids.length === 0) {
      draft.tx.abort();
      app.requestDraw();
      return;
    }
    draft.tx.commit();
    app.selection.clear();
    for (const id of draft.ids) app.selection.add(id);
    app.afterEdit();
    app.refreshInspector();
    app.requestDraw();
  }

  /** Keep exactly one road per pair of consecutive draft points. */
  extendDraftRoad() {
    const app = this.app;
    const draft = this.draft;
    const pts = draft.points;
    const cls = ROAD_CLASSES[this.options.cls] || ROAD_CLASSES.residential;
    const spec = { cls: this.options.cls, sidewalk: cls.access !== 'foot' };
    const wanted = Math.max(0, pts.length - 1);

    while (draft.ids.length < wanted) {
      const i = draft.ids.length;
      const na = this.nodeFor(pts[i], spec);
      const nb = this.nodeFor(pts[i + 1], spec);
      draft.ids.push(app.world.addRoad(makeRoad(na, nb, spec)).id);
    }
    while (draft.ids.length > wanted) {
      app.world.removeRoad(draft.ids.pop());
    }
    app.world.touch(true);
  }

  nodeFor(p, spec) {
    const app = this.app;
    if (this.options.autoJunction) {
      const near = app.world.nearestNode(p.x, p.y, Math.max(1.5, 2 / app.camera.zoom * 2));
      if (near) return near.node.id;
    }
    return app.world.addNode(makeNode(p.x, p.y)).id;
  }

  clickPolygon(p, kind) {
    const app = this.app;
    if (!this.draft) {
      this.draft = { points: [p], kind };
      this.draftStart = p;
    } else if (kind === TOOL.building) {
      const a = this.draft.points[0];
      const w = Math.max(3, Math.abs(p.x - a.x));
      const h = Math.max(3, Math.abs(p.y - a.y));
      const x0 = Math.min(a.x, p.x);
      const y0 = Math.min(a.y, p.y);
      const rect = [
        { x: x0, y: y0 },
        { x: x0 + w, y: y0 },
        { x: x0 + w, y: y0 + h },
        { x: x0, y: y0 + h },
      ];
      this.commitPoly(kind, rect);
      return;
    } else {
      this.draft.points.push(p);
      this.app.requestDraw();
    }
  }

  finishPolygon() {
    if (!this.draft) return;
    const pts = this.draft.points;
    if (pts.length >= 3) this.commitPoly(this.draft.kind, pts);
    else this.draft = null;
    this.app.requestDraw();
  }

  commitPoly(kind, poly) {
    const app = this.app;
    let id = null;
    app.history.run(`Add ${kind}`, () => {
      const obj =
        kind === TOOL.surface
          ? makeSurface(poly, this.options.kind)
          : makeBuilding(poly, this.options);
      id = app.world.add(kind === TOOL.surface ? 'surfaces' : 'buildings', obj).id;
    });
    this.draft = null;
    app.selection.clear();
    if (id) app.selection.add(id);
    app.afterEdit();
    app.refreshInspector();
    app.requestDraw();
  }

  addProp(p) {
    const app = this.app;
    let id = null;
    app.history.run('Add object', () => {
      id = app.world.add('props', makeProp(this.options.kind, p.x, p.y)).id;
    });
    app.selection.clear();
    if (id) app.selection.add(id);
    app.afterEdit();
    app.refreshInspector();
  }

  addMarking(p) {
    const app = this.app;
    const network = app.network;
    const hit = network?.nearestLane(p.x, p.y, { tolerance: app.snapTolerance() * 1.2 });
    if (!hit?.lane) {
      app.toast('No lane here — click closer to a road', 'warn');
      return;
    }
    const lane = hit.lane;
    let id = null;
    app.history.run('Add marking', () => {
      const s0 = hit.s;
      const s1 = Math.min(app.world.roadLength(app.world.roadById(lane.roadId)) - 0.5, s0 + (this.options.span ?? 40));
      id = app.world.add(
        'markings',
        makeMarking({
          roadId: lane.roadId,
          laneId: lane.id,
          side: this.options.side,
          role: this.options.role,
          kind: this.options.kind,
          sStart: +s0.toFixed(2),
          sEnd: +s1.toFixed(2),
        })
      ).id;
    });
    app.selection.clear();
    if (id) app.selection.add(id);
    app.afterEdit();
    app.refreshInspector();
  }

  clickMeasure(p) {
    if (!this.measure) this.measure = { a: p, b: p };
    else this.measure = { a: this.measure.a, b: p };
    this.app.requestDraw();
  }

  overlay() {
    const ov = { cursor: this.cursor || undefined };
    if (this.cursor?.guides?.length) ov.guides = this.cursor.guides;
    if (this.draft?.points?.length) {
      const pts = this.draft.points.map((q) => ({ x: q.x, y: q.y }));
      if (this.tool === TOOL.road && this.cursor) pts.push({ x: this.cursor.x, y: this.cursor.y });
      ov.polyline = pts;
      ov.dash = [7, 5];
      ov.points = this.draft.points.map((q) => ({ x: q.x, y: q.y, r: 4 }));
    }
    if (this.draft && this.draft.points?.length > 1 && this.tool !== TOOL.road) {
      ov.polygons = [this.draft.points];
    }
    if (this.measure) {
      ov.polyline = [{ ...this.measure.a }, { ...this.measure.b }];
      ov.dash = [];
      const d = dist(this.measure.a, this.measure.b);
      ov.labels = [{ x: this.measure.b.x, y: this.measure.b.y, dx: 10, dy: -10, text: `${d.toFixed(2)} m` }];
    }
    if (this.drag?.kind === 'marquee' && this.drag.rect) {
      const r = this.drag.rect;
      ov.polygons = [ov.polygons || [], [
        { x: r.minX, y: r.minY },
        { x: r.maxX, y: r.minY },
        { x: r.maxX, y: r.maxY },
        { x: r.minX, y: r.maxY },
      ]];
      ov.fill = 'rgba(76,154,255,0.10)';
      ov.stroke = '#4c9aff';
    }
    return ov;
  }

  updateMarquee(ev) {
    if (this.drag?.kind !== 'maybe-move' && this.drag?.kind !== 'marquee') return;
    const app = this.app;
    const rect = app.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const a = app.camera.toWorld(Math.min(sx, this.drag.startScreen.x - rect.left), Math.min(sy, this.drag.startScreen.y - rect.top));
    const b = app.camera.toWorld(Math.max(sx, this.drag.startScreen.x - rect.left), Math.max(sy, this.drag.startScreen.y - rect.top));
    this.drag.kind = 'marquee';
    this.drag.rect = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
    const ids = [...app.world.queryIds(this.drag.rect)].filter(
      (id) => !['markings', 'signals'].includes(app.world.entityType(id))
    );
    app.selection.clear();
    for (const id of ids) app.selection.add(id);
    app.refreshInspector();
    app.requestDraw();
  }
}

function snapshotOf(found) {
  const { type, object } = found;
  if (type === 'nodes') return { id: object.id, type, x: object.x, y: object.y };
  if (type === 'props' || type === 'vehicles') return { id: object.id, type, x: object.x, y: object.y, z: object.z };
  if (type === 'buildings' || type === 'surfaces') {
    return { id: object.id, type, ox: object.poly.map((p) => ({ x: p.x, y: p.y })) };
  }
  return { id: object.id, type };
}

export function toolOptionSpec(tool) {
  switch (tool) {
    case TOOL.road:
      return [
        { key: 'cls', label: 'Class', type: 'select', options: ROAD_CLASS_ORDER.map((k) => [k, roadClassInfo({ cls: k }).label]) },
        { key: 'snapAngle', label: 'Angle snap', type: 'checkbox' },
        { key: 'autoJunction', label: 'Auto junction', type: 'checkbox' },
      ];
    case TOOL.building:
      return [
        { key: 'kind', label: 'Kind', type: 'select', options: ['house', 'apartments', 'office', 'retail', 'industrial', 'tower'] },
        { key: 'floors', label: 'Floors', type: 'number', min: 1, max: 40, step: 1 },
        { key: 'roof', label: 'Roof', type: 'select', options: ['flat', 'gabled', 'hipped', 'pyramidal'] },
      ];
    case TOOL.surface:
      return [{ key: 'kind', label: 'Kind', type: 'select', options: SURFACE_KIND_ORDER }];
    case TOOL.prop:
      return [{ key: 'kind', label: 'Kind', type: 'palette', options: PROP_KIND_ORDER }];
    case TOOL.marking:
      return [
        { key: 'kind', label: 'Marking', type: 'select', options: Object.keys(MARKING_KINDS) },
        { key: 'role', label: 'Role', type: 'select', options: MARKING_ROLES },
        { key: 'side', label: 'Side', type: 'select', options: MARKING_SIDES },
        { key: 'span', label: 'Length', type: 'number', min: 2, max: 400, step: 1 },
      ];
    default:
      return [];
  }
}
