// Render the warp plugin at 1/3 preview resolution across a fine bend sweep and report
// frame-to-frame differences — a "pop" shows up as a spike.
const fs = require('fs');
const path = require('path');

const wasmPath = process.argv[2] || 'dist/变形-白点/ae_warp.wasm';
const SCALE = parseFloat(process.argv[3] || '0.3333');   // 1/3 preview
const W = Math.max(48, Math.round(1920 * SCALE));
const H = Math.max(27, Math.round(1080 * SCALE));

const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
const inst = new WebAssembly.Instance(mod, {});
const ex = inst.exports;
const mem = () => new DataView(ex.memory.buffer);

// tiny PNG writer only for the last frame (debug)
const zlib = require('zlib');

function makeSource() {
  // grid like the user's test comp: thin bright lines on dark
  const buf = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0.03;
    const n = parseFloat(process.env.GRID || "3");
    const gx = Math.abs((x % n) - n / 2), gy = Math.abs((y % n) - n / 2);
    if (gx > n / 2 - 0.9 || gy > n / 2 - 0.9) v = 0.85;
    const o = (y * W + x) * 4;
    buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; buf[o + 3] = 1;
  }
  return buf;
}

function render(bend) {
  const nF = 2;
  const bytes = nF * 8 + W * H * 16 + 65536;
  const pptr = ex.ec_alloc(bytes);
  const dv = mem();
  dv.setFloat64(pptr, bend, true);
  dv.setFloat64(pptr + 8, 0, true);
  const pix = pptr + nF * 8;
  const src = makeSource();
  new Float32Array(ex.memory.buffer, pix, W * H * 4).set(src);
  const rc = ex.ec_render(pix, W, H, pptr, nF, 0, SCALE);
  if (rc !== 0) throw new Error('render rc=' + rc);
  return new Float32Array(new Float32Array(ex.memory.buffer, pix, W * H * 4));
}

const bends = [];
for (let b = -100; b <= -95.999; b += 0.1) bends.push(Math.round(b * 100) / 100);

let prev = null;
const rows = [];
for (const b of bends) {
  const img = render(b);
  let d = 0, mx = 0;
  if (prev) {
    for (let i = 0; i < img.length; i++) { const t = Math.abs(img[i] - prev[i]); d += t; if (t > mx) mx = t; }
    d /= img.length;
  }
  rows.push({ b: b.toFixed(1), mad: d.toFixed(6), max: mx.toFixed(4) });
  prev = img;
}

const mads = rows.slice(1).map(r => parseFloat(r.mad));
const avg = mads.reduce((a, b) => a + b, 0) / mads.length;
console.log('res=' + W + 'x' + H + '  scale=' + SCALE.toFixed(3) + '  frames=' + rows.length);
console.log('mean frame-to-frame MAD = ' + avg.toFixed(6));
let worst = null;
for (const r of rows) {
  const m = parseFloat(r.mad);
  if (m > avg * 2.2 && m > 1e-4) { if (!worst || m > parseFloat(worst.mad)) worst = r; }
}
console.log(worst ? 'POP near bend=' + worst.b + '  MAD=' + worst.mad + ' (x' + (parseFloat(worst.mad) / avg).toFixed(1) + ' of mean)' : 'no pop detected (all steps within 2.2x of mean)');
for (const r of rows.filter(r => parseFloat(r.mad) > avg * 2.2 && parseFloat(r.mad) > 1e-4)) {
  console.log('  bend=' + r.b + '  MAD=' + r.mad + '  maxΔ=' + r.max);
}
