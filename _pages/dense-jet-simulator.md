---
layout: single
title: "Dense Jet Simulator"
permalink: /dense-jet-simulator/
author_profile: false
---

<div class="jet-app" id="jet-app">
  <div class="jet-controls" role="group" aria-label="Dense jet controls">
    <div class="jet-control">
      <label for="angle">Release Angle: <span id="angle-value">60</span> deg</label>
      <input id="angle" type="range" min="5" max="85" step="1" value="60" />
    </div>
    <div class="jet-control">
      <label for="speed">Jet Speed (m/s): <span id="speed-value">2.0</span></label>
      <input id="speed" type="range" min="0.5" max="4.0" step="0.1" value="2.0" />
    </div>
    <div class="jet-control">
      <label for="buoyancy">Negative Buoyancy g' (m/s^2): <span id="buoyancy-value">0.25</span></label>
      <input id="buoyancy" type="range" min="0.05" max="0.60" step="0.01" value="0.25" />
    </div>
    <div class="jet-control">
      <label for="crossflow">Ambient Crossflow (m/s): <span id="crossflow-value">0.35</span></label>
      <input id="crossflow" type="range" min="0.00" max="1.20" step="0.01" value="0.35" />
    </div>
    <div class="jet-control jet-actions">
      <button id="toggle-run" type="button">Pause</button>
      <button id="reset" type="button">Reset</button>
    </div>
  </div>

  <div class="jet-canvas-wrap">
    <canvas id="jet-canvas" width="1400" height="800" aria-label="Dense jet animation"></canvas>
    <div class="jet-metrics" id="jet-metrics"></div>
  </div>
</div>

