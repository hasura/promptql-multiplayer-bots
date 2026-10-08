/* Figma Design Review — vector editor
 * Document: {bg, els:[...]}. Elements: rect, ellipse, line, text, image, group. A group's `els` are its children,
 * expressed in the same coordinate space as the group itself (the group box hugs them). Rect/ellipse/text/image/group
 * carry `rot` (degrees, clockwise about the centre); rect/ellipse/text may carry `grad` {angle, stops:[{o,c},{o,c}]}
 * (overrides `fill`); anything but a line may carry `shadow` {x,y,blur,color,op}; a group may carry `layout`
 * {dir:'row'|'col', gap, pad} — simple auto layout that re-flows its children and hugs them.
 * Multi-select (shift-click, marquee, ⌘A), align/distribute, smart snapping (hold ⌘/Ctrl to skip), undo/redo,
 * autosave with optimistic concurrency (PUT /api/frames/{id}/doc) and polling so everyone sees edits.
 */
(() => {
const NS = 'http://www.w3.org/2000/svg', XL = 'http://www.w3.org/1999/xlink';
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const DEFAULTS = {
  rect:    {fill:'#d9d9d9', stroke:'', sw:1, r:0, rot:0, opacity:1},
  ellipse: {fill:'#d9d9d9', stroke:'', sw:1, rot:0, opacity:1},
  line:    {fill:'', stroke:'#111111', sw:2, opacity:1},
  text:    {fill:'#111111', stroke:'', sw:0, fs:20, fw:400, align:'left', text:'Text', rot:0, opacity:1},
  image:   {fill:'', stroke:'', sw:0, rot:0, opacity:1},
};
const KEYS = {v:'select', r:'rect', o:'ellipse', l:'line', t:'text', i:'image'};
const LABEL = {rect:'Rectangle', ellipse:'Ellipse', line:'Line', text:'Text', image:'Image', group:'Group'};
const ALIGN_KEYS = {KeyA:'left', KeyD:'right', KeyW:'top', KeyS:'bottom', KeyH:'hcenter', KeyV:'vcenter'};
const MAX_IMG = 1600, SNAP = 6, ACC = '#6a4af0', GUIDE = '#e0407a', DEG = Math.PI / 180;

let H = {};                                   // page hooks
let root, svg, bgRect, layer, ui, gl;         // #canvas, the svg, background, element layer, selection layer, guides
let frame = null, doc = {bg:'#ffffff', els:[]}, version = 0;
let enabled = false, tool = 'select', sels = [], scope = null, drag = null;
let undo = [], redo = [], dirty = false, saving = false, saveT = null, pollT = null, rev = 0, clip = null, propsLive = false;
let textEd = null;                            // {id, ta, fresh}
let measureCtx = null;

const Z = () => (svg.getBoundingClientRect().width / (frame ? frame.width : 1)) || 1;
const pt = ev => { const r = svg.getBoundingClientRect(); const z = Z(); return {x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z}; };
const A = (n, o) => { for (const k in o) if (o[k] !== undefined && o[k] !== null) n.setAttribute(k, o[k]); return n; };
const mk = (t, o) => A(document.createElementNS(NS, t), o || {});
const norm = d => { d = ((d % 360) + 540) % 360 - 180; return Math.round(d * 100) / 100; };

// ------------------------------------------------------------------ tree helpers
function walk(list, fn, parent, depth) { for (const e of list) { fn(e, parent || null, depth || 0); if (e.type === 'group' && Array.isArray(e.els)) walk(e.els, fn, e, (depth || 0) + 1); } }
function all() { const o = []; walk(doc.els, e => o.push(e)); return o; }
function byId(id) { let r = null; walk(doc.els, e => { if (e.id === id) r = e; }); return r; }
function parentOf(id) { let r = null; walk(doc.els, (e, p) => { if (e.id === id) r = p; }); return r; }
function chain(id) { const c = []; let cur = id; while (cur) { c.unshift(cur); const p = parentOf(cur); cur = p ? p.id : null; } return c; }
function listOf(gid) { if (!gid) return doc.els; const g = byId(gid); return g && Array.isArray(g.els) ? g.els : doc.els; }
function containerOf(id) { const p = parentOf(id); return p ? p.els : doc.els; }
function selEls() { return sels.map(byId).filter(Boolean); }
function sameContainer(es) { if (!es.length) return true; const l = containerOf(es[0].id); return es.every(e => l.includes(e)); }
function rotOf(e) { return e.type === 'line' ? 0 : (+e.rot || 0); }
function scopeGroups() { return scope ? chain(scope).map(byId).filter(Boolean) : []; }
function resolveTop(id) {                       // which element a click on `id` means at the current scope level
  const ch = chain(id); if (!ch.length) return id;
  if (!scope) return ch[0];
  const i = ch.indexOf(scope);
  if (i >= 0 && i < ch.length - 1) return ch[i + 1];
  scope = null; return ch[0];
}
function setSel(ids) { sels = ids.filter((id, i) => ids.indexOf(id) === i && byId(id)); renderSel(); renderProps(); renderLayers(); }

// ------------------------------------------------------------------ geometry
const rotP = (x, y, cx, cy, deg) => { if (!deg) return {x, y}; const a = deg * DEG, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return {x: cx + dx * c - dy * s, y: cy + dx * s + dy * c}; };
const rotD = (d, deg) => { if (!deg) return d; const a = deg * DEG, c = Math.cos(a), s = Math.sin(a); return {x: d.x * c - d.y * s, y: d.x * s + d.y * c}; };
const rect = e => e.type === 'line' ? {x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h)} : {x: e.x, y: e.y, w: e.w, h: e.h};
const center = e => { const r = rect(e); return {x: r.x + r.w / 2, y: r.y + r.h / 2}; };
function aabb(e) {
  const r = rect(e), d = rotOf(e); if (!d) return r;
  const c = {x: r.x + r.w / 2, y: r.y + r.h / 2};
  const ps = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(p => rotP(p[0], p[1], c.x, c.y, d));
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
}
function union(bs) { if (!bs.length) return {x: 0, y: 0, w: 0, h: 0}; const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return {x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y}; }
const rotTf = e => { const r = rotOf(e); if (!r) return ''; const c = center(e); return `rotate(${r} ${c.x} ${c.y})`; };
const tfStr = gs => gs.map(rotTf).filter(Boolean).join(' ');
const ancTf = id => tfStr(chain(id).slice(0, -1).map(byId).filter(Boolean));   // transform of the space `id` lives in
const scopeTf = () => tfStr(scopeGroups());
function toLocalPt(p, gs) { let q = p; for (const g of gs) { const c = center(g); q = rotP(q.x, q.y, c.x, c.y, -rotOf(g)); } return q; }
function toLocalDelta(d, gs) { return rotD(d, -gs.reduce((a, g) => a + rotOf(g), 0)); }

function shiftEl(e, dx, dy) { if (!dx && !dy) return; e.x += dx; e.y += dy; if (e.type === 'group') for (const c of e.els || []) shiftEl(c, dx, dy); }
function scaleEl(e, ox, oy, kx, ky) {
  e.x = ox + (e.x - ox) * kx; e.y = oy + (e.y - oy) * ky; e.w *= kx; e.h *= ky;
  const k = Math.min(Math.abs(kx), Math.abs(ky));
  if (e.type === 'text') e.fs = Math.max(1, e.fs * k);
  if (e.type === 'rect' && e.r) e.r *= k;
  if (e.type === 'group') for (const c of e.els || []) scaleEl(c, ox, oy, kx, ky);
}
function setRect(g, nx, ny, nw, nh) {           // resize a group box keeping its visual rotation pivot; children follow
  const c0 = center(g), c1 = {x: nx + nw / 2, y: ny + nh / 2}, cr = rotP(c1.x, c1.y, c0.x, c0.y, rotOf(g));
  const dx = cr.x - c1.x, dy = cr.y - c1.y;
  g.x = nx + dx; g.y = ny + dy; g.w = nw; g.h = nh;
  if (dx || dy) for (const c of g.els || []) shiftEl(c, dx, dy);
}
function applyRect(e, o, x, y, w, h) {          // put element e (original o) into the unrotated box x,y,w,h
  if (e.type === 'group') {
    e.els = clone(o.els || []);
    if (o.w > 0 && o.h > 0) for (const c of e.els) scaleEl(c, o.x, o.y, w / o.w, h / o.h);
    for (const c of e.els) shiftEl(c, x - o.x, y - o.y);
  }
  e.x = x; e.y = y; e.w = w; e.h = h;
}
function bakeRot(k, cx, cy, r) {                // fold a parent's rotation into a child (used when ungrouping)
  if (k.type === 'line') { const p1 = rotP(k.x, k.y, cx, cy, r), p2 = rotP(k.x + k.w, k.y + k.h, cx, cy, r); k.x = p1.x; k.y = p1.y; k.w = p2.x - p1.x; k.h = p2.y - p1.y; return; }
  const c = center(k), c2 = rotP(c.x, c.y, cx, cy, r); shiftEl(k, c2.x - c.x, c2.y - c.y); k.rot = norm((+k.rot || 0) + r);
}
function reflow(g) {                            // simple auto layout: children in order, start-aligned, group hugs
  const L = g.layout, pad = Math.max(0, +L.pad || 0), gap = +L.gap || 0, kids = g.els || [];
  if (!kids.length) return;
  let cx = g.x + pad, cy = g.y + pad, maxW = 0, maxH = 0, tot = 0;
  for (const c of kids) {
    const b = aabb(c);
    shiftEl(c, (L.dir === 'row' ? cx : g.x + pad) - b.x, (L.dir === 'col' ? cy : g.y + pad) - b.y);
    if (L.dir === 'row') { cx += b.w + gap; tot += b.w; maxH = Math.max(maxH, b.h); } else { cy += b.h + gap; tot += b.h; maxW = Math.max(maxW, b.w); }
  }
  const n = kids.length;
  setRect(g, g.x, g.y, L.dir === 'row' ? tot + gap * (n - 1) + pad * 2 : maxW + pad * 2, L.dir === 'row' ? maxH + pad * 2 : tot + gap * (n - 1) + pad * 2);
}
function hugGroup(g) {
  if (!g.els || !g.els.length) return;
  if (g.layout && g.layout.dir) return reflow(g);
  const b = union(g.els.map(aabb)); setRect(g, b.x, b.y, b.w, b.h);
}
function hugAncestors(e) { let p = parentOf(e.id); while (p) { hugGroup(p); p = parentOf(p.id); } }
function hugAll(es) { const seen = new Set(); for (const e of es) { let p = parentOf(e.id); while (p) { if (!seen.has(p.id)) { hugGroup(p); seen.add(p.id); } p = parentOf(p.id); } } }
function sortLayout(g) { const L = g.layout; g.els.sort((a, b) => L.dir === 'row' ? center(a).x - center(b).x : center(a).y - center(b).y); reflow(g); }

// ------------------------------------------------------------------ building nodes
function gradCoords(angle) {
  const a = (angle == null ? 180 : +angle) * DEG, dx = Math.sin(a), dy = -Math.cos(a), L = (Math.abs(dx) + Math.abs(dy)) / 2;
  const f = v => Math.round(v * 1000) / 1000;
  return {x1: f(0.5 - dx * L), y1: f(0.5 - dy * L), x2: f(0.5 + dx * L), y2: f(0.5 + dy * L)};
}
const canGrad = e => e.type === 'rect' || e.type === 'ellipse' || e.type === 'text';
const canShadow = e => e.type !== 'line';
const canRot = e => e.type !== 'line';
function build(e, forExport) {
  const g = mk('g', {transform: rotTf(e) || null}); g.dataset.id = e.id;
  const defs = mk('defs'); let fill = e.fill || 'none';
  if (e.grad && e.grad.stops && canGrad(e)) {
    const lg = mk('linearGradient', {id: `g-${e.id}`, ...gradCoords(e.grad.angle)});
    for (const s of e.grad.stops) lg.appendChild(mk('stop', {offset: Math.round(clamp(+s.o || 0, 0, 1) * 100) + '%', 'stop-color': s.c || '#000000'}));
    defs.appendChild(lg); fill = `url(#g-${e.id})`;
  }
  if (e.shadow && canShadow(e)) {
    const f = mk('filter', {id: `f-${e.id}`, x: '-50%', y: '-50%', width: '200%', height: '200%'});
    f.appendChild(mk('feDropShadow', {dx: +e.shadow.x || 0, dy: +e.shadow.y || 0, stdDeviation: Math.max(0, +e.shadow.blur || 0) / 2, 'flood-color': e.shadow.color || '#000000', 'flood-opacity': e.shadow.op ?? 0.25}));
    defs.appendChild(f);
  }
  if (defs.firstChild) g.appendChild(defs);
  const body = mk('g', {filter: e.shadow && canShadow(e) ? `url(#f-${e.id})` : null});
  let n;
  if (e.type === 'group') {
    for (const c of e.els || []) body.appendChild(build(c, forExport));
    if (!forExport && !(e.els || []).length) g.appendChild(mk('rect', {x: e.x, y: e.y, width: Math.max(1, e.w), height: Math.max(1, e.h), fill: 'transparent', class: 'hit'}));
  } else if (e.type === 'rect') {
    n = mk('rect', {x: e.x, y: e.y, width: Math.max(0, e.w), height: Math.max(0, e.h), rx: e.r || 0, fill, stroke: e.stroke || 'none', 'stroke-width': e.stroke ? e.sw : 0});
  } else if (e.type === 'ellipse') {
    n = mk('ellipse', {cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: Math.max(0, e.w / 2), ry: Math.max(0, e.h / 2), fill, stroke: e.stroke || 'none', 'stroke-width': e.stroke ? e.sw : 0});
  } else if (e.type === 'line') {
    n = mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: e.stroke || '#111111', 'stroke-width': e.sw || 1, 'stroke-linecap': 'round'});
    if (!forExport) g.appendChild(mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: 'transparent', 'stroke-width': 12, class: 'hit'}));
  } else if (e.type === 'text') {
    const lines = String(e.text || '').split('\n');
    const ax = e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w : e.x;
    n = mk('text', {x: ax, y: e.y, 'font-size': e.fs, 'font-weight': e.fw, 'font-family': FONT, fill: fill === 'none' ? '#111111' : fill,
                    'text-anchor': e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start', 'dominant-baseline': 'hanging', style: 'white-space:pre'});
    lines.forEach((l, i) => { const ts = mk('tspan', {x: ax, dy: i ? e.fs * 1.25 : 0}); ts.textContent = l || ' '; n.appendChild(ts); });
    if (!forExport) g.appendChild(mk('rect', {x: e.x, y: e.y, width: Math.max(1, e.w), height: Math.max(1, e.h), fill: 'transparent', class: 'hit'}));
  } else if (e.type === 'image') {
    n = mk('image', {x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'none'});
    n.setAttribute('href', e.href || ''); n.setAttributeNS(XL, 'xlink:href', e.href || '');
  }
  if (n) body.appendChild(n);
  g.appendChild(body);
  A(g, {opacity: e.opacity ?? 1});
  return g;
}
function redrawTop(e) {
  const top = byId(chain(e.id)[0]) || e;
  const old = layer.querySelector(`:scope > g[data-id="${top.id}"]`);
  const n = build(top);
  if (old) layer.replaceChild(n, old); else layer.appendChild(n);
  if (textEd) { const t = n.querySelector(`g[data-id="${textEd.id}"]`) || (n.dataset.id === textEd.id ? n : null); if (t) t.style.opacity = 0; }
}
function render() {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
  A(bgRect, {fill: frame && frame.kind === 'local' ? (doc.bg || '#ffffff') : 'none'});
  for (const e of doc.els) layer.appendChild(build(e));
  if (scope && !byId(scope)) scope = null;
  sels = sels.filter(id => byId(id));
  renderSel(); renderProps(); renderLayers();
}
function renderSel() {
  while (ui.firstChild) ui.removeChild(ui.firstChild);
  sels = sels.filter(id => byId(id)); const es = selEls();
  if (!es.length || !enabled) return;
  const z = Z(), s = 8 / z;
  if (scope) { const sg = byId(scope); if (sg) { const w = mk('g', {transform: ancTf(sg.id) || null}); const r = rect(sg); w.appendChild(mk('rect', {x: r.x, y: r.y, width: r.w, height: r.h, transform: rotTf(sg) || null, fill: 'none', stroke: ACC, 'stroke-dasharray': `${4 / z} ${4 / z}`, 'stroke-width': 1 / z, 'pointer-events': 'none'})); ui.appendChild(w); } }
  for (const e of es) {
    const w = mk('g', {transform: [ancTf(e.id), rotTf(e)].filter(Boolean).join(' ') || null}); ui.appendChild(w);
    if (e.type === 'line') {
      w.appendChild(mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: ACC, 'stroke-width': 1 / z, 'pointer-events': 'none'}));
      if (es.length === 1) {
        w.appendChild(mk('circle', {cx: e.x, cy: e.y, r: 5 / z, fill: '#fff', stroke: ACC, 'stroke-width': 1.5 / z, 'data-h': 'p1', style: 'cursor:move'}));
        w.appendChild(mk('circle', {cx: e.x + e.w, cy: e.y + e.h, r: 5 / z, fill: '#fff', stroke: ACC, 'stroke-width': 1.5 / z, 'data-h': 'p2', style: 'cursor:move'}));
      }
      continue;
    }
    const b = rect(e);
    w.appendChild(mk('rect', {x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: ACC, 'stroke-width': (es.length === 1 ? 1.5 : 1) / z, 'pointer-events': 'none'}));
    if (es.length !== 1) continue;
    const hs = {nw: [b.x, b.y, 'nwse'], n: [b.x + b.w / 2, b.y, 'ns'], ne: [b.x + b.w, b.y, 'nesw'], e: [b.x + b.w, b.y + b.h / 2, 'ew'],
                se: [b.x + b.w, b.y + b.h, 'nwse'], s: [b.x + b.w / 2, b.y + b.h, 'ns'], sw: [b.x, b.y + b.h, 'nesw'], w: [b.x, b.y + b.h / 2, 'ew']};
    for (const k in hs) w.appendChild(mk('rect', {x: hs[k][0] - s / 2, y: hs[k][1] - s / 2, width: s, height: s, fill: '#fff', stroke: ACC, 'stroke-width': 1 / z, 'data-h': k, style: `cursor:${hs[k][2]}-resize`}));
    if (canRot(e)) {
      w.appendChild(mk('line', {x1: b.x + b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y - 18 / z, stroke: ACC, 'stroke-width': 1 / z, 'pointer-events': 'none'}));
      w.appendChild(mk('circle', {cx: b.x + b.w / 2, cy: b.y - 22 / z, r: 5 / z, fill: '#fff', stroke: ACC, 'stroke-width': 1.5 / z, 'data-h': 'rot', style: 'cursor:grab'}));
    }
  }
  if (es.length > 1) { const u = union(es.map(aabb)); const w = mk('g', {transform: scopeTf() || null}); w.appendChild(mk('rect', {x: u.x, y: u.y, width: u.w, height: u.h, fill: 'none', stroke: ACC, 'stroke-dasharray': `${4 / z} ${3 / z}`, 'stroke-width': 1 / z, 'pointer-events': 'none'})); ui.appendChild(w); }
}
function clearGuides() { while (gl.firstChild) gl.removeChild(gl.firstChild); }
function drawGuides(gx, gy, extra) {
  clearGuides(); const z = Z(); const w = mk('g', {transform: scopeTf() || null}); gl.appendChild(w);
  const W = frame.width, Hh = frame.height;
  if (gx != null) w.appendChild(mk('line', {x1: gx, x2: gx, y1: -40 / z, y2: Hh + 40 / z, stroke: GUIDE, 'stroke-width': 1 / z, 'pointer-events': 'none'}));
  if (gy != null) w.appendChild(mk('line', {y1: gy, y2: gy, x1: -40 / z, x2: W + 40 / z, stroke: GUIDE, 'stroke-width': 1 / z, 'pointer-events': 'none'}));
  if (extra) w.appendChild(extra);
}

