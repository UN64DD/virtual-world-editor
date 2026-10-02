import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attr, has, runChrome, withServer } from './chrome.mjs';
import { histogram, pixelAt } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`ok   ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SEVERE = [
  /Uncaught/i,
  /TypeError:/,
  /ReferenceError:/,
  /SyntaxError:/,
  /is not a function/,
  /Cannot read propert/,
  /is not iterable/,
  /Failed to load resource/i,
  /net::ERR_/,
  /undefined is not/,
];

function cleanStderr(stderr) {
  return stderr
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        !/^\[[0-9]+:/.test(l.trim()) &&
        !/GPU|Vulkan|dbus|gbm|EGL|Fontconfig|DevTools|voice|tflite|Skia|swiftshader|libva|ContextResult|viz_main|SharedImage|gl_display|Failed to connect|libva error|xdg|sandbox|bluez|UPower|login1|portal|ScreenSaver|Notifications|org\.|GetNameOwner|context_type|extension id|URL:|destination:|path:|interface:|member:|signature:|string "|frame:|@@|^\s*$|bytes written|Histogram:|-O\s|\(\d+ = |byte/i.test(l)
    )
    .join('\n');
}

function parseSelfTest(dom) {
  const m = /<script type="application\/json" id="selftest">([\s\S]*?)<\/script>/.exec(dom);
  if (!m) return null;
  const text = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  try {
    return JSON.parse(text);
  } catch (err) {
    return { parseError: err.message, raw: text.slice(0, 400) };
  }
}

async function run() {
  console.log('# browser checks (headless Chrome)\n');
  let res;
  await withServer(root, async (base) => {
    res = await runChrome(`${base}?selftest=1`, { width: 1440, height: 900 });
  });
  const { dom, stderr, png } = res;

  const boot = (() => {
    const m = /<script type="application\/json" id="bootlog">([\s\S]*?)<\/script>/.exec(dom);
    if (!m) return null;
    try {
      return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    } catch (err) {
      return [`unparseable bootlog: ${err.message}`];
    }
  })();

  console.log('## boot');
  check('page served the app shell', /<canvas id="view"/.test(dom) && /id="toolbar"/.test(dom) && /id="sidebar"/.test(dom));
  check('no fatal start banner', !has(dom, 'id="fatal"'), 'see stderr below');
  check('app reported no runtime errors', attr(dom, 'data-errors') === null, `bootlog: ${JSON.stringify(boot)}`);
  check('world name was bound to the header', /id="world-name"[^>]*value="[^"]+"/.test(dom) || has(dom, 'Demo town'), 'world name');
  check('status bar counted the world', /\d+ roads · \d+ buildings · \d+ objects/.test(dom), 'counts');

  const stderrClean = cleanStderr(stderr);
  const severe = SEVERE.filter((re) => re.test(stderrClean));
  check('no severe console errors', severe.length === 0, severe.join(' | '));
  if (severe.length || has(dom, 'id="fatal"')) {
    console.log(`\n--- stderr ---\n${stderrClean.slice(0, 6000)}\n--- end ---\n`);
  }

  console.log('\n## screenshot');
  check('screenshot captured', !!png, 'no PNG produced');
  if (png) {
    const all = histogram(png);
    check('image is full size', png.width === 1440 && png.height === 900, `${png.width}x${png.height}`);
    check('frame has rich content', all.distinct > 200, `distinct=${all.distinct}`);
    const map = histogram(png, { x: 330, y: 58, w: 1100, h: 780 });
    check('map area is populated', map.distinct > 60, `distinct=${map.distinct}`);
    check('map area is not blank', map.counts.size > 1);
    const mid = pixelAt(png, png.width >> 1, (png.height >> 1) + 40);
    check('map centre is opaque', mid[3] > 0, `rgba=${mid.join(',')}`);
    const panel = histogram(png, { x: 1140, y: 60, w: 300, h: 800 });
    check('sidebar rendered separately from the map', panel.distinct > 5 && panel.distinct < all.distinct, `panel=${panel.distinct} all=${all.distinct}`);
  }

  console.log('\n## in-page self test');
  const st = parseSelfTest(dom);
  check('self-test results were published', !!st && !st.parseError, st?.parseError || st?.raw || 'missing');
  if (st?.results) {
    for (const r of st.results) {
      check(r.name, r.ok, r.ok ? '' : r.detail);
    }
    check(`self-test tally matches (${st.passed}/${st.total})`, st.passed === st.total, `${st.passed}/${st.total}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log(`\nfailures:\n- ${failures.join('\n- ')}`);
  if (res.screenshotPath) console.log(`\nscreenshot: ${res.screenshotPath}`);
  rmSync(res.dir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
