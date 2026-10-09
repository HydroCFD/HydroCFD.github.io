# Microplastic transport research companion

`index.html` is the paper companion page. `journey.html` preserves the original schematic teaching demonstration and uses the existing `../js/microplastic-simulator.js`.

Paper: **A GPU-accelerated three-dimensional Lagrangian numerical model for microplastic transport**.

Authors: Danial Goodarzi, Abdolmajid Mohammadian, Abolghasem Pilechi and Atsuhiko Isobe.

## Content sources

The page is based on `paper2/paper_1_model/ariake1.tex` and figures in `paper2/figures/paper_1_model`, supplied by the author on 9 October 2026. Animations are the three supplied `meander_*.mp4` files in that figure directory's `anim` folder. Image previews are WebP versions of the supplied figures; the six original plot PDFs remain downloadable.

The meandering river is synthetic. The manuscript's Ariake Sea results subsection and active abstract are empty in this revision; numerical Ariake fate claims present only in commented text were therefore excluded. No DOI, journal, publication status or public solver repository is inferred. The linked `microplastic_modeling` repository describes a separate project, not the source code for this solver.

Benchmark timings exclude compilation, initial allocation and output. The 0.049 s timing for 10 million particles belongs to the tidal benchmark (38 times faster than 24 CPU threads). The maximum 58 times speedup comes from the reported test suite.

## Maintenance

Update publication details after they are established. Update captions, results and assets together when the manuscript changes. Animations load only on user interaction to keep initial page loading small. The page uses static HTML, CSS and JavaScript and is served directly by GitHub Pages.

To preview locally from the repository root:

```sh
python -m http.server 8765
```

Open `http://localhost:8765/microplastic-simulator/index.html`.