// ------------------------------------------------------------------ snapping
function snapTargets(exclude) {
  let xs, ys;
  if (scope) { const g = byId(scope); const r = rect(g); xs = [r.x, r.x + r.w / 2, r.x + r.w]; ys = [r.y, r.y + r.h / 2, r.y + r.h]; }
  else { xs = [0, frame.width / 2, frame.width]; ys = [0, frame.height / 2, frame.height]; }
  for (const e of listOf(scope)) if (!exclude.includes(e.id)) { const b = aabb(e); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  return {xs, ys};
}
function snapBox(b, t, xsOnly) {
  const th = SNAP / Z(); const best = {dx: 0, dy: 0, gx: null, gy: null}; let ex = th, ey = th;
  const vx = b.w === 0 ? [b.x] : [b.x, b.x + b.w / 2, b.x + b.w], vy = b.h === 0 ? [b.y] : [b.y, b.y + b.h / 2, b.y + b.h];
  for (const v of vx) for (const tx of t.xs) { const d = Math.abs(tx - v); if (d < ex) { ex = d; best.dx = tx - v; best.gx = tx; } }
  if (!xsOnly) for (const v of vy) for (const ty of t.ys) { const d = Math.abs(ty - v); if (d < ey) { ey = d; best.dy = ty - v; best.gy = ty; } }
  return best;
}

// ------------------------------------------------------------------ history / mutation
function snapshot() { undo.push(clone(doc)); if (undo.length > 100) undo.shift(); redo = []; }
function mutate(fn) { snapshot(); fn(); render(); markDirty(); }
function doUndo() { if (!undo.length) return; redo.push(clone(doc)); doc = undo.pop(); render(); markDirty(); }
function doRedo() { if (!redo.length) return; undo.push(clone(doc)); doc = redo.pop(); render(); markDirty(); }
function select(id) { setSel(id ? [id] : []); }
function remove(ids) { ids = ids || sels; if (!ids.length) return; mutate(() => { const parents = ids.map(parentOf).filter(Boolean); for (const id of ids) { const l = containerOf(id); const i = l.findIndex(e => e.id === id); if (i >= 0) l.splice(i, 1); } sels = sels.filter(id => !ids.includes(id)); for (const p of parents) if (byId(p.id)) { if (!p.els.length) { const l = containerOf(p.id); l.splice(l.indexOf(p), 1); if (scope === p.id) scope = null; } else hugGroup(p); } }); }
function reId(e) { e.id = uid(); if (e.type === 'group') for (const c of e.els || []) reId(c); return e; }
function duplicate() { const es = selEls(); if (!es.length) return; mutate(() => { const out = []; for (const e of es) { const c = reId(clone(e)); shiftEl(c, 16, 16); const l = containerOf(e.id); l.splice(l.indexOf(e) + 1, 0, c); out.push(c.id); } sels = out; hugAll(selEls()); }); }
function paste() { if (!clip || !clip.length) return; mutate(() => { const l = listOf(scope); const out = []; for (const o of clip) { const c = reId(clone(o)); shiftEl(c, 24, 24); l.push(c); out.push(c.id); } sels = out; if (scope) hugGroup(byId(scope)); }); }
function reorder(dir) {
  const es = selEls(); if (!es.length || !sameContainer(es)) return;
  const l = containerOf(es[0].id);
  mutate(() => { const idx = es.map(e => l.indexOf(e)).sort((a, b) => dir > 0 ? b - a : a - b); for (const i of idx) { const j = i + dir; if (j < 0 || j >= l.length || es.includes(l[j])) continue; [l[i], l[j]] = [l[j], l[i]]; } });
}
function nudge(ev) {
  const es = selEls(); if (!es.length) return;
  const d = ev.shiftKey ? 10 : 1, dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0, dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
  mutate(() => { for (const e of es) shiftEl(e, dx, dy); hugAll(es); });
}
function align(kind) {
  const es = selEls(); if (!es.length) return;
  const boxes = es.map(aabb);
  const ref = es.length === 1 ? (scope ? rect(byId(scope)) : {x: 0, y: 0, w: frame.width, h: frame.height}) : union(boxes);
  mutate(() => {
    es.forEach((e, i) => {
      const b = boxes[i]; let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.x - b.x; else if (kind === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); else if (kind === 'right') dx = ref.x + ref.w - (b.x + b.w);
      else if (kind === 'top') dy = ref.y - b.y; else if (kind === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); else if (kind === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      shiftEl(e, dx, dy);
    });
    hugAll(es);
  });
}
function distribute(axis) {
  const es = selEls(); if (es.length < 3) { H.toast('Select at least three layers to distribute', 'warn'); return; }
  const items = es.map(e => ({e, b: aabb(e)})).sort((a, b) => axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y);
  const first = items[0].b, last = items[items.length - 1].b;
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sum = items.reduce((s, i) => s + (axis === 'h' ? i.b.w : i.b.h), 0), gap = (span - sum) / (items.length - 1);
  mutate(() => { let cur = axis === 'h' ? first.x : first.y; for (const it of items) { const v = axis === 'h' ? it.b.x : it.b.y; shiftEl(it.e, axis === 'h' ? cur - v : 0, axis === 'h' ? 0 : cur - v); cur += (axis === 'h' ? it.b.w : it.b.h) + gap; } hugAll(es); });
}
function groupSel() {
  const es = selEls(); if (!es.length) return null;
  if (!sameContainer(es)) { H.toast('Select layers inside the same group to group them', 'warn'); return null; }
  const l = containerOf(es[0].id); let gid = null;
  mutate(() => {
    const idxs = es.map(e => l.indexOf(e)).sort((a, b) => a - b); const kids = idxs.map(i => l[i]);
    const b = union(kids.map(aabb));
    const g = {id: uid(), type: 'group', x: b.x, y: b.y, w: b.w, h: b.h, rot: 0, opacity: 1, els: kids};
    for (let i = idxs.length - 1; i >= 0; i--) l.splice(idxs[i], 1);
    l.splice(Math.min(idxs[idxs.length - 1] - idxs.length + 1, l.length), 0, g);
    sels = [g.id]; gid = g.id; hugAncestors(g);
  });
  return gid;
}
function ungroupSel() {
  const gs = selEls().filter(e => e.type === 'group'); if (!gs.length) return;
  mutate(() => {
    const out = [];
    for (const g of gs) {
      const p = parentOf(g.id), l = p ? p.els : doc.els, i = l.indexOf(g), c = center(g), r = rotOf(g);
      const kids = (g.els || []).map(k => { if (r) bakeRot(k, c.x, c.y, r); return k; });
      l.splice(i, 1, ...kids); out.push(...kids.map(k => k.id));
      if (scope === g.id) scope = p ? p.id : null;
    }
    sels = out;
  });
}
function toggleLayout(dir) {                   // Shift+A: auto layout on the selected group (groups the selection first)
  let es = selEls(); if (!es.length) return;
  if (!(es.length === 1 && es[0].type === 'group')) { if (!groupSel()) return; es = selEls(); }
  const g = es[0];
  mutate(() => { if (dir === 'none' || (!dir && g.layout)) delete g.layout; else { g.layout = {dir: dir || 'row', gap: g.layout ? g.layout.gap : 8, pad: g.layout ? g.layout.pad : 0}; reflow(g); hugAncestors(g); } });
}
function setGeom(e, k, v) {
  if (!(v > -1e7 && v < 1e7)) return;
  if (k === 'x') shiftEl(e, v - e.x, 0); else if (k === 'y') shiftEl(e, 0, v - e.y);
  else if (k === 'w' || k === 'h') { if (e.type === 'line' || e.type !== 'group') e[k] = v; else { const r = rect(e); if (r.w > 0 && r.h > 0) scaleEl(e, e.x, e.y, k === 'w' ? v / r.w : 1, k === 'h' ? v / r.h : 1); else e[k] = v; } }
  else if (k === 'rot') e.rot = norm(v);
  else e[k] = v;
}

// ------------------------------------------------------------------ pointer interaction
function onDown(ev) {
  if (!enabled || ev.button !== 0 || !frame) return;
  if (textEd) commitText();
  const p0 = pt(ev);
  const h = ev.target.closest ? ev.target.closest('[data-h]') : null;
  const gEl = ev.target.closest ? ev.target.closest('g[data-id]') : null;
  ev.preventDefault();
  try { svg.setPointerCapture(ev.pointerId); } catch {}
  if (tool === 'select') {
    if (h && sels.length === 1) {
      const e = selEls()[0]; const gs = scopeGroups(); snapshot();
      if (h.dataset.h === 'rot') { const c = center(e), pl = toLocalPt(p0, gs); drag = {kind: 'rotate', id: e.id, o: clone(e), c, a0: Math.atan2(pl.y - c.y, pl.x - c.x) / DEG, gs}; }
      else drag = {kind: 'resize', h: h.dataset.h, p0, id: e.id, o: clone(e), gs, rot: gs.reduce((a, g) => a + rotOf(g), 0) + rotOf(e)};
      return;
    }
    if (gEl) {
      const id = resolveTop(gEl.dataset.id);
      if (ev.shiftKey) { setSel(sels.includes(id) ? sels.filter(x => x !== id) : [...sels, id]); drag = {kind: 'none'}; return; }
      if (!sels.includes(id)) setSel([id]);
      snapshot(); drag = {kind: 'move', p0, o: selEls().map(clone), moved: false, gs: scopeGroups()}; return;
    }
    if (!ev.shiftKey) { if (scope) scope = null; setSel([]); }
    drag = {kind: 'marquee', p0, pl: toLocalPt(p0, scopeGroups()), base: ev.shiftKey ? sels.slice() : [], gs: scopeGroups()};
    return;
  }
  if (tool === 'image') { H.pickImage && H.pickImage(); setTool('select'); return; }
  snapshot();
  const gs = scopeGroups(), pl = toLocalPt(p0, gs);
  const e = {id: uid(), type: tool, x: pl.x, y: pl.y, w: 0, h: 0, ...clone(DEFAULTS[tool])};
  listOf(scope).push(e); sels = [e.id];
  drag = {kind: 'create', p0, pl, id: e.id, shift: ev.shiftKey, gs};
  redrawTop(e); renderSel();
}
function onMove(ev) {
  if (!drag || drag.kind === 'none') return;
  const p0 = pt(ev), raw = {x: p0.x - drag.p0.x, y: p0.y - drag.p0.y}, noSnap = ev.metaKey || ev.ctrlKey;
  if (drag.kind === 'marquee') {
    const pl = toLocalPt(p0, drag.gs), x = Math.min(pl.x, drag.pl.x), y = Math.min(pl.y, drag.pl.y), w = Math.abs(pl.x - drag.pl.x), h = Math.abs(pl.y - drag.pl.y);
    drag.box = {x, y, w, h};
    drawGuides(null, null, mk('rect', {x, y, width: w, height: h, fill: ACC, 'fill-opacity': .08, stroke: ACC, 'stroke-width': 1 / Z(), 'pointer-events': 'none'}));
    return;
  }
  if (drag.kind === 'move') {
    if (Math.abs(raw.x) + Math.abs(raw.y) > 0.5) drag.moved = true;
    let d = toLocalDelta(raw, drag.gs);
    if (ev.shiftKey) { if (Math.abs(d.y) > Math.abs(d.x)) d.x = 0; else d.y = 0; }
    let gx = null, gy = null;
    if (!noSnap && drag.o.length) {
      const u = union(drag.o.map(aabb)); const s = snapBox({x: u.x + d.x, y: u.y + d.y, w: u.w, h: u.h}, snapTargets(sels));
      d = {x: d.x + s.dx, y: d.y + s.dy}; gx = s.gx; gy = s.gy;
    }
    for (const o of drag.o) { const e = byId(o.id); if (e) shiftEl(e, o.x + d.x - e.x, o.y + d.y - e.y); }
    drawGuides(gx, gy);
    for (const o of drag.o) { const e = byId(o.id); if (e) redrawTop(e); }
    renderSel(); renderProps(true); return;
  }
  if (drag.kind === 'rotate') {
    const e = byId(drag.id); if (!e) return;
    const pl = toLocalPt(p0, drag.gs); let r = (+drag.o.rot || 0) + Math.atan2(pl.y - drag.c.y, pl.x - drag.c.x) / DEG - drag.a0;
    if (ev.shiftKey) r = Math.round(r / 15) * 15;
    e.rot = norm(r); redrawTop(e); renderSel(); renderProps(true); return;
  }
  const e = byId(drag.kind === 'create' ? drag.id : drag.id); if (!e) return;
  if (drag.kind === 'create') {
    let pl = toLocalPt(p0, drag.gs), gx = null, gy = null;
    if (!noSnap) { const s = snapBox({x: pl.x, y: pl.y, w: 0, h: 0}, snapTargets([e.id])); pl = {x: pl.x + s.dx, y: pl.y + s.dy}; gx = s.gx; gy = s.gy; }
    const dx = pl.x - drag.pl.x, dy = pl.y - drag.pl.y;
    if (e.type === 'line') { e.w = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? dx : 0) : dx; e.h = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 0 : dy) : dy; }
    else {
      let w = dx, h = dy;
      if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      e.x = Math.min(drag.pl.x, drag.pl.x + w); e.y = Math.min(drag.pl.y, drag.pl.y + h); e.w = Math.abs(w); e.h = Math.abs(h);
    }
    drawGuides(gx, gy);
  } else if (drag.kind === 'resize') {
    const o = drag.o, hh = drag.h, d = rotD(raw, -drag.rot);
    if (e.type === 'line') {
      if (hh === 'p1') { e.x = o.x + d.x; e.y = o.y + d.y; e.w = o.w - d.x; e.h = o.h - d.y; } else { e.w = o.w + d.x; e.h = o.h + d.y; }
    } else {
      let {x, y, w, h} = o;
      if (hh.includes('e')) w = o.w + d.x;
      if (hh.includes('s')) h = o.h + d.y;
      if (hh.includes('w')) { x = o.x + d.x; w = o.w - d.x; }
      if (hh.includes('n')) { y = o.y + d.y; h = o.h - d.y; }
      if (ev.shiftKey && o.w > 0 && o.h > 0 && hh.length === 2) { const k = o.w / o.h; if (Math.abs(w / o.w) > Math.abs(h / o.h)) h = w / k; else w = h * k; if (hh.includes('n')) y = o.y + o.h - h; if (hh.includes('w')) x = o.x + o.w - w; }
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      let gx = null, gy = null;
      if (!noSnap && !drag.rot && !ev.shiftKey) {                       // snap the edges being dragged (unrotated only)
        const t = snapTargets([e.id]), th = SNAP / Z();
        const sx = v => { let b = null, be = th; for (const tx of t.xs) { const dd = Math.abs(tx - v); if (dd < be) { be = dd; b = tx; } } return b; };
        const sy = v => { let b = null, be = th; for (const ty of t.ys) { const dd = Math.abs(ty - v); if (dd < be) { be = dd; b = ty; } } return b; };
        if (hh.includes('e')) { const v = sx(x + w); if (v != null) { w = v - x; gx = v; } }
        if (hh.includes('w')) { const v = sx(x); if (v != null) { w += x - v; x = v; gx = v; } }
        if (hh.includes('s')) { const v = sy(y + h); if (v != null) { h = v - y; gy = v; } }
        if (hh.includes('n')) { const v = sy(y); if (v != null) { h += y - v; y = v; gy = v; } }
      }
      if (rotOf(o)) { const c0 = center(o), c1 = {x: x + w / 2, y: y + h / 2}, cr = rotP(c1.x, c1.y, c0.x, c0.y, rotOf(o)); x = cr.x - w / 2; y = cr.y - h / 2; }
      applyRect(e, o, x, y, w, h);
      drawGuides(gx, gy);
    }
  }
  redrawTop(e); renderSel(); renderProps(true);
}
function onUp(ev) {
  if (!drag) return;
  const d = drag; drag = null; clearGuides();
  if (d.kind === 'none') return;
  if (d.kind === 'marquee') {
    if (d.box && (d.box.w > 2 || d.box.h > 2)) {
      const hit = listOf(scope).filter(e => { const b = aabb(e); return b.x < d.box.x + d.box.w && b.x + b.w > d.box.x && b.y < d.box.y + d.box.h && b.y + b.h > d.box.y; }).map(e => e.id);
      setSel([...d.base, ...hit]);
    } else renderSel();
    return;
  }
  const e = byId(d.id || (d.o && d.o[0] && d.o[0].id));
  if (d.kind === 'move') {
    if (!d.moved) { undo.pop(); return; }
    const es = selEls(); const p = es.length && parentOf(es[0].id);
    if (p && p.layout && p.layout.dir && sameContainer(es)) sortLayout(p);
    hugAll(es);
  }
  if (d.kind === 'create' && e) {
    if (e.type === 'line') { if (Math.abs(e.w) < 3 && Math.abs(e.h) < 3) { e.w = 160; e.h = 0; } }
    else if (e.w < 4 && e.h < 4) {
      if (e.type === 'text') { e.w = 220; e.h = e.fs * 1.3; }
      else { e.w = 120; e.h = 120; e.x -= 60; e.y -= 60; }
    }
    if (e.type === 'text') { if (e.h < e.fs * 1.3) e.h = e.fs * 1.3; }
    hugAncestors(e);
    redrawTop(e); renderSel();
    if (!d.shift) setTool('select');
    if (e.type === 'text') { startTextEdit(e, true); return; }
  }
  if ((d.kind === 'resize' || d.kind === 'rotate') && e) hugAncestors(e);
  render(); markDirty();
}
function onDbl(ev) {
  if (!enabled) return;
  const gEl = ev.target.closest ? ev.target.closest('g[data-id]') : null; if (!gEl) return;
  const ch = chain(gEl.dataset.id); const top = resolveTop(gEl.dataset.id); const e = byId(top);
  if (!e) return;
  if (e.type === 'group') { scope = e.id; const i = ch.indexOf(e.id); setSel(i >= 0 && i < ch.length - 1 ? [ch[i + 1]] : []); return; }
  if (e.type === 'text') { select(e.id); snapshot(); startTextEdit(e, false); }
}

