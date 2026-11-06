// Response curves at three virtual stations: a pulse of particles passes the stations, whose response
// curves build up live, for a channel without vegetation, with sparse stems or with dense stems.
// Uses the illustrative flow of this page; an illustration, not results of the paper.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, clamp, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, makePoints, makeLabels } from './common.js?v=20261106a';
import { makeFlume, uOf, dOf, H, HV, U } from './channel.js?v=20261106a';

const L = 16, W = 4.2;
const CSS = {
  ink: '#141414', ink2: '#45413b', ink3: '#7a746a', rule: '#cbc2b2', red: '#e4572e', cobalt: '#2643b8',
  ochre: '#b07d2b', olive: '#66772a', paper: '#f7f3eb'
};
const SERIF = 'Newsreader, Georgia, serif', SANS = '"Public Sans", Arial, sans-serif';

function fit2(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}
function aimCamera(camera, canvas, az, el, ty, frac) {
  const w = canvas.clientWidth, h = canvas.clientHeight, asp = w / Math.max(1, h);
  const tv = Math.tan(camera.fov * Math.PI / 360);
  const half = (L / 2) * Math.cos(az) + (W / 2) * Math.abs(Math.sin(az));
  const R = Math.max(half / (frac * tv * asp), (0.5 * (H + 0.5) + 0.5 * W * Math.sin(el)) / (0.86 * tv)) + W / 2;
  camera.position.set(Math.sin(az) * R * Math.cos(el), ty + R * Math.sin(el), Math.cos(az) * R * Math.cos(el));
  camera.lookAt(0, ty, 0);
}

// =====================================================================================
// 1. Response curves at three virtual stations
// =====================================================================================
const STATIONS = [-3.0, 1.5, 6.0];
const ST_COL = [CSS.ochre, CSS.cobalt, CSS.red];
const T_MAX = 24, BIN = 0.2, NB = Math.round(T_MAX / BIN);

