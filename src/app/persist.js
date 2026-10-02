import { WORLD_FORMAT, WORLD_VERSION } from '../model/schema.js';
import { World } from '../model/world.js';

const PREFIX = 'vwe:';

export function serialize(world) {
  return JSON.stringify(world.toJSON(), null, 2);
}

export function parseWorld(text, { name } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object') throw new Error('File is not a world object');
  if (data.format !== WORLD_FORMAT) {
    if (!Array.isArray(data.nodes) && !Array.isArray(data.roads)) {
      throw new Error(`Unrecognised format${data.format ? ` "${data.format}"` : ''}`);
    }
  }
  data.format = data.format || WORLD_FORMAT;
  data.version = data.version || WORLD_VERSION;
  if (name) data.meta = { ...(data.meta || {}), name };
  const world = new World(data);
  world.repair();
  return world;
}

export function download(world, filename) {
  const blob = new Blob([serialize(world)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${slug(world.data.meta?.name || 'world')}.vwe.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'world'
  );
}

export function saveToStorage(world) {
  try {
    localStorage.setItem(PREFIX + slug(world.data.meta?.name || 'world'), serialize(world));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(name) {
  try {
    const text = localStorage.getItem(PREFIX + slug(name));
    return text ? parseWorld(text) : null;
  } catch {
    return null;
  }
}

export function listStored() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(PREFIX)) continue;
      const text = localStorage.getItem(key);
      if (!text) continue;
      const data = JSON.parse(text);
      out.push({
        name: data?.meta?.name || key.slice(PREFIX.length),
        modified: data?.meta?.modified || '',
        bytes: text.length,
        key,
      });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
}

export function removeStored(name) {
  try {
    localStorage.removeItem(PREFIX + slug(name));
    return true;
  } catch {
    return false;
  }
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseWorld(String(reader.result), { name: file.name.replace(/\.(vwe\.json|vwe|json)$/i, '') }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsText(file);
  });
}
