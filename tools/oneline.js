const fs=require("fs"),z=require("zlib");
function mk(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}
 let T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c;}
 const crc=(b)=>{let c=-1;for(let i=0;i<b.length;i++)c=T[(c^b[i])&0xff]^(c>>>8);return (c^-1)>>>0;};
 const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",z.deflateSync(raw)),ch("IEND",Buffer.alloc(0))]);}
const W=320,H=300;
const buf=Buffer.alloc(W*H*4,0);for(let i=0;i<W*H;i++){buf[i*4+3]=255;}
function plot(k,p,u0,shade){const CX=(W-1)/2,CY=(H-1)/2;
 for(let y=0;y<H;y++){const v=(y-CY)/CY;const t=Math.pow(Math.max(0,1-u0*u0),p)*Math.pow(Math.max(0,1-v*v),p);
  const A=1+k*t; const x=Math.round(CX+u0*(W-1)/2*A);
  for(let d=-1;d<=1;d++){const xx=x+d;if(xx<0||xx>=W)continue;const o=(y*W+xx)*4;buf[o]=shade;buf[o+1]=shade;buf[o+2]=shade;}}}
// 灰色：旧版 p=2 k=1.5；白色：新版 p=1 k=0.45
plot(1.5,2,0.35,90);
plot(0.45,1,0.35,255);
fs.writeFileSync("build/out/one_line.png",mk(W,H,buf));
console.log("wrote build/out/one_line.png");
