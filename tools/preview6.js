// AE 变形 ▸ 白点(鱼眼) 风格的径向映射：A(r) = 1 + k*bez(1 - r/R)，边框处 A=1（钉死），无重归一化。
// 用法: node tools\preview6.js [k 0..3] [x1 y1 x2 y2]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 320, H = 180;
const OUT = path.join(__dirname, '..', 'build', 'out');
const k = Number(process.argv[2] || 0.8);
const CV = (process.argv[3] ? process.argv.slice(3).map(Number) : [0.33, 0, 0.67, 1]);
while (CV.length < 4) CV.push([0.33, 0, 0.67, 1][CV.length]);

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function makeSource() {
  const px = Buffer.alloc(W * H * 4);
  const set = (x, y, r, g, b) => { const o = (y * W + x) * 4; px[o] = Math.round(r * 255); px[o + 1] = Math.round(g * 255); px[o + 2] = Math.round(b * 255); px[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 0, 0, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x % 20 === 0 || y % 20 === 0) set(x, y, 0.92, 0.92, 0.92);
  for (let x = 0; x < W; x++) { set(x, 0, 1, 0.55, 0.15); set(x, H - 1, 1, 0.55, 0.15); }
  for (let y = 0; y < H; y++) { set(0, y, 1, 0.55, 0.15); set(W - 1, y, 1, 0.55, 0.15); }
  return px;
}
const SRC = makeSource();

/* 贝塞尔 y(q)：与 wasm 里同一套牛顿迭代 */
function bezY(q) {
  const x1 = CV[0], y1 = CV[1], x2 = CV[2], y2 = CV[3];
  let lo = 0, hi = 1, t = q;
  for (let i = 0; i < 12; i++) {
    const mt = 1 - t;
    const bx = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    const d = bx - q;
    if (Math.abs(d) < 1e-9) break;
    if (d > 0) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  const mt = 1 - t;
  return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

/* LUT：A 随 u=1-r/R 变化 */
const NL = 1025;
const LUT = new Float32Array(NL);
for (let i = 0; i < NL; i++) LUT[i] = 1 + k * bezY(i / (NL - 1));
function At(u) {
  const f = Math.max(0, Math.min(1, u)) * (NL - 1);
  const i = Math.floor(f), t = f - i, j = Math.min(NL - 1, i + 1);
  return LUT[i] + (LUT[j] - LUT[i]) * t;
}

const AX = (W - 1) / 2, AY = (H - 1) / 2;
const RMAX = Math.max(Math.hypot(AX, AY), 1);

function sample(fx, fy) {
  const x = Math.max(0, Math.min(W - 1, fx)), y = Math.max(0, Math.min(H - 1, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = x - x0, ty = y - y0, o = [0, 0, 0], p = (xx, yy) => (yy * W + xx) * 4;
  for (let c = 0; c < 3; c++) {
    const a = SRC[p(x0, y0) + c] * (1 - tx) + SRC[p(x1, y0) + c] * tx;
    const b = SRC[p(x0, y1) + c] * (1 - tx) + SRC[p(x1, y1) + c] * tx;
    o[c] = a * (1 - ty) + b * ty;
  }
  return o;
}

/* 边框射线距离（和 wasm 里一致：min 到四条边的比例 lmin 使 dist*lmin = 到边框距离） */
function rayL(dx, dy) {
  const tx = dx > 1e-9 ? AX / dx : (dx < -1e-9 ? -(W - 1 - AX) / dx : 1e9);
  const ty = dy > 1e-9 ? AY / dy : (dy < -1e-9 ? -(H - 1 - AY) / dy : 1e9);
  return Math.min(tx, ty);
}

function render() {
  const px = Buffer.alloc(W * H * 4);
  let maxFold = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - AX, dy = y - AY;
    const dist = Math.hypot(dx, dy);
    const lmin = rayL(dx, dy);
    const R = Math.min(dist * lmin, RMAX * 1.1);       // 到边框的距离（射线方向）
    const u = 1 - (R > 1e-9 ? Math.min(1, dist / R) : 1);
    const A = At(u);
    const sx = AX + dx * A, sy = AY + dy * A;
    const c = sample(sx, sy);
    const o = (y * W + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    // 单调性检查：dr/dsrc 沿射线
    const d = dist < 1e-6 ? 1 : (dist * A) / Math.max(dist, 1e-6);
    if (d < maxFold) maxFold = d;
  }
  return px;
}

writePNG(path.join(OUT, 'r6_src.png'), W, H, SRC);
writePNG(path.join(OUT, 'r6_warp.png'), W, H, render());
console.log('wrote r6_src / r6_warp  k=' + k + ' curve=' + CV.join(','));
