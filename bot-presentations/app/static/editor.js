/* Slide editor (presentation kit). Plain DOM, no build step. The deck lives on the server (api/deck) with a revision number. */
(() => {
'use strict';
const K = window.SlideKit;
const W = 1280, H = 720;
const UI_KEY = 'pql-slides-ui';
const CLIP = 'pql-slides/elements:';
const $ = s => document.querySelector(s);

let deck = null, rev = 0, cur = 0, sel = [];
let undo = [], redo = [], lastKey = null, lastT = 0;
let dirty = false, saving = false, saveTimer = 0, saveFail = 0;
let scale = 1, zoom = 'fit', tab = 'design';
let editingId = null, interacting = false, fileMode = 'add';
let thumbDrag = null, layerDrag = null, scrollThumb = false;

const slide = () => deck.slides[cur];
const elById = id => slide().elements.find(e => e.id === id);
const selEls = () => sel.map(elById).filter(Boolean);
const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 9);
const clone = o => JSON.parse(JSON.stringify(o));
const R = Math.round;
const isTyping = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/* ---------- tiny DOM helpers ---------- */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  if (value !== undefined) n.value = value;
  return n;
}
const ICONS = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  aL: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  aC: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  aR: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  aT: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  aM: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  aB: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  dH: '<path d="M4 3v18M20 3v18"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  dV: '<path d="M3 4h18M3 20h18"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
  front: '<path d="M7 11l5-5 5 5M7 17l5-5 5 5"/>', fwd: '<path d="M7 14l5-5 5 5"/>',
  bwd: '<path d="M7 10l5 5 5-5"/>', back: '<path d="M7 7l5 5 5-5M7 13l5 5 5-5"/>',
  tl: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', tc: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  tr: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  vt: '<path d="M4 4h16"/><path d="M12 20V9M8 13l4-4 4 4"/>', vm: '<path d="M4 12h16"/><path d="M12 3v5M12 16v5"/>',
  vb: '<path d="M4 20h16"/><path d="M12 4v11M8 11l4 4 4-4"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
};
function ic(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || '';
  return s;
}
let toastT = 0;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function setSave(s) { $('#saveState').textContent = s; }

/* ---------- history and saving ---------- */
function snapshot() { return JSON.stringify({ deck, cur }); }
function pushUndo(s) { undo.push(s || snapshot()); if (undo.length > 200) undo.shift(); redo = []; }
function change(fn, key, opts = {}) {
  const now = Date.now();
  if (!(key && key === lastKey && now - lastT < 1200)) pushUndo();
  lastKey = key || null; lastT = now;
  fn();
  afterChange(opts);
}
function afterChange(opts = {}) {
  cur = Math.max(0, Math.min(cur, deck.slides.length - 1));
  sel = sel.filter(id => elById(id));
  if (opts.canvas !== false) renderCanvas();
  renderThumbs();
  if (opts.panel !== false) renderPanel();
  syncChrome();
  markDirty();
  updateUndoBtns();
}
function restore(s) {
  const o = JSON.parse(s);
  deck = o.deck; cur = Math.min(o.cur, deck.slides.length - 1); lastKey = null;
  sel = sel.filter(id => elById(id));
  renderAll(); markDirty();
}
function doUndo() { endEdit(true); if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }
function updateUndoBtns() { $('#undoBtn').disabled = !undo.length; $('#redoBtn').disabled = !redo.length; }

function markDirty() {
  dirty = true; setSave('Unsaved changes');
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
}
async function save() {
  if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); return; }
  if (!dirty) return;
  saving = true; dirty = false; setSave('Saving…');
  try {
    const r = await fetch('api/deck', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck, baseRev: rev }) });
    if (r.status === 409) {
      adopt(await r.json());
      toast('This deck was changed somewhere else, so the newest version is loaded. Ctrl+Z brings back your edit.', 5000);
    } else if (!r.ok) throw new Error('HTTP ' + r.status);
    else { rev = (await r.json()).rev; saveFail = 0; }
    setSave(dirty ? 'Unsaved changes' : 'All changes saved');
  } catch (e) {
    dirty = true; saveFail++;
    setSave('Offline. Retrying…');
    clearTimeout(saveTimer); saveTimer = setTimeout(save, Math.min(15000, 1000 * 2 ** saveFail));
  } finally { saving = false; }
}
async function flush() {
  clearTimeout(saveTimer);
  for (let i = 0; i < 50 && (saving || dirty); i++) {
    if (!saving && dirty) await save(); else await new Promise(r => setTimeout(r, 100));
  }
}
function adopt(d) {
  rev = d.rev; deck = d.deck; lastKey = null;
  cur = Math.min(cur, deck.slides.length - 1);
  sel = sel.filter(id => elById(id));
  renderAll();
}
async function poll() {
  if (dirty || saving || interacting || editingId || document.hidden) return;
  try {
    const { rev: r } = await (await fetch('api/rev')).json();
    if (r > rev) {
      const d = await (await fetch('api/deck')).json();
      if (!dirty && !interacting && !editingId) { adopt(d); toast('Deck updated with the latest changes.'); }
    }
  } catch (e) { /* offline; try again next tick */ }
}

