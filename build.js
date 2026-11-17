// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 MOSSLS

// build.js — 编译 src/mos_shrink.wat（内嵌 manifest）→ dist/<names>-<params>
//   node build.js                 构建 4 种语言组合
//   node build.js --variant=zh-en 只构建「中文名称 + 英文参数」一种
//   node build.js --lang=zh       兼容旧用法（= zh-zh），--lang=en = en-en
// 语言覆盖表在 src/i18n.json；效果名称/分组用 names 语言，参数名/选项用 params 语言。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NAME = 'mos_收缩';             // 旧版 dist 目录别名（zh-zh）
const WASM_NAME = 'mos_shrink.wasm';
const WAT_NAME = 'mos_shrink.wat';
const VARIANTS = ['zh-zh', 'zh-en', 'en-zh', 'en-en'];
const PREVIEWS = [];

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

// namesLang 决定分组、效果名与描述；paramsLang 决定参数名和下拉选项。
function localize(base, overlay, namesLang, paramsLang) {
  const out = JSON.parse(JSON.stringify(base));
  for (const key of ['category', 'name', 'description']) {
    const v = pickLang(overlay[key], namesLang);
    if (typeof v === 'string') out[key] = v;
  }
  const groups = overlay.groups || {};
  const perParam = overlay.params || {};
  for (const p of out.params) {
    const po = perParam[p.id];
    if (po) {
      const n = pickLang(po.name, paramsLang);
      if (typeof n === 'string') p.name = n;
      const opts = pickLang(po.options, paramsLang);
      if (Array.isArray(opts)) p.options = opts;
    }
    if (p.group && groups[p.group]) {
      const g = pickLang(groups[p.group], namesLang);
      if (typeof g === 'string') p.group = g;
    }
  }
  return out;
}

async function buildVariant(variant, base, overlay, wabt) {
  const parts = variant.split('-');
  const namesLang = parts[0];
  const paramsLang = parts[1];
  const manifest = JSON.stringify(localize(base, overlay, namesLang, paramsLang));
  const mbytes = Buffer.from(manifest, 'utf8');

  let wat = fs.readFileSync(path.join(ROOT, 'src', WAT_NAME), 'utf8');
  if (!wat.includes('__MANIFEST_BYTES__')) throw new Error('wat: missing __MANIFEST_BYTES__ placeholder');
  wat = wat
    .replace('__MANIFEST_BYTES__', escapeWatString(mbytes))
    .replace('__MANIFEST_LEN__', String(mbytes.length));

  const buildDir = path.join(ROOT, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, `${variant}.wat`), wat, 'utf8');
  fs.writeFileSync(path.join(buildDir, `manifest.${variant}.json`), manifest + '\n');

  // wabt 1.0.39 的词法器对源码里的非 ASCII 字节（只可能出现在注释里）会误报
  // `unexpected char`，所以喂给解析器之前把它们换成空格；写回 build/ 的仍是原文。
  const watForParse = wat.replace(/[^\x00-\x7F]/g, ' ');
  let mod;
  try {
    mod = wabt.parseWat(WAT_NAME, watForParse, {});
    mod.resolveNames();
    mod.validate();
  } catch (e) {
    console.error(`WAT 编译失败 [${variant}]:\n` + (e && e.message ? e.message : e));
    process.exit(1);
  }
  const wasm = Buffer.from(mod.toBinary({ log: false, write_debug_names: false }).buffer);

  const distDir = path.join(ROOT, 'dist', variant);
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, WASM_NAME), wasm);

  const readme = path.join(ROOT, `README.${namesLang}.md`);
  fs.copyFileSync(fs.existsSync(readme) ? readme : path.join(ROOT, 'README.md'), path.join(distDir, 'README.md'));

  const panelDir = path.join(ROOT, 'panel');
  if (fs.existsSync(panelDir)) {
    for (const f of fs.readdirSync(panelDir)) {
      fs.copyFileSync(path.join(panelDir, f), path.join(distDir, f));
    }
  }
  for (const f of PREVIEWS) {
    const p = path.join(ROOT, 'docs', f);
    if (fs.existsSync(p)) {
      fs.mkdirSync(path.join(distDir, 'docs'), { recursive: true });
      fs.copyFileSync(p, path.join(distDir, 'docs', f));
    }
  }

  if (variant === 'zh-zh') { // 旧工具仍指向 dist/mos_收缩/，保留一份别名
    const legacy = path.join(ROOT, 'dist', NAME);
    fs.mkdirSync(legacy, { recursive: true });
    fs.copyFileSync(path.join(distDir, WASM_NAME), path.join(legacy, WASM_NAME));
  }

  console.log(`OK  [${variant}]  wasm ${wasm.length} bytes  manifest ${mbytes.length} bytes  ->  ${distDir}`);
}

async function main() {
  let variants = VARIANTS;
  const variantArg = process.argv.find((a) => a.startsWith('--variant='));
  const langArg = process.argv.find((a) => a.startsWith('--lang='));
  if (variantArg) variants = [variantArg.split('=')[1]];
  else if (langArg) {
    const l = langArg.split('=')[1];
    variants = [`${l}-${l}`];
  }
  for (const v of variants) {
    if (!VARIANTS.includes(v)) throw new Error(`unknown variant ${v} (expected ${VARIANTS.join('|')})`);
  }
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  const overlay = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n.json'), 'utf8'));
  const wabt = await require('wabt')();
  for (const v of variants) await buildVariant(v, base, overlay, wabt);
}

main().catch((e) => { console.error(e); process.exit(1); });
