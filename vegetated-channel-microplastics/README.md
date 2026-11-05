# Microplastics in vegetated channels project page

`index.html` is the project page for the paper **A GPU Accelerated Eulerian-Lagrangian Model for Microplastics Transport in Water Systems** (Danial Goodarzi, Abdolmajid Mohammadian, Abolghasem Pilechi and Soroush Abolfathi).

The page explains the model and what it adds: the workflow from the OpenFOAM flow to the GPU particles, the force balance on each microplastic, the exponential drag integrator, the representation of vegetation, the bed, wall and surface rules, and the particle shapes. It carries no results of the paper. The validation section names the laboratory datasets without numbers. The page is linked from the menu of every page as "Vegetated Channels".

## Design

Same print style as the rest of the site (`../css/site.css`): paper `#f2ede3`, ink `#141414`, vermilion `#e4572e`, cobalt for lighter particles, olive for stems. Newsreader for headings and captions, Public Sans for text. The schematics are inline SVG.

## Files

| File | What it does |
|---|---|
| `page.css` | Styles for this page only (figures, labels, integrator, authors) |
| `main.js` | Motion toggle, integrator illustration, loads the figures |
| `js/common.js` | Shared 3D helpers: lights, ink outlines, arrows, points, labels pinned to 3D points |
| `js/channel.js` | Three.js flume with submerged stems: hero (particles rise, settle, deposit) and the section V view with streaks and the velocity profile |
| `js/forces.js` | Three.js particle in a sheared flow with the drag, lift, body force, added mass shell and random path |
| `js/boundaries.js` | 2D canvas: deposition at the bed, rebound, trapping at the free surface |
| `js/shapes.js` | Three.js nine particle shapes settling with the broadest face normal to the motion |
| `../js/3d/loop.js` | Shared site helpers: animation loop that runs only on screen, resizing, pause state |
| `../css/site.css`, `../js/site.js` | Shared site styles, menu, progress bar and fade-in |

The workflow drawing (section II) is inline isometric SVG. three.js 0.160.0 is loaded from jsDelivr through the import map in `index.html`; without WebGL the 3D canvases are hidden.

All figures are illustrations of the processes, not model output. The motion pauses with the "Pause motion" button and respects the reduced-motion setting of the system. The integrator plot is the analytic relaxation `v/u = 1 - exp(-t/τ)` against the forward Euler update `v + Δt (u - v)/τ`.

## Preview locally

From the repository root:

```sh
python -m http.server 8765
```

then open http://localhost:8765/vegetated-channel-microplastics/index.html
