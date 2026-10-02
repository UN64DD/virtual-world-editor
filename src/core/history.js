import { Emitter } from './emitter.js';
import { clone, deepEqual } from './util.js';

const MAX_ENTRIES = 200;

class Transaction {
  constructor(history, label) {
    this.history = history;
    this.world = history.world;
    this.label = label || 'Edit';
    this.ops = [];
    this.done = false;
    this._batchingBefore = this.world._batching;
    this.world._batching = true;
    // Capture mutations made straight through the World API as well as through
    // the helper methods below, so tools can mix the two freely.
    this._recorderBefore = this.world._recorder || null;
    this.world.setRecorder((op) => this.ops.push(op));
  }

  _close() {
    if (this.done) return;
    this.world.setRecorder(this._recorderBefore);
  }

  add(collectionKey, object) {
    if (this.done) throw new Error('transaction already closed');
    this.world.data[collectionKey].push(object);
    this.world.markDirty();
    this.ops.push({ op: 'add', collectionKey, id: object.id, object });
    return object;
  }

  /** Reuse an existing object in the history stack. */
  static rebase(entry, world) {
    entry.world = world;
    return entry;
  }

  remove(id) {
    const found = this.world.findEntity(id);
    if (!found) return false;
    const arr = this.world.data[found.type];
    const index = arr.indexOf(found.object);
    if (index < 0) return false;
    arr.splice(index, 1);
    if (found.collection.singular === 'node') {
      const doomed = this.world.data.roads.filter((r) => r.a === id || r.b === id);
      const doomedIds = [];
      for (const r of doomed) {
        const i2 = this.world.data.roads.indexOf(r);
        if (i2 >= 0) {
          this.world.data.roads.splice(i2, 1);
          doomedIds.push(r.id);
          this.ops.push({ op: 'remove', collectionKey: 'roads', id: r.id, index: i2, snapshot: clone(r) });
        }
      }
      // _dropMarkingsForRoads records through the world's recorder, so the
      // dropped markings are captured exactly once.
      this.world._dropMarkingsForRoads(doomedIds);
    }
    if (found.collection.singular === 'road') {
      this.world._dropMarkingsForRoads([id]);
    }
    this.world.markDirty();
    this.ops.push({ op: 'remove', collectionKey: found.type, id, index, snapshot: clone(found.object) });
    return true;
  }

  patch(obj, changes, collectionKey = null) {
    const type = collectionKey || this.world.entityType(obj.id);
    if (!type) return obj;
    const before = {};
    const after = {};
    let dirty = false;
    for (const key in changes) {
      const next = changes[key];
      const prev = obj[key];
      if (deepEqual(prev, next)) continue;
      before[key] = clone(prev);
      after[key] = clone(next);
      obj[key] = clone(next);
      dirty = true;
    }
    if (dirty) this.ops.push({ op: 'patch', collectionKey: type, id: obj.id, before, after });
    return obj;
  }

  setPoly(obj, poly, collectionKey = null) {
    return this.patch(obj, { poly: poly.map((p) => ({ x: p.x, y: p.y })) }, collectionKey);
  }

  get isEmpty() {
    return this.ops.length === 0;
  }

  commit() {
    if (this.done) return false;
    this.done = true;
    this._close();
    this.world._batching = this._batchingBefore;
    if (this.ops.length === 0) {
      this.world.touch(true);
      return false;
    }
    this.world.markDirty();
    this.history._push({ label: this.label, ops: this.ops });
    this.world.touch(true);
    return true;
  }

  abort() {
    if (this.done) return;
    this.done = true;
    this._close();
    for (let i = this.ops.length - 1; i >= 0; i--) this._revertOne(this.ops[i]);
    this.world._batching = this._batchingBefore;
    this.world.touch(true);
  }

  _revertOne(o) {
    const w = this.world;
    w.markDirty();
    if (o.op === 'add') {
      const arr = w.data[o.collectionKey];
      const i = arr.findIndex((x) => x.id === o.id);
      if (i >= 0) arr.splice(i, 1);
    } else if (o.op === 'remove') {
      if (o.collectionKey === 'markings' && o.index < 0) w.data.markings.push(o.snapshot);
      else {
        const arr = w.data[o.collectionKey];
        arr.splice(Math.min(o.index < 0 ? arr.length : o.index, arr.length), 0, o.snapshot);
      }
    } else if (o.op === 'patch') {
      const obj = w.byId(o.collectionKey, o.id);
      if (obj) Object.assign(obj, clone(o.before));
    }
  }
}

