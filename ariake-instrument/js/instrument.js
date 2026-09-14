// The instrument. Every function here mirrors one in reference.py, and
// test/verify.html checks that the two agree to four decimals.
(function (global) {
  "use strict";

  var OFFSET_SD = 2.0;   // decades, the prior width of an unknown scale

  function Instrument(bundle) {
    var m = bundle.meta, a = bundle.a, i, j, r, s, K;
    this.meta = m;
    this.a = a;
    this.K = K = m.modes;
    this.KF = m.modes_family_evidence;
    this.nWet = m.n_wet;
    this.nT = m.n_months;
    this.fams = m.families;
    this.phi = a.phi;
    this.xbar = a.xbar;
    this.reprCell = a.repr_cell;
    s = 0;
    for (i = 0; i < this.reprCell.length; i++) s += this.reprCell[i];
    this.reprMean = s / this.reprCell.length;

    // W = Phi' Phi over every wet cell of every month, used by the design
    var nRow = this.nT * this.nWet, W = LA.zeros(K * K), p = this.phi;
    for (r = 0; r < nRow; r++) {
      var o = r * K;
      for (i = 0; i < K; i++) {
        var v = p[o + i];
        if (v === 0) continue;
        for (j = i; j < K; j++) W[i * K + j] += v * p[o + j];
      }
    }
    for (i = 0; i < K; i++) for (j = 0; j < i; j++) W[i * K + j] = W[j * K + i];
    this.W = W;
  }

  Instrument.prototype.rowOf = function (station, month) {
    return month * this.nWet + station;
  };

  Instrument.prototype.noiseVar = function (cv) {
    var s = Math.sqrt(Math.log1p(cv * cv)) / Math.LN10;
    return s * s + this.reprMean;
  };

  // Prior mean and covariance of one family, optionally with the offset
  Instrument.prototype.famSystem = function (fi, offset, K) {
    var nd = offset ? K + 1 : K, mu = LA.zeros(nd), Sig = LA.zeros(nd * nd),
      i, j, Kf = this.K;
    for (i = 0; i < K; i++) mu[i] = this.a.fam_mu[fi * Kf + i];
    for (i = 0; i < K; i++)
      for (j = 0; j < K; j++)
        Sig[i * nd + j] = this.a.fam_cov[fi * Kf * Kf + i * Kf + j];
    if (offset) Sig[K * nd + K] = OFFSET_SD * OFFSET_SD;
    return { mu: mu, Sig: Sig, nd: nd };
  };

  // Rows of the basis at the given state-vector rows, with an optional
  // trailing column of ones for the offset
  Instrument.prototype.design = function (rows, nModes, offset) {
    var n = rows.length, nc = offset ? nModes + 1 : nModes,
      H = LA.zeros(n * nc), i, k, o;
    for (i = 0; i < n; i++) {
      o = rows[i] * this.K;
      for (k = 0; k < nModes; k++) H[i * nc + k] = this.phi[o + k];
      if (offset) H[i * nc + nModes] = 1;
    }
    return H;
  };

  // The Gaussian update, per family. opts: {cv, offset, censored, limit}
  Instrument.prototype.update = function (rows, y, opts) {
    opts = opts || {};
    var cv = opts.cv === undefined ? 0.5 : opts.cv,
      offset = !!opts.offset, censored = opts.censored || null,
      limit = opts.limit, K = this.K, KF = this.KF, n = rows.length,
      nv = this.noiseVar(cv), self = this,
      H = this.design(rows, K, offset), nc = offset ? K + 1 : K,
      He = this.design(rows, KF, offset), nce = offset ? KF + 1 : KF,
      Rdiag = LA.zeros(n), yv = new Float64Array(y), post = null,
      anyCens = false, it, iters, i, j, k;
    for (i = 0; i < n; i++) Rdiag[i] = nv;
    if (censored) for (i = 0; i < n; i++) if (censored[i]) anyCens = true;
    iters = anyCens ? 3 : 1;

    for (it = 0; it < iters; it++) {
      post = [];
      for (var fi = 0; fi < 3; fi++) {
        var sys = this.famSystem(fi, offset, K), nd = sys.nd,
          Sm = LA.matmulT(LA.matmul(H, n, nc, sys.Sig, nd), n, nd, H, n),
          rr = LA.zeros(n), pred = LA.matvec(H, n, nc, sys.mu);
        for (i = 0; i < n; i++) {
          Sm[i * n + i] += Rdiag[i];
          rr[i] = yv[i] - (this.xbar[rows[i]] + pred[i]);
        }
        var L = LA.chol(Sm, n);
        if (!L) { post = null; break; }
        var z1 = LA.cholSolve(L, n, rr),
          G = LA.matmulT(sys.Sig, nd, nd, H, n),      // (nd by n)
          Gt = LA.zeros(n * nd);
        for (i = 0; i < nd; i++)
          for (j = 0; j < n; j++) Gt[j * nd + i] = G[i * n + j];
        var Z = LA.cholSolveMat(L, n, Gt, nd),        // (n by nd)
          GZ = LA.matmul(G, nd, n, Z, nd),
          av = LA.zeros(nd), C = LA.zeros(nd * nd);
        for (i = 0; i < nd; i++) {
          av[i] = sys.mu[i] + LA.dot(G, z1, n, i * n, 0);
          for (j = 0; j < nd; j++)
            C[i * nd + j] = sys.Sig[i * nd + j] - GZ[i * nd + j];
        }
        // evidence, judged in the leading modes only, as in the paper
        var se = this.famSystem(fi, offset, KF), nde = se.nd,
          Sme = LA.matmulT(LA.matmul(He, n, nce, se.Sig, nde), n, nde, He, n),
          re = LA.zeros(n), prede = LA.matvec(He, n, nce, se.mu);
        for (i = 0; i < n; i++) {
          Sme[i * n + i] += Rdiag[i];
          re[i] = yv[i] - (this.xbar[rows[i]] + prede[i]);
        }
        var Le = LA.chol(Sme, n);
        var ll = Le ? -0.5 * (LA.dot(re, LA.cholSolve(Le, n, re), n)
          + LA.logDet(Le, n) + n * Math.log(2 * Math.PI)) : -1e30;
        post.push({ a: av, C: C, nd: nd, ll: ll });
      }
      if (!post) return null;
      if (!anyCens) break;

      // expectation step for the readings that only report a bound
      var w = this.weights(post), mp = LA.zeros(n), vp = LA.zeros(n);
      for (var f2 = 0; f2 < 3; f2++) {
        var nd2 = post[f2].nd, mf = LA.matvec(H, n, nc, post[f2].a),
          Cf = post[f2].C;
        for (i = 0; i < n; i++) {
          var mi = this.xbar[rows[i]] + mf[i], vi = nv;
          for (j = 0; j < nd2; j++) {
            var hj = H[i * nc + j];
            if (hj === 0) continue;
            for (k = 0; k < nd2; k++) vi += hj * Cf[j * nd2 + k] * H[i * nc + k];
          }
          mp[i] += w[f2] * mi;
          vp[i] += w[f2] * (vi + mi * mi);
        }
      }
      for (i = 0; i < n; i++) {
        vp[i] -= mp[i] * mp[i];
        if (!censored[i]) { Rdiag[i] = nv; continue; }
        var sd = Math.sqrt(Math.max(vp[i], 1e-12)),
          zz = (limit - mp[i]) / sd,
          lam = LA.normPdf(zz) / Math.max(LA.normCdf(zz), 1e-12),
          vt = vp[i] * (1 - zz * lam - lam * lam);
        yv[i] = mp[i] - sd * lam;
        Rdiag[i] = nv + Math.max(vt, 0);
      }
    }
    post.rows = rows;
    post.offset = offset;
    return post;
  };

  Instrument.prototype.weights = function (post) {
    var mx = -Infinity, w = [0, 0, 0], s = 0, i;
    for (i = 0; i < 3; i++) if (post[i].ll > mx) mx = post[i].ll;
    for (i = 0; i < 3; i++) { w[i] = Math.exp(post[i].ll - mx); s += w[i]; }
    for (i = 0; i < 3; i++) w[i] /= s;
    return w;
  };

  Instrument.prototype.offsetEstimate = function (post) {
    if (!post.offset) return 0;
    var w = this.weights(post), o = 0, i;
    for (i = 0; i < 3; i++) o += w[i] * post[i].a[this.K];
    return o;
  };

  // The reconstructed map and its uncertainty for one month
  Instrument.prototype.field = function (post, month) {
    var K = this.K, nW = this.nWet, base = month * nW, off = base * K,
      w = this.weights(post), mean = new Float64Array(nW),
      sd = new Float64Array(nW), means = [], i, c, f, o, u = LA.zeros(K), s;
    for (f = 0; f < 3; f++) means.push(new Float64Array(nW));
    for (f = 0; f < 3; f++) {
      var af = post[f].a, mf = means[f];
      for (c = 0; c < nW; c++) {
        o = off + c * K;
        s = this.xbar[base + c];
        for (i = 0; i < K; i++) s += this.phi[o + i] * af[i];
        mf[c] = s;
        mean[c] += w[f] * s;
      }
    }
    for (f = 0; f < 3; f++) {
      var Cf = post[f].C, nd = post[f].nd, mf2 = means[f];
      for (c = 0; c < nW; c++) {
        o = off + c * K;
        var dv = 0, j;
        for (i = 0; i < K; i++) {
          var pi = this.phi[o + i];
          if (pi === 0) continue;
          var acc = 0;
          for (j = 0; j < K; j++) acc += Cf[i * nd + j] * this.phi[o + j];
          dv += pi * acc;
        }
        var d = mf2[c] - mean[c];
        sd[c] += w[f] * (dv + d * d);
      }
    }
    for (c = 0; c < nW; c++) sd[c] = Math.sqrt(sd[c] + this.reprCell[base + c]);
    return { mean: mean, sd: sd, weights: w, families: means };
  };

  // The trained deep-sets classifier. kind is "family" or "regime".
  // values[v][s] are normalized log readings, station s at visit v.
  Instrument.prototype.classify = function (kind, stations, months, values) {
    var a = this.a, p = "net_" + kind + "_", nTok = 0, v, s, i, j;
    if (!a[p + "phi_0_weight"]) return null;
    for (v = 0; v < months.length; v++) nTok += stations.length;
    var x = LA.zeros(nTok * 4), t = 0, xm = a.xy_mean[0], ym = a.xy_mean[1];
    for (v = 0; v < months.length; v++) {
      var tn = this.meta.snapshot_of_month[months[v]] / this.meta.n_snapshots
        - 0.5;
      for (s = 0; s < stations.length; s++) {
        var st = stations[s];
        x[t * 4] = (a.x_m[st] - xm) / 1000 / 30;
        x[t * 4 + 1] = (a.y_m[st] - ym) / 1000 / 30;
        x[t * 4 + 2] = tn;
        x[t * 4 + 3] = values[v][s] / 3;
        t++;
      }
    }
    var h1 = layer(x, nTok, 4, a[p + "phi_0_weight"], a[p + "phi_0_bias"], 64,
      true);
    var demb = a[p + "phi_2_bias"].length;
    var h2 = layer(h1, nTok, 64, a[p + "phi_2_weight"], a[p + "phi_2_bias"],
      demb, true);
    var pooled = LA.zeros(2 * demb);
    for (i = 0; i < demb; i++) {
      var sm = 0, mx = -Infinity;
      for (j = 0; j < nTok; j++) {
        var val = h2[j * demb + i];
        sm += val;
        if (val > mx) mx = val;
      }
      pooled[i] = sm / nTok;
      pooled[demb + i] = mx;
    }
    var nh = a[p + "rho_0_bias"].length;
    var o1 = layer(pooled, 1, 2 * demb, a[p + "rho_0_weight"],
      a[p + "rho_0_bias"], nh, true);
    var o2 = layer(o1, 1, nh, a[p + "rho_2_weight"], a[p + "rho_2_bias"], 3,
      false);
    var mx2 = Math.max(o2[0], o2[1], o2[2]), su = 0, out = [0, 0, 0];
    for (i = 0; i < 3; i++) { out[i] = Math.exp(o2[i] - mx2); su += out[i]; }
    for (i = 0; i < 3; i++) out[i] /= su;
    return out;
  };

  function layer(X, rows, cin, Wt, b, cout, act) {
    var Y = LA.zeros(rows * cout), r, i, k, s;
    for (r = 0; r < rows; r++) {
      for (i = 0; i < cout; i++) {
        s = b[i];
        for (k = 0; k < cin; k++) s += X[r * cin + k] * Wt[i * cin + k];
        Y[r * cout + i] = act ? LA.gelu(s) : s;
      }
    }
    return Y;
  }

  // Weight every training scenario by how well it explains the readings
  Instrument.prototype.campaign = function (rows, y, opts) {
    opts = opts || {};
    var cv = opts.cv === undefined ? 0.5 : opts.cv, offset = !!opts.offset,
      censored = opts.censored || null, K = this.K, n = rows.length,
      nS = this.a.coef.length / K, nv = this.noiseVar(cv), Ri = 1 / nv,
      s2 = OFFSET_SD * OFFSET_SD, denom = 1 + s2 * n * Ri,
      P = this.design(rows, K, false), ll = new Float64Array(nS),
      i, sIdx, o, q, sr, r, mx = -Infinity, sum = 0;
    for (sIdx = 0; sIdx < nS; sIdx++) {
      o = sIdx * K;
      q = 0; sr = 0;
      for (i = 0; i < n; i++) {
        r = y[i] - (this.xbar[rows[i]] + LA.dot(P, this.a.coef, K, i * K, o));
        if (censored && censored[i] && r > 0) r = 0;
        q += r * r;
        sr += r;
      }
      ll[sIdx] = offset
        ? -0.5 * (q * Ri - s2 * Ri * Ri * sr * sr / denom)
        : -0.5 * q * Ri;
      if (ll[sIdx] > mx) mx = ll[sIdx];
    }
    for (sIdx = 0; sIdx < nS; sIdx++) {
      ll[sIdx] = Math.exp(ll[sIdx] - mx);
      sum += ll[sIdx];
    }
    for (sIdx = 0; sIdx < nS; sIdx++) ll[sIdx] /= sum;
    return ll;
  };

  // Weighted quantiles of the parameters of one family's scenarios
  Instrument.prototype.parameterSummary = function (w, family) {
    var fi = this.fams.indexOf(family), slots = this.meta.param_slots[family],
      nP = this.meta.param_names.length, out = {}, i, k, idx = [], tot = 0;
    for (i = 0; i < w.length; i++)
      if (this.a.fam_of_scenario[i] === fi) { idx.push(i); tot += w[i]; }
    if (tot <= 0) return out;
    for (k = 0; k < slots.length; k++) {
      var slot = slots[k], name = this.meta.param_names[slot],
        pairs = [], lo = Infinity, hi = -Infinity;
      for (i = 0; i < idx.length; i++) {
        var v = this.a.params[idx[i] * nP + slot];
        pairs.push([v, w[idx[i]] / tot]);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      pairs.sort(function (p, q) { return p[0] - q[0]; });
      var cum = 0, qs = [0.025, 0.16, 0.5, 0.84, 0.975], res = [], qi = 0;
      for (i = 0; i < pairs.length && qi < qs.length; i++) {
        var prev = cum;
        cum += pairs[i][1];
        while (qi < qs.length && cum >= qs[qi]) {
          var t = (qs[qi] - prev) / Math.max(pairs[i][1], 1e-30);
          var v0 = i > 0 ? pairs[i - 1][0] : pairs[0][0];
          res.push(v0 + t * (pairs[i][0] - v0));
          qi++;
        }
      }
      while (res.length < 5) res.push(pairs[pairs.length - 1][0]);
      out[name] = { q: res, prior: [lo, hi] };
    }
    return out;
  };

  // The candidate cell whose reading would shrink the whole field most

  // The state before any reading: each family sits at its own prior, and
  // the three are equally likely. Lets the gain map be drawn on an empty
  // survey, which is how a cruise is planned.
  Instrument.prototype.priorPost = function () {
    var post = [], K = this.K, fi, i, j;
    for (fi = 0; fi < 3; fi++) {
      var mu = LA.zeros(K), C = LA.zeros(K * K);
      for (i = 0; i < K; i++) mu[i] = this.a.fam_mu[fi * K + i];
      for (i = 0; i < K; i++)
        for (j = 0; j < K; j++)
          C[i * K + j] = this.a.fam_cov[fi * K * K + i * K + j];
      post.push({ a: mu, C: C, nd: K, ll: 0 });
    }
    post.rows = [];
    post.offset = false;
    post.isPrior = true;
    return post;
  };

  // How much a single reading at each candidate cell would reduce the total
  // uncertainty of the whole field. The same quantity nextStation maximises,
  // kept for every cell so it can be drawn as a layer.
  Instrument.prototype.gainField = function (post, month, placed, cv) {
    var K = this.K, nW = this.nWet, nv = this.noiseVar(cv === undefined ? 0.5 : cv),
      w = this.weights(post), cand = this.a.candidate, out = new Float64Array(nW),
      Q = [], f, i, j, c;
    for (f = 0; f < 3; f++) {
      var C = post[f].C, nd = post[f].nd, Ck = LA.zeros(K * K);
      for (i = 0; i < K; i++)
        for (j = 0; j < K; j++) Ck[i * K + j] = C[i * nd + j];
      Q.push({ C: Ck,
               Q: LA.matmul(LA.matmul(Ck, K, K, this.W, K), K, K, Ck, K) });
    }
    for (c = 0; c < nW; c++) {
      if (!cand[month * nW + c]) { out[c] = NaN; continue; }
      if (placed && placed.indexOf(c) >= 0) { out[c] = NaN; continue; }
      var o = (month * nW + c) * K, gain = 0;
      for (f = 0; f < 3; f++) {
        var num = 0, den = nv;
        for (i = 0; i < K; i++) {
          var pi = this.phi[o + i];
          if (pi === 0) continue;
          var an = 0, ad = 0;
          for (j = 0; j < K; j++) {
            an += Q[f].Q[i * K + j] * this.phi[o + j];
            ad += Q[f].C[i * K + j] * this.phi[o + j];
          }
          num += pi * an;
          den += pi * ad;
        }
        gain += w[f] * num / den;
      }
      out[c] = gain;
    }
    return out;
  };

  Instrument.prototype.nextStation = function (post, months, placed, cv) {
    var K = this.K, nv = this.noiseVar(cv === undefined ? 0.5 : cv),
      w = this.weights(post), cand = this.a.candidate, nW = this.nWet,
      best = null, bestG = -1, Q = [], i, j, f, m, c, mi;
    for (f = 0; f < 3; f++) {
      var C = post[f].C, nd = post[f].nd, Ck = LA.zeros(K * K);
      for (i = 0; i < K; i++)
        for (j = 0; j < K; j++) Ck[i * K + j] = C[i * nd + j];
      Q.push({ C: Ck, Q: LA.matmul(LA.matmul(Ck, K, K, this.W, K), K, K, Ck, K) });
    }
    for (mi = 0; mi < months.length; mi++) {
      m = months[mi];
      for (c = 0; c < nW; c++) {
        if (!cand[m * nW + c]) continue;
        if (placed.indexOf(c) >= 0) continue;
        var o = (m * nW + c) * K, gain = 0;
        for (f = 0; f < 3; f++) {
          var num = 0, den = nv;
          for (i = 0; i < K; i++) {
            var pi = this.phi[o + i];
            if (pi === 0) continue;
            var an = 0, ad = 0;
            for (j = 0; j < K; j++) {
              an += Q[f].Q[i * K + j] * this.phi[o + j];
              ad += Q[f].C[i * K + j] * this.phi[o + j];
            }
            num += pi * an;
            den += pi * ad;
          }
          gain += w[f] * num / den;
        }
        if (gain > bestG) { bestG = gain; best = { station: c, month: m }; }
      }
    }
    return { best: best, gain: bestG };
  };

  // How unlike the campaign the readings are, as a reduced chi square
  Instrument.prototype.surprise = function (rows, y, cv, offset) {
    var K = this.K, n = rows.length, nv = this.noiseVar(cv),
      H = this.design(rows, K, offset), nc = offset ? K + 1 : K,
      best = Infinity, fi, i;
    for (fi = 0; fi < 3; fi++) {
      var sys = this.famSystem(fi, offset, K), nd = sys.nd,
        Sm = LA.matmulT(LA.matmul(H, n, nc, sys.Sig, nd), n, nd, H, n),
        r = LA.zeros(n), pred = LA.matvec(H, n, nc, sys.mu);
      for (i = 0; i < n; i++) {
        Sm[i * n + i] += nv;
        r[i] = y[i] - (this.xbar[rows[i]] + pred[i]);
      }
      var L = LA.chol(Sm, n);
      if (!L) continue;
      best = Math.min(best, LA.dot(r, LA.cholSolve(L, n, r), n) / n);
    }
    return best;
  };

  global.Instrument = Instrument;
  global.OFFSET_SD = OFFSET_SD;
})(window);
