// 1080p 与 1/3 预览计时（bend −100 最坏情况，各画质档）
const fs = require('fs');
const mod = new WebAssembly.Module(fs.readFileSync('dist/变形-白点/ae_warp.wasm'));
const ex = new WebAssembly.Instance(mod, {}).exports;

function bench(W, H, bend, q, it) {
  const nf = 5;
  const p = ex.ec_alloc(nf * 8 + W * H * 16 + 262144 + 65536);
  const dv = new DataView(ex.memory.buffer);
  dv.setFloat64(p, (W - 1) / 2, true);
  dv.setFloat64(p + 8, (H - 1) / 2, true);
  dv.setFloat64(p + 16, bend, true);
  dv.setFloat64(p + 24, 0, true);
  dv.setFloat64(p + 32, q, true);
  const pix = p + nf * 8;
  const f32 = new Float32Array(ex.memory.buffer, pix, W * H * 4);
  for (let i = 0; i < W * H; i++) { f32[i * 4] = 0.2; f32[i * 4 + 1] = 0.3; f32[i * 4 + 2] = 0.4; f32[i * 4 + 3] = 1; }
  for (let i = 0; i < 3; i++) ex.ec_render(pix, W, H, p, nf, 0, 1);
  const t0 = Date.now();
  for (let i = 0; i < it; i++) ex.ec_render(pix, W, H, p, nf, 0, 1);
  return (Date.now() - t0) / it;
}

for (const q of [0, 1, 2]) {
  const a = bench(1920, 1080, -100, q, 3).toFixed(1);
  const b = bench(640, 360, -100, q, 8).toFixed(1);
  console.log('quality=' + q + '  bend=-100   1080p ' + a + ' ms   1/3 ' + b + ' ms');
}
