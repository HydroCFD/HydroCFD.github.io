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
    <canvas id="jet-canvas" width="1000" height="560" aria-label="Dense jet animation"></canvas>
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
    aspect-ratio: 25 / 14;
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
      grid-template-columns: minmax(260px, 320px) 1fr;
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
    let particles = [];
    let lastTime = performance.now();
    let emissionAccumulator = 0;

    const state = {
      angleDeg: Number(controls.angle.value),
      speed: Number(controls.speed.value),
      buoyancy: Number(controls.buoyancy.value),
      crossflow: Number(controls.crossflow.value),
      scale: 120
    };

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

    function emitParticle() {
      const n = nozzlePosition();
      const theta = (state.angleDeg * Math.PI) / 180;
      const spread = (Math.random() - 0.5) * 0.08;
      const speed = state.speed * (0.9 + Math.random() * 0.22);
      particles.push({
        x: n.x,
        y: n.y,
        vx: speed * Math.cos(theta + spread),
        vy: -speed * Math.sin(theta + spread),
        age: 0,
        concentration: 1.0,
        radius: 2.2 + Math.random() * 1.3
      });
    }

    function resetFlow() {
      particles = [];
      emissionAccumulator = 0;
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

    function drawParticles() {
      for (const p of particles) {
        const alpha = Math.max(0.03, Math.min(0.65, p.concentration * 0.8));
        const r = 22;
        const g = 93 + Math.floor(p.concentration * 110);
        const b = 158 + Math.floor(p.concentration * 68);
        ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + alpha.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function updateParticles(dt) {
      const mixingRate = 0.32;
      const radialGrowth = 0.85;
      const scale = state.scale;

      for (const p of particles) {
        p.x += (p.vx + state.crossflow) * dt * scale;
        p.y += p.vy * dt * scale + 0.5 * state.buoyancy * dt * dt * scale;
        p.vy += state.buoyancy * dt;
        p.age += dt;
        p.radius += radialGrowth * dt;
        p.concentration *= (1 - mixingRate * dt);
      }

      particles = particles.filter(function (p) {
        return p.x > -20 && p.x < canvas.width + 20 && p.y > -20 && p.y < canvas.height + 20 && p.concentration > 0.04;
      });
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
        "Particles: " + particles.length +
        "<br>Estimated rise: " + peakRise.toFixed(2) + " m" +
        "<br>Rise time: " + Math.max(0, travelTime).toFixed(2) + " s";
    }

    function frame(now) {
      const dt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;

      if (running) {
        emissionAccumulator += 48 * dt;
        while (emissionAccumulator >= 1) {
          emitParticle();
          emissionAccumulator -= 1;
        }
        updateParticles(dt);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid();
      drawCenterline();
      drawParticles();
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
