(module
  ;; ============================================================
  ;;  mos.ae.warp  /  变形·白点
  ;;  After Effects「扭曲 ▸ 变形」中 变形样式 = 白点 (Fisheye) 的复刻
  ;;
  ;;  采样倍率：  A(u,v) = 1 + k * (1-u²)² * (1-v²)²
  ;;              u = (x - cx)/cx,  v = (y - cy)/cy   （中心 0、边框 ±1）
  ;;              k = -(弯曲/100) * 0.90
  ;;  采样坐标：  src = c + (p - c) * A
  ;;  (1-u²)(1-v²) 在四条边与四个角上恒为 0 → A = 1 → 边界位移严格为 0；
  ;;  整个场是多项式，处处光滑，不会有折痕。
  ;; ============================================================
  (memory (export "memory") 4)
  (data (i32.const 1024) "__MANIFEST_BYTES__")

  (global $ARENA (mut i32) (i32.const 32768))
  (global $SRC (mut i32) (i32.const 0))
  (global $W (mut i32) (i32.const 0))
  (global $H (mut i32) (i32.const 0))
  (global $K (mut f64) (f64.const 0))
  (global $SAMP (mut i32) (i32.const 0))
  (global $QUAL (mut i32) (i32.const 1))
  (global $CX (mut f64) (f64.const 0))
  (global $CY (mut f64) (f64.const 0))
  ;; 一维查找表（每帧按锚点重建）：PX=(1-u²)^1.5 / CX=1/|u|，PY/CY 同理
  (global $TPX (mut i32) (i32.const 0))
  (global $TCX (mut i32) (i32.const 0))
  (global $TPY (mut i32) (i32.const 0))
  (global $TCY (mut i32) (i32.const 0))
  (global $oR (mut f32) (f32.const 0))
  (global $oG (mut f32) (f32.const 0))
  (global $oB (mut f32) (f32.const 0))
  (global $oA (mut f32) (f32.const 0))
  (global $accR (mut f32) (f32.const 0))
  (global $accG (mut f32) (f32.const 0))
  (global $accB (mut f32) (f32.const 0))
  (global $accA (mut f32) (f32.const 0))

  (func $imin (param $a i32) (param $b i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $a) (local.get $b))
      (then (local.get $a)) (else (local.get $b))))

  (func $imax (param $a i32) (param $b i32) (result i32)
    (if (result i32) (i32.gt_s (local.get $a) (local.get $b))
      (then (local.get $a)) (else (local.get $b))))

  ;; 该像素到「本侧」边框的归一化半径：锚点左侧用 ax，右侧用 (last-ax)
  (func $side (param $x f64) (param $c f64) (param $last f64) (result f64)
    (local $r f64)
    (local.set $r (if (result f64) (f64.lt (local.get $x) (local.get $c))
      (then (local.get $c)) (else (f64.sub (local.get $last) (local.get $c)))))
    (if (f64.lt (local.get $r) (f64.const 1)) (then (local.set $r (f64.const 1))))
    (local.get $r))

  ;; 读源图 (ix,iy) 的通道 c
  (func $tex (param $ix i32) (param $iy i32) (param $c i32) (result f32)
    (f32.load (i32.add
      (i32.add (global.get $SRC)
        (i32.mul (i32.add (i32.mul (local.get $iy) (global.get $W)) (local.get $ix)) (i32.const 16)))
      (i32.mul (local.get $c) (i32.const 4)))))

  ;; 双线性采样 → $oR..$oA
  (func $sampleBilinear (param $fx f64) (param $fy f64)
    (local $x0 i32) (local $y0 i32) (local $x1 i32) (local $y1 i32)
    (local $tx f32) (local $ty f32)
    (local $w00 f32) (local $w10 f32) (local $w01 f32) (local $w11 f32)
    (local $b00 i32) (local $b10 i32) (local $b01 i32) (local $b11 i32)
    (local $one f32)

    (local.set $fx (f64.max (f64.const 0)
      (f64.min (f64.convert_i32_s (i32.sub (global.get $W) (i32.const 1))) (local.get $fx))))
    (local.set $fy (f64.max (f64.const 0)
      (f64.min (f64.convert_i32_s (i32.sub (global.get $H) (i32.const 1))) (local.get $fy))))

    (local.set $x0 (i32.trunc_f64_s (local.get $fx)))
    (local.set $y0 (i32.trunc_f64_s (local.get $fy)))
    (local.set $x1 (call $imin (i32.add (local.get $x0) (i32.const 1)) (i32.sub (global.get $W) (i32.const 1))))
    (local.set $y1 (call $imin (i32.add (local.get $y0) (i32.const 1)) (i32.sub (global.get $H) (i32.const 1))))
    (local.set $tx (f32.demote_f64 (f64.sub (local.get $fx) (f64.convert_i32_s (local.get $x0)))))
    (local.set $ty (f32.demote_f64 (f64.sub (local.get $fy) (f64.convert_i32_s (local.get $y0)))))
    (local.set $one (f32.const 1))
    (local.set $w00 (f32.mul (f32.sub (local.get $one) (local.get $tx)) (f32.sub (local.get $one) (local.get $ty))))
    (local.set $w10 (f32.mul (local.get $tx) (f32.sub (local.get $one) (local.get $ty))))
    (local.set $w01 (f32.mul (f32.sub (local.get $one) (local.get $tx)) (local.get $ty)))
    (local.set $w11 (f32.mul (local.get $tx) (local.get $ty)))

    (local.set $b00 (i32.add (global.get $SRC)
      (i32.shl (i32.add (i32.mul (local.get $y0) (global.get $W)) (local.get $x0)) (i32.const 4))))
    (local.set $b10 (i32.add (global.get $SRC)
      (i32.shl (i32.add (i32.mul (local.get $y0) (global.get $W)) (local.get $x1)) (i32.const 4))))
    (local.set $b01 (i32.add (global.get $SRC)
      (i32.shl (i32.add (i32.mul (local.get $y1) (global.get $W)) (local.get $x0)) (i32.const 4))))
    (local.set $b11 (i32.add (global.get $SRC)
      (i32.shl (i32.add (i32.mul (local.get $y1) (global.get $W)) (local.get $x1)) (i32.const 4))))

    (global.set $oR (f32.add
      (f32.add (f32.mul (local.get $w00) (f32.load (local.get $b00)))
               (f32.mul (local.get $w10) (f32.load (local.get $b10))))
      (f32.add (f32.mul (local.get $w01) (f32.load (local.get $b01)))
               (f32.mul (local.get $w11) (f32.load (local.get $b11))))))
    (global.set $oG (f32.add
      (f32.add (f32.mul (local.get $w00) (f32.load offset=4 (local.get $b00)))
               (f32.mul (local.get $w10) (f32.load offset=4 (local.get $b10))))
      (f32.add (f32.mul (local.get $w01) (f32.load offset=4 (local.get $b01)))
               (f32.mul (local.get $w11) (f32.load offset=4 (local.get $b11))))))
    (global.set $oB (f32.add
      (f32.add (f32.mul (local.get $w00) (f32.load offset=8 (local.get $b00)))
               (f32.mul (local.get $w10) (f32.load offset=8 (local.get $b10))))
      (f32.add (f32.mul (local.get $w01) (f32.load offset=8 (local.get $b01)))
               (f32.mul (local.get $w11) (f32.load offset=8 (local.get $b11))))))
    (global.set $oA (f32.add
      (f32.add (f32.mul (local.get $w00) (f32.load offset=12 (local.get $b00)))
               (f32.mul (local.get $w10) (f32.load offset=12 (local.get $b10))))
      (f32.add (f32.mul (local.get $w01) (f32.load offset=12 (local.get $b01)))
               (f32.mul (local.get $w11) (f32.load offset=12 (local.get $b11)))))))

  ;; 最近邻采样 → $oR..$oA
  (func $sampleNearest (param $fx f64) (param $fy f64)
    (local $x i32) (local $y i32)
    (local.set $x (i32.trunc_f64_s (f64.add (local.get $fx) (f64.const 0.5))))
    (local.set $y (i32.trunc_f64_s (f64.add (local.get $fy) (f64.const 0.5))))
    (local.set $x (call $imin (call $imax (local.get $x) (i32.const 0)) (i32.sub (global.get $W) (i32.const 1))))
    (local.set $y (call $imin (call $imax (local.get $y) (i32.const 0)) (i32.sub (global.get $H) (i32.const 1))))
    (global.set $oR (call $tex (local.get $x) (local.get $y) (i32.const 0)))
    (global.set $oG (call $tex (local.get $x) (local.get $y) (i32.const 1)))
    (global.set $oB (call $tex (local.get $x) (local.get $y) (i32.const 2)))
    (global.set $oA (call $tex (local.get $x) (local.get $y) (i32.const 3))))

  ;; ---------------- 导出 ----------------
  (func (export "ec_api_version") (result i32) (i32.const 1))
  (func (export "ec_manifest_ptr") (result i32) (i32.const 1024))
  (func (export "ec_manifest_len") (result i32) (i32.const __MANIFEST_LEN__))

  (func (export "ec_alloc") (param $bytes i32) (result i32)
    (local $need i32) (local $pages i32)
    (local.set $need (i32.add (i32.const 65536)
      (i32.add (global.get $ARENA) (i32.mul (local.get $bytes) (i32.const 2)))))
    (local.set $pages (i32.div_s (i32.add (local.get $need) (i32.const 65535)) (i32.const 65536)))
    (if (i32.lt_s (i32.mul (i32.const 65536) (local.get $pages)) (local.get $need))
      (then (local.set $pages (i32.add (local.get $pages) (i32.const 1)))))
    (if (i32.gt_s (local.get $pages) (memory.size))
      (then (drop (memory.grow (i32.sub (local.get $pages) (memory.size))))))
    (global.get $ARENA))

  ;; 给定（可能是小数）输出坐标，算出采样点并读色到 $oR..$oA
  ;; 采样一次（双线性 / 最近邻），结果写 $oR..$oA
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

  (func (export "ec_render")
    (param $pixels i32) (param $w i32) (param $h i32)
    (param $params i32) (param $nparams i32)
    (param $time f64) (param $scale f64) (result i32)
    (local $x i32) (local $y i32) (local $off i32) (local $px i32)
    (local $u f64) (local $v f64) (local $t f64) (local $a f64)
    (local $sx f64) (local $sy f64) (local $bend f64) (local $lim f64) (local $lim2 f64) (local $ns i32) (local $i i32) (local $j i32) (local $step f64) (local $inv f32) (local $f f64) (local $wt f64) (local $lo i32) (local $lR f32) (local $lG f32) (local $lB f32) (local $lA f32) (local $w0 f32) (local $w1 f32)
    (local $axv f64) (local $ayv f64) (local $pv f32) (local $cxv f32) (local $pyv f32) (local $cyv f32) (local $qx f64) (local $ta i32) (local $tb i32)

    (if (i32.lt_s (local.get $w) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.lt_s (local.get $h) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.lt_s (local.get $nparams) (i32.const 1)) (then (return (i32.const 1))))

    (global.set $W (local.get $w))
    (global.set $H (local.get $h))

    ;; 参数顺序：0 锚点(x,y) | 16 弯曲 | 24 采样 | 32 画质（nparams 是摊平后的 float 数）
    (if (i32.lt_s (local.get $nparams) (i32.const 3)) (then (return (i32.const 1))))
    (local.set $axv (f64.load (local.get $params)))
    (local.set $ayv (f64.load (i32.add (local.get $params) (i32.const 8))))
    (local.set $axv (f64.max (f64.const 0) (f64.min (f64.convert_i32_s (i32.sub (local.get $w) (i32.const 1))) (local.get $axv))))
    (local.set $ayv (f64.max (f64.const 0) (f64.min (f64.convert_i32_s (i32.sub (local.get $h) (i32.const 1))) (local.get $ayv))))

    (local.set $bend (f64.load (i32.add (local.get $params) (i32.const 16))))
    (local.set $bend (f64.max (f64.const -100) (f64.min (f64.const 100) (local.get $bend))))
    (global.set $K (f64.mul (f64.div (f64.neg (local.get $bend)) (f64.const 100)) (f64.const 0.72)))
    ;; 硬性安全钳：p=1.5 的折返临界 k≈1.00，这里永不越过 0.80
    (global.set $K (f64.max (f64.const -0.80) (f64.min (f64.const 0.80) (global.get $K))))

    (if (i32.ge_s (local.get $nparams) (i32.const 4))
      (then
        (global.set $SAMP (i32.trunc_f64_s (f64.load (i32.add (local.get $params) (i32.const 24)))))
        (global.set $SAMP (call $imin (call $imax (global.get $SAMP) (i32.const 0)) (i32.const 1)))))

    (if (i32.ge_s (local.get $nparams) (i32.const 5))
      (then
        (global.set $QUAL (i32.trunc_f64_s (f64.load (i32.add (local.get $params) (i32.const 32)))))
        (global.set $QUAL (call $imin (call $imax (global.get $QUAL) (i32.const 0)) (i32.const 2)))))

    (if (f64.lt (f64.abs (global.get $K)) (f64.const 0.000001)) (then (return (i32.const 0))))

    ;; 备份原图：紧跟在像素缓冲之后
    (global.set $SRC (i32.add (local.get $pixels)
      (i32.mul (i32.mul (local.get $w) (local.get $h)) (i32.const 16))))
    (memory.copy (global.get $SRC) (local.get $pixels)
      (i32.mul (i32.mul (local.get $w) (local.get $h)) (i32.const 16)))

    (global.set $CX (local.get $axv))
    (global.set $CY (local.get $ayv))

    ;; ---------- 每帧建一维表（长度 = w / h，随锚点变化） ----------
    (global.set $TPX (i32.add (global.get $SRC)
      (i32.mul (i32.mul (local.get $w) (local.get $h)) (i32.const 16))))
    (global.set $TCX (i32.add (global.get $TPX) (i32.shl (local.get $w) (i32.const 2))))
    (global.set $TPY (i32.add (global.get $TCX) (i32.shl (local.get $w) (i32.const 2))))
    (global.set $TCY (i32.add (global.get $TPY) (i32.shl (local.get $h) (i32.const 2))))

    (local.set $x (i32.const 0))
    (block $bx (loop $lx
      (br_if $bx (i32.ge_s (local.get $x) (local.get $w)))
      (local.set $u (f64.div
        (f64.sub (f64.convert_i32_s (local.get $x)) (global.get $CX))
        (call $side (f64.convert_i32_s (local.get $x)) (global.get $CX)
          (f64.convert_i32_s (i32.sub (local.get $w) (i32.const 1))))))
      (local.set $qx (f64.max (f64.const 0) (f64.sub (f64.const 1) (f64.mul (local.get $u) (local.get $u)))))
      (local.set $ta (i32.shl (local.get $x) (i32.const 2)))
      (f32.store (i32.add (global.get $TPX) (local.get $ta))
        (f32.demote_f64 (f64.mul (local.get $qx) (f64.sqrt (local.get $qx)))))
      (f32.store (i32.add (global.get $TCX) (local.get $ta))
        (f32.demote_f64 (f64.div (f64.const 1) (f64.max (f64.const 0.0001) (f64.abs (local.get $u))))))
      (local.set $x (i32.add (local.get $x) (i32.const 1)))
      (br $lx)))

    (local.set $y (i32.const 0))
    (block $by (loop $ly
      (br_if $by (i32.ge_s (local.get $y) (local.get $h)))
      (local.set $v (f64.div
        (f64.sub (f64.convert_i32_s (local.get $y)) (global.get $CY))
        (call $side (f64.convert_i32_s (local.get $y)) (global.get $CY)
          (f64.convert_i32_s (i32.sub (local.get $h) (i32.const 1))))))
      (local.set $qx (f64.max (f64.const 0) (f64.sub (f64.const 1) (f64.mul (local.get $v) (local.get $v)))))
      (local.set $ta (i32.shl (local.get $y) (i32.const 2)))
      (f32.store (i32.add (global.get $TPY) (local.get $ta))
        (f32.demote_f64 (f64.mul (local.get $qx) (f64.sqrt (local.get $qx)))))
      (f32.store (i32.add (global.get $TCY) (local.get $ta))
        (f32.demote_f64 (f64.div (f64.const 1) (f64.max (f64.const 0.0001) (f64.abs (local.get $v))))))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $ly)))

    (local.set $y (i32.const 0))
    (block $yend
      (loop $yloop
        (br_if $yend (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $tb (i32.shl (local.get $y) (i32.const 2)))
        (local.set $pyv (f32.load (i32.add (global.get $TPY) (local.get $tb))))
        (local.set $cyv (f32.load (i32.add (global.get $TCY) (local.get $tb))))
        (local.set $x (i32.const 0))
        (block $xend
          (loop $xloop
            (br_if $xend (i32.ge_s (local.get $x) (local.get $w)))
            (local.set $ta (i32.shl (local.get $x) (i32.const 2)))
            (local.set $pv (f32.load (i32.add (global.get $TPX) (local.get $ta))))
            (local.set $cxv (f32.load (i32.add (global.get $TCX) (local.get $ta))))
            ;; A = 1 + k * (1-u²)^1.5 * (1-v²)^1.5 ，再被 1/|u|、1/|v| 夹住不出界
            (local.set $a (f64.add (f64.const 1)
              (f64.mul (global.get $K)
                (f64.mul (f64.promote_f32 (local.get $pv)) (f64.promote_f32 (local.get $pyv))))))
            (local.set $a (f64.min (local.get $a)
              (f64.min (f64.promote_f32 (local.get $cxv)) (f64.promote_f32 (local.get $cyv)))))

            ;; 自适应超采样：缩得越狠、预览分辨率越低，样本越多（压掉亚像素走样）
            ;; 连续 LOD：ns 由缩小倍率决定（0..2），在 lo / hi 两档之间按权重混合，
            ;; 避免「换档」本身造成的画面跳动（低分辨率预览下尤其明显）
            (local.set $f (f64.mul (f64.sub (local.get $a) (f64.const 1.15)) (f64.const 1.6)))
            ;; 不再看宿主传的 scale：超采样只看局部缩小倍率 A，
            ;; 这样宿主换预览缓冲尺寸时画面不会因为「档位变化」而跳。
            (local.set $f (if (result f64) (i32.eq (global.get $QUAL) (i32.const 0)) (then (f64.const 0)) (else (if (result f64) (i32.eq (global.get $QUAL) (i32.const 2)) (then (f64.mul (f64.sub (local.get $a) (f64.const 1.0)) (f64.const 2.5))) (else (local.get $f))))))
            (local.set $f (f64.max (f64.const 0) (f64.min (f64.const 2.0) (local.get $f))))
            (local.set $wt (f64.sub (local.get $f) (f64.convert_i32_s (i32.trunc_f64_s (local.get $f)))))
            (local.set $lo (i32.trunc_f64_s (local.get $f)))
            ;; 一次性把该像素的源坐标算出来（几何只算一次）
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
                    (global.set $oB (local.get $lB)) (global.set $oA (local.get $lA))))))
            (local.set $off (i32.add (local.get $pixels)
              (i32.mul (i32.add (i32.mul (local.get $y) (local.get $w)) (local.get $x)) (i32.const 16))))
            (f32.store (local.get $off) (global.get $oR))
            (f32.store (i32.add (local.get $off) (i32.const 4)) (global.get $oG))
            (f32.store (i32.add (local.get $off) (i32.const 8)) (global.get $oB))
            (f32.store (i32.add (local.get $off) (i32.const 12)) (global.get $oA))

            (local.set $x (i32.add (local.get $x) (i32.const 1)))
            (br $xloop)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $yloop)))

    (i32.const 0))
)
