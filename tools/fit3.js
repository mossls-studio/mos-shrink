// AE 实测（797×456 图，中心行，从中心向外的输出半径，已按半宽 398 归一化）
const r = [19.2, 54.4, 116.5, 219.8, 377.6].map(v => v / 398);
// 模型：输出半径 out 处采样到源半径 f(out)=out*(1+k*(1-out^2)^p)；源线等距 Δ
function err(k, p, D) { let e = 0; for (let j = 0; j < r.length; j++) { const f = r[j] * (1 + k * Math.pow(Math.max(0, 1 - r[j] * r[j]), p)); const d = f - (j + 1) * D; e += d * d; } return e; }
let best = null;
for (let k = 0; k <= 3; k += 0.01) for (let p = 0.5; p <= 5; p += 0.05) for (let D = 0.03; D <= 0.6; D += 0.002) {
  const e = err(k, p, D); if (!best || e < best.e) best = { k, p, D, e };
}
console.log('best k=' + best.k.toFixed(2) + ' p=' + best.p.toFixed(2) + ' D=' + best.D.toFixed(3) + ' rms=' + Math.sqrt(best.e / r.length).toFixed(4));
const pred = r.map(v => (v * (1 + best.k * Math.pow(Math.max(0, 1 - v * v), best.p))));
console.log('src(radii) =', pred.map(v => v.toFixed(3)).join(' '));
console.log('target j*D  =', r.map((_, j) => ((j + 1) * best.D).toFixed(3)).join(' '));
