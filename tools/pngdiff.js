// Decode two PNGs and report the mean/max abs difference inside a region.
// usage: node tools/pngdiff.js a.png b.png x y w h
const fs = require('fs');
const zlib = require('zlib');

function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('only 8-bit PNG supported');
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : -1;
  if (ch < 0) throw new Error('unsupported color type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const bb = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { w, h, ch, data: out };
}

const [, , fa, fb, xs, ys, ws, hs] = process.argv;
const A = decode(fa), B = decode(fb);
if (A.w !== B.w || A.h !== B.h) throw new Error('size mismatch');
const x0 = parseInt(xs || '0'), y0 = parseInt(ys || '0');
const w = parseInt(ws || String(A.w)), h = parseInt(hs || String(A.h));
let sum = 0, mx = 0, n = 0;
for (let y = y0; y < Math.min(A.h, y0 + h); y++) {
  for (let x = x0; x < Math.min(A.w, x0 + w); x++) {
    for (let c = 0; c < Math.min(3, A.ch); c++) {
      const i = (y * A.w + x) * A.ch + c;
      const d = Math.abs(A.data[i] - B.data[i]);
      sum += d; if (d > mx) mx = d; n++;
    }
  }
}
console.log('region ' + w + 'x' + h + ' @' + x0 + ',' + y0);
console.log('mean |Δ| = ' + (sum / n).toFixed(3) + '   max |Δ| = ' + mx);
console.log('mean as % of 255: ' + ((sum / n) / 255 * 100).toFixed(2) + '%');
