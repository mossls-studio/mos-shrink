// Decode a PNG (RGB/RGBA, 8-bit, filters 0-4) and locate grid line positions along a row.
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const bpp = ch * (bitDepth / 8);
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, ch, data: out };
}

const file = process.argv[2];
const rowFrac = Number(process.argv[3] || 0.5);
const img = decodePNG(file);
const { w, h, ch, data } = img;
console.log('size', w, h, 'ch', ch);
const y = Math.round((h - 1) * rowFrac);
const lum = [];
for (let x = 0; x < w; x++) {
  const o = (y * w + x) * ch;
  lum.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
}
const max = Math.max(...lum);
const thr = max * 0.55;
const runs = [];
let start = -1;
for (let x = 0; x < w; x++) {
  const on = lum[x] >= thr;
  if (on && start < 0) start = x;
  if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
}
if (start >= 0) runs.push([start, w - 1]);
const centers = runs.map(([a, b]) => (a + b) / 2);
console.log('row y=' + y + ' max=' + max.toFixed(0) + ' lines=' + centers.length);
console.log('centers: ' + centers.map(c => c.toFixed(1)).join(' '));
const gaps = [];
for (let i = 1; i < centers.length; i++) gaps.push(+(centers[i] - centers[i - 1]).toFixed(1));
console.log('gaps: ' + gaps.join(' '));
