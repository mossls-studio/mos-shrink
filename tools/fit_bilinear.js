// Fit test: does  A(u,v) = 1 + k*(1-u²)(1-v²)  reproduce AE's warp-fisheye spacing profile?
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

// source: regular grid, 10 x 6 cells (like the AE screenshots)
const GX = 10, GY = 6;
function srcLum(x, y) {
  // x,y in pixels
  const dx = Math.abs(((x / (W - 1)) * GX) % 1 - 0.5);
  const dy = Math.abs(((y / (H - 1)) * GY) % 1 - 0.5);
  const lw = 0.02;
  return (dx > 0.5 - lw * GX / 10 || dy > 0.5 - lw * GY / 6) ? 0.85 : 0.02;
}

const CX = (W - 1) / 2, CY = (H - 1) / 2;

function render(name, k) {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - CX) / CX, v = (y - CY) / CY;
    const A = 1 + k * (1 - u * u) * (1 - v * v);
    const sx = CX + (x - CX) * A, sy = CY + (y - CY) * A;
    const l = srcLum(Math.max(0, Math.min(W - 1, sx)), Math.max(0, Math.min(H - 1, sy)));
    const o = (y * W + x) * 4;
    const b = Math.round(l * 255);
    buf[o] = b; buf[o + 1] = b; buf[o + 2] = b; buf[o + 3] = 255;
  }
  writePNG('build/out/' + name, W, H, buf);
  console.log('wrote', name, 'k=' + k);
}

render('fit_a.png', 0.5);
render('fit_b.png', -0.5);