/* ---------- rendering ---------- */
function layout() {
  const st = $('#stage');
  const aw = st.clientWidth - 72, ah = st.clientHeight - 72;
  scale = zoom === 'fit' ? Math.max(0.1, Math.min(aw / W, ah / H)) : +zoom;
  const f = $('#frame');
  f.style.width = W * scale + 'px'; f.style.height = H * scale + 'px';
  const c = $('#canvas');
  c.style.transform = `scale(${scale})`;
  c.style.setProperty('--inv', String(1 / scale));
}
function renderCanvas() {
  const host = $('#slideHost');
  host.innerHTML = '';
  const s = K.renderSlide(slide(), deck.theme);
  for (const n of s.querySelectorAll('.el')) if (elById(n.dataset.id)?.locked) n.classList.add('locked');
  host.appendChild(s);
  renderOverlay();
}
function renderOverlay(guides, badge) {
  const ov = $('#overlay');
  ov.innerHTML = '';
  const els = selEls();
  for (const el of els) {
    const b = h('div', { class: 'selbox' + (el.locked ? ' locked' : '') + (el.id === editingId ? ' editing' : ''),
      style: { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px', transform: el.rot ? `rotate(${el.rot}deg)` : '' } });
    if (els.length === 1 && !el.locked && el.id !== editingId)
      for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) b.append(h('div', { class: 'handle', 'data-h': d }));
    ov.append(b);
  }
  for (const g of guides || []) ov.append(h('div', { class: 'guide ' + (g.v ? 'gv' : 'gh'), style: g.v ? { left: g.p + 'px' } : { top: g.p + 'px' } }));
  if (badge) ov.append(h('div', { class: 'size-badge', style: { left: badge.x + 'px', top: badge.y + 'px' } }, badge.t));
}
let thumbRaf = 0;
function renderThumbs() { cancelAnimationFrame(thumbRaf); thumbRaf = requestAnimationFrame(buildThumbs); }
function buildThumbs() {
  const box = $('#thumbs');
  const top = box.scrollTop;
  box.innerHTML = '';
  const tw = Math.max(96, box.clientWidth - 42), k = tw / W;
  deck.slides.forEach((s, i) => {
    const sc = h('div', { class: 'tscale', style: { transform: `scale(${k})` } }, K.renderSlide(s, deck.theme));
    const acts = h('div', { class: 'tactions' },
      h('button', { title: 'Duplicate slide', onclick: e => { e.stopPropagation(); dupSlide(i); } }, ic('copy')),
      h('button', { title: 'Delete slide', onclick: e => { e.stopPropagation(); delSlide(i); } }, ic('trash')));
    box.append(h('div', { class: 'thumb' + (i === cur ? ' on' : ''), draggable: 'true', 'data-i': i, onclick: () => goSlide(i) },
      h('span', { class: 'num' }, i + 1),
      h('div', { class: 'tframe', style: { width: tw + 'px', height: R(H * k) + 'px' } }, sc, acts)));
  });
  box.scrollTop = top;
  if (scrollThumb) { box.querySelector('.thumb.on')?.scrollIntoView({ block: 'nearest' }); scrollThumb = false; }
}
function syncChrome() {
  const t = $('#deckTitle'), n = $('#notes');
  if (document.activeElement !== t) t.value = deck.title || '';
  if (document.activeElement !== n) n.value = slide().notes || '';
}
function renderAll() { syncChrome(); layout(); renderCanvas(); buildThumbs(); renderPanel(); updateUndoBtns(); }

/* ---------- slides ---------- */
function goSlide(i) {
  i = Math.max(0, Math.min(deck.slides.length - 1, i));
  if (i === cur) return;
  endEdit(true);
  cur = i; sel = []; scrollThumb = true;
  syncChrome(); renderCanvas(); renderThumbs(); renderPanel();
}
function freshIds(s) { s.id = uid('s'); s.elements.forEach(e => { e.id = uid(); }); return s; }
function dupSlide(i) { change(() => { deck.slides.splice(i + 1, 0, freshIds(clone(deck.slides[i]))); cur = i + 1; sel = []; scrollThumb = true; }); }
function delSlide(i) {
  if (deck.slides.length < 2) return toast('A deck needs at least one slide.');
  change(() => { deck.slides.splice(i, 1); if (cur > i || cur === deck.slides.length) cur--; sel = []; });
  toast('Slide deleted. Ctrl+Z brings it back.');
}
function moveSlide(from, before) {
  let to = before > from ? before - 1 : before;
  if (to === from) return;
  change(() => { const [s] = deck.slides.splice(from, 1); deck.slides.splice(to, 0, s); cur = to; });
}
function makeLayout(kind) {
  const T = o => Object.assign({ type: 'text', name: 'Text', x: 96, y: 124, w: 1000, h: 80, text: '', font: 'body', size: 24, weight: 400, italic: false,
    color: 'text', align: 'left', valign: 'top', lineHeight: 1.3, letterSpacing: 0, opacity: 1, rot: 0 }, o);
  const S = o => Object.assign({ type: 'shape', name: 'Card', shape: 'rect', x: 0, y: 0, w: 100, h: 100, fill: 'surface', stroke: 'none', strokeWidth: 0, radius: 20, opacity: 1, rot: 0 }, o);
  const label = t => T({ name: 'Section label', y: 92, w: 700, h: 20, text: t, size: 14, weight: 700, color: 'accent', letterSpacing: 2.4 });
  const head = (t, h = 140) => T({ name: 'Heading', text: t, font: 'heading', size: 56, weight: 600, lineHeight: 1.1, h });
  if (kind === 'content') return { bg: 'bg', elements: [label('SECTION'), head('Slide heading'),
    T({ name: 'Body', y: 300, w: 820, h: 220, text: 'Body text. Keep each slide to one idea.', size: 22, color: 'muted', lineHeight: 1.55 })] };
  if (kind === 'two') {
    const e = [label('SECTION'), head('Compare two things', 80)];
    for (const i of [0, 1]) {
      const x = 96 + i * 560;
      e.push(S({ x, y: 260, w: 528, h: 340 }),
        T({ name: 'Card title', x: x + 36, y: 296, w: 456, h: 34, text: i ? 'Option B' : 'Option A', size: 26, weight: 700 }),
        T({ name: 'Card body', x: x + 36, y: 344, w: 456, h: 220, text: 'A short supporting point.', size: 18, color: 'muted', lineHeight: 1.55 }));
    }
    return { bg: 'bg', elements: e };
  }
  if (kind === 'title') return { bg: 'bg', elements: [
    T({ name: 'Title', y: 250, h: 150, text: 'Title', font: 'heading', size: 110, weight: 600, lineHeight: 1, letterSpacing: -2 }),
    T({ name: 'Subtitle', y: 420, w: 800, h: 50, text: 'Subtitle', size: 32, weight: 600, color: 'accent' })] };
  if (kind === 'section') return { bg: 'accent', elements: [
    T({ name: 'Label', y: 250, h: 24, text: 'PART TWO', size: 16, weight: 700, letterSpacing: 2.4, color: 'onAccent', opacity: 0.75 }),
    T({ name: 'Section title', y: 290, h: 180, text: 'Section title', font: 'heading', size: 88, weight: 600, lineHeight: 1.05, color: 'onAccent' })] };
  return { bg: 'bg', elements: [] };
}
function addSlide(kind, at = cur + 1) {
  endEdit(true);
  const s = freshIds(Object.assign({ notes: '' }, makeLayout(kind)));
  at = Math.max(0, Math.min(deck.slides.length, at));
  change(() => { deck.slides.splice(at, 0, s); cur = at; sel = []; scrollThumb = true; });
}

/* ---------- right-click menu on the slide rail ---------- */
const LAYOUTS = [['content', 'Heading and text'], ['two', 'Two columns'], ['title', 'Title'], ['section', 'Section break'], ['blank', 'Blank']];
function openCtx(x, y, groups) {
  const m = $('#ctxMenu');
  m.innerHTML = '';
  groups.forEach((g, gi) => {
    if (gi) m.append(h('div', { class: 'ctx-sep' }));
    if (g.label) m.append(h('div', { class: 'ctx-h' }, g.label));
    for (const it of g.items)
      m.append(h('button', { class: it.danger ? 'danger' : null, disabled: !!it.disabled, role: 'menuitem', onclick: () => { closeCtx(); it.run(); } }, it.text));
  });
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function closeCtx() { const m = $('#ctxMenu'); if (m && !m.hidden) m.hidden = true; }
function railMenu(e) {
  e.preventDefault();
  closeMenus();
  const t = e.target.closest('.thumb');
  const n = deck.slides.length;
  const i = t ? +t.dataset.i : n - 1;
  const news = LAYOUTS.map(([k, l]) => ({ text: l, run: () => addSlide(k, i + 1) }));
  if (!t) return openCtx(e.clientX, e.clientY, [{ label: 'New slide at the end', items: news }]);
  if (i !== cur) goSlide(i);
  openCtx(e.clientX, e.clientY, [{ label: `New slide after slide ${i + 1}`, items: news }, { items: [
    { text: 'Duplicate slide', run: () => dupSlide(i) },
    { text: 'Move up', disabled: i === 0, run: () => moveSlide(i, i - 1) },
    { text: 'Move down', disabled: i === n - 1, run: () => moveSlide(i, i + 2) },
    { text: 'Delete slide', danger: true, disabled: n < 2, run: () => delSlide(i) }] }]);
}

/* ---------- elements ---------- */
function addEl(el, edit) {
  el.id = uid();
  sel = [el.id];
  if (tab === 'design') tab = 'format', syncTabs();
  change(() => slide().elements.push(el));
  if (edit) startEdit(el.id);
}
function textEl(o) {
  return Object.assign({ type: 'text', name: 'Text', x: 340, y: 320, w: 600, h: 80, text: 'Double-click to edit', font: 'body', size: 32, weight: 500,
    italic: false, color: 'text', align: 'left', valign: 'top', lineHeight: 1.3, letterSpacing: 0, opacity: 1, rot: 0 }, o);
}
function addShape(kind) {
  const base = { type: 'shape', shape: 'rect', fill: 'accent', stroke: 'none', strokeWidth: 0, radius: 0, opacity: 1, rot: 0 };
  const m = {
    rect: { name: 'Rectangle', x: 490, y: 260, w: 300, h: 200 },
    rounded: { name: 'Rounded rectangle', x: 490, y: 260, w: 300, h: 200, radius: 20 },
    ellipse: { name: 'Ellipse', shape: 'ellipse', x: 530, y: 250, w: 220, h: 220 },
    pill: { name: 'Pill', shape: 'pill', x: 510, y: 332, w: 260, h: 56 },
    line: { name: 'Line', x: 440, y: 358, w: 400, h: 3, fill: 'text' },
  };
  addEl(Object.assign({}, base, m[kind] || m.rect));
}
async function upload(file) {
  const r = await fetch('api/upload', { method: 'POST', body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'image') } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j.src;
}
function imgSize(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth || 400, h: i.naturalHeight || 300 }); i.onerror = () => res({ w: 400, h: 300 }); i.src = src; });
}
async function addImageFile(file, at) {
  if (!file || !/^image\//.test(file.type)) return toast('Only images can go on a slide.');
  toast('Uploading image…', 8000);
  let src;
  try { src = await upload(file); } catch (e) { return toast('Upload failed: ' + e.message); }
  const { w: nw, h: nh } = await imgSize(src);
  const k = Math.min(1, 640 / nw, 420 / nh), w = R(nw * k), hh = R(nh * k);
  const c = at || { x: W / 2, y: H / 2 };
  addEl({ type: 'image', name: (file.name || 'Image').replace(/\.[^.]+$/, '').slice(0, 28) || 'Image', src,
    x: R(c.x - w / 2), y: R(c.y - hh / 2), w, h: hh, fit: 'cover', radius: 0, opacity: 1, rot: 0 });
  toast('Image added.');
}
async function replaceImage(file) {
  const el = selEls()[0];
  if (!el || el.type !== 'image') return;
  toast('Uploading image…', 8000);
  try { const src = await upload(file); change(() => { el.src = src; }); toast('Image replaced.'); }
  catch (e) { toast('Upload failed: ' + e.message); }
}
function pasteEls(els, offset = 20) {
  const ids = [];
  change(() => {
    for (const e of els) { const c = clone(e); c.id = uid(); c.x += offset; c.y += offset; c.locked = false; slide().elements.push(c); ids.push(c.id); }
    sel = ids;
  });
}
function duplicateSel() { if (sel.length) pasteEls(selEls()); }
function deleteSel() {
  const ids = selEls().filter(e => !e.locked).map(e => e.id);
  if (!ids.length) return toast('Locked layers cannot be deleted. Unlock them first.');
  change(() => { slide().elements = slide().elements.filter(e => !ids.includes(e.id)); sel = []; });
}
function bbox(els) {
  const x = Math.min(...els.map(e => e.x)), y = Math.min(...els.map(e => e.y));
  return { x, y, w: Math.max(...els.map(e => e.x + e.w)) - x, h: Math.max(...els.map(e => e.y + e.h)) - y };
}
function alignSel(mode) {
  const els = selEls().filter(e => !e.locked);
  if (!els.length) return;
  const b = els.length === 1 ? { x: 0, y: 0, w: W, h: H } : bbox(els);
  change(() => els.forEach(e => {
    if (mode === 'aL') e.x = b.x; if (mode === 'aC') e.x = R(b.x + (b.w - e.w) / 2); if (mode === 'aR') e.x = b.x + b.w - e.w;
    if (mode === 'aT') e.y = b.y; if (mode === 'aM') e.y = R(b.y + (b.h - e.h) / 2); if (mode === 'aB') e.y = b.y + b.h - e.h;
  }));
}
function distribute(axis) {
  const els = selEls().filter(e => !e.locked);
  if (els.length < 3) return;
  const p = axis === 'x' ? 'x' : 'y', d = axis === 'x' ? 'w' : 'h';
  els.sort((a, b) => a[p] - b[p]);
  const first = els[0][p], end = Math.max(...els.map(e => e[p] + e[d]));
  const gap = (end - first - els.reduce((s, e) => s + e[d], 0)) / (els.length - 1);
  change(() => { let at = first; for (const e of els) { e[p] = R(at); at += e[d] + gap; } });
}
function zorder(mode) {
  const arr = slide().elements, ids = new Set(sel);
  change(() => {
    if (mode === 'front' || mode === 'back') {
      const picked = arr.filter(e => ids.has(e.id)), rest = arr.filter(e => !ids.has(e.id));
      slide().elements = mode === 'front' ? rest.concat(picked) : picked.concat(rest);
    } else if (mode === 'fwd') {
      for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    } else {
      for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  });
}

/* ---------- pointer interactions on the canvas ---------- */
function pt(e) { const r = $('#canvas').getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; }
function drag(e, move, up) {
  interacting = true; e.preventDefault();
  const mv = ev => move(ev);
  const end = ev => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    interacting = false; document.body.classList.remove('dragging'); up(ev);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}
function place(el) {
  const n = $('#slideHost').querySelector(`.el[data-id="${el.id}"]`);
  if (n) Object.assign(n.style, { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px' });
}
function snapLines(excl) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const o of slide().elements) if (!excl.includes(o.id) && !o.hidden) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  return { xs, ys };
}
function nearest(vals, cands) {
  const th = 6 / scale;
  let m = null;
  for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= th && (!m || Math.abs(d) < Math.abs(m.d))) m = { d, p: c }; }
  return m;
}
function startMove(e) {
  const els = selEls().filter(el => !el.locked);
  if (!els.length) return;
  const p0 = pt(e), before = snapshot(), orig = els.map(el => ({ el, x: el.x, y: el.y })), bb = bbox(els), lines = snapLines(sel);
  let moved = false;
  drag(e, ev => {
    const p = pt(ev);
    let dx = p.x - p0.x, dy = p.y - p0.y;
    if (!moved && Math.hypot(dx, dy) * scale < 3) return;
    moved = true; document.body.classList.add('dragging');
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const guides = [];
    if (!ev.altKey) {
      const mx = nearest([bb.x + dx, bb.x + dx + bb.w / 2, bb.x + dx + bb.w], lines.xs);
      if (mx) { dx += mx.d; guides.push({ v: 1, p: mx.p }); }
      const my = nearest([bb.y + dy, bb.y + dy + bb.h / 2, bb.y + dy + bb.h], lines.ys);
      if (my) { dy += my.d; guides.push({ v: 0, p: my.p }); }
    }
    for (const o of orig) { o.el.x = R(o.x + dx); o.el.y = R(o.y + dy); place(o.el); }
    renderOverlay(guides);
  }, () => {
    if (moved) { pushUndo(before); lastKey = null; afterChange(); } else renderOverlay();
  });
}
function startResize(e, hd) {
  const el = selEls()[0];
  if (!el || el.locked) return;
  const p0 = pt(e), before = snapshot(), o = { x: el.x, y: el.y, w: el.w, h: el.h }, ratio = o.w / o.h, lines = snapLines([el.id]);
  const hx = hd.includes('w') || hd.includes('e'), hy = hd.includes('n') || hd.includes('s');
  let moved = false;
  drag(e, ev => {
    moved = true; document.body.classList.add('dragging');
    const p = pt(ev), dx = p.x - p0.x, dy = p.y - p0.y, guides = [];
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (hd.includes('w')) x1 += dx; if (hd.includes('e')) x2 += dx;
    if (hd.includes('n')) y1 += dy; if (hd.includes('s')) y2 += dy;
    const keep = (ev.shiftKey || el.type === 'image') && hx && hy;
    if (!ev.altKey && !keep) {
      const snapOne = (v, c, vert) => { const m = nearest([v], c); if (m) guides.push({ v: vert, p: m.p }); return m ? m.p : v; };
      if (hd.includes('w')) x1 = snapOne(x1, lines.xs, 1); if (hd.includes('e')) x2 = snapOne(x2, lines.xs, 1);
      if (hd.includes('n')) y1 = snapOne(y1, lines.ys, 0); if (hd.includes('s')) y2 = snapOne(y2, lines.ys, 0);
    }
    let w = hx ? Math.max(8, x2 - x1) : o.w, hh = hy ? Math.max(8, y2 - y1) : o.h;
    if (keep) { if (w / hh > ratio) w = hh * ratio; else hh = w / ratio; }
    el.w = R(w); el.h = R(hh);
    el.x = R(hd.includes('w') ? o.x + o.w - w : o.x);
    el.y = R(hd.includes('n') ? o.y + o.h - hh : o.y);
    place(el);
    renderOverlay(guides, { x: el.x + el.w / 2, y: el.y + el.h + 10 / scale, t: `${el.w} × ${el.h}` });
  }, () => {
    if (moved) { pushUndo(before); lastKey = null; afterChange(); } else renderOverlay();
  });
}
function startMarquee(e) {
  const p0 = pt(e), base = e.shiftKey ? [...sel] : [];
  if (!e.shiftKey && sel.length) { sel = []; renderOverlay(); renderPanel(); }
  let moved = false;
  drag(e, ev => {
    const p = pt(ev), x = Math.min(p.x, p0.x), y = Math.min(p.y, p0.y), w = Math.abs(p.x - p0.x), hh = Math.abs(p.y - p0.y);
    if (!moved && (w + hh) * scale < 4) return;
    moved = true;
    const hit = slide().elements.filter(el => !el.locked && !el.hidden && el.x >= x && el.y >= y && el.x + el.w <= x + w && el.y + el.h <= y + hh).map(el => el.id);
    sel = [...new Set([...base, ...hit])];
    renderOverlay();
    $('#overlay').append(h('div', { class: 'marquee', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } }));
  }, () => { renderOverlay(); if (moved) selChanged(); });
}
function selChanged() {
  if (sel.length && tab === 'design') { tab = 'format'; syncTabs(); }
  renderOverlay(); renderPanel();
}

