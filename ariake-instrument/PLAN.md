# The Ariake survey instrument, as an app — plan

Written 2026-09-10, before any code. Nothing is built yet.

---

## 1. What it is

A web page that shows the Ariake Sea. You click a few points on the map,
type the microplastic concentration you measured at each, and press one
button. The page then shows:

- the suspended concentration field of the **whole bay**, drawn as a map,
- an **uncertainty map** beside it, saying where the first map can be trusted,
- **which process is governing** the bay, with a probability, or a refusal to
  answer when the readings do not support one,
- **plausible ranges for the process parameters**,
- **where to put the next station**, and the optimal plan from the paper.

It is the paper made usable. A person with a boat and a laboratory can open
it, enter six numbers, and read the three answers the paper promises.

**Who it is for:** first, Danial, to show supervisors and at conferences.
Second, a reviewer of the paper, who can try the instrument instead of
believing a table. Third, a monitoring agency, as the demonstration that the
plan in Table 8 is worth sailing.

---

## 2. The single most important design decision

**Everything runs in the browser. There is no server and no internet.**

This is possible because the trained instrument is small. Measured, not
guessed:

| Piece | Size |
|---|---|
| Field basis, 15 modes over 12 months, wet cells only | 4.7 MB (2.4 MB at half precision) |
| Mean field and representation error per cell | 0.6 MB |
| The 1,636 campaign scenarios as 15 coefficients + 16 parameters | 0.2 MB |
| Process classifier (33,603 weights) | 0.13 MB |
| Coastline (5 polygons, 2,416 points) | 0.02 MB |
| **Total** | **3.4 to 5.7 MB** |

The mathematics is a 15 by 15 matrix inversion and a few matrix products.
That is microseconds of work. The reconstruction of a whole map is one
matrix-vector product of about 1.2 million multiplications, which a browser
does in a few milliseconds.

Consequences of this choice, all good:

- The app is a folder. Copy it to a memory stick, it works.
- It can be deposited on Zenodo with the paper, and it will still run in ten
  years, because it depends on nothing.
- No cost, no maintenance, no account, no upload of anyone's data.
- A reviewer can open it without installing Python.

---

## 3. What the app shows, and how honest each part is

The paper's methods are reused exactly where possible. Where the app must do
something different, it is labelled in the interface itself.

| Output | Method | Faithful to the paper? |
|---|---|---|
| Reconstructed field | Mixture of process families in the 15-mode basis, Gaussian update (Eqs. 2 to 4) | **Yes, identical** |
| Per-cell uncertainty | Mixture variance plus representation error | **Yes, identical** |
| Process probability, closed form | Family evidence weights (Eq. 4) | **Yes, identical** |
| Process probability, network | The trained deep-sets classifier, its 33,603 weights re-implemented in about 40 lines of JavaScript | **Yes, same weights**; to be checked against Python to 4 decimals |
| Refusal to answer | The 0.9 confidence rule of Section 3.3 | **Yes** |
| Parameter ranges | Each of the 1,636 campaign scenarios weighted by how well it explains the readings, then a weighted histogram of its parameters | **No.** The paper uses amortized neural posteriors. This is a discrete campaign posterior. It must be labelled as such in the interface. |
| Next best station | The A-optimal gain of Eq. 5, recomputed given the stations already placed | **Yes, identical** |
| Optimal plan overlay | The six stations of Table 8 | **Yes** |

**Why not the neural posteriors for the parameters.** They are normalizing
flows and need PyTorch. Running them means a Python server, which destroys
the "it is just a folder" property. The discrete campaign posterior gives
the same kind of answer, is exact within the 15-mode representation, is
explainable in one sentence, and costs nothing. If it later proves to
disagree with the flows, the honest fix is to say so in the interface, or to
add an optional Python mode. That is a later phase, not a first one.

---

## 4. Two features that make it usable with real data

Both come from the tests already in Section 3.7 of the paper, so the app is
not inventing anything.

