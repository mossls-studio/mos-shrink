// Render the same source with 边缘固定 = 固定 / 不固定, to compare "does the effect reach the border".
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
function makeSource() {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0.055, g = 0.060, b = 0.078, a = 1;
    const n = 26.5;
    const gx = Math.abs(((x % n) - n / 2)), gy = Math.abs(((y % n) - n / 2));
    if (gx > n / 2 - 0.9 || gy > n / 2 - 0.9) { r = g = b = 0.72; }
    if (x < 3 || y < 3 || x > W - 4 || y > H - 4) { r = 0.95; g = 0.45; b = 0.10; }
    const o = (y * W + x) * 4; buf[o] = r * 255; buf[o + 1] = g * 255; buf[o + 2] = b * 255; buf[o + 3] = a * 255;
  }
  return buf;
}

(async () => {
  const wabt = null;
  const wasm = fs.readFileSync('dist/mos_收缩/mos_shrink.wasm');
  const mod = new WebAssembly.Module(wasm);

  function render(pin, out) {
    const ex = new WebAssembly.Instance(mod, {}).exports;
    const nf = 12;
    const pptr = ex.ec_alloc(nf * 8 + W * H * 16 + 4096);
    const dv = new DataView(ex.memory.buffer);
    const params = [70, (W - 1) / 2, (H - 1) / 2, 100, 0, 0, 1, 1, pin, 0, 0, 100];
    for (let i = 0; i < nf; i++) dv.setFloat64(pptr + i * 8, params[i], true);
    const px = pptr + nf * 8;
    const src = makeSource();
    for (let p = 0; p < W * H; p++) {
      for (let c = 0; c < 4; c++) {
        const v = src[p * 4 + c] / 255;
        dv.setFloat32(px + p * 16 + c * 4, c === 3 ? v : v, true);
      }
    }
    ex.ec_render(px, W, H, pptr, nf, 0, 1);
    const d2 = new DataView(ex.memory.buffer);
    const outBuf = Buffer.alloc(W * H * 4);
    for (let p = 0; p < W * H; p++) for (let c = 0; c < 4; c++) {
      let v = d2.getFloat32(px + p * 16 + c * 4, true);
      v = Math.max(0, Math.min(1, v));
      outBuf[p * 4 + c] = Math.round(v * 255);
    }
    writePNG(out, W, H, outBuf);
    console.log('wrote', out);
  }

  render(0, 'build/out/mode_pin.png');
  render(1, 'build/out/mode_free.png');
})();
