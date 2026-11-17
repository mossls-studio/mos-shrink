// tools/smoke_body.jsx — appended after panel/mos_shrink_curve.jsx by tools/build_smoke.js.
// Drives the already-loaded panel: repaint at several sizes, drag both handles and a chip.
(function () {
  var log = [];
  function w(s) { log.push(String(s)); }
  function safe(name, f) {
    try { var r = f(); w(name + ": " + r); return r; }
    catch (e) { w(name + " ERR " + ((e && e.message) ? e.message : e) + (e && e.line ? " @" + e.line : "")); return null; }
  }

  var d = $.global.mosShrinkCurve;
  if (!d) { writeLn("FATAL hook missing"); return; }
  var canvas = d.canvasRef(), win = d.winRef();
  safe("refs", function () { return "canvas=" + (canvas ? "yes" : "no") + " win=" + (win ? "yes" : "no"); });

  var layer = null;
  safe("select", function () {
    var c = app.project.activeItem;
    if (!c || !c.layers) return "no comp";
    var L = c.layer(1);
    L.selected = true;
    layer = L;
    return c.name + " / " + L.name;
  });
  var found = safe("findEffect", function () { return d.findEffect(layer) ? "found" : "none"; });
  safe("addEffect", function () {
    if (found === "found" || !layer) return "skip";
    var e = layer.Effects.addProperty("mos_收缩");
    return e ? "added " + e.name : "failed (plug-in not loaded?)";
  });
  safe("refresh", function () { d.refresh(); return d.state.status; });

  var sizes = [[340, 300], [260, 200], [460, 340]], i;
  for (i = 0; i < sizes.length; i++) {
    (function (s) {
      safe("draw" + s[0] + "x" + s[1], function () {
        if (win) { win.size = s; try { win.layout.layout(true); } catch (e) {} }
        canvas.notify("onDraw");
        return "size=" + canvas.size.width + "x" + canvas.size.height;
      });
    })(sizes[i]);
  }
  safe("drawTiny", function () {
    d.draw.call({ graphics: canvas.graphics, size: { width: 90, height: 60 } });
    return "ok";
  });

  safe("restore", function () {
    if (win) { win.size = [340, 300]; try { win.layout.layout(true); } catch (e) {} }
    canvas.notify("onDraw");
    return "ok";
  });

  var L = safe("layout", function () { return d.layout(canvas.size.width, canvas.size.height); });
  safe("curve0", function () { return d.state.x1 + "," + d.state.y1 + "," + d.state.x2 + "," + d.state.y2; });
  safe("drag1", function () {
    var g = L.graph;
    var hx = g.x + d.state.x1 * g.w;
    var hy = g.y + g.h - d.state.y1 * g.h;
    d.mouseDown({ clientX: hx, clientY: hy, buttons: 1 });
    var started = d.state.drag;
    d.mouseMove({ clientX: hx + 20, clientY: hy + 12, buttons: 1 });
    d.mouseUp({ clientX: hx + 20, clientY: hy + 12, buttons: 0 });
    return "drag=" + started + " -> " + d.state.x1.toFixed(3) + "," + d.state.y1.toFixed(3);
  });
  safe("drag2", function () {
    var g = L.graph;
    var hx = g.x + d.state.x2 * g.w;
    var hy = g.y + g.h - d.state.y2 * g.h;
    d.mouseDown({ clientX: hx, clientY: hy, buttons: 1 });
    d.mouseMove({ clientX: hx - 30, clientY: hy - 10, buttons: 1 });
    d.mouseUp({ clientX: hx - 30, clientY: hy - 10, buttons: 0 });
    return "-> " + d.state.x2.toFixed(3) + "," + d.state.y2.toFixed(3);
  });
  safe("writtenToEffect", function () {
    var e = d.findEffect(layer);
    if (!e) return "no effect";
    var v = [];
    for (var k = 4; k <= 7; k++) v.push(e.property(k).value);
    return v.join(",");
  });
  safe("presetChip", function () {
    var c = L.presets[2];
    d.mouseDown({ clientX: c.x + c.w / 2, clientY: c.y + c.h / 2, buttons: 1 });
    d.mouseUp({ clientX: c.x + c.w / 2, clientY: c.y + c.h / 2, buttons: 0 });
    return "curve=" + d.state.x1 + "," + d.state.y1 + "," + d.state.x2 + "," + d.state.y2;
  });
  safe("presetApi", function () { return d.applyPreset("ease") + " curve=" + d.state.x1 + "," + d.state.y1; });
  safe("finalDraw", function () { canvas.notify("onDraw"); return "ok"; });
  safe("status", function () { return d.state.status; });

  safe("layoutInvariants", function () {
    var bad = [], sizes = [[340, 300], [240, 180], [180, 120], [600, 420]];
    for (var k = 0; k < sizes.length; k++) {
      var W = sizes[k][0], H = sizes[k][1], L = d.layout(W, H);
      var tag = W + "x" + H;
      if (L.graph.x < 0 || L.graph.y < 0) bad.push(tag + " graph origin");
      if (L.graph.x + L.graph.w > W + 1) bad.push(tag + " graph wide " + (L.graph.x + L.graph.w) + ">" + W);
      if (L.graph.w < 40 || L.graph.h < 30) bad.push(tag + " graph small");
      var last = L.presets[L.presets.length - 1];
      if (last.x + last.w > W + 1) bad.push(tag + " chips wide " + (last.x + last.w) + ">" + W);
      for (var j = 0; j < L.presets.length; j++) {
        if (L.presets[j].w < 18) bad.push(tag + " chip narrow " + L.presets[j].w);
        if (j > 0 && L.presets[j].x < L.presets[j - 1].x + L.presets[j - 1].w - 0.01) bad.push(tag + " chip overlap");
      }
      if (last.y + last.h > H + 1) bad.push(tag + " chips below bottom " + (last.y + last.h) + ">" + H);
      if (L.valsY < L.graph.y + L.graph.h + 1) bad.push(tag + " vals overlap graph");
      if (L.valsY + 14 > last.y) bad.push(tag + " vals/chips overlap");
      if (L.addBtn.x < 0 || L.addBtn.x + L.addBtn.w > W + 1) bad.push(tag + " addBtn outside");
    }
    return bad.length ? bad.join(" ; ") : "ok";
  });

  writeLn(log.join("\n"));
})();
