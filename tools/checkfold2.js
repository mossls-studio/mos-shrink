function A(u,v,k,p){const t=Math.max(0,1-u*u)*Math.max(0,1-v*v);return 1+k*Math.pow(t,p);}
function jac(u,v,k,p){const h=1e-5;const a0=A(u,v,k,p);
 const axu=(A(u+h,v,k,p)-A(u-h,v,k,p))/(2*h), axv=(A(u,v+h,k,p)-A(u,v-h,k,p))/(2*h);
 return (a0+u*axu)*(a0+v*axv)-(u*axv)*(v*axu);}
for (const p of [1.5,1.6,1.7,1.8,1.9,2.0]) {
  let crit=null;
  for (let k=0.4;k<=2.2;k+=0.004){ let mn=1e9;
    for(let i=0;i<=160;i++)for(let j=0;j<=160;j++){const u=i/160*2-1,v=j/160*2-1;const d=jac(u,v,k,p);if(d<mn)mn=d;}
    if(mn<=0){crit=k;break;} }
  const kmax = crit?crit*0.70:1.0;
  console.log('p='+p.toFixed(2)+'  折返临界='+(crit?crit.toFixed(3):'>2.2')+'   取 70% 安全值 k_max='+kmax.toFixed(3));
}
