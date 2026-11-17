// fit A(u) = 1 + k*(1-u^2)^p  to the AE measured gap profile (normalized)
const target=[0.341,0.395,0.653,1.0]; // 4 gaps from the centre outward (relative to the outer one)
function profile(k,p,N){
  const f=(u)=>u*(1+k*Math.pow(Math.max(0,1-u*u),p));
  const outs=[];
  for(let i=0;i<=N;i++){ const us=i/N; let lo=0,hi=1;
    // forward map is u -> u*A(u); find the output u whose SOURCE is us: source = out*A(out) = us
    for(let j=0;j<80;j++){ const m=(lo+hi)/2; if(f(m)<us) lo=m; else hi=m; }
    outs.push((lo+hi)/2);
  }
  const gaps=[]; for(let i=1;i<=N;i++) gaps.push(outs[i]-outs[i-1]);
  const g=gaps.slice(1); // skip the innermost half-gap? keep 4 for N=5
  return gaps;
}
let best=null;
for(let p=0.5;p<=4.001;p+=0.25){
  for(let k=0.2;k<=0.95;k+=0.02){
    const g=profile(k,p,5); // 5 gaps
    const norm=g.map(x=>x/g[4]);
    // compare the outer 4 (indices 1..4)
    const cand=[norm[1],norm[2],norm[3],norm[4]];
    let err=0; for(let i=0;i<4;i++) err+=Math.pow(cand[i]-target[i],2);
    if(!best||err<best.err) best={err,p,k,cand};
  }
}
console.log("best p="+best.p.toFixed(2)+" k="+best.k.toFixed(2)+" err="+best.err.toFixed(4));
console.log("model :", best.cand.map(v=>v.toFixed(3)).join(" "));
console.log("AE    :", target.join(" "));
