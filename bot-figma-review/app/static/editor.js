/* Figma Design Review — vector editor
 * Draws a design document ({bg, els:[...]}) on an SVG that sits over the frame. Used both for designs started
 * here (option A) and for drawing on top of frames pulled in from Figma (option B). Saves to
 * PUT /api/frames/{id}/doc with optimistic concurrency; polls so everyone on the board sees edits.
 * Exports standalone SVG, which Figma pastes as editable vector layers (its REST API cannot create layers).
 */
(() => {
const NS = 'http://www.w3.org/2000/svg', XL = 'http://www.w3.org/1999/xlink';
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FONT = 'Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const DEFAULTS = {
  rect:    {fill:'#d9d9d9', stroke:'', sw:1, r:0, opacity:1},
  ellipse: {fill:'#d9d9d9', stroke:'', sw:1, opacity:1},
  line:    {fill:'', stroke:'#111111', sw:2, opacity:1},
  text:    {fill:'#111111', stroke:'', sw:0, fs:20, fw:400, align:'left', text:'Text', opacity:1},
  image:   {fill:'', stroke:'', sw:0, opacity:1},
};
const KEYS = {v:'select', r:'rect', o:'ellipse', l:'line', t:'text', i:'image'};
const LABEL = {rect:'Rectangle', ellipse:'Ellipse', line:'Line', text:'Text', image:'Image'};
const MAX_IMG = 1600;

let H = {};                                   // page hooks
let root, svg, bgRect, layer, ui;             // #canvas, the svg, background, element layer, selection layer
let frame = null, doc = {bg:'#ffffff', els:[]}, version = 0;
let enabled = false, tool = 'select', sel = null, drag = null;
let undo = [], redo = [], dirty = false, saving = false, saveT = null, pollT = null, rev = 0, clip = null, propsLive = false;
let textEd = null;                            // {id, ta, fresh}
let measureCtx = null;

const Z = () => (svg.getBoundingClientRect().width / (frame ? frame.width : 1)) || 1;
const pt = ev => { const r = svg.getBoundingClientRect(); const z = Z(); return {x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z}; };
const byId = id => doc.els.find(e => e.id === id);
const bbox = e => e.type === 'line' ? {x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h)} : {x: e.x, y: e.y, w: e.w, h: e.h};
const A = (n, o) => { for (const k in o) if (o[k] !== undefined && o[k] !== null) n.setAttribute(k, o[k]); return n; };
const mk = (t, o) => A(document.createElementNS(NS, t), o || {});

