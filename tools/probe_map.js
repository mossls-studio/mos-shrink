// tools/probe_map.js — 打印收缩映射曲线：输出像素坐标 → 采样到的源坐标
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const bytes = fs.readFileSync(path.join(ROOT, 'dist', 'mos_收缩', 'mos_shrink.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const manifest = JSON.parse(Buffer.from(new Uint8Array(ex.memory.buffer).slice(ex.ec_manifest_ptr(), ex.ec_manifest_ptr() + ex.ec_manifest_len())).toString('utf8'));

  const vals = { amount: 40, anchor: [0.5, 0.5], radius: 100, curve_x1: 0.33, curve_y1: 0, curve_x2: 0.67, curve_y2: 1, edge_pin: 100, edge_width: 15, sampling: 2, edge_mode: 0, mix: 100 };
  for (const kv of process.argv.slice(2)) {
    const [k, v] = kv.split('=');
    if (k === 'anchor') vals.anchor = v.split(',').map(Number);
    else if (k === 'amount') vals.amount = Number(v);
    else if (k === 'radius') vals.radius = Number(v);
    else if (k === 'curve') {
      const c = v.split(',').map(Number);
      vals.curve_x1 = c[0]; vals.curve_y1 = c[1]; vals.curve_x2 = c[2]; vals.curve_y2 = c[3];
    } else if (k === 'pin') vals.edge_pin = Number(v);
    else if (k === 'band') vals.edge_width = Number(v);
  }

  const flat = [];
  for (const p of manifest.params) {
    if (p.type === 'point') flat.push(...(vals[p.id] || p.default));
    else flat.push(vals[p.id] !== undefined ? vals[p.id] : p.default);
  }
  const nf = flat.length;
  const W = 200, H = 200;
  const nbytes = W * H * 4 * 4;
  const base = ex.ec_alloc(nf * 8 + nbytes);
  const dv = new DataView(ex.memory.buffer);
  flat.forEach((v, i) => dv.setFloat64(base + i * 8, v, true));
  const pbase = base + nf * 8;
  const f32 = new Float32Array(ex.memory.buffer, pbase, W * H * 4);
  // 源图：R 通道 = 源 x / (W-1)，其余通道标记
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    f32[i] = x / (W - 1); f32[i + 1] = 0; f32[i + 2] = 0; f32[i + 3] = 1;
  }
  const rc = ex.ec_render(pbase, W, H, base, nf, 0, 1);
  if (rc !== 0) throw new Error('rc=' + rc);
  const out = new Float32Array(ex.memory.buffer, pbase, W * H * 4).slice();

  console.log(`amount=${vals.amount} radius=${vals.radius} pin=${vals.edge_pin} band=${vals.edge_width} anchor=${vals.anchor} curve=${[vals.curve_x1, vals.curve_y1, vals.curve_x2, vals.curve_y2]}`);
  console.log('anchor px x =', vals.anchor[0] * (W - 1));
  console.log(' outX  srcX   scale(dOut/dSrc)');
  let prev = null;
  for (let x = 0; x < W; x += 5) {
    const sx = out[((100 * W) + x) * 4] * (W - 1);
    const scale = prev === null ? NaN : (x - prev.x) / (sx - prev.srcX);
    console.log(`  ${String(x).padStart(3)}  ${sx.toFixed(2).padStart(6)}   ${isNaN(scale) ? '' : scale.toFixed(3)}`);
    prev = { x, srcX: sx };
  }
})().catch((e) => { console.error(e); process.exit(1); });

