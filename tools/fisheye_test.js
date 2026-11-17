// Compare three classic radial fisheye formulas against AE 扭曲▸变形▸白点(弯曲 -100).
const fs = require('fs');
const zlib = require('zlib');
const W = 320, H = 180;

function crcTable() { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; }
const CRCT = crcTable();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function writePNG(f, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(f, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const src = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let r = 0.03, g = 0.03, b = 0.03;
  const n = 40, gx = Math.abs((x % n) - n / 2), gy = Math.abs((y % n) - n / 2);
  if (gx > n / 2 - 1.0 || gy > n / 2 - 1.0) { r = g = b = 0.85; }
  const o = (y * W + x) * 4; src[o] = r * 255; src[o + 1] = g * 255; src[o + 2] = b * 255; src[o + 3] = 255;
}
function sample(x, y, c) {
  x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const f = (xx, yy) => src[(yy * W + xx) * 4 + c] / 255;
  return (f(x0, y0) * (1 - fx) + f(x1, y0) * fx) * (1 - fy) + (f(x0, y1) * (1 - fx) + f(x1, y1) * fx) * fy;
}

const AX = (W - 1) / 2, AY = (H - 1) / 2;
const R = Math.hypot(AX, AY);           // 覆盖到四角

function render(name, mapR) {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - AX, dy = y - AY, r = Math.hypot(dx, dy);
    const r2 = mapR(r);
    const s = r < 1e-6 ? 1 : r2 / r;
    const sx = AX + dx * s, sy = AY + dy * s;
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) buf[o + c] = Math.round(Math.max(0, Math.min(1, sample(sx, sy, c))) * 255);
    buf[o + 3] = 255;
  }
  writePNG('build/out/' + name, W, H, buf);
  console.log('wrote', name);
}

// 弯曲 = -100 → 负向（收缩/枕形）
const K = 1.0;
// F1: 二次衰减缩放  r' = r * (1 + k*(1-(r/R)^2))   k<0 = 内缩
render('fy1.png', r => { const t = Math.min(r / R, 1); return r * (1 - K * (1 - t * t)); });
// F2: 幂律  r' = R * (r/R)^(1+k)
render('fy2.png', r => { const t = Math.min(r / R, 1); return R * Math.pow(t, 1 + K); });
// F3: 球面  r' = R * sin(pi/2 * (r/R)) / sin(pi/2)  (1+k 强度)
render('fy3.png', r => { const t = Math.min(r / R, 1); const a = Math.PI / 2 * (1 + K); return R * Math.sin(t * a) / Math.sin(a); });