// ------------------------------------------------------------------ inline text editing
function measure(e) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${e.fw} ${e.fs}px ${FONT}`;
  return Math.max(...String(e.text || '').split('\n').map(l => measureCtx.measureText(l || ' ').width));
}
function textEdPos(e, ta) {
  const z = Z(), c = center(e), gs = chain(e.id).slice(0, -1).map(byId).filter(Boolean);
  let tl = {x: e.x, y: e.y}, cc = c, tot = rotOf(e);
  for (let i = gs.length - 1; i >= 0; i--) { const g = gs[i], gc = center(g); tl = rotP(tl.x, tl.y, gc.x, gc.y, rotOf(g)); cc = rotP(cc.x, cc.y, gc.x, gc.y, rotOf(g)); tot += rotOf(g); }
  // place the box at the element's unrotated top-left, then rotate it (about the visual centre) by the total rotation
  const w = Math.max(e.w, 60) * z, lh = e.fs * 1.3 * z;
  Object.assign(ta.style, {left: cc.x * z - (cc.x - tl.x) * z + 'px', top: cc.y * z - (cc.y - tl.y) * z + 'px', width: w + 'px', minHeight: lh + 'px',
    transformOrigin: `${(cc.x - tl.x) * z}px ${(cc.y - tl.y) * z}px`, transform: tot ? `rotate(${tot}deg)` : '', fontSize: e.fs * z + 'px'});
}
function startTextEdit(e, fresh) {
  if (textEd) commitText();
  const z = Z(), ta = document.createElement('textarea');
  ta.className = 'txted'; ta.value = e.text || '';
  Object.assign(ta.style, {position: 'absolute', font: `${e.fw} ${e.fs * z}px/${1.25} ${FONT}`, color: e.fill || '#111', background: 'transparent', border: `1px dashed ${ACC}`, outline: 'none',
    padding: 0, margin: 0, resize: 'none', overflow: 'hidden', whiteSpace: 'pre', textAlign: e.align || 'left', zIndex: 4});
  textEdPos(e, ta);
  root.appendChild(ta);
  const g = layer.querySelector(`g[data-id="${e.id}"]`); if (g) g.style.opacity = 0;
  textEd = {id: e.id, ta, fresh};
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.oninput = grow; grow();
  ta.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Escape' || ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter')) { ev.preventDefault(); commitText(); } };
  ta.onblur = () => setTimeout(() => { if (textEd && textEd.ta === ta) commitText(); }, 0);
  ta.onpointerdown = ev => ev.stopPropagation();
  ta.focus(); if (fresh) ta.select();
}
function commitText() {
  if (!textEd) return;
  const {id, ta} = textEd; textEd = null;
  const e = byId(id); const v = ta.value;
  ta.remove();
  if (!e) return;
  if (!v.trim()) { const l = containerOf(id); l.splice(l.indexOf(e), 1); sels = sels.filter(x => x !== id); }
  else { e.text = v.replace(/\n+$/, ''); const lines = e.text.split('\n').length; e.h = Math.max(e.h, lines * e.fs * 1.25 + e.fs * 0.1); e.w = Math.max(e.w, measure(e) + 4); hugAncestors(e); }
  render(); markDirty();
}

// ------------------------------------------------------------------ images
async function addImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (!enabled) { H.toast('Switch to Design mode (D) to add images', 'warn'); return; }
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  let href = url, w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) > MAX_IMG || file.size > 1_500_000) {
    const k = Math.min(1, MAX_IMG / Math.max(w, h)); const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    href = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
  }
  const fit = Math.min(1, (frame.width * 0.8) / w, (frame.height * 0.8) / h);
  const ew = Math.round(w * fit), eh = Math.round(h * fit);
  mutate(() => { const e = {id: uid(), type: 'image', x: Math.round((frame.width - ew) / 2), y: Math.round((frame.height - eh) / 2), w: ew, h: eh, href, ...clone(DEFAULTS.image)}; listOf(scope).push(e); sels = [e.id]; hugAncestors(e); });
  setTool('select');
}

// ------------------------------------------------------------------ properties + layers panels
const fld = (k, v, type, extra) => `<input class="fld" data-k="${k}" type="${type || 'text'}" value="${esc(v)}" ${extra || ''}>`;
const num = (k, v, extra) => fld(k, Math.round((v || 0) * 100) / 100, 'number', 'step="1" ' + (extra || ''));
const colorRow = (k, v, label, fixed) => `<label>${label}</label><div class="crow${fixed ? ' fixed' : ''}">
  <input type="color" data-k="${k}" data-color="1" value="${esc(v || '#000000')}" ${v ? '' : 'disabled'} title="${label} colour">
  <input class="fld" data-k="${k}" type="text" value="${esc(v || '')}" placeholder="none" title="${label} (hex${fixed ? '' : ', or empty for none'})">
  ${fixed ? '' : `<button type="button" class="ib sm" data-clear="${k}" title="${v ? 'Remove ' + label.toLowerCase() : 'Add ' + label.toLowerCase()}">${v ? 'None' : 'Add'}</button>`}</div>`;
const I = {
  left: '<path d="M3 3v18M8 7h12v4H8zM8 13h8v4H8z"/>', hcenter: '<path d="M12 3v18M6 7h12v4H6zM8 13h8v4H8z"/>', right: '<path d="M21 3v18M4 7h12v4H4zM8 13h8v4H8z"/>',
  top: '<path d="M3 3h18M7 8h4v12H7zM13 8h4v8h-4z"/>', vcenter: '<path d="M3 12h18M7 6h4v12H7zM13 8h4v8h-4z"/>', bottom: '<path d="M3 21h18M7 4h4v12H7zM13 8h4v8h-4z"/>',
  dh: '<path d="M3 3v18M21 3v18M9 8h6v8H9z"/>', dv: '<path d="M3 3h18M3 21h18M8 9h8v6H8z"/>',
  row: '<path d="M3 5h18v14H3zM10 5v14M16 5v14"/>', col: '<path d="M3 5h18v14H3zM3 10h18M3 15h18"/>', off: '<path d="M4 4l16 16M4 20L20 4"/>',
};
const ico = k => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const alignRow = n => `<label>Align${n > 1 ? '' : ' to frame'}</label><div class="algn">
  ${['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map(k => `<button type="button" data-al="${k}" title="Align ${k.replace('h', 'horizontal ').replace('v', 'vertical ')} (⌥${ {left:'A',hcenter:'H',right:'D',top:'W',vcenter:'V',bottom:'S'}[k]})">${ico(k)}</button>`).join('')}
  <button type="button" data-dist="h" title="Distribute horizontally (⌃⌥H)" ${n < 3 ? 'disabled' : ''}>${ico('dh')}</button><button type="button" data-dist="v" title="Distribute vertically (⌃⌥V)" ${n < 3 ? 'disabled' : ''}>${ico('dv')}</button></div>`;
const shadowBlock = e => `<div class="sect"><label>Shadow</label><button type="button" class="ib sm" data-tog="shadow">${e.shadow ? 'Remove' : 'Add'}</button></div>
  ${e.shadow ? `<label>Offset / blur</label><div class="three">${num('sh.x', e.shadow.x)}${num('sh.y', e.shadow.y)}${num('sh.blur', e.shadow.blur, 'min="0"')}</div>
  ${colorRow('sh.color', e.shadow.color || '#000000', 'Shadow colour', true)}
  <label>Shadow opacity</label><div class="two"><input type="range" data-k="sh.op" min="0" max="1" step="0.05" value="${e.shadow.op ?? 0.25}"><span class="muted" data-pct="sh.op">${Math.round((e.shadow.op ?? 0.25) * 100)}%</span></div>` : ''}`;
const fillBlock = e => `<label>Fill</label><div class="segm"><button type="button" data-ft="solid" class="${e.grad ? '' : 'on'}">Solid</button><button type="button" data-ft="grad" class="${e.grad ? 'on' : ''}">Gradient</button></div>
  ${e.grad ? `${colorRow('gr.c0', e.grad.stops[0].c, 'From', true)}${colorRow('gr.c1', e.grad.stops[1].c, 'To', true)}<label>Angle</label>${num('gr.angle', e.grad.angle ?? 180, 'min="0" max="360"')}` : colorRow('fill', e.fill, 'Colour')}`;

function renderProps(live) {
  const box = H.props; if (!box) return;
  if (live && !box.dataset.id) return;
  const es = selEls(); const e = es.length === 1 ? es[0] : null;
  if (live && e && box.dataset.id === e.id) {           // dragging: just refresh geometry fields
    box.querySelectorAll('[data-k="x"],[data-k="y"],[data-k="w"],[data-k="h"],[data-k="rot"]').forEach(i => { if (document.activeElement !== i) i.value = Math.round((e[i.dataset.k] || 0) * 100) / 100; });
    return;
  }
  if (live) return;
  if (!es.length) {
    box.dataset.id = '';
    if (!frame) { box.innerHTML = '<div class="empty">No frame selected.</div>'; return; }
    const local = frame.kind === 'local', sg = scope && byId(scope);
    box.innerHTML = `<div class="ptitle">${sg ? 'Inside group' : 'Frame'}</div>
      ${sg ? `<div class="prop"><label>Group</label>${fld('gname', sg.name || 'Group', 'text', 'disabled')}</div><div class="phelp">Click a child to edit it. <b>Esc</b> or double-click the canvas to leave the group.</div>` : `<div class="prop"><label>Name</label>${fld('fname', frame.name)}
      <label>Size</label><div class="two">${num('fw', frame.width, local ? '' : 'disabled')}${num('fh', frame.height, local ? '' : 'disabled')}</div>
      ${local ? colorRow('bg', doc.bg || '#ffffff', 'Background') : ''}</div>
      <div class="phelp">${local ? 'Press <b>R</b>, <b>O</b>, <b>L</b>, <b>T</b> or <b>I</b> and drag on the canvas to draw. Paste or drop an image anytime.'
                                 : 'This frame is rendered from Figma. Anything you draw here sits on top of it and is kept when you Refresh from Figma. Push to Figma recreates it as native layers.'}
      <br><b>⇧</b>-click or drag a box to select several; <b>⌘G</b> group, <b>⇧A</b> auto layout, <b>⌥A/D/W/S/H/V</b> align, hold <b>⌘</b> to skip snapping.</div>
      ${local && H.canDeleteFrame && H.canDeleteFrame() ? '<button type="button" class="ib danger" data-act="delframe">Delete frame</button>' : ''}`}`;
    return;
  }
  if (!e) {                                             // several layers
    box.dataset.id = '';
    box.innerHTML = `<div class="ptitle">${es.length} layers</div><div class="prop">${alignRow(es.length)}</div>
      <div class="prow"><button type="button" class="ib" data-act="group" title="Group (⌘G)">Group</button>${es.some(x => x.type === 'group') ? '<button type="button" class="ib" data-act="ungroup" title="Ungroup (⇧⌘G)">Ungroup</button>' : ''}<button type="button" class="ib" data-act="layout" title="Auto layout (⇧A)">Auto layout</button><button type="button" class="ib" data-act="dup" title="Duplicate (⌘D)">Duplicate</button><button type="button" class="ib danger" data-act="del" title="Delete (⌫)">Delete</button></div>`;
    return;
  }
  box.dataset.id = e.id;
  const isText = e.type === 'text', isLine = e.type === 'line', isGroup = e.type === 'group', L = e.layout;
  box.innerHTML = `<div class="ptitle">${LABEL[e.type]}${isGroup ? ` · ${(e.els || []).length}` : ''}</div>
    <div class="prop">
      <label>Position</label><div class="two">${num('x', e.x)}${num('y', e.y)}</div>
      <label>${isLine ? 'Delta' : 'Size'}</label><div class="two">${num('w', e.w, L ? 'disabled' : '')}${num('h', e.h, L ? 'disabled' : '')}</div>
      ${canRot(e) ? `<label>Rotation</label><div class="two">${num('rot', e.rot, 'min="-180" max="180"')}<span class="muted">degrees</span></div>` : ''}
      ${isGroup ? `<label>Auto layout</label><div class="segm"><button type="button" data-lay="none" class="${L ? '' : 'on'}" title="No auto layout">Off</button><button type="button" data-lay="row" class="${L && L.dir === 'row' ? 'on' : ''}" title="Horizontal">${ico('row')}</button><button type="button" data-lay="col" class="${L && L.dir === 'col' ? 'on' : ''}" title="Vertical">${ico('col')}</button></div>
      ${L ? `<label>Gap / padding</label><div class="two">${num('ly.gap', L.gap)}${num('ly.pad', L.pad, 'min="0"')}</div>` : ''}` : ''}
      ${canGrad(e) ? fillBlock(e) : ''}
      ${e.type === 'image' || isLine || isGroup ? '' : colorRow('stroke', e.stroke, 'Stroke')}
      ${isLine ? colorRow('stroke', e.stroke, 'Colour') : ''}
      ${e.type === 'image' || isGroup ? '' : `<label>Stroke width</label>${num('sw', e.sw, 'min="0"')}`}
      ${e.type === 'rect' ? `<label>Radius</label>${num('r', e.r, 'min="0"')}` : ''}
      <label>Opacity</label><div class="two"><input type="range" data-k="opacity" min="0" max="1" step="0.05" value="${e.opacity ?? 1}"><span class="muted" data-pct="opacity">${Math.round((e.opacity ?? 1) * 100)}%</span></div>
      ${isText ? `<label>Text</label><textarea class="fld" data-k="text" rows="3">${esc(e.text)}</textarea>
      <label>Font</label><div class="two">${num('fs', e.fs, 'min="4"')}<select class="fld" data-k="fw"><option value="400"${e.fw == 400 ? ' selected' : ''}>Regular</option><option value="500"${e.fw == 500 ? ' selected' : ''}>Medium</option><option value="600"${e.fw == 600 ? ' selected' : ''}>Semibold</option><option value="700"${e.fw == 700 ? ' selected' : ''}>Bold</option></select></div>
      <label>Align</label><div class="segm">${['left', 'center', 'right'].map(a => `<button type="button" data-align="${a}" class="${e.align === a ? 'on' : ''}" title="Align ${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>` : ''}
      ${canShadow(e) ? shadowBlock(e) : ''}
      ${alignRow(1)}
    </div>
    <div class="prow"><button type="button" class="ib" data-act="back" title="Send backward ([)">↓ Back</button><button type="button" class="ib" data-act="fwd" title="Bring forward (])">↑ Forward</button>${isGroup ? '<button type="button" class="ib" data-act="ungroup" title="Ungroup (⇧⌘G)">Ungroup</button>' : '<button type="button" class="ib" data-act="group" title="Group (⌘G)">Group</button>'}<button type="button" class="ib" data-act="dup" title="Duplicate (⌘D)">Duplicate</button><button type="button" class="ib danger" data-act="del" title="Delete (⌫)">Delete</button></div>`;
}
function onPropInput(ev, commit) {
  const t = ev.target; const k = t.dataset.k; const box = H.props;
  if (!k || t.tagName === 'BUTTON') return;
  const e = box.dataset.id ? byId(box.dataset.id) : null;
  if (!e) {                                               // frame-level fields
    if (!frame) return;
    if (k === 'bg') { if (!propsLive) { snapshot(); propsLive = true; } doc.bg = t.value || '#ffffff'; if (t.dataset.color) { const tx = box.querySelector('input[type=text][data-k="bg"]'); if (tx) tx.value = t.value; } A(bgRect, {fill: doc.bg}); if (commit) { propsLive = false; markDirty(); } return; }
    if (!commit) return;
    if (k === 'fname' && t.value.trim() && H.patchFrame) H.patchFrame({name: t.value.trim()});
    if ((k === 'fw' || k === 'fh') && H.patchFrame) { const w = k === 'fw' ? +t.value : frame.width, h = k === 'fh' ? +t.value : frame.height; if (w >= 8 && h >= 8) H.patchFrame({width: w, height: h}); }
    return;
  }
  if (!propsLive) { snapshot(); propsLive = true; }
  const sub = k.split('.');
  if (k === 'opacity' || k === 'sh.op') { const v = +t.value; if (k === 'opacity') e.opacity = v; else if (e.shadow) e.shadow.op = v; const o = box.querySelector(`[data-pct="${k}"]`); if (o) o.textContent = Math.round(v * 100) + '%'; }
  else if (['x', 'y', 'w', 'h', 'sw', 'r', 'fs', 'rot'].includes(k)) { if (t.value !== '') { setGeom(e, k, +t.value); if (commit) hugAncestors(e); } if (k === 'fs' && e.type === 'text' && commit) { e.h = Math.max(e.fs * 1.3, e.text.split('\n').length * e.fs * 1.25); e.w = Math.max(e.w, measure(e) + 4); } }
  else if (k === 'fill' || k === 'stroke' || sub[0] === 'sh' || sub[0] === 'gr') {
    const v = t.value;
    if (t.type === 'color' || /^#[0-9a-f]{6}$/i.test(v) || (v === '' && (k === 'fill' || k === 'stroke'))) {
      if (k === 'fill' || k === 'stroke') e[k] = v;
      else if (k === 'sh.color' && e.shadow) e.shadow.color = v;
      else if (k === 'gr.c0' && e.grad) e.grad.stops[0].c = v;
      else if (k === 'gr.c1' && e.grad) e.grad.stops[1].c = v;
      else if (k === 'gr.angle' && e.grad) e.grad.angle = +v;
      else if (sub[0] === 'sh' && e.shadow) e.shadow[sub[1]] = +v;
      if (t.dataset.color) { const tx = box.querySelector(`input[type=text][data-k="${k}"]`); if (tx) tx.value = v; }
      else if (t.type === 'text') { const c = box.querySelector(`input[type=color][data-k="${k}"]`); if (c && v) { c.value = v; c.disabled = false; } }
    } else if (t.type === 'number') {
      if (k === 'gr.angle' && e.grad) e.grad.angle = +v; else if (sub[0] === 'sh' && e.shadow) e.shadow[sub[1]] = +v;
    }
  }
  else if (sub[0] === 'ly' && e.layout) { e.layout[sub[1]] = +t.value; reflow(e); if (commit) hugAncestors(e); }
  else if (k === 'text') { e.text = t.value; e.h = Math.max(e.fs * 1.3, e.text.split('\n').length * e.fs * 1.25); }
  else if (k === 'fw') e.fw = +t.value;
  redrawTop(e); renderSel(); renderLayers();
  if (commit) { propsLive = false; markDirty(); if (['x', 'y', 'w', 'h', 'rot', 'fs', 'text'].includes(k) || sub[0] === 'ly') render(); }
}
function onPropClick(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  const box = H.props; const e = box.dataset.id ? byId(box.dataset.id) : null;
  if (b.dataset.act === 'delframe') { H.deleteFrame && H.deleteFrame(); return; }
  if (b.dataset.al) { align(b.dataset.al); return; }
  if (b.dataset.dist) { distribute(b.dataset.dist); return; }
  const act = b.dataset.act;
  if (act === 'del') { remove(); return; }
  if (act === 'dup') { duplicate(); return; }
  if (act === 'group') { groupSel(); return; }
  if (act === 'ungroup') { ungroupSel(); return; }
  if (act === 'layout') { toggleLayout('row'); return; }
  if (act === 'fwd') { reorder(1); return; }
  if (act === 'back') { reorder(-1); return; }
  if (b.dataset.clear) {
    const k = b.dataset.clear; if (k === 'bg' || !e) return;
    mutate(() => { e[k] = e[k] ? '' : (k === 'fill' ? '#d9d9d9' : '#111111'); });
    return;
  }
  if (!e) return;
  if (b.dataset.align) mutate(() => { e.align = b.dataset.align; });
  else if (b.dataset.tog === 'shadow') mutate(() => { if (e.shadow) delete e.shadow; else e.shadow = {x: 0, y: 4, blur: 16, color: '#000000', op: 0.25}; });
  else if (b.dataset.ft) mutate(() => { if (b.dataset.ft === 'grad') { if (!e.grad) e.grad = {angle: 180, stops: [{o: 0, c: e.fill || '#6a4af0'}, {o: 1, c: '#f5a3c7'}]}; } else if (e.grad) { e.fill = e.grad.stops[0].c; delete e.grad; } });
  else if (b.dataset.lay) toggleLayout(b.dataset.lay);
}
function renderLayers() {
  const box = H.layers; if (!box) return;
  if (!doc.els.length) { box.innerHTML = '<div class="empty small">Nothing drawn yet.</div>'; return; }
  const rows = [];
  const lay = (list, depth) => { for (const e of [...list].reverse()) {
    rows.push(`<div class="lyr ${sels.includes(e.id) ? 'on' : ''}${scope === e.id ? ' scoped' : ''}" data-id="${e.id}" role="button" tabindex="0" style="padding-left:${8 + depth * 14}px">
      <span class="lt">${LABEL[e.type]}${e.type === 'group' && e.layout ? ' ⇄' : ''}</span><span class="ln">${esc(e.type === 'text' ? (e.text || '').split('\n')[0].slice(0, 28) : e.type === 'group' ? `${(e.els || []).length} layers` : `${Math.round(rect(e).w)}×${Math.round(rect(e).h)}`)}</span></div>`);
    if (e.type === 'group') lay(e.els || [], depth + 1);
  } };
  lay(doc.els, 0);
  box.innerHTML = rows.join('');
  const pick = (id, shift) => { const p = parentOf(id); const ps = p ? p.id : null; if (shift && ps === scope) setSel(sels.includes(id) ? sels.filter(x => x !== id) : [...sels, id]); else { scope = ps; setSel([id]); } };
  box.querySelectorAll('.lyr').forEach(n => { n.onclick = ev => pick(n.dataset.id, ev.shiftKey); n.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(n.dataset.id, ev.shiftKey); } }; });
  const on = box.querySelector('.lyr.on'); if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded(false);
}

// ------------------------------------------------------------------ saving / polling
function status(s) { H.onStatus && H.onStatus(s); }
function markDirty() { dirty = true; rev++; status('Unsaved changes'); clearTimeout(saveT); saveT = setTimeout(save, 700); }
async function save() {
  if (!frame || !dirty) return;
  if (saving) { clearTimeout(saveT); saveT = setTimeout(save, 400); return; }
  if (!(H.me && H.me())) { status('Open from PromptQL to save'); return; }
  saving = true; const at = rev, fid = frame.id; status('Saving…');
  try {
    const r = await fetch(`/api/frames/${encodeURIComponent(fid)}/doc`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({doc, base_version: version})});
    const j = await r.json().catch(() => null);
    if (!frame || frame.id !== fid) return;
    if (r.status === 409 && j && j.doc) { doc = j.doc; version = j.version; dirty = false; undo = []; redo = []; sels = []; scope = null; render(); H.toast(j.error || 'Someone else saved this frame — reloaded', 'warn'); status(`v${version}`); }
    else if (!r.ok) { status('Save failed'); H.toast((j && (j.error || j.detail)) || `Save failed (${r.status})`, 'err'); }
    else { version = j.version; if (rev === at) { dirty = false; status(`Saved · v${version}`); } else { clearTimeout(saveT); saveT = setTimeout(save, 200); } }
  } catch (e) { status('Save failed'); H.toast('Could not save: ' + e.message, 'err'); }
  finally { saving = false; }
}
async function poll() {
  if (!frame || document.hidden || dirty || saving || drag || textEd) return;
  const fid = frame.id;
  try {
    const r = await fetch(`/api/frames/${encodeURIComponent(fid)}/doc`); if (!r.ok) return;
    const j = await r.json(); if (!frame || frame.id !== fid || j.version === version) return;
    doc = j.doc || {bg: '#ffffff', els: []}; version = j.version; undo = []; redo = [];
    render(); status(`v${version}` + (j.updated_by_name ? ` · ${j.updated_by_name}` : ''));
  } catch {}
}

// ------------------------------------------------------------------ export
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
async function toSVG(opts) {
  opts = opts || {};
  const W = Math.round(frame.width), Hh = Math.round(frame.height);
  const out = [`<svg xmlns="${NS}" xmlns:xlink="${XL}" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">`, `<title>${esc(frame.name)}</title>`];
  if (frame.kind === 'local') out.push(`<rect width="${W}" height="${Hh}" fill="${esc(doc.bg || '#ffffff')}"/>`);
  else if (opts.embedBase !== false && frame.image) {
    try { const b = await (await fetch(frame.image)).blob(); const u = await blobToDataURL(b); out.push(`<image width="${W}" height="${Hh}" href="${u}" xlink:href="${u}" preserveAspectRatio="none"/>`); } catch {}
  }
  const ser = new XMLSerializer();
  for (const e of doc.els) { const n = build(e, true); n.removeAttribute('data-id'); n.querySelectorAll('[data-id]').forEach(x => x.removeAttribute('data-id')); out.push(ser.serializeToString(n)); }
  out.push('</svg>');
  return out.join('\n');
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const safeName = () => (frame.name || 'frame').replace(/[^\w\- ]+/g, '').trim() || 'frame';
async function copySVG() {
  const s = await toSVG();
  try { await navigator.clipboard.writeText(s); H.toast('SVG copied — switch to Figma and press ⌘V / Ctrl+V on the canvas'); return true; }
  catch { download(safeName() + '.svg', new Blob([s], {type: 'image/svg+xml'})); H.toast('Clipboard blocked by the browser — downloaded the SVG instead; drag it into Figma', 'warn'); return false; }
}
async function downloadSVG() { download(safeName() + '.svg', new Blob([await toSVG()], {type: 'image/svg+xml'})); }
async function downloadPNG(scale) {
  const s = await toSVG(); const url = URL.createObjectURL(new Blob([s], {type: 'image/svg+xml'}));
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); scale = scale || 2; c.width = Math.round(frame.width * scale); c.height = Math.round(frame.height * scale);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  c.toBlob(b => download(safeName() + '@' + scale + 'x.png', b), 'image/png');
}

// ------------------------------------------------------------------ public api
function setTool(t) { tool = KEYS[t] ? KEYS[t] : (t in LABEL || t === 'select' ? t : 'select'); svg.style.cursor = tool === 'select' ? 'default' : 'crosshair'; H.onTool && H.onTool(tool); }
function setEnabled(on) { enabled = !!on; svg.style.pointerEvents = enabled ? 'auto' : 'none'; if (!enabled) { if (textEd) commitText(); scope = null; select(null); } else renderSel(); }
function handleKey(ev) {
  if (!enabled) return false;
  if (textEd) return false;
  const meta = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  if (meta && k === 'z') { if (ev.shiftKey) doRedo(); else doUndo(); return true; }
  if (meta && k === 'y') { doRedo(); return true; }
  if (meta && !ev.altKey && (k === 'g' || ev.code === 'KeyG')) { if (ev.shiftKey) ungroupSel(); else groupSel(); return true; }
  if (meta && k === 'a' && !ev.altKey) { setSel(listOf(scope).map(e => e.id)); return true; }
  if (meta && ev.altKey && (ev.code === 'KeyH' || ev.code === 'KeyV')) { distribute(ev.code === 'KeyH' ? 'h' : 'v'); return true; }
  if (!meta && ev.altKey && ALIGN_KEYS[ev.code] && sels.length) { align(ALIGN_KEYS[ev.code]); return true; }
  if (!meta && !ev.altKey && ev.shiftKey && ev.code === 'KeyA' && sels.length) { toggleLayout(); return true; }
  if (meta && k === 'd' && sels.length) { duplicate(); return true; }
  if (meta && k === 'c' && sels.length) { clip = selEls().map(clone); H.toast(`Copied ${clip.length} layer${clip.length > 1 ? 's' : ''}`); return true; }
  if (meta && k === 'v' && clip) { paste(); return true; }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && sels.length) { remove(); return true; }
  if (ev.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (sels.length) { const keep = scope; setSel([]); if (keep && !byId(keep)) scope = null; } else if (scope) { const p = parentOf(scope); const was = scope; scope = p ? p.id : null; setSel([was]); } return true; }
  if (!meta && !ev.altKey && KEYS[k]) { setTool(KEYS[k]); return true; }
  if (ev.key.startsWith('Arrow') && sels.length) { nudge(ev); return true; }
  if ((ev.key === '[' || ev.key === ']') && sels.length) { reorder(ev.key === ']' ? 1 : -1); return true; }
  if (ev.key === 'Enter' && sels.length === 1) { const e = selEls()[0]; if (e.type === 'text') { snapshot(); startTextEdit(e, false); return true; } if (e.type === 'group') { scope = e.id; setSel((e.els || []).length ? [e.els[e.els.length - 1].id] : []); return true; } }
  return false;
}
function init(hooks) {
  H = hooks; root = hooks.canvas;
  svg = mk('svg', {id: 'design', width: 1, height: 1, viewBox: '0 0 1 1'}); svg.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:visible';
  bgRect = mk('rect', {x: 0, y: 0, width: '100%', height: '100%', fill: 'none'}); svg.appendChild(bgRect);
  layer = mk('g', {id: 'els'}); svg.appendChild(layer);
  gl = mk('g', {id: 'guides'}); svg.appendChild(gl);
  ui = mk('g', {id: 'selui'}); svg.appendChild(ui);
  root.appendChild(svg);
  svg.addEventListener('pointerdown', onDown); svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp); svg.addEventListener('pointercancel', onUp); svg.addEventListener('dblclick', onDbl);
  if (H.props) { H.props.addEventListener('input', ev => onPropInput(ev, false)); H.props.addEventListener('change', ev => onPropInput(ev, true)); H.props.addEventListener('click', onPropClick); }
  pollT = setInterval(poll, 5000);
}
async function load(fr) {
  if (dirty && frame) { clearTimeout(saveT); await save(); }
  frame = fr; sels = []; scope = null; drag = null; undo = []; redo = []; dirty = false; if (textEd) { textEd.ta.remove(); textEd = null; }
  doc = {bg: '#ffffff', els: []}; version = 0; render(); status('');
  if (!fr) return;
  try {
    const r = await fetch(`/api/frames/${encodeURIComponent(fr.id)}/doc`);
    if (!r.ok) throw new Error(`doc ${r.status}`);
    const j = await r.json(); if (frame !== fr) return;
    doc = j.doc || doc; version = j.version || 0; render(); status(version ? `v${version}` : '');
  } catch (e) { H.toast('Could not load the drawing layer: ' + e.message, 'err'); }
}
function resize(zoom) {
  if (!frame) return;
  A(svg, {width: frame.width * zoom, height: frame.height * zoom, viewBox: `0 0 ${frame.width} ${frame.height}`});
  renderSel();
  if (textEd) { const e = byId(textEd.id); if (e) textEdPos(e, textEd.ta); }
}
function setFrameMeta(fr) { if (frame && fr.id === frame.id) { frame = fr; resize(Z()); renderProps(); } }

window.Editor = {init, load, resize, setEnabled, setTool, handleKey, addImageFile, undo: doUndo, redo: doRedo, copySVG, downloadSVG, downloadPNG, toSVG,
  align, distribute, group: groupSel, ungroup: ungroupSel, autoLayout: toggleLayout,
  setFrameMeta, flush: () => { clearTimeout(saveT); return save(); }, get state() { return {tool, sels: sels.slice(), scope, dirty, version, count: all().length}; }};
})();