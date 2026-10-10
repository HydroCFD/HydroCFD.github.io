# Microplastic transport project page

`index.html` is the project page for the paper **A GPU-accelerated three-dimensional Lagrangian numerical model for microplastic transport** (Danial Goodarzi, Abdolmajid Mohammadian, Abolghasem Pilechi and Atsuhiko Isobe). `journey.html` keeps the original schematic teaching demonstration and uses `../js/microplastic-simulator.js`.

The page shows the model and its processes. It deliberately carries no graphs or numerical results. The only simulation output is the three `meander_*.mp4` films.

## Design

Print style: paper `#f2ede3`, ink `#141414`, one vermilion accent `#e4572e`, pale cobalt for water. Newsreader for headings and captions, Public Sans for text. Hairline rules, square corners, no glow and no gradients. All colours are set at the top of `paper.css`; the 3D scenes use the same values in their own files.

## Files

| File | What it draws |
|---|---|
| `paper.css` | All page styles |
| `js/main.js` | Navigation, reveal on scroll, scroll position of the particle story, film tabs, motion toggle, loads the scenes |
| `js/loop.js` | Shared helpers: animation loop that runs only while a canvas is on screen, resizing, noise |
| `js/hero.js` | Fig. 1: three.js meandering river with helical secondary flow; particles foul, fragment, sink and settle |
| `js/life.js` | Fig. 2: one particle driven by scroll: transport, biofilm, sinking, break-up, bed |
| `js/frag.js` | Fig. 3: new particle per fragment versus weighted particles |
| `js/mesh.js` | Fig. 4: particles ray-traced through a triangular prism mesh; crossed faces are marked |
| `js/threads.js` | Fig. 5: one GPU thread per particle |

three.js 0.160.0 is loaded from jsDelivr through the import map in `index.html`. Without WebGL the page still works; the 3D canvases are hidden.

The scenes are illustrations of the processes, not solver output. The motion pauses with the "Pause motion" button and respects the reduced-motion setting of the system.

## Content sources

Process descriptions follow `paper2/paper_1_model/ariake1.tex` (Methodology and Implementation on GPUs). No DOI, journal or publication status is stated; update the contact section when the paper is published. The plot images in `assets/` from the earlier version of the page are no longer used.

## Preview locally

From the repository root:

```sh
python -m http.server 8765
```

Open `http://localhost:8765/microplastic-simulator/index.html`.
