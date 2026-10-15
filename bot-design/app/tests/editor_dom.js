// Drives static/editor.js inside jsdom: multi-select, group/ungroup, align/distribute, rotation, gradient/shadow,
// auto layout, snapping guides, undo and SVG export. Usage: node tests/editor_dom.js  (needs tests/node_modules/jsdom)
const fs = require('fs'), path = require('path');
const {JSDOM} = require(path.join(__dirname, 'node_modules', 'jsdom'));
const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'editor.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><div id="canvas" style="position:relative"></div><div id="props"></div><div id="layers"></div></body>', {runScripts: 'outside-only', pretendToBeVisual: true});
const {window} = dom; const {document} = window;
let saved = null, status = '', toasts = [];
window.fetch = async (url, o) => {
  if (o && o.method === 'PUT') { saved = JSON.parse(o.body); return {ok: true, status: 200, json: async () => ({version: saved.base_version + 1})}; }
  return {ok: true, status: 200, json: async () => ({version: 0, doc: {bg: '#ffffff', els: []}})};
};
window.HTMLCanvasElement.prototype.getContext = () => ({measureText: s => ({width: s.length * 9}), font: ''});
window.eval(src);
const E = window.Editor;
const results = [];
const check = (n, ok, extra) => { results.push([n, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300))); };
const svg = () => document.getElementById('design');
const ev = (type, x, y, mods) => { const e = new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...(mods || {})}); e.pointerId = 1; return e; };
const at = (x, y) => { const g = [...svg().querySelectorAll('g[data-id]')].filter(g => { const r = g.querySelector('rect,ellipse,text,image,line'); if (!r) return false; const e = find(g.dataset.id); if (!e) return false; const b = {x: e.x, y: e.y, w: e.w, h: e.h}; return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }); return g.length ? g[g.length - 1] : svg(); };
let DOC = () => saved && saved.doc;
const find = (id, list) => { for (const e of list || (DOC() ? DOC().els : [])) { if (e.id === id) return e; if (e.type === 'group') { const r = find(id, e.els); if (r) return r; } } return null; };
function drag(x0, y0, x1, y1, mods, target) {
  const t = target || at(x0, y0);
  t.dispatchEvent(ev('pointerdown', x0, y0, mods)); svg().dispatchEvent(ev('pointermove', (x0 + x1) / 2, (y0 + y1) / 2, mods)); svg().dispatchEvent(ev('pointermove', x1, y1, mods)); svg().dispatchEvent(ev('pointerup', x1, y1, mods));
}
const key = (k, mods) => E.handleKey({key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...(mods || {})});
const flush = () => E.flush();
(async () => {
  E.init({canvas: document.getElementById('canvas'), props: document.getElementById('props'), layers: document.getElementById('layers'), toast: m => toasts.push(m), me: () => ({id: 'u1'}),
          onStatus: s => { status = s; }, onTool: () => {}, pickImage: () => {}, patchFrame: () => {}, canDeleteFrame: () => true, deleteFrame: () => {}});
  const frame = {id: 'L1|local:1', kind: 'local', width: 800, height: 600, name: 'Test'};
  await E.load(frame); E.resize(1); E.setEnabled(true);
  check('1 loaded empty frame', E.state.count === 0 && E.state.sels.length === 0);

  // draw three rects
  E.setTool('rect'); drag(10, 10, 110, 60, {}, svg());
  E.setTool('rect'); drag(200, 10, 300, 60, {}, svg());
  E.setTool('rect'); drag(500, 300, 560, 360, {}, svg());
  await flush();
  check('2 three rects created and saved', E.state.count === 3 && saved && saved.doc.els.length === 3 && saved.doc.els[0].w === 100 && saved.doc.els[0].h === 50, saved && saved.doc.els);
  const [a, b, c] = saved.doc.els.map(e => e.id);

  // snapping: drag rect c so its left edge lands within 6px of rect a's left edge (x=10) -> snaps to 10
  drag(530, 330, 44, 330); await flush();
  check('3 move snaps to a sibling edge', find(c).x === 10, find(c).x);
  check('3b guides cleared after drag', svg().querySelector('#guides').children.length === 0);
  drag(40, 330, 44 + 4, 330, {ctrlKey: true}); await flush();
  check('3c ⌘ disables snapping', Math.abs(find(c).x - 18) < 0.01, find(c).x);

  // multi-select with marquee, then align + distribute
  E.setTool('select'); drag(0, 0, 320, 80, {}, svg());
  check('4 marquee selects two rects', E.state.sels.length === 2 && E.state.sels.includes(a) && E.state.sels.includes(b), E.state.sels);
  key('a', {metaKey: true}); check('4b ⌘A selects everything at this level', E.state.sels.length === 3);
  key('w', {altKey: true, code: 'KeyW'}); await flush();
  check('4c align top moves all to the topmost y', saved.doc.els.every(e => e.y === 10), saved.doc.els.map(e => e.y));
  key('h', {altKey: true, ctrlKey: true, code: 'KeyH'}); await flush();
  const bx = saved.doc.els.map(e => ({x: e.x, w: e.w})).sort((p, q) => p.x - q.x);
  check('4d distribute horizontally equalises gaps', Math.abs((bx[1].x - (bx[0].x + bx[0].w)) - (bx[2].x - (bx[1].x + bx[1].w))) < 0.01 && bx[0].x === 10 && bx[2].x + bx[2].w === 300, bx);

  // group a+b, rotate the group, check render + export
  drag(0, 0, 0, 0, {}, svg()); // deselect
  E.setTool('select'); const ga = at(find(a).x + 5, 15); ga.dispatchEvent(ev('pointerdown', find(a).x + 5, 15)); svg().dispatchEvent(ev('pointerup', find(a).x + 5, 15));
  const gb = at(find(b).x + 5, 15); gb.dispatchEvent(ev('pointerdown', find(b).x + 5, 15, {shiftKey: true})); svg().dispatchEvent(ev('pointerup', find(b).x + 5, 15, {shiftKey: true}));
  check('5 shift-click adds to selection', E.state.sels.length === 2, E.state.sels);
  key('g', {metaKey: true, code: 'KeyG'}); await flush();
  const g = saved.doc.els.find(e => e.type === 'group');
  check('5b ⌘G makes a group hugging its children', g && g.els.length === 2 && g.x === Math.min(find(a).x, find(b).x) && g.w === Math.max(find(a).x, find(b).x) + 100 - g.x && E.state.sels[0] === g.id, g);
  // rotation via props field
  const rotIn = document.querySelector('#props [data-k="rot"]'); rotIn.value = '30'; rotIn.dispatchEvent(new window.Event('change', {bubbles: true})); await flush();
  check('5c rotation field sets rot on the group', find(g.id).rot === 30);
  const gEl = svg().querySelector(`g[data-id="${g.id}"]`);
  check('5d group renders with a rotate transform about its centre', gEl && /^rotate\(30 /.test(gEl.getAttribute('transform') || ''), gEl && gEl.getAttribute('transform'));
  // double-click enters the group; Escape climbs out
  const gaEl = svg().querySelector(`g[data-id="${a}"]`); gaEl.dispatchEvent(ev('dblclick', 15, 15));
  check('5e double-click scopes into the group and selects the child', E.state.scope === g.id && E.state.sels[0] === a, E.state);
  key('Escape'); key('Escape'); check('5f Escape leaves the group', E.state.scope === null && E.state.sels[0] === g.id, E.state);
  // gradient + shadow on rect a via scoped selection
  E.setTool('select'); gaEl.dispatchEvent(ev('dblclick', 15, 15));
  document.querySelector('#props [data-ft="grad"]').click(); await flush();
  check('6 gradient toggle adds two stops', find(a).grad && find(a).grad.stops.length === 2 && find(a).grad.angle === 180, find(a).grad);
  document.querySelector('#props [data-tog="shadow"]').click(); await flush();
  check('6b shadow toggle adds a shadow', find(a).shadow && find(a).shadow.blur === 16, find(a).shadow);
  const svgOut = await E.toSVG();
  check('6c export carries gradient, drop shadow and rotation', /linearGradient id="g-/.test(svgOut) && /feDropShadow/.test(svgOut) && /rotate\(30 /.test(svgOut) && !/data-id/.test(svgOut), svgOut.slice(0, 200));
  document.querySelector('#props [data-ft="solid"]').click(); await flush();
  check('6d back to solid keeps the first stop as fill', !find(a).grad && /^#/.test(find(a).fill));
  // auto layout on the group: ⇧A, children re-flow with gap
  key('Escape'); key('Escape'); check('7 group selected again', E.state.sels[0] === g.id && !E.state.scope);
  key('a', {shiftKey: true, code: 'KeyA'}); await flush();
  const g2 = find(g.id);
  check('7b ⇧A turns the group into a row auto layout', g2.layout && g2.layout.dir === 'row' && g2.layout.gap === 8, g2.layout);
  const kids = g2.els.map(e => ({x: e.x, w: e.w})).sort((p, q) => p.x - q.x);
  check('7c children packed with the gap and group hugs', Math.abs(kids[1].x - (kids[0].x + kids[0].w + 8)) < 0.01 && Math.abs(g2.w - (kids[0].w + kids[1].w + 8)) < 0.01, [kids, g2.w]);
  const gapIn = document.querySelector('#props [data-k="ly.gap"]'); gapIn.value = '40'; gapIn.dispatchEvent(new window.Event('change', {bubbles: true})); await flush();
  const k3 = find(g.id).els.map(e => e.x).sort((p, q) => p - q);
  check('7d gap field re-flows', Math.abs((k3[1] - k3[0]) - 140) < 0.01, k3);
  // ungroup bakes rotation into children
  key('g', {metaKey: true, shiftKey: true, code: 'KeyG'}); await flush();
  check('8 ⇧⌘G ungroups and children inherit the rotation', !saved.doc.els.some(e => e.type === 'group') && saved.doc.els.filter(e => e.rot === 30).length === 2 && E.state.sels.length === 2, saved.doc.els.map(e => [e.id, e.rot]));
  // undo restores the group
  key('z', {metaKey: true}); await flush();
  check('8b undo restores the group', saved.doc.els.some(e => e.type === 'group'));
  // delete multi selection removes the empty group cleanly
  E.setTool('select'); drag(0, 0, 800, 600, {}, svg()); key('Delete'); await flush();
  check('9 delete all leaves an empty doc', saved.doc.els.length === 0 && E.state.count === 0);
  check('10 layers panel shows empty state', /Nothing drawn/.test(document.getElementById('layers').innerHTML));
  const fails = results.filter(r => !r[1]).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });