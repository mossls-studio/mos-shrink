// tools/panel_smoke.jsx — headless smoke test for the mos_收缩 ScriptUI panel.
// Run: effectcraft-cli.exe script tools/panel_smoke.jsx --demo
// Opens the panel (floating palette path), repaints it at several sizes, drags both bezier
// handles and a preset chip through the panel's own mouse handlers, and reports what changed.
(function () {
  var P = "D:/mossls/mos/形变/收缩/panel/mos_shrink_curve.jsx";
  var log = [];
  function w(s) { log.push(String(s)); }
  function safe(name, f) {
    try { var r = f(); w(name + ": " + r); return r; }
    catch (e) { w(name + " ERR " + (e.message || e) + (e.line ? " @" + e.line : "")); return null; }
  }

  safe("evalFile", function () { $.evalFile(P); return "ok"; });
  var d = $.global.mosShrinkCurve;
  if (!d) { writeLn("FATAL hook missing\n" + log.join("\n")); return; }
  var canvas = d.canvasRef(), win = d.winRef();
  safe("refs", function () { return "canvas=" + (canvas ? "yes" : "no") + " win=" + (win ? "yes" : "no"); });

  // ---- bind the effect on the demo comp's first layer (if any)
  var layer = null;
  safe("select", function () {
    var c = app.project.activeItem;
    if (!c || !c.layers) return "no comp";
    var L = c.layer(1);
    L.selected = true;
    layer = L;
    return c.name + " / " + L.name;
  });
  var eff = safe("findEffect", function () { return d.findEffect(layer) ? "found" : "none"; });
  safe("addEffect", function () {
    if (eff === "found" || !layer) return "skip";
    var e = layer.Effects.addProperty("mos_收缩");
    return e ? "added " + e.name : "failed";
  });
  safe("refresh", function () { d.refresh(); return d.state.status; });

  // ---- repaint at several sizes (a docked panel reflows this way)
  var sizes = [[340, 300], [260, 200], [460, 340]];
  for (var i = 0; i < sizes.length; i++) {
    (function (s) {
      safe("draw" + s[0] + "x" + s[1], function () {
        if (win) { win.size = s; try { win.layout.layout(true); } catch (e) {} }
        canvas.notify("onDraw");
        return "size=" + canvas.size.width + "x" + canvas.size.height;
      });
    })(sizes[i]);
  }
  safe("drawTiny", function () {
    var g = canvas.graphics;
    d.draw.call({ graphics: g, size: { width: 90, height: 60 } });
    return "ok";
  });

  // ---- drag handle 1 and handle 2 through the real handlers
  safe("restore", function () {
    if (win) { win.size = [340, 300]; try { win.layout.layout(true); } catch (e) {} }
    canvas.notify("onDraw");
    return "ok";
  });
  var L = safe("layout", function () { return d.layout(canvas.size.width, canvas.size.height); });
  var before = null;
  safe("before", function () { return d.state.x1 + "," + d.state.y1 + "," + d.state.x2 + "," + d.state.y2; });
  safe("drag1", function () {
    var g = L.graph;
    var hx = g.x + 8 + d.state.x1 * (g.w - 16);
    var hy = g.y + g.h - 8 - d.state.y1 * (g.h - 16);
    d.mouseDown({ clientX: hx, clientY: hy, buttons: 1 });
    var started = d.state.drag;
    d.mouseMove({ clientX: hx + 20, clientY: hy + 12, buttons: 1 });
    d.mouseUp({ clientX: hx + 20, clientY: hy + 12, buttons: 0 });
    return "drag=" + started + " -> " + d.state.x1.toFixed(3) + "," + d.state.y1.toFixed(3);
  });
  safe("drag2", function () {
    var g = L.graph;
    var hx = g.x + 8 + d.state.x2 * (g.w - 16);
    var hy = g.y + g.h - 8 - d.state.y2 * (g.h - 16);
    d.mouseDown({ clientX: hx, clientY: hy, buttons: 1 });
    d.mouseMove({ clientX: hx - 30, clientY: hy - 10, buttons: 1 });
    d.mouseUp({ clientX: hx - 30, clientY: hy - 10, buttons: 0 });
    return "-> " + d.state.x2.toFixed(3) + "," + d.state.y2.toFixed(3);
  });
  safe("writtenToEffect", function () {
    var e = d.findEffect(layer);
    if (!e) return "no effect";
    var v = [];
    for (var i = 4; i <= 7; i++) v.push(e.property(i).value);
    return v.join(",");
  });
  safe("presetChip", function () {
    var g = L.graph;
    var chipY = g.y + g.h + 16 + 13;
    d.mouseDown({ clientX: L.chips[2].x + 10, clientY: chipY, buttons: 1 });
    d.mouseUp({ clientX: L.chips[2].x + 10, clientY: chipY, buttons: 0 });
    return "curve=" + d.state.x1 + "," + d.state.y1 + "," + d.state.x2 + "," + d.state.y2;
  });
  safe("applyPresetApi", function () { return d.applyPreset("ease") + " curve=" + d.state.x1 + "," + d.state.y1; });
  safe("finalDraw", function () { canvas.notify("onDraw"); return "ok"; });
  safe("status", function () { return d.state.status; });

  writeLn(log.join("\n"));
})();
