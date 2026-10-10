/* ============================================================
   Microplastic Journey: schematic river-to-lake fate simulator
   Illustrative, qualitative visualization only. NOT based on
   real scientific data; not validated; for outreach/teaching.
   ------------------------------------------------------------
   Processes sketched:
     advection (log-like velocity profile, quiescent lake)
     turbulent random-walk mixing
     polymer-dependent buoyancy (rise / settle)
     biofouling -> gradual density gain -> settling of floaters
     vegetation canopy: flow reduction + particle trapping
     sedimentation on river / lake bed, resuspension by shear
     storm events: elevated flow, mixing, and resuspension
   Fate budget tracked live: drifting, trapped, settled, exported.
   ============================================================ */
(function () {
  "use strict";

  const canvas = document.getElementById("mp-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width, H = canvas.height;

  /* ---------- geometry (canvas units) ---------- */
  const SURF = H * 0.16;                 // water surface
  const RIVER_END = W * 0.60;            // river/lake transition
  const OUTLET = W - 6;
  function bedAt(x) {
    if (x < RIVER_END) {
      return H * 0.62 + (x / RIVER_END) * H * 0.04;   // gently sloping river bed
    }
    const t = Math.min(1, (x - RIVER_END) / (W * 0.13));
    const ease = t * t * (3 - 2 * t);
    return H * 0.66 + ease * (H * 0.86 - H * 0.66);   // drop into lake basin
  }
  const VEG = { x0: W * 0.30, x1: W * 0.43 };         // vegetation patch
  function vegTop(x) { return bedAt(x) - (bedAt(x) - SURF) * 0.42; }
  function inVeg(x, y) { return x >= VEG.x0 && x <= VEG.x1 && y >= vegTop(x); }

  /* ---------- polymers ---------- */
  const POLYMERS = {
    PE:  { rho: 0.95, color: "#2643b8", name: "Polyethylene (ρ≈0.95)" },
    PP:  { rho: 0.90, color: "#66772a", name: "Polypropylene (ρ≈0.90)" },
    PS:  { rho: 1.05, color: "#b07d2b", name: "Polystyrene (ρ≈1.05)" },
    PET: { rho: 1.38, color: "#e4572e", name: "PET (ρ≈1.38)" },
    PVC: { rho: 1.40, color: "#141414", name: "PVC (ρ≈1.40)" }
  };
  const POLY_KEYS = Object.keys(POLYMERS);

  /* ---------- controls ---------- */
  const el = function (id) { return document.getElementById(id); };
  const ctl = {
    polymer: el("polymer"), size: el("size"), flow: el("flow"),
    turb: el("mp-turb"), veg: el("vegdens"), fouling: el("fouling"),
    release: el("release-depth"), rate: el("mp-rate")
  };
  const lab = {
    size: el("size-value"), flow: el("flow-value"), turb: el("mp-turb-value"),
    veg: el("vegdens-value"), fouling: el("fouling-value"), rate: el("mp-rate-value")
  };
  const runBtn = el("mp-toggle-run"), resetBtn = el("mp-reset"), stormBtn = el("mp-storm");
  const chkLabels = el("mp-show-labels");
  for (const k in ctl) if (!ctl[k]) return;
  if (!runBtn || !resetBtn || !stormBtn || !chkLabels) return;

  const fateEls = {
    drifting: { fill: el("f-drift"), count: el("c-drift") },
    trapped:  { fill: el("f-veg"),   count: el("c-veg") },
    riverbed: { fill: el("f-river"), count: el("c-river") },
    lakebed:  { fill: el("f-lake"),  count: el("c-lake") },
    exported: { fill: el("f-out"),   count: el("c-out") }
  };

  const state = {};
  function readControls() {
    state.polymer = ctl.polymer.value;
    state.size = Number(ctl.size.value);        // mm (visual)
    state.flow = Number(ctl.flow.value);        // nominal surface speed factor
    state.turb = Number(ctl.turb.value);
    state.veg = Number(ctl.veg.value);
    state.fouling = Number(ctl.fouling.value);  // 0 = off
    state.release = ctl.release.value;          // surface | mid | bed
    state.rate = Number(ctl.rate.value);
    lab.size.textContent = state.size.toFixed(1);
    lab.flow.textContent = state.flow.toFixed(1);
    lab.turb.textContent = state.turb.toFixed(1);
    lab.veg.textContent = state.veg.toFixed(1);
    lab.fouling.textContent = state.fouling === 0 ? "off" : state.fouling.toFixed(1);
    lab.rate.textContent = state.rate.toFixed(0);
  }
  for (const k in ctl) ctl[k].addEventListener("input", readControls);
  readControls();

  /* ---------- particles & fate accounting ---------- */
  const MAX_P = 2600;
  let particles = [];
  let counts = { drifting: 0, trapped: 0, riverbed: 0, lakebed: 0, exported: 0 };
  let released = 0;
  let storm = 0;               // seconds of storm remaining
  let running = true;

  function pickPolymer() {
    if (state.polymer === "MIX") {
      return POLY_KEYS[Math.floor(Math.random() * POLY_KEYS.length)];
    }
    return state.polymer;
  }

  function releaseY() {
    const x = W * 0.045;
    const depth = bedAt(x) - SURF;
    if (state.release === "surface") return SURF + depth * 0.08;
    if (state.release === "bed") return SURF + depth * 0.88;
    return SURF + depth * 0.5;
  }

  function spawn(x, y, burst) {
    if (particles.length >= MAX_P) {
      // recycle the oldest settled particle first, else the oldest
      let idx = particles.findIndex(function (p) { return p.state !== "drift"; });
      if (idx < 0) idx = 0;
      particles.splice(idx, 1);
    }
    const key = pickPolymer();
    particles.push({
      x: x, y: y,
      pol: key,
      rho: POLYMERS[key].rho + (Math.random() - 0.5) * 0.02,
      d: state.size * (0.6 + Math.random() * 0.8),
      foul: 0,
      state: "drift",
      age: 0,
      wob: Math.random() * Math.PI * 2,
      burst: !!burst
    });
    released++;
  }

  function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* velocity field: log-like profile in river, quiescent lake */
  function flowU(x, y) {
    const bed = bedAt(x);
    const frac = Math.min(1, Math.max(0, (y - SURF) / (bed - SURF))); // 0 surface, 1 bed
    let u = state.flow * (46 - 30 * Math.pow(frac, 1.6));             // px/s
    if (x >= RIVER_END) {
      const t = Math.min(1, (x - RIVER_END) / (W * 0.18));
      u *= (1 - t) * 0.55 + 0.18;                                     // decays into a through-flowing lake
    }
    if (inVeg(x, y)) u *= (1 - 0.72 * state.veg);                     // canopy drag
    if (storm > 0) u *= 2.1;
    return u;
  }

  function settleVel(p) {
    // toy Stokes-like: w ~ (rho_eff - 1) * d^1.6  (px/s), capped
    const rhoEff = p.rho + p.foul;
    let w = 14 * (rhoEff - 1.0) * Math.pow(p.d, 1.6);
    return Math.max(-26, Math.min(34, w));
  }

  function step(dt) {
    if (storm > 0) storm -= dt;

    const spawnN = state.rate * dt;
    let acc = spawnN;
    while (acc > 1) { spawn(W * 0.045, releaseY() + (Math.random() - 0.5) * 14); acc -= 1; }
    if (Math.random() < acc) spawn(W * 0.045, releaseY() + (Math.random() - 0.5) * 14);

    counts.drifting = 0; counts.trapped = 0; counts.riverbed = 0; counts.lakebed = 0;

    const turbAmp = state.turb * (storm > 0 ? 3 : 1);

    for (const p of particles) {
      p.age += dt;
      const bed = bedAt(p.x);

      if (p.state === "drift") {
        // biofouling: slow density gain (only meaningful for floaters)
        if (state.fouling > 0) p.foul = Math.min(0.5, p.foul + state.fouling * dt * 0.006);

        const u = flowU(p.x, p.y);
        const w = settleVel(p);
        const inRiver = p.x < RIVER_END;
        const mixing = turbAmp * (inRiver ? 15 : 5);

        p.x += u * dt + gaussian() * mixing * 0.35 * Math.sqrt(dt);
        p.y += w * dt + gaussian() * mixing * Math.sqrt(dt);

        // surface / bed constraints
        if (p.y < SURF + 3) {
          p.y = SURF + 3 + Math.abs(Math.sin(p.wob + p.age * 2)) * 1.5; // bobbing floaters
        }
        if (p.y >= bed - 2) {
          if (settleVel(p) > 0) {
            p.state = p.x < RIVER_END ? "riverbed" : "lakebed";
            p.y = bed - 2;
          } else {
            p.y = bed - 3;
          }
        }
        // vegetation trapping
        if (inVeg(p.x, p.y) && Math.random() < state.veg * 1.1 * dt) {
          p.state = "trapped";
        }
        // outlet
        if (p.x >= OUTLET) { p.state = "exported"; counts.exported++; }
        if (p.x < 4) p.x = 4;
      } else if (p.state === "trapped") {
        p.y += Math.sin(p.age * 3 + p.wob) * 0.15;
        // occasional washout, more likely in storms
        const rel = (storm > 0 ? 0.25 : 0.015) * dt;
        if (Math.random() < rel) p.state = "drift";
      } else if (p.state === "riverbed" || p.state === "lakebed") {
        // resuspension by bed shear: river only (lake is quiescent)
        if (p.state === "riverbed") {
          const pr = (storm > 0 ? 0.5 : 0.02 * state.turb * state.flow) * dt;
          if (Math.random() < pr) { p.state = "drift"; p.y -= 6; }
        }
      }

      if (p.state === "drift") counts.drifting++;
      else if (p.state === "trapped") counts.trapped++;
      else if (p.state === "riverbed") counts.riverbed++;
      else if (p.state === "lakebed") counts.lakebed++;
    }

    // exported particles leave the domain
    let exportedNow = 0;
    particles = particles.filter(function (p) {
      if (p.state === "exported") { exportedNow++; return false; }
      return true;
    });
    counts.exportedTotal = (counts.exportedTotal || 0) + exportedNow;
  }

  /* ---------- drawing ---------- */
  function drawScene() {
    // sky strip
    ctx.fillStyle = "#f7f3eb";
    ctx.fillRect(0, 0, W, SURF);

    // water
    const grad = ctx.createLinearGradient(0, SURF, 0, H);
    grad.addColorStop(0, "#e3e8f1");
    grad.addColorStop(1, "#c9d3e6");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, SURF);
    ctx.lineTo(W, SURF);
    ctx.lineTo(W, H); ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // bed / sediment
    ctx.fillStyle = "#dccfae";
    ctx.beginPath();
    ctx.moveTo(0, bedAt(0));
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, bedAt(x));
    ctx.lineTo(W, H); ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bedAt(0));
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, bedAt(x));
    ctx.stroke();

    // animated water surface
    const t = performance.now() / 800;
    ctx.strokeStyle = "#2643b8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, SURF);
    for (let x = 0; x <= W; x += 10) {
      ctx.lineTo(x, SURF + Math.sin(x / 42 + t) * (storm > 0 ? 5 : 2));
    }
    ctx.stroke();

    // vegetation
    const stems = Math.round(6 + state.veg * 26);
    ctx.strokeStyle = "rgba(46,125,73,0.75)";
    ctx.lineWidth = 3;
    for (let i = 0; i < stems; i++) {
      const x = VEG.x0 + ((i + 0.5) / stems) * (VEG.x1 - VEG.x0);
      const yb = bedAt(x);
      const yt = vegTop(x);
      const sway = Math.sin(t * 1.3 + i) * 6 * (storm > 0 ? 2 : 1);
      ctx.beginPath();
      ctx.moveTo(x, yb);
      ctx.quadraticCurveTo(x + sway * 0.4, (yb + yt) / 2, x + sway, yt);
      ctx.stroke();
    }

    // outfall pipe
    const ry = releaseY();
    ctx.fillStyle = "#45413b";
    ctx.fillRect(0, ry - 7, W * 0.04, 14);
    ctx.fillStyle = "#141414";
    ctx.fillRect(W * 0.04 - 4, ry - 9, 8, 18);

    // region captions
    ctx.font = "600 15px 'Public Sans', sans-serif";
    ctx.fillStyle = "rgba(31,41,55,0.55)";
    ctx.fillText("RIVER", W * 0.26, SURF - 12);
    ctx.fillText("LAKE", W * 0.80, SURF - 12);
    ctx.fillText("outlet →", W - 92, SURF + 26);

    if (storm > 0) {
      ctx.fillStyle = "rgba(162,85,31,0.9)";
      ctx.font = "700 17px 'Public Sans', sans-serif";
      ctx.fillText("⛈ STORM EVENT: elevated flow, mixing & resuspension", W * 0.28, 30);
    }
  }

  function drawLabels() {
    if (!chkLabels.checked) return;
    ctx.save();
    ctx.font = "italic 14px 'Newsreader', serif";
    ctx.fillStyle = "rgba(14,90,122,0.85)";
    ctx.strokeStyle = "rgba(14,90,122,0.5)";
    ctx.lineWidth = 1.2;

    function note(x, y, tx, ty, text) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillText(text, tx + 4, ty + 4);
    }
    note(W * 0.14, SURF + 26, W * 0.10, SURF + 56, "advection");
    note(W * 0.22, (SURF + bedAt(W * 0.22)) / 2, W * 0.17, (SURF + bedAt(W * 0.2)) / 2 + 40, "turbulent mixing");
    note((VEG.x0 + VEG.x1) / 2, vegTop((VEG.x0 + VEG.x1) / 2) + 16, VEG.x1 + 14, vegTop(VEG.x1) - 14, "vegetation trapping");
    note(W * 0.50, SURF + 40, W * 0.47, SURF + 82, "biofouling → density gain → settling");
    note(W * 0.53, bedAt(W * 0.53) - 10, W * 0.50, bedAt(W * 0.53) - 46, "sedimentation & resuspension");
    note(W * 0.80, H * 0.80, W * 0.72, H * 0.72, "quiescent deposition (lake sink)");
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const c = POLYMERS[p.pol].color;
      const r = 2 + p.d * 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (p.state === "riverbed" || p.state === "lakebed") {
        ctx.fillStyle = c + "66";
      } else if (p.state === "trapped") {
        ctx.fillStyle = c + "aa";
      } else {
        ctx.fillStyle = c;
      }
      ctx.fill();
      // fouling halo on drifting particles
      if (p.foul > 0.04 && p.state === "drift") {
        ctx.strokeStyle = "rgba(72,112,58," + Math.min(0.8, p.foul * 2.4) + ")";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
  }

  function updateFateBars() {
    const total = Math.max(1, released);
    const data = {
      drifting: counts.drifting,
      trapped: counts.trapped,
      riverbed: counts.riverbed,
      lakebed: counts.lakebed,
      exported: counts.exportedTotal || 0
    };
    for (const key in fateEls) {
      const n = data[key] || 0;
      fateEls[key].fill.style.width = Math.min(100, (n / total) * 100).toFixed(1) + "%";
      fateEls[key].count.textContent = String(n);
    }
  }

  /* ---------- main loop ---------- */
  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (running) step(dt);
    ctx.clearRect(0, 0, W, H);
    drawScene();
    drawParticles();
    drawLabels();
    updateFateBars();
    requestAnimationFrame(frame);
  }

  /* ---------- interaction ---------- */
  canvas.addEventListener("pointerdown", function (e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width);
    const y = (e.clientY - r.top) * (H / r.height);
    if (y > SURF + 4 && y < bedAt(x) - 4) {
      for (let i = 0; i < 30; i++) {
        spawn(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 18, true);
      }
    }
  });

  runBtn.addEventListener("click", function () {
    running = !running;
    runBtn.textContent = running ? "Pause" : "Run";
  });
  resetBtn.addEventListener("click", function () {
    particles = [];
    released = 0;
    counts = { drifting: 0, trapped: 0, riverbed: 0, lakebed: 0, exported: 0, exportedTotal: 0 };
  });
  stormBtn.addEventListener("click", function () { storm = 6; });

  requestAnimationFrame(function (t) { lastTime = t; frame(t); });
})();
