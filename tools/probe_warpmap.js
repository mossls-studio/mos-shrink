// 把 x/y 编码进 R/G 通道，读回映射，验证 A 与公式一致。可选锚点参数。
const fs = require('fs');
const mod = new WebAssembly.Module(fs.readFileSync('dist/变形-白点/ae_warp.wasm'));
const ex = new WebAssembly.Instance(mod, {}).exports;
const W = 65, H = 65;
const ANC = process.argv[2] === undefined ? [0.5, 0.5] : [Number(process.argv[2]), Number(process.argv[3] || 0.5)];
const BEND = process.argv[4] === undefined ? -100 : Number(process.argv[4]);
const p = ex.ec_alloc(40 + W * H * 16 + 65536);
const dv = new DataView(ex.memory.buffer);
const AX = ANC[0] * (W - 1), AY = ANC[1] * (H - 1);
dv.setFloat64(p, AX, true);          // 锚点 x（宿主传的是 buffer 像素）
dv.setFloat64(p + 8, AY, true);      // 锚点 y
dv.setFloat64(p + 16, BEND, true);   // 弯曲
dv.setFloat64(p + 24, 0, true);      // 采样
dv.setFloat64(p + 32, 1, true);      // 画质
const pix = p + 40;
const f = new Float32Array(ex.memory.buffer, pix, W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 4;
  f[o] = x; f[o + 1] = y; f[o + 2] = 0; f[o + 3] = 1;
}
ex.ec_render(pix, W, H, p, 5, 0, 1);
console.log('anchor=' + AX + ',' + AY + '  bend=' + BEND);
for (const [x, y] of [[32, 32], [24, 32], [16, 32], [8, 32], [48, 32], [56, 32], [AX, AY], [AX + 8, AY]]) {
  const k = Math.round(x), l = Math.round(y);
  if (k < 0 || l < 0 || k >= W || l >= H) continue;
  const o = (l * W + k) * 4;
  const sx = f[o], sy = f[o + 1];
  const a = (sx - AX) / (k - AX || 1e-9);
  console.log('out(' + k + ',' + l + ') -> src(' + sx.toFixed(2) + ',' + sy.toFixed(2) + ')  A=' + a.toFixed(3));
}
