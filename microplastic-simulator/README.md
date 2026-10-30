# Microplastic transport project page

`index.html` is the project page for the paper **A GPU-accelerated three-dimensional Lagrangian numerical model for microplastic transport** (Danial Goodarzi, Abdolmajid Mohammadian, Abolghasem Pilechi and Atsuhiko Isobe). `journey.html` keeps the original schematic teaching demonstration and uses `../js/microplastic-simulator.js`.

The page shows the model and its processes. The explanations use the wording of the paper. The page deliberately carries no graphs, and its numbers are those of the particle story, which the paper states or which come from `grow_and_break(0.3e-3)` of `paper2/postprocess/biofilm_growth_curves.py`, and the measured wall times of the race. The only simulation output is the films: the three `meander_*.mp4` and the four `ariake_<case>.mp4` year films of the Ariake Sea (section VI, made by `paper2/figures/gen_github_anim.py ariake p1v3_<case>`, posters `ariake_<case>_poster.webp` = last frame).

## Design

Print style: paper `#f2ede3`, ink `#141414`, one vermilion accent `#e4572e`, pale cobalt for water. Newsreader for headings and captions, Public Sans for text. Hairline rules, square corners, no glow and no gradients. All colours are set at the top of `../css/site.css`; the 3D scenes use the same values in their own files. The whole site shares this design, the home page menu and the footer.

## Files

| File | What it draws |
|---|---|
| `../css/site.css` | Shared site styles: colours, menu, hero, sections, footer (used by every page) |
| `paper.css` | Styles for this page only |
| `../js/site.js` | Shared menu, progress bar and fade-in on scroll |
| `js/main.js` | Scroll position of the particle story, film tabs, motion toggle, loads the scenes |
| `../js/3d/loop.js` | Shared helpers: animation loop that runs only while a canvas is on screen, resizing, noise |
| `../js/3d/river.js` | Three.js meandering river with helical secondary flow; particles foul, fragment, sink and settle (also the home page hero) |
| `js/life.js` | One particle of 0.3 mm driven by scroll: transport, biofilm, sinking, three breaks with the film law of the paper, bed |
| `js/frag.js` | New particle per fragment versus weighted particles, with a RAM bar for each |
| `js/mesh.js` | Particles ray-traced through a triangular prism mesh; crossed faces are marked |
| `js/threads.js` | One GPU thread per particle |
| `js/race.js` | GPU against CPU race from the measured wall times of the table of computational performance in the paper, slowed for display; 500,000 particles is interpolated |

three.js 0.160.0 is loaded from jsDelivr through the import map in `index.html`. Without WebGL the page still works; the 3D canvases are hidden.

The scenes are illustrations of the processes, not solver output. The motion pauses with the "Pause motion" button and respects the reduced-motion setting of the system.

## Content sources

Process descriptions follow `paper2/paper_1_model/ariake1.tex` (Methodology and Implementation on GPUs). No DOI, journal or publication status is stated; update the contact section when the paper is published. The plot images and the `meander3d_*_day1.webp` stills in `assets/` from the earlier version of the page are no longer used.

## Preview locally

From the repository root:

```sh
python -m http.server 8765
```

Open `http://localhost:8765/microplastic-simulator/index.html`.
