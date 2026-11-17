// 把若干 PNG（同宽）纵向拼成一张：node tools\png_stack.js out.png a.png b.png ...
const fs = require('fs');
const zlib = require('zlib');

function readPNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    if (f !== 0) throw new Error('filter ' + f + ' not supported');
    row.copy(out, y * stride);
  }
  return { w, h, px: out };
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const [outFile, ...files] = process.argv.slice(2);
const imgs = files.map(readPNG);
const w = Math.max(...imgs.map((i) => i.w));
const gap = 8;
const h = imgs.reduce((s, i) => s + i.h, 0) + gap * (imgs.length - 1);
const out = Buffer.alloc(w * h * 4);
for (let i = 0; i < out.length; i += 4) { out[i] = 24; out[i + 1] = 26; out[i + 2] = 30; out[i + 3] = 255; }
let y0 = 0;
for (const img of imgs) {
  for (let y = 0; y < img.h; y++) img.px.copy(out, ((y0 + y) * w + 0) * 4, y * img.w * 4, (y + 1) * img.w * 4);
  y0 += img.h + gap;
}
writePNG(outFile, w, h, out);
console.log('wrote ' + outFile + ' ' + w + 'x' + h);
