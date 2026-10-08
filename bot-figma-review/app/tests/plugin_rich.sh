#!/bin/sh
# Builds a plugin for a rich doc (groups, auto layout, rotation, gradient, shadow) and runs it in the API stub.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
.venv/bin/python - "$TMP" <<'PY'
import json, sys, pathlib
tmp = pathlib.Path(sys.argv[1])
tpl = pathlib.Path("static/figma_plugin.js").read_text()
rich = {"app": "Figma Design Review", "file": "T", "key": "Lx", "frames": [{"name": "Rich", "width": 400, "height": 300, "kind": "local", "bg": "#ffffff", "node_id": None, "els": [
  {"id": "g1", "type": "group", "x": 10, "y": 10, "w": 220, "h": 60, "rot": 15, "opacity": 0.9, "layout": {"dir": "row", "gap": 8, "pad": 6},
   "shadow": {"x": 0, "y": 4, "blur": 16, "color": "#000000", "op": 0.25},
   "els": [
     {"id": "r1", "type": "rect", "x": 16, "y": 16, "w": 100, "h": 48, "fill": "#d9d9d9", "stroke": "", "sw": 1, "r": 8, "rot": 0, "opacity": 1, "grad": {"angle": 90, "stops": [{"o": 0, "c": "#6a4af0"}, {"o": 1, "c": "#f5a3c7"}]}},
     {"id": "g2", "type": "group", "x": 124, "y": 16, "w": 100, "h": 48, "rot": 0, "opacity": 1, "els": [
        {"id": "e1", "type": "ellipse", "x": 124, "y": 16, "w": 48, "h": 48, "fill": "#22c55e", "stroke": "#111111", "sw": 2, "rot": -30, "opacity": 1},
        {"id": "t1", "type": "text", "x": 176, "y": 20, "w": 48, "h": 26, "fill": "#111111", "fs": 18, "fw": 700, "align": "center", "text": "Go", "rot": 10, "opacity": 1, "shadow": {"x": 1, "y": 1, "blur": 2, "color": "#ff0000", "op": 0.5}}]}]},
  {"id": "l1", "type": "line", "x": 10, "y": 100, "w": 200, "h": 0, "stroke": "#111111", "sw": 2, "opacity": 1},
  {"id": "r9", "type": "rect", "x": 50, "y": 150, "w": 80, "h": 40, "fill": "#ff8800", "rot": 45, "opacity": 1, "grad": {"angle": 0, "stops": [{"o": 0, "c": "#000"}, {"o": 1, "c": "#fff"}]}, "shadow": {"x": 2, "y": 2, "blur": 0, "color": "#0000ff"}},
  {"id": "ge", "type": "group", "x": 0, "y": 0, "w": 10, "h": 10, "els": []}]}]}
(tmp / "code.js").write_text(tpl.replace("__DESIGN__", json.dumps(rich), 1))
PY
node tests/plugin_sim.js "$TMP/code.js"
SIM_ORIG=1 node tests/plugin_sim.js "$TMP/code.js"
rm -rf "$TMP"