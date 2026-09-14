"""Train the app's process classifier, valid at any visit month.

    python app_classifier.py

The paper's classifier (outputs/setnet_cls.pt) was trained with the visit
times fixed to one of three patterns, so its time input only ever took six
values. The app lets a user pick any two of twelve months, and at months the
network never saw its accuracy drops from 0.67 to about 0.61 and it can be
confidently wrong.

This trains the same architecture on the same training split, but with the
visit months drawn at random from the twelve the app offers, and with three
to twenty stations. Two labelings are trained, as in the paper:

    family   which process switch was on (biofouling, fragmentation, fate)
    regime   what the particles actually did (sinking, fragmenting, buoyant)

Writes app_setnet_family.pt, app_setnet_regime.pt and app_classifier.json.
"""
from __future__ import annotations

import io
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
P4 = os.path.normpath(os.path.join(HERE, ".."))
DEV = "cuda" if torch.cuda.is_available() else "cpu"

EPS = 1e-6
CV = 0.5
MONTH_IDX = [3, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80]
N_SNAP = 84
VAL_FRAC = 0.2
SPLIT_SEED = 20260902
DEMO = ("pr_ensc07", "pr_frg11", "pr_bio10")
STEPS = 12000
SEED = 20260910


class SetNet(nn.Module):
    def __init__(self, dout=3, demb=128):
        super().__init__()
        self.phi = nn.Sequential(nn.Linear(4, 64), nn.GELU(),
                                 nn.Linear(64, demb), nn.GELU())
        self.rho = nn.Sequential(nn.Linear(2 * demb, 96), nn.GELU(),
                                 nn.Linear(96, dout))

    def forward(self, x, mask):
        h = self.phi(x)
        m = mask[..., None]
        mean = (h * m).sum(1) / m.sum(1).clamp(min=1)
        mx = h.masked_fill(~mask[..., None], -1e9).max(1).values
        return self.rho(torch.cat([mean, mx], -1))


def build_data():
    z = np.load(os.path.join(P4, "data", "tensors_full.npz"), allow_pickle=True)
    cases = np.array([str(c) for c in z["cases"]])
    fams = np.array([str(f) for f in z["family"]])
    groups = np.array([str(g) for g in z["group"]])
    r = np.load(os.path.join(P4, "data", "regime_labels_full.npz"),
                allow_pickle=True)
    regime = np.array([str(x) for x in r["regime"]])
    print("loading ...", flush=True)
    X = np.array(z["suspended"][:, MONTH_IDX])
    n_all = X.shape[0]
    ncell = 128 * 128
    X = X.reshape(n_all, len(MONTH_IDX), ncell)
    wet = (X > 0).any(axis=(0, 1))
    wet_idx = np.flatnonzero(wet)
    s = X.sum(axis=2, keepdims=True)
    L = np.log10(np.where(s > 0, X[:, :, wet_idx] / np.maximum(s, 1e-30),
                          0.0) + EPS).astype(np.float32)
    xy = np.c_[z["unc_x"], z["unc_y"]].astype(np.float32)
    xy_n = (xy[wet_idx] - xy.mean(0)) / 1000.0 / 30.0
    rng = np.random.default_rng(SPLIT_SEED)
    keep = fams != "both"
    ug = np.unique(groups[keep])
    val_g = set(rng.choice(ug, int(round(VAL_FRAC * len(ug))), replace=False))
    for nm in DEMO:
        val_g.add(groups[int(np.flatnonzero(cases == nm)[0])])
    tr = np.array([i for i in range(n_all)
                   if keep[i] and groups[i] not in val_g])
    va = np.array([i for i in range(n_all) if keep[i] and groups[i] in val_g])
    # candidate cells, as the app offers them
    Xt = X[tr][:, :, wet_idx]
    ne = (s[tr, :, 0] > 0)
    wf = np.stack([(Xt[ne[:, m], m] > 0).mean(axis=0)
                   for m in range(len(MONTH_IDX))])
    yc = z["unc_y"][wet_idx]
    near = yc < yc.min() + 5000.0
    cand = [np.flatnonzero((wf[m] >= 0.7) & ~near)
            for m in range(len(MONTH_IDX))]
    print("train %d val %d, wet %d, candidates %s" % (
        len(tr), len(va), len(wet_idx), [len(c) for c in cand]), flush=True)
    return L, xy_n, tr, va, fams, regime, cand


