"""Phase 0: write the app's data bundle from the campaign.

    python build_bundle.py

Produces data/bundle_b64.js (a single JavaScript file holding a base64 blob
of every array, so the app runs from a double-clicked index.html with no
server) and data/bundle.json alongside it for inspection.

What goes in, and why each piece is needed:

  phi          the 15 field patterns over 12 monthly snapshots, wet cells
               only. Any field the bay can make is a mix of these.
  xbar         the campaign mean field, the starting point of the update
  repr_var     per cell, what the 15 patterns cannot describe
  fam_mu/cov   one Gaussian prior over the 15 mixing numbers per process
               family, with the 25 % diagonal shrinkage of the paper
  coef/params  the training scenarios as 15 coefficients and their known
               parameter values, for the campaign posterior over parameters
  grid         which cell of the 128 x 128 map each wet cell is, and where
               it sits in metres and in degrees
  shore        the model's own coastline, as polygons
  setnet       the 33,603 weights of the trained process classifier
  demo         the true fields of three held-out scenarios, one per family

The bundle is built on the TRAINING split only, and the three demo
scenarios are forced into the validation side, so the app's own examples are
never cases it was built from.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
P4 = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(P4, "data", "tensors_full.npz")
OUTD = os.path.join(HERE, "data")
sys.path.insert(0, os.path.join(P4, "..", "paper2", "postprocess"))
import geo  # noqa: E402

EPS = 1e-6
CV = 0.5
K = 15                 # retained modes
K_FAM = 8              # modes the family evidence is judged in
SHRINK = 0.25          # diagonal shrinkage of the family covariances
WET_FRAC = 0.7
EXCLUDE_BOUNDARY_KM = 5.0
VAL_FRAC = 0.2
SPLIT_SEED = 20260902
MONTH_IDX = [3, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80]
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
DEMO = {"fate": "pr_ensc07", "frg": "pr_frg11", "bio": "pr_bio10"}
FAMS = ("bio", "frg", "fate")
FAM_SLOTS = {"bio": [0, 1, 2, 3, 4, 5, 14, 15],
             "frg": [6, 7, 8, 9, 14, 15],
             "fate": [12, 13, 14, 15]}
PARAM_META = {
    "A": ("Ambient algal concentration", "cells/m3", True),
    "mu": ("Maximum growth rate", "1/d", True),
    "m": ("Grazing mortality", "1/d", True),
    "R20": ("Respiration at 20 C", "1/d", True),
    "rhobf": ("Biofilm density", "kg/m3", False),
    "kd": ("Light attenuation", "1/m", True),
    "k0": ("Background fragmentation rate", "1/s", True),
    "pf": ("Fragmentation probability", "-", False),
    "df": ("Fractal dimension", "-", False),
    "dmin": ("Cascade floor", "m", True),
    "hdry": ("Beaching threshold", "m", False),
    "kw": ("Washout rate", "1/s", True),
    "d": ("Particle diameter", "m", True),
    "rhop": ("Particle density", "kg/m3", False),
}


def main():
    t0 = time.time()
    os.makedirs(OUTD, exist_ok=True)
    z = np.load(DATA, allow_pickle=True)
    cases = np.array([str(c) for c in z["cases"]])
    fams = np.array([str(f) for f in z["family"]])
    groups = np.array([str(g) for g in z["group"]])
    pnames = [str(p) for p in z["param_names"]]
    plog = np.array(z["param_log"], dtype=bool)
    xc, yc = z["unc_x"], z["unc_y"]
    print("loading suspended stack ...", flush=True)
    X12 = np.array(z["suspended"][:, MONTH_IDX])          # (n,12,128,128)
    n_all, n_t = X12.shape[0], len(MONTH_IDX)
    ncell = 128 * 128
    X12 = X12.reshape(n_all, n_t, ncell)
    print("loaded %.0f s" % (time.time() - t0), flush=True)

    wet = (X12 > 0).any(axis=(0, 1))                      # union over all
    wet_idx = np.flatnonzero(wet)
    n_wet = len(wet_idx)
    Xw = X12[:, :, wet_idx].astype(np.float64)
    s = X12.sum(axis=2, keepdims=True)                    # normalise per map
    Lw = np.log10(np.where(s > 0, Xw / np.maximum(s, 1e-30), 0.0) + EPS)
    nonempty = (s[:, :, 0] > 0)                           # (n,12)
    del X12
    Lflat = Lw.reshape(n_all, n_t * n_wet)
    print("wet cells %d, state vector %d" % (n_wet, Lflat.shape[1]),
          flush=True)

    # ---- split: seeded, with the three demo scenarios forced into validation
    rng = np.random.default_rng(SPLIT_SEED)
    keep = fams != "both"
    ug = np.unique(groups[keep])
    val_g = set(rng.choice(ug, int(round(VAL_FRAC * len(ug))), replace=False))
    for name in DEMO.values():
        j = int(np.flatnonzero(cases == name)[0])
        val_g.add(groups[j])
    train = np.array([i for i in range(n_all)
                      if keep[i] and groups[i] not in val_g])
    val = np.array([i for i in range(n_all)
                    if keep[i] and groups[i] in val_g])
    print("train %d  val %d" % (len(train), len(val)), flush=True)

    # ---- the 15 patterns, from the training scenarios only
    from sklearn.utils.extmath import randomized_svd
    xbar = Lflat[train].mean(0)
    A = Lflat[train] - xbar
    _, _, Vt = randomized_svd(A, n_components=K + 10, random_state=0)
    Phi = Vt[:K].T                                        # (12*n_wet, K)
    coef = A @ Phi
    resid = A - coef @ Phi.T
    repr_cell = (resid ** 2).mean(0)                      # per state entry
    print("basis built, mean representation error %.4f, %.0f s"
          % (repr_cell.mean(), time.time() - t0), flush=True)

    # ---- one Gaussian prior per process family
    fam_tr = fams[train]
    fam_mu, fam_cov = [], []
    for f in FAMS:
        c = coef[fam_tr == f]
        C = np.cov(c.T)
        C = (1 - SHRINK) * C + SHRINK * np.diag(np.diag(C)) + 1e-4 * np.eye(K)
        fam_mu.append(c.mean(0))
        fam_cov.append(C)
        print("  %-4s %4d scenarios" % (f, len(c)))
    fam_mu = np.array(fam_mu)
    fam_cov = np.array(fam_cov)

    # ---- candidate cells for the design advice
    Xt = Xw[train]
    ne = nonempty[train]
    wf = np.stack([(Xt[ne[:, m], m] > 0).mean(axis=0) for m in range(n_t)])
    near_bnd = yc[wet_idx] < yc[wet_idx].min() + 1000.0 * EXCLUDE_BOUNDARY_KM
    candidate = (wf >= WET_FRAC) & ~near_bnd[None, :]     # (12, n_wet)
    print("candidate cells per month:", candidate.sum(1).tolist(), flush=True)
    del Xt

    # ---- the printed plan, mapped onto wet indices
    plan = json.load(open(os.path.join(P4, "outputs", "survey_design.json")))
    w_of_cell = -np.ones(ncell, dtype=np.int32)
    w_of_cell[wet_idx] = np.arange(n_wet)
    plan_st = [int(w_of_cell[c]) for c in plan["best_stations_cells"]]

    # ---- demo scenarios: their true fields, kept out of the basis.
    # The three named ones are the worked examples of the paper. Three more
    # are chosen automatically, one per family, to span the range of
    # behaviour a survey can meet: they are scored at the printed plan and
    # the best, the median and a poor case are taken.
    demo = {}
    for fam, name in DEMO.items():
        i = int(np.flatnonzero(cases == name)[0])
        demo[fam] = dict(case=name, index=i,
                         truth=Lflat[i].astype(np.float32),
                         nonempty=nonempty[i].astype(np.uint8))

    nv0 = (np.sqrt(np.log1p(CV ** 2)) / np.log(10)) ** 2
    nv = nv0 + float(repr_cell.mean())
    rows = np.array([m * n_wet + c for m in plan["best_months"]
                     for c in plan_st])
    H = Phi[rows]
    rng2 = np.random.default_rng(11)
    mshow = plan["best_months"][1]
    sl = slice(mshow * n_wet, (mshow + 1) * n_wet)
    Ps = Phi[sl]
    skill = {}
    for i in val:
        truth = Lflat[i]
        if truth[sl].std() < 1e-9:
            continue
        y = truth[rows] + rng2.normal(0, np.sqrt(nv0), len(rows))
        means, lls = [], []
        for fi in range(3):
            Sm = H @ fam_cov[fi] @ H.T + nv * np.eye(len(rows))
            Smi = np.linalg.inv(Sm)
            r = y - (xbar[rows] + H @ fam_mu[fi])
            a = fam_mu[fi] + fam_cov[fi] @ H.T @ Smi @ r
            means.append(xbar[sl] + Ps @ a)
            sign, logdet = np.linalg.slogdet(Sm)
            lls.append(-0.5 * (r @ Smi @ r + logdet))
        w = np.exp(np.array(lls) - max(lls))
        w /= w.sum()
        mix = sum(w[k] * means[k] for k in range(3))
        skill[i] = float(np.corrcoef(truth[sl], mix)[0, 1])
    extra = {}
    for fam, tag, q in (("bio", "bio_easy", 0.90), ("frg", "frg_easy", 0.90),
                        ("fate", "fate_hard", 0.15)):
        pool = [(v, i) for i, v in skill.items()
                if fams[i] == fam and cases[i] not in DEMO.values()]
        pool.sort()
        if not pool:
            continue
        v, i = pool[min(len(pool) - 1, int(q * (len(pool) - 1)))]
        extra[tag] = dict(case=str(cases[i]), index=int(i), skill=round(v, 3),
                          family=fam)
        demo[tag] = dict(case=str(cases[i]), index=int(i),
                         truth=Lflat[i].astype(np.float32),
                         nonempty=nonempty[i].astype(np.uint8))
        print("  extra demo %-10s %-14s family %-4s skill %.3f"
              % (tag, cases[i], fam, v), flush=True)

    # ---- classifier weights: the app's own, trained for any visit month,
    # falling back to the paper's fixed-month network if they are absent
    import torch
    nets = {}
    cls_meta = {}
    for kind in ("family", "regime"):
        p = os.path.join(HERE, "app_setnet_%s.pt" % kind)
        if os.path.exists(p):
            nets[kind] = torch.load(p, map_location="cpu", weights_only=True)
    if not nets:
        nets["family"] = torch.load(os.path.join(P4, "outputs",
                                                 "setnet_cls.pt"),
                                    map_location="cpu", weights_only=True)
        cls_meta["note"] = "paper classifier, trained at fixed visit times"
    p = os.path.join(HERE, "app_classifier.json")
    if os.path.exists(p):
        cls_meta = json.load(open(p))
    print("classifiers in bundle:", sorted(nets), flush=True)
    xy_all = np.c_[xc, yc].astype(np.float32)
    xy_mean = xy_all.mean(0)

    # ---- geography
    lon, lat = geo.to_lonlat(xc[wet_idx], yc[wet_idx])
    shore = np.load(os.path.join(P4, "..", "paper2", "postprocess",
                                 "shoreline_cache.npz"), allow_pickle=True)
    n_loops = int(shore["n_loops"])
    loops, opens = [], []
    for i in range(n_loops):
        loops.append(np.asarray(shore["loop%d" % i], dtype=np.float32))
        opens.append(np.asarray(shore["open%d" % i], dtype=np.uint8))
    print("shoreline loops:", [len(l) for l in loops], flush=True)

    # ---- assemble
    arrays = {
        "phi": Phi.astype(np.float32),
        "xbar": xbar.astype(np.float32),
        "repr_cell": repr_cell.astype(np.float32),
        "fam_mu": fam_mu.astype(np.float32),
        "fam_cov": fam_cov.astype(np.float32),
        "coef": coef.astype(np.float32),
        "params": z["params"][train].astype(np.float32),
        "fam_of_scenario": np.array(
            [FAMS.index(f) for f in fam_tr], dtype=np.uint8),
        "grid_index": wet_idx.astype(np.int32),
        "x_m": xc[wet_idx].astype(np.float32),
        "y_m": yc[wet_idx].astype(np.float32),
        "lon": lon.astype(np.float32),
        "lat": lat.astype(np.float32),
        "candidate": candidate.astype(np.uint8),
        "plan_stations": np.array(plan_st, dtype=np.int32),
        "xy_mean": xy_mean.astype(np.float32),
    }
    for i, (l, o) in enumerate(zip(loops, opens)):
        arrays["shore%d" % i] = l
        arrays["shore_open%d" % i] = o
    for kind, sd in nets.items():
        for k, v in sd.items():
            arrays["net_%s_%s" % (kind, k.replace(".", "_"))] = \
                v.numpy().astype(np.float32)
    for fam in demo:
        arrays["demo_%s_truth" % fam] = demo[fam]["truth"]
        arrays["demo_%s_nonempty" % fam] = demo[fam]["nonempty"]

    blob = io.BytesIO()
    header = {}
    for name, a in arrays.items():
        a = np.ascontiguousarray(a)
        pad = (-blob.tell()) % 8          # typed arrays need aligned offsets
        if pad:
            blob.write(b"\x00" * pad)
        header[name] = dict(dtype=str(a.dtype), shape=list(a.shape),
                            offset=blob.tell(), bytes=a.nbytes)
        blob.write(a.tobytes())
    raw = blob.getvalue()

    meta = dict(
        built=time.strftime("%Y-%m-%d %H:%M"),
        source="tensors_full.npz, 1636 scenarios",
        n_train=int(len(train)), n_val=int(len(val)),
        modes=K, modes_family_evidence=K_FAM, shrinkage=SHRINK,
        cv=CV, eps=EPS, n_wet=int(n_wet), n_months=n_t, ncell=ncell,
        nx=128, month_idx=MONTH_IDX, months=MONTHS,
        snapshot_of_month=MONTH_IDX, n_snapshots=84,
        families=list(FAMS),
        family_labels=["Biofouling", "Fragmentation", "Fate"],
        param_names=pnames, param_log=[bool(b) for b in plog],
        param_slots={f: FAM_SLOTS[f] for f in FAMS},
        param_meta={k: dict(label=v[0], unit=v[1], log=v[2])
                    for k, v in PARAM_META.items()},
        plan_months=plan["best_months"], plan_stations=plan_st,
        wet_frac=WET_FRAC, exclude_boundary_km=EXCLUDE_BOUNDARY_KM,
        n_shore=n_loops,
        classifiers=sorted(nets), classifier_meta=cls_meta,
        classifier_labels=dict(
            family=["Biofouling", "Fragmentation", "Fate"],
            regime=["Sinking", "Fragmenting", "Buoyant"]),
        grid=dict(x0=float(xc.reshape(128, 128)[0, 0]),
                  dx=float((xc.reshape(128, 128)[0, -1]
                            - xc.reshape(128, 128)[0, 0]) / 127.0),
                  y0=float(yc.reshape(128, 128)[0, 0]),
                  dy=float((yc.reshape(128, 128)[-1, 0]
                            - yc.reshape(128, 128)[0, 0]) / 127.0)),
        demo={f: dict(case=demo[f]["case"],
                      family=(f if f in DEMO else demo[f].get("family", f)))
              for f in demo},
        demo_extra=extra,
        arrays=header, total_bytes=len(raw))

    with io.open(os.path.join(OUTD, "bundle.json"), "w",
                 encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, indent=1)
    b64 = base64.b64encode(raw).decode("ascii")
    with io.open(os.path.join(OUTD, "bundle_b64.js"), "w",
                 encoding="utf-8", newline="\n") as fh:
        fh.write("// Generated by build_bundle.py. Do not edit.\n")
        fh.write("window.BUNDLE_META = ")
        json.dump(meta, fh)
        fh.write(";\nwindow.BUNDLE_B64 = \"")
        fh.write(b64)
        fh.write("\";\n")
    print("bundle: %.2f MB raw, %.2f MB base64, %d arrays, %.0f s"
          % (len(raw) / 1048576, len(b64) / 1048576, len(arrays),
             time.time() - t0))

    if "--check-data" in sys.argv:
        # 100 MB of held-out fields, only for reference.py --check
        np.savez(os.path.join(HERE, "reference_inputs.npz"),
                 train=train, val=val, wet_idx=wet_idx,
                 Lflat_val=Lflat[val].astype(np.float32),
                 cases_val=cases[val], fams_val=fams[val],
                 nonempty_val=nonempty[val])
        print("wrote reference_inputs.npz (100 MB, not needed by the app)")
    print("wrote data/bundle_b64.js and data/bundle.json")


if __name__ == "__main__":
    main()
