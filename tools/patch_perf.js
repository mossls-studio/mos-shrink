// One-shot patch: share per-pixel geometry across subsamples + fast path copy.
const fs = require('fs');
const p = 'ae_warp/ae_warp.wat';
let src = fs.readFileSync(p, 'utf8');
const lines = src.split('\n');

function findLine(pred, from) {
  for (let i = from || 0; i < lines.length; i++) if (pred(lines[i])) return i;
  return -1;
}

const iWarp = findLine(l => l.includes('(func $warpAt'));
const iRender = findLine(l => l.includes('(func (export "ec_render")'));
if (iWarp < 0 || iRender < 0) throw new Error('markers not found ' + iWarp + ' ' + iRender);

const newSampling = `  ;; 采样一次（双线性 / 最近邻），结果写 $oR..$oA
  (func $smp (param $x f64) (param $y f64)
    (if (i32.eq (global.get $SAMP) (i32.const 0))
      (then (call $sampleBilinear (local.get $x) (local.get $y)))
      (else (call $sampleNearest (local.get $x) (local.get $y)))))

  ;; 在 (sx,sy) 处做 ns×ns 平均。子样本在源空间按 $sc(=A) 铺开：
  ;; 几何只算一次，每个子样本只多一次取样，省掉 ns×ns 次 u/v/t/A 计算。
  (func $sampAvg (param $ns i32) (param $sx f64) (param $sy f64) (param $sc f64)
    (local $i i32) (local $j i32) (local $step f64) (local $inv f32)
    (local $ox f64) (local $oy f64)
    (if (i32.le_s (local.get $ns) (i32.const 1))
      (then (call $smp (local.get $sx) (local.get $sy)))
      (else
        (global.set $accR (f32.const 0)) (global.set $accG (f32.const 0))
        (global.set $accB (f32.const 0)) (global.set $accA (f32.const 0))
        (local.set $step (f64.div (f64.const 1) (f64.convert_i32_s (local.get $ns))))
        (local.set $j (i32.const 0))
        (block $jend
          (loop $jloop
            (br_if $jend (i32.ge_s (local.get $j) (local.get $ns)))
            (local.set $oy (f64.mul (local.get $sc)
              (f64.sub (f64.mul (local.get $step)
                (f64.add (f64.convert_i32_s (local.get $j)) (f64.const 0.5))) (f64.const 0.5))))
            (local.set $i (i32.const 0))
            (block $iend
              (loop $iloop
                (br_if $iend (i32.ge_s (local.get $i) (local.get $ns)))
                (local.set $ox (f64.mul (local.get $sc)
                  (f64.sub (f64.mul (local.get $step)
                    (f64.add (f64.convert_i32_s (local.get $i)) (f64.const 0.5))) (f64.const 0.5))))
                (call $smp
                  (f64.add (local.get $sx) (local.get $ox))
                  (f64.add (local.get $sy) (local.get $oy)))
                (global.set $accR (f32.add (global.get $accR) (global.get $oR)))
                (global.set $accG (f32.add (global.get $accG) (global.get $oG)))
                (global.set $accB (f32.add (global.get $accB) (global.get $oB)))
                (global.set $accA (f32.add (global.get $accA) (global.get $oA)))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $iloop)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $jloop)))
        (local.set $inv (f32.div (f32.const 1)
          (f32.convert_i32_s (i32.mul (local.get $ns) (local.get $ns)))))
        (global.set $oR (f32.mul (global.get $accR) (local.get $inv)))
        (global.set $oG (f32.mul (global.get $accG) (local.get $inv)))
        (global.set $oB (f32.mul (global.get $accB) (local.get $inv)))
        (global.set $oA (f32.mul (global.get $accA) (local.get $inv))))))
`;

lines.splice(iWarp, iRender - iWarp, ...newSampling.split('\n'));
src = lines.join('\n');

// 主循环：把两次 $avgAt 换成「先算 sx/sy，再一次 $sampAvg，必要时两档混合」
const oldStart = src.indexOf('            (call $avgAt (local.get $lo)');
const oldEndMarker = '                (global.set $oB (local.get $lB)) (global.set $oA (local.get $lA))))';
const oldEnd = src.indexOf(oldEndMarker);
if (oldStart < 0 || oldEnd < 0) throw new Error('loop markers not found');
const newLoop = `            ;; 一次性把该像素的源坐标算出来（几何只算一次）
            (local.set $sx (f64.add (global.get $CX)
              (f64.mul (f64.sub (f64.convert_i32_s (local.get $x)) (global.get $CX)) (local.get $a))))
            (local.set $sy (f64.add (global.get $CY)
              (f64.mul (f64.sub (f64.convert_i32_s (local.get $y)) (global.get $CY)) (local.get $a))))
            (if (f64.lt (f64.abs (f64.sub (local.get $a) (f64.const 1))) (f64.const 0.0000001))
              (then
                ;; 该点完全不动：直接搬原像素，连取样都省掉
                (local.set $px (i32.add (global.get $SRC)
                  (i32.mul (i32.add (i32.mul (local.get $y) (local.get $w)) (local.get $x)) (i32.const 16))))
                (local.set $lR (f32.load (local.get $px)))
                (local.set $lG (f32.load (i32.add (local.get $px) (i32.const 4))))
                (local.set $lB (f32.load (i32.add (local.get $px) (i32.const 8))))
                (local.set $lA (f32.load (i32.add (local.get $px) (i32.const 12))))
                (global.set $oR (local.get $lR)) (global.set $oG (local.get $lG))
                (global.set $oB (local.get $lB)) (global.set $oA (local.get $lA)))
              (else
                (call $sampAvg (local.get $lo) (local.get $sx) (local.get $sy) (local.get $a))
                (local.set $lR (global.get $oR)) (local.set $lG (global.get $oG))
                (local.set $lB (global.get $oB)) (local.set $lA (global.get $oA))
                (if (f64.gt (local.get $wt) (f64.const 0.002))
                  (then
                    (call $sampAvg (i32.add (local.get $lo) (i32.const 1))
                      (local.get $sx) (local.get $sy) (local.get $a))
                    (local.set $w1 (f32.demote_f64 (local.get $wt)))
                    (local.set $w0 (f32.sub (f32.const 1) (local.get $w1)))
                    (global.set $oR (f32.add (f32.mul (local.get $lR) (local.get $w0)) (f32.mul (global.get $oR) (local.get $w1))))
                    (global.set $oG (f32.add (f32.mul (local.get $lG) (local.get $w0)) (f32.mul (global.get $oG) (local.get $w1))))
                    (global.set $oB (f32.add (f32.mul (local.get $lB) (local.get $w0)) (f32.mul (global.get $oB) (local.get $w1))))
                    (global.set $oA (f32.add (f32.mul (local.get $lA) (local.get $w0)) (f32.mul (global.get $oA) (local.get $w1)))))
                  (else
                    (global.set $oR (local.get $lR)) (global.set $oG (local.get $lG))
                    (global.set $oB (local.get $lB)) (global.set $oA (local.get $lA))))))`;
src = src.slice(0, oldStart) + newLoop + src.slice(oldEnd + oldEndMarker.length);

fs.writeFileSync(p, src);
console.log('patched', p);
