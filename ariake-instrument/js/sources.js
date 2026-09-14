// Where the plastic came from. Loaded on demand, because the source data is
// as large as the rest of the instrument put together.
//
// Four things happen here.
//   1. The fourteen release points are drawn on the map.
//   2. Every cell gets a source mix, a number saying how strongly one source
//      dominates it, and the chance that the named source really is the
//      largest one.
//   3. The scenarios of paper 5 are weighted by what paper 4 already believes
//      about the bay, so the answer is conditioned on the readings rather
//      than averaged blindly over every simulated year.
//   4. Transit time. Paper 5 carries a per-particle age, and two sources can
//      only be told apart when their transit times to a cell differ. The
//      campaign measured the limit at about one day, and these arrays say
//      whether a particular pair at a particular cell clears it.
(function (global) {
  "use strict";

  var S = null;            // the unpacked source bundle
  var loading = false;
  var DTYPES = {
    float32: Float32Array, float64: Float64Array,
    int32: Int32Array, uint8: Uint8Array
  };

  // The blob is gzipped: 62 MB of shares and age statistics compress to 9.
  // DecompressionStream is a browser API, so this works from a file:// page
  // with no network, but it does need a browser from 2023 or later.
  function inflate(bytes, done, fail) {
    if (typeof global.DecompressionStream === "undefined") { fail(); return; }
    try {
      var st = new Blob([bytes]).stream()
        .pipeThrough(new global.DecompressionStream("gzip"));
      new Response(st).arrayBuffer().then(function (buf) {
        done(new Uint8Array(buf));
      })["catch"](fail);
    } catch (e) { fail(); }
  }

  function unpack(meta, buf, done) {
    var a = {}, name, h, T, cnt;
    for (name in meta.arrays) {
      h = meta.arrays[name];
      T = DTYPES[h.dtype];
      cnt = h.shape.length
        ? h.shape.reduce(function (p, q) { return p * q; }, 1) : 1;
      a[name] = new T(buf.buffer, h.offset, cnt);
    }
    S = { meta: meta, a: a };
    loading = false;
    done(S);
  }

  function load(done) {
    if (S) { done(S); return; }
    if (loading) { setTimeout(function () { load(done); }, 80); return; }
    loading = true;
    global.onSourcesLoaded = function () {
      var meta = global.SOURCES_META, bin = atob(global.SOURCES_B64),
        n = bin.length, raw = new Uint8Array(n), i;
      for (i = 0; i < n; i++) raw[i] = bin.charCodeAt(i);
      try { delete global.SOURCES_B64; } catch (e) { global.SOURCES_B64 = null; }
      if (meta.compression !== "gzip") { unpack(meta, raw, done); return; }
      inflate(raw, function (buf) { unpack(meta, buf, done); },
        function () {
          loading = false;
          done(null, "This browser cannot unpack the source data. It needs "
            + "DecompressionStream, which Chrome, Edge and Safari have had "
            + "since 2023 and Firefox since version 113.");
        });
    };
    var sc = document.createElement("script");
    sc.src = "data/sources_b64.js?v=" + (global.ASSET_V || "1");
    sc.onerror = function () { loading = false; done(null); };
    document.head.appendChild(sc);
  }

  // Which coarse cell of paper 5 each wet cell of the app falls in
  function cellMap(inst, arr) {
    if (S.cellOf) return S.cellOf;
    var xe = S.a.x_edges, ye = S.a.y_edges, nx = S.meta.nx,
      nW = inst.nWet, out = new Int32Array(nW).fill(-1),
      back = new Int32Array(S.meta.nx * S.meta.ny).fill(-1), i, c;
    for (i = 0; i < S.a.cells.length; i++) back[S.a.cells[i]] = i;
    for (i = 0; i < nW; i++) {
      var x = arr.x_m[i], y = arr.y_m[i], col = -1, row = -1, k;
      for (k = 0; k < nx; k++) if (x >= xe[k] && x < xe[k + 1]) { col = k; break; }
      for (k = 0; k < S.meta.ny; k++) if (y >= ye[k] && y < ye[k + 1]) { row = k; break; }
      if (col < 0 || row < 0) continue;
      c = back[row * nx + col];
      out[i] = c;
    }
    S.cellOf = out;
    return out;
  }

  // The paper 5 snapshot closest to one of the app's months
  function timeOf(inst, month) {
    var st = S.a.steps, frac = inst.meta.snapshot_of_month[month]
      / inst.meta.n_snapshots, best = 0, bd = 9e9, i, mx = 0;
    for (i = 0; i < st.length; i++) if (st[i] > mx) mx = st[i];
    for (i = 0; i < st.length; i++) {
      var d = Math.abs(st[i] / mx - frac);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Weight each paper 5 scenario by what paper 4 believes, transferring
  // through the parameters the two campaigns share. With no readings yet
  // every scenario counts equally.
  //
  // A paper 5 scenario can stand in for more than one of paper 4's families:
  // the 122 spectrum cases run biofouling and fragmentation together, so they
  // are compared against paper 4's biofouling scenarios on the biofouling
  // parameters and against its fragmentation scenarios on the fragmentation
  // ones. scen_match records which comparisons are allowed.
  function scenarioWeights(inst, campWeights, evidence) {
    var meta = S.meta, n5 = meta.n_scenarios, w = new Float64Array(n5),
      P5 = S.a.scen_params, nP = meta.param_names.length,
      P4 = inst.a.params, fam4 = inst.a.fam_of_scenario,
      mt = S.a.scen_match, nF = meta.families.length,
      n4 = campWeights ? campWeights.length : 0, i, j, k, f, sum = 0;
    if (!campWeights) {
      for (i = 0; i < n5; i++) w[i] = 1 / n5;
      w.conditioned = false;
      w.missing = [];
      return w;
    }
    // spread of each parameter across paper 4's own scenarios, for scaling
    var sd = new Float64Array(nP);
    for (j = 0; j < nP; j++) {
      var m = 0, v = 0, c = 0;
      for (i = 0; i < n4; i++) {
        var x = P4[i * nP + j];
        if (isFinite(x)) { m += x; c++; }
      }
      if (!c) { sd[j] = 0; continue; }
      m /= c;
      for (i = 0; i < n4; i++) {
        var x2 = P4[i * nP + j];
        if (isFinite(x2)) v += (x2 - m) * (x2 - m);
      }
      sd[j] = Math.sqrt(v / Math.max(c - 1, 1)) || 0;
    }
    // slot lists, once, in the order of the app's own family list
    var slotOf = [];
    for (f = 0; f < nF; f++)
      slotOf.push(inst.meta.param_slots[meta.families[f]] || []);
    var H = 0.6;                       // kernel width in standard deviations
    for (i = 0; i < n5; i++) {
      var acc = 0;
      for (k = 0; k < n4; k++) {
        if (campWeights[k] <= 0) continue;
        var f4 = fam4[k], fi = meta.families.indexOf(inst.fams[f4]);
        if (fi < 0 || !mt[i * nF + fi]) continue;
        var slots = slotOf[fi], d2 = 0, used = 0;
        for (j = 0; j < slots.length; j++) {
          var sj = slots[j], a5 = P5[i * nP + sj], a4 = P4[k * nP + sj];
          if (!isFinite(a5) || !isFinite(a4) || sd[sj] <= 0) continue;
          var t = (a5 - a4) / sd[sj];
          d2 += t * t;
          used++;
        }
        if (!used) continue;
        acc += campWeights[k] * Math.exp(-0.5 * d2 / (H * H * used));
      }
      w[i] = acc;
      sum += acc;
    }
    if (sum <= 0) {                    // nothing transferred, fall back
      for (i = 0; i < n5; i++) w[i] = 1 / n5;
      w.conditioned = false;
      w.missing = [];
      return w;
    }
    for (i = 0; i < n5; i++) w[i] /= sum;
    w.conditioned = true;
    // families paper 5 cannot speak for, reported so the panel can say so
    w.missing = inst.fams.filter(function (f2) {
      var fi2 = meta.families.indexOf(f2), any = false, q;
      if (fi2 < 0) return true;
      for (q = 0; q < n5; q++) if (mt[q * nF + fi2]) { any = true; break; }
      return !any;
    });
    w.evidence = evidence;
    // effective number of scenarios, the usual 1 / sum of squares
    var ss = 0;
    for (i = 0; i < n5; i++) ss += w[i] * w[i];
    w.ess = ss > 0 ? 1 / ss : 0;
    return w;
  }

  // The source mix at one coarse cell and time, under those weights.
  // Returns the expected share of each source, and pTop: the weight of the
  // scenarios in which the leading source really is the largest one. The two
  // answer different questions, and the second is the one to trust when a
  // survey is being planned.
  function mixAt(coarseCell, t, w) {
    var K = S.meta.n_clusters, nC = S.meta.n_cells, n5 = S.meta.n_scenarios,
      sh = S.a.shares, mix = new Float64Array(K), arg = new Int32Array(n5),
      i, k, sum = 0, base = (t * nC + coarseCell) * K,
      stride = S.meta.n_times * nC * K;
    if (coarseCell < 0) return null;
    for (i = 0; i < n5; i++) {
      arg[i] = -1;
      if (w[i] <= 0) continue;
      var o = i * stride + base, tot = 0, bk = -1, bv = -1;
      for (k = 0; k < K; k++) {
        tot += sh[o + k];
        if (sh[o + k] > bv) { bv = sh[o + k]; bk = k; }
      }
      if (tot <= 0) continue;          // this scenario has nothing here
      for (k = 0; k < K; k++) mix[k] += w[i] * sh[o + k] / tot;
      arg[i] = bk;
      sum += w[i];
    }
    if (sum <= 0) return null;
    for (k = 0; k < K; k++) mix[k] /= sum;
    var top = 0;
    for (k = 1; k < K; k++) if (mix[k] > mix[top]) top = k;
    var agree = 0;
    for (i = 0; i < n5; i++) if (arg[i] === top) agree += w[i];
    mix.top = top;
    mix.pTop = agree / sum;
    return mix;
  }

  // How strongly one source dominates each cell: the share of the largest
  function dominanceField(inst, arr, month, w) {
    var cellOf = cellMap(inst, arr), t = timeOf(inst, month),
      nW = inst.nWet, out = new Float64Array(nW), top = new Int32Array(nW),
      cache = {}, i, c;
    for (i = 0; i < nW; i++) {
      c = cellOf[i];
      if (c < 0) { out[i] = NaN; top[i] = -1; continue; }
      if (cache[c] === undefined) {
        var m = mixAt(c, t, w);
        cache[c] = m ? { v: m[m.top], k: m.top, p: m.pTop, mix: m } : null;
      }
      if (!cache[c]) { out[i] = NaN; top[i] = -1; continue; }
      out[i] = cache[c].v;
      top[i] = cache[c].k;
    }
    out.top = top;
    out.cache = cache;
    out.cellOf = cellOf;
    out.t = t;
    return out;
  }

  // ------------------------------------------------------- transit time
  // The age statistics are stored once per process family rather than once
  // per scenario, so they are combined here with the app's own belief about
  // which family governs the bay.
  function famMix(evidence) {
    var nF = S.meta.families.length, out = new Float64Array(nF), s = 0, i;
    for (i = 0; i < nF; i++) {
      out[i] = evidence && isFinite(evidence[i]) ? Math.max(evidence[i], 0)
        : 1 / nF;
      s += out[i];
    }
    for (i = 0; i < nF; i++) out[i] = s > 0 ? out[i] / s : 1 / nF;
    return out;
  }

  function blend(arrName, stride, slot, fm) {
    var a = S.a[arrName], nF = S.meta.families.length, acc = 0, ws = 0, f, v;
    for (f = 0; f < nF; f++) {
      v = a[f * stride + slot];
      if (v < 0 || fm[f] <= 0) continue;
      acc += fm[f] * v;
      ws += fm[f];
    }
    return ws > 0 ? acc / ws : -1;
  }

  // Median transit age, in days, of the plastic reaching this cell from one
  // source. -1 when no scenario put any of that source's plastic here.
  function transit(coarseCell, k, fm) {
    if (coarseCell < 0) return -1;
    var K = S.meta.n_clusters, nC = S.meta.n_cells;
    return blend("age_med", nC * K, coarseCell * K + k, fm);
  }

  // Bay-wide median transit age of one source, for context
  function transitBay(k, fm) {
    return blend("clus_med", S.meta.n_clusters, k, fm);
  }

  function pairIndex(a, b) {
    var n = S.meta.n_clusters, lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo === hi) return -1;
    return lo * n - lo * (lo + 1) / 2 + hi - lo - 1;
  }

  // Can these two sources be told apart at this cell?
  //
  // gap  the difference in their median transit times, in days
  // hell the Hellinger distance between their age distributions, averaged
  //      over the scenarios of the favoured families, which is exactly the
  //      quantity the campaign's separation analysis reports
  // ok   whether both clear the campaign's measured limits
  function separation(coarseCell, a, b, fm) {
    var p = pairIndex(a, b), nP = S.meta.n_pairs, nC = S.meta.n_cells;
    if (coarseCell < 0 || p < 0) return null;
    var g = blend("pair_gap", nC * nP, coarseCell * nP + p, fm),
      h = blend("pair_hell", nC * nP, coarseCell * nP + p, fm),
      sep = S.meta.separation;
    if (g < 0 || h < 0) return null;
    return { gap: g, hell: h,
      ok: g >= sep.gap_days && h >= sep.threshold,
      gapLimit: sep.gap_days, hellLimit: sep.threshold };
  }

  // The age distribution of one source's plastic at a cell, normalised to
  // sum to one, with the bin edges in days.
  function ageProfile(coarseCell, k, fm) {
    if (coarseCell < 0) return null;
    var K = S.meta.n_clusters, nC = S.meta.n_cells, nA = S.meta.n_age,
      nF = S.meta.families.length, d = S.a.age_dist,
      out = new Float64Array(nA), i, f, sum = 0, any = false;
    for (f = 0; f < nF; f++) {
      if (fm[f] <= 0) continue;
      var o = ((f * nC + coarseCell) * K + k) * nA, pk = 0;
      for (i = 0; i < nA; i++) pk += d[o + i];
      if (pk <= 0) continue;
      any = true;
      for (i = 0; i < nA; i++) out[i] += fm[f] * d[o + i] / pk;
    }
    if (!any) return null;
    for (i = 0; i < nA; i++) sum += out[i];
    if (sum <= 0) return null;
    for (i = 0; i < nA; i++) out[i] /= sum;
    out.edges = S.a.age_edges;
    return out;
  }

  function label(k) { return "Source " + (k + 1); }

  global.Sources = {
    load: load, ready: function () { return !!S; },
    data: function () { return S; },
    cellMap: cellMap, timeOf: timeOf,
    scenarioWeights: scenarioWeights, mixAt: mixAt,
    dominanceField: dominanceField, label: label,
    famMix: famMix, transit: transit, transitBay: transitBay,
    separation: separation, ageProfile: ageProfile, pairIndex: pairIndex,
    skill: function () { return S ? S.meta.skill : null; }
  };
})(window);