**Any unit is accepted.** The instrument works with concentrations
normalized over the bay. A person with a boat has particles per cubic metre.
The offset coefficient of Section 3.7 absorbs the unknown scale, so the user
enters whatever their laboratory reported and the app carries the conversion
as an unknown. This is switched on by default; it costs almost nothing when
it is not needed and it saves the answer when it is.

**Below the detection limit is a valid entry.** A station where nothing was
found is informative. The user ticks a box, and that reading enters through
the censored likelihood of Section 3.7 instead of being treated as an exact
small number.

---

## 5. The screen

One page, three regions.

**Left, the map.** Ariake Sea with its real coastline, drawn from the model
mesh. The background is the average field of the chosen month, so the user
sees the bay before measuring anything. Clicking places a station. Stations
are numbered circles that can be dragged or deleted.

**Right, the data.** One row per station: longitude, latitude, the reading
at visit 1, the reading at visit 2, a "below detection" box, a delete
button. Above the table: which months the two visits happened in, the
assumed measurement error, and the unit mode. Below it: one button, and the
warnings.

**Below, the results.** Four panels that appear after the button is pressed:

1. The reconstructed field, in the same map frame as the input.
2. The uncertainty map beside it.
3. Process probabilities as three bars, with the confident or not-confident
   verdict written in words.
4. Parameter ranges of the leading family, as small interval plots.

Plus one line of advice: where the next station should go, and how much it
would add.

**Demo mode.** A button that loads one of the three worked examples from the
paper (the clean fate case, the fragmentation case, and the sinking case
that fails). In demo mode the true field is known, so the app can show truth
beside reconstruction and print the correlation. This is what makes the app
convincing rather than merely pretty, and it doubles as the test suite.

---

## 6. Warnings the app must give

An instrument that stays silent when it is out of its depth is worse than no
instrument. Three checks, all cheap:

- **Not enough readings.** Fewer than three, and the app says the answer is
  mostly the prior.
- **The readings are unlike anything in the campaign.** Measured by how far
  the readings sit from the prior predictive distribution. If they are far,
  the bay is doing something the training never saw, and Section 3.6 shows
  the reconstruction then fails while its uncertainty stays honest. The app
  says so.
- **Not confident about the process.** Below 0.9 the app refuses to name a
  process, exactly as in the paper. It shows the bars anyway, greyed.

---

## 7. Files

```
paper4/app/
  PLAN.md              this document
  README.md            how to open it, what it does, what it does not do
  build_bundle.py      Python: writes the data bundle from the campaign
  reference.py         Python: the same maths, used to verify the JavaScript
  index.html           the app, one page
  app.css              styling
  js/
    bundle.js          loads and unpacks the data
    linalg.js          small dense matrix maths, 15 by 15
    instrument.js      reconstruction, evidence, classifier, design
    map.js             canvas drawing, coastline, clicks, colour scales
    ui.js              wiring
  data/
    bundle.bin         the arrays, one binary blob
    bundle.json        shapes, names, colour limits, the optimal plan
  test/
    verify.html        runs the three examples, compares against reference.py
    expected.json      the numbers reference.py produced
  serve.py            starts a local server and opens the browser
```

Everything the app needs is inside `paper4/app/`. It never reaches into the
campaign data at run time.

---

## 8. Build order

Each phase ends with something that can be looked at. Nothing starts before
the phase above it works.

**Phase 0, the bundle and the reference.** `build_bundle.py` writes the 15
modes, the mean, the representation error, the family statistics, the
scenario coefficients and parameters, the coastline and the classifier
weights. `reference.py` implements the whole instrument in Python from the
bundle alone and reproduces the paper's numbers for the three worked
examples. *Checkpoint: the reference reproduces correlation 0.93, 0.75 and
0.43 for the three examples, and the family weights of Section 3.1.*