export function initStations(root) {
  const canvas = root.querySelector('#st-gl'), chart = root.querySelector('#st-chart');
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  addLights(scene);
  const { surfMat, topLine } = makeFlume(scene, L, W, small, { stems: false });

  // stems: a dense staggered array, of which every second row and column is shown for sparse vegetation
  const pos = [];
  const d = 0.5;
  for (let i = 0, x = -L / 2 + 0.3; x < L / 2 - 0.2; x += d, i++)
    for (let j = 0, z = -W / 2 + 0.3 + (i % 2) * d / 2; z < W / 2 - 0.2; z += d, j++) pos.push([x, z, i, j]);
  const stemG = new THREE.CylinderGeometry(0.045, 0.05, HV, 10); stemG.translate(0, HV / 2, 0);
  const stems = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ color: COL.olive, roughness: 0.7 }), pos.length);
  scene.add(stems);
  const m4 = new THREE.Matrix4();
  function showStems(mode) {
    pos.forEach((p, k) => {
      const on = mode === 2 || (mode === 1 && p[2] % 2 === 0 && p[3] % 2 === 0);
      m4.makeScale(on ? 1 : 0.0001, on ? 1 : 0.0001, on ? 1 : 0.0001).setPosition(p[0], 0, p[1]);
      stems.setMatrixAt(k, m4);
    });
    stems.instanceMatrix.needsUpdate = true;
    topLine.visible = mode > 0;
  }

  // station planes
  STATIONS.forEach((xs, k) => {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: new THREE.Color(ST_COL[k]), transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    pl.rotation.y = Math.PI / 2; pl.position.set(xs, H / 2, 0); scene.add(pl);
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: new THREE.Color(ST_COL[k]) }));
    ed.rotation.y = Math.PI / 2; ed.position.copy(pl.position); scene.add(ed);
  });
  const place = makeLabels(canvas.parentElement, STATIONS.map((xs, k) => ({ text: `station ${k + 1}`, at: [xs, H + 0.3, -W / 2], cls: 'lb-ink', align: 'center' })));

  // flow of the three channels: profile and eddy diffusivity (scene units)
  const uOpen = y => Math.pow(clamp(y / H, 0.004, 1), 1 / 7);
  const uVeg = y => uOf(y) / uOf(H);
  const dOpen = y => { const z = clamp(y / H, 0.02, 0.98); return 0.22 * z * (1 - z); };
  const flows = [
    { u: uOpen, D: dOpen },
    { u: y => 0.5 * uOpen(y) + 0.5 * uVeg(y), D: y => 0.5 * dOpen(y) + 0.5 * dOf(y) },
    { u: uVeg, D: dOf }
  ];
  let mode = 2, flow = flows[mode];

  // particles
  const N = small ? 900 : 1600;
  const P = [];
  for (let i = 0; i < N; i++) P.push({ x: 0, y: 0, z: 0, k: 0 });
  const pts = makePoints(N, scene);
  const ink = new THREE.Color(COL.ink);
  let hist = STATIONS.map(() => new Float32Array(NB)), ghost = null, ghostMode = -1, t = 0, done = false, wait = 0, full = null;
  function release() {
    P.forEach(p => { p.x = -L / 2 + 0.4 + Math.random() * 0.25; p.y = 0.05 + Math.random() * (H - 0.1); p.z = (Math.random() - 0.5) * (W - 0.4); p.k = 0; });
    t = 0; done = false; wait = 0;
    hist = STATIONS.map(() => new Float32Array(NB));
  }
  function step(dt) {
    t += dt;
    let alive = 0;
    for (const p of P) {
      if (p.k >= STATIONS.length) continue;
      const D = flow.D(p.y), dD = (flow.D(p.y + 0.01) - flow.D(p.y - 0.01)) / 0.02;
      p.x += flow.u(p.y) * U * 0.9 * dt;
      p.y += dD * dt + Math.sqrt(2 * D * dt) * gauss();
      p.z += Math.sqrt(2 * 0.006 * dt) * gauss();
      if (p.y < 0.03) p.y = 0.06 - p.y; if (p.y > H - 0.03) p.y = 2 * (H - 0.03) - p.y;
      const zl = W / 2 - 0.1; if (p.z > zl) p.z = 2 * zl - p.z; else if (p.z < -zl) p.z = -2 * zl - p.z;
      while (p.k < STATIONS.length && p.x >= STATIONS[p.k]) {
        const b = Math.floor(t / BIN);
        if (b < NB) hist[p.k][b] += 1;
        p.k++;
      }
      if (p.k < STATIONS.length) alive++;
    }
    if (!alive || t > T_MAX) { if (!done) { done = true; full = hist; } wait += dt; if (wait > 2.5) release(); }   // the dashed curves keep the last run with a different channel
  }
  function write() {
    P.forEach((p, i) => {
      const hide = p.k >= STATIONS.length;
      pts.P.set([p.x, p.y, p.z], 3 * i); pts.C.set([ink.r, ink.g, ink.b], 3 * i); pts.S[i] = hide ? 0 : 0.1;
    });
    pts.update();
  }

  // chart of the response curves
  const smooth = h => { const o = new Float32Array(NB); for (let i = 0; i < NB; i++) { let s = 0, w = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j < 0 || j >= NB) continue; const g = Math.exp(-k * k / 4.5); s += h[j] * g; w += g; } o[i] = s / w; } return o; };
  const NAMES = ['no vegetation', 'sparse stems', 'dense stems'];
  function drawChart() {
    const { c, w, h } = fit2(chart);
    const narrow = w < 600;
    const Lm = 48, Rm = 16, Tm = narrow ? 50 : 30, Bm = 40;
    const X = s => Lm + (w - Lm - Rm) * s / T_MAX, Y = v => h - Bm - (h - Tm - Bm) * v;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = CSS.ink; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(Lm, Tm - 6); c.lineTo(Lm, h - Bm); c.lineTo(w - Rm, h - Bm); c.stroke();
    c.fillStyle = CSS.ink2; c.font = `12px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'top';
    for (let s = 0; s <= T_MAX; s += 4) { c.fillText(String(s), X(s), h - Bm + 7); c.beginPath(); c.moveTo(X(s), h - Bm); c.lineTo(X(s), h - Bm + 4); c.stroke(); }
    c.font = `italic 15px ${SERIF}`; c.fillStyle = CSS.ink;
    c.fillText('Time after release (s, illustrative)', (Lm + w - Rm) / 2, h - Bm + 21);
    c.save(); c.translate(15, (Tm + h - Bm) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText('Particles crossing', 0, 0); c.restore();
    const curves = (H2, dashed) => {
      const S = H2.map(smooth);
      let mx = 1e-9; S.forEach(a => a.forEach(v => { if (v > mx) mx = v; }));
      return { S, mx, dashed };
    };
    const now = curves(hist, false);
    const old = ghost ? curves(ghost, true) : null;
    const mx = Math.max(now.mx, old ? old.mx : 0);
    [old, now].forEach(set => {
      if (!set) return;
      set.S.forEach((a, k) => {
        c.strokeStyle = ST_COL[k]; c.lineWidth = set.dashed ? 1.2 : 2.2; c.globalAlpha = set.dashed ? 0.55 : 1;
        c.setLineDash(set.dashed ? [5, 4] : []);
        c.beginPath();
        for (let i = 0; i < NB; i++) { const x = X((i + 0.5) * BIN), y = Y(0.92 * a[i] / mx); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      });
    });
    c.setLineDash([]); c.globalAlpha = 1;
    // legend
    c.font = `13px ${SANS}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    let lx = Lm + 12;
    const ly = narrow ? Tm - 34 : Tm - 12;
    STATIONS.forEach((_, k) => { c.strokeStyle = ST_COL[k]; c.lineWidth = 2.2; c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + 18, ly); c.stroke(); c.fillStyle = CSS.ink2; c.fillText(`station ${k + 1}`, lx + 24, ly); lx += 24 + c.measureText(`station ${k + 1}`).width + 18; });
    c.fillStyle = CSS.ink3; c.textAlign = narrow ? 'left' : 'right';
    c.fillText(old ? `solid: ${NAMES[mode]}   dashed: previous run, ${NAMES[ghostMode]}` : `solid: ${NAMES[mode]}`, narrow ? Lm + 12 : w - Rm, narrow ? Tm - 12 : Tm - 12);
  }

  // controls
  root.querySelectorAll('[data-veg]').forEach(b => b.addEventListener('click', () => {
    const m = +b.dataset.veg;
    root.querySelectorAll('[data-veg]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (m === mode) return;
    if (done || t > 6) { ghost = hist; ghostMode = mode; } else if (full) { ghost = full; ghostMode = mode; }
    full = null;
    mode = m; flow = flows[m]; showStems(m); release();
  }));
  root.querySelector('#st-release').addEventListener('click', () => release());

  showStems(mode); release();
  for (let k = 0; k < 40; k++) step(0.05);
  write();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawChart);

  let tt = 0;
  function frame(dt, tm) {
    fitGL(renderer, camera, canvas);
    if (dt > 0) { step(Math.min(dt, 0.05)); write(); tt += dt; }
    surfMat.uniforms.uTime.value = tt;
    aimCamera(camera, canvas, -0.42 + Math.sin(tm * 0.06) * 0.04, 0.24, 1.4, 0.93);
    renderer.render(scene, camera);
    place(camera, canvas);
    drawChart();
  }
  runWhenVisible(canvas, frame);
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}