/* ---------- inline text editing ---------- */
function startEdit(id) {
  const el = elById(id);
  if (!el || el.type !== 'text' || el.locked) return;
  sel = [id]; editingId = id;
  renderOverlay(); renderPanel();
  const t = $('#slideHost').querySelector(`.el[data-id="${id}"] .txt`);
  if (!t) { editingId = null; return; }
  t.contentEditable = 'plaintext-only';
  if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  t.addEventListener('blur', () => endEdit(true), { once: true });
  t.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); t.blur(); }
  });
}
function endEdit(commit) {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  const t = $('#slideHost').querySelector(`.el[data-id="${id}"] .txt`), el = elById(id);
  const text = t ? t.innerText.replace(/\n$/, '') : null;
  if (t) t.contentEditable = 'false';
  getSelection().removeAllRanges();
  if (commit && el && text != null && text !== el.text) change(() => { el.text = text; });
  else { renderOverlay(); renderPanel(); }
}

/* ---------- side panel ---------- */
function syncTabs() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + tab));
}
function renderPanel() {
  if (tab === 'design') renderDesign();
  else if (tab === 'format') renderFormat();
  else renderLayers();
}
function sec(title, ...kids) { return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, title), ...kids); }
function fld(label, input) { return h('label', { class: 'fld' }, h('span', {}, label), input); }
function apply(fn, key, live) { change(() => selEls().forEach(fn), key, { panel: !live }); }
function numIn(label, val, set, o = {}) {
  const i = h('input', { type: 'number', step: o.step || 1, min: o.min, max: o.max, value: String(val ?? '') });
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) apply(e => set(e, v), 'n:' + label + sel.join(), true); });
  return fld(label, i);
}
function seg(opts, value, onPick) {
  return h('div', { class: 'seg' }, opts.map(([v, icon, title]) =>
    h('button', { class: v === value ? 'on' : '', title, onclick: () => onPick(v) }, ICONS[icon] ? ic(icon) : icon)));
}
function colorPicker(value, onPick, none) {
  const wrap = h('div', { class: 'cpick' });
  if (none) wrap.append(h('button', { class: 'sw none' + (!value || value === 'none' ? ' on' : ''), title: 'None', onclick: () => onPick('none') }));
  for (const t of ['text', 'muted', 'accent', 'accent2', 'highlight', 'onAccent', 'surface', 'subtle', 'bg'])
    wrap.append(h('button', { class: 'sw' + (value === t ? ' on' : ''), title: K.TOKEN_LABELS[t] + ' (theme colour)', style: { background: deck.theme[t] }, onclick: () => onPick(t) }));
  const isHex = typeof value === 'string' && value[0] === '#';
  const inp = h('input', { type: 'color', value: K.toHex(isHex ? value : K.color(deck.theme, value)) });
  inp.addEventListener('input', () => onPick(inp.value, true));
  wrap.append(h('label', { class: 'sw custom' + (isHex ? ' on' : ''), title: 'Custom colour' + (isHex ? ' ' + value : '') }, inp));
  return wrap;
}
const TYPE_LABEL = el => el.type === 'text' ? 'Text' : el.type === 'image' ? 'Image' : ({ ellipse: 'Ellipse', pill: 'Pill' }[el.shape] || 'Shape');
const GLYPH = el => el.type === 'text' ? 'T' : el.type === 'image' ? '▣' : ({ ellipse: '●', pill: '▬' }[el.shape] || '■');
const KEYS = [['Double-click', 'Edit text'], ['Shift + click', 'Add to selection'], ['Drag on empty space', 'Select an area'],
  ['Arrows', 'Nudge 1 px (Shift: 10 px)'], ['Alt + drag', 'Move without snapping'], ['Shift + corner', 'Keep proportions'],
  ['Ctrl + D', 'Duplicate'], ['Ctrl + C / V', 'Copy and paste, images too'], ['Delete', 'Remove layer'],
  ['Ctrl + Z', 'Undo (add Shift to redo)'], ['↑ ↓', 'Change slide when nothing is selected'], ['Ctrl + Enter', 'Present']];

