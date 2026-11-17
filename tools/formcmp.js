const fs=require("fs"),z=require("zlib");const W=320,H=180;
let T;(function(){const t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c;}T=t;})();
function crc(b){let c=-1;for(let i=0;i<b.length;i++)c=T[(c^b[i])&0xff]^(c>>>8);return (c^-1)>>>0;}
function ch(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);}
function png(f,w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;fs.writeFileSync(f,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",z.deflateSync(raw)),ch("IEND",Buffer.alloc(0))]));}
const src=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){let r=0.03,g=0.03,b=0.03;const n=26.5,gx=Math.abs((x%n)-n/2),gy=Math.abs((y%n)-n/2);if(gx>n/2-0.9||gy>n/2-0.9){r=g=b=0.85;}const o=(y*W+x)*4;src[o]=r*255;src[o+1]=g*255;src[o+2]=b*255;src[o+3]=255;}
function sp(x,y,c){x=Math.max(0,Math.min(W-1,x));y=Math.max(0,Math.min(H-1,y));const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(W-1,x0+1),y1=Math.min(H-1,y0+1);const fx=x-x0,fy=y-y0;const f=(a,b)=>src[(b*W+a)*4+c]/255;return (f(x0,y0)*(1-fx)+f(x1,y0)*fx)*(1-fy)+(f(x0,y1)*(1-fx)+f(x1,y1)*fx)*fy;}
const CX=(W-1)/2,CY=(H-1)/2;
function go(name,k,p){const buf=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const u=(x-CX)/CX,v=(y-CY)/CY;
 const t=Math.pow(Math.max(0,(1-u*u)*(1-v*v)),p); const A=1+k*t; const sx=CX+(x-CX)*A, sy=CY+(y-CY)*A;
 const o=(y*W+x)*4; for(let c=0;c<3;c++)buf[o+c]=Math.round(Math.max(0,Math.min(1,sp(sx,sy,c)))*255);buf[o+3]=255;}
png("build/out/"+name,W,H,buf);console.log("wrote",name,"k",k,"p",p);}
go("p1_k10.png",1.0,1); go("p1_k14.png",1.4,1); go("p2_k15.png",1.5,2);
