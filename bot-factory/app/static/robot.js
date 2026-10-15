import * as THREE from './three.module.min.js';
export { THREE };

export const mat = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, ...o });
export const glowMat = (color, i = 1.2) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.3 });

export function mesh(geo, material, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function textSprite(text, { color = '#263238', bg = null, px = 96, scale = 0.3 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `bold ${px}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + px * 0.6);
  const h = Math.ceil(px * 1.4);
  c.width = w; c.height = h;
  if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 0, w, h, h * 0.3); ctx.fill(); }
  ctx.font = font;
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + px * 0.06);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(scale * w / h, scale, 1);
  return s;
}

function roundRect(w, h, c) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + c, -h / 2);
  s.lineTo(w / 2 - c, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + c);
  s.lineTo(w / 2, h / 2 - c); s.quadraticCurveTo(w / 2, h / 2, w / 2 - c, h / 2);
  s.lineTo(-w / 2 + c, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - c);
  s.lineTo(-w / 2, -h / 2 + c); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + c, -h / 2);
  return s;
}

// Soft rounded box (TV-style head / body), built from core three.js only
export function roundedBox(w, h, d, b = 0.08, c = 0.12) {
  const g = new THREE.ExtrudeGeometry(roundRect(w - 2 * b, h - 2 * b, c), {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 6, curveSegments: 12,
  });
  g.center();
  g.computeVertexNormals();
  return g;
}

// Form factor follows the reference icon: big rounded-square screen head with a
// glowing face, antenna ball, ear bolts, small rounded body with a chest button.
export function makeRobot(color) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.35 });
  const shell = mat('#f5f7fa', { roughness: 0.3 });
  const dark = mat('#3b4650', { roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1e2730', roughness: 0.15, metalness: 0.4 });
  const eye = glowMat('#e8fbff', 1.3);

  // legs + feet
  [-0.13, 0.13].forEach(x => {
    mesh(new THREE.CapsuleGeometry(0.07, 0.14, 4, 12), dark, x, 0.2, 0, g);
    const f = mesh(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), body, x, 0.0, 0.03, g);
    f.scale.set(1, 0.9, 1.2);
  });

  // body
  mesh(roundedBox(0.52, 0.48, 0.4, 0.07, 0.1), body, 0, 0.6, 0, g);
  const plate = mesh(new THREE.CircleGeometry(0.1, 28), shell, 0, 0.6, 0.203, g);
  const chest = mesh(new THREE.SphereGeometry(0.045, 16, 12), glowMat('#ffffff', 0.9), 0, 0.6, 0.21, g);
  chest.material.color.set(color); chest.material.emissive.set(color);
  plate.renderOrder = 1;
  mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 16), dark, 0, 0.88, 0, g);

  // head
  const head = new THREE.Group();
  head.position.y = 1.24;
  g.add(head);
  mesh(roundedBox(0.84, 0.64, 0.58, 0.08, 0.14), shell, 0, 0, 0, head);
  const screen = mesh(new THREE.ShapeGeometry(roundRect(0.62, 0.42, 0.11), 12), glass, 0, -0.01, 0.292, head);
  screen.renderOrder = 1;
  const eyes = [-0.13, 0.13].map(x => {
    const e = mesh(new THREE.SphereGeometry(0.055, 20, 14), eye, x, 0.04, 0.3, head);
    e.scale.set(1, 1.15, 0.35);
    return e;
  });
  const smile = mesh(new THREE.TorusGeometry(0.055, 0.013, 8, 24, Math.PI), eye, 0, -0.07, 0.3, head);
  smile.rotation.z = Math.PI;
  [-0.22, 0.22].forEach(x => {
    const ck = mesh(new THREE.SphereGeometry(0.028, 12, 8), glowMat('#ff8fb1', 0.8), x, -0.06, 0.298, head);
    ck.scale.z = 0.3;
  });
  // ear bolts
  [-1, 1].forEach(s => {
    const e = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20), body, s * 0.44, -0.02, 0, head);
    e.rotation.z = Math.PI / 2;
    const n = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), dark, s * 0.48, -0.02, 0, head);
    n.rotation.z = Math.PI / 2;
  });
  // antenna
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 16), dark, 0, 0.33, 0, head);
  mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.17, 8), dark, 0, 0.42, 0, head);
  const bulb = mesh(new THREE.SphereGeometry(0.06, 20, 14), glowMat(color, 1.1), 0, 0.53, 0, head);
  // little "signal" dashes, like the reference icon
  [[0.38, 0.4, -0.5], [0.47, 0.32, -0.9], [0.5, 0.2, -1.3]].forEach(([x, y, r]) => {
    const d = mesh(new THREE.CapsuleGeometry(0.012, 0.05, 4, 8), dark, x, y, 0.05, head);
    d.rotation.z = r;
  });

  const arm = side => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.33, 0.76, 0);
    g.add(sh);
    mesh(new THREE.SphereGeometry(0.075, 16, 12), body, 0, 0, 0, sh);
    mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 10), dark, 0, -0.18, 0, sh);
    mesh(new THREE.SphereGeometry(0.075, 16, 12), body, 0, -0.38, 0, sh);
    const hold = new THREE.Group();
    hold.position.y = -0.42;
    sh.add(hold);
    return { sh, hold };
  };
  const L = arm(-1), R = arm(1);
  return { group: g, head, eyes, bulb, chest, armL: L.sh, armR: R.sh, handL: L.hold, handR: R.hold };
}

export function idle(r, t, baseY = 0) {
  r.group.position.y = baseY + Math.sin(t * 3) * 0.015;
  const blink = (t % 3.4) < 0.12 ? 0.12 : 1.15;
  r.eyes.forEach(e => (e.scale.y = blink));
  r.bulb.material.emissiveIntensity = 0.9 + 0.6 * Math.sin(t * 4);
}