function renderFormat() {
  const box = $('#tab-format');
  box.innerHTML = '';
  const els = selEls();
  if (!els.length) {
    box.append(sec('Nothing selected', h('p', { class: 'hint' }, 'Click a layer on the slide to change it. Shift-click or drag across empty space to select several. Double-click any text to type.')),
      sec('Shortcuts', h('div', { class: 'keys' }, KEYS.map(([k, v]) => [h('kbd', {}, k), h('span', {}, v)]))));
    return;
  }
  const one = els.length === 1 ? els[0] : null;
  const f = els[0];
  const locked = els.some(e => e.locked);

  // Arrange
  const arrange = sec([one ? one.name || TYPE_LABEL(one) : `${els.length} layers selected`, h('span', { class: 'badge' }, one ? TYPE_LABEL(one) : 'Group')]);
  if (locked) arrange.append(h('p', { class: 'hint' }, 'Locked layers stay put on the canvas. Unlock to move or delete them.'));
  if (one) arrange.append(h('div', { class: 'grid2' },
    numIn('X', one.x, (e, v) => { e.x = R(v); }), numIn('Y', one.y, (e, v) => { e.y = R(v); }),
    numIn('Width', one.w, (e, v) => { e.w = Math.max(1, R(v)); }, { min: 1 }), numIn('Height', one.h, (e, v) => { e.h = Math.max(1, R(v)); }, { min: 1 })));
  arrange.append(h('div', { class: 'grid2', style: { marginTop: '8px' } },
    one ? numIn('Rotation °', one.rot || 0, (e, v) => { e.rot = v; }, { step: 1 }) : null,
    numIn('Opacity %', R((f.opacity ?? 1) * 100), (e, v) => { e.opacity = Math.max(0, Math.min(1, v / 100)); }, { min: 0, max: 100, step: 5 })));
  const alignTitle = one ? 'Align to slide' : 'Align to each other';
  arrange.append(h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Align'),
    ...['aL', 'aC', 'aR', 'aT', 'aM', 'aB'].map(m => h('button', { class: 'ib', title: alignTitle, onclick: () => alignSel(m) }, ic(m))),
    els.length >= 3 ? [h('button', { class: 'ib', title: 'Space evenly across', onclick: () => distribute('x') }, ic('dH')),
      h('button', { class: 'ib', title: 'Space evenly down', onclick: () => distribute('y') }, ic('dV'))] : null));
  arrange.append(h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Order'),
    h('button', { class: 'ib', title: 'Bring to front', onclick: () => zorder('front') }, ic('front')),
    h('button', { class: 'ib', title: 'Bring forward', onclick: () => zorder('fwd') }, ic('fwd')),
    h('button', { class: 'ib', title: 'Send backward', onclick: () => zorder('bwd') }, ic('bwd')),
    h('button', { class: 'ib', title: 'Send to back', onclick: () => zorder('back') }, ic('back'))));
  arrange.append(h('div', { class: 'row' },
    h('button', { class: 'sbtn', onclick: duplicateSel }, ic('copy'), 'Duplicate'),
    h('button', { class: 'sbtn', onclick: () => { const v = !locked; change(() => els.forEach(e => { e.locked = v; })); } }, ic(locked ? 'unlock' : 'lock'), locked ? 'Unlock' : 'Lock'),
    h('button', { class: 'sbtn danger', onclick: deleteSel }, ic('trash'), 'Delete')));
  box.append(arrange);

  // Text
  if (els.every(e => e.type === 'text')) {
    const s = sec('Text');
    if (one) {
      const ta = h('textarea', { rows: Math.min(8, Math.max(2, (one.text || '').split('\n').length + 1)), value: one.text || '' });
      ta.addEventListener('input', () => apply(e => { e.text = ta.value; }, 'txt' + one.id, true));
      s.append(fld('Content', ta));
    }
    const fontSel = h('select', {},
      h('optgroup', { label: 'Theme fonts' }, h('option', { value: 'heading' }, `Heading · ${deck.theme.headingFont}`),
        h('option', { value: 'body' }, `Body · ${deck.theme.bodyFont}`), h('option', { value: 'mono' }, `Code · ${deck.theme.monoFont}`)),
      h('optgroup', { label: 'Any font' }, K.FONT_NAMES.map(n => h('option', { value: n }, n))));
    fontSel.value = f.font || 'body';
    fontSel.addEventListener('change', () => apply(e => { e.font = fontSel.value; }));
    const wSel = h('select', {}, [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold']].map(([v, n]) => h('option', { value: String(v) }, n)));
    wSel.value = String(f.weight || 400);
    wSel.addEventListener('change', () => apply(e => { e.weight = +wSel.value; }));
    s.append(h('div', { style: { marginTop: '8px' } }, fld('Font', fontSel)));
    s.append(h('div', { class: 'grid2', style: { marginTop: '8px' } },
      numIn('Size px', f.size || 24, (e, v) => { e.size = Math.max(4, v); }, { min: 4 }), fld('Weight', wSel),
      numIn('Line height', f.lineHeight || 1.3, (e, v) => { e.lineHeight = Math.max(0.5, v); }, { step: 0.05, min: 0.5 }),
      numIn('Spacing px', f.letterSpacing || 0, (e, v) => { e.letterSpacing = v; }, { step: 0.1 })));
    s.append(h('div', { class: 'row' },
      h('button', { class: 'ib' + (f.italic ? ' act' : ''), title: 'Italic', onclick: () => apply(e => { e.italic = !f.italic; }) }, ic('italic')),
      seg([['left', 'tl', 'Align left'], ['center', 'tc', 'Centre'], ['right', 'tr', 'Align right']], f.align || 'left', v => apply(e => { e.align = v; })),
      seg([['top', 'vt', 'Top'], ['middle', 'vm', 'Middle'], ['bottom', 'vb', 'Bottom']], f.valign || 'top', v => apply(e => { e.valign = v; }))));
    s.append(h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Colour')),
      h('div', { style: { marginTop: '6px' } }, colorPicker(f.color || 'text', (v, live) => apply(e => { e.color = v; }, 'tc' + sel.join(), live))));
    box.append(s);
  }

  // Shape
  if (els.every(e => e.type === 'shape')) {
    const s = sec('Shape');
    const kind = h('select', {}, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['pill', 'Pill']].map(([v, n]) => h('option', { value: v }, n)));
    kind.value = f.shape || 'rect';
    kind.addEventListener('change', () => apply(e => { e.shape = kind.value; }));
    s.append(h('div', { class: 'grid2' }, fld('Kind', kind),
      (f.shape || 'rect') === 'rect' ? numIn('Corner radius', f.radius || 0, (e, v) => { e.radius = Math.max(0, v); }, { min: 0 }) : null));
    s.append(h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Fill')),
      h('div', { style: { marginTop: '6px' } }, colorPicker(f.fill, (v, live) => apply(e => { e.fill = v; }, 'fill' + sel.join(), live), true)));
    s.append(h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Border')),
      h('div', { style: { marginTop: '6px' } }, colorPicker(f.stroke, (v, live) => apply(e => { e.stroke = v; if (v !== 'none' && !e.strokeWidth) e.strokeWidth = 2; }, 'stroke' + sel.join(), live), true)));
    s.append(h('div', { class: 'grid2', style: { marginTop: '8px' } }, numIn('Border width', f.strokeWidth || 0, (e, v) => { e.strokeWidth = Math.max(0, v); }, { min: 0, step: 0.5 })));
    box.append(s);
  }

  // Image
  if (one && one.type === 'image') {
    box.append(sec('Image',
      h('div', { class: 'row tight' },
        h('button', { class: 'sbtn', onclick: () => { fileMode = 'replace'; $('#fileInput').click(); } }, ic('image'), 'Replace image'),
        seg([['cover', 'Fill', 'Fill the box (crops)'], ['contain', 'Fit', 'Fit inside the box']], one.fit || 'cover', v => apply(e => { e.fit = v; }))),
      h('div', { class: 'grid2', style: { marginTop: '8px' } }, numIn('Corner radius', one.radius || 0, (e, v) => { e.radius = Math.max(0, v); }, { min: 0 }))));
  }
}

