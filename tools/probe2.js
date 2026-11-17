const fs=require("fs");
// 极简 PNG 解码（8bit, 非隔行, RGB/RGBA）
function decode(file){
  const b=fs.readFileSync(file); let p=8, w=0,h=0,ct=0,bd=0, idat=[];
  while(p<b.length){ const len=b.readUInt32BE(p); const t=b.toString("ascii",p+4,p+8); const d=b.slice(p+8,p+8+len);
    if(t==="IHDR"){ w=d.readUInt32BE(0); h=d.readUInt32BE(4); bd=d[8]; ct=d[9]; }
    else if(t==="IDAT") idat.push(d); else if(t==="IEND") break;
    p+=12+len; }
  const raw=require("zlib").inflateSync(Buffer.concat(idat));
  const ch = ct===6?4: ct===2?3: ct===0?1:4; const stride=w*ch;
  const out=Buffer.alloc(w*h*ch); let prev=Buffer.alloc(stride);
  for(let y=0;y<h;y++){ const f=raw[y*(stride+1)]; const line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));
    const cur=Buffer.alloc(stride);
    for(let x=0;x<stride;x++){ const a=x>=ch?cur[x-ch]:0, bb=prev[x], c=x>=ch?prev[x-ch]:0; let v=line[x];
      if(f===1)v+=a; else if(f===2)v+=bb; else if(f===3)v+=((a+bb)>>1); else if(f===4){ const pa=Math.abs(bb-c),pb=Math.abs(a-c),pc=Math.abs(a+bb-2*c); const pr=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c); v+=pr; }
      cur[x]=v&255; }
    cur.copy(out,y*stride); prev=cur; }
  return {w,h,ch,data:out};
}
const file=process.argv[2];
const im=decode(file);
const y=Math.floor(im.h*(process.argv[3]?parseFloat(process.argv[3]):0.5));
const vals=[]; for(let x=0;x<im.w;x++){ const o=(y*im.w+x)*im.ch; vals.push((im.data[o]+im.data[o+1]+im.data[o+2])/765); }
const mx=Math.max(...vals);
const th=Math.max(0.06, mx*0.25);
const peaks=[];
for(let x=1;x<im.w-1;x++){ if(vals[x]>th && vals[x]>=vals[x-1] && vals[x]>vals[x+1]){ let s=0,sw=0; for(let k=-2;k<=2;k++){const i=x+k; if(i<0||i>=im.w)continue; s+=i*vals[i]; sw+=vals[i];} peaks.push(s/sw); } }
const mid=(im.w-1)/2;
const left=peaks.filter(v=>v<mid-3).sort((a,b)=>b-a).slice(0,6);
const right=peaks.filter(v=>v>mid+3).sort((a,b)=>a-b).slice(0,6);
console.log("y="+y+" max="+mx.toFixed(2)+" peaks="+peaks.length);
console.log("left gaps :", left.map((v,i)=> (i? v-left[i-1] : mid-v).toFixed(1)).join(" "));
console.log("right gaps:", right.map((v,i)=> (i? v-right[i-1] : v-mid).toFixed(1)).join(" "));
