const fs = require('fs');
const txt = fs.readFileSync('dist/../build/disasm.txt', 'utf8');
const idx = txt.indexOf('f64.sqrt');
console.log('sqrt at', idx);
const start = txt.lastIndexOf('(func', idx);
const seg = txt.slice(start, idx + 1200);
console.log(seg.split('\n').slice(0, 90).join('\n'));