/* ---------- saved themes (shared, stored on the server in data/themes.json) ---------- */
let userThemes = [];
const THEME_FIELDS = () => [...K.TOKENS, 'headingFont', 'bodyFont', 'monoFont'];
async function loadThemes() {
  try { userThemes = (await (await fetch('api/themes')).json()).themes || []; } catch (e) { userThemes = []; }
}
async function storeThemes(list) {
  const r = await fetch('api/themes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themes: list }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  userThemes = d.themes;
}
function presetCard(p, custom) {
  const b = h('button', { class: 'preset' + (deck.theme.name === p.name ? ' on' : ''), title: `${p.headingFont} + ${p.bodyFont}`,
    onclick: () => change(() => { deck.theme = Object.assign({}, p); }) },
    h('div', { class: 'pv', style: { background: p.bg } }, h('i', { style: { background: p.accent } }), h('i', { style: { background: p.accent2 } }),
      h('i', { style: { background: p.highlight } }), h('b', { style: { color: p.text, fontFamily: K.family(p, 'heading') } }, 'Aa')),
    h('span', { class: 'pl' }, p.label));
  if (!custom) return b;
  const del = h('button', { class: 'pdel', title: `Delete "${p.label}"`, onclick: e => {
    e.stopPropagation();
    if (!del.classList.contains('arm')) {
      del.classList.add('arm'); del.textContent = 'Delete?';
      return setTimeout(() => { del.classList.remove('arm'); del.textContent = '×'; }, 3000);
    }
    delTheme(p);
  } }, '×');
  return h('div', { class: 'preset-wrap' }, b, del);
}
async function addTheme(label) {
  label = (label || '').trim();
  if (!label) return toast('Give the theme a name first.');
  const same = userThemes.find(t => t.label.toLowerCase() === label.toLowerCase());
  const t = { name: same ? same.name : 'u-' + Math.random().toString(36).slice(2, 9), label };
  for (const k of THEME_FIELDS()) t[k] = deck.theme[k];
  try { await storeThemes(userThemes.filter(x => x !== same).concat([t])); }
  catch (e) { return toast('Could not save the theme: ' + e.message, 5000); }
  change(() => { deck.theme = Object.assign({}, t); });
  toast(same ? `Updated the "${label}" theme.` : `Saved "${label}" as a theme.`);
}
async function delTheme(p) {
  try { await storeThemes(userThemes.filter(x => x.name !== p.name)); }
  catch (e) { return toast('Could not delete the theme: ' + e.message, 5000); }
  renderPanel();
  toast(`Deleted the "${p.label}" theme. Slides using it keep their colours.`);
}

function renderDesign() {
  const box = $('#tab-design');
  box.innerHTML = '';
  const th = deck.theme;
  const presets = h('div', { class: 'presets' }, K.PRESETS.map(p => presetCard(p, false)), userThemes.map(p => presetCard(p, true)));
  const nm = h('input', { class: 'tname', placeholder: 'Theme name', maxlength: 40, spellcheck: 'false',
    onkeydown: e => { if (e.key === 'Enter') addTheme(nm.value); } });
  box.append(sec('Theme', h('p', { class: 'hint' }, 'Every slide draws its colours and fonts from the theme. Change it here and the whole deck follows.'), presets,
    h('p', { class: 'hint', style: { marginTop: '12px' } }, 'To add a theme, set the colours and fonts below, then save them under a name. Saved themes show up for everyone using this editor.'),
    h('div', { class: 'row tight' }, nm, h('button', { class: 'sbtn', onclick: () => addTheme(nm.value) }, 'Save as theme'))));

  const tokens = h('div', { class: 'tokens' });
  for (const t of K.TOKENS) {
    const sw = h('label', { class: 'tsw', style: { background: th[t] } });
    const pick = h('input', { type: 'color', value: K.toHex(th[t]) });
    const hex = h('input', { class: 'hex', value: th[t] || '', spellcheck: 'false' });
    const set = v => change(() => { deck.theme[t] = v; deck.theme.name = 'custom'; deck.theme.label = 'Custom'; }, 'tok' + t, { panel: false });
    pick.addEventListener('input', () => { sw.style.background = pick.value; hex.value = pick.value; set(pick.value); });
    hex.addEventListener('change', () => {
      let v = hex.value.trim(); if (v[0] !== '#') v = '#' + v;
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { hex.value = th[t]; return toast('Use a hex colour such as #0F766E.'); }
      sw.style.background = v; pick.value = K.toHex(v); set(v.toUpperCase());
    });
    sw.append(pick);
    tokens.append(h('div', { class: 'token' }, sw, h('span', {}, K.TOKEN_LABELS[t]), hex));
  }
  box.append(sec('Colours', tokens));

  const fontSel = key => {
    const s = h('select', {}, K.FONT_NAMES.map(n => h('option', { value: n }, n)));
    s.value = th[key];
    s.addEventListener('change', () => change(() => { deck.theme[key] = s.value; deck.theme.name = 'custom'; deck.theme.label = 'Custom'; }));
    return s;
  };
  box.append(sec('Fonts', h('div', { class: 'grid2' }, fld('Headings', fontSel('headingFont')), fld('Body', fontSel('bodyFont'))),
    h('div', { class: 'grid2', style: { marginTop: '8px' } }, fld('Code', fontSel('monoFont')))));

  box.append(sec(`Slide ${cur + 1} background`,
    colorPicker(slide().bg || 'bg', (v, live) => change(() => { slide().bg = v; }, 'bg' + cur, { panel: !live })),
    h('div', { class: 'row' }, h('button', { class: 'sbtn', onclick: () => { const v = slide().bg || 'bg'; change(() => deck.slides.forEach(s => { s.bg = v; })); toast('Background applied to every slide.'); } }, 'Apply to all slides'))));

  box.append(sec('Deck', h('p', { class: 'hint' }, `${deck.slides.length} slides · 1280 × 720 (16:9). Export from the top bar to finish in PowerPoint, Google Slides or Keynote.`),
    h('div', { class: 'row tight' }, h('button', { class: 'sbtn danger', onclick: resetDeck }, 'Reset to original deck'))));
}
async function resetDeck() {
  if (!confirm('Replace this deck with the original deck? You can undo this.')) return;
  const seed = await (await fetch('api/seed')).json();
  change(() => { deck = seed; cur = 0; sel = []; });
  toast('Original deck restored. Ctrl+Z undoes it.');
}

function renderLayers() {
  const box = $('#tab-layers');
  box.innerHTML = '';
  const list = h('div', { class: 'layers' });
  const arr = slide().elements;
  [...arr].reverse().forEach(el => {
    const name = h('span', { class: 'ln', title: el.name || TYPE_LABEL(el) }, el.name || TYPE_LABEL(el));
    const row = h('div', { class: 'layer' + (sel.includes(el.id) ? ' on' : '') + (el.hidden ? ' off' : ''), draggable: 'true', 'data-id': el.id },
      h('span', { class: 'lt' }, GLYPH(el)), name,
      h('button', { class: 'ib' + (el.hidden ? ' act' : ''), title: el.hidden ? 'Show' : 'Hide', onclick: ev => { ev.stopPropagation(); change(() => { el.hidden = !el.hidden; }); } }, ic(el.hidden ? 'eyeoff' : 'eye')),
      h('button', { class: 'ib' + (el.locked ? ' act' : ''), title: el.locked ? 'Unlock' : 'Lock', onclick: ev => { ev.stopPropagation(); change(() => { el.locked = !el.locked; }); } }, ic(el.locked ? 'lock' : 'unlock')));
    row.addEventListener('click', ev => {
      endEdit(true);
      sel = ev.shiftKey || ev.metaKey || ev.ctrlKey ? (sel.includes(el.id) ? sel.filter(x => x !== el.id) : [...sel, el.id]) : [el.id];
      renderOverlay(); renderLayers();
    });
    name.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      const inp = h('input', { value: el.name || '' });
      name.replaceChildren(inp); inp.focus(); inp.select();
      const done = ok => { const v = inp.value.trim(); if (ok && v && v !== el.name) change(() => { el.name = v.slice(0, 60); }); else renderLayers(); };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = el.name || ''; inp.blur(); } });
      inp.addEventListener('blur', () => done(true), { once: true });
    });
    list.append(row);
  });
  if (!arr.length) list.append(h('p', { class: 'hint' }, 'This slide is empty. Add text, a shape or an image from the top bar.'));
  box.append(sec([`Layers on slide ${cur + 1}`, h('span', { class: 'badge' }, arr.length)],
    h('p', { class: 'hint' }, 'The top of the list sits in front. Drag rows to restack. Double-click a name to rename. Locked layers can be picked here.'), list));
}

