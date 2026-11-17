// tools/preview2.js — 候选映射对比（同一张线稿源图）
// A 纯线性缩放 + 边缘拉伸填充 / B 当前插件算法（积分归一化） / C 线性衰减（边线钉住） / D 线性衰减+半径
// 用法: node tools/preview2.js [amount 0..0.9]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'out');

function crcTable() { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; }
const CRCT = crcTable();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function writePNG(file, W, H, rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const W = 320, H = 180;
function makeSource() {
  const f = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r = 0.075, g = 0.08, b = 0.09;
    if (x % 24 === 0 || y % 24 === 0) { r = 0.5; g = 0.54; b = 0.6; }
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edge <= 1) { r = 0.95; g = 0.45; b = 0.10; }
    f[i] = r; f[i + 1] = g; f[i + 2] = b; f[i + 3] = 1;
  }
  return f;
}
const SRC = makeSource();

function sample(fx, fy) {
  const x = Math.min(W - 1, Math.max(0, fx)), y = Math.min(H - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const o = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = SRC[(y0 * W + x0) * 4 + c], bb = SRC[(y0 * W + x1) * 4 + c];
    const d = SRC[(y1 * W + x0) * 4 + c], e = SRC[(y1 * W + x1) * 4 + c];
    o[c] = (a * (1 - tx) + bb * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
  return o;
}

const ax = (W - 1) / 2, ay = (H - 1) / 2;
function rayNorm(x, y) {
  const dx = x - ax, dy = y - ay;
  const txn = dx === 0 ? 1e9 : (dx > 0 ? (W - 1 - ax) / dx : -ax / dx);
  const tyn = dy === 0 ? 1e9 : (dy > 0 ? (H - 1 - ay) / dy : -ay / dy);
  return Math.max(1e-9, Math.min(Math.abs(txn), Math.abs(tyn)));
}

function variant(name, amount, radFrac) {
  const s = 1 / (1 - amount);
  const rad = radFrac * Math.min(W, H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - ax, dy = y - ay, dist = Math.hypot(dx, dy);
    const lmin = rayNorm(x, y);
    const L = dist * lmin;
    const t = L > 0 ? Math.min(1, dist / L) : 1;
    let f;
    if (name === 'A') f = s;
    else if (name === 'C') f = 1 + (s - 1) * (1 - t);
    else f = 1 + (s - 1) * (1 - t) * Math.min(1, dist / rad);
    const c = sample(ax + dx * f, ay + dy * f);
    const i = (y * W + x) * 4;
    out[i] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
    out[i + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
    out[i + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
    out[i + 3] = 255;
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srcBuf = Buffer.from(SRC.buffer, 0, W * H * 4);
  writePNG(path.join(OUT, 'pv_src.png'), W, H, new Uint8Array(srcBuf));
  const amount = Number(process.argv[2] || 0.5);

  for (const v of ['A', 'C']) writePNG(path.join(OUT, `pv_${v}.png`), W, H, variant(v, amount, 1.0));

  // B = 当前插件（真实 wasm，11 参数）
  const bytes = fs.readFileSync(path.join(ROOT, 'dist', 'mos_收缩', 'mos_shrink.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const manifest = JSON.parse(Buffer.from(new Uint8Array(ex.memory.buffer).slice(ex.ec_manifest_ptr(), ex.ec_manifest_ptr() + ex.ec_manifest_len())).toString('utf8'));
  const vals = { amount: amount * 100, anchor: [0.5, 0.5], radius: 100, curve_x1: Number(process.env.CX||0.33), curve_y1: Number(process.env.CY||0), curve_x2: Number(process.env.CX2||0.67), curve_y2: Number(process.env.CY2||1), edge_fix: 0, sampling: 0, edge_mode: 0, mix: 100 };
  const flat = [];
  for (const p of manifest.params) {
    if (p.type === 'point') flat.push((vals[p.id] || p.default)[0] * (W - 1), (vals[p.id] || p.default)[1] * (H - 1));
    else flat.push(vals[p.id] !== undefined ? vals[p.id] : p.default);
  }
  const nf = flat.length;
  const base = ex.ec_alloc(nf * 8 + W * H * 16);
  const dv = new DataView(ex.memory.buffer);
  flat.forEach((v, i) => dv.setFloat64(base + i * 8, v, true));
  const fb = new Float32Array(ex.memory.buffer, base + nf * 8, W * H * 4);
  fb.set(SRC);
  const rc = ex.ec_render(base + nf * 8, W, H, base, nf, 0, 1);
  if (rc !== 0) throw new Error('rc=' + rc);
  const res = new Float32Array(ex.memory.buffer, base + nf * 8, W * H * 4).slice();
  const pb = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i++) pb[i] = Math.round(Math.min(1, Math.max(0, res[i])) * 255);
  // 预乘 → 直通（alpha=1，无需反预乘）
  writePNG(path.join(OUT, 'pv_B'+(process.env.CX?('_lin'):'')+'.png'), W, H, pb);
  console.log('wrote pv_src / pv_A / pv_B / pv_C  amount=' + amount);
})().catch((e) => { console.error(e); process.exit(1); });
