// build_smoke.js — 把 panel/*.jsx 与 tools/smoke_body.jsx 拼成一个文件，供 headless CLI 运行
// （EffectCraft 脚本只能读自己所在文件夹，$.evalFile 跨目录会被拒）。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'panel', 'mos_收缩曲线.jsx'), 'utf8');
const body = fs.readFileSync(path.join(root, 'tools', 'smoke_body.jsx'), 'utf8');
const out = path.join(root, 'build', 'panel_smoke_combined.jsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, panel + '\n\n' + body, 'utf8');
console.log('wrote ' + out + ' (' + (panel.length + body.length) + ' chars)');