/* ---------- present mode ---------- */
let pIdx = 0, pFull = false, pWake = 0;
function present(i) {
  endEdit(true);
  closeMenus();
  pIdx = i;
  const P = $('#present');
  P.hidden = false;
  wake(); renderP();
  if (P.requestFullscreen) P.requestFullscreen().then(() => { pFull = true; }).catch(() => {});
}
function closeP() {
  if ($('#present').hidden) return;
  $('#present').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  pFull = false;
  goSlide(pIdx);
}
function renderP() {
  const st = $('#pStage');
  st.innerHTML = '';
  const k = Math.min(innerWidth / W, innerHeight / H);
  const s = K.renderSlide(deck.slides[pIdx], deck.theme);
  s.style.transform = `scale(${k})`; s.style.transformOrigin = '0 0';
  st.append(h('div', { class: 'pbox', style: { width: W * k + 'px', height: H * k + 'px' } }, s));
  $('#pCount').textContent = `${pIdx + 1} / ${deck.slides.length}`;
  $('#pNotes').textContent = deck.slides[pIdx].notes || 'No notes for this slide.';
}
function pGo(d) { const n = Math.max(0, Math.min(deck.slides.length - 1, pIdx + d)); if (n !== pIdx) { pIdx = n; renderP(); } }
function wake() { const P = $('#present'); P.classList.add('awake'); clearTimeout(pWake); pWake = setTimeout(() => P.classList.remove('awake'), 2200); }
function presentKey(e) {
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); pGo(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); pGo(-1); }
  else if (k === 'Home') { e.preventDefault(); pIdx = 0; renderP(); }
  else if (k === 'End') { e.preventDefault(); pIdx = deck.slides.length - 1; renderP(); }
  else if (k === 'n' || k === 'N') { $('#pNotes').hidden = !$('#pNotes').hidden; }
  else if (k === 'Escape') { e.preventDefault(); closeP(); }
}

