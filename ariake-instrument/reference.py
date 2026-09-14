"""Phase 0: the whole instrument in Python, from the bundle alone.

    python reference.py            run the three demo surveys, write expected.json
    python reference.py --check    also check the classifier at the app's months

This file is the definition of correct. The JavaScript in js/instrument.js
must reproduce every number it prints, to four decimals. It reads only
data/bundle_b64.js, never the campaign, so if it works the bundle is
complete.

The instrument, in order:

  update()      the Gaussian update of the paper, per process family, with
                the optional offset coefficient and censored readings
  mixture()     combines the three families by their evidence
  field()       the reconstructed map and its uncertainty for one month
  classify()    the trained deep-sets network
  campaign()    the discrete posterior over the training scenarios, which
                gives the parameter ranges
  next_station() the A-optimal gain of the paper, given what is placed
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.join(HERE, "data", "bundle_b64.js")
OFFSET_SD = 2.0          # decades, the prior width of the unknown scale
COV_TOL = 1e-9           # ties: an empty water column puts hundreds of
                         # cells exactly on the one sigma threshold


# ------------------------------------------------------------------ loading
def load():
    with io.open(BUNDLE, "r", encoding="utf-8") as fh:
        txt = fh.read()
    meta = json.loads(re.search(r"window\.BUNDLE_META = (.*?);\nwindow",
                                txt, re.S).group(1))
    b64 = re.search(r'window\.BUNDLE_B64 = "(.*?)";', txt, re.S).group(1)
    raw = base64.b64decode(b64)
    arr = {}
    for name, h in meta["arrays"].items():
        a = np.frombuffer(raw, dtype=np.dtype(h["dtype"]), offset=h["offset"],
                          count=int(np.prod(h["shape"])) if h["shape"] else 1)
        arr[name] = a.reshape(h["shape"]).astype(
            np.float64 if h["dtype"].startswith("float") else a.dtype)
    return meta, arr


class Instrument:
    def __init__(self):
        self.meta, self.a = load()
        m, a = self.meta, self.a
        self.K = m["modes"]
        self.KF = m["modes_family_evidence"]
        self.n_wet = m["n_wet"]
        self.n_t = m["n_months"]
        self.Phi = a["phi"]
        self.xbar = a["xbar"]
        self.repr_cell = a["repr_cell"]
        self.repr_mean = float(self.repr_cell.mean())
        self.fam_mu = a["fam_mu"]
        self.fam_cov = a["fam_cov"]
        self.coef = a["coef"]
        self.params = a["params"]
        self.fam_of = a["fam_of_scenario"].astype(int)
        self.W = self.Phi.T @ self.Phi
        self.fams = m["families"]

    # ------------------------------------------------------------- helpers
    def row(self, station, month):
        """Row of the state vector for a wet cell at a visit month."""
        return month * self.n_wet + station

    def noise_var(self, cv):
        return (np.sqrt(np.log1p(cv * cv)) / np.log(10)) ** 2 + self.repr_mean

    # -------------------------------------------------------------- update
    def update(self, rows, y, cv=0.5, censored=None, limit=None,
               offset=True, iters=3):
        """Posterior over the mixing numbers, per family.

        rows      state-vector rows of the readings
        y         the readings, on the decimal logarithmic scale
        censored  boolean per reading: it only says "below limit"
        offset    carry an unknown common shift of every reading
        """
        K = self.K
        n = len(rows)
        H0 = self.Phi[rows]
        H = np.c_[H0, np.ones(n)] if offset else H0
        nd = K + 1 if offset else K
        nv = self.noise_var(cv)
        Rdiag = np.full(n, nv)
        yv = np.asarray(y, float).copy()
        censored = (np.zeros(n, bool) if censored is None
                    else np.asarray(censored, bool))

        out = {}
        for it in range(iters if censored.any() else 1):
            out = {}
            for fi, f in enumerate(self.fams):
                mu = np.r_[self.fam_mu[fi], 0.0] if offset else self.fam_mu[fi]
                Sig = np.zeros((nd, nd))
                Sig[:K, :K] = self.fam_cov[fi]
                if offset:
                    Sig[K, K] = OFFSET_SD ** 2
                Sm = H @ Sig @ H.T + np.diag(Rdiag)
                Smi = np.linalg.inv(Sm)
                r = yv - (self.xbar[rows] + H @ mu)
                a = mu + Sig @ H.T @ Smi @ r
                C = Sig - Sig @ H.T @ Smi @ H @ Sig
                # evidence in the leading modes only, as in the paper
                He = np.c_[H0[:, :self.KF], np.ones(n)] if offset \
                    else H0[:, :self.KF]
                Se = np.zeros((He.shape[1], He.shape[1]))
                Se[:self.KF, :self.KF] = self.fam_cov[fi][:self.KF, :self.KF]
                if offset:
                    Se[self.KF, self.KF] = OFFSET_SD ** 2
                mue = np.r_[self.fam_mu[fi][:self.KF], 0.0] if offset \
                    else self.fam_mu[fi][:self.KF]
                Sme = He @ Se @ He.T + np.diag(Rdiag)
                re = yv - (self.xbar[rows] + He @ mue)
                sign, logdet = np.linalg.slogdet(Sme)
                ll = -0.5 * (re @ np.linalg.solve(Sme, re) + logdet
                             + n * np.log(2 * np.pi))
                out[f] = dict(a=a, C=C, ll=float(ll))
            if not censored.any():
                break
            # expectation step for the readings that only report a bound
            w = self._weights(out)
            mpred = np.zeros(n)
            vpred = np.zeros(n)
            for fi, f in enumerate(self.fams):
                mf = self.xbar[rows] + H @ out[f]["a"]
                vf = np.einsum("ij,jk,ik->i", H, out[f]["C"], H) + nv
                mpred += w[fi] * mf
                vpred += w[fi] * (vf + mf ** 2)
            vpred -= mpred ** 2
            sd = np.sqrt(np.maximum(vpred, 1e-12))
            zz = (limit - mpred) / sd
            pdf = np.exp(-0.5 * zz ** 2) / np.sqrt(2 * np.pi)
            cdf = np.clip(0.5 * (1 + _erf(zz / np.sqrt(2))), 1e-12, 1.0)
            lam = pdf / cdf
            mt = mpred - sd * lam
            vt = vpred * (1 - zz * lam - lam ** 2)
            yv = np.where(censored, mt, yv)
            Rdiag = np.where(censored, nv + np.maximum(vt, 0.0), nv)
        return out

    def _weights(self, post):
        ll = np.array([post[f]["ll"] for f in self.fams])
        w = np.exp(ll - ll.max())
        return w / w.sum()

    def mixture(self, post):
        w = self._weights(post)
        K = self.K
        a = sum(w[i] * post[f]["a"][:K] for i, f in enumerate(self.fams))
        return w, a

    def offset_estimate(self, post):
        w = self._weights(post)
        if len(post[self.fams[0]]["a"]) == self.K:
            return 0.0
        return float(sum(w[i] * post[f]["a"][self.K]
                         for i, f in enumerate(self.fams)))

    # --------------------------------------------------------------- field
    def field(self, post, month):
        """Mean and standard deviation of the reconstructed map."""
        K = self.K
        sl = slice(month * self.n_wet, (month + 1) * self.n_wet)
        P = self.Phi[sl, :K]
        xb = self.xbar[sl]
        w = self._weights(post)
        means = [xb + P @ post[f]["a"][:K] for f in self.fams]
        mix = sum(w[i] * means[i] for i in range(3))
        var = np.zeros(self.n_wet)
        for i, f in enumerate(self.fams):
            dv = np.einsum("ij,jk,ik->i", P, post[f]["C"][:K, :K], P)
            var += w[i] * (dv + (means[i] - mix) ** 2)
        var += self.repr_cell[sl]
        return mix, np.sqrt(var)

    # ----------------------------------------------------------- classifier
    def classify(self, stations, months, values, kind="family"):
        """The trained deep-sets network. values are normalized log readings."""
        a = self.a
        p = "net_" + kind + "_"
        xm, ym = a["xy_mean"]
        toks = []
        for mi, m in enumerate(months):
            snap = self.meta["snapshot_of_month"][m]
            tn = snap / self.meta["n_snapshots"] - 0.5
            for si, s in enumerate(stations):
                toks.append([(a["x_m"][s] - xm) / 1000.0 / 30.0,
                             (a["y_m"][s] - ym) / 1000.0 / 30.0,
                             tn, values[mi][si] / 3.0])
        x = np.array(toks)
        h = _gelu(x @ a[p + "phi_0_weight"].T + a[p + "phi_0_bias"])
        h = _gelu(h @ a[p + "phi_2_weight"].T + a[p + "phi_2_bias"])
        pooled = np.r_[h.mean(0), h.max(0)]
        o = _gelu(pooled @ a[p + "rho_0_weight"].T + a[p + "rho_0_bias"])
        o = o @ a[p + "rho_2_weight"].T + a[p + "rho_2_bias"]
        e = np.exp(o - o.max())
        return e / e.sum()

    # ----------------------------------------------- campaign posterior
    def campaign(self, rows, y, cv=0.5, offset=True, censored=None):
        """Weight every training scenario by how well it explains the readings."""
        n = len(rows)
        nv = self.noise_var(cv)
        P = self.Phi[rows]
        pred = self.xbar[rows][None, :] + self.coef @ P.T      # (S, n)
        r = np.asarray(y, float)[None, :] - pred
        if censored is not None and np.any(censored):
            c = np.asarray(censored, bool)
            r[:, c] = np.minimum(r[:, c], 0.0)      # below the limit is fine
        Ri = 1.0 / nv
        if offset:
            s2 = OFFSET_SD ** 2
            denom = 1.0 + s2 * n * Ri
            q = (r ** 2).sum(1) * Ri - s2 * Ri ** 2 * r.sum(1) ** 2 / denom
            ll = -0.5 * q
        else:
            ll = -0.5 * (r ** 2).sum(1) * Ri
        w = np.exp(ll - ll.max())
        return w / w.sum()

    def parameter_summary(self, w, family):
        """Weighted quantiles of the parameters of one family's scenarios."""
        fi = self.fams.index(family)
        sel = self.fam_of == fi
        ws = w[sel]
        if ws.sum() <= 0:
            return {}
        ws = ws / ws.sum()
        out = {}
        for slot in self.meta["param_slots"][family]:
            name = self.meta["param_names"][slot]
            v = self.params[sel, slot]
            order = np.argsort(v)
            vv, ww = v[order], ws[order]
            cw = np.cumsum(ww)
            q = [float(np.interp(p, cw, vv)) for p in (0.025, 0.16, 0.5,
                                                       0.84, 0.975)]
            out[name] = dict(q=q, prior=[float(v.min()), float(v.max())])
        return out

    # ------------------------------------------------------- design advice
    def next_station(self, post, months, placed, cv=0.5):
        """The candidate cell whose reading would shrink the field most."""
        cand = self.a["candidate"].astype(bool)
        nv = self.noise_var(cv)
        w = self._weights(post)
        K = self.K
        best, best_g = None, -1.0
        for m in months:
            ok = np.flatnonzero(cand[m])
            ok = np.array([s for s in ok if s not in placed])
            if not len(ok):
                continue
            rows = m * self.n_wet + ok
            P = self.Phi[rows, :K]
            gain = np.zeros(len(ok))
            for i, f in enumerate(self.fams):
                C = post[f]["C"][:K, :K]
                Q = C @ self.W[:K, :K] @ C
                num = np.einsum("ij,jk,ik->i", P, Q, P)
                den = np.einsum("ij,jk,ik->i", P, C, P) + nv
                gain += w[i] * num / den
            j = int(np.argmax(gain))
            if gain[j] > best_g:
                best_g, best = float(gain[j]), (int(ok[j]), m)
        return best, best_g

    # ------------------------------------------------------------ warnings
    def surprise(self, post, rows, y, cv=0.5, offset=True):
        """How unlike the campaign the readings are, as a reduced chi square."""
        n = len(rows)
        nv = self.noise_var(cv)
        H0 = self.Phi[rows]
        H = np.c_[H0, np.ones(n)] if offset else H0
        K = self.K
        best = np.inf
        for fi, f in enumerate(self.fams):
            mu = np.r_[self.fam_mu[fi], 0.0] if offset else self.fam_mu[fi]
            nd = K + 1 if offset else K
            Sig = np.zeros((nd, nd))
            Sig[:K, :K] = self.fam_cov[fi]
            if offset:
                Sig[K, K] = OFFSET_SD ** 2
            Sm = H @ Sig @ H.T + nv * np.eye(n)
            r = y - (self.xbar[rows] + H @ mu)
            best = min(best, float(r @ np.linalg.solve(Sm, r) / n))
        return best


