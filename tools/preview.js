// tools/preview.js — 用 JS 参考实现快速对比边缘处理方案（不重新编译 wasm）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crcTable() { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; }
const TAB = crcTable();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function writePNG(f, w, h, d) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (stride + 1)] = 0, Buffer.from(d.buffer, d.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(f, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function bezSolve(x1, y1, x2, y2, u) {
  let t = u;
  for (let i = 0; i < 12; i++) {
    const om = 1 - t, t2 = t * t;
    const xx = 3 * om * om * t * x1 + 3 * om * t2 * x2 + t2 * t;
    const dd = 3 * om * om * x1 + 6 * om * t * (x2 - x1) + 3 * t2 * (1 - x2);
    if (Math.abs(dd) < 1e-9) break;
    t = Math.min(1, Math.max(0, t - (xx - u) / dd));
  }
  const om = 1 - t, t2 = t * t;
  return 3 * om * om * t * y1 + 3 * om * t2 * y2 + t2 * t;
}

function makeImage(W, H) {
  const px = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const chk = ((x >> 4) + (y >> 4)) & 1;
    let r = chk ? 0.16 : 0.10, g = chk ? 0.17 : 0.11, b = chk ? 0.22 : 0.14;
    if (x % 16 === 0 || y % 16 === 0) { r += 0.10; g += 0.10; b += 0.10; }
    r += 0.25 * (x / W); g += 0.20 * (y / H);
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (e < 3) { const i = (y * W + x) * 4; px[i] = 0.95; px[i + 1] = 0.45; px[i + 2] = 0.10; px[i + 3] = 1; }
  }
  return px;
}

function wrapIdx(i, n, m) {
  if (i >= 0 && i < n) return i;
  if (m === 0) return i < 0 ? 0 : n - 1;
  if (m === 1) return ((i % n) + n) % n;
  const p = 2 * n, r = ((i % p) + p) % p;
  return r < n ? r : p - 1 - r;
}
function bcw(t, k) {
  if (k === 0) return (-0.5 * t + 1) * t * t - 0.5 * t;
  if (k === 1) return (1.5 * t - 2.5) * t * t + 1;
  if (k === 2) return (-1.5 * t + 2) * t * t + 0.5 * t;
  return (0.5 * t - 0.5) * t * t;
}

// override: {overshoot: 像素数} — 采样越界后按越界量淡出效果
function render(src, W, H, P, override = {}) {
  const lut = new Float64Array(1025);
  for (let i = 0; i <= 1024; i++) lut[i] = bezSolve(P.c1x, P.c1y, P.c2x, P.c2y, i / 1024);
  const out = new Float32Array(src.length);
  const amount = Math.min(0.95, Math.max(-0.9, P.amount / 100));
  const ax = P.anchor[0], ay = P.anchor[1];
  const dmin = Math.min(W, H);
  const rad = Math.max(0.5, (P.radius / 100) * dmin);
  const band = Math.max(0.5, (P.edge_width / 100) * dmin);
  const pin = P.edge_pin / 100;
  const emode = P.edge_mode | 0, samp = P.sampling | 0, mixv = 1;
  const acc = (o, ix, iy, wg) => {
    if (emode === 3 && (ix < 0 || ix >= W || iy < 0 || iy >= H)) return;
    const x = wrapIdx(ix, W, emode), y = wrapIdx(iy, H, emode), a = (y * W + x) * 4;
    o[0] += wg * src[a]; o[1] += wg * src[a + 1]; o[2] += wg * src[a + 2]; o[3] += wg * src[a + 3];
  };
  const o = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - ax, dy = y - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let q = Math.min(1, Math.max(0, 1 - dist / rad));
    const f = lut[Math.round(q * 1024)];
    const em = Math.min(x, W - 1 - x, y, H - 1 - y);
    let t = Math.min(1, em / band);
    t = t * t * (3 - 2 * t);
    const mask = 1 - pin * (1 - t);
    const k = amount * f * mask;
    const s = 1 / (1 - k);
    const sx = ax + dx * s, sy = ay + dy * s;
    const off = (y * W + x) * 4;
    let fade = 1;
    if (override.overshoot) {
      const ox = Math.max(0, -sx, sx - (W - 1)), oy = Math.max(0, -sy, sy - (H - 1));
      const ov = Math.max(ox, oy);
      const u = Math.min(1, ov / override.overshoot);
      fade = 1 - u * u * (3 - 2 * u);
    }
    const wf = mixv * mask * fade;
    if (Math.abs(k) < 1e-6 || wf < 1e-6) { out[off] = src[off]; out[off + 1] = src[off + 1]; out[off + 2] = src[off + 2]; out[off + 3] = src[off + 3]; continue; }
    o[0] = o[1] = o[2] = o[3] = 0;
    if (samp === 2) acc(o, Math.floor(sx + 0.5), Math.floor(sy + 0.5), 1);
    else if (samp === 0) {
      const fx = Math.floor(sx), fy = Math.floor(sy), tx = sx - fx, ty = sy - fy;
      acc(o, fx, fy, (1 - tx) * (1 - ty)); acc(o, fx + 1, fy, tx * (1 - ty));
      acc(o, fx, fy + 1, (1 - tx) * ty); acc(o, fx + 1, fy + 1, tx * ty);
    } else {
      const fx = Math.floor(sx), fy = Math.floor(sy), tx = sx - fx, ty = sy - fy;
      const wx = [bcw(tx, 0), bcw(tx, 1), bcw(tx, 2), bcw(tx, 3)];
      const wy = [bcw(ty, 0), bcw(ty, 1), bcw(ty, 2), bcw(ty, 3)];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) acc(o, fx - 1 + i, fy - 1 + j, wx[i] * wy[j]);
    }
    for (let c = 0; c < 4; c++) out[off + c] = src[off + c] + (o[c] - src[off + c]) * wf;
  }
  return out;
}

function toPNG(file, w, h, f) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i++) { const v = f[i]; d[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
  writePNG(file, w, h, d);
}

const OUT = path.join(__dirname, '..', 'build', 'out');
fs.mkdirSync(OUT, { recursive: true });
const W = 320, H = 180;
const src = makeImage(W, H);
toPNG(path.join(OUT, 'p_src.png'), W, H, src);

const base = { amount: 40, anchor: [W / 2, H / 2], radius: 100, c1x: 0.33, c1y: 0, c2x: 0.67, c2y: 1, edge_pin: 100, edge_width: 15, sampling: 0, edge_mode: 0, mix: 100 };
const combos = [
  ['v0_mask_r100_b15', base, {}],
  ['v1_fade6_r100_b15', base, { overshoot: 6 }],
  ['v2_mask_r70_b20', { ...base, radius: 70, edge_width: 20 }, {}],
  ['v3_fade6_r70_b20', { ...base, radius: 70, edge_width: 20 }, { overshoot: 6 }],
  ['v4_band30_r100', { ...base, edge_width: 30 }, {}],
  ['v5_band40_r100', { ...base, edge_width: 40 }, {}],
  ['v6_band25_r80', { ...base, radius: 80, edge_width: 25 }, {}],
];
for (const [name, P, ov] of combos) {
  const t0 = Date.now();
  const out = render(src, W, H, P, ov);
  toPNG(path.join(OUT, name + '.png'), W, H, out);
  console.log(name, Date.now() - t0, 'ms');
}

