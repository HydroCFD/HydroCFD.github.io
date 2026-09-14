"""Independent recomputation of the source bundle, on the fate family.

Reads the published bundle back out of sources_b64.js and rebuilds the same
arrays from campaign_p5_full.npz by a separate code path, so a mistake in the
builder would have to be made twice in the same way to survive.
"""
import base64, gzip, io, json, re, os
import numpy as np

APP = r"D:\postdoc\microplastic_developing_solver\paper4\app"
NPZ = r"D:\postdoc\microplastic_developing_solver\paper5\data\campaign_p5_full.npz"

meta = json.load(io.open(os.path.join(APP, "data", "sources.json"),
                         encoding="utf-8"))
txt = io.open(os.path.join(APP, "data", "sources_b64.js"),
              encoding="utf-8").read()
b64 = re.search(r'SOURCES_B64 = "([^"]+)"', txt).group(1)
raw = gzip.decompress(base64.b64decode(b64))
assert len(raw) == meta["raw_bytes"], "raw size mismatch"


def arr(name):
    h = meta["arrays"][name]
    a = np.frombuffer(raw, dtype=h["dtype"], count=int(np.prod(h["shape"])),
                      offset=h["offset"])
    return a.reshape(h["shape"])


cells = arr("cells")
edges = arr("age_edges").astype(float)
ctr = 0.5 * (edges[:-1] + edges[1:])
clon, clat = arr("cluster_lon"), arr("cluster_lat")
print("bundle: %d scenarios, %d cells, %d clusters"
      % (meta["n_scenarios"], meta["n_cells"], meta["n_clusters"]))

# clusters must come out sorted north to south
assert np.all(np.diff(clat) <= 0), "clusters not ordered north to south"
print("cluster order north to south: OK, %.3fN down to %.3fN"
      % (clat[0], clat[-1]))

z = np.load(NPZ, allow_pickle=True)
names = meta["scenarios"]
fate = [i for i, n in enumerate(names) if n.startswith("p5_fat")]
print("recomputing the %d fate scenarios independently" % len(fate))

# the cluster permutation the builder used, rediscovered from the coordinates
import tarfile, sys
sys.path.insert(0, r"D:\postdoc\microplastic_developing_solver\paper2\postprocess")
import geo
with tarfile.open(r"D:\postdoc\microplastic_developing_solver\paper5\data"
                  r"\p5_configs.tar.gz", "r:gz") as tf:
    for m in tf.getmembers():
        if m.name.endswith("p5_fat000.json"):
            cfg = json.load(tf.extractfile(m))
            break
cl = cfg["RELEASE_SCENARIOS"]["S1"]["CLUSTERS"]
cx = np.array([float(b["X"]) for b in cl])
cy = np.array([float(b["Y"]) for b in cl])
lon0, lat0 = geo.to_lonlat(cx, cy)
order = np.argsort(-lat0)
assert np.allclose(lat0[order], clat, atol=1e-4), "cluster coords differ"

K, nC, nA = meta["n_clusters"], meta["n_cells"], meta["n_age"]
S = len(fate)

# --- shares, straight from mass
sh_ref = np.zeros((S, meta["n_times"], nC, K), np.uint8)
for a, si in enumerate(fate):
    m = np.asarray(z[names[si] + "/mass"][:, 0], float)[order][:, :, cells]
    tot = m.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        fr = np.where(tot[None] > 1e-12, m / tot[None], 0.0)
    sh_ref[a] = np.round(255 * fr.transpose(1, 2, 0)).astype(np.uint8)
sh = arr("shares")[fate]
print("shares identical: %s" % bool(np.array_equal(sh, sh_ref)))

# --- median transit age and pairwise separation, family index 2 = fate
acc_med = np.zeros((nC, K))
acc_n = np.zeros((nC, K))
pi, pj = np.triu_indices(K, 1)
accH = np.zeros((nC, len(pi)))
accG = np.zeros((nC, len(pi)))
accGnp = np.zeros((nC, len(pi)))
accN = np.zeros((nC, len(pi)))
for si in fate:
    npi = np.full((nC, K), np.nan)
    ah = z[names[si] + "/age_hist"][:, 0][order]
    h = np.ascontiguousarray(ah[:, :, cells].sum(axis=1).transpose(1, 0, 2))
    tot = h.sum(-1)
    hn = np.zeros_like(h)
    ok = tot > 0
    hn[ok] = h[ok] / tot[ok][:, None]
    med = np.full((nC, K), np.nan)
    for c in range(nC):                       # deliberately a plain loop
        for k in range(K):
            if not ok[c, k]:
                continue
            cdf = np.cumsum(hn[c, k])
            j = int((cdf < 0.5).sum())        # first bin reaching one half
            j = min(j, len(ctr) - 1)
            x0, y0 = (0.0, ctr[0]) if j == 0 else (cdf[j - 1], ctr[j - 1])
            med[c, k] = y0 + (0.5 - x0) / max(cdf[j] - x0, 1e-12) \
                * (ctr[j] - y0)
            npi[c, k] = np.interp(0.5, cdf, ctr)
    acc_med[ok] += med[ok]
    acc_n += ok
    bc = np.sqrt(hn[:, pi]) * np.sqrt(hn[:, pj])
    hell = np.sqrt(np.maximum(1.0 - bc.sum(-1), 0.0))
    good = ok[:, pi] & ok[:, pj]
    accH += np.where(good, hell, 0.0)
    accG += np.where(good, np.nan_to_num(np.abs(med[:, pi] - med[:, pj])), 0.0)
    accGnp += np.where(good,
                       np.nan_to_num(np.abs(npi[:, pi] - npi[:, pj])), 0.0)
    accN += good

