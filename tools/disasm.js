const fs = require('fs');
(async () => {
  const wabt = await require('wabt')();
  const m = wabt.readWasm(fs.readFileSync('dist/mos_收缩/mos_shrink.wasm'), { readDebugNames: false });
  const txt = m.toText({});
  fs.writeFileSync('build/disasm.txt', txt);
  const i = txt.indexOf('$xend');
  console.log(txt.slice(Math.max(0, i - 300), i + 2200));
})();
