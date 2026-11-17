// tools/probe_col.js — 打印某一列的中间量（与 wasm 同一份数学）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function bezSolve(x1, y1, x2, y2, u) {
  let t = u;
  for (let i = 0; i < 12; i++) {
    const om = 1 - t, t2 = t * t;
    const xx = 3 * om * om * t * x1 + 3 * om * t2 * x2 + t2 * t;
    const dd = 3 * om * om * x1 + 6 * om * t * (x2 - x1) + 3 * t2 * (1 - x2);
    if (Math.abs(dd) < 1e-9) break;
    t = Math.min(1, Math.max(0, t - (xx - u) / dd));
  }
  const om = 1 - t, t2 = t * t;
  return 3 * om * om * t * y1 + 3 * om * t2 * y2 + t2 * t;
}

const W = 320, H = 180;
const P = { amount: 40, anchor: [W / 2, H / 2], radius: 100, c1x: 0.33, c1y: 0, c2x: 0.67, c2y: 1, edge_pin: 100, edge_width: 15, sampling: 0, edge_mode: 0, mix: 100 };
for (const kv of process.argv.slice(2)) {
  const [k, v] = kv.split('=');
  if (k in P && v.includes(',')) P[k] = v.split(',').map(Number); else P[k] = Number(v);
}
const lut = new Float64Array(1025);
for (let i = 0; i <= 1024; i++) lut[i] = bezSolve(P.c1x, P.c1y, P.c2x, P.c2y, i / 1024);

const amount = Math.min(0.95, Math.max(-0.9, P.amount / 100));
const ax = P.anchor[0], ay = P.anchor[1];
const dmin = Math.min(W, H);
const rad = Math.max(0.5, (P.radius / 100) * dmin);
const band = Math.max(0.5, (P.edge_width / 100) * dmin);
const pin = P.edge_pin / 100;

const x = +(process.argv.find((a) => a.startsWith('col=')) || 'col=160').split('=')[1];
console.log(`x=${x} ax=${ax} rad=${rad} band=${band} pin=${pin}`);
console.log('  y   dist     q       f      mask     k       s      sy');
for (let y = 0; y < H; y++) {
  const dx = x - ax, dy = y - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let q = Math.min(1, Math.max(0, 1 - dist / rad));
  const f = lut[Math.min(1024, Math.max(0, Math.round(q * 1024)))];
  const em = Math.min(x, W - 1 - x, y, H - 1 - y);
  let t = Math.min(1, em / band);
  t = t * t * (3 - 2 * t);
  const mask = 1 - pin * (1 - t);
  const k = amount * f * mask;
  const s = 1 / (1 - k);
  const sy = ay + dy * s;
  if (y <= 24) console.log(`  ${String(y).padStart(2)} ${dist.toFixed(1).padStart(6)}  ${q.toFixed(3)}  ${f.toFixed(3)}  ${mask.toFixed(3)}  ${k.toFixed(4)}  ${s.toFixed(3)}  ${sy.toFixed(2)}`);
}
