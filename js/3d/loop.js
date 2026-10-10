// Shared animation state and helpers for the project page.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

// paused = true freezes simulated time; scenes still redraw (e.g. on scroll).
export const motion = { paused: reduce.matches, listeners: [] };
export function setPaused(value) {
  motion.paused = value;
  motion.listeners.forEach(fn => fn(value));
}

// Continuous scroll position through the "life of a particle" steps (0..4).
export const life = { P: 0 };

export const isSmall = () => window.matchMedia('(max-width: 820px)').matches;

// Run frame(dt, t) every animation frame while el is on screen.
export function runWhenVisible(el, frame) {
  let visible = false, raf = 0, last = 0, t = 0;
  const tick = now => {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const step = motion.paused ? 0 : dt;
    t += step;
    frame(step, t);
    raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }, { rootMargin: '120px' }).observe(el);
}

// Size a 2D canvas to its CSS box at device resolution. Returns {w, h, dpr}.
export function fit2d(canvas, ctx) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

// Keep a three.js renderer and camera matched to the canvas CSS size.
// Returns true when the size changed.
const glSizes = new WeakMap();
export function fitGL(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = Math.min(isSmall() ? 1.5 : 2, window.devicePixelRatio || 1);
  const key = `${w}x${h}@${dpr}`;
  if (glSizes.get(renderer) === key) return false;
  glSizes.set(renderer, key);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  return true;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Cheap Gaussian random number.
export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
}

// Seeded value noise in 3D, used to shape particles and terrain.
export function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => rnd() * 2 - 1);
  const fade = t => t * t * (3 - 2 * t);
  const h = (x, y, z) => val[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w);
  };
}