**Phase 1, the map.** Coastline, background field, click to place a station,
the station table, month and unit controls. No mathematics yet.
*Checkpoint: the map looks like the bay and stations can be placed and
edited.*

**Phase 2, the reconstruction.** The Gaussian update in JavaScript, both
maps drawn. *Checkpoint: `verify.html` reproduces `reference.py` to four
decimals on the three examples.*

**Phase 3, the process.** Evidence weights, the classifier in JavaScript,
the confidence rule, the parameter histograms. *Checkpoint: classifier
probabilities match Python to four decimals; the sinking example refuses to
commit, as in the paper.*

**Phase 4, the design assistant.** Next best station, the optimal plan
overlay, the warnings. *Checkpoint: with no stations placed, the app's own
suggestion reproduces the first station of Table 8.*

**Phase 5, finishing.** Demo mode with truth, README, a printable summary of
a session, and the offline check that it runs from a memory stick.

Realistic effort: phases 0 to 2 are the substance. Phases 3 to 5 are
smaller.

---

## 9. Risks, and what is done about each

| Risk | Response |
|---|---|
| The JavaScript maths silently differs from the Python | `verify.html` compares against `reference.py` on every phase. A mismatch is a build failure, not a detail. |
| Opening `index.html` from the file system blocks the data load in some browsers | `serve.py` starts a local server with one command. A second build option inlines the data for true double-click use. |
| The app implies more certainty than the paper supports | The warnings of Section 6, the refusal rule, and a permanent line in the interface: trained on simulations, never yet tested against a real Ariake sample. |
| Someone reads a number off the app and cites it | Every export carries the method, the month, the assumed error and the version of the bundle. |
| The bundle drifts from the paper's results | `build_bundle.py` reads the same tensors as the paper's scripts and stamps the bundle with the date and the split seed. |

---

## 10. Three decisions for Danial

1. **Is this a supplement to the paper, or a private demonstration?** If it
   is a supplement, it goes on Zenodo, gets a sentence in the Data
   Availability statement, and the labelling has to be strict. This is what
   is recommended, since a working instrument is a strong thing to hand a
   reviewer.
2. **Parameter ranges by the campaign posterior, as proposed, or wait for a
   Python mode with the real neural posteriors?** The campaign posterior is
   recommended for the first version.
3. **Two visits, or also a single visit?** Supporting both is easy. The
   default should be two, since that is the paper's plan.

---

## 11. What the app is not

- Not a forecast. It says what the bay looks like now, given the readings,
  not what it will do next.
- Not calibrated to absolute tonnes. It works in patterns, as the paper does.
- Not validated on real measurements. No real Ariake sample has ever been
  through this instrument, and the interface will say so.
- Not a replacement for the transport model. It is a trained summary of one
  campaign of that model, for one bay, for one simulated year.

---

## Build status, 2026-09-10

All five phases are built and the app runs. `test/verify.html` reports
**54 of 54 checks passing**, most at machine precision.

| Phase | State | Evidence |
|---|---|---|
| 0 bundle and reference | done | `data/bundle_b64.js` 9.3 MB, 48 arrays; `reference.py` runs the three demos |
| 1 map and data entry | done | coastline from the model mesh, click to place, station table |
| 2 reconstruction | done | browser matches Python to 4 decimals on 54 quantities |
| 3 process and parameters | done | two classifiers, evidence weights, campaign parameter ranges |
| 4 design assistant | done | next station by the gain criterion, plan overlay, three warnings |
| 5 demo mode and packaging | done | three held-out examples with the truth shown, README, serve.py |

### Decisions taken during the build

1. **The classifiers were retrained** (`app_classifier.py`). The paper's
   network only ever saw two fixed visit times; at the app's months its
   accuracy fell to 0.61 and it was confidently wrong on the fragmentation
   demo. The retrained pair reaches 0.69 to 0.72 at every month pair with
   0.93 to 0.97 of confident answers correct, and gets all three demos
   right. Same architecture, same training split, visit months drawn at
   random. The paper's own numbers are untouched.

