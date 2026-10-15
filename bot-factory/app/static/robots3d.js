import { THREE, mat, glowMat, mesh, canvasTex, textSprite, makeRobot, idle } from './robot.js';

const TAU = Math.PI * 2;
const THEMES = [
  { key: /prd/i, color: '#2f80ed', build: prd },
  { key: /grill/i, color: '#f2652c', build: grill },
  { key: /kanban|trello|to-?do/i, color: '#27ae60', build: kanban },
  { key: /last30|research|news/i, color: '#e2a400', build: news },
];
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------- per-bot props + poses ----------
function prd(r, root) {
  r.group.position.x = -0.1;
  const board = new THREE.Group();
  board.position.set(0.05, 0.68, 0.45); board.rotation.x = -0.35; root.add(board);
  mesh(new THREE.BoxGeometry(0.42, 0.54, 0.03), mat('#8d6e63'), 0, 0, 0, board);
  const paper = canvasTex(256, 320, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f80ed'; c.font = 'bold 72px system-ui'; c.fillText('PRD', 24, 84);
    c.fillStyle = '#b0bec5';
    for (let i = 0; i < 6; i++) c.fillRect(24, 124 + i * 30, i % 3 == 2 ? 120 : 200, 12);
  });
  mesh(new THREE.PlaneGeometry(0.36, 0.46), new THREE.MeshStandardMaterial({ map: paper, roughness: 0.9 }), 0, -0.015, 0.017, board);
  mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), mat('#cfd8dc', { metalness: 0.7, roughness: 0.3 }), 0, 0.26, 0.03, board);
  const pen = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), mat('#ff5252'), 0, -0.06, 0.04, r.handL);
  pen.rotation.x = 1.2;
  r.armR.rotation.set(-1.15, 0, -0.35);
  r.head.rotation.x = 0.3;
  return t => {
    r.armL.rotation.set(-1.0 + Math.sin(t * 9) * 0.06, 0, 0.45 + Math.sin(t * 4.5) * 0.08);
    board.position.y = 0.68 + Math.sin(t * 3) * 0.015;
  };
}

function grill(r, root) {
  r.group.position.x = -0.35;
  const g = new THREE.Group(); g.position.set(0.55, 0, 0.25); root.add(g);
  const black = mat('#263238', { metalness: 0.5, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3;
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), black, Math.cos(a) * 0.17, 0.31, Math.sin(a) * 0.17, g);
  }
  const bowl = mesh(new THREE.SphereGeometry(0.3, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2),
    mat('#263238', { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }), 0, 0.64, 0, g);
  bowl.scale.y = 0.6;
  const coals = mesh(new THREE.CircleGeometry(0.27, 24), glowMat('#ff6d00', 1.5), 0, 0.6, 0, g);
  coals.rotation.x = -Math.PI / 2;
  const grate = mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 32), mat('#90a4ae', { metalness: 0.8 }), 0, 0.65, 0, g);
  grate.rotation.x = Math.PI / 2;
  for (let i = -2; i <= 2; i++) mesh(new THREE.BoxGeometry(0.58, 0.01, 0.01), mat('#90a4ae', { metalness: 0.8 }), 0, 0.65, i * 0.1, g);
  const patties = [-0.1, 0.12].map(x => mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.035, 16), mat('#6d4c41'), x, 0.67, 0.02, g));
  const flames = [[-0.15, 0.08], [0.02, -0.12], [0.16, 0.1], [0.05, 0.14]].map(([x, z], i) => {
    const f = mesh(new THREE.ConeGeometry(0.05, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#ffca28' : '#ff7043', emissive: i % 2 ? '#ffca28' : '#ff5722',
        emissiveIntensity: 1.6, transparent: true, opacity: 0.85 }), x, 0.74, z, g);
    return f;
  });
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), mat('#5d4037'), 0, -0.12, 0, r.handR);
  mesh(new THREE.BoxGeometry(0.14, 0.012, 0.12), mat('#b0bec5', { metalness: 0.8, roughness: 0.3 }), 0.02, -0.28, 0.03, r.handR);
  const q = textSprite('❓', { px: 96, scale: 0.32 }); q.position.set(-0.8, 1.6, 0); root.add(q);
  r.head.rotation.y = 0.45;
  return t => {
    flames.forEach((f, i) => (f.scale.y = 0.7 + 0.45 * Math.abs(Math.sin(t * 9 + i * 1.7))));
    coals.material.emissiveIntensity = 1.3 + 0.3 * Math.sin(t * 11);
    const p = (t % 2.4) / 0.6, pp = patties[0];
    if (p < 1) { pp.position.y = 0.67 + Math.sin(p * Math.PI) * 0.25; pp.rotation.x = p * Math.PI; }
    else { pp.position.y = 0.67; pp.rotation.x = 0; }
    r.armR.rotation.set(-0.6 - (p < 1 ? Math.sin(p * Math.PI) * 0.4 : 0), 0, 0.55);
    q.position.y = 1.6 + Math.sin(t * 2.5) * 0.05;
  };
}

