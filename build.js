// build.js — 编译 src/mos_shrink.wat（内嵌 manifest）→ dist/zh + dist/en
//   node build.js              构建 zh 与 en 两套
//   node build.js --lang=en    只构建 en
// 语言覆盖表在 src/i18n.json，未列出的字段沿用 src/manifest.json。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NAME = 'mos_收缩';            // 旧版 dist 目录别名（zh）
const WASM_NAME = 'mos_shrink.wasm';
const WAT_NAME = 'mos_shrink.wat';
const LANGS = ['zh', 'en'];

function escapeWatString(bytes) {
  let out = '';
  for (const b of bytes) {
    if (b === 0x22 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += '\\' + b.toString(16).padStart(2, '0');
  }
  return out;
}

function pickLang(value, lang) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, lang)) return undefined;
  return value[lang];
}

function localize(base, overlay, lang) {
  const out = JSON.parse(JSON.stringify(base));
  for (const key of ['category', 'name', 'description']) {
    const v = pickLang(overlay[key], lang);
    if (typeof v === 'string') out[key] = v;
  }
  const groups = overlay.groups || {};
  const perParam = overlay.params || {};
  for (const p of out.params) {
    const po = perParam[p.id];
    if (po) {
      const n = pickLang(po.name, lang);
      if (typeof n === 'string') p.name = n;
      const opts = pickLang(po.options, lang);
      if (Array.isArray(opts)) p.options = opts;
    }
    if (p.group && groups[p.group]) {
      const g = pickLang(groups[p.group], lang);
      if (typeof g === 'string') p.group = g;
    }
  }
  return out;
}

async function buildLang(lang, base, overlay, wabt) {
  const manifest = JSON.stringify(localize(base, overlay, lang));
  const mbytes = Buffer.from(manifest, 'utf8');

  let wat = fs.readFileSync(path.join(ROOT, 'src', WAT_NAME), 'utf8');
  if (!wat.includes('__MANIFEST_BYTES__')) throw new Error('wat: missing __MANIFEST_BYTES__ placeholder');
  wat = wat
    .replace('__MANIFEST_BYTES__', escapeWatString(mbytes))
    .replace('__MANIFEST_LEN__', String(mbytes.length));

  const buildDir = path.join(ROOT, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, WAT_NAME), wat, 'utf8');
  fs.writeFileSync(path.join(buildDir, `manifest.${lang}.json`), manifest + '\n');

  // wabt 1.0.39 的词法器对源码里的非 ASCII 字节（只可能出现在注释里）会误报
  // `unexpected char`，所以喂给解析器之前把它们换成空格；写回 build/ 的仍是原文。
  const watForParse = wat.replace(/[^\x00-\x7F]/g, ' ');
  let mod;
  try {
    mod = wabt.parseWat(WAT_NAME, watForParse, {});
    mod.resolveNames();
    mod.validate();
  } catch (e) {
    console.error(`WAT 编译失败 [${lang}]:\n` + (e && e.message ? e.message : e));
    process.exit(1);
  }
  const wasm = Buffer.from(mod.toBinary({ log: false, write_debug_names: false }).buffer);

  const distDir = path.join(ROOT, 'dist', lang);
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, WASM_NAME), wasm);

  const readme = path.join(ROOT, `README.${lang}.md`);
  fs.copyFileSync(fs.existsSync(readme) ? readme : path.join(ROOT, 'README.md'), path.join(distDir, 'README.md'));

  const panelDir = path.join(ROOT, 'panel');
  if (fs.existsSync(panelDir)) {
    for (const f of fs.readdirSync(panelDir)) {
      fs.copyFileSync(path.join(panelDir, f), path.join(distDir, f));
    }
  }

  if (lang === 'zh') { // 旧工具仍指向 dist/mos_收缩/，保留一份别名
    const legacy = path.join(ROOT, 'dist', NAME);
    fs.mkdirSync(legacy, { recursive: true });
    fs.copyFileSync(path.join(distDir, WASM_NAME), path.join(legacy, WASM_NAME));
  }

  console.log(`OK  [${lang}]  wasm ${wasm.length} bytes  manifest ${mbytes.length} bytes  ->  ${distDir}`);
}

async function main() {
  const langArg = process.argv.find((a) => a.startsWith('--lang='));
  const langs = langArg ? [langArg.split('=')[1]] : LANGS;
  for (const l of langs) {
    if (!LANGS.includes(l)) throw new Error(`unknown --lang ${l} (expected zh|en)`);
  }
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  const overlay = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n.json'), 'utf8'));
  const wabt = await require('wabt')();
  for (const lang of langs) await buildLang(lang, base, overlay, wabt);
}

main().catch((e) => { console.error(e); process.exit(1); });
