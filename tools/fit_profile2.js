function gapsFor(k,p,N){
  const f=(u)=>u*(1+k*Math.pow(Math.max(0,1-u*u),p));
  const outs=[];
  for(let i=0;i<=N;i++){ const us=i/N; let lo=0,hi=1;
    for(let j=0;j<80;j++){ const m=(lo+hi)/2; if(f(m)<us) lo=m; else hi=m; }
    outs.push((lo+hi)/2);
  }
  const g=[]; for(let i=1;i<=N;i++) g.push(outs[i]-outs[i-1]);
  return g;
}
const targets={ "-56":[0.657,0.711,0.816,1.0], "-100":[0.341,0.395,0.653,1.0] };
for (const [name,t] of Object.entries(targets)) {
  let best=null;
  for(let p=0.5;p<=4.001;p+=0.25) for(let k=0.1;k<=0.95;k+=0.01){
    const g=gapsFor(k,p,5); const n=g.map(x=>x/g[4]); const c=[n[1],n[2],n[3],n[4]];
    let e=0; for(let i=0;i<4;i++) e+=Math.pow(c[i]-t[i],2);
    if(!best||e<best.e) best={e,p,k,c};
  }
  console.log(name, "best p="+best.p.toFixed(2), "k="+best.k.toFixed(2), "err="+best.e.toFixed(4), "model:", best.c.map(v=>v.toFixed(3)).join(" "));
}
