// Page wiring: scroll story, films and the animated scenes.
// The menu, progress bar and fade-ins come from ../../js/site.js.
import { motion, setPaused, life, isSmall, clamp } from '../../js/3d/loop.js';
import { initFrag } from './frag.js?v=20261017a';
import { initThreads } from './threads.js?v=20261017a';
import { initRace } from './race.js?v=20261017a';

const root = document.documentElement;

// ---------- scroll story ----------
const steps = [...document.querySelectorAll('.step')];
const dots = [...document.querySelectorAll('#life-dots li')];

function updateLife() {
  if (!steps.length) return;
  const mid = window.innerHeight * (isSmall() ? 0.72 : 0.5);
  const c = steps.map(s => { const r = s.getBoundingClientRect(); return r.top + r.height / 2; });
  const n = c.length;
  let P;
  if (mid <= c[0]) P = -(c[0] - mid) / (c[1] - c[0]);
  else if (mid >= c[n - 1]) P = n - 1 + (mid - c[n - 1]) / (c[n - 1] - c[n - 2]);
  else for (let i = 0; i < n - 1; i++) if (mid >= c[i] && mid < c[i + 1]) { P = i + (mid - c[i]) / (c[i + 1] - c[i]); break; }
  life.P = clamp(P, -0.5, n - 0.5);
  const on = Math.round(clamp(life.P, 0, n - 1));
  steps.forEach((s, i) => s.classList.toggle('on', i === on));
  dots.forEach((d, i) => d.classList.toggle('on', i === on));
}

let ticking = false;
window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; updateLife(); }); } }, { passive: true });
window.addEventListener('resize', updateLife);
updateLife();

// ---------- films ----------
const film = document.getElementById('film');
const captions = {
  '3d': '3D view. The vertical scale is enlarged so that the water column is visible.',
  plan: 'Plan view on the TELEMAC-3D flow, one row per diameter. Colour shows whether a particle rises (red) or sinks (blue).',
  side: 'Side view on the TELEMAC-3D flow, one row per diameter. Watch the film turn rising particles into sinking ones.'
};
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    film.pause();
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const view = button.dataset.view;
    film.querySelector('source').src = `assets/meander_${view}.mp4`;
    film.setAttribute('aria-label', `Meandering river simulation: ${button.textContent}`);
    document.getElementById('view-caption').textContent = captions[view];
    film.removeAttribute('poster');
    film.load();
  });
});

// ---------- motion toggle ----------
const toggle = document.getElementById('motion-toggle');
function showMotion() {
  toggle.textContent = motion.paused ? 'Play motion' : 'Pause motion';
  toggle.setAttribute('aria-pressed', String(motion.paused));
  root.classList.toggle('paused', motion.paused);
}
toggle.addEventListener('click', () => { setPaused(!motion.paused); showMotion(); });
showMotion();

// ---------- animated scenes ----------
initFrag();
initThreads();
initRace(document.getElementById('race-cv'));

function noWebGL(err) {
  if (err) console.warn('3D scene unavailable:', err);
  root.classList.add('no-webgl');
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
if (hasWebGL()) {
  import('../../js/3d/river.js?v=20261017a').then(m => m.initRiver(document.getElementById('hero-gl'))).catch(noWebGL);
  import('./life.js?v=20261017a').then(m => m.initLife(document.getElementById('life-gl'))).catch(noWebGL);
  import('./mesh.js?v=20261017a').then(m => m.initMesh(document.getElementById('mesh-gl'))).catch(noWebGL);
} else noWebGL();