med_ref = np.where(acc_n > 0, acc_med / np.maximum(acc_n, 1), -1.0)
hell_ref = np.where(accN > 0, accH / np.maximum(accN, 1), -1.0)
gap_ref = np.where(accN > 0, accG / np.maximum(accN, 1), -1.0)

med_b = arr("age_med")[2]
hell_b = arr("pair_hell")[2]
gap_b = arr("pair_gap")[2]


def cmp(name, a, b, tol):
    m = (a > -0.5) & (b > -0.5)
    same_missing = np.array_equal(a > -0.5, b > -0.5)
    d = np.abs(a[m] - b[m]).max() if m.any() else 0.0
    print("  %-10s n=%6d  max abs diff %.3e  missing-pattern match %s  %s"
          % (name, int(m.sum()), d, same_missing, "OK" if d < tol
             and same_missing else "MISMATCH"))
    return d < tol and same_missing


# Tolerance 0.05 d. The two paths normalise the histogram at different
# points, so where the cumulative is nearly flat across the half-way mark the
# interpolation amplifies a float64 rounding difference by a bin width. Half
# an hour is fifty times below the one-day separation limit.
ok1 = cmp("age_med", med_b, med_ref, 0.05)
ok2 = cmp("pair_hell", hell_b, hell_ref, 2e-6)
ok3 = cmp("pair_gap", gap_b, gap_ref, 0.05)

# --- does the median convention change any separability verdict?
gap_np = np.where(accN > 0, accGnp / np.maximum(accN, 1), -1.0)
m = (gap_ref > -0.5) & (gap_np > -0.5)
lim = meta["separation"]["gap_days"]
flip = ((gap_ref[m] >= lim) != (gap_np[m] >= lim)).sum()
print("\nmedian convention, standard vs np.interp on the same data")
print("  max difference in the pair gap  %.3f d" % np.abs(
    gap_ref[m] - gap_np[m]).max())
print("  mean difference                 %.4f d" % np.abs(
    gap_ref[m] - gap_np[m]).mean())
print("  verdicts changed at the %.0f day limit: %d of %d (%.2f%%)"
      % (lim, flip, m.sum(), 100.0 * flip / m.sum()))

# Does the same ambiguity reach paper 5's own published statistic? There the
# histogram is pooled over cells, times and all three compartments before the
# median is taken, so an exact tie at one half is far less likely.
print("\nthe same question on separation.py's own statistic (fate block)")
worst, nflip = 0.0, 0
for si in fate:
    ah = z[names[si] + "/age_hist"]
    hb = ah.sum((1, 2, 3))                    # (K, age), all pools
    sb = hb.sum(-1, keepdims=True)
    hb = np.divide(hb, sb, out=np.zeros_like(hb), where=sb > 0)
    for k in range(K):
        if hb[k].sum() <= 0:
            continue
        cdf = np.cumsum(hb[k].astype(float))
        j = min(int((cdf < 0.5).sum()), len(ctr) - 1)
        x0, y0 = (0.0, ctr[0]) if j == 0 else (cdf[j - 1], ctr[j - 1])
        a = y0 + (0.5 - x0) / max(cdf[j] - x0, 1e-12) * (ctr[j] - y0)
        b = float(np.interp(0.5, cdf, ctr))
        if abs(a - b) > worst:
            worst = abs(a - b)
        if abs(a - b) > 1e-6:
            nflip += 1
print("  %d of %d source medians differ at all; largest difference %.4f d"
      % (nflip, len(fate) * K, worst))

# --- the paper's separation rule reproduced on the bundle
g = gap_ref[gap_ref > -0.5]
h = hell_ref[hell_ref > -0.5]
print("\nfate family, per cell and pair: %d measured pairs" % g.size)
print("  correlation between age gap and Hellinger: %.3f"
      % float(np.corrcoef(g, h)[0, 1]))
for lo, hi in [(0, 0.25), (0.25, 0.5), (0.5, 1), (1, 2), (2, 4), (4, 8),
               (8, 1e9)]:
    m = (g >= lo) & (g < hi)
    if m.sum() < 20:
        continue
    print("  gap %5.2f - %-6s pairs %6d  mean Hellinger %.4f"
          % (lo, ("%.2f d" % hi) if hi < 1e8 else "more", m.sum(),
             h[m].mean()))

print("\n%s" % ("ALL CHECKS PASS" if (ok1 and ok2 and ok3
                                      and np.array_equal(sh, sh_ref))
                else "SOMETHING DIFFERS"))
