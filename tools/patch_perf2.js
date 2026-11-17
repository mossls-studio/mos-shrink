// v2 perf patch: per-axis tables for geometry + unrolled f32 bilinear.
const fs = require('fs');
const p = 'ae_warp/ae_warp.wat';
let s = fs.readFileSync(p, 'utf8');

// ---------- 1. 展开版双线性 ----------
const bStart = s.indexOf('  ;; 双线性采样');
const bEnd = s.indexOf('  ;; 最近邻采样');
if (bStart < 0 || bEnd < 0) throw new Error('sampler markers');

const head = `  ;; 双线性采样（展开版）：四角地址只算一次、通道展开、全程 f32
  (func $sampleBilinear (param $fx f64) (param $fy f64)
    (local $x0 i32) (local $y0 i32) (local $x1 i32) (local $y1 i32)
    (local $b00 i32) (local $b10 i32) (local $b01 i32) (local $b11 i32)
    (local $tx f32) (local $ty f32) (local $ax f32) (local $ay f32)
    (local $w00 f32) (local $w10 f32) (local $w01 f32) (local $w11 f32)
    (local.set $fx (f64.max (f64.const 0) (f64.min (f64.convert_i32_s (i32.sub (global.get $W) (i32.const 1))) (local.get $fx))))
    (local.set $fy (f64.max (f64.const 0) (f64.min (f64.convert_i32_s (i32.sub (global.get $H) (i32.const 1))) (local.get $fy))))
    (local.set $x0 (i32.trunc_f64_s (local.get $fx)))
    (local.set $y0 (i32.trunc_f64_s (local.get $fy)))
    (local.set $x1 (call $imin (i32.add (local.get $x0) (i32.const 1)) (i32.sub (global.get $W) (i32.const 1))))
    (local.set $y1 (call $imin (i32.add (local.get $y0) (i32.const 1)) (i32.sub (global.get $H) (i32.const 1))))
    (local.set $tx (f32.demote_f64 (f64.sub (local.get $fx) (f64.convert_i32_s (local.get $x0)))))
    (local.set $ty (f32.demote_f64 (f64.sub (local.get $fy) (f64.convert_i32_s (local.get $y0)))))
    (local.set $ax (f32.sub (f32.const 1) (local.get $tx)))
    (local.set $ay (f32.sub (f32.const 1) (local.get $ty)))
    (local.set $w00 (f32.mul (local.get $ax) (local.get $ay)))
    (local.set $w10 (f32.mul (local.get $tx) (local.get $ay)))
    (local.set $w01 (f32.mul (local.get $ax) (local.get $ty)))
    (local.set $w11 (f32.mul (local.get $tx) (local.get $ty)))
    (local.set $b00 (i32.add (global.get $SRC)
      (i32.mul (i32.add (i32.mul (local.get $y0) (global.get $W)) (local.get $x0)) (i32.const 16))))
    (local.set $b10 (i32.add (local.get $b00) (i32.mul (i32.sub (local.get $x1) (local.get $x0)) (i32.const 16))))
    (local.set $b01 (i32.add (local.get $b00) (i32.mul (i32.mul (i32.sub (local.get $y1) (local.get $y0)) (global.get $W)) (i32.const 16))))
    (local.set $b11 (i32.add (local.get $b10) (i32.mul (i32.mul (i32.sub (local.get $y1) (local.get $y0)) (global.get $W)) (i32.const 16))))
`;

const globals = ['$oR', '$oG', '$oB', '$oA'];
let body = '';
for (let c = 0; c < 4; c++) {
  const g = globals[c], o = c * 4;
  body += `    (global.set ${g} (f32.add (f32.add
      (f32.mul (local.get $w00) (f32.load (i32.add (local.get $b00) (i32.const ${o}))))
      (f32.mul (local.get $w10) (f32.load (i32.add (local.get $b10) (i32.const ${o})))))
      (f32.add
        (f32.mul (local.get $w01) (f32.load (i32.add (local.get $b01) (i32.const ${o}))))
        (f32.mul (local.get $w11) (f32.load (i32.add (local.get $b11) (i32.const ${o})))))))\n`;
}
const samplerText = head + body + ')\n\n';
s = s.slice(0, bStart) + samplerText + s.slice(bEnd);

// ---------- 2. 主循环 a 由两张一维表算出 ----------
const M1 = s.indexOf('(local.set $u (f64.div (f64.sub (f64.convert_i32_s (local.get $x))');
const M2 = s.indexOf('(local.set $f (f64.mul (f64.sub (local.get $a)');
if (M1 < 0 || M2 < 0) throw new Error('loop markers');
const newA = `(local.set $a (f64.add (f64.const 1)
              (f64.mul (global.get $K)
                (f64.mul (f64.promote_f32 (local.get $pv)) (f64.promote_f32 (local.get $pyv))))))
            (local.set $a (f64.min (local.get $a)
              (f64.min (f64.promote_f32 (local.get $cxv)) (f64.promote_f32 (local.get $cyv)))))
            `;
