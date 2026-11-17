;; mos_收缩 — EffectCraft effect plugin (ABI 1)
;; Anchor-based radial pinch.  For every pixel the sampling scale f is
;;   src = anchor + (p - anchor) * f
;; and f is built so that the frame border stays exactly in place:
;;
;;   k(t) = amount * bezier(clamp(1 - t/radius, 0, 1))      (t = px from anchor)
;;   A(t) = 1 / (1 - k(t))                                  (radial density)
;;   C(t) = integral of A from 0 to t                       (cumulative LUT)
;;   L    = distance from the anchor to the border along this ray
;;   f    = (L / r) * C(r) / C(L)                           (mode 0: border pinned)
;;
;; C(r)/C(L) renormalises each ray so C(L) maps onto L: monotone along the ray,
;; border fixed by construction, no fade band and no fold-back.
;; Mode 1 (四角固定) keeps the raw 1/(1-k) scale and only pins the four corners.
(module
  (memory (export "memory") 2)
  ;; ---- manifest (utf-8 json, injected by build.js) ----
  (data (i32.const 1024) "__MANIFEST_BYTES__")
  (global $man_len i32 (i32.const __MANIFEST_LEN__))
  ;; ---- memory layout ----
  ;; 0      .. 1024   reserved
  ;; 1024   .. +man   manifest
  ;; 8192   .. 12292  cumulative density LUT C(t)  (1025 * f32)
  ;; 12292  .. 16396  curve LUT k(t)               (1025 * f32)
  ;; 32768  ..        arena returned by ec_alloc
  (global $LUTC i32 (i32.const 8192))
  (global $LUTK i32 (i32.const 12292))
  (global $ARENA i32 (i32.const 32768))
  (global $pages (mut i32) (i32.const 2))
  ;; ---- per-render state ----
  (global $W (mut i32) (i32.const 1))
  (global $H (mut i32) (i32.const 1))
  (global $SRC (mut i32) (i32.const 0))
  (global $EMODE (mut i32) (i32.const 0))
  (global $SAMP (mut i32) (i32.const 0))
  (global $oR (mut f64) (f64.const 0))
  (global $oG (mut f64) (f64.const 0))
  (global $oB (mut f64) (f64.const 0))
  (global $oA (mut f64) (f64.const 0))
  (global $x1 (mut f64) (f64.const 0.33))
  (global $y1 (mut f64) (f64.const 0))
  (global $x2 (mut f64) (f64.const 0.67))
  (global $y2 (mut f64) (f64.const 1))
  (global $k0 (mut f64) (f64.const 0))
  (global $RAD (mut f64) (f64.const 100))
  (global $LMAX (mut f64) (f64.const 100))
  (global $INVLMAX (mut f64) (f64.const 0.01))
  ;; ================= tiny helpers =================
  (func $imin (param $a i32) (param $b i32) (result i32)
    local.get $a local.get $b local.get $a local.get $b i32.lt_s select)
  (func $idiv (param $a i32) (param $b i32) (result i32)
    ;; b > 0
    local.get $a local.get $b i32.rem_s local.get $b i32.add local.get $b i32.rem_s)
  ;; wrap a coordinate into [0,n)
  (func $wrap (param $i i32) (param $n i32) (param $m i32) (result i32)
    (local $r i32) (local $p i32)
    local.get $i i32.const 0 i32.ge_s
    local.get $i local.get $n i32.lt_s
    i32.and
    (if (then local.get $i return))
    local.get $m i32.eqz
    (if (then
      local.get $i i32.const 0 i32.lt_s
      (if (then i32.const 0 return))
      local.get $n i32.const 1 i32.sub return))
    local.get $m i32.const 1 i32.eq
    (if (then
      local.get $i local.get $n call $idiv return))
    ;; mirror
    local.get $n i32.const 2 i32.mul local.set $p
    local.get $i local.get $p call $idiv local.set $r
    local.get $r local.get $n i32.lt_s
    (if (then local.get $r return))
    local.get $p i32.const 1 i32.sub local.get $r i32.sub)
  ;; ================= cubic bezier easing f(q) =================
  ;; control points (0,0) (x1,y1) (x2,y2) (1,1); x monotonic since x1,x2 in [0,1]
  (func $bez (param $u f64) (result f64)
    (local $t f64) (local $i i32) (local $om f64) (local $t2 f64)
    (local $xx f64) (local $dd f64)
    local.get $u local.set $t
    (block $done
      (loop $it
        local.get $i i32.const 12 i32.ge_s br_if $done
        f64.const 1 local.get $t f64.sub local.set $om
        local.get $t local.get $t f64.mul local.set $t2
        ;; xx = 3*om^2*t*x1 + 3*om*t^2*x2 + t^3
        f64.const 3
        local.get $om local.get $om f64.mul
        local.get $t f64.mul
        global.get $x1 f64.mul
        f64.mul
        f64.const 3
        local.get $om f64.mul
        local.get $t2 f64.mul
        global.get $x2 f64.mul
        f64.add
        local.get $t2 local.get $t f64.mul
        f64.add
        local.set $xx
        ;; dd = 3*om^2*x1 + 6*om*t*(x2-x1) + 3*t^2*(1-x2)
        f64.const 3
        local.get $om local.get $om f64.mul
        global.get $x1 f64.mul
        f64.mul
        f64.const 6
        local.get $om f64.mul
        local.get $t f64.mul
        global.get $x2 global.get $x1 f64.sub
        f64.mul
        f64.add
        f64.const 3
        local.get $t2 f64.mul
        f64.const 1 global.get $x2 f64.sub
        f64.mul
        f64.add
        local.set $dd
        local.get $dd f64.abs f64.const 0.000000001 f64.lt
        br_if $done
        local.get $t
        local.get $xx local.get $u f64.sub local.get $dd f64.div
        f64.sub
        f64.const 0 f64.max
        f64.const 1 f64.min
        local.set $t
        local.get $i i32.const 1 i32.add local.set $i
        br $it))
    ;; y(t)
    f64.const 1 local.get $t f64.sub local.set $om
    local.get $t local.get $t f64.mul local.set $t2
    f64.const 3
    local.get $om local.get $om f64.mul
    local.get $t f64.mul
    global.get $y1 f64.mul
    f64.mul
    f64.const 3
    local.get $om f64.mul
    local.get $t2 f64.mul
    global.get $y2 f64.mul
    f64.add
    local.get $t2 local.get $t f64.mul
    f64.add)
  ;; A(u) = 1 + amount * bez(u) over u in [0,1], linear interpolation of the 1025-entry table
  (func $lutA (param $z f64) (result f64)
    (local $u f64) (local $i i32) (local $fr f64) (local $a f64)
    local.get $z f64.const 0 f64.max f64.const 1 f64.min
    f64.const 1024 f64.mul
    local.set $u
    local.get $u f64.floor i32.trunc_f64_s local.set $i
    local.get $i i32.const 1023 i32.gt_s (if (then i32.const 1023 local.set $i))
    global.get $LUTC local.get $i i32.const 2 i32.shl i32.add f32.load f64.promote_f32
    local.set $a
    local.get $u local.get $i f64.convert_i32_s f64.sub local.set $fr
    local.get $a
    global.get $LUTC local.get $i i32.const 2 i32.shl i32.add i32.const 4 i32.add
    f32.load f64.promote_f32
    local.get $a f64.sub
    local.get $fr f64.mul
    f64.add)
  ;; build A(u) = 1 + k0 * bez(u)
  (func $buildLut
    (local $i i32) (local $u f64)
    i32.const 0 local.set $i
    (block $e
      (loop $l
        local.get $i i32.const 1025 i32.ge_s br_if $e
        local.get $i f64.convert_i32_s f64.const 1024 f64.div local.set $u
        global.get $LUTC local.get $i i32.const 2 i32.shl i32.add
        f64.const 1
        global.get $k0 local.get $u call $bez f64.mul
        f64.add
        f32.demote_f64 f32.store
        local.get $i i32.const 1 i32.add local.set $i
        br $l)))
  ;; ================= sampling accumulation =================
  ;; add wg * src(ix,iy) to (oR,oG,oB,oA); honours boundary mode
  (func $acc (param $ix i32) (param $iy i32) (param $wg f64)
    (local $x i32) (local $y i32) (local $a i32)
    global.get $EMODE i32.const 3 i32.eq
    (if (then
      local.get $ix i32.const 0 i32.lt_s
      local.get $ix global.get $W i32.ge_s
      i32.or
      local.get $iy i32.const 0 i32.lt_s
      i32.or
      local.get $iy global.get $H i32.ge_s
      i32.or
      (if (then return))))
    local.get $ix global.get $W global.get $EMODE call $wrap local.set $x
    local.get $iy global.get $H global.get $EMODE call $wrap local.set $y
    global.get $SRC
    local.get $y global.get $W i32.mul local.get $x i32.add
    i32.const 4 i32.shl
    i32.add
    local.set $a
    global.get $oR local.get $a f32.load f64.promote_f32 local.get $wg f64.mul f64.add global.set $oR
    global.get $oG local.get $a f32.load offset=4 f64.promote_f32 local.get $wg f64.mul f64.add global.set $oG
    global.get $oB local.get $a f32.load offset=8 f64.promote_f32 local.get $wg f64.mul f64.add global.set $oB
    global.get $oA local.get $a f32.load offset=12 f64.promote_f32 local.get $wg f64.mul f64.add global.set $oA)
  (func $samp_nn (param $fx f64) (param $fy f64)
    local.get $fx f64.const 0.5 f64.add f64.floor i32.trunc_f64_s
    local.get $fy f64.const 0.5 f64.add f64.floor i32.trunc_f64_s
    f64.const 1 call $acc)
  (func $samp_bl (param $fx f64) (param $fy f64)
    (local $x0 i32) (local $y0 i32) (local $tx f64) (local $ty f64)
    (local $ax f64) (local $bx f64) (local $cx f64) (local $dx f64)
    local.get $fx f64.floor local.set $ax
    local.get $fx local.get $ax f64.sub local.set $tx
    local.get $fy f64.floor local.set $bx
    local.get $fy local.get $bx f64.sub local.set $ty
    local.get $ax i32.trunc_f64_s local.set $x0
    local.get $bx i32.trunc_f64_s local.set $y0
    f64.const 1 local.get $tx f64.sub local.set $cx
    f64.const 1 local.get $ty f64.sub local.set $dx
    local.get $x0 local.get $y0
    local.get $cx local.get $dx f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0
    local.get $tx local.get $dx f64.mul call $acc
    local.get $x0 local.get $y0 i32.const 1 i32.add
    local.get $cx local.get $ty f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0 i32.const 1 i32.add
    local.get $tx local.get $ty f64.mul call $acc)
  ;; Catmull-Rom weights for taps -1,0,1,2 at fraction t
  (func $bcw (param $t f64) (param $k i32) (result f64)
    (local $r f64)
    local.get $k i32.eqz
    (if (then
      ;; -0.5t^3 + t^2 - 0.5t
      f64.const -0.5 local.get $t f64.mul f64.const 1 f64.add
      local.get $t f64.mul f64.const 0.5 f64.sub
      local.get $t f64.mul return))
    local.get $k i32.const 1 i32.eq
    (if (then
      ;; 1.5t^3 - 2.5t^2 + 1
      f64.const 1.5 local.get $t f64.mul f64.const 2.5 f64.sub
      local.get $t f64.mul local.get $t f64.mul f64.const 1 f64.add return))
    local.get $k i32.const 2 i32.eq
    (if (then
      ;; -1.5t^3 + 2t^2 + 0.5t
      f64.const -1.5 local.get $t f64.mul f64.const 2 f64.add
      local.get $t f64.mul f64.const 0.5 f64.add
      local.get $t f64.mul return))
    ;; 0.5t^3 - 0.5t^2
    local.get $t f64.const 0.5 f64.mul f64.const 0.5 f64.sub
    local.get $t f64.mul local.get $t f64.mul)
  (func $samp_bc (param $fx f64) (param $fy f64)
    (local $x0 i32) (local $y0 i32) (local $tx f64) (local $ty f64)
    (local $w0 f64) (local $w1 f64) (local $w2 f64) (local $w3 f64)
    (local $v0 f64) (local $v1 f64) (local $v2 f64) (local $v3 f64)
    local.get $fx f64.floor i32.trunc_f64_s local.set $x0
    local.get $fy f64.floor i32.trunc_f64_s local.set $y0
    local.get $fx local.get $x0 f64.convert_i32_s f64.sub local.set $tx
    local.get $fy local.get $y0 f64.convert_i32_s f64.sub local.set $ty
    (local.set $w0 (call $bcw (local.get $tx) (i32.const 0)))
    (local.set $w1 (call $bcw (local.get $tx) (i32.const 1)))
    (local.set $w2 (call $bcw (local.get $tx) (i32.const 2)))
    (local.set $w3 (call $bcw (local.get $tx) (i32.const 3)))
    (local.set $v0 (call $bcw (local.get $ty) (i32.const 0)))
    (local.set $v1 (call $bcw (local.get $ty) (i32.const 1)))
    (local.set $v2 (call $bcw (local.get $ty) (i32.const 2)))
    (local.set $v3 (call $bcw (local.get $ty) (i32.const 3)))
    ;; rows y0-1 .. y0+2
    local.get $x0 i32.const 1 i32.sub local.get $y0 i32.const 1 i32.sub
    local.get $w0 local.get $v0 f64.mul call $acc
    local.get $x0 local.get $y0 i32.const 1 i32.sub
    local.get $w1 local.get $v0 f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0 i32.const 1 i32.sub
    local.get $w2 local.get $v0 f64.mul call $acc
    local.get $x0 i32.const 2 i32.add local.get $y0 i32.const 1 i32.sub
    local.get $w3 local.get $v0 f64.mul call $acc
    local.get $x0 i32.const 1 i32.sub local.get $y0
    local.get $w0 local.get $v1 f64.mul call $acc
    local.get $x0 local.get $y0
    local.get $w1 local.get $v1 f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0
    local.get $w2 local.get $v1 f64.mul call $acc
    local.get $x0 i32.const 2 i32.add local.get $y0
    local.get $w3 local.get $v1 f64.mul call $acc
    local.get $x0 i32.const 1 i32.sub local.get $y0 i32.const 1 i32.add
    local.get $w0 local.get $v2 f64.mul call $acc
    local.get $x0 local.get $y0 i32.const 1 i32.add
    local.get $w1 local.get $v2 f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0 i32.const 1 i32.add
    local.get $w2 local.get $v2 f64.mul call $acc
    local.get $x0 i32.const 2 i32.add local.get $y0 i32.const 1 i32.add
    local.get $w3 local.get $v2 f64.mul call $acc
    local.get $x0 i32.const 1 i32.sub local.get $y0 i32.const 2 i32.add
    local.get $w0 local.get $v3 f64.mul call $acc
    local.get $x0 local.get $y0 i32.const 2 i32.add
    local.get $w1 local.get $v3 f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0 i32.const 2 i32.add
    local.get $w2 local.get $v3 f64.mul call $acc
    local.get $x0 i32.const 2 i32.add local.get $y0 i32.const 2 i32.add
    local.get $w3 local.get $v3 f64.mul call $acc)
  (func $sample (param $fx f64) (param $fy f64)
    f64.const 0 global.set $oR
    f64.const 0 global.set $oG
    f64.const 0 global.set $oB
    f64.const 0 global.set $oA
    global.get $SAMP i32.eqz
    (if (then local.get $fx local.get $fy call $samp_bl return))
    global.get $SAMP i32.const 2 i32.eq
    (if (then local.get $fx local.get $fy call $samp_nn return))
    local.get $fx local.get $fy call $samp_bc)
  ;; ================= ABI =================
  (func (export "ec_api_version") (result i32) i32.const 1)
  (func (export "ec_manifest_ptr") (result i32) i32.const 1024)
  (func (export "ec_manifest_len") (result i32) global.get $man_len)
  (func (export "ec_alloc") (param $n i32) (result i32)
    (local $need i32) (local $want i32) (local $max i32)
    local.get $n i32.const 2 i32.mul
    global.get $ARENA i32.add
    i32.const 65536 i32.add
    local.set $need
    local.get $need
    global.get $pages i32.const 16 i32.shl
    i32.gt_u
    (if (then
      local.get $need i32.const 65535 i32.add i32.const 16 i32.shr_u
      local.set $want
      local.get $want global.get $pages i32.sub
      memory.grow
      drop
      local.get $want global.set $pages))
    global.get $ARENA)
  (func (export "ec_render")
    (param $pixels i32) (param $w i32) (param $h i32)
    (param $params i32) (param $nparams i32)
    (param $time f64) (param $scale f64) (result i32)
    (local $amount f64) (local $ax f64) (local $ay f64) (local $rad f64)
    (local $pinmode i32) (local $mixv f64) (local $dmin f64)
    (local $total i32) (local $i i32) (local $x i32) (local $y i32) (local $row i32)
    (local $dx f64) (local $dy f64) (local $dist f64) (local $f f64)
    (local $txn f64) (local $tyn f64) (local $lmin f64) (local $cl f64) (local $cr f64)
    (local $k f64) (local $fp f64) (local $cw f64) (local $dcx f64) (local $dcy f64)
    (local $sx f64) (local $sy f64) (local $wf f64)
    (local $rx f64) (local $ry f64) (local $kx f64) (local $ky f64)
    (local $w1 f64) (local $h1 f64)
    (local $off i32) (local $r0 f64) (local $g0 f64) (local $b0 f64) (local $a0 f64)
    local.get $w i32.const 0 i32.le_s
    local.get $h i32.const 0 i32.le_s
    i32.or
    local.get $nparams i32.const 11 i32.lt_s
    i32.or
    (if (then i32.const 1 return))
    ;; --- read params (11 f64) ---
    local.get $params f64.load f64.const 100 f64.div
    f64.const -0.9 f64.max f64.const 0.95 f64.min
    local.set $amount
    local.get $params f64.load offset=8 local.set $ax
    local.get $params f64.load offset=16 local.set $ay
    local.get $params f64.load offset=32 global.set $x1
    local.get $params f64.load offset=40 global.set $y1
    local.get $params f64.load offset=48 global.set $x2
    local.get $params f64.load offset=56 global.set $y2
    local.get $params f64.load offset=64 i32.trunc_f64_s local.set $pinmode
    local.get $pinmode i32.const 0 i32.lt_s (if (then i32.const 0 local.set $pinmode))
    local.get $pinmode i32.const 1 i32.gt_s (if (then i32.const 1 local.set $pinmode))
    local.get $params f64.load offset=88 f64.const 100 f64.div
    f64.const 0 f64.max f64.const 1 f64.min local.set $mixv
    local.get $params f64.load offset=72 i32.trunc_f64_s local.set $i
    local.get $i i32.const 0 i32.lt_s (if (then i32.const 0 local.set $i))
    local.get $i i32.const 2 i32.gt_s (if (then i32.const 2 local.set $i))
    local.get $i global.set $SAMP
    local.get $params f64.load offset=80 i32.trunc_f64_s local.set $i
    local.get $i i32.const 0 i32.lt_s (if (then i32.const 0 local.set $i))
    local.get $i i32.const 3 i32.gt_s (if (then i32.const 3 local.set $i))
    local.get $i global.set $EMODE
    local.get $amount f64.abs f64.const 0.0001 f64.lt
    local.get $mixv f64.const 0.0001 f64.lt
    i32.or
    (if (then i32.const 0 return))
    local.get $w global.set $W
    local.get $h global.set $H
    local.get $w i32.const 1 i32.sub f64.convert_i32_s local.set $w1
    local.get $h i32.const 1 i32.sub f64.convert_i32_s local.set $h1
    ;; anchor clamped into the frame (border pin needs it inside)
    local.get $ax f64.const 0 f64.max local.get $w1 f64.min local.set $ax
    local.get $ay f64.const 0 f64.max local.get $h1 f64.min local.set $ay
    local.get $w local.get $h call $imin f64.convert_i32_s local.set $dmin
    local.get $params f64.load offset=24 f64.const 100 f64.div
    local.get $dmin f64.mul
    f64.const 0.5 f64.max local.set $rad
    local.get $rad global.set $RAD
    ;; 强度标定：±100 ≈ AE 变形(白点) 的弯曲 ±100
    local.get $amount f64.const 0.5 f64.mul global.set $k0
    ;; 不固定 = AE「白点(鱼眼)」：圆形范围、半径按半对角线算（100% = 圆正好穿过四角），
    ;; 强度按 ±100 ≈ AE 弯曲 ±100 缩放
    local.get $pinmode
    (if (then
      local.get $params f64.load offset=24 f64.const 100 f64.div
      local.get $w f64.convert_i32_s local.get $w f64.convert_i32_s f64.mul
      local.get $h f64.convert_i32_s local.get $h f64.convert_i32_s f64.mul
      f64.add f64.sqrt
      f64.mul
      f64.const 0.5 f64.max local.set $rad
      local.get $rad global.set $RAD
      ))

    ;; --- copy frame to scratch ---
    local.get $w local.get $h i32.mul i32.const 16 i32.mul local.set $total
    local.get $pixels local.get $total i32.add global.set $SRC
    call $buildLut
    i32.const 0 local.set $i
    (block $cend
      (loop $cl
        local.get $i local.get $total i32.ge_u br_if $cend
        global.get $SRC local.get $i i32.add
        local.get $pixels local.get $i i32.add
        i64.load
        i64.store
        local.get $i i32.const 8 i32.add local.set $i
        br $cl))
    ;; --- main loop ---
    i32.const 0 local.set $y
    (block $yend
      (loop $yl
        local.get $y local.get $h i32.ge_s br_if $yend
        local.get $y local.get $w i32.mul i32.const 16 i32.mul local.set $row
        i32.const 0 local.set $x
        (block $xend
          (loop $xl
            local.get $x local.get $w i32.ge_s br_if $xend
            local.get $x f64.convert_i32_s local.get $ax f64.sub local.set $dx
            local.get $y f64.convert_i32_s local.get $ay f64.sub local.set $dy
            local.get $row local.get $x i32.const 4 i32.shl i32.add local.set $off
            ;; keep the original pixel, then overwrite only when we actually displace
            local.get $pixels local.get $off i32.add
            global.get $SRC local.get $off i32.add
            i64.load
            i64.store
            local.get $pixels local.get $off i32.add i32.const 8 i32.add
            global.get $SRC local.get $off i32.add i32.const 8 i32.add
            i64.load
            i64.store
            ;; --- elliptical fisheye map (AE Distort > Warp > 白点 style) ---
            ;; e = sqrt((dx/rx)^2 + (dy/ry)^2), A = 1 + amount*bez(1 - e)
            ;; 用椭圆归一化而不是射线距离：等值线处处光滑，不会在对角线上出现折边
            local.get $dx f64.abs f64.const 0.000001 f64.lt
            local.get $dy f64.abs f64.const 0.000001 f64.lt
            i32.and
            (if (then
              local.get $x i32.const 1 i32.add local.set $x
              br $xl))
            ;; rx / ry：锚点到该侧边框的距离，再被「半径」截断（不固定模式直接取半径）
            local.get $pinmode
            (if (then
              local.get $rad local.set $rx
              local.get $rad local.set $ry))
            local.get $pinmode
            i32.eqz
            (if (then
              local.get $ax local.set $rx
              local.get $dx f64.const 0 f64.ge
              (if (then
                local.get $w1 local.get $ax f64.sub local.set $rx))
              local.get $ay local.set $ry
              local.get $dy f64.const 0 f64.ge
              (if (then
                local.get $h1 local.get $ay f64.sub local.set $ry))
              local.get $rx local.get $rad f64.min local.set $rx
              local.get $ry local.get $rad f64.min local.set $ry))
            local.get $rx f64.const 0.000001 f64.max local.set $rx
            local.get $ry f64.const 0.000001 f64.max local.set $ry
            local.get $dx local.get $rx f64.div f64.abs local.set $kx
            local.get $dy local.get $ry f64.div f64.abs local.set $sx
            ;; 不固定模式：圆形范数（AE 鱼眼）；固定模式：16 次幂超椭圆（贴住矩形边框）
            local.get $pinmode
            (if (then
              local.get $kx local.get $kx f64.mul
              local.get $sx local.get $sx f64.mul f64.add f64.sqrt
              local.set $dist)
            (else
            ;; a^16 + b^16 : high order superellipse, smooth (no crease) yet close to the frame
            local.get $kx local.get $kx f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul local.set $sy
            local.get $sx local.get $sx f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul local.set $wf
            local.get $wf local.get $wf f64.mul
            local.get $sy f64.add
            f64.sqrt f64.sqrt f64.sqrt f64.sqrt
            local.set $dist
            ))
            local.get $dist f64.const 0.000001 f64.lt
            (if (then
              local.get $x i32.const 1 i32.add local.set $x
              br $xl))
            f64.const 1 local.get $dist f64.sub call $lutA local.set $kx
            local.get $kx f64.const 1 f64.sub f64.abs f64.const 0.0000001 f64.lt
            (if (then
              local.get $x i32.const 1 i32.add local.set $x
              br $xl))
            local.get $kx f64.const 0.01 f64.max f64.const 60 f64.min local.set $kx
            ;; pinned mode only: never sample outside the layer (cap by the distance left to each border).
            ;; 不固定 mode lets the scale run free: the effect reaches the borders like AE's Fisheye,
            ;; and whatever falls outside is filled by the 越界 mode.
            local.get $pinmode i32.eqz
            (if (then
            local.get $dx f64.const 0 f64.ne
            (if (then
              local.get $dx f64.const 0 f64.gt
              (if (then
                local.get $w1 local.get $ax f64.sub local.get $dx f64.div local.set $sy)
                (else
                  local.get $ax local.get $dx f64.neg f64.div local.set $sy))
              local.get $kx local.get $sy f64.min local.set $kx))
            local.get $dy f64.const 0 f64.ne
            (if (then
              local.get $dy f64.const 0 f64.gt
              (if (then
                local.get $h1 local.get $ay f64.sub local.get $dy f64.div local.set $sy)
                (else
                  local.get $ay local.get $dy f64.neg f64.div local.set $sy))
              local.get $kx local.get $sy f64.min local.set $kx))
            ))
            local.get $ax local.get $dx local.get $kx f64.mul f64.add local.set $sx
            local.get $ay local.get $dy local.get $kx f64.mul f64.add local.set $sy
            local.get $sx local.get $sy call $sample
            local.get $mixv local.set $wf
            global.get $SRC local.get $off i32.add f32.load f64.promote_f32 local.set $r0
            global.get $SRC local.get $off i32.add f32.load offset=4 f64.promote_f32 local.set $g0
            global.get $SRC local.get $off i32.add f32.load offset=8 f64.promote_f32 local.set $b0
            global.get $SRC local.get $off i32.add f32.load offset=12 f64.promote_f32 local.set $a0
            local.get $pixels local.get $off i32.add
            local.get $r0 global.get $oR local.get $r0 f64.sub local.get $wf f64.mul f64.add
            f32.demote_f64 f32.store
            local.get $pixels local.get $off i32.add i32.const 4 i32.add
            local.get $g0 global.get $oG local.get $g0 f64.sub local.get $wf f64.mul f64.add
            f32.demote_f64 f32.store
            local.get $pixels local.get $off i32.add i32.const 8 i32.add
            local.get $b0 global.get $oB local.get $b0 f64.sub local.get $wf f64.mul f64.add
            f32.demote_f64 f32.store
            local.get $pixels local.get $off i32.add i32.const 12 i32.add
            local.get $a0 global.get $oA local.get $a0 f64.sub local.get $wf f64.mul f64.add
            f32.demote_f64 f32.store
            local.get $x i32.const 1 i32.add local.set $x
            br $xl))
        local.get $y i32.const 1 i32.add local.set $y
        br $yl))
    i32.const 0)
)