2. **The demo readings are given in laboratory units**, four decades above
   the instrument's normalized scale, so the offset coefficient is exercised
   on every demo run rather than sitting idle.

3. **Coverage ties are broken with a tolerance of 1e-9.** The sinking
   scenario leaves 4,887 of 6,893 cells at the detection floor, which puts
   392 cells exactly on the one sigma threshold; without the tolerance
   Python and the browser disagreed on all 392 at once.

4. **`reference_inputs.npz` (100 MB) is no longer written by default.** It
   is only needed by `reference.py --check`; pass `--check-data` to
   `build_bundle.py` to regenerate it. The shipped app folder is 9.8 MB.

### What the demos do

| Example | Correlation | Coverage | Behaviour |
|---|---|---|---|
| Fate | 0.94 | 91 % | clean, evidence confident and right |
| Fragmentation | 0.78 | 77 % | evidence confident and right, networks abstain |
| Sinking | 0.34 | 56 % | fails, and the out-of-distribution warning fires |

The third is deliberate. It shows the instrument refusing to pretend.

### Still open

- Section 10 decision 1: whether this ships as a supplement to the paper.
  If yes, it needs a line in the Data Availability statement and a place in
  the Zenodo deposit. `DEPOSIT.md` has a slot ready.
- An optional Python mode that runs the paper's real neural posteriors for
  the parameter panel, for anyone willing to install PyTorch.

### Rendering fixes, 2026-09-10 (after first user look)

- **Station markers read "undefined".** They looked for a `label` field that
  only the plan overlay carries. Now they fall back to their position in the
  list. One-line bug, fixed in `map.js`.
- **Everything was soft on a high-density screen.** Canvases were sized in
  CSS pixels, so a retina display stretched every drawing. All canvases and
  colour bars now size to `devicePixelRatio`, capped at three.
- **The result maps were sized while hidden**, so they came out at the 240 px
  minimum. The results section is now shown before its canvases are measured,
  and they open at 380 px or wider.
- **A dark fringe ran along the coast.** Transparent land pixels carry black,
  and the browser blended them into the shore when scaling the raster up. The
  colour of the edge cells is now bled three cells outwards behind the
  transparency.
- Coastline width, marker size and label size now scale with the canvas.
- A sentence in the interface says what number to type and in what unit.

### Third pass, 2026-09-10: examples, help and colour

- **Thirteen worked examples** replace the three demo buttons, grouped into
  how many samples, telling the processes apart, difficult conditions and
  other draws. Each is a held-out scenario plus a survey configuration that
  demonstrates one finding of the paper, and each reproduces it: three
  readings 0.92 against twenty stations 0.94; fragmentation 0.75 with two
  visits and 0.52 with one; winter 0.88 against summer 0.96; noise and
  censoring leaving the pattern at 0.94.
- **Three more scenarios in the bundle**, chosen automatically by skill at
  the printed plan rather than by hand, so the gallery spans real variety.
  Bundle 7.9 MB raw, 10.5 MB as base64.
- **A help layer.** A toggle in the header reveals an explanation beside
  every control and every result, and every control carries a hover tip. An
  intro box explains the whole method in four sentences.
- **RdBu reversed** replaces viridis, sampled at seventeen stops from
  matplotlib. Station markers went near-black, the plan green and the advice
  marker dark amber, so none of them disappears into either end of the scale.

### An honest negative found while testing the examples

The two biofouling examples reconstruct at 0.86 and 0.22, and **no signal
available to the instrument separates them in advance**. Reduced chi square
is 3.06 and 2.98; median posterior uncertainty is 0.68 and 0.69 decades;
near-floor reading counts are 5 of 12 and 6 of 12. The old warning fired on
the good case and missed the bad one.

