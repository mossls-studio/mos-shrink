// tools/png_crop.js — 裁剪 + 最近邻放大 PNG（仅用于目视检查渲染结果）
const fs = require('fs');
const zlib = require('zlib');

function crcTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
}
const TAB = crcTable();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function readPNG(f) {
  const b = fs.readFileSync(f);
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f0 = raw[y * (stride + 1)];
    if (f0 !== 0) throw new Error('png filter ' + f0 + ' unsupported');
    raw.copy(out, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { w, h, data: out };
}
function writePNG(f, w, h, d) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(d.buffer, d.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(f, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const [, , inp, xs, ys, ws, hs, ss, outp] = process.argv;
const src = readPNG(inp);
const x0 = +xs, y0 = +ys, ww = +ws, hh = +hs, sc = +ss || 1;
const out = new Uint8Array(ww * sc * hh * sc * 4);
for (let y = 0; y < hh * sc; y++) {
  for (let x = 0; x < ww * sc; x++) {
    const sx = Math.min(src.w - 1, x0 + Math.floor(x / sc));
    const sy = Math.min(src.h - 1, y0 + Math.floor(y / sc));
    const si = (sy * src.w + sx) * 4, di = (y * ww * sc + x) * 4;
    for (let c = 0; c < 4; c++) out[di + c] = src.data[si + c];
  }
}
writePNG(outp || 'out.png', ww * sc, hh * sc, out);
console.log('wrote', outp, ww * sc + 'x' + hh * sc);
