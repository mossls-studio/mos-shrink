// tools/bench_e2e.jsx — 在真引擎里量 mos_收缩 的每帧耗时（renderQueue，PNG 序列）
(function () {
  var out = [];
  app.run("effect.plugins.load", { path: "D:/mossls/mos/形变/收缩/dist/mos_收缩/mos_shrink.wasm" });
  var proj = app.project;
  var img = proj.importFile(new File("D:/mossls/mos/形变/收缩/build/out/p_src.png"));

  function build(withEffect) {
    var comp = proj.items.addComp("bench" + (withEffect ? "fx" : "plain"), 1920, 1080, 1, 10 / 30, 30);
    var L = comp.layers.add(img);
    L.scale.setValue([600, 600]);
    L.position.setValue([960, 540]);
    if (withEffect) L.Effects.addProperty("mos_收缩");
    comp.openInViewer ? comp.openInViewer() : null;
    return comp;
  }
  function timeComp(comp, tag) {
    var item = proj.renderQueue.items.add(comp);
    try {
      var om = item.outputModule(1);
      om.applyTemplate("PNG Sequence");
      var dir = new Folder("D:/mossls/mos/形变/收缩/build/bench_" + tag);
      if (!dir.exists) dir.create();
      om.file = new File("D:/mossls/mos/形变/收缩/build/bench_" + tag + "/f_[#####].png");
    } catch (e) { out.push(tag + " om ERR " + e.message); }
    var t0 = new Date().getTime();
    proj.renderQueue.render();
    var ms = new Date().getTime() - t0;
    out.push(tag + " 10 frames in " + ms + " ms = " + (ms / 10).toFixed(1) + " ms/frame");
    return ms;
  }
  // warm up both, then measure
  var a = build(false), b = build(true);
  try { timeComp(a, "warm"); timeComp(b, "warmfx"); } catch (e) { out.push("warm ERR " + e.message); }
  var plain = 0, fx = 0;
  try { plain = timeComp(a, "plain"); fx = timeComp(b, "fx"); } catch (e2) { out.push("measure ERR " + e2.message); }
  out.push("effect cost = " + ((fx - plain) / 10).toFixed(1) + " ms/frame");
  writeLn(out.join("\n"));
})();