s = s.slice(0, M1) + newA + s.slice(M2);

// ---------- 3. 建表 ----------
const CYMARK = '(global.set $CY (f64.mul (f64.convert_i32_s (i32.sub (local.get $h) (i32.const 1))) (f64.const 0.5)))';
if (s.indexOf(CYMARK) < 0) throw new Error('CY marker');
const tables = `${CYMARK}

    ;; ---- 一维表：P[u]=(1-u²)^1.5，C[u]=1/|u|（逐轴采样上限）----
    (local.set $tpx (i32.add (global.get $SRC)
      (i32.mul (i32.mul (local.get $w) (local.get $h)) (i32.const 16))))
    (local.set $tpy (i32.add (local.get $tpx) (i32.mul (local.get $w) (i32.const 4))))
    (local.set $tcx (i32.add (local.get $tpy) (i32.mul (local.get $h) (i32.const 4))))
    (local.set $tcy (i32.add (local.get $tcx) (i32.mul (local.get $w) (i32.const 4))))
    (local.set $x (i32.const 0))
    (block $pxend
      (loop $pxloop
        (br_if $pxend (i32.ge_s (local.get $x) (local.get $w)))
        (local.set $q (f64.div (f64.sub (f64.convert_i32_s (local.get $x)) (global.get $CX)) (global.get $CX)))
        (local.set $q (f64.max (f64.const 0) (f64.sub (f64.const 1) (f64.mul (local.get $q) (local.get $q)))))
        (f32.store (i32.add (local.get $tpx) (i32.mul (local.get $x) (i32.const 4)))
          (f32.demote_f64 (f64.mul (local.get $q) (f64.sqrt (local.get $q)))))
        (local.set $q (f64.abs (f64.div (f64.sub (f64.convert_i32_s (local.get $x)) (global.get $CX)) (global.get $CX))))
        (f32.store (i32.add (local.get $tcx) (i32.mul (local.get $x) (i32.const 4)))
          (f32.demote_f64 (if (result f64) (f64.gt (local.get $q) (f64.const 0.000001))
            (then (f64.div (f64.const 1) (local.get $q))) (else (f64.const 1000000)))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $pxloop)))
    (local.set $y (i32.const 0))
    (block $pyend
      (loop $pyloop
        (br_if $pyend (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $q (f64.div (f64.sub (f64.convert_i32_s (local.get $y)) (global.get $CY)) (global.get $CY)))
        (local.set $q (f64.max (f64.const 0) (f64.sub (f64.const 1) (f64.mul (local.get $q) (local.get $q)))))
        (f32.store (i32.add (local.get $tpy) (i32.mul (local.get $y) (i32.const 4)))
          (f32.demote_f64 (f64.mul (local.get $q) (f64.sqrt (local.get $q)))))
        (local.set $q (f64.abs (f64.div (f64.sub (f64.convert_i32_s (local.get $y)) (global.get $CY)) (global.get $CY))))
        (f32.store (i32.add (local.get $tcy) (i32.mul (local.get $y) (i32.const 4)))
          (f32.demote_f64 (if (result f64) (f64.gt (local.get $q) (f64.const 0.000001))
            (then (f64.div (f64.const 1) (local.get $q))) (else (f64.const 1000000)))))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $pyloop)))`;
s = s.replace(CYMARK, tables);

// ---------- 4. 行/列取值 ----------
s = s.replace(
  '        (local.set $v (f64.div (f64.sub (f64.convert_i32_s (local.get $y)) (global.get $CY)) (global.get $CY)))',
  `        (local.set $pyv (f32.load (i32.add (local.get $tpy) (i32.mul (local.get $y) (i32.const 4)))))
        (local.set $cyv (f32.load (i32.add (local.get $tcy) (i32.mul (local.get $y) (i32.const 4)))))`);
const aMark = '            (local.set $a (f64.add (f64.const 1)';
if (s.indexOf(aMark) < 0) throw new Error('a marker');
s = s.replace(aMark,
  `            (local.set $pv (f32.load (i32.add (local.get $tpx) (i32.mul (local.get $x) (i32.const 4)))))
            (local.set $cxv (f32.load (i32.add (local.get $tcx) (i32.mul (local.get $x) (i32.const 4)))))
            (local.set $a (f64.add (f64.const 1)`);

// ---------- 5. 局部变量 ----------
s = s.replace('(local $sx f64) (local $sy f64) (local $bend f64)',
  '(local $sx f64) (local $sy f64) (local $bend f64) (local $tpx i32) (local $tpy i32) (local $tcx i32) (local $tcy i32) (local $pv f32) (local $pyv f32) (local $cxv f32) (local $cyv f32) (local $q f64)');

// ---------- 6. 表空间 ----------
s = s.replace('(i32.add (global.get $ARENA) (i32.mul (local.get $bytes) (i32.const 2)))',
  '(i32.add (i32.add (global.get $ARENA) (i32.mul (local.get $bytes) (i32.const 2))) (i32.const 262144))');

fs.writeFileSync(p, s);
console.log('patched v2');
