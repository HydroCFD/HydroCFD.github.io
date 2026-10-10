// Fragmentation comparison: a new particle for every fragment (left) versus
// one weighted particle that represents w fragments (right).
import { runWhenVisible, fit2d, smooth, clamp, lerp } from './loop.js';

const GEN = 6, PER = 1.35, HOLD = 2.4, FADE = 0.8;
const TOTAL = GEN * PER + PER * 0.6 + HOLD + FADE;

export function initFrag() {
  const ca = document.getElementById('frag-a'), cb = document.getElementById('frag-b');
  if (!ca || !cb) return;
  const xa = ca.getContext('2d'), xb = cb.getContext('2d');
  const countA = document.getElementById('frag-count-a');
  const countB = document.getElementById('frag-count-b');
  const wEl = document.getElementById('frag-w');

  let dots = [], gen = 0, lastC = 0;
  function reset() { dots = [{ x: 0.5, y: 0.5, px: 0.5, py: 0.5, ph: 0 }]; gen = 0; }
  function split() {
    const next = [], r = 0.2 * Math.pow(0.74, gen);
    for (const d of dots) for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2;
      next.push({
        x: clamp(d.x + Math.cos(a) * r, 0.08, 0.92), y: clamp(d.y + Math.sin(a) * r, 0.08, 0.92),
        px: d.x, py: d.y, ph: Math.random() * 6.28
      });
    }
    dots = next; gen++;
  }
  reset();

  function dot(ctx, x, y, r, rgb, alpha) {
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  let shownA = '', shownB = '';
  function frame(dt, t) {
    const A = fit2d(ca, xa), B = fit2d(cb, xb);
    const c = t % TOTAL;
    if (c < lastC) reset();
    lastC = c;
    const target = Math.min(GEN, Math.floor(c / PER));
    while (gen < target) split();
    const sp = gen === 0 ? 1 : smooth(0, 0.5, (c - gen * PER) / PER);
    const fade = 1 - smooth(TOTAL - FADE, TOTAL, c);
    const R0 = Math.min(A.w, A.h) * 0.075;
    const rad = g => R0 * Math.pow(2, -g / 3); // equal mass split: r scales with m^(1/3)

    // left: every fragment is tracked
    xa.clearRect(0, 0, A.w, A.h);
    const crowd = smooth(3, 6, gen);
    for (const d of dots) {
      const x = lerp(d.px, d.x, sp) * A.w + Math.sin(t * 1.3 + d.ph) * 1.5;
      const y = lerp(d.py, d.y, sp) * A.h + Math.cos(t * 1.1 + d.ph) * 1.5;
      dot(xa, x, y, rad(gen), crowd > 0.5 ? '228,87,46' : '20,20,20', fade);
    }
    // right: one particle, w fragments
    xb.clearRect(0, 0, B.w, B.h);
    const w = Math.pow(2, gen), cx = B.w / 2, cy = B.h / 2;
    const r = rad(gen);
    for (let i = 1; i < Math.min(w, 64); i++) {
      const a = i * 2.39996 + t * 0.15, rr = R0 * 1.15 + Math.sqrt(i) * R0 * 0.32;
      xb.strokeStyle = `rgba(122,116,106,${0.7 * fade * sp})`;
      xb.lineWidth = 1;
      xb.beginPath(); xb.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.max(1.5, r * 0.4), 0, 6.2832); xb.stroke();
    }
    if (gen > 0 && sp < 1) { // a ring marks each break
      xb.strokeStyle = `rgba(228,87,46,${(1 - sp) * fade})`;
      xb.lineWidth = 1.5;
      xb.beginPath(); xb.arc(cx, cy, r + sp * R0 * 2.2, 0, 6.2832); xb.stroke();
    }
    dot(xb, cx, cy, lerp(rad(Math.max(0, gen - 1)), r, sp), '20,20,20', fade);

    const a = String(dots.length), bw = `w = ${w}`;
    if (a !== shownA) { countA.textContent = a; shownA = a; }
    if (bw !== shownB) { wEl.textContent = bw; countB.textContent = '1'; shownB = bw; }
  }
  runWhenVisible(ca.closest('.frag-demo'), frame);
}
