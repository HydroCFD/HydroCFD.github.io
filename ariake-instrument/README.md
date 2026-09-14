# Ariake Sea microplastic survey instrument

Live page: **https://hydrocfd.github.io/ariake-instrument/**

A browser version of the Bayesian survey instrument described in the
manuscript "A simulation-trained Bayesian instrument for microplastic
surveys", with the source-attribution layer from the companion study.
Place stations on the bay, type in what you measured, and it reconstructs
the whole suspended field with its uncertainty, names the governing process,
and says where to sample next.

Everything runs in the browser. There is no server and no analytics. The page
works offline: download the folder and open `index.html`.

---

**This is an unpublished preview, shared for comment.** Neither manuscript is
in print. The source-attribution layer in particular comes from a study that
has no manuscript at all yet. Please do not redistribute.

---

Open `index.html`. Click a few points on the bay, type what you measured,
press one button.

If your browser refuses to load the data file from disk, run this instead
and it will open by itself:

```
python serve.py
```

Nothing is installed, nothing is uploaded, and no internet is needed. The
whole trained instrument is the 9 MB file in `data/`.

---

## What it gives you

Press **Show help** in the top right for a short explanation beside every
control and every result. Hovering a control also shows a one-line tip.

| Panel | What it is |
|---|---|
| Reconstructed field | The suspended concentration of the whole bay, from your readings |
| Uncertainty | Where that map can be trusted. Bright means guessing. |
| Which process is governing | Three probabilities, or an honest refusal to name one |
| Parameters | Plausible ranges for the constants of the leading process |
| Advice | Where the next station would help most |

It answers in about twenty milliseconds.

---

## Entering your data

**Units do not matter.** Leave the setting on "a concentration, any unit"
and type whatever your laboratory reported, in particles per cubic metre or
anything else. The instrument works with patterns normalized over the bay,
so it carries the difference in scale as an unknown and solves for it. It
tells you afterwards how many decades your numbers sat above its own scale.

**A station where nothing was found is still useful.** Tick the box marked
`<lim` next to that reading and type your detection limit in the box above
the table. The reading then enters as "somewhere below this line" instead of
as a number, which is the honest treatment and keeps the uncertainty
truthful.

**Two visits are better than one.** Fragmentation reveals itself through the
change between visits, so a single visit weakens the process identification
even though it barely changes the map.

---

## The worked examples

The list under the table holds thirteen real scenarios from the campaign,
none of which the instrument was built from. Because the truth is known for
each, a third map appears beside your answer with the correlation printed.
Every entry demonstrates one finding of the paper.

| Example | What it shows | Correlation |
|---|---|---|
| Three readings, one visit | Three well placed samples already carry most of the information | 0.92 |
| Six stations, two visits | The plan the paper recommends | 0.94 |
| Twenty stations, two visits | Forty readings instead of twelve buys almost nothing | 0.94 |
| Fragmentation, two visits | The change between visits is what names the process | 0.75 |
| The same case, one visit | Cancel the second trip and the identification weakens | 0.52 |
| Biofouling still afloat | Plenty left in the water to measure | 0.86 |
| Biofouling that has sunk | The instructive failure, and the warning that comes with it | 0.22 |
| A noisy laboratory | Readings four times noisier, pattern unchanged | 0.94 |
| Half below detection | Six readings as bounds rather than numbers | 0.94 |
| A winter survey | January and February, depleted water columns | 0.88 |
| A summer survey | July and August, the best months | 0.96 |
| Fragmentation, another draw | How much the answer moves with the scenario | 0.74 |
| Fate, a poor draw | Even a weak fate case reconstructs well | 0.91 |

Load one, then change the months, the error slider or the stations and press
"Read the bay" again to see what moves.

**One honest note about the sunken case.** Its correlation collapses to 0.22
while a very similar biofouling case reaches 0.86, and nothing in the
readings tells the two apart in advance. The app warns that most stations
found almost nothing, which is true of both, but it cannot promise which
map will be good. The per-cell uncertainty stays honest in both. That limit
is real and is stated in the paper.

---

## What is faithful to the paper, and what is not

| Output | Method | Same as the paper? |
|---|---|---|
| Field and uncertainty | Mixture of process priors in a 15-mode basis, Gaussian update | Yes, the same equations |
| "Closed-form evidence" bars | The family evidence weights | Yes |
| The two neural classifiers | The same architecture, retrained so that any pair of visit months is valid | Same method, retrained |
| Refusal below nine in ten | The paper's confidence rule | Yes |
| Next station | The A-optimal gain criterion | Yes |
| Parameter ranges | The 1,304 training scenarios weighted by how well each explains your readings | **No.** The paper uses neural posteriors. This is a simpler route to the same question, and the app says so where the ranges appear. |

**Why the classifiers were retrained.** The paper's network only ever saw
two fixed visit times, so at other months its accuracy fell from 0.67 to
about 0.61 and it could be confidently wrong. The app's version is trained
with the visit months drawn at random, and reaches 0.69 to 0.72 at every
month pair, with 0.93 to 0.97 of its confident answers correct. Training it
is `app_classifier.py`.

