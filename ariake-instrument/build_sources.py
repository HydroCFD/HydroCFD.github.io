"""Build the source-attribution layer of the app from the paper 5 campaign.

    python build_sources.py

Paper 5 runs the same bay with the same fourteen release clusters, but keeps
the mass resolved by which cluster it came from, and carries a per-particle
age. This script turns that into a file the browser can load on demand, so a
user can ask where the plastic at a cell came from, and whether two candidate
sources are far enough apart in transit time to be told apart at all.

Five things go in.

  clusters    the fourteen release points, in degrees
  shares      per scenario, per time, per cell: the fraction of the suspended
              mass that came from each cluster, as one byte each
  params      the parameters of every paper 5 scenario, written in paper 4's
              own convention, so the app can weight the scenarios by what its
              own posterior believes about the bay
  transit     per family, per cell, per cluster: the median transit age and
              the age distribution
  separation  per family, per cell: for each of the 91 source pairs, the mean
              Hellinger distance between their age distributions and the mean
              difference in their median transit ages

The third is what lets the two papers compose: paper 4 says which scenarios
are plausible given your readings, and this file says what each of those
scenarios implies about the origin of the plastic. The fifth is paper 5's
separation limit made local: the campaign measured that two sources need about
one day of difference in median transit time before age can distinguish them,
and these arrays say whether a particular pair at a particular cell clears it.

Scenario selection. The campaign holds 720 cases in eight blocks. Three blocks
are deliberately off-distribution and are excluded here:

  bt_*   barotropic twins. CAMPAIGN.md: "never mix them into a training set".
         A different circulation, kept for the forcing-robustness test.
  alt*   held-out formulations, excluded from training by design.
  bwd*   backward-in-time runs from receptor cells, where a per-cluster mass
         field does not mean the same thing as in a forward run.

That leaves 610 forward baroclinic scenarios.

Compression. The share array is 64 MB, so the blob is gzipped before base64.
The browser inflates it with DecompressionStream, which needs a current
browser and no network.
"""
from __future__ import annotations

import base64
import collections
import gzip
import io
import json
import os
import re
import sys
import tarfile
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
P4 = os.path.normpath(os.path.join(HERE, ".."))
ROOT = os.path.normpath(os.path.join(P4, ".."))
P5 = os.path.join(ROOT, "paper5")
CAMPAIGN = os.path.join(P5, "data", "campaign_p5_full.npz")
CFG_TAR = os.path.join(P5, "data", "p5_configs.tar.gz")
OUTD = os.path.join(HERE, "data")
sys.path.insert(0, os.path.join(ROOT, "paper2", "postprocess"))
import geo  # noqa: E402

POOL = 0                      # suspended, the app's compartment
MIN_SHARE_MASS = 1e-12
DROP = re.compile(r"^p5_(bt_|alt|bwd)")

# paper 4's own parameter convention, copied from paper4/code/make_tensors.py.
# The values are the raw config numbers with log10 applied where marked, NOT
# converted to per day: paper 4's scenario table is in the config's own units,
# and the kernel compares the two tables directly.
PARAMS = [
    ("A",     "EXTENDED_PHYSICS",  "ALGAE_AMBIENT",            True),
    ("mu",    "EXTENDED_PHYSICS",  "GROWTH_MU_MAX",            True),
    ("m",     "EXTENDED_PHYSICS",  "MORTALITY",                True),
    ("R20",   "EXTENDED_PHYSICS",  "RESPIRATION_R20",          True),
    ("rhobf", "EXTENDED_PHYSICS",  "BIOFILM_DENSITY",          False),
    ("kd",    "EXTENDED_PHYSICS",  "LIGHT_KD",                 True),
    ("k0",    "EXTENDED_PHYSICS",  "FRAG_CONSTANT_RATE",       True),
    ("pf",    "EXTENDED_PHYSICS",  "FRAG_PROBABILITY",         False),
    ("df",    "EXTENDED_PHYSICS",  "FRAG_FRACTAL_DIM",         False),
    ("dmin",  "EXTENDED_PHYSICS",  "FRAG_MIN_SIZE",            True),
    ("Kh",    "PTM_SETTINGS",      "DIFFUSION_COEFFICIENT_X",  True),
    ("Kz",    "PTM_SETTINGS",      "DIFFUSION_COEFFICIENT_Z",  True),
    ("hdry",  "ADVANCED_SETTINGS", "WATER_HEIGHT_FOR_WET_DRY", False),
    ("kw",    "ADVANCED_SETTINGS", "REMOVAL_RATE_CONSTANT",    True),
]
PNAMES = [p[0] for p in PARAMS] + ["d", "rhop"]
PLOG = [p[3] for p in PARAMS] + [True, False]
FAMS = ["bio", "frg", "fate"]


