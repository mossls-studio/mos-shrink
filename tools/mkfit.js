const fs=require("fs");const fl="tools/fit_bilinear.js";let s=fs.readFileSync(fl,"utf8");
s=s.replace(/render\('fit_a.png'[\s\S]*$/,"");
s=s.replace("render('fit_b.png', -0.5);","");
fs.writeFileSync("tools/fit_scan.js",s+`
for (const k of [0.5,0.7,0.9,1.1,1.3,1.5]) render('fit_k'+Math.round(k*100)+'.png', k);
`);
