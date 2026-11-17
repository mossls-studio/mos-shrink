// tools/refcheck.js — JS 参考实现 vs wasm 逐像素对比
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- reference implementation of the intended math ----
function bezSolve(x1, y1, x2, y2, u) {
  let t = u;
  for (let i = 0; i < 12; i++) {
    const om = 1 - t, t2 = t * t;
    const xx = 3 * om * om * t * x1 + 3 * om * t2 * x2 + t2 * t;
    const dd = 3 * om * om * x1 + 6 * om * t * (x2 - x1) + 3 * t2 * (1 - x2);
    if (Math.abs(dd) < 1e-9) break;
    let nt = t - (xx - u) / dd;
    nt = Math.min(1, Math.max(0, nt));
    t = nt;
  }
  const om = 1 - t, t2 = t * t;
  return 3 * om * om * t * y1 + 3 * om * t2 * y2 + t2 * t;
}
function buildLut(x1, y1, x2, y2) {
  const lut = new Float64Array(1025);
  for (let i = 0; i <= 1024; i++) lut[i] = bezSolve(x1, y1, x2, y2, i / 1024);
  return lut;
}
function wrapIdx(i, n, m) {
  if (i >= 0 && i < n) return i;
  if (m === 0) return i < 0 ? 0 : n - 1;
  if (m === 1) return ((i % n) + n) % n;
  const p = 2 * n;
  const r = ((i % p) + p) % p;
  if (r < n) return r;
  return p - 1 - r;
}
function bcw(t, k) {
  if (k === 0) return (-0.5 * t + 1) * t * t - 0.5 * t;
  if (k === 1) return (1.5 * t - 2.5) * t * t + 1;
  if (k === 2) return (-1.5 * t + 2) * t * t + 0.5 * t;
  return (0.5 * t - 0.5) * t * t;
}
// ---- v1.1 math: radial density C(t) + pinned scale ----
function buildAtable(amount, x1, y1, x2, y2) {
  const N = 1025, At = new Float64Array(N);
  for (let i = 0; i < N; i++) At[i] = 1 + amount * bezSolve(x1, y1, x2, y2, i / 1024);
  return At;
}
function atLut(At, z) {
  let u = z * 1024;
  u = u < 0 ? 0 : u > 1024 ? 1024 : u;
  let i = Math.floor(u);
  if (i > 1023) i = 1023;
  return At[i] + (At[i + 1] - At[i]) * (u - i);
}

function reference(src, W, H, P) {
  const out = new Float32Array(src.length);
  const amount = Math.min(0.95, Math.max(-0.9, P.amount / 100));
  const w1 = W - 1, h1 = H - 1;
  const ax = Math.min(w1, Math.max(0, P.anchor[0]));
  const ay = Math.min(h1, Math.max(0, P.anchor[1]));
  const rad = Math.max(0.5, (P.radius / 100) * Math.min(W, H));
  const mixv = Math.min(1, Math.max(0, P.mix / 100));
  const emode = P.edge_mode | 0, samp = P.sampling | 0, fix = P.edge_fix | 0;
  const At = buildAtable(amount, P.curve_x1, P.curve_y1, P.curve_x2, P.curve_y2);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const acc = (o, ix, iy, wg) => {
    if (emode === 3 && (ix < 0 || ix >= W || iy < 0 || iy >= H)) return;
    const x = wrapIdx(ix, W, emode), y = wrapIdx(iy, H, emode);
    const a = (y * W + x) * 4;
    o[0] += wg * src[a]; o[1] += wg * src[a + 1]; o[2] += wg * src[a + 2]; o[3] += wg * src[a + 3];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const off = (y * W + x) * 4;
      const dx = x - ax, dy = y - ay;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) {
        out[off] = src[off]; out[off + 1] = src[off + 1]; out[off + 2] = src[off + 2]; out[off + 3] = src[off + 3];
        continue;
      }
      // 椭圆归一化鱼眼：e = sqrt((dx/rx)^2 + (dy/ry)^2)，A = 1 + amount*bez(1 - e)
      // rx/ry = 锚点到该侧边框的距离（模式0）或半径（模式1），都被「半径」截断
      let rx, ry;
      if (fix === 0) {
        rx = Math.min(dx >= 0 ? w1 - ax : ax, rad);
        ry = Math.min(dy >= 0 ? h1 - ay : ay, rad);
      } else {
        rx = rad; ry = rad;
      }
      rx = Math.max(1e-6, rx); ry = Math.max(1e-6, ry);
      const a = Math.abs(dx / rx), b = Math.abs(dy / ry);
      const e8 = Math.pow(Math.pow(a, 8) + Math.pow(b, 8), 1 / 8);
      const em = Math.max(a, b);
      let wq = (em - 0.72) / 0.28; wq = Math.max(0, Math.min(1, wq)); wq = wq * wq * (3 - 2 * wq);
      const e = e8 * (1 - wq) + em * wq;
      let kx = atLut(At, 1 - e);
      if (Math.abs(kx - 1) < 1e-7) {
        out[off] = src[off]; out[off + 1] = src[off + 1]; out[off + 2] = src[off + 2]; out[off + 3] = src[off + 3];
        continue;
      }
      kx = Math.min(60, Math.max(0.01, kx));
      const sx = ax + dx * kx, sy = ay + dy * kx;
      const o = [0, 0, 0, 0];
      if (samp === 2) {
        acc(o, Math.trunc(Math.floor(sx + 0.5)), Math.trunc(Math.floor(sy + 0.5)), 1);
      } else if (samp === 0) {
        const fx = Math.floor(sx), fy = Math.floor(sy);
        const tx = sx - fx, ty = sy - fy;
        acc(o, fx, fy, (1 - tx) * (1 - ty));
        acc(o, fx + 1, fy, tx * (1 - ty));
        acc(o, fx, fy + 1, (1 - tx) * ty);
        acc(o, fx + 1, fy + 1, tx * ty);
      } else {
        const fx = Math.floor(sx), fy = Math.floor(sy);
        const tx = sx - fx, ty = sy - fy;
        const wx = [bcw(tx, 0), bcw(tx, 1), bcw(tx, 2), bcw(tx, 3)];
        const wy = [bcw(ty, 0), bcw(ty, 1), bcw(ty, 2), bcw(ty, 3)];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) acc(o, fx - 1 + i, fy - 1 + j, wx[i] * wy[j]);
      }
      for (let c = 0; c < 4; c++) out[off + c] = src[off + c] + (o[c] - src[off + c]) * mixv;
    }
  }
  return out;
}