// ------------------------------------------------------------------ building nodes
function build(e, forExport) {
  const g = mk('g'); g.dataset.id = e.id;
  let n;
  if (e.type === 'rect') {
    n = mk('rect', {x: e.x, y: e.y, width: Math.max(0, e.w), height: Math.max(0, e.h), rx: e.r || 0, fill: e.fill || 'none',
                    stroke: e.stroke || 'none', 'stroke-width': e.stroke ? e.sw : 0});
  } else if (e.type === 'ellipse') {
    n = mk('ellipse', {cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: Math.max(0, e.w / 2), ry: Math.max(0, e.h / 2), fill: e.fill || 'none',
                       stroke: e.stroke || 'none', 'stroke-width': e.stroke ? e.sw : 0});
  } else if (e.type === 'line') {
    n = mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: e.stroke || '#111111', 'stroke-width': e.sw || 1, 'stroke-linecap': 'round'});
    if (!forExport) g.appendChild(mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: 'transparent', 'stroke-width': 12, class: 'hit'}));
  } else if (e.type === 'text') {
    const lines = String(e.text || '').split('\n');
    const ax = e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w : e.x;
    n = mk('text', {x: ax, y: e.y, 'font-size': e.fs, 'font-weight': e.fw, 'font-family': FONT, fill: e.fill || '#111111',
                    'text-anchor': e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start', 'dominant-baseline': 'hanging',
                    style: 'white-space:pre'});
    lines.forEach((l, i) => { const ts = mk('tspan', {x: ax, dy: i ? e.fs * 1.25 : 0}); ts.textContent = l || ' '; n.appendChild(ts); });
    if (!forExport) g.appendChild(mk('rect', {x: e.x, y: e.y, width: Math.max(1, e.w), height: Math.max(1, e.h), fill: 'transparent', class: 'hit'}));
  } else if (e.type === 'image') {
    n = mk('image', {x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'none'});
    n.setAttribute('href', e.href || ''); n.setAttributeNS(XL, 'xlink:href', e.href || '');
  }
  if (n) g.appendChild(n);
  A(g, {opacity: e.opacity ?? 1});
  return g;
}
function redraw(e) {
  const old = layer.querySelector(`g[data-id="${e.id}"]`);
  const n = build(e);
  if (old) layer.replaceChild(n, old); else layer.appendChild(n);
  if (textEd && textEd.id === e.id) n.style.opacity = 0;
}
function render() {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
  A(bgRect, {fill: frame && frame.kind === 'local' ? (doc.bg || '#ffffff') : 'none'});
  for (const e of doc.els) layer.appendChild(build(e));
  renderSel(); renderProps(); renderLayers();
}
function renderSel() {
  while (ui.firstChild) ui.removeChild(ui.firstChild);
  const e = sel && byId(sel);
  if (!e || !enabled) { if (sel && !e) sel = null; return; }
  const z = Z(), s = 8 / z;
  if (e.type === 'line') {
    ui.appendChild(mk('line', {x1: e.x, y1: e.y, x2: e.x + e.w, y2: e.y + e.h, stroke: '#6a4af0', 'stroke-width': 1 / z, 'pointer-events': 'none'}));
    ui.appendChild(mk('circle', {cx: e.x, cy: e.y, r: 5 / z, fill: '#fff', stroke: '#6a4af0', 'stroke-width': 1.5 / z, 'data-h': 'p1', style: 'cursor:move'}));
    ui.appendChild(mk('circle', {cx: e.x + e.w, cy: e.y + e.h, r: 5 / z, fill: '#fff', stroke: '#6a4af0', 'stroke-width': 1.5 / z, 'data-h': 'p2', style: 'cursor:move'}));
    return;
  }
  const b = bbox(e);
  ui.appendChild(mk('rect', {x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: '#6a4af0', 'stroke-width': 1.5 / z, 'pointer-events': 'none'}));
  const hs = {nw: [b.x, b.y, 'nwse'], n: [b.x + b.w / 2, b.y, 'ns'], ne: [b.x + b.w, b.y, 'nesw'], e: [b.x + b.w, b.y + b.h / 2, 'ew'],
              se: [b.x + b.w, b.y + b.h, 'nwse'], s: [b.x + b.w / 2, b.y + b.h, 'ns'], sw: [b.x, b.y + b.h, 'nesw'], w: [b.x, b.y + b.h / 2, 'ew']};
  for (const k in hs) ui.appendChild(mk('rect', {x: hs[k][0] - s / 2, y: hs[k][1] - s / 2, width: s, height: s, fill: '#fff', stroke: '#6a4af0',
                                                 'stroke-width': 1 / z, 'data-h': k, style: `cursor:${hs[k][2]}-resize`}));
}

