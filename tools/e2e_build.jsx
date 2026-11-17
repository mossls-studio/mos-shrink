// tools/e2e_build.jsx — 在真引擎里建一个测试工程：图片 -> comp -> mos_收缩 -> 存盘
// 用法: effectcraft-cli.exe script tools\e2e_build.jsx
(function () {
  var out = [];
  var imgPath = "D:/mossls/mos/形变/收缩/build/out/p_src.png";
  var proj = app.project;

  try {
    var r = app.run("effect.plugins.load", { path: "D:/mossls/mos/形变/收缩/dist/mos_收缩/mos_shrink.wasm" });
    out.push("load=" + JSON.stringify(r));
  } catch (e0) { out.push("load ERR " + e0.message); }

  var comp = proj.items.addComp("e2e", 640, 360, 1, 2, 30);
  var layer = null;
  try { layer = comp.layers.add(proj.importFile(new File(imgPath))); } catch (e) { out.push("import ERR " + e.message); }
  if (!layer) { layer = comp.layers.addSolid([0.2, 0.3, 0.5], "fallback", 640, 360, 1); out.push("fallback"); }

  var fx = null;
  try { fx = layer.Effects.addProperty("mos_收缩"); } catch (e2) { out.push("addEffect ERR " + e2.message); }
  if (fx) {
    out.push("effect=" + fx.name + " props=" + fx.numProperties);
    var names = [];
    for (var i = 1; i <= fx.numProperties; i++) names.push(i + ":" + fx.property(i).name);
    out.push(names.join(" | "));
    // 默认参数就是想要的效果；存成工程，供 render-frame 使用
  }
  app.project.activeItem = comp;
  proj.save(new File("D:/mossls/mos/形变/收缩/build/e2e.ecproj"));
  writeLn(out.join("\n"));
})();
