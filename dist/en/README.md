# mos_收缩 (mos.shrink)

EffectCraft 效果插件：以**可移动锚点**为中心的**径向收缩 / 膨胀**（AE「扭曲 ▸ 变形 ▸ 白点」那种鱼眼观感），可选**边缘固定**，收缩强度沿**可编辑的贝塞尔曲线**从边框插值到锚点。

- 效果 ID：`mos.shrink` ｜ 显示名：`mos_收缩` ｜ 分类：`MOS` ｜ 版本：`1.3.4`
- 平台：桌面版 / CLI（wasmi 沙箱，无 import、无网络、无文件）；不支持 Web 版
- 产物：`mos_shrink.wasm`（约 4.5 KB）+ 面板 `mos_收缩曲线.jsx`

## 安装

方式 A（推荐，一次装好效果 + 面板）

    Effect ▸ Install Effect Plug-in…   → 选 dist\mos_收缩\mos_shrink.wasm
    File ▸ Scripts ▸ Install ScriptUI Panel… → 选 dist\mos_收缩\mos_收缩曲线.jsx

方式 B（整个文件夹）

    effect.plugins.install {"folder": "dist\\mos_收缩"}

方式 C（手动）

    复制 mos_shrink.wasm     → %APPDATA%\EffectCraft\Plug-ins\
    复制 mos_收缩曲线.jsx    → %APPDATA%\EffectCraft\Scripts\ScriptUI Panels\

> 安装不会覆盖同名文件：升级前先把旧文件删掉。
> 效果随应用启动加载；装好后重开应用。
> 面板在 **Window 菜单最底部**（条目名就是文件名 `mos_收缩曲线.jsx`），可停靠成 tab。

## 参数（Effect Controls 里 11 项）

| # | 名称 | 类型 | 默认 | 说明 |
|---|------|------|------|------|
| 1 | 收缩量 % | slider −100…100 | 40 | 正数向内收缩，负数向外膨胀 |
| 2 | 锚点 | point | 图层中心 | 收缩中心，可在 Comp 面板里用十字直接拖 |
| 3 | 半径 % | slider 1…400 | 100 | 影响力的最大半径（相对图层短边）；「全部固定」时还能把收缩限制在离锚点一定距离内 |
| 4–7 | 曲线 X1/Y1/X2/Y2 | slider | 0/0/1/1 | 收缩强度从边框到锚点的插值曲线（三次贝塞尔） |
| 8 | 边缘固定 | popup | 固定 | **固定（四边+四角）** ／ **不固定（只按半径）** |
| 9 | 采样 | popup | 双线性 | 双线性 / 双三次 / 最近邻 |
| 10 | 越界（四角固定时） | popup | 拉伸边缘 | 拉伸边缘 / 重复 / 镜像 / 透明 —— 只有「四角固定」时采样才会越界 |
| 11 | 混合 % | slider 0…100 | 100 | 与原图的混合量 |

## 算法（径向鱼眼，对齐 AE 扭曲 ▸ 变形 ▸ 白点）

以锚点为中心的**径向**映射，边框处缩放为 1（钉死），越靠近锚点缩放越大：

    a,b = |dx|/rx, |dy|/ry               # 各轴的归一化坐标，0 在锚点、1 在边框
    e   = (a¹⁶+b¹⁶)^(1/16)              # 16 次幂超椭圆：光滑、贴近画面边框
    u   = 1 - e                              # 0 在边框，1 在锚点
    A   = 1 + amount * bezier(u)             # 该像素的采样倍率（1025 项 LUT）
    src = anchor + (p - anchor) * A          # 纯径向缩放

- **rx / ry**：`固定` 时取锚点到这一侧边框的距离（再被「半径」截断）→ 边框与四角上 `e ≥ 1`、`A=1`，**四条边和四个角的位移严格为 0**；`不固定` 时 rx = ry = 半径。
- 用 16 次幂而不是 2 次：等值线从「内切椭圆」变成几乎贴着画面边框的圆角矩形，死区只剩角落约 4%（2 次幂时是 8%+，且边界上有可见的椭圆折线）。16 次幂仍是单一光滑函数，不会产生斜向折痕。
- **采样永远不出界**：每像素的缩放倍率还会被「锚点到该侧边框的剩余距离」夹住，所以曲线拉得再陡也不会采到图层外面（不会出现白边/透明边），代价是最靠边那一圈会被夹住、表现为边缘色被拉长。\n- 曲线默认是直线 `(0,0)-(1,1)`；往 S 形/上凸方向拖，收缩会更集中在锚点附近（越像 AE 的白点/鱼眼）。
- 强度上限：曲线为默认直线时 收缩量 100% 对应的映射仍严格单调（不会折返）；曲线拉得很陡时大强度可能在锚点附近出现折返，属正常现象，减小收缩量即可。


## 曲线面板

`Window ▸ mos_收缩曲线.jsx`：

- 选中带 `mos_收缩` 的图层后自动读取它的曲线参数；拖两个白点手柄即实时写回（一次拖动 = 一个撤销步）。
- 横轴：0 = 边框，1 = 锚点；纵轴：收缩强度（0 = 不动，1 = 全量）。
- 预设（线性 / 缓入缓出 / 缓入 / 缓出 / 强缓出）在底部，当前匹配的预设会高亮。
- 选中图层还没有该效果时，右上会出现「＋ 效果」。

## 性能

- 本机引擎（wasmi，1920×1080，renderQueue 实测）：无效果 16.7 ms/帧，带效果 28.6 ms/帧 → **效果本身约 12 ms/帧**（多线程分摊）。
- 单线程 V8 参考：1080p 约 120 ms；320×180 约 3 ms。
- 逐像素开销 = 2 次 LUT 查表 + 1 次双线性/双三次取样。

## 目录

    src/manifest.json          参数与元数据（改完跑 build.js）
    src/mos_shrink.wat         wasm 源码（WAT）
    build.js                   manifest 注入 + wabt 编译 + 组 bundle
    panel/mos_收缩曲线.jsx     贝塞尔曲线编辑面板
    tools/test_wasm.js         合成测试图 + 十个用例 + 边缘/四角不变性检查
    tools/refcheck.js          wasm 与 JS 参考实现逐像素比对
    tools/preview2.js          线稿图出图（A/B/C 三套映射对比用）
    tools/probe_map.js         映射探针（R 通道编码源坐标）
    tools/probe_col.js         单列逐行 dump
    tools/build_smoke.js       拼接面板 + 测试体
    tools/smoke_body.jsx       面板冒烟测试（绘制/拖动/预设/布局不变量）
    tools/bench_e2e.jsx        真引擎 renderQueue 计时
    dist/mos_收缩/             可安装产物

## 开发

    npm install          # wabt
    node build.js        # → dist/mos_收缩/
    node tools\test_wasm.js
    node tools\refcheck.js
    node tools\build_smoke.js && "C:\Program Files\EffectCraft\effectcraft-cli.exe" script build\panel_smoke_combined.jsx --demo

真引擎里加载插件（CLI 默认不加载第三方插件）：

    effectcraft-cli script --eval "app.run('effect.plugins.load', {path: '...\\mos_shrink.wasm'})"

## 已知限制

- 「四角固定」只钉四个角，四条边会内凹成垫子形，空出来的地方由「越界」方式填充 —— 这是这个模式的预期外观。
- 收缩量很大时锚点附近会被放大很多，想缓和就把曲线手柄往边框那头拉，或用「半径」缩小影响范围。
- 面板的停靠路径（`this` 为 Panel）无法在无头会话里验证，已在用户机上安装。
