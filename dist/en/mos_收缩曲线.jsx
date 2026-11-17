/*
 * mos_收缩 · 贝塞尔曲线编辑器
 * ScriptUI panel for the "mos_收缩" effect plugin (mos.shrink).
 *
 * The effect shrinks the picture toward a movable anchor. The amount of shrink is multiplied by
 * f(q), where q = 1 - distance/radius (1 at the anchor, 0 at the radius edge). f is a cubic
 * bezier easing curve; this panel is its editor: drag the two handles, the four curve params of
 * the selected layer's effect are written live, one undo step per drag.
 *
 * Runs both as a dockable ScriptUI panel and as a floating palette (double-click the .jsx).
 */
(function (thisObj) {
  var VERSION = "1.3.0";
  var EFFECT_NAME = "mos_收缩";
  var SECTION = "mos_shrink_curve";

  var IS_PANEL = thisObj instanceof Panel;
  var OS = String($.os || "");
  var FONT_FAMILY = OS.indexOf("Windows") >= 0 ? "Microsoft YaHei UI"
    : OS.indexOf("Mac") >= 0 ? "PingFang SC" : "Noto Sans CJK SC";

  // ---------------------------------------------------------------- utils
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(v, d) { var x = Number(v); return isFinite(x) ? x : d; }
  function round(v, p) { var f = Math.pow(10, p || 0); return Math.round(v * f) / f; }
  function hostVersionAtLeast(maj, min) {
    var m = /EffectCraft\s+(\d+)\.(\d+)/.exec(String(app.version || ""));
    if (!m) return false;
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return a > maj || (a === maj && b >= min);
  }
  // 0.19.0 made script colours plain sRGB; older hosts expected linear values.
  var HOST_SRGB = true;
  try { HOST_SRGB = hostVersionAtLeast(0, 19); } catch (e) {}
  var colourCache = {};
  function chan(v) {
    v = v / 255;
    if (HOST_SRGB) return v;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function C(hex, alpha) {
    var h = String(hex).replace(/^#/, "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var key = h + "|" + (alpha === undefined ? 1 : alpha);
    if (colourCache[key]) return colourCache[key];
    var c = [chan(parseInt(h.substr(0, 2), 16)), chan(parseInt(h.substr(2, 2), 16)),
      chan(parseInt(h.substr(4, 2), 16)), alpha === undefined ? 1 : alpha];
    colourCache[key] = c;
    return c;
  }
  function withAlpha(c, a) { return [c[0], c[1], c[2], a]; }

  var THEMES = {
    dark: { bg: "#060607", surface: "#121213", low: "#19191B", high: "#222224", outline: "#36363A",
      outlineSoft: "#242427", text: "#F2F2F4", dim: "#A9A9AF", faint: "#737379",
      primary: "#A8C7FA", onPrimary: "#0A2A52", primaryContainer: "#1F3550", onPrimaryContainer: "#D7E3FF" },
    darker: { bg: "#030304", surface: "#0E0E0F", low: "#151516", high: "#202021", outline: "#333336",
      outlineSoft: "#232326", text: "#F3F3F5", dim: "#A8A8AE", faint: "#717177",
      primary: "#A8C7FA", onPrimary: "#0A2A52", primaryContainer: "#1F3550", onPrimaryContainer: "#D7E3FF" },
    light: { bg: "#F1F2F5", surface: "#FFFFFF", low: "#F6F7FA", high: "#EEF0F5", outline: "#C5CAD4",
      outlineSoft: "#E2E5EB", text: "#14161A", dim: "#565C66", faint: "#8A909A",
      primary: "#3D5A88", onPrimary: "#FFFFFF", primaryContainer: "#D6E3FF", onPrimaryContainer: "#001B3E" }
  };
  var P = null, PNAME = "";
  function readTheme() {
    try {
      var r = app.run("prefs.get", { key: "appearance.theme" });
      if (typeof r === "string") return r;
      if (r && typeof r.theme === "string") return r.theme;
    } catch (e) {}
    return "dark";
  }
  function makePalette(name) {
    var src = THEMES[name] || THEMES.dark, out = { name: THEMES[name] ? name : "dark" };
    for (var k in src) if (src.hasOwnProperty(k)) out[k] = C(src[k]);
    return out;
  }
  function refreshTheme() {
    var t = readTheme();
    if (t !== PNAME) { P = makePalette(t); PNAME = t; return true; }
    return false;
  }

  // ---------------------------------------------------------------- fonts & text
  var fontCache = {};
  function font(size, style) {
    var k = size + "|" + (style || "REGULAR");
    if (!fontCache[k]) fontCache[k] = ScriptUI.newFont(FONT_FAMILY, style || "REGULAR", size);
    return fontCache[k];
  }
  function visualWidth(s, size) {
    s = String(s);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef) ? size * 1.1 : size * 0.56;
    }
    return w;
  }
  function textBox(g, s, x, y, w, h, size, color, align, style) {
    s = String(s);
    var tw = visualWidth(s, size);
    var tx = align === "center" ? x + (w - tw) / 2 : align === "right" ? x + w - tw : x;
    var ty = y + (h - size * 1.2) / 2 + 1;
    g.font = font(size, style);
    g.drawString(s, g.newPen(g.PenType.SOLID_COLOR, color, 1), tx, ty);
  }

  // ---------------------------------------------------------------- drawing primitives
  function roundPath(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    g.newPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.lineTo(x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.lineTo(x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.lineTo(x, y + h - r);
    g.lineTo(x, y + r);
    g.closePath();
  }
  function fillRound(g, x, y, w, h, r, color) {
    if (w <= 0 || h <= 0) return;
    roundPath(g, x, y, w, h, r);
    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
  }
  function strokeRound(g, x, y, w, h, r, color, width) {
    if (w <= 0 || h <= 0) return;
    roundPath(g, x, y, w, h, r);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }
  function line(g, x1, y1, x2, y2, color, width) {
    g.newPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }
  function fillRect(g, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    g.newPath();
    g.rectPath(x, y, w, h);
    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
  }
  function fillCircle(g, cx, cy, r, color) {
    g.newPath();
    g.ellipsePath(cx - r, cy - r, 2 * r, 2 * r);
    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
  }
  function strokeCircle(g, cx, cy, r, color, width) {
    g.newPath();
    g.ellipsePath(cx - r, cy - r, 2 * r, 2 * r);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
  }

  // ---------------------------------------------------------------- bezier
  // f(q) of the cubic bezier with control points (0,0) (x1,y1) (x2,y2) (1,1),
  // same solve the wasm plug-in runs (Newton on x, then y).
  function bezierY(q, x1, y1, x2, y2) {
    var t = q, i, om, xx, dd;
    for (i = 0; i < 12; i++) {
      om = 1 - t;
      xx = 3 * om * om * t * x1 + 3 * om * t * t * x2 + t * t * t;
      dd = 3 * om * om * x1 + 6 * om * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(dd) < 1e-9) break;
      t = clamp(t - (xx - q) / dd, 0, 1);
    }
    om = 1 - t;
    return 3 * om * om * t * y1 + 3 * om * t * t * y2 + t * t * t;
  }

  var PRESETS = [
    { id: "linear", name: "线性", v: [0, 0, 1, 1] },
    { id: "ease", name: "缓入缓出", v: [0.33, 0, 0.67, 1] },
    { id: "in", name: "缓入", v: [0.42, 0, 1, 1] },
    { id: "out", name: "缓出", v: [0, 0, 0.58, 1] },
    { id: "strongout", name: "强缓出", v: [0, 0, 0.15, 1] }
  ];

  // ---------------------------------------------------------------- effect binding
  function activeComp() {
    try {
      var it = app.project.activeItem;
      return it && it.layers ? it : null;
    } catch (e) { return null; }
  }
  function selectedLayer() {
    var c = activeComp();
    if (!c) return null;
    try {
      var sel = c.selectedLayers;
      if (sel && sel.length) return sel[0];
    } catch (e) {}
    return null;
  }
  function findEffect(layer) {
    if (!layer) return null;
    try {
      var fx = layer.Effects;
      if (!fx) return null;
      for (var i = 1; i <= fx.numProperties; i++) {
        var e = fx.property(i);
        if (e && String(e.name) === EFFECT_NAME) return e;
      }
    } catch (e) {}
    return null;
  }
  function curveParams(effect) {
    // manifest order: amount, anchor, radius, curve X1, Y1, X2, Y2, ...
    if (!effect || effect.numProperties < 8) return null;
    return [effect.property(4), effect.property(5), effect.property(6), effect.property(7)];
  }
  function readCurve(effect) {
    var ps = curveParams(effect);
    if (!ps) return null;
    try {
      return [clamp(num(ps[0].value, 0.33), 0, 1), clamp(num(ps[1].value, 0), 0, 1),
        clamp(num(ps[2].value, 0.67), 0, 1), clamp(num(ps[3].value, 1), 0, 1)];
    } catch (e) { return null; }
  }
  function writeCurve(effect, v) {
    var ps = curveParams(effect);
    if (!ps) return false;
    try {
      for (var i = 0; i < 4; i++) ps[i].setValue(round(clamp(v[i], 0, 1), 3));
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- state
  var st = {
    x1: 0.33, y1: 0, x2: 0.67, y2: 1,
    drag: 0,           // 1 / 2 while a handle is dragged
    groupOpen: false,
    status: "",
    effect: null
  };
  var canvas = null, win = null, editorOpen = false;

  function curveArray() { return [st.x1, st.y1, st.x2, st.y2]; }
  function setCurve(v) { st.x1 = v[0]; st.y1 = v[1]; st.x2 = v[2]; st.y2 = v[3]; }

  function beginGroup() {
    if (st.groupOpen) return;
    try { app.beginUndoGroup("mos_收缩: 调整曲线"); } catch (e) {}
    st.groupOpen = true;
  }
  function endGroup() {
    if (!st.groupOpen) return;
    st.groupOpen = false;
    try { app.endUndoGroup(); } catch (e) {}
  }
  function redraw() {
    if (!canvas) return;
    try { canvas.notify("onDraw"); } catch (e) {}
  }
  function refreshBinding() {
    var layer = selectedLayer();
    st.effect = findEffect(layer);
    var v = st.effect ? readCurve(st.effect) : null;
    if (v) {
      setCurve(v);
      st.status = "已绑定 " + String(layer.name);
    } else {
      st.status = layer ? "该图层没有 mos_收缩" : "先选中一个图层";
    }
  }

  function canvasWH() {
    var w = 0, h = 0;
    try { if (canvas && canvas.size) { w = canvas.size.width; h = canvas.size.height; } } catch (e) {}
    if (!(w > 1)) w = 340;
    if (!(h > 1)) h = 300;
    return { w: w, h: h };
  }

  // ---------------------------------------------------------------- layout
  function layout(W, H) {
    var pad = 10;
    var headerH = 22;
    var valsH = 14;
    var presetH = 18;
    var gy = headerH + 2;
    var gh = Math.max(40, H - gy - valsH - presetH - pad);
    var graph = { x: pad, y: gy, w: Math.max(40, W - 2 * pad), h: gh };
    var valsY = graph.y + graph.h + 3;
    var presetsY = valsY + valsH + 2;
    var n = PRESETS.length;
    var gap = 2;
    var pw = Math.max(24, (W - 2 * pad) / n);
    var presets = [];
    for (var i = 0; i < n; i++) presets.push({ x: pad + i * (pw + gap) - gap / 2, y: presetsY, w: pw, h: presetH, preset: PRESETS[i] });
    var addBtn = { x: Math.max(pad, W - pad - 58), y: 3, w: 58, h: 16 };
    return { pad: pad, headerH: headerH, graph: graph, presets: presets, valsY: valsY, addBtn: addBtn };
  }

  // graph space: q in [0,1] left→right, f in [0,1] bottom→top
  function qToX(L, q) { return L.graph.x + q * L.graph.w; }
  function fToY(L, f) { return L.graph.y + L.graph.h - f * L.graph.h; }
  function xToQ(L, x) { return clamp((x - L.graph.x) / Math.max(1, L.graph.w), 0, 1); }
  function yToF(L, y) { return clamp((L.graph.y + L.graph.h - y) / Math.max(1, L.graph.h), 0, 1); }

  function activePresetName() {
    var v = curveArray();
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i].v, ok = true;
      for (var j = 0; j < 4; j++) if (Math.abs(p[j] - v[j]) > 0.008) { ok = false; break; }
      if (ok) return PRESETS[i].id;
    }
    return "";
  }

  // ---------------------------------------------------------------- draw
  function onDraw() {
    var g = this.graphics;
    var W = this.size.width, H = this.size.height;
    if (!(W > 1) || !(H > 1)) { W = 340; H = 300; }
    refreshTheme();
    refreshBinding();
    var L = layout(W, H);

    fillRect(g, 0, 0, W, H, P.bg);
    textBox(g, "mos_收缩 · 曲线", L.pad, 0, W - 2 * L.pad - 60, L.headerH, 11, withAlpha(P.dim, 1), "left", "REGULAR");
    var canAdd = !st.effect && !!selectedLayer();
    if (canAdd) {
      var b = L.addBtn;
      strokeRound(g, b.x, b.y, b.w, b.h, 4, P.outline, 1);
      textBox(g, "＋ 效果", b.x, b.y, b.w, b.h, 9, P.dim, "center");
    }
    textBox(g, st.status, L.pad + 62, 0, W - 2 * L.pad - 62 - (canAdd ? 62 : 0), L.headerH, 9,
      withAlpha(P.faint, 0.95), "right");

    // ---- plot frame: a single thin rectangle, nothing else
    var G = L.graph;
    line(g, G.x, G.y, G.x + G.w, G.y, P.outlineSoft, 1);
    line(g, G.x + G.w, G.y, G.x + G.w, G.y + G.h, P.outlineSoft, 1);
    line(g, G.x + G.w, G.y + G.h, G.x, G.y + G.h, P.outlineSoft, 1);
    line(g, G.x, G.y + G.h, G.x, G.y, P.outlineSoft, 1);

    // ---- curve
    var steps = 96, pts = [], i, x, y, q, f;
    for (i = 0; i <= steps; i++) {
      q = i / steps;
      f = bezierY(q, st.x1, st.y1, st.x2, st.y2);
      pts.push([qToX(L, q), fToY(L, f)]);
    }
    g.newPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, P.primary, 1.6));

    // ---- handles: thin guide lines from the endpoints, small dots
    var p0 = [qToX(L, 0), fToY(L, 0)], p3 = [qToX(L, 1), fToY(L, 1)];
    var p1 = [qToX(L, st.x1), fToY(L, st.y1)], p2 = [qToX(L, st.x2), fToY(L, st.y2)];
    line(g, p0[0], p0[1], p1[0], p1[1], withAlpha(P.primary, 0.42), 1);
    line(g, p3[0], p3[1], p2[0], p2[1], withAlpha(P.primary, 0.42), 1);
    fillCircle(g, p0[0], p0[1], 3.4, P.primary);
    fillCircle(g, p3[0], p3[1], 3.4, P.primary);
    var h1 = st.drag === 1, h2 = st.drag === 2;
    fillCircle(g, p1[0], p1[1], h1 ? 4.6 : 3.4, P.text);
    fillCircle(g, p2[0], p2[1], h2 ? 4.6 : 3.4, P.text);

    // ---- values
    var vs = round(st.x1, 3).toFixed(3) + " , " + round(st.y1, 3).toFixed(3) +
      "  —  " + round(st.x2, 3).toFixed(3) + " , " + round(st.y2, 3).toFixed(3);
    textBox(g, vs, L.pad, L.valsY, W - 2 * L.pad, 12, 9, P.faint, "center");

    // ---- presets: plain small text, the active one is brighter and underlined
    var activeId = activePresetName();
    for (i = 0; i < L.presets.length; i++) {
      var c = L.presets[i], on = c.preset.id === activeId;
      textBox(g, c.preset.name, c.x, c.y, c.w, c.h, 9, on ? P.primary : P.faint, "center", on ? "BOLD" : "REGULAR");
      if (on) line(g, c.x + c.w * 0.22, c.y + c.h - 1, c.x + c.w * 0.78, c.y + c.h - 1, P.primary, 1);
    }
  }

  // ---------------------------------------------------------------- mouse
  function localPoint(e, c) { return { x: e.clientX, y: e.clientY }; }

  function canvasMouseDown(e) {
    refreshBinding();
    var wh = canvasWH();
    var p = localPoint(e), L = layout(wh.w, wh.h);
    var i;
    // "＋ 效果": add the effect to the selected layer when it has none
    if (!st.effect) {
      var b = L.addBtn;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        var layer = selectedLayer();
        if (layer) {
          var opened = false;
          try { app.beginUndoGroup("mos_收缩: 添加效果"); opened = true; } catch (e0) {}
          try { layer.Effects.addProperty(EFFECT_NAME); } catch (e1) {}
          if (opened) { try { app.endUndoGroup(); } catch (e2) {} }
        }
        refreshBinding();
        redraw();
        return;
      }
    }
    for (i = 0; i < L.presets.length; i++) {
      var c = L.presets[i];
      if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
        setCurve(c.preset.v);
        if (st.effect) {
          beginGroup();
          writeCurve(st.effect, curveArray());
          endGroup();
        }
        redraw();
        return;
      }
    }
    // handles
    var p1 = [qToX(L, st.x1), fToY(L, st.y1)];
    var p2 = [qToX(L, st.x2), fToY(L, st.y2)];
    var d1 = Math.sqrt((p.x - p1[0]) * (p.x - p1[0]) + (p.y - p1[1]) * (p.y - p1[1]));
    var d2 = Math.sqrt((p.x - p2[0]) * (p.x - p2[0]) + (p.y - p2[1]) * (p.y - p2[1]));
    if (d1 <= 11 && d1 <= d2) st.drag = 1;
    else if (d2 <= 11) st.drag = 2;
    else st.drag = 0;
    if (st.drag) { beginGroup(); redraw(); }
  }

  function canvasMouseMove(e) {
    if (!st.drag) return;
    if (e.buttons !== undefined && e.buttons === 0) { canvasMouseUp(e); return; }
    var wh = canvasWH();
    var p = localPoint(e), L = layout(wh.w, wh.h);
    var q = xToQ(L, p.x), f = yToF(L, p.y);
    if (st.drag === 1) { st.x1 = q; st.y1 = f; } else { st.x2 = q; st.y2 = f; }
    if (st.effect) writeCurve(st.effect, curveArray());
    redraw();
  }

  function canvasMouseUp(e) {
    if (!st.drag) return;
    st.drag = 0;
    endGroup();
    refreshBinding();
    redraw();
  }

  function canvasMouseOut(e) {
    if (st.drag && e.buttons !== undefined && e.buttons === 0) canvasMouseUp(e);
  }

  function bindCanvas(c) {
    canvas = c;
    c.alignment = ["fill", "fill"];
    c.onDraw = onDraw;
    c.addEventListener("mousedown", canvasMouseDown);
    c.addEventListener("mousemove", canvasMouseMove);
    c.addEventListener("mouseup", canvasMouseUp);
    c.addEventListener("mouseout", canvasMouseOut);
    try { c.preferredSize = [340, 300]; } catch (e) {}
  }

  // ---------------------------------------------------------------- entry points
  function buildPanelLauncher(panel) {
    panel.orientation = "stack";
    panel.alignChildren = ["fill", "fill"];
    panel.margins = 0;
    panel.spacing = 0;
    try { panel.preferredSize = [340, 300]; } catch (e) {}
    var c = panel.add("panel", undefined, undefined, { name: "canvas" });
    bindCanvas(c);
    panel.onResizing = function () { redraw(); };
    panel.onResize = function () { redraw(); };
    panel.layout.layout(true);
    editorOpen = true;
    redraw();
  }

  function openEditor() {
    if (editorOpen && win) { try { win.show(); } catch (e) {} return; }
    win = new Window("palette", "mos_收缩 · 曲线 " + VERSION, undefined, { resizeable: true });
    win.orientation = "stack";
    win.alignChildren = ["fill", "fill"];
    win.margins = 0;
    win.spacing = 0;
    win.size = [340, 300];
    bindCanvas(win.add("panel", undefined, undefined, { name: "canvas" }));
    win.onClose = function () { endGroup(); editorOpen = false; win = null; return true; };
    win.show();
    editorOpen = true;
    try { win.layout.layout(true); } catch (e) {}
    redraw();
  }

  // Dev hook: lets a script (and the test harness) repaint or drive the editor without a mouse.
  try {
    $.global.mosShrinkCurve = {
      version: VERSION,
      state: st,
      draw: onDraw,
      layout: layout,
      mouseDown: canvasMouseDown,
      mouseMove: canvasMouseMove,
      mouseUp: canvasMouseUp,
      canvasRef: function () { return canvas; },
      winRef: function () { return win; },
      refresh: function () { refreshBinding(); redraw(); },
      writeCurve: writeCurve,
      readCurve: readCurve,
      findEffect: findEffect,
      applyPreset: function (name) {
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === name) { setCurve(PRESETS[i].v); if (st.effect) writeCurve(st.effect, curveArray()); redraw(); return true; }
        }
        return false;
      }
    };
  } catch (e3) {}

  try {
    refreshTheme();
    refreshBinding();
    if (IS_PANEL) buildPanelLauncher(thisObj);
    else openEditor();
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    if (err && err.line !== undefined) msg += " @" + err.line;
    try { alert("mos_收缩 曲线: " + msg); } catch (e2) {}
  }
})(this);
