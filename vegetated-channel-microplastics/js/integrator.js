// Exponential drag integrator, illustrated: a particle released from rest relaxes to the fluid
// velocity u with relaxation time tau, dv/dt = (u - v) / tau. The exponential update is exact for this
// linearized drag; forward Euler and Heun (second-order Runge-Kutta) are explicit updates.
// Everything here is mathematics of the model problem, not output of the solver.
import { runWhenVisible, fit2d, motion } from '../../js/3d/loop.js';

const C = {
  ink: '#141414', ink2: '#45413b', ink3: '#7a746a', rule: '#cbc2b2', paper: '#f2ede3', paper3: '#f7f3eb',
  red: '#e4572e', cobalt: '#2643b8', ochre: '#b07d2b', water: '#dfe5f3'
};
const SERIF = 'Newsreader, Georgia, serif', SANS = '"Public Sans", Arial, sans-serif';
const TMAX = 12;                                        // in relaxation times

// amplification factor of one step for v' = 1 - v (u = 1, tau = 1)
const G = { euler: h => 1 - h, heun: h => 1 - h + h * h / 2, exp: h => Math.exp(-h) };
const vAt = (g, n) => 1 - Math.pow(g, n);
function maxErr(method, h) {
  if (method === 'exp') return 0;
  const g = G[method](h);
  let e = 0;
  for (let n = 1; n * h <= TMAX + 1e-9; n++) e = Math.max(e, Math.abs(vAt(g, n) - (1 - Math.exp(-n * h))));
  return e;
}
// largest step that keeps the error below tol (the error grows with the step)
function stepFor(method, tol) {
  let lo = 1e-4, hi = 2;
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi); if (maxErr(method, m) < tol) lo = m; else hi = m; }
  return lo;
}
const H1 = { euler: stepFor('euler', 0.01), heun: stepFor('heun', 0.01) };

function arrow(c, x0, y0, x1, y1, col, w = 1.4) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = w;
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 7 * Math.cos(a - 0.45), y1 - 7 * Math.sin(a - 0.45)); c.lineTo(x1 - 7 * Math.cos(a + 0.45), y1 - 7 * Math.sin(a + 0.45)); c.closePath(); c.fill();
}
function marker(c, kind, x, y, r, col) {
  c.fillStyle = col; c.strokeStyle = C.paper3; c.lineWidth = 1.2;
  c.beginPath();
  if (kind === 'square') c.rect(x - r, y - r, 2 * r, 2 * r);
  else if (kind === 'diamond') { c.moveTo(x, y - r * 1.3); c.lineTo(x + r * 1.3, y); c.lineTo(x, y + r * 1.3); c.lineTo(x - r * 1.3, y); c.closePath(); }
  else c.arc(x, y, r, 0, Math.PI * 2);
  c.fill(); c.stroke();
}
const fmtPct = e => e < 1e-4 ? '< 0.01 %' : (e < 0.1 ? (100 * e).toPrecision(2) + ' %' : (e < 10 ? (100 * e).toFixed(0) + ' %' : 'unbounded'));

