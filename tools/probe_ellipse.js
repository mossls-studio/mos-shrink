// Dump kx (sampling scale) per output pixel for the elliptical map, straight from the wasm.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const wabt = await require('wabt')();
  const bin = fs.readFileSync(path.join(ROOT, 'dist', 'mos_收缩', 'mos_shrink.wasm'));
  const mod = await WebAssembly.instantiate(bin, {});
  const ex = mod.instance.exports;
  const W = 64, H = 48;
  const amount = Number(process.argv[2] || 40);
  const params = [amount, W / 2 + 0.5 - 0.5 + 0.5, H / 2, 100, 0.33, 0, 0.67, 1, 0, 0, 0, 100];
  // manifest order: amount, anchor.x, anchor.y, radius, cx1, cy1, cx2, cy2, edge_fix, sampling, edge_mode, mix
  const anchorX = Number(process.argv[3] || (W - 1) / 2);
  const anchorY = Number(process.argv[4] || (H - 1) / 2);
  params[1] = anchorX; params[2] = anchorY;
  const nf = params.length;
  const pptr = ex.ec_alloc(nf * 8 + W * H * 16 + 1024);
  const mem = new DataView(ex.memory.buffer);
  for (let i = 0; i < nf; i++) mem.setFloat64(pptr + i * 8, params[i], true);
  const px = pptr + nf * 8;
  // encode source x in R, y in G
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = px + (y * W + x) * 16;
      mem.setFloat32(o, x / (W - 1), true);
      mem.setFloat32(o + 4, y / (H - 1), true);
      mem.setFloat32(o + 8, 0, true);
      mem.setFloat32(o + 12, 1, true);
    }
  }
  const rc = ex.ec_render(px, W, H, pptr, nf, 0, 1);
  console.log('render rc=', rc);
  const read = (x, y) => {
    const o = px + (y * W + x) * 16;
    return [mem.getFloat32(o, true) * (W - 1), mem.getFloat32(o + 4, true) * (H - 1)];
  };
  // print kx along the row through the anchor and along the column
  const yRow = Math.round(anchorY);
  let out = 'row y=' + yRow + ': ';
  for (let x = 0; x < W; x += 4) {
    const [sx] = read(x, yRow);
    const k = Math.abs(x - anchorX) < 1e-9 ? NaN : (sx - anchorX) / (x - anchorX);
    out += k.toFixed(3) + ' ';
  }
  console.log(out);
  const xCol = Math.round(anchorX);
  out = 'col x=' + xCol + ': ';
  for (let y = 0; y < H; y += 4) {
    const [, sy] = read(xCol, y);
    const k = Math.abs(y - anchorY) < 1e-9 ? NaN : (sy - anchorY) / (y - anchorY);
    out += k.toFixed(3) + ' ';
  }
  console.log(out);
  // jump scan: max |d kx| between neighbours on the row
  let worst = 0, wx = 0;
  for (let x = 1; x < W; x++) {
    const [sx0] = read(x - 1, yRow), [sx1] = read(x, yRow);
    const k0 = (sx0 - anchorX) / (x - 1 - anchorX), k1 = (sx1 - anchorX) / (x - anchorX);
    const d = Math.abs(k1 - k0);
    if (isFinite(d) && d > worst) { worst = d; wx = x; }
  }
  console.log('max |dk| on row =', worst.toFixed(4), 'at x =', wx);
})();
