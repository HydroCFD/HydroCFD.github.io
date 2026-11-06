// Microplastics in vegetated channels: page wiring, motion toggle, integrator illustration and 3D figures.
// The figures are illustrations of the processes, not model output.
import { motion, setPaused } from '../js/3d/loop.js';


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
import('./js/integrator.js?v=20261106f').then(m => m.initIntegrator(document.getElementById('integ')));
import('./js/boundaries.js?v=20261106a').then(m => m.initBoundaries(document.getElementById('bnd-cv')));

function noWebGL(err) {
  if (err) console.warn('3D figure unavailable:', err);
  root.classList.add('no-webgl');
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
if (hasWebGL()) {
  import('./js/channel.js?v=20261106a').then(m => {
    m.initChannel(document.getElementById('hero-gl'), { mode: 'hero' });
  }).catch(noWebGL);
  import('./js/forces.js?v=20261106a').then(m => m.initForces(document.getElementById('forces-gl'))).catch(noWebGL);
  import('./js/story.js?v=20261106a').then(m => m.initStory(document.getElementById('story-gl'), document.getElementById('story-steps'))).catch(noWebGL);
  import('./js/lab.js?v=20261106f').then(m => m.initStations(document.getElementById('stations'))).catch(noWebGL);
  import('./js/shapes.js?v=20261106a').then(m => m.initShapes(document.getElementById('shapes-gl'))).catch(noWebGL);
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
