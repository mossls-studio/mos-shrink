// tools/test_wasm.js — 直接实例化 wasm 验证数学与像素输出（不依赖 EffectCraft）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const WASM = path.join(ROOT, 'dist', 'mos_收缩', 'mos_shrink.wasm');
const OUT = path.join(ROOT, 'build', 'out');

// ---------- minimal PNG encoder ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------- test image ----------
function makeTestImage(w, h) {
  const px = new Float32Array(w * h * 4);
  // premultiplied RGBA, alpha = 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const chk = ((x >> 4) + (y >> 4)) & 1;
      let r = chk ? 0.16 : 0.10, g = chk ? 0.17 : 0.11, b = chk ? 0.22 : 0.14;
      // grid
      if (x % 16 === 0 || y % 16 === 0) { r += 0.10; g += 0.10; b += 0.10; }
      // diagonal ramp
      r += 0.25 * (x / w); g += 0.20 * (y / h);
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 1;
    }
  }
  // 3px orange frame on the border
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (e < 3) {
        const i = (y * w + x) * 4;
        px[i] = 0.95; px[i + 1] = 0.45; px[i + 2] = 0.10; px[i + 3] = 1;
      }
    }
  }
  return px;
}

// ---------- harness ----------
const PARAM_ORDER = [
  'amount', ['anchor', 2], 'radius',
  'curve_x1', 'curve_y1', 'curve_x2', 'curve_y2',
  'edge_pin', 'edge_width', 'sampling', 'edge_mode', 'mix',
];

function unpackParams(manifest, values, W, H) {
  const flat = [];
  for (const p of manifest.params) {
    if (p.type === 'point') {
      const v = values[p.id] !== undefined ? values[p.id] : p.default;
      // 宿主的 point 参数以 buffer 像素给出；harness 里用 [0..1] 分数表示，这里换算
      flat.push(v[0] * W, v[1] * H);
    } else if (p.type === 'color') {
      const v = values[p.id] !== undefined ? values[p.id] : p.default;
      flat.push(v[0], v[1], v[2], v[3]);
    } else {
      flat.push(values[p.id] !== undefined ? values[p.id] : p.default);
    }
  }
  return flat;
}

(async () => {
  const bytes = fs.readFileSync(WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  const api = ex.ec_api_version();
  const mptr = ex.ec_manifest_ptr(), mlen = ex.ec_manifest_len();
  const mem = () => new Uint8Array(ex.memory.buffer);
  const manifest = JSON.parse(Buffer.from(mem().slice(mptr, mptr + mlen)).toString('utf8'));
  let flatCount = 0;
  for (const p of manifest.params) flatCount += p.type === 'point' ? 2 : p.type === 'color' ? 4 : 1;
  console.log(`api=${api} id=${manifest.id} name=${manifest.name} params=${manifest.params.length} floats=${flatCount}`);

  function render(w, h, values) {
    const npx = w * h * 4;
    const nbytes = npx * 4;
    const params = unpackParams(manifest, values, w, h);
    const base = ex.ec_alloc(flatCount * 8 + nbytes);
    const dv = new DataView(ex.memory.buffer);
    for (let i = 0; i < params.length; i++) dv.setFloat64(base + i * 8, params[i], true);
    const pbase = base + flatCount * 8;
    // write premultiplied RGBA f32
    const src = makeTestImage(w, h);
    const f32 = new Float32Array(ex.memory.buffer, pbase, npx);
    f32.set(src);
    const t0 = process.hrtime.bigint();
    const rc = ex.ec_render(pbase, w, h, base, flatCount, 0, 1);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (rc !== 0) throw new Error('ec_render returned ' + rc);
    const out = new Float32Array(ex.memory.buffer, pbase, npx).slice();
    return { out, src, ms, params };
  }

  function toPNG(file, w, h, f32px) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) {
      const v = f32px[i];
      rgba[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
    writePNG(file, w, h, rgba);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const W = 320, H = 180;

  const cases = [
    ['base', {}],
    ['amount60', { amount: 60 }],
    ['offset-anchor', { anchor: [0.28, 0.36], amount: 55 }],
    ['expand', { amount: -35 }],
    ['corners', { edge_fix: 1, amount: 55 }],
    ['corners-off', { edge_fix: 1, radius: 60, amount: 65 }],
    ['radius50', { radius: 50, amount: 60 }],
    ['cubic', { sampling: 1, amount: 55 }],
    ['curve-plateau', { curve_x1: 0.05, curve_y1: 0.95, curve_x2: 0.2, curve_y2: 1, amount: 70 }],
    ['mix50', { mix: 50, amount: 60 }],
  ];

  for (const [name, values] of cases) {
    const { out, src, ms } = render(W, H, values);
    toPNG(path.join(OUT, name + '.png'), W, H, out);
    // sanity: 模式0（全部固定）整圈边必须与原图一致；模式1（四角固定）四角像素必须一致
    const pin = values.edge_fix === undefined ? 0 : values.edge_fix;
    let maxBorder = 0;
    const pts = pin === 0
      ? (() => {
          const p = [];
          for (let x = 0; x < W; x++) p.push([x, 0], [x, H - 1]);
          for (let y = 0; y < H; y++) p.push([0, y], [W - 1, y]);
          return p;
        })()
      : [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
    for (const [x, y] of pts) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) maxBorder = Math.max(maxBorder, Math.abs(out[i + c] - src[i + c]));
    }
    console.log(`${name.padEnd(14)} ${ms.toFixed(2).padStart(7)} ms   ${pin === 0 ? 'edge' : 'corner'}Δ=${maxBorder.toFixed(4)}`);
  }

  // 1080p perf
  const big = render(1920, 1080, {});
  console.log(`1080p          ${big.ms.toFixed(1)} ms  (${(1920 * 1080 / 1e6).toFixed(2)} Mpx)`);
  console.log('out ->', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