The warning was therefore rewritten to say only what is true: that most
stations found almost nothing, that a nearly empty water column carries
little pattern to recover, and that the per-cell uncertainty stays honest
even where the shape of the map does not. It no longer claims to predict
which map will be poor, because it cannot.

---

### Fifth pass, 2026-09-13: the source campaign finished, layer rebuilt

Paper 5's remaining 658 cases ran, so the source layer moved from a
62-scenario pilot to the finished 720-case campaign. `build_sources.py` was
rewritten around it.

**What is in the bundle now.** 610 scenarios, not 62. Three blocks of the
720 are excluded, and the reason is in the campaign design rather than in
convenience: the 60 barotropic twins are labelled in CAMPAIGN.md as never to
be mixed into a training set, the 40 held-out formulations are excluded from
training by design, and the 10 backward-in-time runs do not carry a per-source
mass field that means the same thing as a forward run's. The excluded blocks
are what prove the method transfers; they are not what the bay is doing.

**Three defects in the pilot-era builder, found and fixed.**

1. The fragmentation switch was read from `ADVANCED_SETTINGS.FRAGMENTATION`,
   which does not exist. It lives in `EXTENDED_PHYSICS`. With the pilot this
   was invisible, because the pilot held no fragmentation cases. On the full
   campaign it would have labelled all 122 of them as fate.
2. `hdry` and `kw` were read from `BEACHING_DEPTH` and `WASHOUT_RATE`, which
   also do not exist; the real keys are `WATER_HEIGHT_FOR_WET_DRY` and
   `REMOVAL_RATE_CONSTANT` in `ADVANCED_SETTINGS`. The fate family therefore
   had no parameters at all to match on. The four fragmentation parameters
   were missing for the same reason.
3. `mu`, `m` and `R20` were converted from per second to per day before
   being compared. Paper 4's own scenario table keeps the raw config value,
   so every biofouling comparison carried a constant 4.94-decade offset. It
   does not cancel, because the kernel squares the difference.

The parameter map is now copied from `paper4/code/make_tensors.py` rather
than rewritten.

**A scenario can now stand in for more than one family.** The 122 spectrum
cases run biofouling and fragmentation together. `scen_match` records which
of paper 4's families each scenario may be compared against, and the kernel
compares on that family's own parameter slots. No family is missing now, so
the fallback text no longer fires.

**Transit time, which is the new physics.** The campaign carries a
per-particle age. Three arrays were added: the median transit age per family,
cell and source; the age distribution behind it; and, for each of the 91
source pairs at each cell, the mean Hellinger distance between their age
distributions and the mean difference in their medians. The Hellinger is
computed per scenario and then averaged, which is what the campaign's own
separation analysis does -- pooling the histograms first would understate
every distance.

**Compression.** The share array alone is 61 MB, so the blob is gzipped
(6.6x, to 9.4 MB) and inflated in the browser with `DecompressionStream`.
That is a browser API, so it still works from a `file://` page with no
network, but it needs a browser from 2023 or later; the loader says so
plainly if it is missing rather than failing silently.

**The median convention, and why it is not paper 5's.** `separation.py` takes
the median with `np.interp(0.5, cdf, centres)`. When the cumulative sits flat
at exactly one half across several bins, np.interp resolves the tie by
wherever its binary search lands, which is an artefact. The app uses the
standard definition instead: the smallest age whose cumulative reaches one
half. On the app's per-cell histograms the two disagree on 0.52 % of pairs;
on paper 5's own pooled statistic they disagree on none of 588, because
pooling over cells, times and compartments makes an exact tie vanish. So the
published separation numbers are unaffected and need no correction.

**Verified.** `check_sources.py` rebuilds the published arrays from the
campaign by a separate code path, on the fate family: shares bit-identical,
pairwise Hellinger to 8e-8, transit times to 0.02 days. The browser reproduces
the Python instrument at 54 of 54 checks; all thirteen examples run with the
layer on; a twelve-month sweep produces no console errors.
