// Microplastics in vegetated channels: page wiring, motion toggle, integrator illustration and 3D figures.
// The figures are illustrations of the processes, not model output.
import { motion, setPaused } from '../js/3d/loop.js';

(function () {
  'use strict';

  var C = {
    paper: '#f2ede3', paper3: '#f7f3eb', ink: '#141414', ink2: '#45413b', ink3: '#7a746a',
    rule: '#cbc2b2', red: '#e4572e', cobalt: '#2643b8', olive: '#66772a', bed: '#a88b5a',
    bedFill: '#cdb68f', water: '#dfe5f3'
  };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  // ------------------------------------------------------------ integrator
  var cv = document.getElementById('integ-cv');
  var range = document.getElementById('dt-range');
  var out = document.getElementById('dt-out');
  if (cv && range) {
    var TMAX = 12, XMAX = 12.6, YMIN = -0.6, YMAX = 2.2;
    var dtOf = function () { return 0.1 * Math.pow(40, range.value / 100); };   // 0.1 to 4 relaxation times

    var plot = function () {
      var f = fit(cv), c = f.ctx, w = f.w, h = f.h;
      var L = w < 600 ? 44 : 64, R = 20, T = 22, B = 46;
      var X = function (t) { return L + (w - L - R) * t / XMAX; };
      var Y = function (v) { return T + (h - T - B) * (YMAX - v) / (YMAX - YMIN); };
      c.clearRect(0, 0, w, h);

      // axes and guides
      c.strokeStyle = C.rule; c.lineWidth = 1;
      [0, 1, 2].forEach(function (v) { c.beginPath(); c.moveTo(L, Y(v) + 0.5); c.lineTo(w - R, Y(v) + 0.5); c.stroke(); });
      c.strokeStyle = C.ink; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(L, T); c.lineTo(L, h - B); c.lineTo(w - R, h - B); c.stroke();
      c.fillStyle = C.ink2; c.font = '12px "Public Sans", sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
      [0, 1, 2].forEach(function (v) { c.fillText(String(v), L - 8, Y(v)); });
      c.textAlign = 'center'; c.textBaseline = 'top';
      for (var k = 0; k <= TMAX; k += 2) c.fillText(String(k), X(k), h - B + 8);
      c.font = 'italic 15px Newsreader, serif'; c.fillStyle = C.ink;
      c.fillText('Time / relaxation time', (L + w - R) / 2, h - B + 24);
      c.save(); c.translate(14, (T + h - B) / 2); c.rotate(-Math.PI / 2);
      c.textBaseline = 'middle'; c.fillText(w < 600 ? 'v / u' : 'Particle velocity / fluid velocity', 0, 0); c.restore();

      c.save(); c.beginPath(); c.rect(L, T, w - L - R, h - T - B); c.clip();
      // exact relaxation of a particle released from rest: v = u (1 - exp(-t/tau))
      c.strokeStyle = C.cobalt; c.lineWidth = 2; c.beginPath();
      for (var i = 0; i <= 300; i++) { var t = TMAX * i / 300, v = 1 - Math.exp(-t); i ? c.lineTo(X(t), Y(v)) : c.moveTo(X(t), Y(v)); }
      c.stroke();

      var dt = dtOf();
      var every = Math.max(1, Math.ceil(14 / (X(dt) - X(0))));   // keep markers at least 14 px apart
      // explicit (forward Euler) update: v(n+1) = v(n) + dt (u - v(n)) / tau
      var ve = 0, pts = [[0, 0]];
      for (var n = 1; n * dt <= TMAX + 1e-9; n++) { ve = ve + dt * (1 - ve); pts.push([n * dt, ve]); if (Math.abs(ve) > 50) break; }
      c.strokeStyle = C.red; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath();
      pts.forEach(function (q, m) { var yy = Y(Math.max(YMIN - 1, Math.min(YMAX + 1, q[1]))); m ? c.lineTo(X(q[0]), yy) : c.moveTo(X(q[0]), yy); });
      c.stroke(); c.setLineDash([]);
      c.fillStyle = C.red;
      pts.forEach(function (q, m) { if (m % every === 0 && q[1] >= YMIN && q[1] <= YMAX) { c.beginPath(); c.arc(X(q[0]), Y(q[1]), 4, 0, Math.PI * 2); c.fill(); } });

      // exponential update: exact for the linearized drag at any time step
      c.fillStyle = C.cobalt; c.strokeStyle = C.paper; c.lineWidth = 1.5;
      for (var m2 = 0; m2 * dt <= TMAX + 1e-9; m2 += every) {
        var tt = m2 * dt, vx = 1 - Math.exp(-tt);
        c.beginPath(); c.arc(X(tt), Y(vx), 5, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      c.restore();

      var status = dt < 1 ? 'explicit update follows the solution' : (dt < 2 ? 'explicit update oscillates' : 'explicit update is unstable');
      out.textContent = 'Δt = ' + dt.toFixed(dt < 1 ? 2 : 1) + ' τ';
      cv.setAttribute('data-status', status);
      var st = document.getElementById('dt-status');
      if (st) st.textContent = status;
    };

    range.addEventListener('input', plot);
    window.addEventListener('resize', plot);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(plot);
    plot();
  }
})();

// ---------- motion toggle ----------
const root = document.documentElement;
const toggle = document.getElementById('motion-toggle');
function showMotion() {
  toggle.textContent = motion.paused ? 'Play motion' : 'Pause motion';
  toggle.setAttribute('aria-pressed', String(motion.paused));
}
toggle.addEventListener('click', () => { setPaused(!motion.paused); showMotion(); });
showMotion();

// ---------- figures ----------
import('./js/boundaries.js?v=20261105a').then(m => m.initBoundaries(document.getElementById('bnd-cv')));

function noWebGL(err) {
  if (err) console.warn('3D figure unavailable:', err);
  root.classList.add('no-webgl');
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
if (hasWebGL()) {
  import('./js/channel.js?v=20261105a').then(m => {
    m.initChannel(document.getElementById('hero-gl'), { mode: 'hero' });
    m.initChannel(document.getElementById('veg-gl'), { mode: 'profile' });
  }).catch(noWebGL);
  import('./js/forces.js?v=20261105a').then(m => m.initForces(document.getElementById('forces-gl'))).catch(noWebGL);
  import('./js/story.js?v=20261105g').then(m => m.initStory(document.getElementById('story-gl'), document.getElementById('story-steps'))).catch(noWebGL);
  import('./js/shapes.js?v=20261105a').then(m => m.initShapes(document.getElementById('shapes-gl'))).catch(noWebGL);
} else noWebGL();

// ---------- copy buttons of the citation box ----------
document.querySelectorAll('.copy[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.copy);
    const raw = el.textContent;
    const text = el.tagName === 'PRE' ? raw.trim() : raw.replace(/\s+/g, ' ').trim();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Select and copy';
    btn.classList.toggle('done', ok);
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1600);
  });
});
