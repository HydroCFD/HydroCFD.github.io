// Starts the 3D hero of a page: checks WebGL, loads the scene module and
// wires the "Pause motion" button. Used by every page except the microplastic
// project page, which has its own main.js.
import { motion, setPaused } from './loop.js';

export function startHero(loadScene, canvasId = 'hero-gl', opts = {}) {
  const root = document.documentElement;
  const toggle = document.getElementById('motion-toggle');
  const show = () => {
    if (!toggle) return;
    toggle.textContent = motion.paused ? 'Play motion' : 'Pause motion';
    toggle.setAttribute('aria-pressed', String(motion.paused));
    root.classList.toggle('paused', motion.paused);
  };
  if (toggle) toggle.addEventListener('click', () => { setPaused(!motion.paused); show(); });
  show();

  let ok = false;
  try { const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { ok = false; }
  const canvas = document.getElementById(canvasId);
  if (!ok || !canvas) { root.classList.add('no-webgl'); return; }
  loadScene().then(init => init(canvas, opts)).catch(err => {
    console.warn('3D scene unavailable:', err);
    root.classList.add('no-webgl');
  });
}
