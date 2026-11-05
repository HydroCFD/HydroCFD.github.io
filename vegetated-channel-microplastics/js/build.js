// "Build a microplastic": choose the shape, size and density of a microplastic and the bed shear
// velocity of the flow; the settling velocity is estimated with standard formulas and a cloud of
// identical particles is released in the vegetated flume.
// Estimates from textbook correlations (Haider and Levenspiel, 1989; Soulsby and Whitehouse, 1997),
// not the closures of the model and not results of the paper.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, makeNoise, clamp, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, inkEdges } from './common.js?v=20261105a';
import { makeFlume, uOf, H } from './channel.js?v=20261105a';

const RHO = 998.2, NU = 1.004e-6, G = 9.81, KAPPA = 0.41;   // water at 20 degrees C
const DEPTH = 0.30, US = 0.30;                               // flume depth (m) and surface velocity (m/s)
const SC = H / DEPTH;                                        // scene units per metre
const L = 14, W = 4.2;

// ---------- shapes: volume, sphericity and the area of the broadest face ----------
const SHAPES = {
  sphere:   { label: 'sphere', dims: s => ({ d: s }), geom: s => { const d = s; return { V: Math.PI * d ** 3 / 6, A: Math.PI * d * d }; }, text: s => `diameter ${fmt(s)} mm` },
  fragment: { label: 'fragment', dims: s => ({ d: s }), geom: s => { const a = s, b = 0.7 * s, c = 0.45 * s; const V = Math.PI / 6 * a * b * c; const p = 1.6075; const A = 4 * Math.PI * (((a * b / 4) ** p + (a * c / 4) ** p + (b * c / 4) ** p) / 3) ** (1 / p); return { V, A }; }, text: s => `${fmt(s)} × ${fmt(0.7 * s)} × ${fmt(0.45 * s)} mm` },
  film:     { label: 'film', dims: s => ({ d: s }), geom: s => { const D = s, t = s / 12; return { V: Math.PI * D * D * t / 4, A: Math.PI * D * D / 2 + Math.PI * D * t }; }, text: s => `diameter ${fmt(s)} mm, thickness ${fmt(s / 12)} mm` },
  fibre:    { label: 'fibre', dims: s => ({ d: s }), geom: s => { const l = s, d = s / 15; return { V: Math.PI * d * d * l / 4, A: Math.PI * d * l + Math.PI * d * d / 2 }; }, text: s => `length ${fmt(s)} mm, diameter ${fmt(s / 15)} mm` }
};
function fmt(x) { return x >= 1 ? x.toFixed(2) : (x >= 0.1 ? x.toFixed(3) : x.toPrecision(2)); }

// ---------- terminal velocity with the correlation of Haider and Levenspiel (1989) ----------
function dragCoef(Re, phi) {
  const A = Math.exp(2.3288 - 6.4581 * phi + 2.4486 * phi * phi);
  const B = 0.0964 + 0.5565 * phi;
  const C = Math.exp(4.905 - 13.8944 * phi + 18.4222 * phi * phi - 10.2599 * phi ** 3);
  const D = Math.exp(1.4681 + 12.2584 * phi - 20.7322 * phi * phi + 15.8855 * phi ** 3);
  return 24 / Re * (1 + A * Re ** B) + C * Re / (Re + D);
}
export function settle(shape, sizeMm, rhoP) {
  const s = sizeMm / 1000;
  const { V, A } = SHAPES[shape].geom(s);
  const dv = Math.cbrt(6 * V / Math.PI);                       // diameter of the sphere of equal volume
  const phi = Math.min(1, Math.PI ** (1 / 3) * (6 * V) ** (2 / 3) / A);
  const red = Math.abs(rhoP - RHO) / RHO;
  let ws = 0, Re = 0, Cd = 0;
  if (red > 1e-6) {
    ws = G * red * dv * dv / (18 * NU);                         // Stokes estimate as the first guess
    for (let k = 0; k < 200; k++) {
      Re = Math.max(1e-6, ws * dv / NU);
      Cd = dragCoef(Re, phi);
      const wn = Math.sqrt(4 / 3 * G * red * dv / Cd);
      ws = 0.5 * ws + 0.5 * wn;
    }
    Re = ws * dv / NU; Cd = dragCoef(Re, phi);
  }
  return { ws: ws * Math.sign(rhoP - RHO), Re, Cd, phi, dv };
}
// critical shear velocity from the Shields curve of Soulsby and Whitehouse (1997)
function critical(dv, rhoP) {
  const s = rhoP / RHO;
  if (s <= 1) return NaN;
  const Dst = dv * Math.cbrt((s - 1) * G / (NU * NU));
  const th = 0.30 / (1 + 1.2 * Dst) + 0.055 * (1 - Math.exp(-0.020 * Dst));
  return Math.sqrt(th * (s - 1) * G * dv);
}