def read_configs():
    """Parameters and active processes of every paper 5 case."""
    out = {}
    with tarfile.open(CFG_TAR, "r:gz") as tf:
        for m in tf.getmembers():
            if not m.name.endswith(".json"):
                continue
            name = os.path.basename(m.name)[:-5]
            c = json.load(tf.extractfile(m))
            ext = c.get("EXTENDED_PHYSICS", {}) or {}
            p = {}
            for nm, sec, key, is_log in PARAMS:
                src = c.get(sec, {}) or {}
                if key in src:
                    v = float(src[key])
                    p[nm] = np.log10(v) if is_log and v > 0 else v
            # particle properties, from the first release cluster
            cl = (c.get("RELEASE_SCENARIOS", {}).get("S1", {}) or {}).get(
                "CLUSTERS")
            if cl:
                b = cl[0]
                if "LENGTH_RANGE_A" in b:
                    d = float(np.mean(b["LENGTH_RANGE_A"]))
                    if d > 0:
                        p["d"] = np.log10(d)
                if "DENSITY_RANGE" in b:
                    p["rhop"] = float(np.mean(b["DENSITY_RANGE"]))
            out[name] = dict(params=p,
                             bio=bool(ext.get("BIOFOULING", False)),
                             frg=bool(ext.get("FRAGMENTATION", False)),
                             clusters=cl)
    return out


def median_from_hist(h, edges):
    """Median of a histogram, linear inside the straddling bin.

    h has the bin axis last; everything before it is broadcast over.

    The convention is the standard one: the smallest age whose cumulative
    reaches one half, interpolated inside the bin that straddles it. Paper
    5's separation.py reaches for np.interp(0.5, cdf, centres) instead, which
    agrees everywhere except when the cumulative sits flat at exactly one
    half across several bins. That happens here -- a cell can hold two equal
    clumps of particles -- and np.interp resolves it by wherever its binary
    search lands, which is an artefact rather than a choice. The difference
    is measured and reported by the check script; it moves no separability
    verdict.
    """
    ctr = 0.5 * (edges[:-1] + edges[1:])
    tot = h.sum(-1)
    cdf = np.cumsum(h, -1)
    with np.errstate(invalid="ignore", divide="ignore"):
        cdf = cdf / tot[..., None]
    out = np.full(h.shape[:-1], np.nan)
    ok = tot > 0
    if not ok.any():
        return out
    c = cdf[ok]                                   # (n, nbin)
    j = np.clip((c < 0.5).sum(-1), 0, len(ctr) - 1)
    r = np.arange(len(j))
    lo = np.where(j > 0, c[r, np.maximum(j - 1, 0)], 0.0)
    hi = c[r, j]
    xlo = np.where(j > 0, ctr[np.maximum(j - 1, 0)], ctr[0])
    xhi = ctr[j]
    span = np.maximum(hi - lo, 1e-12)
    out[ok] = xlo + (0.5 - lo) / span * (xhi - xlo)
    return out