def _gelu(x):
    return x * 0.5 * (1.0 + _erf(x / np.sqrt(2.0)))


def _erf(x):
    """Abramowitz and Stegun 7.1.26, the version the JavaScript uses."""
    s = np.sign(x)
    x = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * x)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return s * y


# ---------------------------------------------------------------- demo run
def demo_survey(inst, fam, n_st=6, months=(3, 9), seed=7):
    """Six stations drawn from the candidate set, read off the true field."""
    truth = inst.a["demo_%s_truth" % fam]
    rng = np.random.default_rng(seed)
    cand = inst.a["candidate"].astype(bool)
    ok = np.flatnonzero(cand[months[0]] & cand[months[1]])
    st = np.sort(rng.choice(ok, n_st, replace=False))
    nv0 = (np.sqrt(np.log1p(0.5 ** 2)) / np.log(10)) ** 2
    rows, y = [], []
    for m in months:
        for s in st:
            rows.append(m * inst.n_wet + s)
    rows = np.array(rows)
    y = truth[rows] + rng.normal(0, np.sqrt(nv0), len(rows))
    return st, np.array(months), rows, y, truth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    inst = Instrument()
    print("bundle built %s, %d modes, %d wet cells, %d training scenarios"
          % (inst.meta["built"], inst.K, inst.n_wet, inst.meta["n_train"]))
    expected = {"offset_sd": OFFSET_SD, "cases": {}}

    for fam in ("fate", "frg", "bio"):
        st, months, rows, y, truth = demo_survey(inst, fam)
        post = inst.update(rows, y, offset=False)
        w, _ = inst.mixture(post)
        mix, sd = inst.field(post, months[1])
        sl = slice(months[1] * inst.n_wet, (months[1] + 1) * inst.n_wet)
        t = truth[sl]
        cc = float(np.corrcoef(t, mix)[0, 1])
        cov = float((np.abs(t - mix) <= sd + COV_TOL).mean())
        vals = [list(y[:len(st)]), list(y[len(st):])]
        p = inst.classify(st, months, [np.array(v) for v in vals])
        cw = inst.campaign(rows, y, offset=False)
        lead = inst.fams[int(np.argmax(w))]
        ps = inst.parameter_summary(cw, lead)
        nxt, gain = inst.next_station(post, months, set(st.tolist()))
        chi = inst.surprise(post, rows, y, offset=False)
        print("\n%s  case %s" % (fam.upper(), inst.meta["demo"][fam]["case"]))
        print("  field correlation %.4f, one sigma coverage %.4f" % (cc, cov))
        print("  mixture weights   %s" % np.round(w, 4).tolist())
        print("  classifier        %s" % np.round(p, 4).tolist())
        print("  leading family    %s, campaign weight sum %.4f"
              % (lead, float(cw[inst.fam_of == inst.fams.index(lead)].sum())))
        print("  next station      cell %d in month %d, gain %.4f"
              % (nxt[0], nxt[1], gain))
        print("  surprise          %.3f" % chi)
        expected["cases"][fam] = dict(
            case=inst.meta["demo"][fam]["case"],
            stations=[int(s) for s in st], months=[int(m) for m in months],
            y=[float(v) for v in y], corr=cc, coverage=cov,
            weights=[float(v) for v in w], classifier=[float(v) for v in p],
            next_station=[int(nxt[0]), int(nxt[1])], next_gain=gain,
            surprise=chi,
            field_checksum=float(np.abs(mix).sum()),
            sd_checksum=float(np.abs(sd).sum()),
            params={k: v["q"] for k, v in ps.items()})

    # an offset and a censored reading, to exercise both remedies
    st, months, rows, y, truth = demo_survey(inst, "fate")
    y2 = y + 1.37
    post = inst.update(rows, y2, offset=True)
    off = inst.offset_estimate(post)
    mix, sd = inst.field(post, months[1])
    sl = slice(months[1] * inst.n_wet, (months[1] + 1) * inst.n_wet)
    cc = float(np.corrcoef(truth[sl], mix)[0, 1])
    print("\nOFFSET  shift 1.37 decades: estimated %.4f, correlation %.4f"
          % (off, cc))
    expected["offset_case"] = dict(y=[float(v) for v in y2], offset=off,
                                   corr=cc, stations=[int(s) for s in st],
                                   months=[int(m) for m in months])

    lim = float(np.percentile(y, 40))
    cens = y < lim
    post = inst.update(rows, np.maximum(y, lim), censored=cens, limit=lim,
                       offset=False)
    mix, sd = inst.field(post, months[1])
    cc = float(np.corrcoef(truth[sl], mix)[0, 1])
    print("CENSOR  limit %.3f, %d of %d readings censored, correlation %.4f"
          % (lim, int(cens.sum()), len(y), cc))
    expected["censor_case"] = dict(y=[float(v) for v in np.maximum(y, lim)],
                                   censored=[bool(c) for c in cens],
                                   limit=lim, corr=cc,
                                   stations=[int(s) for s in st],
                                   months=[int(m) for m in months])

    with io.open(os.path.join(HERE, "test", "expected.json"), "w",
                 encoding="utf-8", newline="\n") as fh:
        json.dump(expected, fh, indent=1)
    with io.open(os.path.join(HERE, "test", "expected.js"), "w",
                 encoding="utf-8", newline="\n") as fh:
        fh.write("window.EXPECTED = ")
        json.dump(expected, fh)
        fh.write(";\n")
    print("\nwrote test/expected.json and test/expected.js")

    if args.check:
        check_classifier_months(inst)


