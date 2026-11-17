// 构建 ae_warp 插件：注入 manifest、编译成 wasm
// 用法：node build_warp.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcDir = path.join(root, 'ae_warp');
const outDir = path.join(root, 'dist', '变形-白点');

function escapeUtf8(json) {
  const bytes = Buffer.from(json, 'utf8');
  let out = '';
  for (const b of bytes) {
    if (b === 0x22 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += '\\' + b.toString(16).padStart(2, '0');
  }
  return out;
}

(async () => {
  const manifestRaw = fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(manifestJson, 'utf8');
  if (manifestBytes > 1024 * 1024) throw new Error('manifest too big');

  let wat = fs.readFileSync(path.join(srcDir, 'ae_warp.wat'), 'utf8');
  if (process.env.COEF) {
    wat = wat.replace('(f64.const 0.74)', '(f64.const ' + process.env.COEF + ')');
  }
  wat = wat.replace('__MANIFEST_BYTES__', escapeUtf8(manifestJson));
  wat = wat.replace('__MANIFEST_LEN__', String(manifestBytes));

  // wabt 1.0.39 的 parseWat 不吃非 ASCII（注释里的中文也算），编译时先替换成空格
  const watForParse = wat.replace(/[^\x00-\x7F]/g, ' ');

  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'ae_warp.wat'), wat, 'utf8');

  const wabt = await require('wabt')();
  const mod = wabt.parseWat('ae_warp.wat', watForParse, {});
  mod.resolveNames();
  mod.validate();
  const { buffer } = mod.toBinary({ log: false, write_debug_names: false });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ae_warp.wasm'), Buffer.from(buffer));

  console.log('OK  wasm ' + buffer.byteLength + ' bytes  manifest ' + manifestBytes + ' bytes  ->  ' + outDir);
})().catch(e => {
  console.error('FAIL', e.message);
  process.exit(1);
});
