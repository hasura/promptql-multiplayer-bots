// Runs the generated Figma plugin code.js against a stub of the Plugin API, so a bad element can't
// slip through unnoticed. Usage: node tests/plugin_sim.js /path/to/code.js
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const nodes = [];
const okColor = c => c && ['r', 'g', 'b'].every(k => c[k] >= 0 && c[k] <= 1) && (c.a == null || (c.a >= 0 && c.a <= 1));
function mkNode(type) {
  const n = {type, id: 'n' + nodes.length, x: 0, y: 0, width: 100, height: 100, children: [], parent: null, _props: {},
    resize(w, h) { if (!(w >= 0) || !(h >= 0) || Number.isNaN(w) || Number.isNaN(h)) throw new Error('bad resize ' + w + ',' + h); this.width = w; this.height = h; },
    appendChild(c) { if (!['FRAME', 'GROUP', 'PAGE'].includes(this.type)) throw new Error('appendChild on ' + this.type); if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); }};
  const checkPaint = p => { for (const q of p) {
    if (q.type === 'SOLID') { if (!okColor(q.color)) throw new Error('bad color'); if (!(q.opacity >= 0 && q.opacity <= 1)) throw new Error('bad paint opacity'); }
    else if (q.type === 'GRADIENT_LINEAR') { if (!Array.isArray(q.gradientTransform) || q.gradientTransform.length !== 2 || q.gradientTransform.some(r => r.length !== 3 || r.some(v => !Number.isFinite(v)))) throw new Error('bad gradientTransform'); if (!q.gradientStops || q.gradientStops.length < 2 || q.gradientStops.some(s => !(s.position >= 0 && s.position <= 1) || !okColor(s.color))) throw new Error('bad gradient stops'); }
    else if (q.type === 'IMAGE') { if (!q.imageHash) throw new Error('image paint without hash'); }
    else throw new Error('unknown paint ' + q.type); } };
  return new Proxy(n, {set(t, k, v) {
    if (k === 'fills' || k === 'strokes') { if (!Array.isArray(v)) throw new Error(k + ' not array'); checkPaint(v); }
    if (k === 'effects') { if (!Array.isArray(v)) throw new Error('effects not array'); for (const f of v) { if (f.type !== 'DROP_SHADOW' || !okColor(f.color) || f.color.a == null || !(f.radius >= 0) || !f.offset || !Number.isFinite(f.offset.x) || !Number.isFinite(f.offset.y) || f.blendMode !== 'NORMAL' || typeof f.visible !== 'boolean') throw new Error('bad effect ' + JSON.stringify(f)); } }
    if (k === 'characters' && t.type === 'TEXT' && !t._font) throw new Error('characters before fontName');
    if (k === 'fontName') t._font = v;
    if (k === 'opacity' && !(v >= 0 && v <= 1)) throw new Error('bad opacity');
    if (k === 'rotation' && !(Number.isFinite(v) && v >= -180 && v <= 180)) throw new Error('bad rotation ' + v);
    if ((k === 'x' || k === 'y') && !Number.isFinite(v)) throw new Error('bad ' + k + ' ' + v);
    if (k === 'strokeWeight' && !(v >= 0)) throw new Error('bad strokeWeight');
    if (k === 'cornerRadius' && !(v >= 0)) throw new Error('bad radius');
    if (k === 'textAutoResize' && !['NONE','WIDTH_AND_HEIGHT','HEIGHT','TRUNCATE'].includes(v)) throw new Error('bad autoresize');
    if (k === 'lineHeight' && !(v && v.unit)) throw new Error('bad lineHeight');
    if (k === 'layoutMode') { if (t.type !== 'FRAME') throw new Error('layoutMode on ' + t.type); if (!['NONE', 'HORIZONTAL', 'VERTICAL'].includes(v)) throw new Error('bad layoutMode'); }
    if ((k === 'primaryAxisSizingMode' || k === 'counterAxisSizingMode') && (!t.layoutMode || t.layoutMode === 'NONE')) throw new Error(k + ' before layoutMode');
    if ((k === 'primaryAxisSizingMode' || k === 'counterAxisSizingMode') && !['FIXED', 'AUTO'].includes(v)) throw new Error('bad ' + k);
    if (/^(itemSpacing|padding(Left|Right|Top|Bottom))$/.test(k) && !(Number.isFinite(v) && (k === 'itemSpacing' || v >= 0))) throw new Error('bad ' + k);
    t[k] = v; return true; }});
}
const page = mkNode('PAGE'); page.selection = [];
let notified = [];
global.figma = {
  currentPage: page,
  viewport: {center: {x: 500, y: 300}, scrollAndZoomIntoView(n) { if (!Array.isArray(n)) throw new Error('zoom arg'); }},
  createFrame: () => { const n = mkNode('FRAME'); nodes.push(n); return n; },
  createRectangle: () => { const n = mkNode('RECTANGLE'); nodes.push(n); return n; },
  createEllipse: () => { const n = mkNode('ELLIPSE'); nodes.push(n); return n; },
  createLine: () => { const n = mkNode('LINE'); nodes.push(n); return n; },
  createText: () => { const n = mkNode('TEXT'); nodes.push(n); n.width = 50; n.height = 20; return n; },
  group: (kids, parent) => { if (!Array.isArray(kids) || !kids.length) throw new Error('group needs nodes'); if (kids.some(k => k.parent !== kids[0].parent)) throw new Error('group across parents'); const n = mkNode('GROUP'); nodes.push(n);
    const xs = kids.map(k => k.x), ys = kids.map(k => k.y); n.x = Math.min(...xs); n.y = Math.min(...ys); n.width = Math.max(...kids.map(k => k.x + k.width)) - n.x; n.height = Math.max(...kids.map(k => k.y + k.height)) - n.y;
    parent.appendChild(n); for (const k of kids) n.appendChild(k); return n; },
  createImage: bytes => ({hash: 'h' + bytes.length}),
  base64Decode: s => Buffer.from(s, 'base64'),
  loadFontAsync: async f => { if (f.family !== 'Inter') throw new Error('no font ' + f.family); if (!['Regular','Medium','Semi Bold','Bold'].includes(f.style)) throw new Error('no style ' + f.style); },
  getNodeByIdAsync: async id => process.env.SIM_ORIG === '1' ? Object.assign(mkNode('INSTANCE'), {id, x: 1000, y: 200, width: 804, height: 853, parent: page}) : null,
  setCurrentPageAsync: async () => {},
  notify: (msg, o) => { notified.push([msg, o]); },
  closePlugin: () => {},
};
new Function(src)();
setTimeout(() => {
  const frames = nodes.filter(n => n.type === 'FRAME' && n.parent && n.parent.type === 'PAGE');
  const f = frames[0];
  const kinds = {}; const count = l => { for (const c of l) { kinds[c.type] = (kinds[c.type] || 0) + 1; if (c.children.length) count(c.children); } }; count(f.children);
  const deep = l => l.reduce((s, c) => s + 1 + deep(c.children), 0);
  console.log(JSON.stringify({frames: frames.length, frame: {name: f.name, w: f.width, h: f.height, x: f.x, y: f.y, parent: f.parent && f.parent.type}, children: f.children.length, total: deep(f.children), kinds, notify: notified.map(n => n[0])}));
  const fails = notified.filter(n => n[1] && n[1].error);
  if (fails.length || notified.some(n => /skipped/.test(n[0]))) { console.log('FAIL'); process.exit(1); }
  console.log('OK');
}, 200);