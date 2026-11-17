const fs = require('fs');
(async () => {
  const wabt = await require('wabt')();
  let src = fs.readFileSync('src/mos_shrink.wat', 'utf8');
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.includes('elliptical fisheye map'));
  console.log('comment block starts at line', idx + 1);
  for (let k = 0; k < 3; k++) {
    const copy = lines.slice();
    copy[idx + k] = '            ;; replaced';
    const s = copy.join('\n').replace(/__MANIFEST_BYTES__/g, '\\68\\69').replace(/__MANIFEST_LEN__/g, '2');
    try {
      const m = wabt.parseWat('a.wat', s, {}); m.resolveNames(); m.validate();
      console.log('replace line', idx + k + 1, '=> OK');
    } catch (e) {
      console.log('replace line', idx + k + 1, '=> FAIL', e.message.split('\n')[1]);
    }
  }
  // also try replacing each char class
  const s0 = lines.join('\n').replace(/__MANIFEST_BYTES__/g, '\\68\\69').replace(/__MANIFEST_LEN__/g, '2');
  for (const [name, ch] of [['caret', '^'], ['fullcolon', '\uFF1A'], ['cjk', '\u4e2d']]) {
    const s = s0.split(ch).join('X');
    try {
      const m = wabt.parseWat('a.wat', s, {}); m.resolveNames(); m.validate();
      console.log('strip', name, '=> OK');
    } catch (e) {
      console.log('strip', name, '=> FAIL', e.message.split('\n')[1]);
    }
  }
})();