/* ---------- export ---------- */
async function doExport(kind) {
  closeMenus();
  await flush();
  toast(kind === 'pdf' ? 'Building the PDF. This takes a few seconds…' : 'Preparing the download…', 20000);
  try {
    const r = await fetch('api/export/' + kind);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const blob = await r.blob();
    const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'deck.' + kind;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Downloaded ' + name);
  } catch (e) { toast('Export failed: ' + e.message, 5000); }
}

/* ---------- send to Google Slides / PowerPoint with the visitor's own account ---------- */
const PUSH = { gslides: { name: 'Google Slides', open: 'Open in Google Slides' }, powerpoint: { name: 'PowerPoint', open: 'Open in PowerPoint' } };
function note(title, text, url, linkText) {
  const n = $('#pushNote');
  n.innerHTML = '';
  n.append(h('b', {}, title), h('p', {}, text));
  if (url) n.append(h('a', { href: url, target: '_blank', rel: 'noopener' }, linkText));
  n.append(h('button', { class: 'x', title: 'Close', onclick: () => { n.hidden = true; } }, '×'));
  n.hidden = false;
}
async function doPush(target) {
  closeMenus();
  const P = PUSH[target];
  await flush();
  toast(`Sending the deck to ${P.name}…`, 180000);
  try {
    const r = await fetch('api/push/' + target, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    clearTimeout(toastT); $('#toast').classList.remove('on');
    note(`Sent to ${P.name}`, `"${d.name}" is in your account now. Later edits here are not synced, so export again after changing the deck.`, d.url, P.open);
  } catch (e) {
    clearTimeout(toastT); $('#toast').classList.remove('on');
    note(`Could not send to ${P.name}`, e.message);
  }
}

/* ---------- wiring ---------- */
function closeMenus() { document.querySelectorAll('.menu-wrap.open').forEach(m => m.classList.remove('open')); }
function bind() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-menu]');
    if (b) { const w = b.closest('.menu-wrap'), was = w.classList.contains('open'); closeMenus(); if (!was) w.classList.add('open'); return; }
    if (!e.target.closest('.menu')) closeMenus();
  });
  $('#shapeMenu').addEventListener('click', e => { const b = e.target.closest('[data-shape]'); if (b) { closeMenus(); addShape(b.dataset.shape); } });
  $('#layoutMenu').addEventListener('click', e => { const b = e.target.closest('[data-layout]'); if (b) { closeMenus(); addSlide(b.dataset.layout); } });
  $('#exportMenu').addEventListener('click', e => { const b = e.target.closest('[data-export]'); if (b) doExport(b.dataset.export); });
  $('#exportMenu').addEventListener('click', e => { const b = e.target.closest('[data-push]'); if (b) doPush(b.dataset.push); });
  $('#thumbs').addEventListener('contextmenu', railMenu);
  $('#thumbs').addEventListener('scroll', closeCtx);
  document.addEventListener('mousedown', e => { if (!e.target.closest('#ctxMenu')) closeCtx(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#ctxMenu').hidden) { closeCtx(); e.stopPropagation(); } }, true);
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);
  $('#undoBtn').onclick = doUndo;
  $('#redoBtn').onclick = doRedo;
  $('#addTextBtn').onclick = () => addEl(textEl(), true);
  $('#addImageBtn').onclick = () => { fileMode = 'add'; $('#fileInput').click(); };
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) fileMode === 'replace' ? replaceImage(f) : addImageFile(f);
  });
  $('#presentBtn').onclick = () => present(cur);
  $('#uiThemeBtn').onclick = () => {
    const v = document.documentElement.dataset.ui === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.ui = v;
    try { localStorage.setItem(UI_KEY, v); } catch (e) { /* storage blocked */ }
  };
  $('#zoomSel').addEventListener('change', e => { zoom = e.target.value; layout(); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; syncTabs(); renderPanel(); }));
  $('#deckTitle').addEventListener('input', e => change(() => { deck.title = e.target.value; }, 'title', { panel: false, canvas: false }));
  $('#deckTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#notes').addEventListener('input', e => change(() => { slide().notes = e.target.value; }, 'notes' + cur, { panel: false, canvas: false }));

  const stage = $('#stage');
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const node = e.target.closest('#slideHost .el');
    if (editingId && node && node.dataset.id === editingId) return;
    if (editingId) endEdit(true);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const handle = e.target.closest('.handle');
    if (handle) return startResize(e, handle.dataset.h);
    if (node) {
      const id = node.dataset.id;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
        selChanged();
        if (!sel.includes(id)) return;
      } else if (!sel.includes(id)) { sel = [id]; selChanged(); }
      startMove(e);
    } else startMarquee(e);
  });
  $('#slideHost').addEventListener('dblclick', e => { const n = e.target.closest('.el-text'); if (n) startEdit(n.dataset.id); });
  stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop'); });
  stage.addEventListener('drop', e => {
    stage.classList.remove('drop');
    const files = [...e.dataTransfer.files].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const p = pt(e), at = { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
    files.forEach((f, i) => addImageFile(f, { x: at.x + i * 24, y: at.y + i * 24 }));
  });

  const thumbs = $('#thumbs');
  const clearDrop = () => thumbs.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'dragging'));
  thumbs.addEventListener('dragstart', e => { const t = e.target.closest('.thumb'); if (!t) return; thumbDrag = +t.dataset.i; t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'slide'); });
  thumbs.addEventListener('dragover', e => {
    if (thumbDrag == null) return;
    e.preventDefault();
    const t = e.target.closest('.thumb'); if (!t) return;
    thumbs.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  thumbs.addEventListener('drop', e => {
    if (thumbDrag == null) return;
    e.preventDefault();
    const t = e.target.closest('.thumb');
    if (t) { const i = +t.dataset.i; moveSlide(thumbDrag, t.classList.contains('drop-after') ? i + 1 : i); }
    thumbDrag = null; clearDrop();
  });
  thumbs.addEventListener('dragend', () => { thumbDrag = null; clearDrop(); });

  const layers = $('#tab-layers');
  layers.addEventListener('dragstart', e => { const r = e.target.closest('.layer'); if (!r) return; layerDrag = r.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'layer'); });
  layers.addEventListener('dragover', e => {
    if (!layerDrag) return;
    e.preventDefault();
    const r = e.target.closest('.layer'); if (!r) return;
    layers.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const b = r.getBoundingClientRect();
    r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after');
  });
  layers.addEventListener('drop', e => {
    if (!layerDrag) return;
    e.preventDefault();
    const r = e.target.closest('.layer'), id = layerDrag;
    layerDrag = null;
    if (!r || r.dataset.id === id) return renderLayers();
    const above = r.classList.contains('drop-before');
    change(() => {
      const arr = slide().elements, el = arr.find(x => x.id === id);
      const rest = arr.filter(x => x.id !== id), ti = rest.findIndex(x => x.id === r.dataset.id);
      rest.splice(above ? ti + 1 : ti, 0, el);
      slide().elements = rest;
    });
  });
  layers.addEventListener('dragend', () => { layerDrag = null; });

  document.addEventListener('keydown', e => {
    if (!$('#present').hidden) return presentKey(e);
    const typing = isTyping(e.target), mod = e.metaKey || e.ctrlKey, k = e.key, kl = k.toLowerCase();
    if (mod && kl === 'z' && !typing) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && kl === 'y' && !typing) { e.preventDefault(); doRedo(); return; }
    if (typing) return;
    if (k === 'Escape') { closeMenus(); if (sel.length) { sel = []; renderOverlay(); renderPanel(); } return; }
    if (mod && kl === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && kl === 'a') { e.preventDefault(); sel = slide().elements.filter(x => !x.locked && !x.hidden).map(x => x.id); selChanged(); return; }
    if ((mod && k === 'Enter') || k === 'F5') { e.preventDefault(); present(cur); return; }
    if ((k === 'Delete' || k === 'Backspace') && sel.length) { e.preventDefault(); deleteSel(); return; }
    if (k === 'Enter' && sel.length === 1 && elById(sel[0])?.type === 'text') { e.preventDefault(); startEdit(sel[0]); return; }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (sel.length) {
        const d = e.shiftKey ? 10 : 1;
        const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
        change(() => selEls().filter(x => !x.locked).forEach(x => { x.x += dx; x.y += dy; }), 'nudge');
      } else goSlide(cur + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (k === 'PageDown') goSlide(cur + 1);
    if (k === 'PageUp') goSlide(cur - 1);
  });
  document.addEventListener('copy', e => {
    if (isTyping(e.target) || !sel.length) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', CLIP + JSON.stringify(selEls()));
  });
  document.addEventListener('cut', e => {
    if (isTyping(e.target) || !sel.length) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', CLIP + JSON.stringify(selEls()));
    deleteSel();
  });
  document.addEventListener('paste', e => {
    if (isTyping(e.target) || !$('#present').hidden) return;
    const cd = e.clipboardData;
    const files = [...(cd?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); files.forEach(f => addImageFile(f)); return; }
    const text = cd?.getData('text/plain') || '';
    if (text.startsWith(CLIP)) {
      e.preventDefault();
      try { pasteEls(JSON.parse(text.slice(CLIP.length))); } catch (err) { toast('Could not paste those layers.'); }
    } else if (text.trim()) {
      e.preventDefault();
      const t = text.trim().slice(0, 4000), lines = t.split('\n').length;
      addEl(textEl({ text: t, size: 24, weight: 400, w: 720, h: Math.min(560, lines * 32 + 8), x: 280, y: Math.max(40, 360 - lines * 16) }));
    }
  });

  const P = $('#present');
  $('#pPrev').onclick = e => { e.stopPropagation(); pGo(-1); };
  $('#pNext').onclick = e => { e.stopPropagation(); pGo(1); };
  $('#pNotesBtn').onclick = e => { e.stopPropagation(); $('#pNotes').hidden = !$('#pNotes').hidden; };
  $('#pExit').onclick = e => { e.stopPropagation(); closeP(); };
  $('#pStage').addEventListener('click', () => pGo(1));
  P.addEventListener('mousemove', wake);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && pFull) { pFull = false; closeP(); }
    else if (!P.hidden) renderP();
  });
  window.addEventListener('resize', () => { layout(); if (!P.hidden) renderP(); });
  new ResizeObserver(() => layout()).observe(stage);
  let railW = 0;
  new ResizeObserver(() => { const w = $('#thumbs').clientWidth; if (w !== railW) { railW = w; renderThumbs(); } }).observe($('#thumbs'));
  window.addEventListener('beforeunload', () => {
    if (dirty) fetch('api/deck', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck, baseRev: rev }) });
  });
  setInterval(poll, 3000);
}

async function init() {
  try {
    const d = await (await fetch('api/deck')).json();
    rev = d.rev; deck = d.deck;
    await loadThemes();
  } catch (e) { setSave('Could not load the deck. Reload to retry.'); return; }
  bind();
  renderAll();
  setSave('All changes saved');
  window.__editor = { get deck() { return deck; }, get sel() { return sel; }, get rev() { return rev; } };
}
init();
})();