// ------------------------------------------------------------------ history / mutation
function snapshot() { undo.push(clone(doc)); if (undo.length > 100) undo.shift(); redo = []; }
function mutate(fn) { snapshot(); fn(); render(); markDirty(); }
function doUndo() { if (!undo.length) return; redo.push(clone(doc)); doc = undo.pop(); sel = sel && byId(sel) ? sel : null; render(); markDirty(); }
function doRedo() { if (!redo.length) return; undo.push(clone(doc)); doc = redo.pop(); sel = sel && byId(sel) ? sel : null; render(); markDirty(); }
function select(id) { sel = id; renderSel(); renderProps(); renderLayers(); }
function remove(id) { mutate(() => { doc.els = doc.els.filter(e => e.id !== id); if (sel === id) sel = null; }); }
function duplicate() { const e = byId(sel); if (!e) return; mutate(() => { const c = {...clone(e), id: uid(), x: e.x + 16, y: e.y + 16}; doc.els.push(c); sel = c.id; }); }
function paste() { if (!clip) return; mutate(() => { const c = {...clone(clip), id: uid(), x: clip.x + 24, y: clip.y + 24}; doc.els.push(c); sel = c.id; }); }
function reorder(id, dir) {
  const i = doc.els.findIndex(e => e.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.els.length) return;
  mutate(() => { const [e] = doc.els.splice(i, 1); doc.els.splice(j, 0, e); });
}
function nudge(ev) {
  const e = byId(sel); if (!e) return;
  const d = ev.shiftKey ? 10 : 1;
  mutate(() => { if (ev.key === 'ArrowLeft') e.x -= d; if (ev.key === 'ArrowRight') e.x += d; if (ev.key === 'ArrowUp') e.y -= d; if (ev.key === 'ArrowDown') e.y += d; });
}

// ------------------------------------------------------------------ pointer interaction
function onDown(ev) {
  if (!enabled || ev.button !== 0 || !frame) return;
  if (textEd) commitText();
  const p = pt(ev);
  const h = ev.target.closest ? ev.target.closest('[data-h]') : null;
  const g = ev.target.closest ? ev.target.closest('g[data-id]') : null;
  ev.preventDefault();
  try { svg.setPointerCapture(ev.pointerId); } catch {}
  if (tool === 'select') {
    if (h && sel) { snapshot(); drag = {kind: 'resize', h: h.dataset.h, p0: p, o: clone(byId(sel)), shift: ev.shiftKey}; }
    else if (g) { if (sel !== g.dataset.id) select(g.dataset.id); snapshot(); drag = {kind: 'move', p0: p, o: clone(byId(sel)), moved: false}; }
    else { select(null); drag = {kind: 'none'}; }
    return;
  }
  if (tool === 'image') { H.pickImage && H.pickImage(); setTool('select'); return; }
  snapshot();
  const e = {id: uid(), type: tool, x: p.x, y: p.y, w: 0, h: 0, ...clone(DEFAULTS[tool])};
  doc.els.push(e); sel = e.id;
  drag = {kind: 'create', p0: p, id: e.id, shift: ev.shiftKey};
  layer.appendChild(build(e)); renderSel();
}
function onMove(ev) {
  if (!drag || drag.kind === 'none') return;
  const p = pt(ev), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
  const e = byId(drag.kind === 'create' ? drag.id : sel); if (!e) return;
  if (drag.kind === 'move') {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) drag.moved = true;
    const lock = ev.shiftKey;
    e.x = drag.o.x + (lock && Math.abs(dy) > Math.abs(dx) ? 0 : dx);
    e.y = drag.o.y + (lock && Math.abs(dx) >= Math.abs(dy) ? 0 : dy);
  } else if (drag.kind === 'create') {
    if (e.type === 'line') { e.w = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? dx : 0) : dx; e.h = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 0 : dy) : dy; }
    else {
      let w = dx, h = dy;
      if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      e.x = Math.min(drag.p0.x, drag.p0.x + w); e.y = Math.min(drag.p0.y, drag.p0.y + h); e.w = Math.abs(w); e.h = Math.abs(h);
    }
  } else if (drag.kind === 'resize') {
    const o = drag.o, hh = drag.h;
    if (e.type === 'line') {
      if (hh === 'p1') { e.x = o.x + dx; e.y = o.y + dy; e.w = o.w - dx; e.h = o.h - dy; } else { e.w = o.w + dx; e.h = o.h + dy; }
    } else {
      let {x, y, w, h} = o;
      if (hh.includes('e')) w = o.w + dx;
      if (hh.includes('s')) h = o.h + dy;
      if (hh.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (hh.includes('n')) { y = o.y + dy; h = o.h - dy; }
      if (ev.shiftKey && o.w > 0 && o.h > 0 && hh.length === 2) { const k = o.w / o.h; if (Math.abs(w / o.w) > Math.abs(h / o.h)) h = w / k; else w = h * k; if (hh.includes('n')) y = o.y + o.h - h; if (hh.includes('w')) x = o.x + o.w - w; }
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      e.x = x; e.y = y; e.w = w; e.h = h;
    }
  }
  redraw(e); renderSel(); renderProps(true);
}
function onUp(ev) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'none') return;
  const e = byId(d.kind === 'create' ? d.id : sel);
  if (d.kind === 'move' && !d.moved) { undo.pop(); return; }
  if (d.kind === 'create' && e) {
    if (e.type === 'line') { if (Math.abs(e.w) < 3 && Math.abs(e.h) < 3) { e.w = 160; e.h = 0; } }
    else if (e.w < 4 && e.h < 4) {
      if (e.type === 'text') { e.w = 220; e.h = e.fs * 1.3; }
      else { e.w = 120; e.h = 120; e.x -= 60; e.y -= 60; }
    }
    if (e.type === 'text') { if (e.h < e.fs * 1.3) e.h = e.fs * 1.3; }
    redraw(e); renderSel();
    if (!d.shift) setTool('select');
    if (e.type === 'text') { startTextEdit(e, true); return; }
  }
  render(); markDirty();
}
function onDbl(ev) {
  if (!enabled) return;
  const g = ev.target.closest ? ev.target.closest('g[data-id]') : null;
  const e = g && byId(g.dataset.id);
  if (e && e.type === 'text') { select(e.id); snapshot(); startTextEdit(e, false); }
}

