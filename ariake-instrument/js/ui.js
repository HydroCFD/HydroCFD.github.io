// Wiring: the station table, the controls, running the instrument and
// drawing the answers.
(function (global) {
  "use strict";

  var S = {
    months: [3, 9], stations: [], cv: 0.5, unit: "raw", limit: null,
    showPlan: false, showBackground: false, showGain: false,
    showSources: false, showAttrib: false, srcW: null,
    result: null, display: 9,
    demo: null
  };
  var inst, mapIn, mapRec, mapSd, meta, arr;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  // ---------------------------------------------------------------- start
  function boot() {
    var b = Bundle.load();
    meta = b.meta;
    arr = b.a;
    inst = new Instrument(b);
    global.INST = inst;
    mapIn = new MapView($("map"), meta, arr);
    mapRec = new MapView($("mapRec"), meta, arr);
    mapSd = new MapView($("mapSd"), meta, arr);

    fillMonths($("month1"), 3);
    fillMonths($("month2"), 9);
    $("month1").onchange = $("month2").onchange = function () {
      S.months = [+$("month1").value, +$("month2").value];
      fillDisplay();
      clearResult();
      drawInput();
    };
    fillDisplay();
    $("displayMonth").onchange = function () {
      S.display = +$("displayMonth").value;
      if (S.result) drawResult();
    };
    $("unit").onchange = function () {
      S.unit = $("unit").value;
      $("unitHint").textContent = S.unit === "raw"
        ? "Type the suspended microplastic concentration you measured at "
        + "each station, in whatever unit your laboratory reported, for "
        + "example pieces per cubic metre. The unit itself does not matter, "
        + "only that every station uses the same one. The instrument reads "
        + "the pattern across your stations, and solves for the scale as an "
        + "unknown."
        : "Expert mode. Type the base ten logarithm of the concentration "
        + "already divided by the bay total, the quantity the instrument "
        + "works in. Values normally fall between -6 and -3. No scale is "
        + "solved for.";
      renderTable();
      clearResult();
    };
    $("cv").oninput = function () {
      S.cv = +$("cv").value;
      $("cvLabel").textContent = S.cv.toFixed(2);
      clearResult();
    };
    $("limit").oninput = function () {
      var v = parseFloat($("limit").value);
      S.limit = isFinite(v) ? v : null;
      clearResult();
    };
    $("showPlan").onchange = function () {
      S.showPlan = $("showPlan").checked;
      drawInput();
    };
    $("showBg").onchange = function () {
      S.showBackground = $("showBg").checked;
      if (S.showBackground) {
        $("showGain").checked = S.showGain = false;
        $("showAttrib").checked = S.showAttrib = false;
      }
      drawInput();
    };
    $("showGain").onchange = function () {
      S.showGain = $("showGain").checked;
      if (S.showGain) {
        $("showBg").checked = S.showBackground = false;
        $("showAttrib").checked = S.showAttrib = false;
      }
      drawInput();
    };
    $("showSources").onchange = function () {
      S.showSources = $("showSources").checked;
      if (S.showSources) withSources(drawInput); else drawInput();
    };
    $("showAttrib").onchange = function () {
      S.showAttrib = $("showAttrib").checked;
      if (S.showAttrib) {
        $("showBg").checked = S.showBackground = false;
        $("showGain").checked = S.showGain = false;
        withSources(drawInput);
      } else drawInput();
    };
    $("saveSurvey").onclick = saveSurvey;
    $("loadSurvey").onclick = function () { $("loadFile").click(); };
    $("loadFile").onchange = function (ev) {
      var f = ev.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { openSurvey(rd.result); };
      rd.readAsText(f);
      ev.target.value = "";
    };
    $("exportField").onclick = exportField;
    $("printPage").onclick = function () { hideTip(); window.print(); };
    $("run").onclick = run;
    $("clear").onclick = function () {
      S.stations = [];
      S.demo = null;
      S.example = null;
      clearResult();
      renderTable();
      drawInput();
    };
    $("usePlan").onclick = function () {
      S.stations = [];
      var p = arr.plan_stations;
      for (var i = 0; i < p.length; i++) addStation(p[i]);
      renderTable();
      drawInput();
    };
    buildGallery();
    $("loadExample").onclick = function () {
      loadExample($("exampleSel").value);
    };
    $("exampleSel").onchange = function () {
      var e = exampleById($("exampleSel").value);
      $("exampleDesc").textContent = e ? e.desc : "";
    };
    $("helpToggle").onclick = function () {
      var on = document.body.classList.toggle("help-on");
      $("helpToggle").textContent = on ? "Hide help" : "Show help";
      sizeAll();
    };

    $("map").addEventListener("click", function (ev) {
      var r = $("map").getBoundingClientRect(),
        px = (ev.clientX - r.left) * $("map").width / r.width,
        py = (ev.clientY - r.top) * $("map").height / r.height,
        cell = mapIn.pick(px, py);
      if (cell === null) return;
      if (S.stations.length >= 20) { warn("Twenty stations is the limit."); return; }
      addStation(cell);
      renderTable();
      drawInput();
    });


    // hover readouts on every map
    mapIn.onHover(function (cell) {
      var head = "<b>" + arr.lon[cell].toFixed(3) + "&deg;E, "
        + arr.lat[cell].toFixed(3) + "&deg;N</b>";
      if (S.showAttrib && S.domCache) {
        var d = S.domCache, cc = d.cellOf[cell];
        if (cc < 0 || !d.cache[cc]) return head + "<br>no source data here";
        var m = d.cache[cc].mix, ord = rank(m), fm = srcFamMix();
        var t = head + "<br>largest source <b>" + Sources.label(ord[0])
          + "</b> at " + (100 * m[ord[0]]).toFixed(0) + "%"
          + "<br>leads in " + (100 * m.pTop).toFixed(0) + "% of scenarios"
          + "<br>that plastic is " + days(Sources.transit(cc, ord[0], fm))
          + " old";
        if (m[ord[1]] > 0.02) {
          t += "<br>then " + Sources.label(ord[1]) + " at "
            + (100 * m[ord[1]]).toFixed(0) + "%";
          var sp = Sources.separation(cc, ord[0], ord[1], fm);
          if (sp) t += "<br>the two are " + days(sp.gap) + " apart in age"
            + (sp.ok ? "" : ", too close to separate");
        }
        return t;
      }
      if (S.showGain && mapIn.state.values) {
        var g = mapIn.state.values[cell];
        return head + (isFinite(g)
          ? "<br>a station here is worth <b>" + g.toFixed(0)
            + "</b> out of 100"
          : "<br>not a candidate: too often empty, or on the open boundary");
      }
      if (S.showBackground && mapIn.state.values)
        return head + "<br>campaign average "
          + mapIn.state.values[cell].toFixed(2) + " (log10, normalized)";
      return head + "<br>click to place a station";
    });
    mapRec.onHover(function (cell) { return fieldTip(cell, true); });
    mapSd.onHover(function (cell) { return fieldTip(cell, false); });

    window.addEventListener("resize", function () { sizeAll(); });
    sizeAll();
    renderTable();
    $("built").textContent = meta.built;
    $("trainCount").textContent = meta.n_train;
    var cm = meta.classifier_meta || {};
    var note = "The two networks here were retrained for this page so that "
      + "any pair of months can be chosen. The paper's own classifier was "
      + "trained at fixed visit times, so its published accuracy is not the "
      + "same number as the one below. The closed-form evidence is unchanged "
      + "from the paper.";
    if (cm.family && cm.family.by_months && cm.family.by_months["Apr+Oct"]) {
      note += " On held-out scenarios at six stations and two visits these "
        + "networks are right "
        + cm.family.by_months["Apr+Oct"].acc.toFixed(2) + " of the time, and "
        + cm.family.by_months["Apr+Oct"].reliability_p90.toFixed(2)
        + " of the time when they report confidence.";
    }
    $("clsNote").textContent = note;
  }

  function fillMonths(sel, def) {
    for (var i = 0; i < meta.months.length; i++) {
      var o = el("option", null, meta.months[i]);
      o.value = i;
      sel.appendChild(o);
    }
    sel.value = def;
  }

  // Every month of the year can be shown, not only the two that were
  // sampled: the fifteen patterns describe the whole year jointly, so the
  // readings imply a field in every month. The unsampled ones simply carry
  // more uncertainty, which the second map shows.
  function fillDisplay() {
    var sel = $("displayMonth"), i, o;
    sel.innerHTML = "";
    for (i = 0; i < meta.months.length; i++) {
      var visited = S.months.indexOf(i) >= 0;
      o = el("option", null, meta.months[i] + (visited ? "  (sampled)" : ""));
      o.value = i;
      sel.appendChild(o);
    }
    if (S.months.indexOf(S.display) < 0) S.display = S.months[1];
    sel.value = S.display;
  }


  function sizeAll() {
    ["map", "mapRec", "mapSd", "mapTruth"].forEach(function (id) {
      var c = $(id), w = Math.max(240, c.parentElement.clientWidth);
      fitCanvas(c, w, Math.round(w * 1.16));
    });
    drawInput();
    if (S.result) drawResult();
  }

  function addStation(cell) {
    for (var i = 0; i < S.stations.length; i++)
      if (S.stations[i].cell === cell) return;
    S.stations.push({ cell: cell, v: [null, null], cens: [false, false] });
    clearResult();
  }

  // --------------------------------------------------------------- table
  function renderTable() {
    var t = $("tbody");
    t.innerHTML = "";
    if (!S.stations.length) {
      var tr = el("tr");
      var td = el("td", "empty",
        "Click the map to place a station, or load an example below.");
      td.colSpan = 6;
      tr.appendChild(td);
      t.appendChild(tr);
      return;
    }
    S.stations.forEach(function (st, i) {
      var tr = el("tr");
      tr.appendChild(el("td", "num", String(i + 1)));
      tr.appendChild(el("td", "coord",
        arr.lon[st.cell].toFixed(3) + "°E"));
      tr.appendChild(el("td", "coord",
        arr.lat[st.cell].toFixed(3) + "°N"));
      [0, 1].forEach(function (v) {
        var td = el("td"), inp = document.createElement("input");
        inp.type = "text";
        inp.className = "val";
        inp.value = st.v[v] === null ? "" : st.v[v];
        inp.placeholder = S.unit === "raw" ? "conc." : "log10";
        inp.oninput = function () {
          var x = parseFloat(inp.value);
          st.v[v] = isFinite(x) ? x : null;
          clearResult();
        };
        var lab = el("label", "cens");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = st.cens[v];
        cb.title = "below the detection limit";
        cb.onchange = function () { st.cens[v] = cb.checked; clearResult(); };
        lab.appendChild(cb);
        lab.appendChild(el("span", null, "<lim"));
        td.appendChild(inp);
        td.appendChild(lab);
        tr.appendChild(td);
      });
      var td2 = el("td");
      var del = el("button", "del", "×");
      del.onclick = function () {
        S.stations.splice(i, 1);
        clearResult();
        renderTable();
        drawInput();
      };
      td2.appendChild(del);
      tr.appendChild(td2);
      t.appendChild(tr);
    });
  }

  // -------------------------------------------------------------- drawing
  function drawInput() {
    if (!mapIn) return;
    if (S.showAttrib && Sources.ready()) {
      var wS = srcWeights(),
        dom = Sources.dominanceField(inst, arr, S.display, wS);
      S.domCache = dom;
      // stretch the colours over the range actually present, or almost the
      // whole bay sits at the pale middle of the scale and nothing shows
      var dfin = [], q;
      for (q = 0; q < dom.length; q++) if (isFinite(dom[q])) dfin.push(dom[q]);
      var dl = quantiles(new Float64Array(dfin), 0.05, 0.95);
      mapIn.setField(dom, dl[0], dl[1]);
      colourbar($("cbIn"), dl[0], dl[1],
        "share of the largest source, " + meta.months[S.display],
        function (v) { return (100 * v).toFixed(0) + "%"; });
      $("cbIn").style.visibility = "visible";
    } else if (S.showGain) {
      var placed = [], k;
      for (k = 0; k < S.stations.length; k++) placed.push(S.stations[k].cell);
      var post = S.result ? S.result.post : inst.priorPost(),
        g = inst.gainField(post, S.display, placed, S.cv), best = 0;
      for (k = 0; k < g.length; k++) if (isFinite(g[k]) && g[k] > best) best = g[k];
      // as a share of the best place available, which is what a reader can use
      for (k = 0; k < g.length; k++) if (isFinite(g[k])) g[k] = 100 * g[k] / best;
      mapIn.setField(g, 0, 100);
      colourbar($("cbIn"), 0, 100,
        "value of one more station in " + meta.months[S.display]
        + ", 100 = the best place",
        function (v) { return v.toFixed(0); });
      $("cbIn").style.visibility = "visible";
    } else if (S.showBackground) {
      var m = S.display, nW = inst.nWet,
        base = m * nW, v = new Float64Array(nW), i;
      for (i = 0; i < nW; i++) v[i] = inst.xbar[base + i];
      var lim = quantiles(v, 0.02, 0.995);
      mapIn.setField(v, lim[0], lim[1]);
      colourbar($("cbIn"), lim[0], lim[1],
        "campaign mean, log10 of the normalized concentration");
      $("cbIn").style.visibility = "visible";
    } else {
      mapIn.setField(null);
      $("cbIn").style.visibility = "hidden";
    }
    mapIn.render({
      stations: S.stations,
      plan: S.showPlan ? planMarkers() : null,
      sources: S.showSources && Sources.ready() ? sourceMarkers() : null,
      next: S.result && S.result.next ? S.result.next.station : null
    });
  }

  function planMarkers() {
    var out = [], p = arr.plan_stations, i;
    for (i = 0; i < p.length; i++) out.push({ cell: p[i], label: i + 1 });
    return out;
  }

  function quantiles(v, lo, hi) {
    var s = Array.prototype.slice.call(v).sort(function (a, b) {
      return a - b;
    });
    return [s[Math.floor(lo * (s.length - 1))],
    s[Math.floor(hi * (s.length - 1))]];
  }

  function medianOf(v) {
    var s = Array.prototype.slice.call(v).sort(function (a, b) {
      return a - b;
    });
    return s[Math.floor(0.5 * (s.length - 1))];
  }

  // A colour bar tick in the user's own unit rather than as a logarithm
  function linFmt(v) {
    var x = Math.pow(10, v);
    if (x >= 1000 || x < 0.01) return x.toExponential(1);
    if (x >= 100) return x.toFixed(0);
    if (x >= 1) return x.toFixed(1);
    return x.toPrecision(2);
  }

  // ----------------------------------------------------------------- run
  function gather() {
    var rows = [], y = [], cens = [], any = false, i, v, m;
    for (m = 0; m < 2; m++) {
      for (i = 0; i < S.stations.length; i++) {
        var st = S.stations[i];
        if (st.v[m] === null) continue;
        v = st.v[m];
        if (S.unit === "raw") {
          if (!(v > 0)) return { error: "Concentrations must be positive." };
          v = Math.log10(v);
        }
        rows.push(inst.rowOf(st.cell, S.months[m]));
        y.push(v);
        cens.push(!!st.cens[m]);
        if (st.cens[m]) any = true;
      }
    }
    return { rows: rows, y: y, cens: cens, anyCens: any };
  }

  function run() {
    var g = gather();
    if (g.error) { warn(g.error); return; }
    if (g.rows.length < 2) {
      warn("Enter at least two readings before running.");
      return;
    }
    var offset = S.unit === "raw", i,
      y = g.y.slice(), centre = 0, limit = S.limit;
    if (S.unit === "raw" && limit !== null && limit > 0)
      limit = Math.log10(limit);
    if (offset) {
      // centre the unknown scale on the data, so any unit is accepted
      var my = 0, mx = 0, n = 0;
      for (i = 0; i < y.length; i++) {
        if (g.cens[i]) continue;
        my += y[i]; mx += inst.xbar[g.rows[i]]; n++;
      }
      if (!n) { my = y[0]; mx = inst.xbar[g.rows[0]]; n = 1; }
      centre = my / n - mx / n;
      for (i = 0; i < y.length; i++) y[i] -= centre;
      if (limit !== null) limit -= centre;
    }
    if (g.anyCens && limit === null) {
      var mxc = -Infinity;
      for (i = 0; i < y.length; i++) if (g.cens[i]) mxc = Math.max(mxc, y[i]);
      limit = mxc;
    }

    var t0 = performance.now();
    var post = inst.update(g.rows, y, {
      cv: S.cv, offset: offset, censored: g.anyCens ? g.cens : null,
      limit: limit
    });
    if (!post) { warn("The update failed on these readings."); return; }
    var w = inst.weights(post), off = inst.offsetEstimate(post) + centre,
      lead = 0;
    for (i = 1; i < 3; i++) if (w[i] > w[lead]) lead = i;

    // readings on the instrument's own scale, for the classifier
    var corr = [], vals = [[], []], sts = [];
    for (i = 0; i < S.stations.length; i++) sts.push(S.stations[i].cell);
    var okBoth = true;
    for (var m = 0; m < 2; m++)
      for (i = 0; i < S.stations.length; i++) {
        var st = S.stations[i];
        if (st.v[m] === null) { okBoth = false; continue; }
        var vv = S.unit === "raw" ? Math.log10(st.v[m]) : st.v[m];
        vals[m].push(vv - (offset ? off : 0));
      }
    var cls = {};
    if (okBoth) {
      (meta.classifiers || []).forEach(function (kind) {
        cls[kind] = inst.classify(kind, sts, S.months, vals);
      });
    }

    var camp = inst.campaign(g.rows, y, {
      cv: S.cv, offset: offset, censored: g.anyCens ? g.cens : null
    });
    var params = inst.parameterSummary(camp, inst.fams[lead]);
    var placed = [];
    for (i = 0; i < S.stations.length; i++) placed.push(S.stations[i].cell);
    var nxt = inst.nextStation(post, S.months, placed, S.cv);
    var chi = inst.surprise(g.rows, y, S.cv, offset);
    // how many readings are effectively "nothing found": on the
    // instrument's own scale the detection floor sits at -6
    var nearFloor = 0, off0 = offset ? off : 0;
    for (i = 0; i < g.rows.length; i++) {
      var vv = (S.unit === "raw" ? g.y[i] : g.y[i]) - off0;
      if (vv < -5.5) nearFloor++;
    }

    S.result = {
      post: post, weights: w, offset: off, lead: lead, cls: cls,
      camp: camp, params: params, next: nxt.best, gain: nxt.gain,
      surprise: chi, nRead: g.rows.length, ms: performance.now() - t0,
      okBoth: okBoth, usedOffset: offset, censored: g.anyCens,
      nearFloor: nearFloor
    };
    $("results").style.display = "";       // must be visible before sizing
    global.__lastResult = S.result;
    drawResult();
    drawInput();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearResult() {
    S.result = null;
    $("results").style.display = "none";
    warn("");
  }

  function warn(msg) {
    $("warn").textContent = msg;
    $("warn").style.display = msg ? "" : "none";
  }

  // ------------------------------------------------------------- results
  function drawResult() {
    var r = S.result, m = S.display, f = inst.field(r.post, m), i;
    r.field = f;          // kept so a hover and the export can read it
    $("truthCard").style.display = S.demo ? "" : "none";
    ["mapRec", "mapSd", "mapTruth"].forEach(function (id) {
      var c = $(id), w = Math.max(240, c.parentElement.clientWidth);
      if (Math.abs(parseFloat(c.style.width || 0) - w) > 1)
        fitCanvas(c, w, Math.round(w * 1.16));
    });
    // When the readings came in a real unit, put the map back into that
    // unit by adding the offset the update solved for.
    var shift = r.usedOffset ? r.offset : 0,
      shown = new Float64Array(f.mean.length);
    for (i = 0; i < shown.length; i++) shown[i] = f.mean[i] + shift;
    var lim = quantiles(shown, 0.02, 0.995);
    mapRec.setField(shown, lim[0], lim[1]);
    mapRec.render({ stations: S.stations });
    colourbar($("cbRec"), lim[0], lim[1], r.usedOffset
      ? "reconstruction, in your own unit" : "reconstruction, log10 normalized",
      r.usedOffset ? linFmt : null);
    var slim = quantiles(f.sd, 0.02, 0.98);
    mapSd.setField(f.sd, slim[0], slim[1]);
    mapSd.render({ stations: S.stations });
    colourbar($("cbSd"), slim[0], slim[1],
      "uncertainty, factor above and below");

    var med = medianOf(f.sd);
    $("sdNote").textContent = "Where this is bright, the map beside it is a "
      + "guess. Typical uncertainty in " + meta.months[m] + " is a factor of "
      + Math.pow(10, med).toFixed(1) + " either way"
      + (S.months.indexOf(m) < 0
        ? ". This month was not sampled, so it is inferred from the months "
        + "that were." : ".");

    if (S.demo) drawTruth(m, shift);
    renderExampleCard();
    renderSourceCard();

    // process
    var box = $("process");
    box.innerHTML = "";
    (meta.classifiers || []).forEach(function (kind) {
      if (!r.cls[kind]) return;
      box.appendChild(bars(meta.classifier_labels[kind], r.cls[kind],
        kind === "family" ? "Which process is switched on"
          : "What the particles are doing", true));
    });
    box.appendChild(bars(meta.family_labels, r.weights,
      "Closed-form evidence of the three priors", false));
    if (!r.okBoth)
      box.appendChild(el("p", "note",
        "The network needs a reading at both visits for every station, so "
        + "only the closed-form evidence is shown."));

    // parameters
    var pc = $("params");
    pc.innerHTML = "";
    var fam = inst.fams[r.lead];
    pc.appendChild(el("h3", null, "Parameters of the "
      + meta.family_labels[r.lead].toLowerCase() + " process"));
    var names = Object.keys(r.params);
    if (!names.length) {
      pc.appendChild(el("p", "note", "No scenario of that family fits."));
    } else {
      names.forEach(function (n) { pc.appendChild(paramRow(n, r.params[n])); });
      pc.appendChild(el("p", "note",
        "Ranges from weighting the " + meta.n_train + " training scenarios by "
        + "how well each explains the readings. The paper's neural posteriors "
        + "are a different and more exact route to the same question."));
    }

    // advice and warnings
    var ad = $("advice");
    ad.innerHTML = "";
    var lines = [];
    lines.push("Answer computed in " + r.ms.toFixed(0)
      + " milliseconds from " + r.nRead + " readings.");
    if (r.next)
      lines.push("The next station that would help most is marked in amber on "
        + "the map above, at " + arr.lon[r.next.station].toFixed(3)
        + "°E, " + arr.lat[r.next.station].toFixed(3) + "°N, in "
        + meta.months[r.next.month] + ".");
    if (r.usedOffset)
      lines.push("Your readings sit " + r.offset.toFixed(2)
        + " decades above the instrument's normalized scale. That shift was "
        + "carried as an unknown and does not affect the pattern.");
    if (r.censored)
      lines.push("Readings marked below the limit were treated as bounds, "
        + "not as values.");
    var mx = Math.max.apply(null, r.weights);
    if (mx < 0.9)
      lines.push("The evidence does not single out one process. The paper's "
        + "rule is to withhold a verdict below nine in ten, and the app does "
        + "the same.");
    lines.forEach(function (t) { ad.appendChild(el("p", null, t)); });

    var w2 = [];
    if (S.stations.length < 3)
      w2.push("Fewer than three stations. The map is mostly the campaign "
        + "average, not your measurements.");
    if (r.nearFloor >= r.nRead / 3)
      w2.push(r.nearFloor + " of your " + r.nRead + " readings are close to "
        + "nothing at all. A nearly empty water column carries little "
        + "pattern to recover, so the shape of this map may be poor even "
        + "though the uncertainty beside it stays honest. In the paper, "
        + "scenarios whose particles have sunk reconstruct at about half "
        + "the skill of ones that stay afloat.");
    if (r.surprise > 3)
      w2.push("These readings sit further from the campaign than usual "
        + "(reduced chi square " + r.surprise.toFixed(1) + "). That happens "
        + "when the bay is doing something the training saw rarely. It is a "
        + "reason to read the uncertainty map carefully, not a verdict on "
        + "the answer.");
    if (w2.length) {
      var wc = el("div", "warnbox");
      wc.appendChild(el("h4", null, "Read this before using the map"));
      w2.forEach(function (t) { wc.appendChild(el("p", null, t)); });
      ad.appendChild(wc);
    }
  }

  function bars(labels, probs, title, isNet) {
    var d = el("div", "bars"), i, mx = 0;
    d.appendChild(el("h4", null, title));
    for (i = 1; i < probs.length; i++) if (probs[i] > probs[mx]) mx = i;
    var conf = probs[mx] >= 0.9;
    for (i = 0; i < probs.length; i++) {
      var row = el("div", "bar" + (i === mx ? " lead" : ""));
      row.appendChild(el("span", "blab", labels[i]));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = (100 * probs[i]).toFixed(1) + "%";
      if (!conf) fill.style.opacity = 0.45;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "bval", (100 * probs[i]).toFixed(0) + "%"));
      d.appendChild(row);
    }
    d.appendChild(el("p", "verdict" + (conf ? " ok" : " no"),
      conf ? "Confident: " + labels[mx]
        : "Not confident. No process is named."));
    return d;
  }

  function paramRow(name, p) {
    var meta2 = meta.param_meta[name] || { label: name, unit: "-", log: false },
      d = el("div", "prow");
    d.appendChild(el("span", "plab", meta2.label));
    var track = el("div", "ptrack"),
      lo = p.prior[0], hi = p.prior[1], sp = Math.max(hi - lo, 1e-12),
      f = function (v) { return 100 * (v - lo) / sp; };
    var b95 = el("div", "p95");
    b95.style.left = f(p.q[0]) + "%";
    b95.style.width = Math.max(f(p.q[4]) - f(p.q[0]), 0.6) + "%";
    var b68 = el("div", "p68");
    b68.style.left = f(p.q[1]) + "%";
    b68.style.width = Math.max(f(p.q[3]) - f(p.q[1]), 0.6) + "%";
    var med = el("div", "pmed");
    med.style.left = f(p.q[2]) + "%";
    track.appendChild(b95);
    track.appendChild(b68);
    track.appendChild(med);
    d.appendChild(track);
    d.appendChild(el("span", "pval", fmt(p.q[1], meta2) + " to "
      + fmt(p.q[3], meta2) + " " + (meta2.unit === "-" ? "" : meta2.unit)));
    return d;
  }

  function fmt(v, m) {
    var x = m.log ? Math.pow(10, v) : v;
    if (x === 0) return "0";
    var ax = Math.abs(x);
    if (ax >= 1000 || ax < 0.01) return x.toExponential(1);
    if (ax >= 100) return x.toFixed(0);
    if (ax >= 1) return x.toFixed(2);
    return x.toPrecision(2);
  }



  // An explanation of the loaded example: what it sets up, what to watch,
  // what the paper found, and what actually came out here.
  function renderExampleCard() {
    var box = $("exampleCard"), e = S.example, r = S.result;
    if (!e || !r) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = "";
    box.appendChild(el("h2", null, "About this example: " + e.label));

    var scen = meta.demo[e.demo] || {},
      famName = { bio: "biofouling", frg: "fragmentation",
                  fate: "fate" }[scen.family] || scen.family || "";
    var setup = (e.usePlan ? "The six stations of the paper's plan"
      : (e.stations + " stations placed at random on measurable water"))
      + ", visited "
      + (e.visits === 1 ? "once in " + meta.months[e.months[0]]
        : "in " + meta.months[e.months[0]] + " and "
        + meta.months[e.months[1]])
      + ", with a measurement error of " + e.cv.toFixed(2)
      + (e.censor ? ", and the lowest half of the readings reported as below "
        + "the detection limit" : "") + ".";
    box.appendChild(row("The survey", setup));
    box.appendChild(row("The scenario", "Simulation " + (scen.case || e.demo)
      + " of the " + famName + " family, held out of everything the "
      + "instrument was built from, so its true field is known."));
    box.appendChild(row("What this example does", e.desc));
    if (e.look) box.appendChild(row("What to look for", e.look));
    if (e.paper) box.appendChild(row("In the paper", e.paper));

    var got = "The reconstruction reaches a pattern correlation of "
      + (r.demoCorr === undefined ? "-" : r.demoCorr.toFixed(2))
      + " against the truth, and the truth falls inside the reported band in "
      + (r.demoCov === undefined ? "-" : Math.round(100 * r.demoCov))
      + " per cent of cells. ";
    var w = r.weights, lead = 0, i;
    for (i = 1; i < 3; i++) if (w[i] > w[lead]) lead = i;
    got += w[lead] >= 0.9
      ? "The evidence puts " + Math.round(100 * w[lead]) + " per cent on "
        + meta.family_labels[lead].toLowerCase() + ", which is "
        + (meta.families[lead] === scen.family ? "correct." : "wrong.")
      : "The evidence does not reach the nine in ten threshold, so no "
        + "process is named.";
    box.appendChild(row("What came out", got));
  }

  function row(label, text) {
    var d = el("div", "erow");
    d.appendChild(el("span", "elab", label));
    d.appendChild(el("span", "etxt", text));
    return d;
  }



  // ------------------------------------------------------ source of it all
  function withSources(then) {
    if (Sources.ready()) { then(); return; }
    warn("Loading the source data, about twelve megabytes...");
    Sources.load(function (ok, why) {
      if (!ok) {
        warn(why || "The source data could not be loaded.");
        $("showSources").checked = S.showSources = false;
        $("showAttrib").checked = S.showAttrib = false;
        return;
      }
      warn("");
      then();
      if (S.result) drawResult();
    });
  }

  function sourceMarkers() {
    var d = Sources.data(), out = [], i;
    for (i = 0; i < d.meta.n_clusters; i++)
      out.push({ x: d.a.cluster_x[i], y: d.a.cluster_y[i], label: i + 1 });
    return out;
  }

  // Paper 5's scenarios, weighted by what this page already believes
  function srcWeights() {
    if (!Sources.ready()) return null;
    var r = S.result;
    return Sources.scenarioWeights(inst, r ? r.camp : null,
      r ? r.weights : null);
  }

  // The age statistics are held once per process family, so they are
  // combined with this page's own belief about which family governs the bay.
  function srcFamMix() {
    var d = Sources.data(), r = S.result, ev = [];
    d.meta.families.forEach(function (f) {
      var i = inst.fams.indexOf(f);
      ev.push(r && i >= 0 ? r.weights[i] : 1);
    });
    return Sources.famMix(ev);
  }

  function days(v) {
    if (!(v >= 0)) return "-";
    if (v < 1) return (24 * v).toFixed(0) + " h";
    if (v < 10) return v.toFixed(1) + " d";
    return v.toFixed(0) + " d";
  }

  function rank(m) {
    var idx = [], i;
    for (i = 0; i < m.length; i++) idx.push(i);
    idx.sort(function (a, b) { return m[b] - m[a]; });
    return idx;
  }

  function renderSourceCard() {
    var box = $("sourceCard");
    if (!S.result || !Sources.ready() || !S.stations.length) {
      box.style.display = "none";
      return;
    }
    var wS = srcWeights(), fm = srcFamMix(), sm = Sources.data().meta,
      dom = S.domCache && S.domCache.t === Sources.timeOf(inst, S.display)
        ? S.domCache : Sources.dominanceField(inst, arr, S.display, wS);
    S.domCache = dom;
    box.style.display = "";
    box.innerHTML = "";
    box.appendChild(el("h2", null, "Where the plastic came from"));
    box.appendChild(el("p", "note",
      "The fourteen release points of the model are the candidate sources. "
      + "They are numbered from north to south and drawn on the map when "
      + "\u201crelease points\u201d is ticked. Everything below is for "
      + meta.months[S.display] + "."));

    var tbl = el("table", "srctab"), head = el("tr");
    [["Station", ""],
     ["Largest source", "The source contributing the most mass at this cell"],
     ["Share", "Expected fraction of the plastic here that came from it"],
     ["Leads in", "Fraction of the weighted scenarios in which this source "
      + "really is the largest one. This is the number to trust, not the "
      + "share."],
     ["Age", "Median time that plastic has spent in the water since release"],
     ["Runner-up", "The second largest source and its share"],
     ["Told apart", "Whether the top two differ enough in transit time for "
      + "the age clock to separate them"]].forEach(function (h) {
      var th = el("th", null, h[0]);
      if (h[1]) th.title = h[1];
      head.appendChild(th);
    });
    tbl.appendChild(head);
    var anyClose = false;
    S.stations.forEach(function (st, i) {
      var cc = dom.cellOf[st.cell], tr = el("tr");
      tr.appendChild(el("td", "num", String(i + 1)));
      if (cc < 0 || !dom.cache[cc]) {
        var td = el("td", "empty", "no source data at this cell");
        td.colSpan = 6;
        tr.appendChild(td);
        tbl.appendChild(tr);
        return;
      }
      var m = dom.cache[cc].mix, o = rank(m), second = m[o[1]] > 0.02;
      tr.appendChild(el("td", null, Sources.label(o[0])));
      tr.appendChild(el("td", "shr", (100 * m[o[0]]).toFixed(0) + "%"));
      tr.appendChild(el("td", "shr", (100 * m.pTop).toFixed(0) + "%"));
      tr.appendChild(el("td", "shr", days(Sources.transit(cc, o[0], fm))));
      tr.appendChild(el("td", null, second
        ? Sources.label(o[1]) + " (" + (100 * m[o[1]]).toFixed(0) + "%)"
        : "\u2014"));
      var sep = second ? Sources.separation(cc, o[0], o[1], fm) : null;
      if (!second) {
        tr.appendChild(el("td", "note", "one source dominates"));
      } else if (!sep) {
        tr.appendChild(el("td", "note", "not measured"));
      } else if (sep.ok) {
        tr.appendChild(el("td", null, "yes, " + days(sep.gap) + " apart"));
      } else {
        anyClose = true;
        var bad = el("td", "warnCell",
          "no, only " + days(sep.gap) + " apart");
        tr.appendChild(bad);
      }
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);

    var lines = [];
    if (wS && wS.conditioned) {
      lines.push("These shares are conditioned on your readings. The "
        + sm.n_scenarios + " scenarios of the source campaign were weighted "
        + "by how well their parameters agree with what this page inferred "
        + "from your survey, rather than averaged blindly over every "
        + "simulated year. That leaves an effective "
        + wS.ess.toFixed(0) + " of them carrying the answer.");
      if (wS.missing && wS.missing.length)
        lines.push("The source campaign holds no "
          + wS.missing.map(function (f) {
            return meta.family_labels[inst.fams.indexOf(f)].toLowerCase();
          }).join(" or ") + " scenarios, so if the process panel favours "
          + "one of those, the shares above fall back on the families that "
          + "are present.");
    } else {
      lines.push("No readings are conditioning this yet, so every scenario "
        + "of the source campaign counts equally. Press \u201cRead the "
        + "bay\u201d and these shares sharpen.");
    }
    lines.push("Share and \u201cleads in\u201d answer different questions. "
      + "The share is how much of the plastic here is expected to have come "
      + "from that source. \u201cLeads in\u201d is how often it is the "
      + "largest single contributor across the weighted scenarios, and it is "
      + "the one to quote when deciding whether a sample can be attributed.");
    lines.push("Age is the median time the plastic from that source has "
      + "been in the water when it reaches your station. Two sources can "
      + "only be separated by that clock when their transit times differ: "
      + "the campaign measured the limit at about "
      + sm.separation.gap_days.toFixed(0) + " day, from "
      + "65,520 source pairs, with a correlation of "
      + sm.separation.corr.toFixed(2) + " between the age gap and how "
      + "distinguishable two sources are."
      + (anyClose ? " One or more of your stations falls below it, marked "
        + "in red." : ""));
    lines.push("Source attribution is a separate study, built on "
      + sm.n_scenarios + " forward simulations of the same bay. Its "
      + "attribution is calibrated: over 8,000 held-out sample points the "
      + "leading source is correct 70% of the time, against 61% from "
      + "location alone, and after cross-fitted isotonic recalibration its "
      + "stated confidence matches observed accuracy to within 0.8 "
      + "percentage points. The barotropic and held-out-formulation blocks "
      + "of the campaign are excluded here, because they run a circulation "
      + "this page is not reconstructing.");
    lines.forEach(function (t) { box.appendChild(el("p", "note", t)); });
  }

  // ------------------------------------------------- hover over a result
  function fieldTip(cell, isField) {
    var r = S.result;
    if (!r || !r.field) return null;
    var f = r.field, shift = r.usedOffset ? r.offset : 0,
      v = f.mean[cell] + shift, sd = f.sd[cell],
      head = "<b>" + arr.lon[cell].toFixed(3) + "&deg;E, "
        + arr.lat[cell].toFixed(3) + "&deg;N</b><br>"
        + meta.months[S.display] + "<br>";
    if (isField) {
      var lo = Math.pow(10, v - sd), hi = Math.pow(10, v + sd);
      return head + "concentration <b>" + linFmt(v) + "</b>"
        + (r.usedOffset ? " in your unit" : " (log10 normalized)")
        + "<br>likely between " + linFmt(Math.log10(lo)) + " and "
        + linFmt(Math.log10(hi));
    }
    return head + "uncertainty a factor of <b>"
      + Math.pow(10, sd).toFixed(1) + "</b> either way"
      + "<br>(" + sd.toFixed(2) + " decades)";
  }

  // ------------------------------------------------------ saving the work
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" }),
      url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + "-"
      + String(d.getMonth() + 1).padStart(2, "0") + "-"
      + String(d.getDate()).padStart(2, "0");
  }

  function saveSurvey() {
    if (!S.stations.length) { warn("There is no survey to save yet."); return; }
    var doc = {
      format: "ariake-survey", version: 1, saved: new Date().toISOString(),
      bundle_built: meta.built,
      months: S.months.map(function (m) { return meta.months[m]; }),
      month_index: S.months, unit: S.unit, measurement_error_cv: S.cv,
      detection_limit: S.limit,
      stations: S.stations.map(function (st, i) {
        return {
          n: i + 1, cell: st.cell,
          lon: +arr.lon[st.cell].toFixed(4), lat: +arr.lat[st.cell].toFixed(4),
          visit1: st.v[0], visit2: st.v[1],
          visit1_below_limit: !!st.cens[0], visit2_below_limit: !!st.cens[1]
        };
      })
    };
    download("ariake-survey-" + stamp() + ".json",
      JSON.stringify(doc, null, 1), "application/json");
  }

  function openSurvey(text) {
    var doc;
    try { doc = JSON.parse(text); } catch (e) {
      warn("That file is not a saved survey."); return;
    }
    if (!doc || doc.format !== "ariake-survey" || !doc.stations) {
      warn("That file is not a saved survey."); return;
    }
    S.months = doc.month_index || S.months;
    $("month1").value = S.months[0];
    $("month2").value = S.months[1];
    S.unit = doc.unit || "raw";
    $("unit").value = S.unit;
    S.cv = doc.measurement_error_cv === undefined ? 0.5
      : doc.measurement_error_cv;
    $("cv").value = S.cv;
    $("cvLabel").textContent = S.cv.toFixed(2);
    S.limit = doc.detection_limit === undefined ? null : doc.detection_limit;
    $("limit").value = S.limit === null ? "" : String(S.limit);
    S.display = S.months[1];
    fillDisplay();
    S.stations = doc.stations.map(function (r) {
      return {
        cell: r.cell,
        v: [r.visit1 === undefined ? null : r.visit1,
            r.visit2 === undefined ? null : r.visit2],
        cens: [!!r.visit1_below_limit, !!r.visit2_below_limit]
      };
    });
    S.demo = null;
    S.example = null;
    clearResult();
    renderTable();
    drawInput();
    warn("Loaded " + S.stations.length + " stations. Press Read the bay.");
  }

  function exportField() {
    if (!S.result || !S.result.field) {
      warn("Read the bay first, then the map can be exported."); return;
    }
    var r = S.result, f = r.field, shift = r.usedOffset ? r.offset : 0,
      nW = inst.nWet, lines = [], i;
    lines.push("# Ariake microplastic survey instrument");
    lines.push("# month," + meta.months[S.display]);
    lines.push("# sampled_months," + S.months.map(function (m) {
      return meta.months[m];
    }).join(" and "));
    lines.push("# stations," + S.stations.length);
    lines.push("# readings," + r.nRead);
    lines.push("# measurement_error_cv," + S.cv);
    lines.push("# units," + (r.usedOffset
      ? "same unit as the readings entered" : "log10 of the normalized field"));
    if (r.usedOffset)
      lines.push("# scale_offset_decades," + r.offset.toFixed(4));
    lines.push("# bundle_built," + meta.built);
    lines.push("# exported," + new Date().toISOString());
    lines.push("# note,uncertainty_factor is the multiplicative one sigma "
      + "band: divide and multiply the concentration by it");
    lines.push("");
    lines.push("longitude,latitude,concentration,log10_value,"
      + "sd_decades,uncertainty_factor,lower_1sigma,upper_1sigma");
    for (i = 0; i < nW; i++) {
      var v = f.mean[i] + shift, sd = f.sd[i];
      lines.push([
        arr.lon[i].toFixed(5), arr.lat[i].toFixed(5),
        Math.pow(10, v).toPrecision(6), v.toFixed(5), sd.toFixed(5),
        Math.pow(10, sd).toFixed(3),
        Math.pow(10, v - sd).toPrecision(6),
        Math.pow(10, v + sd).toPrecision(6)
      ].join(","));
    }
    download("ariake-field-" + meta.months[S.display].toLowerCase() + "-"
      + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  // ------------------------------------------------------------- examples
  // Each entry is a real held-out scenario plus a survey configuration,
  // chosen to demonstrate one finding of the paper.
  var EXAMPLES = [
    { id: "budget3", group: "How many samples",
      label: "Three readings, one visit",
      demo: "fate", months: [3, 9], stations: 3, visits: 1, cv: 0.5,
      look: "The map is already close to the truth. Compare it with the twenty station example: the extra thirty seven readings barely change it.",
      paper: "Three model-selected readings reach a pattern correlation of 0.91 on held-out scenarios, against 0.27 for interpolation without the model.",
      desc: "The headline of the paper. Three well placed readings already "
        + "fix most of the fifteen numbers, so the map is nearly as good as "
        + "one built from forty." },
    { id: "budget6", group: "How many samples",
      label: "Six stations, two visits, the plan",
      demo: "fate", usePlan: true, months: [3, 9], visits: 2, cv: 0.5,
      look: "The uncertainty map is darkest near the six stations and brightest in the corners they do not reach.",
      paper: "This is the survey derived in the paper: six stations in April and October, removing 91.9 per cent of the prior variance of the field.",
      desc: "The survey the paper recommends: the six derived stations, "
        + "visited in April and October." },
    { id: "budget20", group: "How many samples",
      label: "Twenty stations, two visits",
      demo: "fate", months: [3, 9], stations: 20, visits: 2, cv: 0.5,
      look: "Forty readings instead of twelve. The map hardly improves and the uncertainty shrinks only a little.",
      paper: "Between three and twenty stations the held-out correlation moves only from 0.81 to 0.84. The budget curve is flat.",
      desc: "Forty readings instead of twelve. Compare the map with the "
        + "three-reading example: the gain is small, which is the flat "
        + "budget curve of the paper." },

    { id: "frg2", group: "Telling the processes apart",
      label: "Fragmentation, two visits",
      demo: "frg", months: [3, 9], stations: 6, visits: 2, cv: 0.5,
      look: "Look at the two reading columns in the table: several stations change by a decade or more between April and October. That change is what names the process.",
      paper: "Fragmentation declares itself through the change between visits. At six stations and two visits the classifier reaches 0.72 accuracy on what the particles are actually doing.",
      desc: "A fragmenting bay sampled properly, with both trips made. This "
        + "is the case the instrument is best equipped to name." },
    { id: "frg1", group: "Telling the processes apart",
      label: "The same case, one visit only",
      demo: "frg", months: [3, 9], stations: 6, visits: 1, cv: 0.5,
      look: "The map survives, but the process bars go quiet. With a single visit there is no change for the instrument to read.",
      paper: "Dropping to one visit leaves the overall accuracy almost unchanged while the recall for fragmenting scenarios falls from 0.49 to 0.36.",
      desc: "The same scenario with the second trip cancelled. The map "
        + "survives, the process identification weakens. In the paper the "
        + "recall for fragmenting cases falls from 0.49 to 0.36." },
    { id: "bioeasy", group: "Telling the processes apart",
      label: "Biofouling still afloat",
      demo: "bio_easy", months: [3, 9], stations: 6, visits: 2, cv: 0.5,
      look: "Several stations read near nothing, so the empty column warning appears, yet the map still comes out well. The next example is the same warning with the opposite outcome.",
      paper: "Buoyant scenarios reconstruct at 0.94 and sinking ones at 0.52, while the coverage of the reported band stays between 0.77 and 0.81 for both.",
      desc: "A biofouling scenario whose particles have not yet sunk, so "
        + "there is plenty left in the water to measure." },
    { id: "biosunk", group: "Telling the processes apart",
      label: "Biofouling that has sunk",
      demo: "bio", months: [3, 9], stations: 6, visits: 2, cv: 0.5,
      look: "The correlation collapses while the uncertainty stays honest. Nothing in the readings told the instrument in advance that this one would go badly, and it does not pretend otherwise.",
      paper: "Sinking scenarios reconstruct at about half the skill of buoyant ones. The per-cell uncertainty remains trustworthy even where the shape of the map does not.",
      desc: "The instructive failure. The particles have sunk, most "
        + "stations find almost nothing, and the pattern correlation "
        + "collapses. The instrument says so, and its per-cell uncertainty "
        + "stays honest even where the map is wrong." },

    { id: "noisy", group: "Difficult conditions",
      label: "A noisy laboratory",
      demo: "fate", usePlan: true, months: [3, 9], visits: 2, cv: 2.0,
      look: "Compare with the six station example, which is the same survey at the default error. The map is nearly identical and the uncertainty is wider.",
      paper: "Across an eightfold range of measurement error the reconstruction moves only from 0.92 to 0.89, while the coverage of the 68 per cent band falls from 0.79 to 0.69 unless the update is told the true error.",
      desc: "The same survey with readings four times noisier than the "
        + "default. The pattern holds and the uncertainty widens, which is "
        + "the noise ladder of the paper." },
    { id: "censor", group: "Difficult conditions",
      label: "Half the stations below detection",
      demo: "fate", usePlan: true, months: [3, 9], visits: 2, cv: 0.5,
      censor: 0.5,
      look: "Six readings are ticked as below the limit and carry the limit value. They still inform the map, because they say the water there held almost nothing.",
      paper: "Treating readings at a detection limit as bounds rather than as numbers lifts the coverage of the 68 per cent band from 0.61 to 0.65 at the most severe limit tested.",
      desc: "Six of the twelve readings come back as nothing found. They "
        + "enter as bounds rather than as numbers, which keeps the "
        + "uncertainty honest." },
    { id: "winter", group: "Difficult conditions",
      label: "A winter survey",
      demo: "fate", months: [0, 1], stations: 6, visits: 2, cv: 0.5,
      look: "Fewer particles remain in the water in January and February, so there is less pattern left to recover.",
      paper: "January is the weakest month of the twelve, at 0.68, against 0.89 to 0.90 in July and August.",
      desc: "January and February. Depleted water columns leave less to "
        + "reconstruct, and January is the worst month of the twelve in the "
        + "paper." },
    { id: "summer", group: "Difficult conditions",
      label: "A summer survey",
      demo: "fate", months: [6, 7], stations: 6, visits: 2, cv: 0.5,
      look: "The easiest time of year for the instrument. Compare the uncertainty map with the winter example.",
      paper: "July and August are the two strongest months in the month by month test of the paper.",
      desc: "July and August, the two best months in the month by month "
        + "test of the paper." },

    { id: "frgother", group: "Other draws",
      label: "Fragmentation, another draw",
      demo: "frg_easy", months: [3, 9], stations: 6, visits: 2, cv: 0.5,
      look: "A different draw of the fragmentation parameters. Compare the parameter ranges with the other fragmentation example to see how much they move.",
      paper: "Every parameter is drawn by Latin hypercube, so two scenarios of the same family can behave very differently.",
      desc: "A different set of fragmentation parameters, to see how much "
        + "the answer moves with the scenario rather than with the survey." },
    { id: "fateother", group: "Other draws",
      label: "Fate, a poor draw",
      demo: "fate_hard", months: [3, 9], stations: 6, visits: 2, cv: 0.5,
      look: "Chosen as one of the weaker fate scenarios in the held-out set, and it still reconstructs well.",
      paper: "Fate scenarios, whose particles stay afloat, are the easiest of the three families, at 0.94.",
      desc: "Among the weaker fate scenarios of the held-out set, and it "
        + "still reconstructs well. Fate cases are the easy ones." }
  ];

  function exampleById(id) {
    for (var i = 0; i < EXAMPLES.length; i++)
      if (EXAMPLES[i].id === id) return EXAMPLES[i];
    return null;
  }

  function buildGallery() {
    var sel = $("exampleSel"), groups = {}, order = [], i, e, g;
    for (i = 0; i < EXAMPLES.length; i++) {
      e = EXAMPLES[i];
      if (!arr["demo_" + e.demo + "_truth"]) continue;   // not in the bundle
      if (!groups[e.group]) { groups[e.group] = []; order.push(e.group); }
      groups[e.group].push(e);
    }
    sel.innerHTML = "";
    for (i = 0; i < order.length; i++) {
      g = document.createElement("optgroup");
      g.label = order[i];
      groups[order[i]].forEach(function (x) {
        var o = el("option", null, x.label);
        o.value = x.id;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    sel.value = "budget6";
    $("exampleDesc").textContent = exampleById("budget6").desc;
  }

  function loadExample(id) {
    var e = exampleById(id);
    if (!e) return;
    var truth = arr["demo_" + e.demo + "_truth"], nW = inst.nWet, i, m;
    S.months = e.months.slice();
    $("month1").value = S.months[0];
    $("month2").value = S.months[1];
    S.cv = e.cv;
    $("cv").value = e.cv;
    $("cvLabel").textContent = e.cv.toFixed(2);
    S.display = S.months[1];
    fillDisplay();

    var rnd = mulberry(hashOf(e.id));
    var chosen = [];
    if (e.usePlan) {
      for (i = 0; i < arr.plan_stations.length; i++)
        chosen.push(arr.plan_stations[i]);
    } else {
      var ok = [];
      for (i = 0; i < nW; i++)
        if (arr.candidate[S.months[0] * nW + i]
          && arr.candidate[S.months[1] * nW + i]) ok.push(i);
      while (chosen.length < e.stations && ok.length)
        chosen.push(ok.splice(Math.floor(rnd() * ok.length), 1)[0]);
      chosen.sort(function (a, b) { return a - b; });
    }

    var sig = Math.sqrt(Math.log1p(e.cv * e.cv)) / Math.LN10, scale = 2.0e4;
    S.stations = [];
    var raw = [];
    chosen.forEach(function (c) {
      var st = { cell: c, v: [null, null], cens: [false, false] };
      for (m = 0; m < e.visits; m++) {
        var t = truth[S.months[m] * nW + c] + gauss(rnd) * sig;
        st.v[m] = S.unit === "raw"
          ? +(Math.pow(10, t) * scale).toPrecision(3) : +t.toFixed(3);
        raw.push({ st: st, m: m, v: st.v[m] });
      }
      S.stations.push(st);
    });

    // mark the lowest readings as below the detection limit, if asked
    S.limit = null;
    $("limit").value = "";
    if (e.censor) {
      var sorted = raw.slice().sort(function (a, b) { return a.v - b.v; });
      var k = Math.max(1, Math.round(e.censor * sorted.length)),
        lim = sorted[k - 1].v;
      for (i = 0; i < sorted.length; i++)
        if (sorted[i].v <= lim) {
          sorted[i].st.cens[sorted[i].m] = true;
          sorted[i].st.v[sorted[i].m] = lim;
        }
      S.limit = lim;
      $("limit").value = String(lim);
    }

    S.demo = e.demo;
    S.example = e;
    $("exampleSel").value = e.id;
    $("exampleDesc").textContent = e.desc;
    renderTable();
    drawInput();
    run();
  }

  function hashOf(s) {
    var h = 20260910, i;
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  // ---------------------------------------------------------------- demo
  function loadDemo(kind) {
    var truth = arr["demo_" + kind + "_truth"], nW = inst.nWet,
      cand = arr.candidate, ok = [], i, seed = 7;
    for (i = 0; i < nW; i++)
      if (cand[S.months[0] * nW + i] && cand[S.months[1] * nW + i]) ok.push(i);
    var rnd = mulberry(20260910 + kind.charCodeAt(0));
    S.stations = [];
    var chosen = [];
    while (chosen.length < 6 && ok.length) {
      var j = Math.floor(rnd() * ok.length);
      chosen.push(ok.splice(j, 1)[0]);
    }
    chosen.sort(function (a, b) { return a - b; });
    var sig = Math.sqrt(Math.log1p(0.25)) / Math.LN10;
    // In "any unit" mode the example is reported the way a laboratory would,
    // as particles per cubic metre, which is four decades above the
    // instrument's own normalized scale. The offset coefficient absorbs it.
    var scale = 2.0e4;
    chosen.forEach(function (c) {
      var st = { cell: c, v: [null, null], cens: [false, false] };
      for (var m = 0; m < 2; m++) {
        var t = truth[S.months[m] * nW + c] + gauss(rnd) * sig;
        st.v[m] = S.unit === "raw"
          ? +(Math.pow(10, t) * scale).toPrecision(3)
          : +t.toFixed(3);
      }
      S.stations.push(st);
    });
    S.demo = kind;
    renderTable();
    drawInput();
    run();
  }

  function drawTruth(month, shift) {
    shift = shift || 0;
    var truth = arr["demo_" + S.demo + "_truth"], nW = inst.nWet,
      base = month * nW, v = new Float64Array(nW), i;
    for (i = 0; i < nW; i++) v[i] = truth[base + i] + shift;
    var lim = quantiles(v, 0.02, 0.995);
    var mapT = new MapView($("mapTruth"), meta, arr);
    mapT.setField(v, lim[0], lim[1]);
    mapT.render({ stations: S.stations });
    colourbar($("cbTruth"), lim[0], lim[1],
      shift ? "truth, in your own unit" : "truth, log10 normalized",
      shift ? linFmt : null);
    var f = inst.field(S.result.post, month), sx = 0, sy = 0, sxx = 0,
      syy = 0, sxy = 0, n = nW, cov = 0;
    for (i = 0; i < n; i++) {
      sx += v[i]; sy += f.mean[i] + shift;
      var mi = f.mean[i] + shift;
      sxx += v[i] * v[i]; syy += mi * mi;
      sxy += v[i] * mi;
      if (Math.abs(v[i] - mi) <= f.sd[i] + 1e-9) cov++;
    }
    var cc = (n * sxy - sx * sy)
      / Math.sqrt(Math.max((n * sxx - sx * sx) * (n * syy - sy * sy), 1e-30));
    S.result.demoCorr = cc;
    S.result.demoCov = cov / n;
    $("truthNote").textContent = "This is a held-out scenario the instrument "
      + "was never built from, so the truth is known. Pattern correlation "
      + cc.toFixed(3) + ". The truth falls inside the reported one sigma band "
      + "in " + (100 * cov / n).toFixed(0) + " per cent of cells.";
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) {
    var u = Math.max(rnd(), 1e-12), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  global.addEventListener("DOMContentLoaded", boot);
})(window);
