const fs=require("fs"),z=require("zlib");
function mk(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}
 let T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c;}
 const crc=(b)=>{let c=-1;for(let i=0;i<b.length;i++)c=T[(c^b[i])&0xff]^(c>>>8);return (c^-1)>>>0;};
 const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",z.deflateSync(raw)),ch("IEND",Buffer.alloc(0))]);}
const W=360,H=420,CX=(W-1)/2,CY=(H-1)/2;
const buf=Buffer.alloc(W*H*4,0);for(let i=0;i<W*H;i++){buf[i*4+3]=255;}
// 画一条竖直参考线（原始位置，u0=0.5）
const u0=0.5, x0=Math.round(CX+u0*CX);
for(let y=0;y<H;y++){const o=(y*W+x0)*4;buf[o]=40;buf[o+1]=40;buf[o+2]=40;}
function plot(k,p,shade){for(let y=0;y<H;y++){const v=(y-CY)/CY;
 const A=1+k*Math.pow(Math.max(0,1-v*v),p)*Math.pow(1-u0*u0,p);
 const x=Math.round(CX+u0*CX*A);
 for(let d=-1;d<=1;d++){const xx=x+d;if(xx<0||xx>=W)continue;const o=(y*W+xx)*4;buf[o]=shade;buf[o+1]=shade;buf[o+2]=shade;}}}
plot(1.5,2,80);   // C 深灰：之前那版
plot(0.74,2,160); // B 中灰：最初实测拟合
plot(0.45,1,255); // A 白：现在这版
fs.writeFileSync("build/out/one_line2.png",mk(W,H,buf));
console.log("wrote one_line2.png");
