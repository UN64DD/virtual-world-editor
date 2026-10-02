const DEG = Math.PI / 180;

export function metersPerDegreeLat(latDeg) {
  const phi = latDeg * DEG;
  return (
    111132.92 -
    559.82 * Math.cos(2 * phi) +
    1.175 * Math.cos(4 * phi) -
    0.0023 * Math.cos(6 * phi)
  );
}

export function metersPerDegreeLon(latDeg) {
  const phi = latDeg * DEG;
  return 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
}

export function makeOrigin(lat = 0, lon = 0, yawDeg = 0) {
  return {
    lat,
    lon,
    yawDeg,
    mPerLat: metersPerDegreeLat(lat),
    mPerLon: metersPerDegreeLon(lat),
  };
}

export function refreshOrigin(origin) {
  origin.mPerLat = metersPerDegreeLat(origin.lat);
  origin.mPerLon = metersPerDegreeLon(origin.lon);
  return origin;
}

export function project(lat, lon, origin) {
  const o = origin || makeOrigin();
  if (!o.mPerLat) refreshOrigin(o);
  return {
    x: (lon - o.lon) * o.mPerLon,
    y: -(lat - o.lat) * o.mPerLat,
  };
}

export function unproject(x, y, origin) {
  const o = origin || makeOrigin();
  if (!o.mPerLat) refreshOrigin(o);
  return {
    lat: o.lat - y / o.mPerLat,
    lon: o.lon + x / o.mPerLon,
  };
}

export function latLonString(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

export function parseLatLon(text) {
  const m = String(text)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  const ns = (m[2] || '').toUpperCase();
  const ew = (m[4] || '').toUpperCase();
  if (ns === 'S') lat = -Math.abs(lat);
  if (ns === 'N') lat = Math.abs(lat);
  if (ew === 'W') lon = -Math.abs(lon);
  if (ew === 'E') lon = Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function bboxFromWorld(box, origin) {
  const nw = unproject(box.minX, box.minY, origin);
  const se = unproject(box.maxX, box.maxY, origin);
  return {
    south: Math.min(nw.lat, se.lat),
    west: Math.min(nw.lon, se.lon),
    north: Math.max(nw.lat, se.lat),
    east: Math.max(nw.lon, se.lon),
  };
}

export function formatBbox(b) {
  return `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
}
