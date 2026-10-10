/* ============================================================
   Dense Jet Simulator v2
   Illustrative integral-model demonstration of an inclined
   negatively buoyant (dense) jet. NOT validated science;
   a qualitative teaching visualization only.
   ------------------------------------------------------------
   Physics sketch (Lagrangian integral model, steady centerline):
     Q  = pi b^2 u          volume flux
     M  = Q u               momentum flux (Mx, My components)
     G  = Q g'              buoyancy-deficit flux
     dQ/ds  = 2 pi b ( a_s |u - Ua cos(th)| + a_n Ua |sin(th)| )
     dMx/ds = Ua dQ/ds
     dMy/ds = - pi b^2 g'
     dG/ds  = + Q N^2 sin(th)      (stable stratification)
   Particles ride the computed centerline with Gaussian lateral
   scatter ~ b(s); after bed impact they spread as a bottom
   density current.
   ============================================================ */
(function () {
  "use strict";

  const canvas = document.getElementById("jet-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  /* ---------- controls ---------- */
  const ids = [
    "diameter", "portheight", "angle", "speed", "buoyancy",
    "crossflow", "strat", "depth", "turb", "rate", "simspeed"
  ];
  const inputs = {}, labels = {};
  for (const id of ids) {
    inputs[id] = document.getElementById(id);
    labels[id] = document.getElementById(id + "-value");
    if (!inputs[id] || !labels[id]) return;
  }
  const chkCenterline = document.getElementById("show-centerline");
  const chkEnvelope = document.getElementById("show-envelope");
  const chkMarkers = document.getElementById("show-markers");
  const runButton = document.getElementById("toggle-run");
  const resetButton = document.getElementById("reset");
  const statusEl = document.getElementById("sim-status");
  const metricEls = {
    frd: document.getElementById("m-frd"),
    rise: document.getElementById("m-rise"),
    risend: document.getElementById("m-risend"),
    xreturn: document.getElementById("m-xreturn"),
    dilution: document.getElementById("m-dilution")
  };

  const state = {};
  function readControls() {
    state.D = Number(inputs.diameter.value);        // port diameter (m)
    state.h0 = Number(inputs.portheight.value);     // port height above bed (m)
    state.theta0 = Number(inputs.angle.value) * Math.PI / 180;
    state.U0 = Number(inputs.speed.value);          // exit velocity (m/s)
    state.gp0 = Number(inputs.buoyancy.value);      // reduced gravity g' (m/s^2)
    state.Ua = Number(inputs.crossflow.value);      // ambient crossflow (m/s)
    state.N = Number(inputs.strat.value);           // buoyancy frequency (1/s)
    state.H = Number(inputs.depth.value);           // water depth (m)
    state.turb = Number(inputs.turb.value);         // visual turbulence intensity
    state.rate = Number(inputs.rate.value);         // particles per frame
    state.simspeed = Number(inputs.simspeed.value); // animation speed factor
  }

  function syncLabels() {
    labels.diameter.textContent = state.D.toFixed(2);
    labels.portheight.textContent = state.h0.toFixed(2);
    labels.angle.textContent = (state.theta0 * 180 / Math.PI).toFixed(0);
    labels.speed.textContent = state.U0.toFixed(1);
    labels.buoyancy.textContent = state.gp0.toFixed(2);
    labels.crossflow.textContent = state.Ua.toFixed(2);
    labels.strat.textContent = state.N.toFixed(2);
    labels.depth.textContent = state.H.toFixed(1);
    labels.turb.textContent = state.turb.toFixed(1);
    labels.rate.textContent = state.rate.toFixed(0);
    labels.simspeed.textContent = state.simspeed.toFixed(1);
  }

  /* ---------- world <-> canvas mapping ---------- */
  const margin = { left: 60, right: 20, top: 26, bottom: 46 };
  let pxPerM = 100, domainW = 10, portX = 1.2;

  function refreshScale() {
    pxPerM = (canvas.height - margin.top - margin.bottom) / state.H;
    domainW = (canvas.width - margin.left - margin.right) / pxPerM;
    portX = Math.min(1.2, domainW * 0.12);
  }
  function toPx(x, y) {
    return {
      x: margin.left + x * pxPerM,
      y: canvas.height - margin.bottom - y * pxPerM
    };
  }

  /* ---------- integral centerline model ---------- */
  const ALPHA_S = 0.045;   // shear entrainment coefficient (tuned for demo)
  const ALPHA_N = 0.5;     // forced (crossflow) entrainment coefficient
  const DS = 0.008;        // arc-length step (m)
  const MAX_STEPS = 6000;

  let stations = [];       // {x, y, th, u, b, S, gp}
  let model = { endMode: "none", riseY: 0, riseX: 0, xReturn: NaN, impactS: NaN, impactX: NaN, impactU: 0, impactDil: 1 };

  function computeCenterline() {
    refreshScale();
    stations = [];
    let b = state.D / 2;
    let u = Math.max(0.05, state.U0);
    let th = state.theta0;
    let Q = Math.PI * b * b * u;
    const Q0 = Q;
    let Mx = Q * u * Math.cos(th);
    let My = Q * u * Math.sin(th);
    let G = Q * state.gp0;
    let x = portX, y = state.h0;

    model = { endMode: "domain", riseY: y, riseX: x, xReturn: NaN, impactS: NaN, impactX: NaN, impactU: u, impactDil: 1 };
    let peaked = false;

    for (let i = 0; i < MAX_STEPS; i++) {
      const S = Q / Q0;
      stations.push({ x: x, y: y, th: th, u: u, b: b, S: S, gp: G / Q });

      if (y > model.riseY) { model.riseY = y; model.riseX = x; }
      if (!peaked && My < 0) peaked = true;
      if (peaked && isNaN(model.xReturn) && y <= state.h0) model.xReturn = x - portX;

      // termination checks
      if (y - b * 0.3 <= 0) { model.endMode = "bed"; break; }
      if (y + b >= state.H) { model.endMode = "surface"; break; }
      if (x > domainW + 1 || x < -1) { model.endMode = "domain"; break; }
      if (u < 0.02) { model.endMode = "stall"; break; }

      // entrainment
      const E = 2 * Math.PI * b * (
        ALPHA_S * Math.abs(u - state.Ua * Math.cos(th)) +
        ALPHA_N * state.Ua * Math.abs(Math.sin(th))
      );
      const gp = G / Q;

      Q += E * DS;
      Mx += state.Ua * E * DS;
      My += -gp * Math.PI * b * b * DS;
      G += Q * state.N * state.N * Math.sin(th) * DS;
      if (G < 0.05 * Q0 * state.gp0) G = 0.05 * Q0 * state.gp0; // keep a residual deficit

      const M = Math.max(1e-9, Math.hypot(Mx, My));
      th = Math.atan2(My, Mx);
      u = M / Q;
      b = Math.sqrt(Q / (Math.PI * Math.max(1e-6, u)));

      x += Math.cos(th) * DS;
      y += Math.sin(th) * DS;
    }

    const last = stations[stations.length - 1];
    model.impactS = (stations.length - 1) * DS;
    model.impactX = last.x;
    model.impactU = last.u;
    model.impactDil = last.S;
    updateMetrics();
  }

  function stationAt(s) {
    const i = Math.max(0, Math.min(stations.length - 1, Math.floor(s / DS)));
    return stations[i];
  }

  function updateMetrics() {
    const Frd = state.U0 / Math.sqrt(Math.max(1e-6, state.gp0 * state.D));
    const riseAbove = model.riseY - state.h0;
    metricEls.frd.textContent = Frd.toFixed(1);
    metricEls.rise.textContent = riseAbove.toFixed(2) + " m";
    metricEls.risend.textContent = (riseAbove / Math.max(1e-6, state.D * Frd)).toFixed(2);
    metricEls.xreturn.textContent = isNaN(model.xReturn) ? "-" : model.xReturn.toFixed(2) + " m";
    metricEls.dilution.textContent = model.impactDil.toFixed(0) + " : 1";

    let msg = "";
    if (model.endMode === "surface") {
      msg = "⚠ Plume reaches the free surface. Increase depth, reduce Fr, or lower the port.";
    } else if (model.endMode === "domain") {
      msg = "Plume advected out of the viewing window before reaching the bed.";
    }
    statusEl.textContent = msg;
  }

  /* ---------- particles ---------- */
  const MAX_P = 6500;
  let particles = [];

  /* soft radial sprite so overlapping particles blend into a
     continuous, fluid-looking plume */
  const sprite = document.createElement("canvas");
  sprite.width = 64; sprite.height = 64;
  (function () {
    const sctx = sprite.getContext("2d");
    const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(228, 87, 46, 0.5)");
    g.addColorStop(0.45, "rgba(228, 87, 46, 0.24)");
    g.addColorStop(1, "rgba(228, 87, 46, 0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 64, 64);
  })();

  function spawnParticles(dt) {
    const n = Math.round(state.rate * state.simspeed);
    for (let i = 0; i < n; i++) {
      if (particles.length >= MAX_P) {
        // protect the developed plume: retire the oldest settled
        // (non-jet) particle; if all are still in the jet, skip spawning
        const idx = particles.findIndex(function (q) { return q.mode !== "jet"; });
        if (idx < 0) break;
        particles.splice(idx, 1);
      }
      particles.push({
        mode: "jet",
        s: Math.random() * state.U0 * dt,
        xi: (Math.random() * 2 - 1) * 0.6,
        x: 0, y: 0, ub: 0, age: 0, dil: 1
      });
    }
  }

  function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function stepParticles(dt) {
    const sEnd = model.impactS;
    for (const p of particles) {
      p.age += dt;
      if (p.mode === "jet") {
        const st = stationAt(p.s);
        p.s += Math.max(0.04, st.u) * dt;
        p.xi += gaussian() * state.turb * 0.55 * Math.sqrt(dt);
        if (p.xi > 1.4) p.xi = 1.4;
        if (p.xi < -1.4) p.xi = -1.4;
        p.dil = st.S;
        if (p.s >= sEnd) {
          const last = stations[stations.length - 1];
          if (model.endMode === "bed") {
            p.mode = "bed";
            p.x = last.x + (Math.random() * 2 - 1) * last.b;
            p.y = Math.random() * 0.06;
            const downstreamBias = state.Ua > 0.05 ? 0.92 : 0.6;
            const dir = Math.random() < downstreamBias ? 1 : -1;
            p.ub = dir * (0.35 * last.u + 0.4 * state.Ua + 0.05);
          } else if (model.endMode === "surface") {
            p.mode = "surface";
            p.x = last.x + (Math.random() * 2 - 1) * last.b;
            p.y = state.H - 0.02 - Math.random() * 0.05;
            p.ub = 0.6 * state.Ua + 0.08;
          } else {
            p.mode = "drift";
            p.x = last.x; p.y = last.y + (Math.random() * 2 - 1) * last.b;
            p.ub = Math.max(0.05, 0.5 * last.u * Math.cos(last.th) + state.Ua);
          }
        }
      } else if (p.mode === "bed") {
        // bottom density current: decaying spreading velocity + slight thickening
        p.ub *= (1 - 0.25 * dt);
        p.x += (p.ub + (p.ub >= 0 ? 0.3 : 0.05) * state.Ua) * dt;
        p.y = Math.max(0.005, p.y + gaussian() * 0.01 * Math.sqrt(dt));
        const hMax = Math.min(0.35, 0.08 + 0.008 * p.age);   // thin bottom layer
        if (p.y > hMax) p.y = hMax;
        p.dil += 2.2 * dt * (1 + Math.abs(p.ub));
      } else if (p.mode === "surface") {
        p.x += p.ub * dt;
        p.y = Math.min(state.H - 0.01, p.y + gaussian() * 0.008);
        p.dil += 1.5 * dt;
      } else { // drift
        p.x += p.ub * dt;
        p.y += gaussian() * state.turb * 0.02;
        p.dil += 1.5 * dt;
      }
    }
    particles = particles.filter(function (p) {
      const st = p.mode === "jet" ? stationAt(p.s) : null;
      const px = st ? st.x : p.x;
      const maxAge = p.mode === "jet" ? 55 : 35;
      return px > -0.5 && px < domainW + 0.5 && p.age < maxAge && p.dil < 400;
    });
  }

  function particlePos(p) {
    if (p.mode === "jet") {
      const st = stationAt(p.s);
      const nx = -Math.sin(st.th), ny = Math.cos(st.th);
      return { x: st.x + nx * p.xi * st.b, y: st.y + ny * p.xi * st.b };
    }
    return { x: p.x, y: p.y };
  }

  /* ---------- drawing ---------- */
  function drawBackground() {
    // water body
    const grad = ctx.createLinearGradient(0, margin.top, 0, canvas.height - margin.bottom);
    grad.addColorStop(0, "#eef0f2");
    grad.addColorStop(1, "#dfe4ee");
    ctx.fillStyle = grad;
    ctx.fillRect(margin.left, margin.top, canvas.width - margin.left - margin.right, canvas.height - margin.top - margin.bottom);

    // free surface
    const ps = toPx(0, state.H);
    ctx.strokeStyle = "#2643b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const t = performance.now() / 900;
    ctx.moveTo(margin.left, ps.y);
    for (let x = margin.left; x <= canvas.width - margin.right; x += 12) {
      ctx.lineTo(x, ps.y + Math.sin(x / 46 + t) * 1.6);
    }
    ctx.stroke();

    // bed
    const pb = toPx(0, 0);
    ctx.fillStyle = "#dccfae";
    ctx.fillRect(margin.left, pb.y, canvas.width - margin.left - margin.right, canvas.height - margin.bottom - pb.y + 8);
    ctx.strokeStyle = "#141414";
    ctx.beginPath();
    ctx.moveTo(margin.left, pb.y);
    ctx.lineTo(canvas.width - margin.right, pb.y);
    ctx.stroke();
  }

  function drawAxes() {
    ctx.save();
    ctx.strokeStyle = "rgba(20,20,20,0.6)";
    ctx.fillStyle = "rgba(20,20,20,0.85)";
    ctx.lineWidth = 1.2;
    ctx.font = "13px 'Public Sans', sans-serif";

    // x ticks every 1 m along the bed
    const pb = toPx(0, 0);
    for (let xm = 0; xm <= domainW; xm += 1) {
      const p = toPx(xm, 0);
      ctx.beginPath(); ctx.moveTo(p.x, pb.y); ctx.lineTo(p.x, pb.y + 6); ctx.stroke();
      ctx.fillText(String(xm), p.x - 4, pb.y + 22);
    }
    ctx.fillText("x (m)", canvas.width - margin.right - 44, pb.y + 38);

    // y ticks every 0.5 m
    for (let ym = 0; ym <= state.H + 0.001; ym += 0.5) {
      const p = toPx(0, ym);
      ctx.beginPath(); ctx.moveTo(margin.left - 6, p.y); ctx.lineTo(margin.left, p.y); ctx.stroke();
      ctx.fillText(ym.toFixed(1), margin.left - 42, p.y + 4);
    }
    ctx.save();
    ctx.translate(16, margin.top + 46);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("z (m)", 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function drawPort() {
    const p = toPx(portX, state.h0);
    const pb = toPx(portX, 0);
    ctx.save();
    // riser
    ctx.strokeStyle = "#45413b";
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(pb.x, pb.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    // nozzle aligned with release angle
    ctx.translate(p.x, p.y);
    ctx.rotate(-state.theta0);
    ctx.fillStyle = "#141414";
    ctx.fillRect(-4, -5, 20, 10);
    ctx.restore();
  }

  function drawCenterline() {
    if (!chkCenterline.checked || stations.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(20,20,20,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < stations.length; i += 4) {
      const p = toPx(stations[i].x, stations[i].y);
      if (first) { ctx.moveTo(p.x, p.y); first = false; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawEnvelope() {
    if (!chkEnvelope.checked || stations.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(20,20,20,0.35)";
    ctx.lineWidth = 1.4;
    for (const side of [1, -1]) {
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < stations.length; i += 4) {
        const st = stations[i];
        const nx = -Math.sin(st.th), ny = Math.cos(st.th);
        const p = toPx(st.x + side * nx * st.b, st.y + side * ny * st.b);
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMarkers() {
    if (!chkMarkers.checked) return;
    ctx.save();
    ctx.font = "12px 'Public Sans', sans-serif";

    // terminal rise
    const pr = toPx(model.riseX, model.riseY);
    ctx.strokeStyle = "rgba(162,85,31,0.85)";
    ctx.fillStyle = "rgba(162,85,31,0.95)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pr.x - 26, pr.y); ctx.lineTo(pr.x + 26, pr.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText("terminal rise", pr.x + 30, pr.y + 4);

    // impact / return point
    if (model.endMode === "bed") {
      const pi = toPx(model.impactX, 0);
      ctx.beginPath();
      ctx.arc(pi.x, pi.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText("impact point", pi.x - 30, pi.y - 10);
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const pos = particlePos(p);
      const c = toPx(pos.x, pos.y);
      if (c.x < margin.left - 30 || c.x > canvas.width - margin.right + 30) continue;
      const conc = 1 / Math.max(1, p.dil);           // 1 at source -> 0 far away

      // sprite radius follows the local physical plume scale
      let rM;
      if (p.mode === "jet") {
        rM = stationAt(p.s).b * 0.55;
      } else if (p.mode === "bed") {
        rM = 0.04 + 0.010 * p.age;                   // thin spreading bottom current
      } else {
        rM = 0.04 + 0.008 * p.age;
      }
      const r = Math.max(4, Math.min(42, rM * pxPerM));
      ctx.globalAlpha = Math.max(0.06, Math.min(0.5, 0.10 + conc * 0.7));
      ctx.drawImage(sprite, c.x - r, c.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /* ---------- main loop ---------- */
  let running = true;
  let lastTime = performance.now();

  function frame(now) {
    const rawDt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    const dt = rawDt * state.simspeed;

    if (running) {
      spawnParticles(rawDt);
      stepParticles(dt);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawAxes();
    drawEnvelope();
    drawParticles();
    drawCenterline();
    drawMarkers();
    drawPort();
    requestAnimationFrame(frame);
  }

  /* ---------- wiring ---------- */
  function onChange() {
    readControls();
    syncLabels();
    computeCenterline();
  }
  for (const id of ids) inputs[id].addEventListener("input", onChange);

  document.querySelectorAll("[data-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const pr = btn.getAttribute("data-preset");
      if (pr === "30") { inputs.angle.value = 30; }
      if (pr === "45") { inputs.angle.value = 45; }
      if (pr === "60") { inputs.angle.value = 60; }
      if (pr === "crossflow") { inputs.crossflow.value = 0.8; inputs.angle.value = 60; }
      if (pr === "stratified") { inputs.strat.value = 0.25; inputs.crossflow.value = 0.05; }
      if (pr === "defaults") {
        inputs.diameter.value = 0.06; inputs.portheight.value = 0.3;
        inputs.angle.value = 60; inputs.speed.value = 2.0;
        inputs.buoyancy.value = 0.25; inputs.crossflow.value = 0;
        inputs.strat.value = 0; inputs.depth.value = 2.5;
        inputs.turb.value = 1.0; inputs.rate.value = 3; inputs.simspeed.value = 1.0;
      }
      onChange();
      particles = [];
    });
  });

  runButton.addEventListener("click", function () {
    running = !running;
    runButton.textContent = running ? "Pause" : "Run";
  });
  resetButton.addEventListener("click", function () {
    particles = [];
  });

  onChange();
  requestAnimationFrame(function (t) { lastTime = t; frame(t); });
})();
