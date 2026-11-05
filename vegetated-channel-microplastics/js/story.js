// "The journey of one microplastic": a scroll-driven camera follows one particle through the
// vegetated flume, past the overflow layer, the shear layer, the stems, a virtual station and the bed.
// The path is drawn by hand to show the processes; it is an illustration, not model output.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, clamp, smooth, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, makePoints, makeLabels } from './common.js?v=20261105a';
import { makeFlume, uOf, H, HV, U } from './channel.js?v=20261105a';

const L = 16, W = 4.2, XS = 4.0;                 // flume length and width, station position

// path of the particle (scene units), from the release to the bed
const KEYS = [
  [-7.2, 2.55, 0.0], [-4.6, 2.35, 0.25], [-2.3, 2.0, 0.0], [-0.7, 1.38, -0.2], [0.8, 0.95, 0.12],
  [2.4, 0.72, -0.12], [3.8, 0.55, 0.1], [5.4, 0.3, 0.05], [6.55, 0.075, 0.12]
];
// curve parameter reached at the centre of each step of the story
const UK = [0.015, 0.2, 0.4, 0.6, 0.77, 1.0];
// camera offset from the particle and look-ahead for each step
const CAM = [
  { off: [2.0, 3.4, 11.0], look: [2.5, -0.8, 0] },
  { off: [-2.8, 0.9, 3.7], look: [1.0, -0.1, 0] },
  { off: [-1.4, 0.2, 3.1], look: [1.0, -0.05, 0] },
  { off: [-2.1, 1.25, 1.6], look: [1.3, -0.45, 0] },
  { off: [-1.2, 1.9, 4.2], look: [0.9, -0.1, 0] },
  { off: [-0.7, 2.3, 1.0], look: [0.25, -0.6, 0] }
];
const LAYERS = ['free surface', 'overflow layer', 'shear layer', 'within the stems', 'within the stems', 'at the bed'];

