// 扫描 2D 雅可比行列式，找出折返临界 k（p=1.5）
function A(u, v, k, p) { const t = Math.max(0, (1 - u * u)) * Math.max(0, (1 - v * v)); return 1 + k * Math.pow(t, p); }
function jac(u, v, k, p) {
  const h = 1e-5;
  const a0 = A(u, v, k, p);
  const axu = (A(u + h, v, k, p) - A(u - h, v, k, p)) / (2 * h);
  const axv = (A(u, v + h, k, p) - A(u, v - h, k, p)) / (2 * h);
  const j11 = a0 + u * axu, j12 = u * axv, j21 = v * axu, j22 = a0 + v * axv;
  return j11 * j22 - j12 * j21;
}
for (const p of [1, 1.5, 2]) {
  let crit = null;
  for (let k = 0.3; k <= 2.0; k += 0.005) {
    let mn = 1e9;
    for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200; j++) {
      const u = (i / 200) * 2 - 1, v = (j / 200) * 2 - 1;
      const d = jac(u, v, k, p); if (d < mn) mn = d;
    }
    if (mn <= 0) { crit = k; break; }
  }
  let d09 = 1e9;
  for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200; j++) {
    const u = (i / 200) * 2 - 1, v = (j / 200) * 2 - 1;
    const d = jac(u, v, 0.9, p); if (d < d09) d09 = d;
  }
  console.log('p=' + p + '  折返临界 k≈' + (crit ? crit.toFixed(3) : '>2') + '   k=0.9 时 min|J|=' + d09.toFixed(4));
}