function kanban(r, root) {
  r.group.position.x = -0.5;
  const b = new THREE.Group(); b.position.set(0.45, 0, -0.1); b.rotation.y = -0.25; root.add(b);
  [-0.4, 0.4].forEach(x => mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), mat('#8d6e63'), x, 0.5, -0.03, b));
  mesh(new THREE.BoxGeometry(1.05, 0.75, 0.04), mat('#eceff1'), 0, 1.0, 0, b);
  const cols = ['#90a4ae', '#42a5f5', '#66bb6a'], notes = ['#fff176', '#f48fb1', '#80deea', '#ffcc80'];
  const sticky = [];
  cols.forEach((c, ci) => {
    const x = (ci - 1) * 0.34;
    mesh(new THREE.BoxGeometry(0.3, 0.06, 0.01), mat(c), x, 1.3, 0.025, b);
    for (let i = 0; i < 3 - ci % 2; i++) {
      const n = mesh(new THREE.BoxGeometry(0.13, 0.1, 0.012), mat(notes[(ci + i) % 4]), x + (i % 2 ? 0.05 : -0.04), 1.15 - i * 0.14, 0.028, b);
      n.rotation.z = ((ci * 3 + i) % 3 - 1) * 0.06; sticky.push(n);
    }
  });
  mesh(new THREE.BoxGeometry(0.13, 0.1, 0.015), mat('#fff176'), 0, -0.02, 0.06, r.handR);
  r.head.rotation.y = 0.55;
  return t => {
    r.armR.rotation.set(-0.25, 0, 1.2 + Math.sin(t * 1.6) * 0.25);
    const n = sticky[sticky.length - 1]; n.scale.setScalar(1 + 0.08 * Math.max(0, Math.sin(t * 3)));
  };
}

function news(r, root) {
  const paper = new THREE.Group(); paper.position.set(0, 0.66, 0.42); paper.rotation.x = -0.2; root.add(paper);
  const tex = canvasTex(384, 272, (c, w, h) => {
    c.fillStyle = '#fafafa'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#212121'; c.font = 'bold 40px Georgia, serif'; c.fillText('LAST 30 DAYS', 26, 52);
    c.fillRect(20, 66, w - 40, 4); c.fillStyle = '#9e9e9e';
    for (let col = 0; col < 3; col++) for (let i = 0; i < 9; i++) c.fillRect(22 + col * 118, 86 + i * 19, 104, 8);
  });
  mesh(new THREE.PlaneGeometry(0.72, 0.5), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }), 0, 0, 0, paper);
  r.armL.rotation.set(-1.1, 0, 0.3); r.armR.rotation.set(-1.1, 0, -0.3);
  r.head.rotation.x = 0.25;
  return t => {
    paper.rotation.z = Math.sin(t * 1.2) * 0.05;
    r.head.rotation.y = Math.sin(t * 0.9) * 0.25;
  };
}

