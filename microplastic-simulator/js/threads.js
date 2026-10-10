// GPU thread grid: every square is one thread advancing one particle.
// All threads start each time step together and finish at different times.
import { runWhenVisible, fit2d } from './loop.js';

const STEP = 1.8, CELL = 10, GAP = 4;
const INK = '20,20,20', RED = '228,87,46';

export function initThreads() {
  const canvas = document.getElementById('threads');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let cols = 0, rows = 0, done = [], red = [], stepN = -1;

  function frame(dt, t) {
    const { w, h } = fit2d(canvas, ctx);
    const pad = 16;
    const c = Math.floor((w - 2 * pad + GAP) / (CELL + GAP)), r = Math.floor((h - 2 * pad - 14 + GAP) / (CELL + GAP));
    if (c !== cols || r !== rows) {
      cols = c; rows = r;
      done = new Float32Array(cols * rows);
      red = Array.from({ length: cols * rows }, () => Math.random() < 0.12);
      stepN = -1;
    }
    const n = Math.floor(t / STEP), tl = (t % STEP) / STEP;
    if (n !== stepN) { for (let i = 0; i < done.length; i++) done[i] = 0.2 + Math.pow(Math.random(), 2) * 0.65; stepN = n; }
    ctx.clearRect(0, 0, w, h);
    const ox = (w - (cols * (CELL + GAP) - GAP)) / 2;
    ctx.lineWidth = 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const start = (Math.floor(k / 32) % 16) * 0.006;
      const x = ox + i * (CELL + GAP) + 0.5, y = pad + j * (CELL + GAP) + 0.5;
      const col = red[k] ? RED : INK;
      if (tl >= start && tl < start + done[k]) {
        ctx.fillStyle = `rgba(${col},0.92)`;
        ctx.fillRect(x - 0.5, y - 0.5, CELL, CELL);
      } else {
        const fade = tl >= start ? Math.exp(-(tl - start - done[k]) * 12) : 0;
        if (fade > 0.02) { ctx.fillStyle = `rgba(${col},${0.9 * fade})`; ctx.fillRect(x - 0.5, y - 0.5, CELL, CELL); }
        ctx.strokeStyle = `rgba(${INK},0.28)`;
        ctx.strokeRect(x, y, CELL - 1, CELL - 1);
      }
    }
    // time-step rule
    const by = h - pad + 2;
    ctx.fillStyle = `rgba(${INK},0.25)`;
    ctx.fillRect(ox, by, w - 2 * ox, 1);
    ctx.fillStyle = `rgb(${RED})`;
    ctx.fillRect(ox, by - 1, (w - 2 * ox) * tl, 3);
    ctx.font = 'italic 14px Newsreader, Georgia, serif';
    ctx.fillStyle = `rgb(${INK})`;
    ctx.textAlign = 'right';
    ctx.fillText(`time step ${n + 1}`, w - ox, by - 6);
  }
  runWhenVisible(canvas, frame);
}
