// 用 CLI 会话验证：插件能加载、效果参数名/顺序正确
(function () {
  var out = [];
  try {
    var r = app.run("effect.plugins.load", { path: "D:/mossls/mos/形变/收缩/dist/变形-白点/ae_warp.wasm" });
    out.push("load=" + (r && r.loaded ? JSON.stringify(r.loaded[0]) : "?"));
  } catch (e) { out.push("load err: " + e.message); }
  var comp = app.project.items.addComp("chk", 320, 180, 1, 2, 30);
  var lay = comp.layers.addSolid([0.2, 0.3, 0.4], "s", 320, 180, 1);
  var e = lay.Effects.addProperty("mos_收缩");
  out.push("effect=" + e.name + " numProps=" + e.numProperties);
  for (var i = 1; i <= e.numProperties; i++) {
    var p = e.property(i);
    out.push(i + "|" + p.name + "|" + p.matchName + "|" + p.propertyValueType + "|" + p.value);
  }
  $.writeln(out.join("  ;  "));
})();
