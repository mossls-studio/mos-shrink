// Read the real stored value and render two frames through the SAME plugin build.
var r = [];
var p = app.project;
r.push("project=" + (p.file ? p.file.name : "?"));
var comp = null;
for (var i = 1; i <= p.numItems; i++) { var it = p.item(i); if (it instanceof CompItem) { comp = it; break; } }
r.push("comp=" + (comp ? comp.name : "none"));
var layer = comp.layer(1);
var fx = layer.Effects;
r.push("fxCount=" + fx.numProperties);
var e = fx.property(1);
r.push("eff=" + e.name + " n=" + e.numProperties);
var before = e.property(1).value;
r.push("stored bend=" + before);

// render at two nearby values with the same engine + plugin
var outDir = "D:/mossls/mos/形变/收缩/build/out/";
e.property(1).setValue(-99.9);
var f1 = new File(outDir + "cli_999.png");
comp.openInViewer ? comp.openInViewer() : 0;
app.project.renderQueue.items.add(comp);
r.push("queued (manual render step follows)");
r.push("done");
r.join(" | ");