export class History extends Emitter {
  constructor(world) {
    super();
    this.world = world;
    this.stack = [];
    this.index = -1;
    this.limit = MAX_ENTRIES;
    this.transaction = null;
    this.suspend = 0;
  }

  setWorld(world) {
    this.closeTransaction();
    this.world = world;
    this.stack = [];
    this.index = -1;
    this.emit('reset');
  }

  begin(label) {
    if (this.transaction) this.transaction.commit();
    const tx = new Transaction(this, label);
    this.transaction = tx;
    return tx;
  }

  get inTransaction() {
    return !!this.transaction;
  }

  run(label, fn) {
    const tx = this.begin(label);
    let result;
    try {
      result = fn(tx);
    } catch (err) {
      tx.abort();
      throw err;
    }
    tx.commit();
    return result;
  }

  _push(entry) {
    if (this.suspend > 0) return;
    this.stack.length = this.index + 1;
    this.stack.push(entry);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.emit('change', this.state());
  }

  state() {
    return {
      canUndo: this.index >= 0,
      canRedo: this.index < this.stack.length - 1,
      undoLabel: this.index >= 0 ? this.stack[this.index].label : null,
      redoLabel: this.index < this.stack.length - 1 ? this.stack[this.index + 1].label : null,
      depth: this.index + 1,
      size: this.stack.length,
    };
  }

  undo() {
    if (this.index < 0) return null;
    const entry = this.stack[this.index];
    this.suspend += 1;
    this.world._batching = true;
    try {
      for (let i = entry.ops.length - 1; i >= 0; i--) this._revert(entry.ops[i]);
    } finally {
      this.world._batching = this.suspend > 1;
      this.suspend -= 1;
    }
    this.world.touch(true);
    this.index -= 1;
    this.emit('change', this.state());
    this.emit('undo', entry);
    return entry;
  }

  _revert(o) {
    const w = this.world;
    w.markDirty();
    if (o.op === 'add') {
      const arr = w.data[o.collectionKey];
      const i = arr.findIndex((x) => x.id === o.id);
      if (i >= 0) arr.splice(i, 1);
    } else if (o.op === 'remove') {
      const arr = w.data[o.collectionKey];
      arr.splice(Math.min(o.index < 0 ? arr.length : o.index, arr.length), 0, clone(o.snapshot));
    } else if (o.op === 'patch') {
      const obj = w.byId(o.collectionKey, o.id);
      if (obj) Object.assign(obj, clone(o.before));
    }
  }

  redo() {
    if (this.index >= this.stack.length - 1) return null;
    const entry = this.stack[this.index + 1];
    this.suspend += 1;
    this.world._batching = true;
    this.world.setRecorder(null);
    try {
      this._reapply(entry.ops);
    } finally {
      this.world._batching = this.suspend > 1;
      this.world.setRecorder(null);
      this.suspend -= 1;
    }
    this.world.touch(true);
    this.index += 1;
    this.emit('change', this.state());
    this.emit('redo', entry);
    return entry;
  }

  _reapply(ops) {
    const w = this.world;
    for (const o of ops) {
      if (o.op === 'add') {
        const arr = w.data[o.collectionKey];
        if (!arr.some((x) => x.id === o.id)) arr.push(o.object);
      } else if (o.op === 'remove') {
        const arr = w.data[o.collectionKey];
        const i = arr.findIndex((x) => x.id === o.id);
        if (i >= 0) arr.splice(i, 1);
      } else if (o.op === 'patch') {
        const obj = w.byId(o.collectionKey, o.id);
        if (obj) Object.assign(obj, clone(o.after));
      }
    }
  }

  /** Close any open transaction without recording it. */
  closeTransaction() {
    if (this.transaction) this.transaction.abort();
  }

  clear() {
    this.stack = [];
    this.index = -1;
    this.emit('change', this.state());
  }
}

export function captureOp(collectionKey, id, snapshot) {
  return { op: 'capture', collectionKey, id, snapshot: clone(snapshot) };
}