// ------------------------------------------------------------------ inline text editing
function measure(e) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${e.fw} ${e.fs}px ${FONT}`;
  return Math.max(...String(e.text || '').split('\n').map(l => measureCtx.measureText(l || ' ').width));
}
function startTextEdit(e, fresh) {
  if (textEd) commitText();
  const z = Z(), ta = document.createElement('textarea');
  ta.className = 'txted'; ta.value = e.text || '';
  Object.assign(ta.style, {position: 'absolute', left: e.x * z + 'px', top: e.y * z + 'px', width: Math.max(e.w, 60) * z + 'px', minHeight: e.fs * 1.3 * z + 'px',
    font: `${e.fw} ${e.fs * z}px/${1.25} ${FONT}`, color: e.fill || '#111', background: 'transparent', border: '1px dashed #6a4af0', outline: 'none',
    padding: 0, margin: 0, resize: 'none', overflow: 'hidden', whiteSpace: 'pre', textAlign: e.align || 'left', zIndex: 4});
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
  if (!v.trim()) { doc.els = doc.els.filter(x => x.id !== id); if (sel === id) sel = null; }
  else { e.text = v.replace(/\n+$/, ''); const lines = e.text.split('\n').length; e.h = Math.max(e.h, lines * e.fs * 1.25 + e.fs * 0.1); e.w = Math.max(e.w, measure(e) + 4); }
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
  mutate(() => { const e = {id: uid(), type: 'image', x: Math.round((frame.width - ew) / 2), y: Math.round((frame.height - eh) / 2), w: ew, h: eh, href, ...clone(DEFAULTS.image)}; doc.els.push(e); sel = e.id; });
  setTool('select');
}

// ------------------------------------------------------------------ properties + layers panels
const fld = (k, v, type, extra) => `<input class="fld" data-k="${k}" type="${type || 'text'}" value="${esc(v)}" ${extra || ''}>`;
const num = (k, v, extra) => fld(k, Math.round((v || 0) * 100) / 100, 'number', 'step="1" ' + (extra || ''));
const colorRow = (k, v, label) => `<label>${label}</label><div class="crow">
  <input type="color" data-k="${k}" data-color="1" value="${esc(v || '#000000')}" ${v ? '' : 'disabled'} title="${label} colour">
  <input class="fld" data-k="${k}" type="text" value="${esc(v || '')}" placeholder="none" title="${label} (hex, or empty for none)">
  <button type="button" class="ib sm" data-clear="${k}" title="${v ? 'Remove ' + label.toLowerCase() : 'Add ' + label.toLowerCase()}">${v ? 'None' : 'Add'}</button></div>`;

function renderProps(live) {
  const box = H.props; if (!box) return;
  if (live && !box.dataset.id) return;
  const e = sel && byId(sel);
  if (live && e && box.dataset.id === e.id) {           // dragging: just refresh geometry fields
    box.querySelectorAll('[data-k="x"],[data-k="y"],[data-k="w"],[data-k="h"]').forEach(i => { if (document.activeElement !== i) i.value = Math.round(e[i.dataset.k] * 100) / 100; });
    return;
  }
  if (!e) {
    box.dataset.id = '';
    if (!frame) { box.innerHTML = '<div class="empty">No frame selected.</div>'; return; }
    const local = frame.kind === 'local';
    box.innerHTML = `<div class="ptitle">Frame</div>
      <div class="prop"><label>Name</label>${fld('fname', frame.name)}
      <label>Size</label><div class="two">${num('fw', frame.width, local ? '' : 'disabled')}${num('fh', frame.height, local ? '' : 'disabled')}</div>
      ${local ? colorRow('bg', doc.bg || '#ffffff', 'Background') : ''}</div>
      <div class="phelp">${local ? 'Press <b>R</b>, <b>O</b>, <b>L</b>, <b>T</b> or <b>I</b> and drag on the canvas to draw. Paste or drop an image anytime.'
                                 : 'This frame is rendered from Figma. Anything you draw here sits on top of it and is kept when you Refresh from Figma. Export as SVG to carry it back.'}</div>
      ${local && H.canDeleteFrame && H.canDeleteFrame() ? '<button type="button" class="ib danger" data-act="delframe">Delete frame</button>' : ''}`;
    return;
  }
  box.dataset.id = e.id;
  const isText = e.type === 'text', isLine = e.type === 'line';
  box.innerHTML = `<div class="ptitle">${LABEL[e.type]}</div>
    <div class="prop">
      <label>Position</label><div class="two">${num('x', e.x)}${num('y', e.y)}</div>
      <label>${isLine ? 'Delta' : 'Size'}</label><div class="two">${num('w', e.w)}${num('h', e.h)}</div>
      ${e.type === 'image' || isLine ? '' : colorRow('fill', e.fill, 'Fill')}
      ${e.type === 'image' ? '' : colorRow('stroke', e.stroke, 'Stroke')}
      ${e.type === 'image' ? '' : `<label>Stroke width</label>${num('sw', e.sw, 'min="0"')}`}
      ${e.type === 'rect' ? `<label>Radius</label>${num('r', e.r, 'min="0"')}` : ''}
      <label>Opacity</label><div class="two"><input type="range" data-k="opacity" min="0" max="1" step="0.05" value="${e.opacity ?? 1}"><span class="muted" id="opv">${Math.round((e.opacity ?? 1) * 100)}%</span></div>
      ${isText ? `<label>Text</label><textarea class="fld" data-k="text" rows="3">${esc(e.text)}</textarea>
      <label>Font</label><div class="two">${num('fs', e.fs, 'min="4"')}<select class="fld" data-k="fw"><option value="400"${e.fw == 400 ? ' selected' : ''}>Regular</option><option value="500"${e.fw == 500 ? ' selected' : ''}>Medium</option><option value="600"${e.fw == 600 ? ' selected' : ''}>Semibold</option><option value="700"${e.fw == 700 ? ' selected' : ''}>Bold</option></select></div>
      <label>Align</label><div class="segm">${['left', 'center', 'right'].map(a => `<button type="button" data-align="${a}" class="${e.align === a ? 'on' : ''}" title="Align ${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="prow"><button type="button" class="ib" data-act="back" title="Send backward ([)">↓ Back</button><button type="button" class="ib" data-act="fwd" title="Bring forward (])">↑ Forward</button><button type="button" class="ib" data-act="dup" title="Duplicate (⌘D)">Duplicate</button><button type="button" class="ib danger" data-act="del" title="Delete (⌫)">Delete</button></div>`;
}
function onPropInput(ev, commit) {
  const t = ev.target; const k = t.dataset.k; const box = H.props;
  if (t.dataset.act || t.dataset.clear || t.dataset.align) return;
  if (!k) return;
  const e = box.dataset.id ? byId(box.dataset.id) : null;
  if (!e) {                                               // frame-level fields
    if (!frame) return;
    if (k === 'bg') { if (!propsLive) { snapshot(); propsLive = true; } doc.bg = t.value || '#ffffff'; if (t.dataset.color) { const tx = box.querySelector('input[type=text][data-k=bg]'); if (tx) tx.value = t.value; } A(bgRect, {fill: doc.bg}); if (commit) { propsLive = false; markDirty(); } return; }
    if (!commit) return;
    if (k === 'fname' && t.value.trim() && H.patchFrame) H.patchFrame({name: t.value.trim()});
    if ((k === 'fw' || k === 'fh') && H.patchFrame) { const w = k === 'fw' ? +t.value : frame.width, h = k === 'fh' ? +t.value : frame.height; if (w >= 8 && h >= 8) H.patchFrame({width: w, height: h}); }
    return;
  }
  if (!propsLive) { snapshot(); propsLive = true; }
  if (k === 'opacity') { e.opacity = +t.value; const o = box.querySelector('#opv'); if (o) o.textContent = Math.round(e.opacity * 100) + '%'; }
  else if (['x', 'y', 'w', 'h', 'sw', 'r', 'fs'].includes(k)) { if (t.value !== '') e[k] = +t.value; if (k === 'fs' && e.type === 'text' && commit) { e.h = Math.max(e.fs * 1.3, e.text.split('\n').length * e.fs * 1.25); e.w = Math.max(e.w, measure(e) + 4); } }
  else if (k === 'fill' || k === 'stroke') { e[k] = t.value; if (t.dataset.color) { const tx = box.querySelector(`input[type=text][data-k=${k}]`); if (tx) tx.value = t.value; } else if (/^#[0-9a-f]{6}$/i.test(t.value)) { const c = box.querySelector(`input[type=color][data-k=${k}]`); if (c) { c.value = t.value; c.disabled = false; } } }
  else if (k === 'text') { e.text = t.value; e.h = Math.max(e.fs * 1.3, e.text.split('\n').length * e.fs * 1.25); }
  else if (k === 'fw') e.fw = +t.value;
  redraw(e); renderSel(); renderLayers();
  if (commit) { propsLive = false; markDirty(); }
}
function onPropClick(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  const box = H.props; const e = box.dataset.id ? byId(box.dataset.id) : null;
  if (b.dataset.act === 'delframe') { H.deleteFrame && H.deleteFrame(); return; }
  if (b.dataset.clear) {
    const k = b.dataset.clear;
    if (k === 'bg') return;
    if (!e) return;
    mutate(() => { e[k] = e[k] ? '' : (k === 'fill' ? '#d9d9d9' : '#111111'); });
    return;
  }
  if (!e) return;
  if (b.dataset.align) mutate(() => { e.align = b.dataset.align; });
  else if (b.dataset.act === 'del') remove(e.id);
  else if (b.dataset.act === 'dup') duplicate();
  else if (b.dataset.act === 'fwd') reorder(e.id, 1);
  else if (b.dataset.act === 'back') reorder(e.id, -1);
}
function renderLayers() {
  const box = H.layers; if (!box) return;
  if (!doc.els.length) { box.innerHTML = '<div class="empty small">Nothing drawn yet.</div>'; return; }
  box.innerHTML = [...doc.els].reverse().map(e => `<div class="lyr ${sel === e.id ? 'on' : ''}" data-id="${e.id}" role="button" tabindex="0">
      <span class="lt">${LABEL[e.type]}</span><span class="ln">${esc(e.type === 'text' ? (e.text || '').split('\n')[0].slice(0, 28) : `${Math.round(e.w)}×${Math.round(e.h)}`)}</span></div>`).join('');
  box.querySelectorAll('.lyr').forEach(n => { n.onclick = () => select(n.dataset.id); n.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(n.dataset.id); } }; });
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
    if (r.status === 409 && j && j.doc) { doc = j.doc; version = j.version; dirty = false; undo = []; redo = []; sel = null; render(); H.toast(j.error || 'Someone else saved this frame — reloaded', 'warn'); status(`v${version}`); }
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
    if (sel && !byId(sel)) sel = null;
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
  for (const e of doc.els) { const n = build(e, true); n.removeAttribute('data-id'); out.push(ser.serializeToString(n)); }
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
function setEnabled(on) { enabled = !!on; svg.style.pointerEvents = enabled ? 'auto' : 'none'; if (!enabled) { if (textEd) commitText(); select(null); } else renderSel(); }
function handleKey(ev) {
  if (!enabled) return false;
  if (textEd) return false;
  const meta = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  if (meta && k === 'z') { if (ev.shiftKey) doRedo(); else doUndo(); return true; }
  if (meta && k === 'y') { doRedo(); return true; }
  if (meta && k === 'd' && sel) { duplicate(); return true; }
  if (meta && k === 'c' && sel) { clip = clone(byId(sel)); H.toast('Copied'); return true; }
  if (meta && k === 'v' && clip) { paste(); return true; }
  if (meta && k === 'a') { return false; }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { remove(sel); return true; }
  if (ev.key === 'Escape') { if (tool !== 'select') setTool('select'); else select(null); return true; }
  if (!meta && !ev.altKey && KEYS[k]) { setTool(KEYS[k]); return true; }
  if (ev.key.startsWith('Arrow') && sel) { nudge(ev); return true; }
  if ((ev.key === '[' || ev.key === ']') && sel) { reorder(sel, ev.key === ']' ? 1 : -1); return true; }
  if (ev.key === 'Enter' && sel) { const e = byId(sel); if (e && e.type === 'text') { snapshot(); startTextEdit(e, false); return true; } }
  return false;
}
function init(hooks) {
  H = hooks; root = hooks.canvas;
  svg = mk('svg', {id: 'design', width: 1, height: 1, viewBox: '0 0 1 1'}); svg.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:visible';
  bgRect = mk('rect', {x: 0, y: 0, width: '100%', height: '100%', fill: 'none'}); svg.appendChild(bgRect);
  layer = mk('g', {id: 'els'}); svg.appendChild(layer);
  ui = mk('g', {id: 'selui'}); svg.appendChild(ui);
  root.appendChild(svg);
  svg.addEventListener('pointerdown', onDown); svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp); svg.addEventListener('pointercancel', onUp); svg.addEventListener('dblclick', onDbl);
  if (H.props) { H.props.addEventListener('input', ev => onPropInput(ev, false)); H.props.addEventListener('change', ev => onPropInput(ev, true)); H.props.addEventListener('click', onPropClick); }
  pollT = setInterval(poll, 5000);
}
async function load(fr) {
  if (dirty && frame) { clearTimeout(saveT); await save(); }
  frame = fr; sel = null; drag = null; undo = []; redo = []; dirty = false; if (textEd) { textEd.ta.remove(); textEd = null; }
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
  if (textEd) { const e = byId(textEd.id); if (e) { const z = Z(); Object.assign(textEd.ta.style, {left: e.x * z + 'px', top: e.y * z + 'px', width: Math.max(e.w, 60) * z + 'px', fontSize: e.fs * z + 'px'}); } }
}
function setFrameMeta(fr) { if (frame && fr.id === frame.id) { frame = fr; resize(Z()); renderProps(); } }

window.Editor = {init, load, resize, setEnabled, setTool, handleKey, addImageFile, undo: doUndo, redo: doRedo, copySVG, downloadSVG, downloadPNG, toSVG,
  setFrameMeta, flush: () => { clearTimeout(saveT); return save(); }, get state() { return {tool, sel, dirty, version, count: doc.els.length}; }};
})();