// E. GPU against CPU: the same particles advanced step after step. On the
// CPU 24 threads each work through their share in turn; on the GPU every
// particle has its own thread, so a step costs about the same at any count.
// An illustration of the idea, not a benchmark.
import { runWhenVisible, fit2d } from '../../js/3d/loop.js';

const THREADS = 24;

export function initRace(canvas) {
  const $ = id => document.getElementById(id);
  const ctx = canvas.getContext('2d');
  let N = 4096, running = false, tRun = 0;
  const lanes = { cpu: { step: 0, prog: 0 }, gpu: { step: 0, prog: 0 } };
  // seconds per time step in the illustration
  const cpuStep = () => 0.18 * N / 1024;
  const gpuStep = () => 0.22 + 0.02 * Math.log2(N / 1024 + 1);
  $('race-n').addEventListener('change', e => { N = Number(e.target.value); reset(); });
  $('race-go').addEventListener('click', () => { if (!running) { reset(); running = true; $('race-go').textContent = 'Stop'; } else { running = false; $('race-go').textContent = 'Start the race'; } });
  function reset() { tRun = 0; lanes.cpu.step = lanes.gpu.step = 0; lanes.cpu.prog = lanes.gpu.prog = 0; }

  function lane(x0, y0, w, h, name, sub, done, prog, kind) {
    // a grid of squares standing for the particles; at most 1024 drawn
    const shown = Math.min(N, 1024), cols = Math.ceil(Math.sqrt(shown * w / h)), rows = Math.ceil(shown / cols);
    const cs = Math.min((w - 20) / cols, (h - 56) / rows), gap = cs > 6 ? 1.5 : 0.6;
    ctx.fillStyle = '#141414'; ctx.font = '500 15px Newsreader, Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText(name, x0, y0 + 16);
    ctx.fillStyle = '#7a746a'; ctx.font = 'italic 13px Newsreader, Georgia, serif';
    ctx.fillText(sub, x0, y0 + 34);
    for (let k = 0; k < shown; k++) {
      const c = k % cols, r = Math.floor(k / cols);
      let lit;
      if (kind === 'gpu') lit = prog > 0.05 && prog < 0.85;
      else { const thread = k % THREADS, pos = Math.floor(k / THREADS) / Math.ceil(shown / THREADS); lit = Math.abs(pos - prog) < 1.5 / Math.ceil(shown / THREADS) + 0.02; void thread; }
      ctx.fillStyle = lit ? (kind === 'gpu' ? '#e4572e' : '#141414') : 'rgba(20,20,20,0.12)';
      ctx.fillRect(x0 + c * cs, y0 + 46 + r * cs, cs - gap, cs - gap);
    }
    ctx.fillStyle = '#141414'; ctx.font = 'italic 22px Newsreader, Georgia, serif'; ctx.textAlign = 'right';
    ctx.fillText(done + ' steps', x0 + w, y0 + 18);
    ctx.textAlign = 'left';
  }

  runWhenVisible(canvas, (dt, t) => {
    const { w, h } = fit2d(canvas, ctx);
    if (running) {
      tRun += dt;
      lanes.cpu.prog += dt / cpuStep(); while (lanes.cpu.prog >= 1) { lanes.cpu.prog -= 1; lanes.cpu.step++; }
      lanes.gpu.prog += dt / gpuStep(); while (lanes.gpu.prog >= 1) { lanes.gpu.prog -= 1; lanes.gpu.step++; }
    }
    ctx.clearRect(0, 0, w, h);
    const pad = 18, half = (w - 3 * pad) / 2;
    lane(pad, pad, half, h - 2 * pad, 'CPU, 24 threads', `${N} particles, each thread works through ${Math.ceil(N / THREADS)} of them in turn`, lanes.cpu.step, lanes.cpu.prog, 'cpu');
    lane(2 * pad + half, pad, half, h - 2 * pad, 'GPU, one thread per particle', `${N} particles, all advanced at the same time`, lanes.gpu.step, lanes.gpu.prog, 'gpu');
    ctx.strokeStyle = 'rgba(20,20,20,0.3)'; ctx.beginPath(); ctx.moveTo(w / 2, pad); ctx.lineTo(w / 2, h - pad); ctx.stroke();
    if (N > 1024) { ctx.fillStyle = '#7a746a'; ctx.font = 'italic 12px Newsreader, Georgia, serif'; ctx.fillText(`(1024 of ${N} drawn)`, pad, h - 6); }
  });
}