export function initIntegrator(root) {
  const range = root.querySelector('#dt-range'), out = root.querySelector('#dt-out'), status = root.querySelector('#dt-status');
  const cvV = root.querySelector('#integ-cv'), cvE = root.querySelector('#err-cv'), cvR = root.querySelector('#race-cv');
  const ctxV = cvV.getContext('2d'), ctxE = cvE.getContext('2d'), ctxR = cvR.getContext('2d');
  const stat = id => root.querySelector('#' + id);
  const show = { euler: true, heun: true };
  root.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.method; show[m] = !show[m]; b.setAttribute('aria-pressed', String(show[m])); drawAll();
  }));
  const dtOf = () => 0.05 * Math.pow(100, range.value / 100);     // 0.05 to 5 relaxation times

  // ---------------- velocity relaxation ----------------
  function drawVelocity(h) {
    const { w, h: H } = fit2d(cvV, ctxV), c = ctxV;
    const L = 56, R = 18, T = 18, B = 46, YMIN = -0.6, YMAX = 2.2, XMAX = TMAX + 0.6;
    const X = t => L + (w - L - R) * t / XMAX, Y = v => T + (H - T - B) * (YMAX - v) / (YMAX - YMIN);
    c.clearRect(0, 0, w, H);
    c.strokeStyle = C.rule; c.lineWidth = 1;
    [0, 1, 2].forEach(v => { c.beginPath(); c.moveTo(L, Y(v) + 0.5); c.lineTo(w - R, Y(v) + 0.5); c.stroke(); });
    c.strokeStyle = C.ink; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(L, T); c.lineTo(L, H - B); c.lineTo(w - R, H - B); c.stroke();
    c.fillStyle = C.ink2; c.font = `12px ${SANS}`; c.textAlign = 'right'; c.textBaseline = 'middle';
    [0, 1, 2].forEach(v => c.fillText(String(v), L - 8, Y(v)));
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let k = 0; k <= TMAX; k += 2) c.fillText(String(k), X(k), H - B + 8);
    c.font = `italic 15px ${SERIF}`; c.fillStyle = C.ink;
    c.fillText('Time / relaxation time, t / τ', (L + w - R) / 2, H - B + 24);
    c.save(); c.translate(16, (T + H - B) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText('Particle velocity / fluid velocity, v / u', 0, 0); c.restore();
    c.save(); c.beginPath(); c.rect(L, T, w - L - R, H - T - B); c.clip();
    // exact solution
    c.strokeStyle = C.cobalt; c.lineWidth = 2.2; c.beginPath();
    for (let i = 0; i <= 400; i++) { const t = TMAX * i / 400, v = 1 - Math.exp(-t); i ? c.lineTo(X(t), Y(v)) : c.moveTo(X(t), Y(v)); }
    c.stroke();
    const every = Math.max(1, Math.ceil(13 / (X(h) - X(0))));
    // explicit updates: dashed polylines with markers
    [['euler', C.red, 'circle'], ['heun', C.ochre, 'square']].forEach(([m, col, kind]) => {
      if (!show[m]) return;
      const g = G[m](h), pts = [];
      for (let n = 0; n * h <= TMAX + 1e-9; n++) { const v = vAt(g, n); pts.push([n * h, v]); if (Math.abs(v) > 60) break; }
      c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath();
      pts.forEach((q, i) => { const yy = Y(Math.max(YMIN - 2, Math.min(YMAX + 2, q[1]))); i ? c.lineTo(X(q[0]), yy) : c.moveTo(X(q[0]), yy); });
      c.stroke(); c.setLineDash([]);
      pts.forEach((q, i) => { if (i % every === 0 && q[1] >= YMIN && q[1] <= YMAX) marker(c, kind, X(q[0]), Y(q[1]), 3.6, col); });
    });
    // exponential update
    for (let n = 0; n * h <= TMAX + 1e-9; n += every) marker(c, 'circle', X(n * h), Y(1 - Math.exp(-n * h)), 4.8, C.cobalt);
    c.restore();
  }

  // ---------------- error against the time step ----------------
  const HS = []; for (let i = 0; i <= 160; i++) HS.push(0.05 * Math.pow(100, i / 160));
  const ERR = { euler: HS.map(h => maxErr('euler', h)), heun: HS.map(h => maxErr('heun', h)) };
  function drawError(h) {
    const { w, h: H } = fit2d(cvE, ctxE), c = ctxE;
    const L = 58, R = 16, T = 18, B = 46;
    const lx = v => Math.log10(v), X = v => L + (w - L - R) * (lx(v) - lx(0.05)) / (lx(5) - lx(0.05));
    const Y = e => { const y = clamp01((lx(Math.max(e, 1e-5)) - (-5)) / (1 - (-5))); return H - B - (H - T - B) * y; };
    c.clearRect(0, 0, w, H);
    // unstable region of the explicit updates
    c.fillStyle = 'rgba(228,87,46,0.08)'; c.fillRect(X(2), T, w - R - X(2), H - T - B);
    c.fillStyle = C.red; c.font = `italic 13px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('explicit', (X(2) + w - R) / 2, T + (H - T - B) * 0.62); c.fillText('unstable', (X(2) + w - R) / 2, T + (H - T - B) * 0.62 + 16);
    c.strokeStyle = C.rule; c.lineWidth = 1;
    [-4, -2, 0].forEach(p => { c.beginPath(); c.moveTo(L, Y(10 ** p) + 0.5); c.lineTo(w - R, Y(10 ** p) + 0.5); c.stroke(); });
    c.setLineDash([5, 4]); c.strokeStyle = C.ink3; c.beginPath(); c.moveTo(L, Y(0.01)); c.lineTo(w - R, Y(0.01)); c.stroke(); c.setLineDash([]);
    c.fillStyle = C.ink3; c.font = `12px ${SANS}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('1 %', L + 6, Y(0.01) - 3);
    c.strokeStyle = C.ink; c.lineWidth = 1.2; c.beginPath(); c.moveTo(L, T); c.lineTo(L, H - B); c.lineTo(w - R, H - B); c.stroke();
    c.fillStyle = C.ink2; c.font = `12px ${SANS}`; c.textAlign = 'right'; c.textBaseline = 'middle';
    [[-4, '10⁻⁴'], [-2, '10⁻²'], [0, '1']].forEach(([p, s]) => c.fillText(s, L - 8, Y(10 ** p)));
    c.textAlign = 'center'; c.textBaseline = 'top';
    [0.1, 0.5, 1, 2, 5].forEach(v => c.fillText(String(v), X(v), H - B + 8));
    c.font = `italic 15px ${SERIF}`; c.fillStyle = C.ink;
    c.fillText('Time step, Δt / τ', (L + w - R) / 2, H - B + 24);
    c.save(); c.translate(16, (T + H - B) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText('Largest error in v / u', 0, 0); c.restore();
    c.save(); c.beginPath(); c.rect(L, T, w - L - R, H - T - B); c.clip();
    [['euler', C.red], ['heun', C.ochre]].forEach(([m, col]) => {
      if (!show[m]) return;
      c.strokeStyle = col; c.lineWidth = 2.2; c.beginPath();
      HS.forEach((hh, i) => { const x = X(hh), y = Y(ERR[m][i]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    });
    // exponential: exact for the linearized drag, drawn at the floor of the axis
    c.strokeStyle = C.cobalt; c.lineWidth = 2.6; c.beginPath(); c.moveTo(X(0.05), Y(1e-5) - 2); c.lineTo(X(5), Y(1e-5) - 2); c.stroke();
    c.fillStyle = C.cobalt; c.font = `italic 13px ${SERIF}`; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillText(w < 520 ? 'exponential: exact' : 'exponential update: exact for the linearized drag', X(0.06), Y(1e-5) - 7);
    // current time step
    c.strokeStyle = C.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(X(h), T); c.lineTo(X(h), H - B); c.stroke();
    if (show.euler) marker(c, 'circle', X(h), Y(maxErr('euler', h)), 4.5, C.red);
    if (show.heun) marker(c, 'square', X(h), Y(maxErr('heun', h)), 4, C.ochre);
    marker(c, 'circle', X(h), Y(1e-5) - 2, 5, C.cobalt);
    c.restore();
  }
  const clamp01 = x => Math.max(0, Math.min(1, x));

  // ---------------- velocity at each step, animated ----------------
  // Each lane shows the particle velocity v/u after each step of the chosen size, with a fading trail of
  // the earlier steps; the hollow circle is the exact velocity at the same time.
  const lanes = [
    { m: 'exp', name: 'exponential update', col: C.cobalt, kind: 'circle' },
    { m: 'euler', name: 'forward Euler', col: C.red, kind: 'circle' },
    { m: 'heun', name: 'Heun', col: C.ochre, kind: 'square' }
  ];
  let simT = 0;
  function drawRace(h) {
    const { w, h: H } = fit2d(cvR, ctxR), c = ctxR;
    const narrow = w < 520, L = narrow ? 112 : 150, R = narrow ? 14 : 26, top = 22, bot = 26, laneH = (H - top - bot) / 3, VMIN = -0.6, VMAX = 2.6;
    const X = v => L + (w - L - R) * (v - VMIN) / (VMAX - VMIN);
    c.clearRect(0, 0, w, H);
    // axis of velocity
    c.strokeStyle = C.rule; c.lineWidth = 1;
    [0, 1, 2].forEach(v => { c.beginPath(); c.moveTo(X(v), top); c.lineTo(X(v), H - bot); c.stroke(); });
    c.strokeStyle = C.cobalt; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(X(1), top); c.lineTo(X(1), H - bot); c.stroke(); c.setLineDash([]);
    c.fillStyle = C.ink2; c.font = `12px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'top';
    [0, 1, 2].forEach(v => c.fillText(String(v), X(v), H - bot + 4));
    c.font = `italic 13px ${SERIF}`; c.fillStyle = C.cobalt; c.textAlign = 'left';
    c.fillText('v = u', X(1) + 6, H - bot + 4);
    c.fillStyle = C.ink3; c.font = `12px ${SANS}`; c.textAlign = 'right';
    c.textBaseline = 'top'; c.fillText('v / u after each step  ·  ○ exact value', w - R, 5);
    const n = Math.floor(simT / h + 1e-9);
    lanes.forEach((ln, i) => {
      const yc = top + laneH * (i + 0.5);
      if (ln.m !== 'exp' && !show[ln.m]) c.globalAlpha = 0.25;
      c.fillStyle = C.ink; c.font = `italic ${narrow ? 13 : 15}px ${SERIF}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(narrow && ln.m === 'exp' ? 'exponential' : ln.name, 10, yc);
      const g = G[ln.m](h);
      // fading trail of the earlier steps
      const k0 = Math.max(0, n - 8);
      for (let k = k0; k < n; k++) {
        const v = vAt(g, k);
        if (v < VMIN || v > VMAX) continue;
        c.globalAlpha = (ln.m !== 'exp' && !show[ln.m] ? 0.25 : 1) * (0.12 + 0.5 * (k - k0 + 1) / (n - k0 + 1));
        marker(c, ln.kind, X(v), yc, 4, ln.col);
      }
      c.globalAlpha = ln.m !== 'exp' && !show[ln.m] ? 0.25 : 1;
      const ve = 1 - Math.exp(-n * h);
      c.strokeStyle = C.ink2; c.lineWidth = 1.3; c.beginPath(); c.arc(X(ve), yc, 8, 0, Math.PI * 2); c.stroke();
      const v = vAt(g, n);
      const out = !isFinite(v) || v < VMIN || v > VMAX;
      marker(c, ln.kind, X(Math.max(VMIN, Math.min(VMAX, v))), yc, 6, ln.col);
      if (out) { c.fillStyle = C.red; c.font = `600 11px ${SANS}`; c.textAlign = 'right'; c.fillText('UNSTABLE', w - R - 2, yc - 13); }
      c.globalAlpha = 1;
    });
    c.fillStyle = C.ink3; c.font = `12px ${SANS}`; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`step ${n}, t = ${(n * h).toFixed(1)} τ`, 14, H - bot + 4);
  }

  // ---------------- read-out ----------------
  function drawAll() {
    const h = dtOf();
    out.textContent = 'Δt = ' + (h < 1 ? h.toFixed(2) : h.toFixed(1)) + ' τ';
    status.textContent = h < 1 ? 'explicit updates follow the solution' : (h < 2 ? 'explicit updates oscillate' : 'explicit updates are unstable');
    drawVelocity(h); drawError(h); drawRace(h);
    const eE = maxErr('euler', h), eH = maxErr('heun', h);
    stat('s-steps').textContent = (1 / h < 10 ? (1 / h).toFixed(2) : (1 / h).toFixed(0));
    stat('s-euler').textContent = h >= 2 ? 'unbounded' : fmtPct(eE);
    stat('s-heun').textContent = h >= 2 ? 'unbounded' : fmtPct(eH);
    const r = h / H1.euler, rh = h / H1.heun;
    stat('s-ratio').textContent = r <= 1 ? 'same step' : `${r < 10 ? r.toFixed(1) : r.toFixed(0)} × and ${rh <= 1 ? '1' : (rh < 10 ? rh.toFixed(1) : rh.toFixed(0))} ×`;
  }
  range.addEventListener('input', () => { simT = 0; drawAll(); });
  window.addEventListener('resize', drawAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
  drawAll();
  root.querySelector('#s-h1').textContent = `Δt ≤ ${H1.euler.toFixed(3)} τ and ${H1.heun.toFixed(2)} τ`;

  runWhenVisible(cvR, dt => {
    if (dt <= 0) return;
    simT += dt * 1.6;
    if (simT > TMAX + 3) simT = 0;
    drawRace(dtOf());
  });
  motion.listeners.push(() => drawRace(dtOf()));
}
