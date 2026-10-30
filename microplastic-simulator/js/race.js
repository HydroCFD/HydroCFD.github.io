// GPU against CPU: the wall time per time step measured in the paper (table of the
// computational performance), for the GPU in single precision and 24 CPU threads, with
// transport alone. The display is slowed down, and the ratio of the two speeds is the
// measured one. 500,000 particles lies between two measured counts and is interpolated
// on logarithmic axes.
import { runWhenVisible, fit2d } from '../../js/3d/loop.js';

const THREADS = 24, CELLS = 1024, CPU_SCREEN = 1.6; // seconds on screen for one CPU time step
const CASES = {
  ariake: {
    n: [1.4e4, 1.4e5, 1.4e6, 5.6e6], gpu: [0.137, 0.171, 0.499, 1.60], cpu: [0.284, 2.47, 22.9, 92.4],
    options: [1.4e4, 1.4e5, 5e5, 1.4e6, 5.6e6]
  },
  tidal: {
    n: [1e4, 1e5, 1e6, 1e7], gpu: [0.0011, 0.0018, 0.0055, 0.0490], cpu: [0.0022, 0.0182, 0.177, 1.84],
    options: [1e4, 1e5, 5e5, 1e6, 1e7]
  }
};
function wall(c, ys, N) {
  let i = 0;
  while (i < c.n.length - 2 && N > c.n[i + 1]) i++;
  const f = Math.log(N / c.n[i]) / Math.log(c.n[i + 1] / c.n[i]);
  return Math.exp(Math.log(ys[i]) * (1 - f) + Math.log(ys[i + 1]) * f);
}
const fmtN = N => Math.round(N).toLocaleString('en-US');
const fmtT = t => (t < 0.01 ? t.toFixed(4) : t < 1 ? t.toFixed(3) : t.toFixed(1)) + ' s';

export function initRace(canvas) {
  const $ = id => document.getElementById(id);
  const ctx = canvas.getContext('2d');
  let kase = CASES.ariake, N = 5e5, running = false;
  const lanes = { cpu: { step: 0, prog: 0 }, gpu: { step: 0, prog: 0 } };
  const nSel = $('race-n'), cSel = $('race-case'), go = $('race-go');
  function fill() {
    nSel.innerHTML = kase.options.map(v => `<option value="${v}"${v === N ? ' selected' : ''}>${fmtN(v)}</option>`).join('');
  }
  function reset() { lanes.cpu.step = lanes.gpu.step = 0; lanes.cpu.prog = lanes.gpu.prog = 0; }
  fill();
  nSel.addEventListener('change', e => { N = Number(e.target.value); reset(); });
  cSel.addEventListener('change', e => { kase = CASES[e.target.value]; N = 5e5; fill(); reset(); });
  go.addEventListener('click', () => {
    running = !running;
    if (running) reset();
    go.textContent = running ? 'Stop' : 'Start';
  });

  // text wrapped to the width of a lane; returns the height used
  function wrap(text, x, y, width, lh) {
    let line = '', n = 0;
    for (const word of text.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > width && line) { ctx.fillText(line, x, y + n * lh); n++; line = word; } else line = t;
    }
    ctx.fillText(line, x, y + n * lh);
    return (n + 1) * lh;
  }

  function lane(x0, y0, w, h, name, sub, wallT, done, prog, kind, steady) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#141414'; ctx.font = '500 15px Newsreader, Georgia, serif';
    ctx.fillText(name, x0, y0 + 14);
    ctx.font = 'italic 19px Newsreader, Georgia, serif'; ctx.textAlign = 'right';
    ctx.fillText(done + ' steps', x0 + w, y0 + 15);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7a746a'; ctx.font = 'italic 13px Newsreader, Georgia, serif';
    let y = y0 + 32;
    y += wrap(sub, x0, y, w, 16);
    ctx.fillStyle = '#141414';
    ctx.fillText(fmtT(wallT) + ' per time step', x0, y);
    const top = y + 10, gh = y0 + h - top;
    const cols = Math.ceil(Math.sqrt(CELLS * w / gh)), rows = Math.ceil(CELLS / cols);
    const cs = Math.min(w / cols, gh / rows), gap = cs > 6 ? 1.5 : 0.6;
    const band = Math.ceil(CELLS / THREADS);
    for (let k = 0; k < CELLS; k++) {
      const c = k % cols, r = Math.floor(k / cols);
      let lit;
      if (kind === 'gpu') lit = steady || (prog > 0.05 && prog < 0.85); // a very short step is drawn steady, not as a flicker
      else lit = Math.abs(Math.floor(k / THREADS) / band - prog) < 1.5 / band + 0.02;
      ctx.fillStyle = lit ? (kind === 'gpu' ? '#e4572e' : '#141414') : 'rgba(20,20,20,0.12)';
      ctx.fillRect(x0 + c * cs, top + r * cs, cs - gap, cs - gap);
    }
  }

  runWhenVisible(canvas, dt => {
    const { w, h } = fit2d(canvas, ctx);
    const tg = wall(kase, kase.gpu, N), tc = wall(kase, kase.cpu, N), ratio = tc / tg;
    const gpuScreen = CPU_SCREEN / ratio;
    if (running) {
      lanes.cpu.prog += dt / CPU_SCREEN; while (lanes.cpu.prog >= 1) { lanes.cpu.prog -= 1; lanes.cpu.step++; }
      lanes.gpu.prog += dt / gpuScreen; while (lanes.gpu.prog >= 1) { lanes.gpu.prog -= 1; lanes.gpu.step++; }
    }
    ctx.clearRect(0, 0, w, h);
    const stack = w < 600, pad = 16, foot = stack ? 46 : 26;
    const lw = stack ? w - 2 * pad : (w - 3 * pad) / 2, lh = stack ? (h - foot - 3 * pad) / 2 : h - foot - 2 * pad;
    const x2 = stack ? pad : 2 * pad + lw, y2 = stack ? 2 * pad + lh : pad;
    lane(pad, pad, lw, lh, 'CPU, 24 threads', `Each thread calculates ${fmtN(N / THREADS)} particles, one after another`, tc, lanes.cpu.step, lanes.cpu.prog, 'cpu', false);
    lane(x2, y2, lw, lh, 'GPU, single precision', `One thread for each of the ${fmtN(N)} particles, all in parallel`, tg, lanes.gpu.step, lanes.gpu.prog, 'gpu', running && gpuScreen < 0.25);
    ctx.strokeStyle = 'rgba(20,20,20,0.3)'; ctx.beginPath();
    if (stack) { ctx.moveTo(pad, y2 - pad / 2); ctx.lineTo(w - pad, y2 - pad / 2); } else { ctx.moveTo(w / 2, pad); ctx.lineTo(w / 2, pad + lh); }
    ctx.stroke();
    ctx.fillStyle = '#7a746a'; ctx.font = 'italic 12px Newsreader, Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText(`One square represents ${fmtN(N / CELLS)} particles`, pad, h - 10);
    ctx.fillStyle = '#e4572e'; ctx.font = 'italic 15px Newsreader, Georgia, serif'; ctx.textAlign = stack ? 'left' : 'right';
    ctx.fillText(`GPU ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)} times faster`, stack ? pad : w - pad, stack ? h - 28 : h - 9);
    ctx.textAlign = 'left';
  });
}
