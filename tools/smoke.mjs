// Import smoke test: catches unresolved/undefined imports that `node --check` misses.
// Run with: node tools/smoke.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const stubs = new Map();
function stubCtx2d() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    {
      canvas: null,
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      measureText: () => ({ width: 8 }),
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}
stubs.set('performance', { now: () => 0 });
stubs.set('document', {
  createElement(tag) {
    if (tag !== 'canvas') return { style: {}, classList: { add: () => {}, toggle: () => {} }, appendChild: () => {}, addEventListener: () => {} };
    return { width: 1, height: 1, style: {}, getContext: () => stubCtx2d() };
  },
  createElementNS() {
    return { setAttribute: () => {}, appendChild: () => {} };
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
});
stubs.set('window', {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: () => {},
  requestAnimationFrame: () => 0,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
globalThis.performance = stubs.get('performance');
globalThis.document = stubs.get('document');
globalThis.window = stubs.get('window');
void register;
void pathToFileURL;

const modules = [
  '../src/core/util.js',
  '../src/core/geom.js',
  '../src/core/mat4.js',
  '../src/core/emitter.js',
  '../src/core/camera.js',
  '../src/core/history.js',
  '../src/model/schema.js',
  '../src/model/geo.js',
  '../src/model/world.js',
  '../src/model/network.js',
  '../src/model/paint.js',
  '../src/snap.js',
  '../src/render/theme.js',
  '../src/render/sprites.js',
  '../src/render/scene3d.js',
  '../src/render/camera3d.js',
  '../src/render/renderer3d.js',
];

let failed = 0;
for (const rel of modules) {
  const url = new URL(rel, import.meta.url);
  try {
    const mod = await import(url.href);
    console.log(`ok   ${rel}  (${Object.keys(mod).length} exports)`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${rel}\n     ${err.message.split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} module(s) failed` : '\nAll modules import cleanly');
process.exit(failed ? 1 : 0);