---

## Honest limits

- It has **never been tested against a real Ariake sample**. Every number in
  it comes from simulations.
- It knows **one bay and one simulated year**. It is not transferable as it
  stands.
- It reports **patterns, not tonnes**. The absolute load is exactly what the
  offset coefficient throws away.
- Under a circulation or a transformation formulation unlike the training,
  the map loses most of its skill. The uncertainty widens and the warning
  fires, but a wrong map is still a wrong map.

---

## The files

| File | What it does |
|---|---|
| `index.html`, `app.css`, `js/` | The app |
| `data/bundle_b64.js` | Everything the instrument knows, 11 MB |
| `data/sources_b64.js` | The source layer, 13 MB, loaded only on request |
| `build_bundle.py` | Rebuilds the instrument file from the campaign |
| `build_sources.py` | Rebuilds the source file from the source campaign |
| `reference.py` | The same mathematics in Python, the definition of correct |
| `check_sources.py` | Rebuilds the source arrays independently and compares |
| `app_classifier.py` | Trains the two classifiers the app uses |
| `test/verify.html` | Runs the browser code against `reference.py` |
| `serve.py` | Opens the app in a browser |
| `PLAN.md` | How it was designed and why |

**Verification.** Open `test/verify.html` (or `python serve.py --verify`).
It recomputes 54 quantities both ways and marks any disagreement beyond four
decimals as a failure. All 54 currently pass, most at machine precision.

**Rebuilding.** If the campaign or the plan changes:

```
python app_classifier.py    # about 20 minutes on a GPU, optional
python build_bundle.py      # about 40 seconds
python build_sources.py     # about 2 minutes, only if the source campaign moved
python reference.py         # regenerates the expected numbers
```

Then open `test/verify.html` again before trusting the app.

---

## What number do I type?

The **suspended microplastic concentration** you measured at that station,
in whatever unit your laboratory reported. Pieces per cubic metre is the
usual one. Milligrams per cubic metre, pieces per litre or anything else
works equally well.

Two rules, and no others:

1. **Every station must use the same unit.** The instrument reads the
   pattern across your stations, not their absolute size.
2. **It must be the water column, not the bed.** This instrument only knows
   what is floating or suspended. Sediment samples are a different quantity
   and it has never been trained on them.

The absolute scale is thrown away on purpose, and the app tells you how many
decades your numbers sat above its own internal scale. That is why any unit
is accepted.

The second setting, "log10 of the normalized field", is for anyone who
already has the quantity the instrument works in, namely the concentration
divided by the bay total, on a base ten logarithm. Those values normally
fall between -6 and -3. Leave it alone unless you know you want it.

---

## Which dates does the map apply to?

**The months you sampled, and every other month of the year as well.**

The fifteen patterns describe the whole simulated year jointly, not one month
at a time. So readings taken in April and October pin down the same fifteen
numbers that also fix the field in January, in July, and in every other
month. The selector under the reconstructed map lets you step through all
twelve. The ones you sampled are marked.

Two things to understand about that.

**The uncertainty grows for months you did not visit,** and the app says by
how much. On the fragmentation example, sampled in April and October, the
typical uncertainty is a factor of 4.5 either way in October and a factor of
5.9 in January. The second map shows where that extra doubt sits.

**A month is not a calendar date.** The instrument works at monthly steps,
twelve through the year, and it knows one simulated year of the bay driven by
one year of weather. "April" means April in that modelled year. If you
sampled on a day with unusual winds or an unusual river discharge, the
reconstruction reflects the modelled April, not that particular day. Treat
the answer as the typical state of the bay in that month, conditioned on your
readings.

## In what unit is the map?

If you entered readings in your own unit, **the reconstructed map comes back
in that same unit**. The colour bar shows real concentrations, not
logarithms. The app does this by adding back the scale it solved for, which
it also reports in words.

The uncertainty map is a factor, not a concentration. A value of 4 there
means the true concentration in that cell is likely to lie between a quarter
and four times the value on the reconstructed map.

## The equations

The foot of the page carries the seven lines the whole instrument rests on,
written compactly: the fifteen-pattern decomposition of the field, the
survey as a linear observation of it, the Gaussian update run once per
process, the evidence weights that become the process probabilities, the
mixture that is the map, the variance that is the uncertainty, and the gain
criterion that picks the next station. Two extensions follow: the unknown
scale carried as one more unknown, and a reading that only reports a bound.

They are Equations 1 to 5 of the paper plus the two remedies from its
section on baselines and further tests. The page solves them exactly, in
about fifteen milliseconds, with no approximation beyond the fifteen
patterns themselves.

## Saving, exporting and printing

Four buttons under the table.

- **Save survey** writes your stations, readings and settings to a small
  file. Reopen it later with **Load survey**, or send it to a colleague.
