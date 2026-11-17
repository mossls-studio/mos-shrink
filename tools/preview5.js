// B-spline 位移网格（AE「变形」那种白点网格的近似）原型：只出图，不编译 wasm。
// 用法: node tools\preview5.js [amount 0..0.9]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 320, H = 180;
const OUT = path.join(__dirname, '..', 'build', 'out');

/* ---------- PNG ---------- */
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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ---------- 源图 ---------- */
function makeSource() {
  const px = Buffer.alloc(W * H * 4);
  const set = (x, y, r, g, b) => {
    const o = (y * W + x) * 4;
    px[o] = Math.round(r * 255); px[o + 1] = Math.round(g * 255); px[o + 2] = Math.round(b * 255); px[o + 3] = 255;
  };
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const bg = [0.10, 0.12, 0.14];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, bg[0], bg[1], bg[2]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x % 24 === 0 || y % 24 === 0) set(x, y, 0.62, 0.66, 0.72);
  }
  for (let x = 0; x < W; x++) for (let t = 0; t < 3; t++) { if (inside(x, t)) set(x, t, 0.95, 0.45, 0.10); if (inside(x, H - 1 - t)) set(x, H - 1 - t, 0.95, 0.45, 0.10); }
  for (let y = 0; y < H; y++) for (let t = 0; t < 3; t++) { if (inside(t, y)) set(t, y, 0.95, 0.45, 0.10); if (inside(W - 1 - t, y)) set(W - 1 - t, y, 0.95, 0.45, 0.10); }
  return px;
}
const SRC = makeSource();

/* ---------- 参数 ---------- */
const amount = Number(process.argv[2] || 0.6);
const AX = (W - 1) / 2, AY = (H - 1) / 2;
const KN = 4;              // 4x4 控制点（AE 变形的白点网格）
const bez = (u) => u * u * (3 - 2 * u);   // 平滑阶跃（替代贝塞尔曲线，先看形）

/* 4x4 控制点的位移：边框一圈为 0，内部 2x2 向锚点收 */
const disp = [];
for (let j = 0; j < KN; j++) {
  disp.push([]);
  for (let i = 0; i < KN; i++) {
    const vx = (i / (KN - 1)) * (W - 1);
    const vy = (j / (KN - 1)) * (H - 1);
    const border = i === 0 || j === 0 || i === KN - 1 || j === KN - 1;
    disp[j].push(border ? [0, 0] : [(AX - vx) * amount, (AY - vy) * amount]);
  }
}

/* 三次 B 样条基（均匀，4 点 → 1 段，端点用重复节点把它拉成插值式） */
function bspline(t, k /* 0..3 */) {
  // 均匀三次 B 样条基，t∈[0,1)
  const t2 = t * t, t3 = t2 * t;
  if (k === 0) return (1 - t) ** 3 / 6;
  if (k === 1) return (3 * t3 - 6 * t2 + 4) / 6;
  if (k === 2) return (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  return t3 / 6;
}
// 用 4 个控制点的 B 样条：把控制点索引映射到 [-1,0,1,2] 的节点窗口
function spline1d(pts, t) {
  // t∈[0,1] 覆盖 pts[0]..pts[3] 的跨度；用 1..2 节点区间做均匀参数化
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += bspline((t + 0) , k) * pts[k];
  return sum;
}

/* 位移场：分块双三次 B 样条，t 用 (KN-1) 等分 */
function fieldDisp(x, y) {
  const u = (x / (W - 1)) * (KN - 1);
  const v = (y / (H - 1)) * (KN - 1);
  const i0 = Math.min(KN - 1, Math.max(0, Math.floor(u))) - 1;
  const j0 = Math.min(KN - 1, Math.max(0, Math.floor(v))) - 1;
  const tu = u - Math.floor(u), tv = v - Math.floor(v);
  let dx = 0, dy = 0;
  const W4 = [0, 1, 2, 3].map((k) => bspline(tu, k));
  const W4v = [0, 1, 2, 3].map((k) => bspline(tv, k));
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) {
      const ii = Math.min(KN - 1, Math.max(0, i0 + a));
      const jj = Math.min(KN - 1, Math.max(0, j0 + b));
      const wgt = W4[a] * W4v[b];
      dx += wgt * disp[jj][ii][0];
      dy += wgt * disp[jj][ii][1];
    }
  }
  return [dx, dy];
}

function sample(fx, fy) {
  const x = Math.max(0, Math.min(W - 1, fx)), y = Math.max(0, Math.min(H - 1, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const out = [0, 0, 0, 0];
  const p = (xx, yy) => (yy * W + xx) * 4;
  for (let c = 0; c < 4; c++) {
    const a = SRC[p(x0, y0) + c] * (1 - tx) + SRC[p(x1, y0) + c] * tx;
    const b = SRC[p(x0, y1) + c] * (1 - tx) + SRC[p(x1, y1) + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/* 渲染：src = p - D(p)（位移场的近似逆） */
function render() {
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [dx, dy] = fieldDisp(x, y);
    const c = sample(x - dx, y - dy);
    const o = (y * W + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return px;
}

writePNG(path.join(OUT, 'bs_src.png'), W, H, SRC);
writePNG(path.join(OUT, 'bs_warp.png'), W, H, render());
console.log('wrote bs_src / bs_warp  amount=' + amount + ' grid=' + KN + 'x' + KN);
