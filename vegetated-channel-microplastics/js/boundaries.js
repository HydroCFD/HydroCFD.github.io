// Boundary rules of the particle solver, animated: deposition at the bed, rebound at the
// walls and bed, and trapping at the free surface. Illustration, not model output.
import { runWhenVisible, fit2d, isSmall, motion } from '../../js/3d/loop.js';

const C = {
  paper: '#f2ede3', paper3: '#f7f3eb', ink: '#141414', ink2: '#45413b', ink3: '#7a746a', rule: '#cbc2b2',
  red: '#e4572e', redD: '#b8401d', cobalt: '#2643b8', cobaltD: '#1a2f85', water: '#dfe5f3', waterD: '#cdd7ee',
  sand: '#cdb68f', sandD: '#a88b5a', sandL: '#e0cfaa', olive: '#66772a'
};
const SERIF = 'Newsreader, Georgia, serif', SANS = '"Public Sans", Arial, sans-serif';

export function initBoundaries(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, Hh = 0, panels = [], grains = [];
  const T = 6;   // seconds per cycle

  function layout() {
    const s = fit2d(canvas, ctx);
    W = s.w; Hh = s.h;
    const stack = isSmall();
    panels = [0, 1, 2].map(i => stack
      ? { x: 0, y: i * Hh / 3, w: W, h: Hh / 3 }
      : { x: i * W / 3, y: 0, w: W / 3, h: Hh });
    grains = panels.map(p => {
      const g = [];
      for (let k = 0; k < p.w / 2.2; k++) g.push({ x: Math.random(), y: Math.random(), r: 1.2 + Math.random() * 2.4, c: [C.sand, C.sandD, C.sandL][k % 3] });
      return g;
    });
  }

  function frameOf(p) {
    const pad = 14, top = p.y + 46, bedY = p.y + p.h - 66;
    return { L: p.x + pad, R: p.x + p.w - pad, top, bed: bedY, mid: p.x + p.w / 2 };
  }

  function water(p, f, t, i) {
    ctx.fillStyle = C.water; ctx.fillRect(f.L, f.top, f.R - f.L, f.bed - f.top);
    // drifting flow streaks, faster near the surface
    ctx.strokeStyle = 'rgba(38,67,184,0.18)'; ctx.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const yy = f.top + 12 + k * (f.bed - f.top - 24) / 8;
      const sp = 18 + 40 * (1 - k / 8);
      const off = ((t * sp + k * 37) % 60);
      ctx.beginPath();
      for (let x = f.L - 60 + off; x < f.R; x += 60) { ctx.moveTo(Math.max(f.L, x), yy); ctx.lineTo(Math.min(f.R, x + 26), yy); }
      ctx.stroke();
    }
    // free surface with small waves
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.beginPath();
    for (let x = f.L; x <= f.R; x += 3) { const y = f.top + 1.6 * Math.sin(x * 0.07 - t * 2.4 + i); x === f.L ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    // bed with grains
    ctx.fillStyle = C.sand; ctx.fillRect(f.L, f.bed, f.R - f.L, 20);
    grains[i].forEach(g => { ctx.fillStyle = g.c; ctx.beginPath(); ctx.arc(f.L + g.x * (f.R - f.L), f.bed + 3 + g.y * 15, g.r, 0, 6.283); ctx.fill(); });
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.strokeRect(f.L, f.bed, f.R - f.L, 20);
  }

  function ball(x, y, r, fill, dark) {
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.78, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - r * 0.38, y - r * 0.4, r * 0.22, 0, 6.283); ctx.fill();
  }
  function trail(path, color) {
    for (let k = 1; k < path.length; k++) {
      ctx.strokeStyle = color; ctx.globalAlpha = 0.12 + 0.75 * k / path.length; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(path[k - 1][0], path[k - 1][1]); ctx.lineTo(path[k][0], path[k][1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function arrow(x0, y0, x1, y1, color, w = 2) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); ctx.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
  }
  function ring(x, y, age, color) {
    if (age < 0 || age > 1) return;
    ctx.strokeStyle = color; ctx.globalAlpha = 1 - age; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y, 6 + 26 * age, 2 + 6 * age, 0, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function title(p, text) {
    ctx.fillStyle = C.ink; ctx.font = `400 20px ${SERIF}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(text, p.x + 14, p.y + 30);
  }
  function note(p, f, text, color = C.ink2) {
    ctx.fillStyle = color; ctx.font = `italic 16px ${SERIF}`; ctx.textAlign = 'left';
    const words = text.split(' '), lines = [''];
    words.forEach(wd => { const tryL = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd;
      if (ctx.measureText(tryL).width > f.R - f.L && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = tryL; });
    lines.forEach((ln, k) => ctx.fillText(ln, p.x + 14, f.bed + 40 + k * 19));
  }
  const ease = x => x * x * (3 - 2 * x);

  function path(fn, u, n = 26) { const out = []; for (let k = 0; k <= n; k++) { const s = u * k / n; out.push(fn(s)); } return out; }

  function draw(t) {
    ctx.clearRect(0, 0, W, Hh);
    const ph = (t % T) / T;

    // ---- a: deposition ----
    let p = panels[0], f = frameOf(p);
    water(p, f, t, 0); title(p, 'Deposition at the bed');
    const ra = 11;
    const fa = s => [f.L + (f.R - f.L) * (0.22 + 0.42 * s), f.top + 18 + (f.bed - ra - f.top - 18) * ease(Math.min(1, s * 1.02))];
    const sa = Math.min(1, ph / 0.62);
    trail(path(fa, sa), C.red);
    const [xa, ya] = fa(sa);
    const landed = ph > 0.62;
    if (landed) ring(xa, f.bed, (ph - 0.62) / 0.25, C.ink2);
    ball(xa, ya, ra, landed ? C.sandD : C.red, landed ? '#7f6640' : C.redD);
    if (landed) { ctx.fillStyle = C.ink; ctx.font = `italic 15px ${SERIF}`; ctx.textAlign = 'center'; ctx.fillText('u* < u*c', xa, ya - 18); }
    note(p, f, 'deposited below the critical bed shear velocity');

    // ---- b: rebound ----
    p = panels[1]; f = frameOf(p);
    water(p, f, t, 1); title(p, 'Rebound at the walls and bed');
    const rb = 10, xi = f.L + (f.R - f.L) * 0.5, yi = f.bed - rb;
    const x0 = f.L + (f.R - f.L) * 0.18, y0 = f.top + 24;
    const x1 = f.L + (f.R - f.L) * 0.84, y1 = f.top + 70;
    const fb = s => s < 0.5 ? [x0 + (xi - x0) * s * 2, y0 + (yi - y0) * s * 2] : [xi + (x1 - xi) * (s - 0.5) * 2, yi + (y1 - yi) * (s - 0.5) * 2];
    const sb = Math.min(1, ph / 0.8);
    trail(path(fb, sb, 40), C.ink2);
    if (sb > 0.5) {
      ring(xi, f.bed, (sb - 0.5) * 3, C.ink2);
      // normal and tangential components after the impact
      arrow(xi, yi, xi, yi - 46, C.red); arrow(xi, yi, xi + 52, yi, C.red);
      ctx.fillStyle = C.red; ctx.font = `italic 18px ${SERIF}`; ctx.textAlign = 'left';
      ctx.fillText('eₙ', xi + 6, yi - 40); ctx.fillText('eₜ', xi + 56, yi - 6);
    }
    const [xb, yb] = fb(sb);
    ball(xb, yb, rb, C.ink2, C.ink);
    note(p, f, 'normal and tangential restitution coefficients');

    // ---- c: surface trapping ----
    p = panels[2]; f = frameOf(p);
    water(p, f, t, 2); title(p, 'Trapping at the surface');
    const rc = 11;
    const fc = s => [f.L + (f.R - f.L) * (0.3 + 0.08 * Math.sin(s * 7)), f.bed - 16 - (f.bed - 16 - f.top - rc + 2) * ease(Math.min(1, s))];
    const sc = Math.min(1, ph / 0.55);
    trail(path(fc, sc, 40), C.cobalt);
    let [xc, yc] = fc(sc);
    if (ph > 0.55) {
      const d = (ph - 0.55) * T;
      xc += d * 22; yc = f.top + 1.6 * Math.sin(xc * 0.07 - t * 2.4 + 2) + 1;
      ring(fc(1)[0], f.top + 2, (ph - 0.55) / 0.3, C.cobalt);
    }
    ball(xc, yc, rc, C.cobalt, C.cobaltD);
    note(p, f, 'a particle lighter than the water stays at the surface');

    // separators
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
    if (!isSmall()) { [1, 2].forEach(k => { ctx.beginPath(); ctx.moveTo(k * W / 3, 8); ctx.lineTo(k * W / 3, Hh - 8); ctx.stroke(); }); }
  }

  layout();
  let tt = 1.5;
  window.addEventListener('resize', () => { layout(); draw(tt); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw(tt));
  draw(tt);
  runWhenVisible(canvas, dt => { tt += dt; if (canvas.width !== Math.round(canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1))) layout(); draw(tt); });
  motion.listeners.push(() => draw(tt));
}
