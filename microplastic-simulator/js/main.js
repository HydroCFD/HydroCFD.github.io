// Page wiring: navigation, reveals, scroll story, films and the animated scenes.
import { motion, setPaused, life, isSmall, clamp } from './loop.js';
import { initFrag } from './frag.js';
import { initThreads } from './threads.js';

const root = document.documentElement;

// ---------- navigation ----------
const nav = document.getElementById('nav');
const bar = nav.querySelector('.nav-progress');
const links = [...nav.querySelectorAll('nav a')];
const targets = links.map(a => document.querySelector(a.getAttribute('href')));

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
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  const max = root.scrollHeight - window.innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  let active = -1;
  targets.forEach((s, i) => { if (s && s.getBoundingClientRect().top < window.innerHeight * 0.45) active = i; });
  links.forEach((a, i) => a.classList.toggle('active', i === active));
  updateLife();
}
window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
window.addEventListener('resize', onScroll);
onScroll();

// ---------- reveal on scroll ----------
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ---------- feature cards follow the pointer ----------
document.querySelectorAll('.feature').forEach(card => {
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

// ---------- films ----------
const film = document.getElementById('film');
const captions = {
  '3d': '3D view. The vertical scale is enlarged so that the water column is visible.',
  plan: 'Plan view. Compare how far particles travel downstream with each process.',
  side: 'Side view. Compare how particles move through the water column and reach the bed.'
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

function noWebGL(err) {
  if (err) console.warn('3D scene unavailable:', err);
  root.classList.add('no-webgl');
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
if (hasWebGL()) {
  import('./hero.js').then(m => m.initHero(document.getElementById('hero-gl'))).catch(noWebGL);
  import('./life.js').then(m => m.initLife(document.getElementById('life-gl'))).catch(noWebGL);
  import('./mesh.js').then(m => m.initMesh(document.getElementById('mesh-gl'))).catch(noWebGL);
} else noWebGL();
