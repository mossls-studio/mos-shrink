// Render the fisheye with different bezier falloff curves, to show how much the border band moves.
const fs = require('fs');
const zlib = require('zlib');
const W = 320, H = 180;

function crcTable() { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; }
const CRCT = crcTable();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const src = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let r = 0.055, g = 0.060, b = 0.078;
  const n = 26.5, gx = Math.abs((x % n) - n / 2), gy = Math.abs((y % n) - n / 2);
  if (gx > n / 2 - 0.9 || gy > n / 2 - 0.9) { r = g = b = 0.72; }
  if (x < 3 || y < 3 || x > W - 4 || y > H - 4) { r = 0.95; g = 0.45; b = 0.10; }
  const o = (y * W + x) * 4; src[o] = r * 255; src[o + 1] = g * 255; src[o + 2] = b * 255; src[o + 3] = 255;
}
function px(x, y, c) {
  x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const f = (xx, yy) => src[(yy * W + xx) * 4 + c] / 255;
  return (f(x0, y0) * (1 - fx) + f(x1, y0) * fx) * (1 - fy) + (f(x0, y1) * (1 - fx) + f(x1, y1) * fx) * fy;
}

const AX = (W - 1) / 2, AY = (H - 1) / 2, AMT = 0.7, RX = Math.min(AX, W - 1 - AX), RY = Math.min(AY, H - 1 - AY);

function bezY(u, x1, y1, x2, y2) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2, mt = 1 - t;
    const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    if (x < u) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2, mt = 1 - t;
  return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

function render(curve, out) {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - AX, dy = y - AY;
    const a = Math.min(Math.abs(dx) / RX, 1), b = Math.min(Math.abs(dy) / RY, 1);
    const e = Math.pow(Math.pow(a, 8) + Math.pow(b, 8), 1 / 8);
    const u = Math.max(0, Math.min(1, 1 - e));
    const A = 1 + AMT * bezY(u, curve[0], curve[1], curve[2], curve[3]);
    const sx = AX + dx * A, sy = AY + dy * A;
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) buf[o + c] = Math.round(Math.max(0, Math.min(1, px(sx, sy, c))) * 255);
    buf[o + 3] = 255;
  }
  writePNG(out, W, H, buf);
  console.log('wrote', out, JSON.stringify(curve));
}

render([0, 0, 1, 1], 'build/out/cv_linear.png');
render([0.15, 0.6, 0.6, 1], 'build/out/cv_strong.png');
render([0.3, 0.9, 0.75, 1], 'build/out/cv_very.png');
