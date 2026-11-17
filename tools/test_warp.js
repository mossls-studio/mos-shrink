// ae_warp 冒烟：渲染线稿、测线心距、与 AE 实测剖面对比
// 用法：node tools/test_warp.js [bend]
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

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

// 线稿：深底 + 26.5px 亮线网格 + 3px 边框
function makeGrid(w, h) {
  const b = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0.03, g = 0.03, bl = 0.03;
    const n = 26.5, gx = Math.abs((x % n) - n / 2), gy = Math.abs((y % n) - n / 2);
    if (gx > n / 2 - 0.9 || gy > n / 2 - 0.9) { r = g = bl = 0.85; }
    const o = (y * w + x) * 4;
    b[o] = Math.round(r * 255); b[o + 1] = Math.round(g * 255); b[o + 2] = Math.round(bl * 255); b[o + 3] = 255;
  }
  return b;
}

// 找中间行亮线中心（子像素重心），返回从画面中心向左右延伸的间距
function probeRow(buf, w, h) {
  const y = h >> 1;
  const vals = [];
  for (let x = 0; x < w; x++) vals.push(buf[(y * w + x) * 4] / 255);
  const peaks = [];
  for (let x = 1; x < w - 1; x++) {
    if (vals[x] > 0.25 && vals[x] >= vals[x - 1] && vals[x] > vals[x + 1]) {
      // 重心
      let s = 0, sw = 0;
      for (let k = -2; k <= 2; k++) { const i = x + k; if (i < 0 || i >= w) continue; const v = vals[i]; s += i * v; sw += v; }
      peaks.push(sw > 1e-6 ? s / sw : x);
    }
  }
  const mid = (w - 1) / 2;
  const left = peaks.filter(p => p < mid).sort((a, b) => b - a);  // 从中心向左由近到远
  const right = peaks.filter(p => p > mid).sort((a, b) => a - b);
  const gapsL = [];
  let prev = mid;
  for (const p of left) { gapsL.push(prev - p); prev = p; }
  return { peaks, gapsL, gapsR: right.reduce((acc, p, i) => { acc.push(p - (i === 0 ? mid : right[i - 1])); return acc; }, []) };
}

(async () => {
  const bend = process.argv[2] !== undefined ? parseFloat(process.argv[2]) : -100;
  const wasmPath = path.join(__dirname, '..', 'dist', '变形-白点', 'ae_warp.wasm');
  const mod = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
  const ex = mod.instance.exports;
  const api = ex.ec_api_version();
  const mlen = ex.ec_manifest_len();
  const mptr = ex.ec_manifest_ptr();
  const manifest = Buffer.from(ex.memory.buffer, mptr, mlen).toString('utf8');
  const man = JSON.parse(manifest);

  const src = makeGrid(W, H);
  // 参数：锚点(x,y) | 弯曲 | 采样 | 画质  = 5 个 float
  const nf = 5;
  const bytes = nf * 8 + W * H * 16 + 64;
  const ptr = ex.ec_alloc(bytes);
  const mem = new Uint8Array(ex.memory.buffer);
  const params = new Float64Array(ex.memory.buffer, ptr, nf);
  const ANC = (global.__anc || [0.5, 0.5]);
  params[0] = ANC[0] * (W - 1);
  params[1] = ANC[1] * (H - 1);
  params[2] = bend;
  params[3] = 0; // 双线性
  params[4] = 1; // 标准画质
  const pix = new Uint8Array(ex.memory.buffer, ptr + nf * 8, W * H * 16);
  const f32 = new Float32Array(pix.buffer, pix.byteOffset, W * H * 4);
  for (let i = 0; i < W * H; i++) {
    f32[i * 4 + 0] = src[i * 4 + 0] / 255;
    f32[i * 4 + 1] = src[i * 4 + 1] / 255;
    f32[i * 4 + 2] = src[i * 4 + 2] / 255;
    f32[i * 4 + 3] = 1;
  }
  const rc = ex.ec_render(ptr + nf * 8, W, H, ptr, nf, 0, 1);
  console.log('api=' + api + ' params=' + man.params.length + ' render rc=' + rc + ' bend=' + bend);

  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = f32[i * 4 + 3];
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(f32[i * 4 + c] * 255)));
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  fs.mkdirSync(path.join(__dirname, '..', 'build', 'out'), { recursive: true });
  const png = path.join(__dirname, '..', 'build', 'out', 'warp_' + bend + '.png');
  writePNG(png, W, H, out);

  const { peaks, gapsL } = probeRow(out, W, H);
  console.log('peaks=' + peaks.length + ' gapsFromCenter=' + gapsL.slice(0, 5).map(v => v.toFixed(1)).join(' '));
  if (gapsL.length >= 5) {
    const norm = gapsL.slice(1, 5).map(v => v / gapsL[4]);
    console.log('normalized(outer=1)=' + norm.map(v => v.toFixed(3)).join(' '));
    console.log('AE -100  measured   = 0.341 0.395 0.653 1.000');
    console.log('AE model fit        = 0.339 0.408 0.646 1.000');
  }
  console.log('wrote ' + png);
})();