export function initStory(canvas, stepsEl) {
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(small ? 50 : 40, 1, 0.05, 200);
  addLights(scene);
  const { surfMat } = makeFlume(scene, L, W, small);

  // ---------- path and trail ----------
  const curve = new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k)), false, 'centripetal');
  const NT = 600;
  const wig = u => new THREE.Vector3(0, 0.05 * Math.sin(u * 70) * (1 - u * 0.6), 0.06 * Math.sin(u * 43 + 1.3));
  const pathPts = [];
  for (let i = 0; i <= NT; i++) { const u = i / NT; pathPts.push(curve.getPointAt(u).add(wig(u))); }
  const trailG = new THREE.BufferGeometry().setFromPoints(pathPts);
  const trail = new THREE.Line(trailG, new THREE.LineBasicMaterial({ color: COL.red, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  scene.add(trail);
  const ahead = new THREE.Line(trailG.clone(), new THREE.LineDashedMaterial({ color: COL.ink3, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.35 }));
  ahead.computeLineDistances(); ahead.frustumCulled = false;
  scene.add(ahead);

  // ---------- the microplastic ----------
  const pg = new THREE.SphereGeometry(0.075, 28, 18);
  const pMat = new THREE.MeshStandardMaterial({ color: COL.red, roughness: 0.4 });
  const particle = new THREE.Mesh(pg, pMat);
  const hull = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide }));
  hull.scale.setScalar(1.12);
  particle.add(hull);
  scene.add(particle);

  // ---------- shear layer eddies ----------
  const eddies = new THREE.Group();
  const eddyMat = new THREE.LineBasicMaterial({ color: COL.cobalt, transparent: true, opacity: 0 });
  for (let k = 0; k < 9; k++) {
    const pts = [];
    for (let j = 0; j <= 48; j++) {
      const a = j / 48 * Math.PI * 1.75;
      const r = 0.34 * (1 - 0.25 * j / 48);
      pts.push(new THREE.Vector3(r * Math.cos(a) * 1.4, r * Math.sin(a), 0));
    }
    const e = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), eddyMat);
    e.position.set(-6.5 + k * 1.6, HV + 0.05, ((k % 3) - 1) * 1.1);
    e.userData.spin = 1.4 + 0.3 * (k % 2);
    eddies.add(e);
  }
  scene.add(eddies);

  // ---------- virtual station ----------
  const stMat = new THREE.MeshBasicMaterial({ color: COL.red, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const station = new THREE.Mesh(new THREE.PlaneGeometry(W, H), stMat);
  station.rotation.y = Math.PI / 2;
  station.position.set(XS, H / 2, 0);
  scene.add(station);
  const stEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: COL.red, transparent: true, opacity: 0.6 }));
  stEdge.rotation.y = Math.PI / 2; stEdge.position.copy(station.position);
  scene.add(stEdge);

  // ---------- other microplastics carried by the flow ----------
  const N = small ? 260 : 520;
  const bg = [];
  for (let i = 0; i < N; i++) bg.push({ x: -L / 2 + Math.random() * L, y: 0.05 + Math.random() * (H - 0.1), z: (Math.random() - 0.5) * (W - 0.2), r: 0.05 + Math.random() * 0.04 });
  const pts = makePoints(N, scene);
  const ink = new THREE.Color(COL.ink);
  function stepBg(dt) {
    for (const p of bg) {
      p.x += uOf(p.y) * U * 0.55 * dt;
      p.y += (Math.random() - 0.5) * 0.06 * Math.sqrt(dt * 60) * (Math.abs(p.y - HV) < 0.4 ? 1.6 : 0.6);
      p.y = clamp(p.y, 0.05, H - 0.05);
      if (p.x > L / 2) { p.x = -L / 2; p.y = 0.05 + Math.random() * (H - 0.1); }
    }
    bg.forEach((p, i) => { pts.P.set([p.x, p.y, p.z], 3 * i); pts.C.set([ink.r, ink.g, ink.b], 3 * i); pts.S[i] = p.r; });
    pts.update();
  }
  stepBg(0);

  // ---------- labels pinned to the scene ----------
  const pos = new THREE.Vector3();
  const place = makeLabels(canvas.parentElement, [
    { text: 'the microplastic', at: () => pos.clone().add(new THREE.Vector3(0, 0.22, 0)), cls: 'lb-red', align: 'center' },
    { text: 'virtual station', at: [XS, 2.3, -1.2], cls: 'lb-red', align: 'center' }
  ]);
  const tag = canvas.parentElement.querySelectorAll('.scene-label');

  // ---------- scroll position through the steps ----------
  const steps = [...stepsEl.querySelectorAll('.step')];
  const dots = [...document.querySelectorAll('#story-dots li')];
  const hud = { layer: document.getElementById('hud-layer'), z: document.getElementById('hud-z'), u: document.getElementById('hud-u'), bar: document.getElementById('hud-ubar'), state: document.getElementById('hud-state') };
  let P = 0;
  function readScroll() {
    const mid = window.innerHeight * (small ? 0.72 : 0.5);
    const c = steps.map(s => { const r = s.getBoundingClientRect(); return r.top + r.height / 2; });
    const n = c.length;
    let p;
    if (mid <= c[0]) p = -(c[0] - mid) / (c[1] - c[0]);
    else if (mid >= c[n - 1]) p = n - 1 + (mid - c[n - 1]) / (c[n - 1] - c[n - 2]);
    else for (let i = 0; i < n - 1; i++) if (mid >= c[i] && mid < c[i + 1]) { p = i + (mid - c[i]) / (c[i + 1] - c[i]); break; }
    P = clamp(p, 0, n - 1);
    const on = Math.round(P);
    steps.forEach((s, i) => s.classList.toggle('on', i === on));
    dots.forEach((d, i) => d.classList.toggle('on', i === on));
  }
  let ticking = false;
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; readScroll(); }); } }, { passive: true });
  window.addEventListener('resize', readScroll);
  readScroll();

  // smoothed scroll position, so the camera glides between steps
  let Ps = P, tt = 0;
  const bump = (x, c) => Math.max(0, 1 - Math.abs(x - c));
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const red = new THREE.Color(COL.red), bed = new THREE.Color(0x8d7046);

  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    tt += dt;
    Ps += (P - Ps) * Math.min(1, (dt > 0 ? dt : 0.016) * 4);
    const i0 = Math.floor(Ps), i1 = Math.min(UK.length - 1, i0 + 1), f = smooth(0, 1, Ps - i0);
    const u = UK[i0] + (UK[i1] - UK[i0]) * (Ps - i0);
    const idx = Math.round(clamp(u, 0, 1) * NT);
    pos.copy(pathPts[idx]);
    particle.position.copy(pos);
    trailG.setDrawRange(0, idx + 1);
    ahead.geometry.setDrawRange(idx, NT - idx + 1);

    // what the particle sees
    const dep = smooth(4.55, 4.95, Ps);
    pMat.color.copy(red).lerp(bed, dep);
    eddyMat.opacity = 0.75 * bump(Ps, 2);
    eddies.children.forEach(e => { e.rotation.z -= e.userData.spin * dt; });
    const sOn = bump(Ps, 4);
    stMat.opacity = 0.06 + 0.22 * sOn;
    stEdge.material.opacity = 0.35 + 0.6 * sOn;
    if (tag[1]) tag[1].style.opacity = String(0.25 + 0.75 * sOn);
    if (tag[0]) tag[0].textContent = dep > 0.5 ? 'deposited, u* < u*c' : 'the microplastic';

    // camera: blend the offsets of the two neighbouring steps
    const a = CAM[i0], b = CAM[i1];
    tmpA.set(...a.off).lerp(tmpB.set(...b.off), f);
    camPos.copy(pos).add(tmpA);
    camPos.x += Math.sin(t * 0.2) * 0.08; camPos.y += Math.sin(t * 0.27) * 0.05;
    tmpA.set(...a.look).lerp(tmpB.set(...b.look), f);
    camLook.copy(pos).add(tmpA);
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    if (dt > 0) stepBg(dt);
    surfMat.uniforms.uTime.value = tt;
    renderer.render(scene, camera);
    place(camera, canvas);

    // read-out
    const z = pos.y / H, uu = uOf(pos.y) / uOf(H);
    if (hud.layer) hud.layer.textContent = LAYERS[Math.round(Ps)];
    if (hud.z) hud.z.textContent = z.toFixed(2);
    if (hud.u) hud.u.textContent = uu.toFixed(2);
    if (hud.bar) hud.bar.style.width = (100 * clamp(uu, 0, 1)).toFixed(0) + '%';
    if (hud.state) hud.state.textContent = dep > 0.5 ? 'deposited' : (Ps > 4.0 ? 'settling' : 'in suspension');
  }
  runWhenVisible(canvas, frame);
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}