def main():
    t0 = time.time()
    os.makedirs(OUTD, exist_ok=True)
    if not os.path.isfile(CAMPAIGN):
        sys.exit("no such file: %s" % CAMPAIGN)
    z = np.load(CAMPAIGN, allow_pickle=True)
    allcases = sorted(set(k.split("/")[0] for k in z.files if "/" in k))
    cases = [c for c in allcases if not DROP.match(c)]
    dropped = collections.Counter(
        DROP.match(c).group(1) for c in allcases if DROP.match(c))
    n_cl = int(z["n_clusters"])
    xe = np.asarray(z["coarse_x_edges"], float)
    ye = np.asarray(z["coarse_y_edges"], float)
    nxc, nyc = len(xe) - 1, len(ye) - 1
    edges = np.asarray(z["age_edges"], float)
    steps = np.asarray(z[cases[0] + "/steps"], int)
    n_t, n_a = len(steps), len(edges) - 1
    print("paper 5 campaign: %d cases, keeping %d, dropping %s"
          % (len(allcases), len(cases), dict(dropped)), flush=True)
    print("  %d clusters, %d x %d coarse grid, %d times, %d age bins"
          % (n_cl, nxc, nyc, n_t, n_a), flush=True)

    cfgs = read_configs()
    missing = [c for c in cases if c not in cfgs]
    if missing:
        sys.exit("no config for %d cases, first: %s"
                 % (len(missing), missing[:5]))

    # ---- which paper 4 families each scenario can stand in for
    match = np.zeros((len(cases), len(FAMS)), bool)
    for si, c in enumerate(cases):
        cfg = cfgs[c]
        match[si, 0] = cfg["bio"]
        match[si, 1] = cfg["frg"]
        match[si, 2] = not cfg["bio"] and not cfg["frg"]
    print("scenarios matchable per family: %s"
          % dict(zip(FAMS, match.sum(axis=0).tolist())), flush=True)
    if not match.any(axis=1).all():
        sys.exit("%d scenarios match no family" % int((~match.any(1)).sum()))

    # ---- the fourteen release points, numbered north to south
    # Everything indexed by cluster below is read in this order, so no array
    # ever has to be permuted afterwards.
    base = None
    for c in cases:
        if cfgs[c]["clusters"]:
            base = cfgs[c]["clusters"]
            break
    cx = np.array([float(b["X"]) for b in base])
    cy = np.array([float(b["Y"]) for b in base])
    clon, clat = geo.to_lonlat(cx, cy)
    order = np.argsort(-clat)
    cx, cy, clon, clat = cx[order], cy[order], clon[order], clat[order]

    # ---- which coarse cells ever hold suspended mass
    occ = np.zeros(nxc * nyc, bool)
    for c in cases:
        m = z[c + "/mass"][:, POOL]                    # (cluster, time, cell)
        occ |= (m.sum(axis=(0, 1)) > MIN_SHARE_MASS)
    cells = np.flatnonzero(occ)
    n_c = len(cells)
    print("occupied cells: %d of %d" % (n_c, occ.size), flush=True)

    # ---- shares per scenario, as one byte each
    S = len(cases)
    shares = np.zeros((S, n_t, n_c, n_cl), np.uint8)
    for si, c in enumerate(cases):
        m = np.asarray(z[c + "/mass"][:, POOL], float)[order][:, :, cells]
        tot = m.sum(axis=0)                             # (time, cell)
        with np.errstate(invalid="ignore", divide="ignore"):
            fr = np.where(tot[None] > MIN_SHARE_MASS, m / tot[None], 0.0)
        shares[si] = np.round(255 * fr.transpose(1, 2, 0)).astype(np.uint8)
    print("shares %.1f MB" % (shares.nbytes / 1048576), flush=True)

    # ---- transit time and separation, pooled per family
    # For each scenario the per-cell per-cluster age distribution is read,
    # its median taken, and the 91 pairwise Hellinger distances computed.
    # The paper computes the Hellinger per scenario and averages over pairs,
    # so that is what is averaged here rather than pooling the histograms
    # first, which would understate every distance.
    pi, pj = np.triu_indices(n_cl, 1)
    n_p = len(pi)
    accH = np.zeros((len(FAMS), n_c, n_p))
    accG = np.zeros((len(FAMS), n_c, n_p))
    accN = np.zeros((len(FAMS), n_c, n_p))
    accD = np.zeros((len(FAMS), n_c, n_cl, n_a))
    accM = np.zeros((len(FAMS), n_c, n_cl))
    accMn = np.zeros((len(FAMS), n_c, n_cl))
    clusH = np.zeros((len(FAMS), n_cl, n_a))
    tA = time.time()
    for si, c in enumerate(cases):
        ah = z[c + "/age_hist"][:, POOL][order]         # (K,T,cell,age)
        h = ah[:, :, cells].sum(axis=1)                 # (K,cell,age)
        h = np.ascontiguousarray(h.transpose(1, 0, 2))  # (cell,K,age)
        tot = h.sum(-1)
        with np.errstate(invalid="ignore", divide="ignore"):
            hn = np.where(tot[..., None] > 0, h / np.maximum(tot, 1e-300)[
                ..., None], 0.0)
        med = median_from_hist(h, edges)                # (cell,K)
        # the bay-wide figure follows separation.py: pool the raw histogram
        # over cells first, so it is weighted by mass, then normalise
        hb = h.sum(axis=0)                              # (K,age)
        sb = hb.sum(-1, keepdims=True)
        hb = np.divide(hb, sb, out=np.zeros_like(hb), where=sb > 0)
        sq = np.sqrt(hn)
        bc = np.einsum("cab,cab->ca", sq[:, pi], sq[:, pj])
        hell = np.sqrt(np.maximum(1.0 - bc, 0.0))       # (cell,pair)
        good = (tot[:, pi] > 0) & (tot[:, pj] > 0) \
            & np.isfinite(med[:, pi]) & np.isfinite(med[:, pj])
        gap = np.abs(med[:, pi] - med[:, pj])
        for fi in range(len(FAMS)):
            if not match[si, fi]:
                continue
            accH[fi] += np.where(good, hell, 0.0)
            accG[fi] += np.where(good, np.nan_to_num(gap), 0.0)
            accN[fi] += good
            accD[fi] += hn
            ok = tot > 0
            accM[fi] += np.where(ok, np.nan_to_num(med), 0.0)
            accMn[fi] += ok
            clusH[fi] += hb
        if (si + 1) % 100 == 0:
            print("  age pass %d/%d, %.0f s"
                  % (si + 1, S, time.time() - tA), flush=True)

    with np.errstate(invalid="ignore", divide="ignore"):
        pair_hell = np.where(accN > 0, accH / np.maximum(accN, 1), np.nan)
        pair_gap = np.where(accN > 0, accG / np.maximum(accN, 1), np.nan)
        age_med = np.where(accMn > 0, accM / np.maximum(accMn, 1), np.nan)
    # peak-normalised distributions, one byte each; the browser renormalises
    pk = accD.max(-1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        age_dist = np.where(pk > 0, np.round(255 * accD / np.maximum(
            pk, 1e-300)), 0).astype(np.uint8)
    clus_med = median_from_hist(clusH, edges)           # (fam,K)

    nan_h = ~np.isfinite(pair_hell)
    print("separation: %d of %d cell-pairs have data per family"
          % (int((~nan_h).sum()), pair_hell.size), flush=True)
    for fi, f in enumerate(FAMS):
        v = pair_hell[fi][np.isfinite(pair_hell[fi])]
        g = pair_gap[fi][np.isfinite(pair_gap[fi])]
        print("  %-5s Hellinger %.3f median, gap %.1f d median, "
              "%.0f%% of pairs clear 1 day"
              % (f, np.median(v) if v.size else np.nan,
                 np.median(g) if g.size else np.nan,
                 100 * (g >= 1.0).mean() if g.size else np.nan))
        print("        bay-wide median transit age %s d"
              % " ".join("%.0f" % x for x in clus_med[fi]))

    # ---- paper 5 scenario parameters in paper 4's convention
    P = np.full((S, len(PNAMES)), np.nan, np.float32)
    for si, c in enumerate(cases):
        p = cfgs[c]["params"]
        for j, nm in enumerate(PNAMES):
            if nm in p and p[nm] is not None and np.isfinite(p[nm]):
                P[si, j] = p[nm]
    for j, nm in enumerate(PNAMES):
        col = P[:, j]
        if np.isfinite(col).any():
            print("  %-6s %d values, %.4g to %.4g"
                  % (nm, int(np.isfinite(col).sum()), np.nanmin(col),
                     np.nanmax(col)))

    blocks = collections.Counter(
        re.match(r"p5_([a-z]+)", c).group(1) for c in cases)

    # ---- pack
    arrays = {
        "shares": shares,
        "cells": cells.astype(np.int32),
        "cluster_lon": clon.astype(np.float32),
        "cluster_lat": clat.astype(np.float32),
        "cluster_x": cx.astype(np.float32),
        "cluster_y": cy.astype(np.float32),
        "scen_params": P,
        "scen_match": match.astype(np.uint8),
        "steps": steps.astype(np.int32),
        "x_edges": xe.astype(np.float32), "y_edges": ye.astype(np.float32),
        "age_edges": edges.astype(np.float32),
        "age_dist": age_dist,
        "age_med": np.nan_to_num(age_med, nan=-1.0).astype(np.float32),
        "clus_med": np.nan_to_num(clus_med, nan=-1.0).astype(np.float32),
        "pair_hell": np.nan_to_num(pair_hell, nan=-1.0).astype(np.float32),
        "pair_gap": np.nan_to_num(pair_gap, nan=-1.0).astype(np.float32),
        "pair_i": pi.astype(np.int32), "pair_j": pj.astype(np.int32),
    }
    blob = io.BytesIO()
    header = {}
    for name, a in arrays.items():
        a = np.ascontiguousarray(a)
        pad = (-blob.tell()) % 8
        if pad:
            blob.write(b"\0" * pad)
        header[name] = dict(dtype=str(a.dtype), shape=list(a.shape),
                            offset=blob.tell(), bytes=a.nbytes)
        blob.write(a.tobytes())
    raw = blob.getvalue()
    gz = gzip.compress(raw, 6)

    meta = dict(
        built=time.strftime("%Y-%m-%d %H:%M"),
        source="paper5 full campaign, %d of %d cases" % (S, len(allcases)),
        dropped_blocks=dict(dropped),
        blocks=dict(blocks),
        pool="suspended", n_clusters=n_cl, n_scenarios=S, n_times=n_t,
        n_cells=n_c, n_age=n_a, n_pairs=n_p, nx=nxc, ny=nyc,
        scenarios=cases, families=FAMS,
        param_names=PNAMES, param_log=PLOG,
        steps=[int(s) for s in steps],
        # paper 5's measured performance, from outputs/gate_full.txt and
        # outputs/recalibration.txt; quoted in the interface
        skill=dict(top1=0.7044, location_only=0.605, control=0.589,
                   gain=0.1156, z=48.6, ece_raw=0.0636, ece_cal=0.0082,
                   n_points=8000, channel="age"),
        separation=dict(noise_hellinger=0.0024, noise_sd=0.0154,
                        threshold=0.0485, gap_days=1.0, corr=0.844),
        note="shares are fractions of 255; age_dist is peak-normalised to "
             "255; -1 marks no data in age_med, clus_med, pair_hell, "
             "pair_gap",
        compression="gzip", raw_bytes=len(raw),
        arrays=header, total_bytes=len(gz))
    with io.open(os.path.join(OUTD, "sources.json"), "w",
                 encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, indent=1)
    b64 = base64.b64encode(gz).decode("ascii")
    with io.open(os.path.join(OUTD, "sources_b64.js"), "w",
                 encoding="utf-8", newline="\n") as fh:
        fh.write("// Generated by build_sources.py. Do not edit.\n")
        fh.write("window.SOURCES_META = ")
        json.dump(meta, fh)
        fh.write(";\nwindow.SOURCES_B64 = \"")
        fh.write(b64)
        fh.write("\";\nif (window.onSourcesLoaded) window.onSourcesLoaded();\n")
    print("sources: %.1f MB raw, %.2f MB gzip (%.1fx), %.2f MB base64, %.0f s"
          % (len(raw) / 1048576, len(gz) / 1048576, len(raw) / len(gz),
             len(b64) / 1048576, time.time() - t0))


if __name__ == "__main__":
    main()
