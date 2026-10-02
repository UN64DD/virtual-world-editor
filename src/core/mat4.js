export function mat4Identity(out = new Float64Array(16)) {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Multiply(a, b, out = new Float64Array(16)) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function mat4Perspective(fovY, aspect, near, far, out = new Float64Array(16)) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4LookAt(eye, target, up, out = new Float64Array(16)) {
  let zx = eye.x - target.x;
  let zy = eye.y - target.y;
  let zz = eye.z - target.z;
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-9) {
    xx = 1;
    xy = 0;
    xz = 0;
  } else {
    xx /= l;
    xy /= l;
    xz /= l;
  }
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}

export function mat4ViewFromAxes(eye, right, up, back, out = new Float64Array(16)) {
  out[0] = right.x;
  out[4] = right.y;
  out[8] = right.z;
  out[3] = 0;
  out[1] = up.x;
  out[5] = up.y;
  out[9] = up.z;
  out[7] = 0;
  out[2] = back.x;
  out[6] = back.y;
  out[10] = back.z;
  out[11] = 0;
  out[12] = -(right.x * eye.x + right.y * eye.y + right.z * eye.z);
  out[13] = -(up.x * eye.x + up.y * eye.y + up.z * eye.z);
  out[14] = -(back.x * eye.x + back.y * eye.y + back.z * eye.z);
  out[15] = 1;
  return out;
}

export function transformPoint(m, x, y, z) {  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
    w: m[3] * x + m[7] * y + m[11] * z + m[15],
  };
}

export function transformDir(m, x, y, z) {
  return {
    x: m[0] * x + m[4] * y + m[8] * z,
    y: m[1] * x + m[5] * y + m[9] * z,
    z: m[2] * x + m[6] * y + m[10] * z,
  };
}

export function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function rotateY(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function rotateZ(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}