<style>
  .jet-app {
    display: grid;
    gap: 1rem;
  }

  .jet-controls {
    display: grid;
    gap: 0.75rem;
    padding: 0.9rem;
    border: 1px solid #d2d9e6;
    border-radius: 6px;
    background: #f8fafc;
  }

  .jet-control {
    display: grid;
    gap: 0.3rem;
  }

  .jet-control label {
    margin: 0;
    color: #243042;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .jet-control input[type="range"] {
    width: 100%;
  }

  .jet-actions {
    grid-template-columns: repeat(2, minmax(110px, 160px));
  }

  .jet-actions button {
    border: 1px solid #3f5f8a;
    background: #4f709c;
    color: #ffffff;
    padding: 0.45rem 0.7rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .jet-actions button:hover {
    background: #3f5f8a;
  }

  .jet-canvas-wrap {
    position: relative;
    border: 1px solid #c6cedd;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
  }

  #jet-canvas {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 7 / 4;
    background: linear-gradient(to bottom, #f1f6fb, #dbe8f6);
  }

  .jet-metrics {
    position: absolute;
    right: 0.75rem;
    top: 0.75rem;
    font-size: 0.84rem;
    line-height: 1.4;
    color: #142033;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(34, 52, 79, 0.25);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
  }

  @media (min-width: 960px) {
    .jet-app {
      grid-template-columns: minmax(280px, 360px) 1fr;
      align-items: start;
    }
  }
</style>

<script>
  (function () {
    const canvas = document.getElementById("jet-canvas");
    const ctx = canvas.getContext("2d");

    const controls = {
      angle: document.getElementById("angle"),
      speed: document.getElementById("speed"),
      buoyancy: document.getElementById("buoyancy"),
      crossflow: document.getElementById("crossflow")
    };

    const values = {
      angle: document.getElementById("angle-value"),
      speed: document.getElementById("speed-value"),
      buoyancy: document.getElementById("buoyancy-value"),
      crossflow: document.getElementById("crossflow-value")
    };

    const metricsEl = document.getElementById("jet-metrics");
    const runButton = document.getElementById("toggle-run");
    const resetButton = document.getElementById("reset");

    let running = true;
    let lastTime = performance.now();

    const state = {
      angleDeg: Number(controls.angle.value),
      speed: Number(controls.speed.value),
      buoyancy: Number(controls.buoyancy.value),
      crossflow: Number(controls.crossflow.value),
      scale: 120
    };

    const sim = {
      w: 280,
      h: 160
    };
    const cellW = canvas.width / sim.w;
    const cellH = canvas.height / sim.h;
    let density = new Float32Array(sim.w * sim.h);
    let nextDensity = new Float32Array(sim.w * sim.h);
    const imgData = ctx.createImageData(sim.w, sim.h);
    const offscreen = document.createElement("canvas");
    offscreen.width = sim.w;
    offscreen.height = sim.h;
    const offCtx = offscreen.getContext("2d");

    function syncLabels() {
      values.angle.textContent = state.angleDeg.toFixed(0);
      values.speed.textContent = state.speed.toFixed(1);
      values.buoyancy.textContent = state.buoyancy.toFixed(2);
      values.crossflow.textContent = state.crossflow.toFixed(2);
    }

    function bindControl(key, parseFn) {
      controls[key].addEventListener("input", function (e) {
        state[key === "angle" ? "angleDeg" : key] = parseFn(e.target.value);
        syncLabels();
      });
    }

    bindControl("angle", Number);
    bindControl("speed", Number);
    bindControl("buoyancy", Number);
    bindControl("crossflow", Number);
    syncLabels();

    function nozzlePosition() {
      return { x: canvas.width * 0.08, y: canvas.height * 0.82 };
    }

    function nozzleGridPosition() {
      const n = nozzlePosition();
      return {
        x: Math.max(1, Math.min(sim.w - 2, Math.floor(n.x / cellW))),
        y: Math.max(1, Math.min(sim.h - 2, Math.floor(n.y / cellH)))
      };
    }

    function resetFlow() {
      density.fill(0);
      nextDensity.fill(0);
    }

    function drawGrid() {
      ctx.save();
      ctx.strokeStyle = "rgba(17, 38, 65, 0.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawAxes() {
      const origin = nozzlePosition();
      const xMax = canvas.width - 26;
      const yTop = 20;
      const axisPxPerM = 110;

      ctx.save();
      ctx.strokeStyle = "rgba(20, 34, 52, 0.9)";
      ctx.fillStyle = "rgba(20, 34, 52, 0.9)";
      ctx.lineWidth = 1.7;
      ctx.font = "13px sans-serif";

      // X-axis
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(xMax, origin.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xMax, origin.y);
      ctx.lineTo(xMax - 10, origin.y - 5);
      ctx.lineTo(xMax - 10, origin.y + 5);
      ctx.closePath();
      ctx.fill();

      // Y-axis
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(origin.x, yTop);
      ctx.lineTo(origin.x - 5, yTop + 10);
      ctx.lineTo(origin.x + 5, yTop + 10);
      ctx.closePath();
      ctx.fill();

      // X ticks and labels
      for (let x = origin.x + axisPxPerM, t = 1; x <= xMax - 12; x += axisPxPerM, t++) {
        ctx.beginPath();
        ctx.moveTo(x, origin.y - 5);
        ctx.lineTo(x, origin.y + 5);
        ctx.stroke();
        ctx.fillText(String(t), x - 3, origin.y + 20);
      }

      // Y ticks and labels (positive upward)
      for (let y = origin.y - axisPxPerM, t = 1; y >= yTop + 14; y -= axisPxPerM, t++) {
        ctx.beginPath();
        ctx.moveTo(origin.x - 5, y);
        ctx.lineTo(origin.x + 5, y);
        ctx.stroke();
        ctx.fillText(String(t), origin.x + 10, y + 4);
      }

      ctx.fillText("x (m)", xMax - 44, origin.y - 10);
      ctx.fillText("y (m)", origin.x + 10, yTop + 16);
      ctx.restore();
    }

    function drawCenterline() {
      const n = nozzlePosition();
      const theta = (state.angleDeg * Math.PI) / 180;
      let x = n.x;
      let y = n.y;
      let vx = state.speed * Math.cos(theta);
      let vy = -state.speed * Math.sin(theta);
      const dt = 0.055;
      const scale = state.scale;

      ctx.save();
      ctx.strokeStyle = "rgba(33, 90, 170, 0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 120; i++) {
        x += (vx + state.crossflow) * dt * scale;
        y += vy * dt * scale + 0.5 * state.buoyancy * dt * dt * scale;
        vy += state.buoyancy * dt;
        if (x > canvas.width || y > canvas.height || y < 0) {
          break;
        }
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawNozzle() {
      const n = nozzlePosition();
      ctx.save();
      ctx.fillStyle = "#1e2f44";
      ctx.fillRect(n.x - 10, n.y - 4, 18, 8);
      ctx.beginPath();
      ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function velocityAt(x, y) {
      const n = nozzlePosition();
      const dx = x - n.x;
      const dy = y - n.y;
      const theta = (state.angleDeg * Math.PI) / 180;
      const jx = Math.cos(theta);
      const jy = -Math.sin(theta);
      const projection = (dx * jx + dy * jy);
      const plumeSpread = 24 + 0.23 * Math.max(0, projection);
      const lateral = Math.abs(-dx * jy + dy * jx);
      const core = Math.exp(-(lateral * lateral) / (2 * plumeSpread * plumeSpread));
      const decay = Math.exp(-Math.max(0, projection) / 260);
      const jetMag = state.speed * core * decay * (projection >= -15 ? 1 : 0);
      const vx = state.crossflow + jetMag * jx;
      const vy = jetMag * jy + state.buoyancy * 0.7;
      const shear = 0.05 * Math.sin((y / canvas.height) * Math.PI * 2);
      return { vx: vx + shear, vy: vy };
    }

    function bilinearSample(field, x, y) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const tx = x - x0;
      const ty = y - y0;
      if (x0 < 0 || y0 < 0 || x1 >= sim.w || y1 >= sim.h) {
        return 0;
      }
      const i00 = y0 * sim.w + x0;
      const i10 = y0 * sim.w + x1;
      const i01 = y1 * sim.w + x0;
      const i11 = y1 * sim.w + x1;
      return (
        field[i00] * (1 - tx) * (1 - ty) +
        field[i10] * tx * (1 - ty) +
        field[i01] * (1 - tx) * ty +
        field[i11] * tx * ty
      );
    }

    function injectSource(dt) {
      const ng = nozzleGridPosition();
      const theta = (state.angleDeg * Math.PI) / 180;
      const jx = Math.cos(theta);
      const jy = -Math.sin(theta);
      const strength = (0.8 + 0.7 * state.speed) * dt * 5.2;
      for (let oy = -5; oy <= 5; oy++) {
        for (let ox = -5; ox <= 5; ox++) {
          const gx = ng.x + ox;
          const gy = ng.y + oy;
          if (gx < 1 || gy < 1 || gx >= sim.w - 1 || gy >= sim.h - 1) {
            continue;
          }
          const along = ox * jx + oy * jy;
          const across = Math.abs(-ox * jy + oy * jx);
          if (along < -2 || across > 4.5) {
            continue;
          }
          const i = gy * sim.w + gx;
          const added = strength * Math.exp(-(across * across) / 9) * Math.exp(-Math.max(0, along) / 5);
          density[i] = Math.min(1.0, density[i] + added);
        }
      }
    }

    function advectDiffuse(dt) {
      const diff = 0.17 + state.crossflow * 0.08;
      const sink = 0.03 + state.buoyancy * 0.12;

      for (let y = 1; y < sim.h - 1; y++) {
        for (let x = 1; x < sim.w - 1; x++) {
          const px = (x + 0.5) * cellW;
          const py = (y + 0.5) * cellH;
          const v = velocityAt(px, py);
          const backX = x - (v.vx * dt * state.scale) / cellW;
          const backY = y - (v.vy * dt * state.scale) / cellH;
          const adv = bilinearSample(density, backX, backY);
          const i = y * sim.w + x;
          const lap =
            density[i - 1] + density[i + 1] +
            density[i - sim.w] + density[i + sim.w] -
            4 * density[i];
          let val = adv + diff * dt * lap;
          val *= (1 - sink * dt);
          nextDensity[i] = Math.max(0, Math.min(1, val));
        }
      }

      const tmp = density;
      density = nextDensity;
      nextDensity = tmp;
    }

    function renderDensity() {
      const px = imgData.data;
      for (let i = 0; i < density.length; i++) {
        const d = Math.max(0, Math.min(1, density[i]));
        const base = i * 4;
        const r = 10 + Math.floor(40 * d);
        const g = 76 + Math.floor(110 * d);
        const b = 140 + Math.floor(95 * d);
        const a = Math.floor(255 * Math.min(1, d * 1.6));
        px[base] = r;
        px[base + 1] = g;
        px[base + 2] = b;
        px[base + 3] = a;
      }
      offCtx.putImageData(imgData, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.88;
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    function plumeMass() {
      let sum = 0;
      for (let i = 0; i < density.length; i++) {
        sum += density[i];
      }
      return sum / density.length;
    }

    function plumeHeightEstimate() {
      const theta = (state.angleDeg * Math.PI) / 180;
      const upward = state.speed * Math.sin(theta);
      if (state.buoyancy <= 0) {
        return 0;
      }
      return (upward * upward) / (2 * state.buoyancy);
    }

    function updateMetrics() {
      const peakRise = plumeHeightEstimate();
      const travelTime = state.speed > 0 ? (2 * Math.max(0.01, state.speed * Math.sin((state.angleDeg * Math.PI) / 180)) / Math.max(0.01, state.buoyancy)) : 0;
      metricsEl.innerHTML =
        "Mean concentration: " + plumeMass().toFixed(3) +
        "<br>Estimated rise: " + peakRise.toFixed(2) + " m" +
        "<br>Rise time: " + Math.max(0, travelTime).toFixed(2) + " s";
    }

    function frame(now) {
      const dt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;

      if (running) {
        injectSource(dt);
        advectDiffuse(dt);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid();
      drawAxes();
      drawCenterline();
      renderDensity();
      drawNozzle();
      updateMetrics();
      requestAnimationFrame(frame);
    }

    runButton.addEventListener("click", function () {
      running = !running;
      runButton.textContent = running ? "Pause" : "Run";
    });

    resetButton.addEventListener("click", function () {
      resetFlow();
    });

    requestAnimationFrame(function (t) {
      lastTime = t;
      frame(t);
    });
  })();
</script>