function dflt(r, root, o) {
  const s = textSprite(o.emoji || '🤖', { px: 96, scale: 0.36 }); s.position.set(0.65, 1.6, 0); root.add(s);
  return t => {
    r.armR.rotation.set(0, 0, 2.5 + Math.sin(t * 7) * 0.35);
    s.position.y = 1.6 + Math.sin(t * 2.3) * 0.06;
  };
}

// ---------- scene per card ----------
function buildScene(name, emoji) {
  const th = THEMES.find(x => x.key.test(name));
  const color = th ? th.color : `hsl(${hash(name) % 360}, 62%, 52%)`;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8090a0', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  const root = new THREE.Group(); scene.add(root);
  const r = makeRobot(color); root.add(r.group);
  const disc = mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.12 }), 0, 0.002, 0, r.group);
  disc.rotation.x = -Math.PI / 2;
  const upd = (th ? th.build : dflt)(r, root, { emoji, color });
  const cam = new THREE.PerspectiveCamera(28, 1.7, 0.1, 50);
  cam.position.set(0, 1.25, 4.3); cam.lookAt(0, 0.9, 0);
  return { scene, cam, root, r, upd, spin: 0, phase: (hash(name) % 100) / 10, hover: false, vis: true };
}

let renderer = null, RW = 0, RH = 0, last = 0, lastDraw = 0;
const items = new Map();
const io = new IntersectionObserver(es => es.forEach(e => { const st = items.get(e.target); if (st) st.vis = e.isIntersecting; }));

function dispose(st) {
  st.scene.traverse(o => {
    o.geometry?.dispose();
    [].concat(o.material || []).forEach(m => { m.map?.dispose(); m.dispose(); });
  });
}

export function mount() {
  if (!renderer) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      requestAnimationFrame(frame);
    } catch (e) { console.warn('WebGL unavailable', e); return; }
  }
  document.querySelectorAll('canvas.bot3d').forEach(cv => {
    if (items.has(cv)) return;
    const st = buildScene(cv.dataset.name || '', cv.dataset.emoji || '🤖');
    st.cv = cv; st.ctx = cv.getContext('2d');
    const host = cv.closest('.card') || cv.closest('.stage');
    host.addEventListener('mouseenter', () => (st.hover = true));
    host.addEventListener('mouseleave', () => (st.hover = false));
    items.set(cv, st); io.observe(cv);
    cv.parentElement.classList.add('live');
  });
  for (const [cv, st] of items) if (!cv.isConnected) { io.unobserve(cv); dispose(st); items.delete(cv); }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastDraw < 32) return;
  lastDraw = now;
  const t = now / 1000, dt = Math.min(0.1, t - last); last = t;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  for (const st of items.values()) {
    if (!st.vis || !st.cv.isConnected) continue;
    const w = Math.round(st.cv.clientWidth * dpr), h = Math.round(st.cv.clientHeight * dpr);
    if (!w || !h) continue;
    if (st.cv.width !== w || st.cv.height !== h) { st.cv.width = w; st.cv.height = h; }
    if (w > RW || h > RH) { RW = Math.max(RW, w); RH = Math.max(RH, h); renderer.setSize(RW, RH, false); }
    st.cam.aspect = w / h; st.cam.updateProjectionMatrix();
    if (st.hover) st.spin += dt * 3.2;
    else { const target = Math.round(st.spin / TAU) * TAU; st.spin += (target - st.spin) * Math.min(1, dt * 5); }
    st.root.rotation.y = -0.25 + st.spin;
    st.root.position.y = st.hover ? Math.abs(Math.sin(t * 6)) * 0.06 : 0;
    const tt = t + st.phase;
    idle(st.r, tt, 0);
    st.upd(tt, st.hover);
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
    renderer.render(st.scene, st.cam);
    st.ctx.clearRect(0, 0, w, h);
    st.ctx.drawImage(renderer.domElement, 0, RH - h, w, h, 0, 0, w, h);
  }
}