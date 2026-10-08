// Runs the generated Figma plugin code.js against a stub of the Plugin API, so a bad element can't
// slip through unnoticed. Usage: node tests/plugin_sim.js /path/to/code.js
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const nodes = [];
function mkNode(type) {
  const n = {type, id: 'n' + nodes.length, x: 0, y: 0, width: 100, height: 100, children: [], parent: null, _props: {},
    resize(w, h) { if (!(w >= 0) || !(h >= 0) || Number.isNaN(w) || Number.isNaN(h)) throw new Error('bad resize ' + w + ',' + h); this.width = w; this.height = h; },
    appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); }};
  const checkPaint = p => { for (const q of p) { if (q.type === 'SOLID') { for (const k of ['r','g','b']) if (!(q.color[k] >= 0 && q.color[k] <= 1)) throw new Error('bad color'); if (!(q.opacity >= 0 && q.opacity <= 1)) throw new Error('bad paint opacity'); } } };
  return new Proxy(n, {set(t, k, v) {
    if (k === 'fills' || k === 'strokes') { if (!Array.isArray(v)) throw new Error(k + ' not array'); checkPaint(v); }
    if (k === 'characters' && t.type === 'TEXT' && !t._font) throw new Error('characters before fontName');
    if (k === 'fontName') t._font = v;
    if (k === 'opacity' && !(v >= 0 && v <= 1)) throw new Error('bad opacity');
    if (k === 'strokeWeight' && !(v >= 0)) throw new Error('bad strokeWeight');
    if (k === 'cornerRadius' && !(v >= 0)) throw new Error('bad radius');
    if (k === 'textAutoResize' && !['NONE','WIDTH_AND_HEIGHT','HEIGHT','TRUNCATE'].includes(v)) throw new Error('bad autoresize');
    if (k === 'lineHeight' && !(v && v.unit)) throw new Error('bad lineHeight');
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
  const frames = nodes.filter(n => n.type === 'FRAME');
  const f = frames[0];
  const kinds = {}; for (const c of f.children) kinds[c.type] = (kinds[c.type] || 0) + 1;
  console.log(JSON.stringify({frames: frames.length, frame: {name: f.name, w: f.width, h: f.height, x: f.x, y: f.y, parent: f.parent && f.parent.type}, children: f.children.length, kinds, notify: notified.map(n => n[0])}));
  const fails = notified.filter(n => n[1] && n[1].error);
  if (fails.length || notified.some(n => /skipped/.test(n[0]))) { console.log('FAIL'); process.exit(1); }
  console.log('OK');
}, 200);