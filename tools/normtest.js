// Compare normalization norms for the fisheye: p=8 superellipse (current), p=16, and the
// smooth "fuzzy union" e = a + b - a*b (no dead corners, C-infinity).
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

function renderNorm(norm, out) {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - AX, dy = y - AY;
    const a = Math.min(Math.abs(dx) / RX, 1), b = Math.min(Math.abs(dy) / RY, 1);
    const e = norm(a, b);
    const A = 1 + AMT * Math.max(0, Math.min(1, 1 - e));
    const sx = AX + dx * A, sy = AY + dy * A;
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = px(sx, sy, c);
      // premultiplied but alpha is 1 everywhere so no unpremultiply needed
      buf[o + c] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
    buf[o + 3] = 255;
  }
  writePNG(out, W, H, buf);
  console.log('wrote', out);
}

renderNorm((a, b) => Math.pow(Math.pow(a, 8) + Math.pow(b, 8), 1 / 8), 'build/out/norm_p8.png');
renderNorm((a, b) => Math.pow(Math.pow(a, 16) + Math.pow(b, 16), 1 / 16), 'build/out/norm_p16.png');
renderNorm((a, b) => a + b - a * b, 'build/out/norm_union.png');
renderNorm((a, b) => Math.max(a, b), 'build/out/norm_max.png');
renderNorm((a, b) => { const s = 0.25; return 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + s * s)) + 0.5 - 0.5 * Math.sqrt(1 + s * s); }, 'build/out/norm_smax.png');
renderNorm((a, b) => {
  const e8 = Math.pow(Math.pow(a, 8) + Math.pow(b, 8), 1 / 8);
  const em = Math.max(a, b);
  let w = (em - 0.72) / 0.28; w = Math.max(0, Math.min(1, w)); w = w * w * (3 - 2 * w);
  return e8 * (1 - w) + em * w;
}, 'build/out/norm_hybrid.png');
