import { Camera2D } from './core/camera.js';
import { History } from './core/history.js';
import { STYLES } from './render/theme.js';
import { Renderer2D } from './render/renderer2d.js';
import { Camera3D } from './render/camera3d.js';
import { Renderer3D } from './render/renderer3d.js';
import { Scene3D } from './render/scene3d.js';
import { RoadNetwork } from './model/network.js';
import { SnapEngine, snapToleranceFor } from './snap.js';
import { createEmptyWorld } from './model/world.js';
import { makeLayer } from './model/schema.js';
import { createDemoWorld } from './model/demo.js';
import { bboxFromWorld, formatBbox, makeOrigin, unproject } from './model/geo.js';
import { distToSeg } from './core/geom.js';
import { api as modalApi, clear, el, field, input, openModal, replace, toast } from './app/dom.js';
import { Inspector } from './app/inspector.js';
import { Minimap } from './app/minimap.js';
import { OsmImporter } from './app/osm.js';
import { download, parseWorld, readFile, saveToStorage, serialize, slug } from './app/persist.js';
import { TOOL, ToolController, toolOptionSpec } from './app/tools.js';

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.mode = '2d';
    this.styleName = 'day';
    this.selection = new Set();
    this.dirty = false;
    this.dpr = window.devicePixelRatio || 1;
    this.frames = 0;
    this.fpsAccum = 0;
    this.fps = 0;

    this.camera = new Camera2D({ zoom: 1 });
    this.camera3d = new Camera3D();
    this.renderer2d = new Renderer2D(this.canvas);
    this.scene3d = null;
    this.renderer3d = null;
    this.importer = new OsmImporter(this);
    this.inspector = new Inspector(this);
    this.tools = new ToolController(this);
    this.minimap = new Minimap(document.getElementById('minimap'), {
      getViewBox: () => this.viewBox(),
      onJump: (x, y) => this.jumpTo(x, y),
    });
    this.needsDraw = true;
    this.world = null;
  }

  async start() {
    this.bindDom();
    this.bindPointer();
    this.bindKeys();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    const restored = this.restoreLastSession();
    if (restored) this.setWorld(restored, { fit: true, silent: true });
    else this.setWorld(createDemoWorld(), { fit: true });
    this.minimap.attach();
    this.inspector.render();
    this.tools.setTool(TOOL.select);
    this.startLoop();
    if (new URLSearchParams(location.search).has('selftest')) this.runSelfTestHook();
    this.reveal();
  }

  reveal() {
    document.body.dataset.ready = '1';
  }

  async runSelfTestHook() {
    try {
      const { publishSelfTest, runSelfTest } = await import('./app/selftest.js');
      const results = await runSelfTest(this);
      const summary = publishSelfTest(results);
      document.documentElement.dataset.selftest = `${summary.passed}/${summary.total}`;
    } catch (err) {
      reportProblem(err);
      const node = document.createElement('script');
      node.type = 'application/json';
      node.id = 'selftest';
      node.textContent = JSON.stringify({ passed: 0, total: 1, results: [{ name: 'self-test crashed', ok: false, detail: err.stack || err.message }] });
      document.body.append(node);
    }
  }

  /* ---------------------------------------------------------------- world */

  setWorld(world, { fit = false, silent = false } = {}) {
    this.world = world;
    this.history = new History(world);
    this.history.on('change', () => this.refreshHistoryButtons());
    this.network = new RoadNetwork(world);
    this.snap = new SnapEngine(world);
    this.scene3d = new Scene3D(world, this.network);
    this.renderer3d = new Renderer3D(this.canvas, world, this.scene3d);
    this.selection.clear();
    this.minimap.setWorld(world);
    world.on('dirty', () => {
      this.network?.invalidate();
      this.scene3d?.invalidate();
      this.markDirty();
      this.requestDraw();
    });
    if (fit) this.fitWorld();
    this.markDirty();
    this.renderSidebars();
    this.refreshStatus();
    this.refreshHistoryButtons();
    this.updateWorldName();
    this.requestDraw();
    if (!silent) this.toast(`Loaded “${world.data.meta?.name || 'world'}”`, 'ok');
  }

  markDirty() {
    this.dirty = true;
    const node = document.getElementById('save-state');
    if (node) {
      node.textContent = 'unsaved';
      node.classList.add('dirty');
    }
  }

  markClean() {
    this.dirty = false;
    const node = document.getElementById('save-state');
    if (node) {
      node.textContent = 'saved';
      node.classList.remove('dirty');
    }
  }

  afterEdit() {
    this.network.invalidate();
    this.scene3d.invalidate();
    this.markDirty();
    this.renderSidebars();
    this.refreshStatus();
    this.requestDraw();
  }

  editEntity(id, changes, label = 'Edit') {
    const found = this.world.findEntity(id);
    if (!found) return;
    this.history.run(label, () => this.world.update(id, changes));
    this.afterEdit();
  }

  nudgeSelection(dx, dy) {
    const step = 1 / this.camera.zoom;
    const ids = [...this.selection];
    this.history.run('Nudge', () => {
      for (const id of ids) {
        const found = this.world.findEntity(id);
        if (!found) continue;
        if (found.type === 'buildings' || found.type === 'surfaces') {
          this.world.update(id, { poly: found.object.poly.map((p) => ({ x: p.x + dx * step, y: p.y + dy * step })) });
        } else {
          this.world.update(id, { x: found.object.x + dx * step, y: found.object.y + dy * step });
        }
      }
    });
    this.afterEdit();
  }

  duplicateSelection(ids = [...this.selection]) {
    if (!ids.length) return [];
    const made = [];
    this.history.run('Duplicate', () => {
      for (const id of ids) {
        const found = this.world.findEntity(id);
        if (!found) continue;
        if (found.type === 'buildings' || found.type === 'surfaces') {
          const c = copyWithNewId(found.object, { poly: offsetPoly(found.object.poly, 4, 4) });
          made.push(this.world.add(found.type, c).id);
        } else if ('x' in found.object) {
          made.push(this.world.add(found.type, copyWithNewId(found.object, { x: found.object.x + 4, y: found.object.y + 4 })).id);
        }
      }
    });
    this.selection.clear();
    for (const id of made) this.selection.add(id);
    this.afterEdit();
    this.refreshInspector();
    this.toast(`Duplicated ${made.length} object${made.length === 1 ? '' : 's'}`, 'ok', 1600);
    return made;
  }

  deleteSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    this.history.run(ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete', () => this.world.removeMany(ids));
    this.selection.clear();
    this.afterEdit();
    this.refreshInspector();
    this.toast(`Deleted ${ids.length} object${ids.length === 1 ? '' : 's'}`, 'ok', 1600);
  }

  addLayer(key, name) {
    const max = Math.max(-1, ...this.world.data.layers.map((l) => l.order));
    this.history.run('Add layer', () => {
      this.world.data.layers.push(makeLayer(key, name, max + 1));
    });
    this.afterEdit();
  }

  rebuildNetwork() {
    this.network.invalidate();
    this.network.ensure(true);
    this.afterEdit();
    const s = this.network.stats();
    this.toast(`Network rebuilt: ${s.lanes} lanes, ${s.junctions} junctions`, 'ok');
  }

  exportAutonomy() {
    const json = this.network.toAutonomyFormat();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(this.world.data.meta?.name || 'world')}.autonomy.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.toast(`Exported ${json.lanes?.length || 0} lanes`, 'ok');
  }

  setOriginFromView() {
    const center = this.camera;
    const origin = this.world.data.meta?.origin || makeOrigin(0, 0, 0);
    const ll = unproject(center.x, center.y, origin);
    this.world.data.meta.origin = makeOrigin(+ll.lat.toFixed(6), +ll.lon.toFixed(6), origin.yawDeg || 0);
    this.afterEdit();
    this.toast(`Origin set to ${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`, 'ok');
  }

  renameWorld(name) {
    this.world.data.meta.name = name;
    this.afterEdit();
    this.updateWorldName();
  }

  patchMeta(patch) {
    Object.assign(this.world.data.meta, patch);
    this.afterEdit();
  }

  patchSettings(patch) {
    Object.assign(this.world.data.meta.settings, patch);
    this.afterEdit();
  }

  /* ----------------------------------------------------------------- view */

  resize() {
    const rect = this.stageRect();
    this.dpr = window.devicePixelRatio || 1;
    this.camera.resize(rect.width, rect.height);
    this.camera3d.resize(rect.width, rect.height);
    if (this.mode === '2d') this.renderer2d.resize(rect.width, rect.height, this.dpr);
    else this.renderer3d.resize(rect.width, rect.height, this.dpr);
    this.requestDraw();
  }

  stageRect() {
    const node = document.getElementById('stage');
    return { width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight) };
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === '3d') {
      this.camera3d.targetX = this.camera.x;
      this.camera3d.targetY = this.camera.y;
      this.camera3d.targetDistance = clamp(1200 / this.camera.zoom, this.camera3d.minDistance, this.camera3d.maxDistance);
      this.renderer3d.resize(this.camera3d.width, this.camera3d.height, this.dpr);
    } else {
      this.camera.x = this.camera3d.x;
      this.camera.y = this.camera3d.y;
      this.camera.zoom = clamp(1200 / this.camera3d.distance, this.camera.minZoom, this.camera.maxZoom);
      this.renderer2d.resize(this.camera.width, this.camera.height, this.dpr);
    }
    for (const b of document.querySelectorAll('#view-switch button')) b.classList.toggle('active', b.dataset.mode === mode);
    this.tools.cancel();
    this.canvas.classList.toggle('picking', mode === '3d');
    this.resize();
  }

  fitWorld(padding = 70) {
    const box = this.world.bbox();
    this.camera.fitBounds(box, padding);
    this.camera3d.flyTo((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0, { distance: Math.max(160, (box.maxX - box.minX) * 1.5) });
    this.requestDraw();
  }

  focusSelection() {
    const box = boxOfIds(this.world, [...this.selection]);
    if (!box) return;
    this.camera.fitBounds(box, 140);
    this.camera3d.flyTo((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0, { distance: Math.max(60, (box.maxX - box.minX) * 2.2) });
  }

  zoomToLayer(layer) {
    const ids = [];
    for (const c of ['buildings', 'props', 'surfaces', 'roads', 'markings', 'nodes']) {
      for (const o of this.world.allOfType(c)) if (o.layerId === layer.id) ids.push(o.id);
    }
    const box = boxOfIds(this.world, ids);
    if (box) this.camera.fitBounds(box, 90);
    this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.refreshInspector();
  }

  jumpTo(x, y) {
    this.camera.animateTo(x, y, this.camera.zoom, 260);
    this.camera3d.flyTo(x, y, this.camera3d.z, { distance: this.camera3d.distance, duration: 260 });
  }

  viewBox() {
    if (this.mode === '3d') {
      const v = this.camera3d.visibleBox();
      return { minX: v.minX, minY: v.minY, maxX: v.maxX, maxY: v.maxY };
    }
    const b = this.camera.visibleWorldBox(20);
    return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
  }

  groundPoint(sx, sy) {
    if (this.mode !== '3d') return null;
    return this.camera3d.groundAt(sx, sy);
  }

  pickAt(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    if (this.mode === '3d') {
      this.renderer3d.setSelection(this.selection);
      this.renderer3d.setHovered(this.tools.hoverId);
      return this.renderer3d.pickAt(this.camera3d, sx, sy);
    }
    return this.pick2d(sx, sy);
  }

  pick2d(sx, sy) {
    const world = this.world;
    const cam = this.camera;
    const w = cam.toWorld(sx, sy);
    const tolerance = this.snapTolerance();
    // Front-to-back, matching the draw order: the first type that hits wins,
    // and within a type the nearest object wins. A ground surface must never
    // beat a road drawn on top of it.
    for (const type of PICK_ORDER) {
      let best = null;
      let bestD = Infinity;
      for (const obj of world.allOfType(type)) {
        const layer = obj.layerId ? world.layerById(obj.layerId) : null;
        if (layer && !layer.visible) continue;
        const d = pickDistance(world, type, obj, w, tolerance);
        if (d === null || !Number.isFinite(d) || d > tolerance || d >= bestD) continue;
        bestD = d;
        best = obj.id;
      }
      if (best) return best;
    }
    return null;
  }

  snapTolerance() {
    return snapToleranceFor(this.camera.zoom);
  }

  /* ---------------------------------------------------------------- input */

  bindPointer() {
    const c = this.canvas;
    let pan = null;
    let drag = false;

    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.tools.rotating = ev.shiftKey && this.tools.tool === 'prop';
      if (ev.button === 1 || ev.button === 2 || ev.altKey || this.mode === '3d') {
        pan = { x: ev.clientX, y: ev.clientY, t: performance.now() };
        c.classList.add('panning');
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      drag = true;
      this.dragMoved = false;
      this.tools.onDragStart(ev, this.tools.point(ev));
    });

    c.addEventListener('pointermove', (ev) => {
      if (pan) {
        const dx = ev.clientX - pan.x;
        const dy = ev.clientY - pan.y;
        const now = performance.now();
        const dt = Math.max(1, now - pan.t);
        if (this.mode === '3d') this.camera3d.panByPixels(dx, dy);
        else this.camera.panByPixels(dx, dy);
        if (now - pan.t > 60) {
          this.camera.flick?.(dx / dt, dy / dt);
          this.camera3d.flick?.(dx / dt, dy / dt);
        }
        pan = { x: ev.clientX, y: ev.clientY, t: now };
        this.requestDraw();
        return;
      }
      if (drag) {
        if (this.tools.drag?.kind === 'maybe-move' || this.tools.drag?.kind === 'marquee') this.tools.updateMarquee(ev);
        if (this.tools.drag) {
          if (this.dragMoved === false && Math.hypot(ev.movementX || 0, ev.movementY || 0) > 2) this.dragMoved = true;
          this.tools.onDragMove(ev);
        }
        return;
      }
      this.tools.onHover(ev);
    });

    const end = (ev) => {
      try {
        c.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      c.classList.remove('panning');
      if (pan) {
        pan = null;
        return;
      }
      if (drag) {
        drag = false;
        if (this.tools.drag) this.tools.onDragEnd(ev);
        else if (!this.dragMoved) this.tools.onClick(ev);
        return;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.tools.onLeave());
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = ev.clientX - rect.left;
        const sy = ev.clientY - rect.top;
        if (this.mode === '3d') {
          if (ev.ctrlKey || ev.shiftKey) this.camera3d.zoomBy(1 / ev.deltaY);
          else this.camera3d.orbitBy(ev.deltaX * 0.006, ev.deltaY * 0.006);
        } else if (ev.ctrlKey || ev.shiftKey) {
          this.camera.zoomAt(sx, sy, 1 / ev.deltaY);
        } else if (ev.altKey) {
          this.camera.zoomAt(sx, sy, 1 / ev.deltaY);
        } else {
          this.camera.panByPixels(-ev.deltaX, -ev.deltaY);
        }
        this.requestDraw();
      },
      { passive: false }
    );

    c.addEventListener('dblclick', (ev) => {
      if (this.tools.tool === 'road') this.tools.finishRoad();
      else if (this.tools.tool === 'surface') this.tools.finishPolygon();
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      const tag = ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (ev.key === 'Escape') ev.target.blur();
        return;
      }
      if (modalApi.isOpen()) {
        if (ev.key === 'Escape') modalApi.close();
        return;
      }
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        this.redo();
        return;
      }
      if (mod && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        this.save();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'o') {
        ev.preventDefault();
        this.openFile();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'd') {
        ev.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (mod) return;

      const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (arrows[ev.key] && this.selection.size) {
        ev.preventDefault();
        this.nudgeSelection(arrows[ev.key][0] * (ev.shiftKey ? 5 : 1), arrows[ev.key][1] * (ev.shiftKey ? 5 : 1));
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (this.selection.size) {
          ev.preventDefault();
          this.deleteSelection();
        }
        return;
      }
      if (ev.key === 'Escape') {
        this.tools.cancel();
        return;
      }
      if (ev.key === 'Enter') {
        if (this.tools.tool === 'road') this.tools.finishRoad();
        else if (this.tools.tool === 'surface') this.tools.finishPolygon();
        return;
      }
      if (ev.key === '2') return this.setMode('2d');
      if (ev.key === '3') return this.setMode('3d');
      if (ev.key === 'f' || ev.key === 'F') return this.fitWorld();
      if (ev.key === 'Delete' || ev.key === 'Backspace') return;
      const map = { v: 'select', r: 'road', j: 'junction', b: 'building', g: 'surface', o: 'prop', m: 'marking', d: 'measure' };
      const tool = map[ev.key.toLowerCase()];
      if (tool) {
        this.setTool(tool);
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        this.cycleLayer();
      }
    });
  }

  cycleLayer() {
    const layers = this.world.data.layers;
    if (!layers.length) return;
    const cur = this._layerCursor ?? -1;
    this._layerCursor = (cur + 1) % layers.length;
    this.toast(`Active layer: ${layers[this._layerCursor].name}`, '', 1200);
  }

  bindDom() {
    for (const btn of document.querySelectorAll('.tool')) {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    }
    for (const btn of document.querySelectorAll('#view-switch button')) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    }
    for (const btn of document.querySelectorAll('#tabs .tab')) {
      btn.addEventListener('click', () => {
        for (const t of document.querySelectorAll('#tabs .tab')) t.classList.toggle('active', t === btn);
        for (const key of ['inspector', 'layers', 'world']) {
          document.getElementById(`tab-${key}`).classList.toggle('hidden', key !== btn.dataset.tab);
        }
        this.refreshInspector();
      });
    }

    document.getElementById('btn-new').addEventListener('click', () => this.newWorld());
    document.getElementById('btn-open').addEventListener('click', () => this.openFile());
    document.getElementById('btn-save').addEventListener('click', () => this.save());
    document.getElementById('btn-save-as').addEventListener('click', () => this.save(true));
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
    document.getElementById('btn-osm').addEventListener('click', () => this.openOsmDialog());

    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoomStep(1));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoomStep(-1));
    document.getElementById('btn-fit').addEventListener('click', () => this.fitWorld());
    document.getElementById('btn-topdown').addEventListener('click', (ev) => {
      if (this.mode === '2d') return this.setMode('3d');
      const on = !this.camera3d.isTopDown();
      this.camera3d.topDown(on);
      ev.currentTarget.classList.toggle('on', on);
      this.requestDraw();
    });

    document.getElementById('style-select').addEventListener('change', (ev) => {
      this.styleName = ev.target.value;
      this.requestDraw();
    });

    const nameInput = document.getElementById('world-name');
    nameInput.addEventListener('change', () => this.renameWorld(nameInput.value.trim() || 'Untitled world'));

    document.getElementById('modal-close').addEventListener('click', () => modalApi.close());
    document.querySelector('#modal-root .modal-backdrop').addEventListener('click', () => modalApi.close());

    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const world = await readFile(file);
        this.setWorld(world, { fit: true });
        this.markClean();
      } catch (err) {
        this.toast(err.message, 'error', 6000);
      }
    });
  }

  setTool(tool) {
    for (const btn of document.querySelectorAll('.tool')) btn.classList.toggle('active', btn.dataset.tool === tool);
    this.tools.setTool(tool);
  }

  refreshToolOptions() {
    const host = document.getElementById('tool-options');
    const spec = toolOptionSpec(this.tools.tool);
    if (!spec.length) {
      clear(host);
      return;
    }
    const opts = this.tools.options;
    replace(
      host,
      spec.map((s) => {
        if (s.type === 'checkbox') {
          return field(
            s.label,
            el('input', {
              type: 'checkbox',
              checked: !!opts[s.key],
              onchange: (e) => {
                opts[s.key] = e.target.checked;
              },
            })
          );
        }
        if (s.type === 'palette') {
          return field(
            s.label,
            el(
              'select',
              { onchange: (e) => (opts[s.key] = e.target.value) },
              s.options.map((k) => el('option', { value: k, text: k, selected: k === opts[s.key] }))
            )
          );
        }
        if (s.type === 'number') {
          return field(
            s.label,
            el('input', {
              type: 'number',
              value: opts[s.key] ?? 1,
              min: s.min,
              max: s.max,
              step: s.step,
              oninput: (e) => {
                opts[s.key] = Number(e.target.value);
              },
            })
          );
        }
        return field(
          s.label,
          el(
            'select',
            { onchange: (e) => (opts[s.key] = e.target.value) },
            s.options.map(([value, label]) => el('option', { value, text: label, selected: String(value) === String(opts[s.key]) }))
          )
        );
      })
    );
  }

  refreshHint() {
    const node = document.getElementById('status-hint');
    if (!node) return;
    const text = this.tools.hint();
    node.innerHTML = text;
    node.classList.toggle('show', !!text);
  }

  refreshInspector() {
    this.inspector.renderInspector();
  }

  renderSidebars() {
    this.inspector.render();
  }

  refreshStatus() {
    const sel = document.getElementById('status-selection');
    if (sel) {
      const n = this.selection.size;
      sel.textContent = n ? `${n} selected` : 'No selection';
    }
    const counts = document.getElementById('status-counts');
    if (counts) {
      const s = this.world.stats();
      counts.textContent = `${s.roads} roads · ${s.buildings} buildings · ${s.props} objects`;
    }
  }

  updateCursorReadout(p) {
    const node = document.getElementById('status-cursor');
    if (!node || !p) return;
    node.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}${p.snapped ? ` · ${p.label}` : ''}`;
  }

  updateWorldName() {
    const node = document.getElementById('world-name');
    if (node) node.value = this.world.data.meta?.name || '';
  }

  refreshHistoryButtons() {
    const s = this.history.state();
    document.getElementById('btn-undo').disabled = !s.canUndo;
    document.getElementById('btn-redo').disabled = !s.canRedo;
  }

  refreshStyleSelect() {
    const node = document.getElementById('style-select');
    if (node) node.value = this.styleName;
  }

  undo() {
    if (!this.history.undo()) return this.toast('Nothing to undo', '', 1200);
    this.afterEdit();
    this.refreshInspector();
  }

  redo() {
    if (!this.history.redo()) return this.toast('Nothing to redo', '', 1200);
    this.afterEdit();
    this.refreshInspector();
  }

  zoomStep(dir) {
    if (this.mode === '3d') this.camera3d.zoomBy(dir > 0 ? 0.85 : 1 / 0.85);
    else this.camera.stepZoom(dir, this.camera.width / 2, this.camera.height / 2);
    this.requestDraw();
  }

  /* ---------------------------------------------------------------- files */

  restoreLastSession() {
    try {
      const text = localStorage.getItem('vwe:last');
      if (!text) return null;
      return parseWorld(text);
    } catch {
      return null;
    }
  }

  save(sessionToo = true) {
    if (sessionToo) {
      try {
        localStorage.setItem('vwe:last', serialize(this.world));
      } catch {
        /* quota exceeded; ignore */
      }
    }
    saveToStorage(this.world);
    download(this.world);
    this.markClean();
    this.toast('Saved', 'ok', 1600);
  }

  openFile() {
    document.getElementById('file-input').click();
  }

  newWorld() {
    openModal({
      title: 'New world',
      body: [
        field('Name', input('Untitled world', (v) => (this._newName = v))),
        el('p', { class: 'note', text: 'The current world is kept in your browser until you save a file.' }),
      ],
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create',
          kind: 'primary',
          onClick: () => {
            this.setWorld(createEmptyWorld(this._newName || 'Untitled world'), { fit: true });
            this.markClean();
          },
        },
      ],
    });
  }

  openOsmDialog() {
    const origin = this.world.data.meta?.origin;
    let replace = false;
    let lat = origin?.lat ?? 51.5074;
    let lon = origin?.lon ?? -0.1278;
    let radius = 600;
    const log = el('div', { class: 'osm-log', text: 'Ready.' });
    const bar = el('div', { id: 'osm-progress' }, [el('div')]);
    const status = el('p', { class: 'note', text: 'Enter a centre point and radius, or import into the current view.' });

    openModal({
      title: 'Import roads from OpenStreetMap',
      width: 'min(560px, 92vw)',
      body: [
        el('p', { class: 'note', html: 'Road geometry comes from <b>OpenStreetMap</b> contributors, licensed <b>ODbL</b>. You must keep attribution when you share exported worlds.' }),
        field('Latitude', input(lat, (v) => (lat = Number(v)))),
        field('Longitude', input(lon, (v) => (lon = Number(v)))),
        field('Radius (m)', input(radius, (v) => (radius = Number(v)), { type: 'number', min: 50, max: 20000, step: 50 })),
        field('Replace existing', el('input', { type: 'checkbox', onchange: (e) => (replace = e.target.checked) })),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn',
            text: 'Use current view',
            onclick: () => {
              this.world.setOrigin(lat, lon, 0);
              this._osmBox = bboxFromWorld(this.viewBox(), this.world.data.meta.origin);
              status.textContent = `Will query ${formatBbox(this._osmBox)}`;
            },
          }),
        ]),
        status,
        bar,
        log,
      ],
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import',
          kind: 'primary',
          onClick: async () => {
            if (this.importer.controller) return;
            try {
              this.world.setOrigin(lat, lon, 0);
              const bbox = this._osmBox || radiusBbox(lat, lon, radius);
              bar.firstChild.style.width = '20%';
              const result = await this.importer.run({
                bbox,
                replace,
                onStatus: (s) => {
                  status.textContent = s;
                  log.textContent += `${s}\n`;
                },
                onProgress: (p) => (bar.firstChild.style.width = `${Math.round(p * 100)}%`),
              });
              bar.firstChild.style.width = '100%';
              status.textContent = `Imported ${result.report.roads} road segments from ${result.report.ways} ways.`;
              log.textContent += `${status.textContent}\n`;
              this.afterEdit();
              this.fitWorld();
              modalApi.close();
              this.toast(`Imported ${result.report.roads} road segments`, 'ok', 4000);
            } catch (err) {
              bar.firstChild.style.width = '0%';
              status.textContent = `Failed: ${err.message}`;
              log.textContent += `ERROR ${err.message}\n`;
            }
          },
        },
      ],
    });
  }

  /* ----------------------------------------------------------------- loop */

  requestDraw() {
    this.needsDraw = true;
  }

  startLoop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const animating = this.camera.update(dt) || this.camera3d.update(dt);
      this.minimap.draw();
      if (this.needsDraw || animating) {
        this.draw();
        this.needsDraw = animating;
      }
      this.frames += 1;
      this.fpsAccum += dt;
      if (this.fpsAccum > 500) {
        this.fps = Math.round((this.frames * 1000) / this.fpsAccum);
        this.frames = 0;
        this.fpsAccum = 0;
        this.updatePerf();
      }
      this.updateScaleBar();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  draw() {
    if (!this.world) return;
    const style = STYLES[this.styleName] || STYLES.day;
    if (this.mode === '2d') {
      this.network?.ensure();
      this.renderer2d.draw({
        camera: this.camera,
        style,
        world: this.world,
        network: this.network,
        vehicle: this.vehicle || null,
        route: this.route || null,
        routeGoal: this.routeGoal || null,
        sensors: this.sensors || null,
        selection: this.selection,
        hoverId: this.tools.hoverId,
        overlay: this.mode === '3d' ? null : this.tools.overlay(),
        showGrid: true,
        showLabels: true,
        showRoute: false,
      });
    } else {
      this.renderer3d.setSelection(this.selection);
      this.renderer3d.setHovered(this.tools.hoverId);
      this.renderer3d.render(this.camera3d);
    }
  }

  updatePerf() {
    const node = document.getElementById('perf');
    if (!node) return;
    const s = this.world?.stats() || {};
    if (this.mode === '2d') {
      node.textContent = `${this.fps} fps · ${s.roads ?? 0} roads`;
    } else {
      const st = this.renderer3d.stats;
      node.textContent = `${this.fps} fps · ${st.ms} ms · ${st.cells} cells`;
    }
  }

  updateScaleBar() {
    const node = document.querySelector('#scalebar .label');
    const bar = document.querySelector('#scalebar .bar');
    if (!node || !bar) return;
    if (this.mode === '3d') {
      node.textContent = '3D';
      bar.style.width = '0px';
      return;
    }
    const { meters, px } = this.camera.niceScaleBar(110);
    const nice = niceNumber(meters);
    bar.style.width = `${Math.round(px * (nice / meters))}px`;
    node.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  }

  toast(message, kind, ms) {
    return toast(message, kind, ms);
  }
}

/* -------------------------------------------------------------- helpers */

function radiusBbox(lat, lon, radius) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

function niceNumber(v) {
  const exp = Math.floor(Math.log10(v));
  const base = v / 10 ** exp;
  const mult = base >= 5 ? 5 : base >= 2 ? 2 : 1;
  return mult * 10 ** exp;
}

function copyWithNewId(obj, overrides) {
  return { ...structuredClone(obj), ...overrides, id: undefined };
}

function offsetPoly(poly, dx, dy) {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function boxOfIds(world, ids) {
  let box = null;
  for (const id of ids) {
    const found = world.findEntity(id);
    if (!found) continue;
    const b = world.entityBox(found.type, found.object);
    if (!b) continue;
    if (!box) box = { ...b };
    else {
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
    }
  }
  return box;
}

const PICK_ORDER = ['props', 'vehicles', 'markings', 'buildings', 'roads', 'nodes', 'surfaces'];

function pickDistance(world, type, obj, w, tolerance) {
  if (type === 'nodes') return Math.hypot(obj.x - w.x, obj.y - w.y);
  if (type === 'props' || type === 'vehicles') return Math.hypot(obj.x - w.x, obj.y - w.y) - 1.5;
  if (type === 'buildings' || type === 'surfaces') return pointInPoly(w.x, w.y, obj.poly) ? 0 : null;
  if (type === 'roads') {
    const [a, b] = world.roadNodes(obj);
    if (!a || !b) return null;
    return distToSeg(w.x, w.y, a.x, a.y, b.x, b.y);
  }
  return null;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const problems = [];
function reportProblem(err) {
  const message = err?.stack || err?.message || String(err);
  problems.push(message);
  const shared = window.__vweProblems || (window.__vweProblems = problems);
  if (!shared.includes(message)) shared.push(message);
  document.documentElement.dataset.errors = String(shared.length);
  console.error(err);
  const old = document.getElementById('bootlog');
  if (old) old.remove();
  const node = document.createElement('script');
  node.type = 'application/json';
  node.id = 'bootlog';
  node.textContent = JSON.stringify(shared);
  document.documentElement.appendChild(node);
}
window.addEventListener('error', (ev) => reportProblem(ev.error || new Error(ev.message)));
window.addEventListener('unhandledrejection', (ev) => reportProblem(ev.reason));
window.vweProblems = problems;

const app = new App();
window.vwe = app;
app.start().catch((err) => {
  reportProblem(err);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<pre id="fatal" style="color:#e5615f;padding:16px;white-space:pre-wrap">Failed to start:\n${err.stack || err.message}</pre>`
  );
});

export { app };