def survey(L, xy_n, cand, i, n_st, months, rng, sig):
    toks = []
    for m in months:
        st = rng.choice(cand[m], n_st, replace=False)
        v = L[i, m, st] + rng.normal(0, sig, n_st)
        tn = np.float32(MONTH_IDX[m] / N_SNAP - 0.5)
        for k in range(n_st):
            toks.append([xy_n[st[k], 0], xy_n[st[k], 1], tn,
                         np.float32(v[k] / 3.0)])
    return np.array(toks, dtype=np.float32)


def train(L, xy_n, cand, ids, labels, classes, rng, sig, steps=STEPS):
    lab2i = {c: i for i, c in enumerate(classes)}
    counts = np.array([sum(labels[i] == c for i in ids) for c in classes],
                      float)
    w = torch.tensor((counts.sum() / counts) / (counts.sum() / counts).mean(),
                     dtype=torch.float32, device=DEV)
    net = SetNet().to(DEV)
    opt = torch.optim.Adam(net.parameters(), 1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    lossf = nn.CrossEntropyLoss(weight=w)
    t0 = time.time()
    for step in range(steps):
        rows, ys, lens = [], [], []
        for _ in range(128):
            i = ids[rng.integers(len(ids))]
            n_st = int(rng.integers(3, 21))
            nv = int(rng.choice([1, 2, 4]))
            months = rng.choice(len(MONTH_IDX), nv, replace=False)
            t = survey(L, xy_n, cand, i, n_st, months, rng, sig)
            rows.append(t)
            ys.append(lab2i[labels[i]])
            lens.append(len(t))
        T = max(lens)
        x = np.zeros((128, T, 4), np.float32)
        mask = np.zeros((128, T), bool)
        for b, t in enumerate(rows):
            x[b, :len(t)] = t
            mask[b, :len(t)] = True
        opt.zero_grad()
        out = net(torch.tensor(x, device=DEV), torch.tensor(mask, device=DEV))
        lossf(out, torch.tensor(ys, device=DEV)).backward()
        opt.step()
        sched.step()
        if (step + 1) % 3000 == 0:
            print("   step %5d, %.0f s" % (step + 1, time.time() - t0),
                  flush=True)
    net.eval()
    return net


def evaluate(net, L, xy_n, cand, ids, labels, classes, rng, sig,
             months, n_st=6, reps=20):
    lab2i = {c: i for i, c in enumerate(classes)}
    hits, conf, chit = [], 0, 0
    for i in ids:
        for _ in range(reps):
            t = survey(L, xy_n, cand, i, n_st, months, rng, sig)
            with torch.no_grad():
                o = net(torch.tensor(t[None], device=DEV),
                        torch.ones(1, len(t), dtype=bool, device=DEV))[0]
            p = torch.softmax(o, -1).cpu().numpy()
            k = int(np.argmax(p))
            hits.append(k == lab2i[labels[i]])
            if p.max() > 0.9:
                conf += 1
                chit += int(k == lab2i[labels[i]])
    return dict(acc=float(np.mean(hits)), frac_p90=conf / len(hits),
                reliability_p90=(chit / conf if conf else None))


def main():
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    sig = float(np.sqrt(np.log1p(CV ** 2)) / np.log(10))
    L, xy_n, tr, va, fams, regime, cand = build_data()
    out = {"steps": STEPS, "months": MONTH_IDX, "n_train": int(len(tr)),
           "n_val": int(len(va))}
    for tag, labels, classes in (
            ("family", fams, ("bio", "frg", "fate")),
            ("regime", regime, ("sinking", "fragmenting", "buoyant"))):
        print("training %s ..." % tag, flush=True)
        net = train(L, xy_n, cand, tr, labels, classes, rng, sig)
        torch.save(net.state_dict(),
                   os.path.join(HERE, "app_setnet_%s.pt" % tag))
        res = {}
        for months, name in (((3, 9), "Apr+Oct"), ((2, 8), "Mar+Sep"),
                             ((0, 6), "Jan+Jul"), ((5, 11), "Jun+Dec")):
            res[name] = evaluate(net, L, xy_n, cand, va, labels, classes,
                                 rng, sig, months)
            r = res[name]
            print("  %-8s %-8s acc %.3f  confident %.1f%%  reliable %s"
                  % (tag, name, r["acc"], 100 * r["frac_p90"],
                     ("%.2f" % r["reliability_p90"])
                     if r["reliability_p90"] else "-"), flush=True)
        out[tag] = dict(classes=list(classes), by_months=res)
    with io.open(os.path.join(HERE, "app_classifier.json"), "w",
                 encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
    print("wrote app_setnet_family.pt, app_setnet_regime.pt")


if __name__ == "__main__":
    main()
