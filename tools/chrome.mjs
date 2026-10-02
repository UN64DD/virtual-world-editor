import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, listen } from './serve.mjs';
import { decodePng, histogram, pixelAt } from './png.mjs';

const CHROME = process.env.CHROME_BIN || 'google-chrome';

export function runChrome(url, { width = 1440, height = 900, waitMs = 2500, screenshot, extraArgs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vwe-chrome-'));
  const shot = screenshot || join(dir, 'shot.png');
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-running-insecure-content',
    '--enable-logging=stderr',
    '--v=1',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=20000',
    `--user-data-dir=${dir}`,
    ...extraArgs,
  ];
  if (screenshot !== null) args.push(`--screenshot=${shot}`);
  args.push('--dump-dom');
  args.push(url);

  return new Promise((ok) => {
    const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let dom = '';
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 60000);
    proc.stdout.on('data', (c) => (dom += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', () => {
      clearTimeout(timer);
      let png = null;
      try {
        png = decodePng(readFileSync(shot));
      } catch {
        /* no screenshot produced */
      }
      let raw = null;
      try {
        raw = readFileSync(shot);
      } catch {
        /* nothing to clean up */
      }
      if (raw) writeFileSync(shot, raw);
      ok({ dom, stderr: err, png, screenshotPath: png ? shot : null, dir });
    });
  });
}

export async function withServer(root, fn) {
  const server = createStaticServer(root);
  const port = await listen(server);
  try {
    return await fn(`http://127.0.0.1:${port}/`);
  } finally {
    server.close();
  }
}

export function attr(dom, name) {
  const m = new RegExp(`<html[^>]*${name}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
}

export function has(dom, needle) {
  return dom.includes(needle);
}

export { histogram, pixelAt, rmSync };