- **Export the map** writes the reconstructed concentration and its
  uncertainty for every one of the 6,893 cells of the shown month as a
  spreadsheet. The columns are longitude, latitude, concentration, its
  logarithm, the uncertainty in decades, the uncertainty as a factor, and
  the lower and upper one sigma bounds. The month, the settings, the units
  and the solved scale are recorded at the top of the file.
- **Print summary** produces a one page record: the map, the reconstruction,
  the uncertainty, the process bars, the parameters and the advice, with the
  controls and the help removed. Any browser's print dialogue can save it as
  a PDF.

## Reading values off the map

Hover anywhere on any map. On the reconstruction you get the concentration
at that point and the range it is likely to lie in. On the uncertainty map
you get the factor either way. On the input map you get the coordinates, and
whatever layer is switched on.

## Where a station would help

Tick **where a station would help** above the map. Every candidate cell is
then coloured by how much a single reading there would reduce the
uncertainty of the whole bay, on a scale where 100 is the best place
available. Grey cells are not candidates, either because they are too often
empty or because they sit within five kilometres of the open boundary.

Before you enter anything it shows where to plan a cruise. After you press
"Read the bay" it updates to show where the next station should go given
what you already know, which is the same calculation that produced the
paper's plan.

## Where the plastic came from

The bay's plastic enters at fourteen release points. A separate study, the
companion source-attribution work, keeps the mass resolved by which of those
it came from and carries the age of every particle, and that layer is
available here. It rests on 610 simulations of the same bay.

Two controls, and the data loads the first time you ask for it. It is about
twelve megabytes, gzipped, and the browser unpacks it in a fraction of a
second.

- **Release points** draws the fourteen sources as purple squares, numbered
  from north to south.
- **How attributable** colours every cell by how strongly a single source
  dominates the plastic there. Red near the river mouths, where the origin is
  nearly certain. Blue in the middle of the bay, where several rivers mix and
  a sample cannot be traced. Hovering names the largest source, says how
  often it leads across the weighted scenarios, and gives the age of that
  plastic.

A panel under the results reports, for each of your stations, seven things.

| Column | What it is |
|---|---|
| Largest source | The release point contributing the most mass at that cell |
| Share | The expected fraction of the plastic there that came from it |
| Leads in | The weight of the scenarios in which it really is the largest |
| Age | Median time that plastic has been in the water since release |
| Runner-up | The second source and its share |
| Told apart | Whether the top two differ enough in transit time to separate |

### Share and "leads in" are different questions

The share is how much of the plastic at that cell is expected to have come
from one source. "Leads in" is how often that source is the largest single
contributor across the weighted scenarios. A cell can sit at a 27 per cent
share and still name its leading source in only a third of the scenarios,
which is the signal that the attribution there is not worth quoting. When a
sample has to be attributed, that second number is the one to use.

### Age, and the separation limit

The source study tracks how long each particle has been in the water. That is
what makes attribution work at all: plastic from a distant river arrives
older than plastic from a nearby one. It also sets the limit. Two sources can
only be separated by that clock when their transit times to your station
differ, and across 65,520 source pairs the campaign measured the limit at
about one day, with a correlation of 0.84 between the age gap and how
distinguishable two sources are.

The panel applies that rule to your own stations. On the six-station example
the top two sources are typically three to four days apart, and about six per
cent of the bay's cells fall below the limit, marked in red.

The ages themselves are informative. In a fate-dominated year the plastic
reaching a station is days to a few weeks old; when fragmentation governs,
the same stations read fifty to eighty days, because fragments stay in the
water column far longer.

### The part that joins the two studies

Source attribution depends on which year the bay is having. This page already
works out which process governs and what its parameters are, so the source
scenarios are weighted by that rather than averaged blindly. On the default
example the conditioning narrows 610 scenarios to an effective 51, and at a
typical cell the leading source moves from a 21 per cent share to 75 per
cent. When no readings have been entered, every scenario counts equally and
the panel says so.

A scenario can stand in for more than one process family: the 122 spectrum
cases run biofouling and fragmentation together, so they are compared against
this page's biofouling scenarios on the biofouling parameters and against its
fragmentation scenarios on the fragmentation ones.

### What this layer does not cover

The barotropic twins and the held-out-formulation cases of the campaign are
excluded here, 100 of the 720. They exist to test whether attribution
survives a circulation the model never trained on, and it does, but they run
a bay this page is not reconstructing. The ten backward-in-time runs are
excluded too, because a per-source mass field does not mean the same thing
in a backward run.

Unlike the earlier pilot version of this layer, the attribution is now
calibrated. Over 8,000 held-out sample points the leading source is correct
70 per cent of the time against 61 per cent from location alone, and after
cross-fitted isotonic recalibration the stated confidence matches observed
accuracy to within 0.8 percentage points.

### Checking the layer

`check_sources.py` rebuilds the published bundle's own arrays from the
campaign archive by a separate code path and compares them, on the smallest
family so it runs in a couple of minutes:

    python check_sources.py

It reports the share array as bit-identical, the pairwise distances to 8e-8,
and the transit times to about a minute of a day.