// ---- compare with wasm ----
function makeImg(W, H, seed = 7) {
  const px = new Float32Array(W * H * 4);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const a = (x > W / 3 && y > H / 3) ? 1 : 0.35;
    px[i * 4] = ((x / W) * 0.8 + rnd() * 0.2) * a;
    px[i * 4 + 1] = ((y / H) * 0.8 + rnd() * 0.2) * a;
    px[i * 4 + 2] = rnd() * a;
    px[i * 4 + 3] = a;
  }
  return px;
}

(async () => {
  const bytes = fs.readFileSync(path.join(ROOT, 'dist', 'mos_收缩', 'mos_shrink.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const manifest = JSON.parse(Buffer.from(new Uint8Array(ex.memory.buffer).slice(ex.ec_manifest_ptr(), ex.ec_manifest_ptr() + ex.ec_manifest_len())).toString('utf8'));
  const order = [];
  for (const p of manifest.params) order.push(p.type === 'point' ? [p.id, 2] : [p.id, 1]);
  const nf = order.reduce((a, b) => a + b[1], 0);

  const W = 64, H = 48;
  const cases = [
    { amount: 40, anchor: [32, 24], radius: 100, curve_x1: 0.33, curve_y1: 0, curve_x2: 0.67, curve_y2: 1, edge_fix: 0, sampling: 0, edge_mode: 0, mix: 100 },
    { amount: 70, anchor: [20, 14], radius: 70, curve_x1: 0.2, curve_y1: 0.9, curve_x2: 0.5, curve_y2: 1, edge_fix: 1, sampling: 1, edge_mode: 1, mix: 85 },
    { amount: -50, anchor: [40, 30], radius: 130, curve_x1: 0.33, curve_y1: 0, curve_x2: 0.67, curve_y2: 1, edge_fix: 0, sampling: 2, edge_mode: 2, mix: 100 },
    { amount: 90, anchor: [8, 8], radius: 400, curve_x1: 0, curve_y1: 0, curve_x2: 1, curve_y2: 1, edge_fix: 1, sampling: 1, edge_mode: 3, mix: 100 },
  ];

  const src = makeImg(W, H);
  for (const [ci, P] of cases.entries()) {
    const flat = [];
    for (const [id, n] of order) {
      if (n === 2) flat.push(P[id][0], P[id][1]); else flat.push(P[id]);
    }
    const nbytes = W * H * 16;
    const base = ex.ec_alloc(nf * 8 + nbytes);
    const dv = new DataView(ex.memory.buffer);
    flat.forEach((v, i) => dv.setFloat64(base + i * 8, v, true));
    const pbase = base + nf * 8;
    new Float32Array(ex.memory.buffer, pbase, W * H * 4).set(src);
    const rc = ex.ec_render(pbase, W, H, base, nf, 0, 1);
    if (rc !== 0) throw new Error('rc=' + rc);
    const got = new Float32Array(ex.memory.buffer, pbase, W * H * 4).slice();
    const want = reference(src, W, H, P);
    let maxd = 0, at = -1;
    for (let i = 0; i < got.length; i++) {
      const d = Math.abs(got[i] - want[i]);
      if (d > maxd) { maxd = d; at = i; }
    }
    console.log(`case ${ci}: maxdiff=${maxd.toExponential(2)} at pixel ${(at / 4) | 0} ch${at % 4}  got=${got[at]} want=${want[at]}`);
    const nanG = Array.from(got).filter(Number.isNaN).length;
    const nanW = Array.from(want).filter(Number.isNaN).length;
    if (nanG || nanW || maxd === 0) {
      console.log('   nan got=' + nanG + ' want=' + nanW + ' len=' + got.length + '/' + want.length);
      console.log('   got0 ' + Array.from(got.slice(0, 8)).map((v) => (+v).toFixed(4)).join(','));
      console.log('   want0 ' + Array.from(want.slice(0, 8)).map((v) => (+v).toFixed(4)).join(','));
    }
    if (maxd > 1e-4) {
      const px = (at / 4) | 0;
      console.log(`   pixel (${px % W},${(px / W) | 0})`);
      break;
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
