// forward map: source line at u_s (|u|<=1) lands at output u where u_s = u * A(u), A(u)=1+k(1-u^2)
function forward(u, k){ const A = 1 + k*(1-u*u); return u*A; }
function solve(k, us){ // find u with forward(u)=us  (u and us same sign, monotone for k<1)
  let lo=0, hi=1;
  if (us<0) { lo=0; hi=-1; }
  for(let i=0;i<80;i++){ const m=(lo+hi)/2; const f=forward(m,k); if ((us>=0 && f<us)||(us<0&&f>us)) lo=m; else hi=m; }
  return (lo+hi)/2;
}
for (const k of [0.4,0.5,0.6,0.7,0.8,0.9]) {
  const N=5; const outs=[];
  for (let i=0;i<=N;i++) outs.push(solve(k, i/N));
  const gaps=[]; for(let i=1;i<=N;i++) gaps.push(+(outs[i]-outs[i-1]).toFixed(3));
  const ratio = gaps[N-1]/gaps[0];
  console.log("k="+k.toFixed(2), "gaps", gaps.join(" "), "ratio", ratio.toFixed(2));
}