def check_classifier_months(inst):
    """Does the classifier still work at months it was never trained on?"""
    p = os.path.join(HERE, "reference_inputs.npz")
    if not os.path.exists(p):
        print("reference_inputs.npz absent; rebuild with "
              "build_bundle.py --check-data to run this check")
        return
    ref = np.load(p, allow_pickle=True)
    L = ref["Lflat_val"]
    fams_val = [str(f) for f in ref["fams_val"]]
    rng = np.random.default_rng(3)
    nv0 = (np.sqrt(np.log1p(0.5 ** 2)) / np.log(10)) ** 2
    cand = inst.a["candidate"].astype(bool)
    for months, tag in (((3, 9), "April and October (app months)"),
                        ((4, 9), "May and October"),
                        ((2, 8), "March and September")):
        hits = []
        ok = np.flatnonzero(cand[months[0]] & cand[months[1]])
        for i in range(len(L)):
            if fams_val[i] == "both":
                continue
            st = rng.choice(ok, 6, replace=False)
            vals = []
            for m in months:
                rows = m * inst.n_wet + st
                vals.append(L[i][rows] + rng.normal(0, np.sqrt(nv0), 6))
            p = inst.classify(st, months, vals)
            hits.append(inst.fams[int(np.argmax(p))] == fams_val[i])
        print("classifier at %-32s accuracy %.3f (n %d)"
              % (tag, np.mean(hits), len(hits)))


if __name__ == "__main__":
    main()