export function initBuild(root) {
  const canvas = root.querySelector('#build-gl');
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(small ? 44 : 32, 1, 0.1, 200);
  addLights(scene);
  const { surfMat } = makeFlume(scene, L, W, small);

  // ---------- controls ----------
  const st = { shape: 'fragment', size: 2.0, rho: 1300, ustar: 0.01 };
  const el = id => root.querySelector('#' + id);
  const sizeR = el('b-size'), rhoR = el('b-rho'), uR = el('b-ustar');
  const sizeOf = v => 0.1 * Math.pow(50, v / 100);                  // 0.1 to 5 mm on a log scale
  const toSize = s => 100 * Math.log(s / 0.1) / Math.log(50);
  sizeR.value = toSize(st.size); rhoR.value = st.rho; uR.value = st.ustar * 1000;
  root.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => {
    st.shape = b.dataset.shape;
    root.querySelectorAll('[data-shape]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    update(true);
  }));
  sizeR.addEventListener('input', () => { st.size = sizeOf(+sizeR.value); update(true); });
  rhoR.addEventListener('input', () => { st.rho = +rhoR.value; update(true); });
  uR.addEventListener('input', () => { st.ustar = +uR.value / 1000; update(false); });
  el('b-release').addEventListener('click', () => release());

  // ---------- particles (instanced copies of the chosen shape) ----------
  const N = small ? 60 : 110;
  const noise = makeNoise(3);
  const geoms = {
    sphere: new THREE.SphereGeometry(0.5, 18, 12),
    fragment: (() => { const g = new THREE.IcosahedronGeometry(0.5, 1); const p = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.3 * noise(v.x * 3 + 5, v.y * 3, v.z * 3); p.setXYZ(i, v.x * k, v.y * k * 0.45, v.z * k * 0.7); }
      g.computeVertexNormals(); return g; })(),
    film: new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24),
    fibre: new THREE.CylinderGeometry(0.06, 0.06, 1.2, 10).rotateZ(Math.PI / 2)
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, flatShading: true });
  let mesh = null;
  const parts = [];
  for (let i = 0; i < N; i++) parts.push({ x: 0, y: 0, z: 0, s: 0, ry: Math.random() * 6.28, rr: (Math.random() - 0.5) * 2, ph: Math.random() * 6.28 });
  function makeMesh() {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geoms[st.shape], mat, N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < N; i++) mesh.setColorAt(i, new THREE.Color(COL.ink));
    scene.add(mesh);
  }

  // specimen: one enlarged copy turning in the corner of the figure
  const specScene = new THREE.Scene();
  addLights(specScene);
  const specCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  specCam.position.set(0, 0.9, 3.2); specCam.lookAt(0, 0, 0);
  let spec = null;
  function makeSpec(color) {
    if (spec) specScene.remove(spec);
    const g = geoms[st.shape];
    spec = new THREE.Group();
    spec.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true })));
    spec.add(inkEdges(g, st.shape === 'sphere' ? 89 : 30, 0.9));
    if (st.shape === 'sphere') { const h = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide })); h.scale.setScalar(1.04); spec.add(h); }
    specScene.add(spec);
  }

  // ---------- physics of the cloud (scene units, real time) ----------
  let est = null, ucrit = NaN, wsS = 0, vis = 0.08, color = new THREE.Color(COL.ink), counts = { dep: 0, surf: 0, out: 0 }, idle = 0;
  const cBed = new THREE.Color(0x8d7046);
  function eps(y) {                                    // parabolic eddy diffusivity, scene units^2/s
    const z = clamp(y / H, 0.02, 0.98);
    return KAPPA * st.ustar * DEPTH * z * (1 - z) * SC * SC;
  }
  function release() {
    parts.forEach(p => { p.x = -L / 2 + 0.5 + Math.random() * 0.6; p.y = 0.1 + Math.random() * (H - 0.2); p.z = (Math.random() - 0.5) * (W - 0.6); p.s = 0; });
    counts = { dep: 0, surf: 0, out: 0 }; idle = 0;
  }
  function step(dt) {
    let active = 0;
    for (const p of parts) {
      if (p.s === 3) continue;                         // left the flume
      if (p.s === 1) { if (st.ustar > ucrit) { p.s = 0; p.y = 0.05; } else continue; }   // deposited
      if (p.s === 2) { p.x += uOf(H) * US * SC * dt; p.z += Math.sqrt(2 * 0.002 * dt) * gauss(); }
      else {
        const e = eps(p.y), de = (eps(p.y + 0.01) - eps(p.y - 0.01)) / 0.02;
        p.x += uOf(p.y) * US * SC * dt;
        p.y += (-wsS + de) * dt + Math.sqrt(2 * e * dt) * gauss();
        p.z += Math.sqrt(2 * 0.3 * e * dt) * gauss();
        if (p.y > H - 0.03) { if (wsS < 0 && Math.abs(est.ws) > 1e-4) { p.y = H - 0.03; p.s = 2; counts.surf++; } else p.y = 2 * (H - 0.03) - p.y; }
        if (p.y < 0.03) {
          if (wsS > 0 && st.ustar < ucrit) { p.y = 0.03; p.s = 1; counts.dep++; }
          else p.y = 0.06 - p.y;
        }
        active++;
      }
      const zl = W / 2 - 0.1;
      if (p.z > zl) p.z = 2 * zl - p.z; else if (p.z < -zl) p.z = -2 * zl - p.z;
      if (p.x > L / 2 - 0.1) { if (p.s === 0) counts.out++; p.s = 3; }
      if (p.s === 2) active++;
    }
    if (active === 0) { idle += dt; if (idle > 2.5) release(); }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  function write(t) {
    parts.forEach((p, i) => {
      const hide = p.s === 3;
      e3.set(0.25 * Math.sin(t * 1.3 + p.ph), p.ry + t * 0.3 * p.rr, 0.15 * Math.sin(t * 1.7 + p.ph));
      q.setFromEuler(e3);
      sv.setScalar(hide ? 0.0001 : vis);
      pv.set(p.x, Math.max(p.y, p.s === 1 ? vis * 0.12 : 0), p.z);
      m4.compose(pv, q, sv);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, p.s === 1 ? cBed : color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const set = (id, v) => { const x = el(id); if (x) x.textContent = v; };
    set('b-dep', counts.dep); set('b-surf', counts.surf); set('b-out', counts.out);
  }

  // ---------- read-out ----------
  function update(newCloud) {
    est = settle(st.shape, st.size, st.rho);
    ucrit = critical(est.dv, st.rho);
    wsS = est.ws * SC;
    vis = 0.1 + 0.08 * clamp(Math.log(st.size / 0.1) / Math.log(50), 0, 1);
    const neutral = Math.abs(est.ws) < 1e-4;
    color = new THREE.Color(neutral ? COL.ink : (est.ws > 0 ? COL.red : COL.cobalt));
    const P = Math.abs(est.ws) / (KAPPA * st.ustar);
    const set = (id, v) => { const x = el(id); if (x) x.innerHTML = v; };
    set('b-size-out', `${fmt(st.size)} mm`);
    set('b-rho-out', `${st.rho} kg/m<sup>3</sup>`);
    set('b-u-out', `${(st.ustar * 100).toFixed(1)} cm/s`);
    set('b-dims', SHAPES[st.shape].text(st.size));
    set('r-ws', neutral ? '0' : `${(Math.abs(est.ws) * 1000).toPrecision(3)} mm/s ${est.ws > 0 ? 'down' : 'up'}`);
    set('r-re', neutral ? '0' : est.Re.toPrecision(3));
    set('r-cd', neutral ? '&ndash;' : est.Cd.toPrecision(3));
    set('r-phi', est.phi.toFixed(2));
    set('r-p', neutral ? '0' : P.toPrecision(3));
    set('r-uc', isNaN(ucrit) ? '&ndash;' : `${(ucrit * 100).toPrecision(3)} cm/s`);
    let fate;
    if (neutral || P < 0.8) fate = 'Mixed over the whole depth and carried with the flow, like a dissolved tracer.';
    else if (est.ws < 0) fate = P < 2.5 ? 'Carried in suspension and gathered toward the free surface, where it is held.' : 'Rises quickly to the free surface and is held there.';
    else {
      const susp = P < 1.2 ? 'Carried in suspension over the depth' : (P < 2.5 ? 'Carried in suspension, concentrated toward the bed' : 'Settles quickly toward the bed');
      fate = susp + (st.ustar < ucrit ? ', and deposited when it reaches the bed, since the bed shear velocity is below its critical value.' : ', and re-entrained at the bed, since the bed shear velocity exceeds its critical value.');
    }
    set('r-fate', fate);
    makeSpec(color.getHex());
    if (newCloud) { makeMesh(); release(); }
  }
  update(true);
  for (let k = 0; k < 60; k++) step(0.05);

  // ---------- render ----------
  const specFrame = root.querySelector('.spec-frame');
  let tt = 0;
  const target = new THREE.Vector3(0, 1.3, 0);
  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    if (dt > 0) { step(Math.min(dt, 0.05)); tt += dt; }
    write(tt);
    surfMat.uniforms.uTime.value = tt;
    const w = canvas.clientWidth, h = canvas.clientHeight, asp = w / Math.max(1, h);
    const az = -0.42 + Math.sin(t * 0.06) * 0.05, el2 = 0.26;
    const tv = Math.tan(camera.fov * Math.PI / 360);
    const half = (L / 2) * Math.cos(az) + (W / 2) * Math.abs(Math.sin(az));
    const R = Math.max(half / (0.9 * tv * asp), (H + 0.6) / (1.3 * tv)) + W / 2;
    camera.position.set(Math.sin(az) * R * Math.cos(el2), target.y + R * Math.sin(el2), Math.cos(az) * R * Math.cos(el2));
    camera.lookAt(target);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    // specimen inset in the upper right corner
    if (spec) {
      spec.rotation.y = tt * 0.6; spec.rotation.x = 0.3;
      const s = Math.round(Math.min(w, h) * 0.28), x = w - s - 14, y = h - s - 14;
      if (specFrame) { specFrame.style.width = s + 'px'; specFrame.style.height = s + 'px'; }
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, s, s); renderer.setViewport(x, y, s, s);
      renderer.setClearColor(0xf7f3eb, 1); renderer.clear();
      specCam.aspect = 1; specCam.updateProjectionMatrix();
      renderer.render(specScene, specCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setClearColor(0x000000, 0);
    }
  }
  runWhenVisible(canvas, frame);
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}
